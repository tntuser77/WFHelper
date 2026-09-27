import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { userDataPath } from "./userDataPath";
import { writeFileAtomicSync } from "./atomicFile";
import { normalizeRunNotes, normalizeRunTags } from "./runAnnotations";
import { withScope } from "./logger";
import { normalizeErrorMessage } from "../config/shared/errors";
import {
  isLevelCapRivenType,
  levelCapBuildKey,
  nextLevelCapBuildName,
  normalizeLevelCapBuild,
} from "../config/shared/levelCapBuild";
import type {
  LevelCapBuild,
  LevelCapBuildPatch,
  LevelCapImportResult,
  LevelCapItem,
  LevelCapNamedBuild,
  LevelCapRiven,
  LevelCapRun,
  LevelCapSettings,
} from "../config/shared/levelCapTypes";

const log = withScope("levelCapStore");

const INDEX_FILE = "level-cap-runs.json";
// 2: builds are named records runs point at; 1 kept a loose copy per run.
const INDEX_SCHEMA_VERSION = 2;
const MAX_BUILD_NAME = 48;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
/** Folders the old sorter script left beside the frame folders. */
const IGNORED_DIRS = new Set(["__pycache__", "__init__"]);

let _runs: LevelCapRun[] = [];
let _builds: LevelCapNamedBuild[] = [];
let _settings: LevelCapSettings | null = null;
let _frameNotes: Record<string, string> = {};
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
  const players = normalizePlayers(run.players);
  const out: LevelCapRun = {
    ...run,
    frameType: typeof run.frameType === "string" ? run.frameType : null,
    exolizers: typeof run.exolizers === "number" ? run.exolizers : null,
    rounds: typeof run.rounds === "number" ? run.rounds : null,
    durationSec: typeof run.durationSec === "number" ? run.durationSec : null,
    squadSize: typeof run.squadSize === "number" ? run.squadSize : null,
    tile: run.tile ?? null,
    archgunUsed: run.archgunUsed === true,
    build: normalizeLevelCapBuild(run.build),
    screenshot: typeof run.screenshot === "string" ? run.screenshot : null,
  };
  delete out.tags;
  delete out.players;
  if (players.length) out.players = players;
  delete (out as { notes?: unknown }).notes;
  delete out.buildId;
  if (tags.length) out.tags = tags;
  if (typeof run.buildId === "string" && run.buildId) out.buildId = run.buildId;
  return out;
}

function normalizePlayers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names = raw
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim().slice(0, 64))
    .filter(Boolean);
  return [...new Set(names)].slice(0, 8);
}

function normalizeFrameNotes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [frame, notes] of Object.entries(raw)) {
    const clean = normalizeRunNotes(notes);
    if (frame.trim() && clean) out[frame] = clean;
  }
  return out;
}

function buildName(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, MAX_BUILD_NAME) : null;
}

function normalizeNamedBuild(raw: unknown): LevelCapNamedBuild | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Record<keyof LevelCapNamedBuild, unknown>>;
  const build = normalizeLevelCapBuild(value.build);
  const name = buildName(value.name);
  if (typeof value.id !== "string" || !value.id || typeof value.frame !== "string") return null;
  if (!build || !name) return null;
  const tags = normalizeRunTags(value.tags);
  return { id: value.id, frame: value.frame, name, ...(tags.length ? { tags } : {}), build };
}

function newBuild(frame: string, build: LevelCapBuild, name?: string): LevelCapNamedBuild {
  const taken = _builds.filter((b) => b.frame === frame).map((b) => b.name);
  const record: LevelCapNamedBuild = {
    id: randomUUID(),
    frame,
    name: buildName(name) ?? nextLevelCapBuildName(taken),
    build: structuredClone(build),
  };
  _builds.push(record);
  return record;
}

function stamp(run: LevelCapRun, record: LevelCapNamedBuild): void {
  run.buildId = record.id;
  run.build = structuredClone(record.build);
  run.frame = record.frame;
  if (record.build.suit) run.frameType = record.build.suit.type;
}

/** Points a run at the frame's build matching its loadout, making one when none
 * does. The unverified flag stays: a guessed loadout is still a guess. */
