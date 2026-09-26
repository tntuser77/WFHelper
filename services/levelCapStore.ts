import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { userDataPath } from "./userDataPath";
import { writeFileAtomicSync } from "./atomicFile";
import { normalizeRunNotes, normalizeRunTags } from "./runAnnotations";
import { withScope } from "./logger";
import { normalizeErrorMessage } from "../config/shared/errors";
import type {
  LevelCapBuild,
  LevelCapImportResult,
  LevelCapRun,
  LevelCapSettings,
} from "../config/shared/levelCapTypes";

const log = withScope("levelCapStore");

const INDEX_FILE = "level-cap-runs.json";
const INDEX_SCHEMA_VERSION = 1;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
/** Folders the old sorter script left beside the frame folders. */
const IGNORED_DIRS = new Set(["__pycache__", "__init__"]);

let _runs: LevelCapRun[] = [];
let _settings: LevelCapSettings | null = null;
let _loaded = false;

function defaultSettings(): LevelCapSettings {
  return {
    hotkey: "F12",
    passthrough: true,
    screenshotDir: path.join(app.getPath("pictures"), "WarframeCaps"),
    backupDir: "",
  };
}

function normalizeSettings(raw: unknown): LevelCapSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<Record<keyof LevelCapSettings, unknown>>;
  return {
    hotkey: typeof value.hotkey === "string" ? value.hotkey.slice(0, 64) : base.hotkey,
    passthrough: typeof value.passthrough === "boolean" ? value.passthrough : base.passthrough,
    screenshotDir:
      typeof value.screenshotDir === "string" && value.screenshotDir.trim()
        ? value.screenshotDir
        : base.screenshotDir,
    backupDir: typeof value.backupDir === "string" ? value.backupDir : base.backupDir,
  };
}

/** The index is a plain file a user can edit, so every entry is checked on the way in. */
function normalizeRun(raw: unknown): LevelCapRun | null {
  if (!raw || typeof raw !== "object") return null;
  const run = raw as LevelCapRun;
  if (typeof run.id !== "string" || typeof run.frame !== "string" || !run.frame.trim()) {
    return null;
  }
  if (typeof run.completedAt !== "number" || !Number.isFinite(run.completedAt)) return null;
  const tags = normalizeRunTags(run.tags);
  const notes = normalizeRunNotes(run.notes);
  const out: LevelCapRun = {
    ...run,
    frameType: typeof run.frameType === "string" ? run.frameType : null,
    exolizers: typeof run.exolizers === "number" ? run.exolizers : null,
    durationSec: typeof run.durationSec === "number" ? run.durationSec : null,
    squadSize: typeof run.squadSize === "number" ? run.squadSize : null,
    tile: run.tile ?? null,
    archgunUsed: run.archgunUsed === true,
    build: run.build ?? null,
    screenshot: typeof run.screenshot === "string" ? run.screenshot : null,
  };
  delete out.tags;
  delete out.notes;
  if (tags.length) out.tags = tags;
  if (notes) out.notes = notes;
  return out;
}

function ensureLoaded(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(userDataPath(INDEX_FILE), "utf8")) as {
      runs?: unknown;
      settings?: unknown;
    };
    _runs = Array.isArray(parsed.runs) ? parsed.runs.flatMap((raw) => normalizeRun(raw) ?? []) : [];
    _settings = normalizeSettings(parsed.settings);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      log.warn("[LevelCap] index unreadable, starting empty:", normalizeErrorMessage(err));
    }
    _runs = [];
    _settings = defaultSettings();
  }
}

function serialize(): string {
  return JSON.stringify(
    { schemaVersion: INDEX_SCHEMA_VERSION, settings: _settings, runs: _runs },
    null,
    1,
  );
}

function save(): void {
  const text = serialize();
  try {
    writeFileAtomicSync(userDataPath(INDEX_FILE), text);
  } catch (err) {
    log.warn("[LevelCap] failed to save index:", normalizeErrorMessage(err));
  }
  mirrorToBackup(text);
}

