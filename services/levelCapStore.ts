import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { cleanSquadRead, matchRowsToPlayers, resolveSquadNames } from "./levelCapSquadNames";
import type { SquadScreenshotRead } from "./levelCapSquadOcr";
import { groupPortraits, isPortrait } from "./levelCapSquadPortraits";
import { guessLevelCapTags, newlyGuessedLevelCapTags } from "./levelCapTagGuess";
import { userDataPath } from "./userDataPath";
import { writeFileAtomicSync } from "./atomicFile";
import { normalizeRunNotes, normalizeRunTags } from "./runAnnotations";
import { withScope } from "./logger";
import { normalizeErrorMessage } from "../config/shared/errors";
import { normalizePlayerAliases } from "../config/shared/playerAliases";
import {
  isLevelCapRivenType,
  levelCapBuildKey,
  nextLevelCapBuildName,
  normalizeLevelCapBuild,
} from "../config/shared/levelCapBuild";
import { LEVEL_CAP_DEFAULT_SKIN } from "../config/shared/levelCapTypes";
import type {
  LevelCapBuild,
  LevelCapBuildPatch,
  LevelCapImportResult,
  LevelCapItem,
  LevelCapLogSquadmate,
  LevelCapNamedBuild,
  LevelCapPortraitLabel,
  LevelCapSquadFix,
  LevelCapRiven,
  LevelCapRun,
  LevelCapSettings,
  LevelCapSquadmate,
} from "../config/shared/levelCapTypes";

const log = withScope("levelCapStore");

const INDEX_FILE = "level-cap-runs.json";
// 2: builds are named records runs point at; 1 kept a loose copy per run.
const INDEX_SCHEMA_VERSION = 5;
const MAX_BUILD_NAME = 48;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
/** Folders the old sorter script left beside the frame folders. */
const IGNORED_DIRS = new Set(["__pycache__", "__init__"]);

let _runs: LevelCapRun[] = [];
let _builds: LevelCapNamedBuild[] = [];
let _settings: LevelCapSettings | null = null;
let _frameNotes: Record<string, string> = {};
let _frameIcons: Record<string, string> = {};
let _portraitLabels: LevelCapPortraitLabel[] = [];
const PORTRAIT_DIR = "level-cap-portraits";
const SQUAD_LOG_DIR = "level-cap-logs";
const MAX_SQUAD_LOGS = 20;
let _loaded = false;

function defaultSettings(): LevelCapSettings {
  return {
    hotkey: "F12",
    passthrough: true,
    screenshotDir: path.join(app.getPath("pictures"), "WarframeCaps"),
    backupDir: "",
    knownPlayers: [],
    playerAliases: {},
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
    knownPlayers: Array.isArray(value.knownPlayers)
      ? normalizePlayers(value.knownPlayers, 200)
      : base.knownPlayers,
    playerAliases: normalizePlayerAliases(value.playerAliases),
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
  delete out.kills;
  if (Number.isSafeInteger(run.kills) && (run.kills as number) >= 0) out.kills = run.kills;
  delete out.players;
  delete out.exolizerOcr;
  if (run.exolizerOcr === "read" || run.exolizerOcr === "unreadable") {
    out.exolizerOcr = run.exolizerOcr;
  }
  if (players.length) out.players = players;
  delete out.squadReads;
  delete out.squadOcr;
  delete out.playersFromScreenshot;
  if (Array.isArray(run.squadReads)) out.squadReads = normalizeSquadReads(run.squadReads);
  if (run.squadOcr === "read" || run.squadOcr === "unreadable") out.squadOcr = run.squadOcr;
  if (run.playersFromScreenshot === true) out.playersFromScreenshot = true;
  delete out.squadPortraits;
  delete out.squadmates;
  if (Array.isArray(run.squadPortraits)) {
    out.squadPortraits = run.squadPortraits.slice(0, 4).map((p) => (isPortrait(p) ? p : null));
  }
  if (Array.isArray(run.squadmates)) out.squadmates = normalizeSquadmates(run.squadmates);
  delete out.squadLog;
  const squadLog = Array.isArray(run.squadLog) ? normalizeSquadLog(run.squadLog) : [];
  if (squadLog.length) out.squadLog = squadLog;
  delete out.squadReader;
  if (typeof run.squadReader === "number") out.squadReader = run.squadReader;
  delete out.squadRows;
  if (Array.isArray(run.squadRows)) out.squadRows = normalizeSquadRows(run.squadRows);
  delete out.squadFixes;
  const fixes = Array.isArray(run.squadFixes) ? normalizeSquadFixes(run.squadFixes) : [];
  if (fixes.length) out.squadFixes = fixes;
  delete (out as { notes?: unknown }).notes;
  delete out.buildId;
  if (tags.length) out.tags = tags;
  if (typeof run.buildId === "string" && run.buildId) out.buildId = run.buildId;
  return out;
}

function normalizePlayers(raw: unknown, max = 8): string[] {
  if (!Array.isArray(raw)) return [];
  const names = raw
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim().slice(0, 64))
    .filter(Boolean);
  return [...new Set(names)].slice(0, max);
}