function linkByLoadout(run: LevelCapRun): void {
  if (!run.build) return;
  const key = levelCapBuildKey(run.build);
  const record =
    _builds.find((b) => b.frame === run.frame && levelCapBuildKey(b.build) === key) ??
    newBuild(run.frame, run.build);
  stamp(run, record);
}

/** Run tags move to the build a checked run belongs to. */
function moveTagsToBuild(run: LevelCapRun, record: LevelCapNamedBuild): void {
  if (!run.tags?.length) return;
  const tags = normalizeRunTags([...(record.tags ?? []), ...run.tags]);
  if (tags.length) record.tags = tags;
  delete run.tags;
}

/** Version 1 indexes: group each frame's identical loadouts into one named build. */
function migrateLooseBuilds(): void {
  const oldestFirst = [..._runs].sort((a, b) => a.completedAt - b.completedAt);
  for (const run of oldestFirst) {
    linkByLoadout(run);
    const record = _builds.find((b) => b.id === run.buildId);
    if (record && !run.buildUnverified) moveTagsToBuild(run, record);
  }
}

function ensureLoaded(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(userDataPath(INDEX_FILE), "utf8")) as {
      schemaVersion?: unknown;
      runs?: unknown;
      builds?: unknown;
      settings?: unknown;
      frameNotes?: unknown;
    };
    _runs = Array.isArray(parsed.runs) ? parsed.runs.flatMap((raw) => normalizeRun(raw) ?? []) : [];
    _builds = Array.isArray(parsed.builds)
      ? parsed.builds.flatMap((raw) => normalizeNamedBuild(raw) ?? [])
      : [];
    _settings = normalizeSettings(parsed.settings);
    _frameNotes = normalizeFrameNotes(parsed.frameNotes);
    const version = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1;
    if (version < 2) {
      // Keep the pre-migration index untouched in case the grouping is ever wrong.
      const legacy = userDataPath(`level-cap-runs.v${version}.json`);
      if (!fs.existsSync(legacy)) fs.copyFileSync(userDataPath(INDEX_FILE), legacy);
      migrateLooseBuilds();
      save();
      log.info(`[LevelCap] grouped ${_runs.length} runs into ${_builds.length} named builds`);
    }
    // A build deleted by hand leaves its runs unassigned, never pointing nowhere.
    const known = new Set(_builds.map((b) => b.id));
    for (const run of _runs) if (run.buildId && !known.has(run.buildId)) delete run.buildId;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      log.warn("[LevelCap] index unreadable, starting empty:", normalizeErrorMessage(err));
    }
    _runs = [];
    _builds = [];
    _settings = defaultSettings();
    _frameNotes = {};
  }
}