let _mirrorChain: Promise<void> = Promise.resolve();

async function sameSize(a: string, b: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([fs.promises.stat(a), fs.promises.stat(b)]);
    return left.size === right.size;
  } catch {
    return false;
  }
}

async function mirror(backupDir: string, indexText: string, shotRoot: string, shots: string[]) {
  await fs.promises.mkdir(backupDir, { recursive: true });
  await fs.promises.writeFile(path.join(backupDir, INDEX_FILE), indexText);
  for (const shot of shots) {
    const relative = path.relative(shotRoot, shot);
    const inRoot = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
    const target = path.join(
      backupDir,
      "screenshots",
      inRoot ? relative : path.join("other", path.basename(shot)),
    );
    if (await sameSize(shot, target)) continue;
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.copyFile(shot, target);
    } catch (err) {
      // A screenshot deleted by hand should not stop the rest of the copy.
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
  }
}

/** Copies the index and any screenshot the backup lacks, off the main thread's
 * critical path and one pass at a time. Never throws: a missing or unplugged
 * backup drive must not cost the primary save. */
function mirrorToBackup(indexText: string): void {
  const backupDir = _settings?.backupDir.trim();
  if (!backupDir) return;
  const shotRoot = path.resolve(_settings?.screenshotDir ?? "");
  const shots = _runs.flatMap((run) => (run.screenshot ? [run.screenshot] : []));
  _mirrorChain = _mirrorChain
    .then(() => mirror(backupDir, indexText, shotRoot, shots))
    .catch((err) => log.warn("[LevelCap] backup mirror failed:", normalizeErrorMessage(err)));
}

/** Resolves once every queued backup copy has landed. */
export function awaitBackupForTest(): Promise<void> {
  return _mirrorChain;
}

function formatId(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  );
}

function uniqueId(at: number): string {
  const base = formatId(new Date(at));
  let id = base;
  for (let n = 2; _runs.some((r) => r.id === id); n++) id = `${base}-${n}`;
  return id;
}

function sortRuns(): void {
  _runs.sort((a, b) => b.completedAt - a.completedAt);
}

export function getRuns(): LevelCapRun[] {
  ensureLoaded();
  return _runs;
}

export function getSettings(): LevelCapSettings {
  ensureLoaded();
  return _settings ?? defaultSettings();
}

export function updateSettings(patch: Partial<LevelCapSettings>): LevelCapSettings {
  ensureLoaded();
  _settings = normalizeSettings({ ...getSettings(), ...patch });
  save();
  return _settings;
}

export function addRun(run: Omit<LevelCapRun, "id">): LevelCapRun {
  ensureLoaded();
  const record: LevelCapRun = { ...run, id: uniqueId(run.completedAt) };
  _runs.push(record);
  sortRuns();
  save();
  return record;
}

/** Mutate one record and persist; null when the id is unknown. */
export function updateRun(id: string, mutate: (run: LevelCapRun) => void): LevelCapRun | null {
  ensureLoaded();
  const run = _runs.find((r) => r.id === id);
  if (!run) return null;
  mutate(run);
  save();
  return run;
}

export function setRunTags(id: string, tags: unknown): LevelCapRun | null {
  return updateRun(id, (run) => {
    const clean = normalizeRunTags(tags);
    if (clean.length) run.tags = clean;
    else delete run.tags;
  });
}

export function setRunNotes(id: string, notes: unknown): LevelCapRun | null {
  return updateRun(id, (run) => {
    const clean = normalizeRunNotes(notes);
    if (clean) run.notes = clean;
    else delete run.notes;
  });
}