function normalizeSquadReads(raw: unknown[]): string[][] {
  return raw
    .slice(0, 4)
    .map((slot) =>
      Array.isArray(slot)
        ? slot
            .filter((read): read is string => typeof read === "string")
            .map((read) => read.slice(0, 64))
        : [],
    );
}

function normalizeSquadmates(raw: unknown[]): LevelCapSquadmate[] {
  const text = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 64) : null);
  return raw.slice(0, 8).map((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>;
    const mate: LevelCapSquadmate = {
      name: text(value.name),
      portrait: text(value.portrait),
      frame: text(value.frame),
    };
    if (Number.isInteger(value.slot)) mate.slot = value.slot as number;
    return mate;
  });
}

function normalizeSquadLog(raw: unknown[]): LevelCapLogSquadmate[] {
  return raw.slice(0, 8).flatMap((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>;
    if (typeof value.name !== "string" || !value.name.trim()) return [];
    if (!Number.isInteger(value.slot)) return [];
    const mate: LevelCapLogSquadmate = {
      name: value.name.trim().slice(0, 64),
      slot: value.slot as number,
    };
    if (value.host === true) mate.host = true;
    if (value.you === true) mate.you = true;
    if (typeof value.frame === "string" && value.frame) mate.frame = value.frame.slice(0, 64);
    if (value.frameGuess === true && mate.frame) mate.frameGuess = true;
    if (!mate.you && Number.isSafeInteger(value.kills) && (value.kills as number) >= 0) {
      mate.kills = value.kills as number;
    }
    return [mate];
  });
}

function normalizeSquadRows(raw: unknown[]): Array<{ top: number; bottom: number }> {
  const fraction = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;
  return raw.slice(0, 4).flatMap((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>;
    return fraction(value.top) &&
      fraction(value.bottom) &&
      (value.bottom as number) > (value.top as number)
      ? [{ top: value.top as number, bottom: value.bottom as number }]
      : [];
  });
}

function normalizeSquadFix(raw: unknown): LevelCapSquadFix | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(value.slot) || (value.slot as number) < 0 || (value.slot as number) > 3) {
    return null;
  }
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : null);
  const fix: LevelCapSquadFix = { slot: value.slot as number };
  const name = text(value.name);
  const frame = text(value.frame);
  if (name) fix.name = name;
  if (frame) fix.frame = frame;
  if (value.notSquadmate === true) fix.notSquadmate = true;
  return name || frame || fix.notSquadmate ? fix : null;
}

function normalizeSquadFixes(raw: unknown[]): LevelCapSquadFix[] {
  const bySlot = new Map<number, LevelCapSquadFix>();
  for (const entry of raw) {
    const fix = normalizeSquadFix(entry);
    if (fix) bySlot.set(fix.slot, fix);
  }
  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

function normalizePortraitLabels(raw: unknown): LevelCapPortraitLabel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>;
    return isPortrait(value.portrait) && typeof value.frame === "string" && value.frame.trim()
      ? [{ portrait: value.portrait, frame: value.frame.trim().slice(0, 64) }]
      : [];
  });
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

function normalizeFrameIcons(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [frame, skin] of Object.entries(raw)) {
    const clean = frameIcon(skin);
    if (frame.trim() && clean) out[frame] = clean;
  }
  return out;
}