function serialize(): string {
  return JSON.stringify(
    {
      schemaVersion: INDEX_SCHEMA_VERSION,
      settings: _settings,
      frameNotes: _frameNotes,
      builds: _builds,
      runs: _runs,
    },
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

export function getBuilds(): LevelCapNamedBuild[] {
  ensureLoaded();
  return _builds;
}

export function addRun(run: Omit<LevelCapRun, "id">): LevelCapRun {
  ensureLoaded();
  const record: LevelCapRun = { ...run, id: uniqueId(run.completedAt) };
  linkByLoadout(record);
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

/** The archgun gained XP on this run, so its build carries it from now on. A
 * build that already has an archgun keeps its own. */
export function addArchgunToBuild(id: string, archgun: LevelCapItem): LevelCapRun | null {
  return updateRun(id, (run) => {
    const record = _builds.find((b) => b.id === run.buildId);
    if (!record) {
      if (run.build && !run.build.archgun) run.build.archgun = structuredClone(archgun);
      return;
    }
    if (record.build.archgun) return;
    record.build.archgun = structuredClone(archgun);
    for (const other of _runs) if (other.buildId === record.id) stamp(other, record);
  });
}

/** The run's loadout changed under it (the tracker corrected the frame); find its build again. */
export function relinkRun(id: string): LevelCapRun | null {
  return updateRun(id, (run) => {
    delete run.buildId;
    linkByLoadout(run);
  });
}

export function getFrameNotes(): Record<string, string> {
  ensureLoaded();
  return { ..._frameNotes };
}

export function setFrameNotes(frame: string, notes: unknown): void {
  ensureLoaded();
  const clean = normalizeRunNotes(notes);
  if (clean) _frameNotes[frame] = clean;
  else delete _frameNotes[frame];
  save();
}

export function createBuild(
  frame: string,
  build: LevelCapBuild,
  name?: string,
): LevelCapNamedBuild {
  ensureLoaded();
  const record = newBuild(frame, build, name);
  save();
  return record;
}

/** Renames, retags or rebuilds one build; a new loadout rewrites every run that uses it. */
export function updateBuild(id: string, patch: LevelCapBuildPatch): LevelCapNamedBuild | null {
  ensureLoaded();
  const record = _builds.find((b) => b.id === id);
  if (!record) return null;
  const name = buildName(patch.name);
  if (name) record.name = name;
  if (patch.tags !== undefined) {
    const tags = normalizeRunTags(patch.tags);
    if (tags.length) record.tags = tags;
    else delete record.tags;
  }
  const build = patch.build === undefined ? null : normalizeLevelCapBuild(patch.build);
  if (build) {
    record.build = build;
    for (const run of _runs) if (run.buildId === id) stamp(run, record);
  }
  save();
  return record;
}

function itemsOf(build: LevelCapBuild | null): LevelCapItem[] {
  if (!build) return [];
  const items = [
    build.suit,
    build.primary,
    build.secondary,
    build.melee,
    build.archgun,
    build.companion,
    build.companion?.weapon ?? null,
  ];
  return items.filter((item): item is LevelCapItem => item !== null);
}

/** Builds from before rivens were captured name the riven but not its stats; fill
 * them from the inventory when the lookup is sure which riven it was. */
export function backfillRivens(find: (weaponType: string) => LevelCapRiven | null): boolean {
  ensureLoaded();
  let changed = false;
  for (const build of [..._builds.map((b) => b.build), ..._runs.map((r) => r.build)]) {
    for (const item of itemsOf(build)) {
      for (const upgrade of item.upgrades) {
        if (upgrade.riven || !isLevelCapRivenType(upgrade.type)) continue;
        const riven = find(item.type);
        if (!riven) continue;
        upgrade.riven = structuredClone(riven);
        changed = true;
      }
    }
  }
  if (changed) save();
  return changed;
}

/** Fills in the name and parts of zaws, kitguns and MOAs saved before builds kept
 *  them, so a build shows "Rabve Status" instead of the shared modular type. */
export function backfillModular(
  find: (item: LevelCapItem) => Pick<LevelCapItem, "parts" | "customName"> | null,
): boolean {
  ensureLoaded();
  let changed = false;
  for (const build of [..._builds.map((b) => b.build), ..._runs.map((r) => r.build)]) {
    for (const item of itemsOf(build)) {
      if (item.parts || !/Modular/i.test(item.type)) continue;
      const identity = find(item);
      if (!identity?.parts) continue;
      Object.assign(item, identity);
      changed = true;
    }
  }
  if (changed) save();
  return changed;
}

/** The runs keep their last copy of the loadout and go back to needing a build. */
export function deleteBuild(id: string): boolean {
  ensureLoaded();
  const before = _builds.length;
  _builds = _builds.filter((b) => b.id !== id);
  if (_builds.length === before) return false;
  for (const run of _runs) {
    if (run.buildId !== id) continue;
    delete run.buildId;
    run.buildUnverified = true;
  }
  save();
  return true;
}

/** Puts runs on a build and marks them checked; this is also how a guess is confirmed. */
export function assignBuild(ids: readonly string[], buildId: string): LevelCapRun[] {
  ensureLoaded();
  const record = _builds.find((b) => b.id === buildId);
  if (!record) return [];
  const wanted = new Set(ids);
  const changed = _runs.filter((run) => wanted.has(run.id));
  for (const run of changed) {
    stamp(run, record);
    delete run.buildUnverified;
    moveTagsToBuild(run, record);
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
      linkByLoadout(_runs[_runs.length - 1]);
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
  _builds = [];
  _settings = null;
  _frameNotes = {};
  _loaded = false;
}