/** Stamp one build onto several runs and mark them checked. */
export function applyBuild(
  ids: readonly string[],
  build: LevelCapBuild,
  frame: string | null,
): LevelCapRun[] {
  ensureLoaded();
  const wanted = new Set(ids);
  const changed = _runs.filter((run) => wanted.has(run.id));
  for (const run of changed) {
    run.build = structuredClone(build);
    if (build.suit) run.frameType = build.suit.type;
    if (frame) run.frame = frame;
    delete run.buildUnverified;
  }
  if (changed.length) save();
  return changed;
}

/** Drops the record only; the screenshot stays on disk. */
export function deleteRun(id: string): boolean {
  ensureLoaded();
  const before = _runs.length;
  _runs = _runs.filter((r) => r.id !== id);
  if (_runs.length === before) return false;
  save();
  return true;
}

function foldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Existing folder for a frame ("Cyte" for Cyte-09), or the frame name itself. */
function frameFolder(frame: string): string {
  const root = getSettings().screenshotDir;
  const wanted = foldName(frame);
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folded = foldName(entry.name);
      if (folded && (folded === wanted || wanted.startsWith(folded))) {
        return path.join(root, entry.name);
      }
    }
  } catch {
    // no root yet; created below
  }
  return path.join(root, frame.replace(/[<>:"/\\|?*]/g, "").trim() || "Unknown");
}

/** Saves "<Frame> N.png" after the highest number already in the folder, the
 * naming the screenshots had before this tab existed. */
export function saveScreenshot(frame: string, png: Buffer): string {
  const dir = frameFolder(frame);
  fs.mkdirSync(dir, { recursive: true });
  let highest = 0;
  for (const name of fs.readdirSync(dir)) {
    const n = name.match(/(\d+)\.[^.]+$/);
    if (n) highest = Math.max(highest, Number(n[1]));
  }
  const file = path.join(dir, `${path.basename(dir)} ${highest + 1}.png`);
  writeFileAtomicSync(file, png);
  return file;
}

export function replaceScreenshot(file: string, png: Buffer): void {
  writeFileAtomicSync(file, png);
}

interface ImportResolver {
  /** Frame played for a folder name, or null when nothing owned matches. */
  frameForFolder(folder: string): { frame: string; frameType: string | null };
  buildForFrame(frameType: string): LevelCapBuild | null;
}

/** Adopts every screenshot under the screenshot folder that no run owns yet.
 * The build is a guess from today's inventory, so the run is flagged. */
export function importScreenshotFolders(resolver: ImportResolver): LevelCapImportResult {
  ensureLoaded();
  const root = getSettings().screenshotDir;
  const owned = new Set(
    _runs.flatMap((run) => (run.screenshot ? [path.resolve(run.screenshot).toLowerCase()] : [])),
  );
  let imported = 0;
  let skipped = 0;
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    log.warn("[LevelCap] screenshot folder unreadable:", normalizeErrorMessage(err));
    return { imported, skipped };
  }
  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name.startsWith(".") || IGNORED_DIRS.has(dir.name)) continue;
    const { frame, frameType } = resolver.frameForFolder(dir.name);
    const build = frameType ? resolver.buildForFrame(frameType) : null;
    const folder = path.join(root, dir.name);
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name);
      if (!IMAGE_EXTS.has(path.extname(name).toLowerCase())) continue;
      if (owned.has(path.resolve(file).toLowerCase())) {
        skipped++;
        continue;
      }
      _runs.push({
        id: uniqueId(fs.statSync(file).mtimeMs),
        completedAt: fs.statSync(file).mtimeMs,
        frame,
        frameType,
        source: "import",
        exolizers: null,
        durationSec: null,
        squadSize: null,
        tile: null,
        archgunUsed: false,
        build: build ? structuredClone(build) : null,
        buildUnverified: true,
        screenshot: file,
      });
      imported++;
    }
  }
  if (imported) {
    sortRuns();
    save();
  }
  return { imported, skipped };
}

export function __resetLevelCapStoreForTest(): void {
  _runs = [];
  _settings = null;
  _loaded = false;
}