/** A skin path or the default marker; anything else unpins the icon. */
function frameIcon(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  return raw === LEVEL_CAP_DEFAULT_SKIN || raw.startsWith("/Lotus/") ? raw : null;
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
  addBuildTags(record, guessLevelCapTags(build));
  _builds.push(record);
  return record;
}

/** Adds tags after the build's own; a tag it already has keeps the player's casing. */
function addBuildTags(record: LevelCapNamedBuild, tags: string[]): void {
  if (!tags.length) return;
  const merged = normalizeRunTags([...(record.tags ?? []), ...tags]);
  if (merged.length) record.tags = merged;
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
  const found = _builds.find((b) => b.frame === run.frame && levelCapBuildKey(b.build) === key);
  if (found) fillIncarnon(found.build, run.build);
  stamp(run, found ?? newBuild(run.frame, run.build));
}

/** Builds saved before Incarnon perks were read pick them up from the next run
 *  on that loadout; perks the player set stay. */
function fillIncarnon(target: LevelCapBuild, source: LevelCapBuild): void {
  for (const kind of ["primary", "secondary", "melee"] as const) {
    const item = target[kind];
    const perks = source[kind]?.incarnon;
    if (item && perks?.length && !item.incarnon && source[kind]?.type === item.type) {
      item.incarnon = [...perks];
    }
  }
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
      frameIcons?: unknown;
      portraitLabels?: unknown;
    };
    _runs = Array.isArray(parsed.runs) ? parsed.runs.flatMap((raw) => normalizeRun(raw) ?? []) : [];
    _builds = Array.isArray(parsed.builds)
      ? parsed.builds.flatMap((raw) => normalizeNamedBuild(raw) ?? [])
      : [];
    _settings = normalizeSettings(parsed.settings);
    _frameNotes = normalizeFrameNotes(parsed.frameNotes);
    _frameIcons = normalizeFrameIcons(parsed.frameIcons);
    _portraitLabels = normalizePortraitLabels(parsed.portraitLabels);
    const version = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1;
    if (version < INDEX_SCHEMA_VERSION) {
      // Keep the pre-migration index untouched in case a migration is ever wrong.
      const legacy = userDataPath(`level-cap-runs.v${version}.json`);
      if (!fs.existsSync(legacy)) fs.copyFileSync(userDataPath(INDEX_FILE), legacy);
      if (version < 2) {
        migrateLooseBuilds();
        log.info(`[LevelCap] grouped ${_runs.length} runs into ${_builds.length} named builds`);
      }
      // Versions 3+: builds get the tags that guessing rules newer than the index imply.
      for (const record of _builds) addBuildTags(record, guessLevelCapTags(record.build, version));
      save();
    }
    // A build deleted by hand leaves its runs unassigned, never pointing nowhere.
    const known = new Set(_builds.map((b) => b.id));
    for (const run of _runs) if (run.buildId && !known.has(run.buildId)) delete run.buildId;
    // Labels written while the app was closed reach the squads now, not at the next save.
    resolveScreenshotSquads();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      log.warn("[LevelCap] index unreadable, starting empty:", normalizeErrorMessage(err));
    }
    _runs = [];
    _builds = [];
    _settings = defaultSettings();
    _frameNotes = {};
    _frameIcons = {};
    _portraitLabels = [];
  }
}

function serialize(): string {
  return JSON.stringify(
    {
      schemaVersion: INDEX_SCHEMA_VERSION,
      settings: _settings,
      frameNotes: _frameNotes,
      frameIcons: _frameIcons,
      portraitLabels: _portraitLabels,
      builds: _builds,
      runs: _runs,
    },
    null,
    1,
  );
}

/** Names from live runs, minus yours: the one name every live run has. */
function namesFromLiveRuns(): string[] {
  const live = _runs.filter((run) => run.players?.length && !run.playersFromScreenshot);
  const counts = new Map<string, number>();
  for (const run of live)
    for (const name of run.players ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => live.length < 2 || count < live.length)
    .map(([name]) => name);
}

/** Your own name: the log marks it, else it is the one name every live run has. */
function selfNames(): Set<string> {
  const marked = _runs.flatMap(
    (run) => run.squadLog?.flatMap((mate) => (mate.you ? [mate.name] : [])) ?? [],
  );
  if (marked.length) return new Set(marked);
  const live = _runs.filter((run) => run.players?.length && !run.playersFromScreenshot);
  if (live.length < 2) return new Set();
  const counts = new Map<string, number>();
  for (const run of live)
    for (const name of new Set(run.players)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count === live.length).map(([name]) => name));
}

/** The exact names a run's log gave for your squadmates; empty for runs with no log. */
function loggedSquadmates(run: LevelCapRun, self: Set<string>): string[] {
  if (run.squadLog?.length) return run.squadLog.flatMap((mate) => (mate.you ? [] : [mate.name]));
  if (!run.players?.length || run.playersFromScreenshot) return [];
  return run.players.filter((name) => !self.has(name));
}

/** The frame the log gave a player; a host's guessed one only when nothing better is known. */
function logFrame(run: LevelCapRun, name: string | null, guesses: boolean): string | null {
  const mate = name ? run.squadLog?.find((entry) => entry.name === name) : undefined;
  if (!mate?.frame || (mate.frameGuess === true) !== guesses) return null;
  return mate.frame;
}

/** Log players no screenshot row was pinned to, so their names and frames still count. */
function unplacedLogSquadmates(run: LevelCapRun, placed: Set<string>): LevelCapSquadmate[] {
  return (run.squadLog ?? []).flatMap((mate) =>
    mate.you || placed.has(mate.name)
      ? []
      : [{ name: mate.name, portrait: null, frame: mate.frame ?? null }],
  );
}

/** Re-pins every screenshot run's squad, since each learned name can fix old reads. */
function resolveScreenshotSquads(): void {
  for (const run of _runs) {
    if (!run.squadReads && run.squadLog) run.squadmates = unplacedLogSquadmates(run, new Set());
  }
  const read = _runs.filter((run) => run.squadReads);
  if (!read.length) return;
  const self = selfNames();
  const known = [...new Set([...getSettings().knownPlayers, ...namesFromLiveRuns()])];
  const resolved = resolveSquadNames(
    read.map((run) => run.squadReads ?? []),
    known,
  );
  const fixesOf = (run: LevelCapRun) => new Map(run.squadFixes?.map((fix) => [fix.slot, fix]));
  // A row ruled out as a player never lends its portrait to a group.
  const portraits = read.flatMap((run) => {
    const fixes = fixesOf(run);
    return (run.squadPortraits ?? []).flatMap((portrait, slot) =>
      portrait && !fixes.get(slot)?.notSquadmate ? [{ key: `${run.id}:${slot}`, portrait }] : [],
    );
  });
  const groups = groupPortraits(portraits, _portraitLabels);
  read.forEach((run, i) => {
    const fixes = fixesOf(run);
    // A logged run's rows can only be the players its log named.
    const own = loggedSquadmates(run, self);
    const names = own.length ? matchRowsToPlayers(run.squadReads ?? [], own) : resolved[i].slots;
    const allPlaced = own.length > 0 && own.every((name) => names.includes(name));
    run.squadmates = names.flatMap((read, slot) => {
      const fix = fixes.get(slot);
      if (fix?.notSquadmate) return [];
      const name = fix?.name ?? read;
      // On a logged run an unnamed row is a companion or nametag once every
      // logged player is placed, or when nothing on it reads as a name.
      const noName = !run.squadReads?.[slot]?.some((raw) => cleanSquadRead(raw));
      if (own.length && name === null && !fix && (allPlaced || noName)) return [];
      const group = groups.get(`${run.id}:${slot}`);
      return [
        {
          name,
          portrait: group?.group ?? null,
          frame:
            fix?.frame ??
            logFrame(run, name, false) ??
            group?.frame ??
            logFrame(run, name, true) ??
            null,
          slot,
        },
      ];
    });
    // Fixes past the rows read are squadmates the reader missed outright.
    const readRows = names.length;
    for (const fix of run.squadFixes ?? []) {
      if (fix.slot < readRows || fix.notSquadmate) continue;
      run.squadmates.push({
        name: fix.name ?? null,
        portrait: null,
        frame: fix.frame ?? null,
        slot: fix.slot,
      });
    }
    const placed = new Set(run.squadmates.flatMap((mate) => (mate.name ? [mate.name] : [])));
    run.squadmates.push(...unplacedLogSquadmates(run, placed));
    if (run.players?.length && !run.playersFromScreenshot) return;
    const players = [...new Set(run.squadmates.flatMap((mate) => (mate.name ? [mate.name] : [])))];
    if (players.length) {
      run.players = players;
      run.playersFromScreenshot = true;
    } else {
      delete run.players;
      delete run.playersFromScreenshot;
    }
    if (run.source === "import" && run.squadReads?.length) {
      run.squadSize = run.squadmates.length + 1;
    }
  });
}

function save(): void {
  resolveScreenshotSquads();
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

/** Runs without an Exolizer count whose screenshot has not been read for it yet:
 *  imports, and hotkey runs from a squad client's log, which never has the count. */
export function runsAwaitingExolizerRead(): Array<{ id: string; screenshot: string }> {
  ensureLoaded();
  return _runs.flatMap((run) =>
    run.exolizers === null && !run.exolizerOcr && run.screenshot
      ? [{ id: run.id, screenshot: run.screenshot }]
      : [],
  );
}

/** Stores what the screenshot said; a failed read is remembered so it is not retried. */
export function recordExolizerRead(
  id: string,
  read: { exolizers: number; rounds: number | null } | null,
): LevelCapRun | null {
  return updateRun(id, (run) => {
    if (!read) {
      run.exolizerOcr = "unreadable";
      return;
    }
    run.exolizerOcr = "read";
    run.exolizers = read.exolizers;
    if (read.rounds !== null && run.rounds == null) run.rounds = read.rounds;
  });
}

// 2: a snip cut close on the right no longer loses every slot disk.
const SQUAD_READER = 2;

/** An older reader found rows but not one portrait beside them. */
function squadReadIsStale(run: LevelCapRun): boolean {
  const portraits = run.squadPortraits;
  return (
    (run.squadReader ?? 1) < SQUAD_READER &&
    !!portraits?.length &&
    portraits.every((portrait) => portrait === null)
  );
}

/** Runs with a screenshot whose squad list, names and portraits, has not been
 *  read yet. Runs read before portraits were kept are read again, and so are
 *  runs an older reader found no portraits on. */
export function runsAwaitingSquadRead(): Array<{ id: string; screenshot: string }> {
  ensureLoaded();
  return _runs.flatMap((run) =>
    run.screenshot &&
    run.squadOcr !== "unreadable" &&
    (!run.squadPortraits || squadReadIsStale(run))
      ? [{ id: run.id, screenshot: run.screenshot }]
      : [],
  );
}

/** Screenshot runs read before row positions were kept. */
export function runsAwaitingSquadRows(): Array<{ id: string; screenshot: string }> {
  ensureLoaded();
  return _runs.flatMap((run) =>
    run.screenshot && run.squadOcr === "read" && run.squadReads && !run.squadRows
      ? [{ id: run.id, screenshot: run.screenshot }]
      : [],
  );
}

/** Takes only the row positions from a fresh read, and only when it found the
 *  same rows as the saved read: fixes are pinned to rows by their order. */
export function recordSquadRows(id: string, read: SquadScreenshotRead | null): void {
  updateRun(id, (run) => {
    const same =
      !!read &&
      !!read.rows &&
      JSON.stringify(normalizeSquadReads(read.names)) === JSON.stringify(run.squadReads);
    run.squadRows = same ? normalizeSquadRows(read.rows ?? []) : [];
  });
}

/** Keeps the raw reads and portraits; who and what they are is worked out on
 *  every save. A failed read is remembered so it is not retried. */
export function recordSquadRead(id: string, read: SquadScreenshotRead | null): LevelCapRun | null {
  return updateRun(id, (run) => {
    run.squadOcr = read ? "read" : "unreadable";
    run.squadReader = SQUAD_READER;
    if (read?.rows) run.squadRows = normalizeSquadRows(read.rows);
    if (!read) return;
    run.squadReads = normalizeSquadReads(read.names);
    run.squadPortraits = read.portraits.slice(0, 4);
    read.thumbs.forEach((thumb, slot) => {
      if (thumb) writePortraitThumb(`${run.id}-${slot}.png`, thumb);
    });
  });
}

function writePortraitThumb(name: string, png: Buffer): void {
  try {
    fs.mkdirSync(userDataPath(PORTRAIT_DIR), { recursive: true });
    fs.writeFileSync(userDataPath(PORTRAIT_DIR, name), png);
  } catch (err) {
    log.warn("[LevelCap] portrait not saved:", normalizeErrorMessage(err));
  }
}

/** The thumbnail saved beside a squad row when it was read, if there is one. */
export function portraitThumb(id: string, slot: number): Buffer | null {
  if (!/^[\w-]+$/.test(id) || !Number.isInteger(slot) || slot < 0 || slot > 3) return null;
  try {
    return fs.readFileSync(userDataPath(PORTRAIT_DIR, `${id}-${slot}.png`));
  } catch {
    return null;
  }
}

/** Names a portrait's frame; every portrait like it, past and future, follows. */
export function labelPortrait(portrait: string, frame: string): void {
  ensureLoaded();
  if (!isPortrait(portrait)) return;
  _portraitLabels = _portraitLabels.filter((label) => label.portrait !== portrait);
  if (frame.trim()) _portraitLabels.push({ portrait, frame: frame.trim().slice(0, 64) });
  save();
}

/** Sets or, with null, clears the correction on one squad row of a run. */
export function fixSquadmate(
  id: string,
  slot: number,
  fix: Omit<LevelCapSquadFix, "slot"> | null,
): LevelCapRun | null {
  return updateRun(id, (run) => {
    const clean = fix && normalizeSquadFix({ ...fix, slot });
    const kept = (run.squadFixes ?? []).filter((f) => f.slot !== slot);
    const next = clean ? [...kept, clean].sort((a, b) => a.slot - b.slot) : kept;
    if (next.length) run.squadFixes = next;
    else delete run.squadFixes;
  });
}

/** Keeps a squad mission's EE.log lines: the log's squad lines are not parsed
 *  yet, and real samples are what that parser will be written against. */
export function saveSquadLog(text: string): void {
  try {
    const dir = userDataPath(SQUAD_LOG_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${formatId(new Date())}.log`), text);
    const logs = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".log"))
      .sort();
    for (const old of logs.slice(0, Math.max(0, logs.length - MAX_SQUAD_LOGS))) {
      fs.rmSync(path.join(dir, old), { force: true });
    }
  } catch (err) {
    log.warn("[LevelCap] squad log not saved:", normalizeErrorMessage(err));
  }
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

export function getFrameIcons(): Record<string, string> {
  ensureLoaded();
  return { ..._frameIcons };
}

/** Pins a frame's icon to a skin; anything but a skin path or the default marker unpins it. */
export function setFrameIcon(frame: string, skin: unknown): void {
  ensureLoaded();
  const clean = frameIcon(skin);
  if (clean) _frameIcons[frame] = clean;
  else delete _frameIcons[frame];
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
    addBuildTags(record, newlyGuessedLevelCapTags(record.build, build));
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

/** Builds from before rivens were captured name the riven but not its stats, and
 * later ones lack the full roll; fill both from the inventory when the lookup is
 * sure which riven it was. `named` is the saved riven's name, when it has one. */
export function backfillRivens(
  find: (weaponType: string, named?: string) => LevelCapRiven | null,
): boolean {
  ensureLoaded();
  let changed = false;
  for (const build of [..._builds.map((b) => b.build), ..._runs.map((r) => r.build)]) {
    for (const item of itemsOf(build)) {
      for (const upgrade of item.upgrades) {
        const partial = upgrade.riven && upgrade.riven.rank === undefined;
        if ((upgrade.riven && !partial) || !isLevelCapRivenType(upgrade.type)) continue;
        const riven = find(item.type, partial ? upgrade.riven?.name : undefined);
        if (!riven || (partial && riven.rank === undefined)) continue;
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
  _frameIcons = {};
  _portraitLabels = [];
  _loaded = false;
}
