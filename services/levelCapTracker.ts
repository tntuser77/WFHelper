import fs from "node:fs";

import { withScope } from "./logger";
import { createLevelCapParser, isLevelCapLine, type LevelCapMission } from "./levelCapParser";
import { snapshotBuildForFrame, snapshotEquippedBuild, suitTypeForId } from "./levelCapBuild";
import * as store from "./levelCapStore";
import { normalizeErrorMessage } from "../config/shared/errors";
import {
  LEVEL_CAP_EXOLIZER_TARGET,
  type LevelCapBuild,
  type LevelCapHotkeyOutcome,
  type LevelCapRun,
  type LevelCapStatus,
} from "../config/shared/levelCapTypes";

const log = withScope("levelCapTracker");

/** A held key repeats; one run per deliberate press. */
const HOTKEY_DEBOUNCE_MS = 1500;

interface LevelCapDeps {
  getInventory(): unknown;
  /** Display name of a frame path, e.g. "Dante" for /Lotus/Powersuits/Pagemaster/Pagemaster. */
  frameName(type: string): string;
  /** PNG of the game window, or null when capture failed. */
  capture(): Promise<Buffer | null>;
  onChanged(): void;
  onHotkey(outcome: LevelCapHotkeyOutcome): void;
}

let _deps: LevelCapDeps | null = null;
let _parser = createLevelCapParser();
/** Run the hotkey already logged for the mission in progress. */
let _missionRunId: string | null = null;
let _lastHotkeyAt = 0;
let _hotkeyBusy = false;

export function initLevelCapTracker(deps: LevelCapDeps): void {
  _deps = deps;
}

/** Group key: a Prime shares its base frame's row and folder. */
export function frameGroup(name: string): string {
  return name.replace(/\s+Prime$/i, "").trim() || name;
}

function frameOf(build: LevelCapBuild | null): { frame: string; frameType: string | null } {
  const type = build?.suit?.type ?? null;
  return { frame: type && _deps ? frameGroup(_deps.frameName(type)) : "Unknown", frameType: type };
}

export function getStatus(): LevelCapStatus {
  const mission = _parser.current();
  return {
    inCascade: mission !== null,
    exolizers: mission?.exolizers ?? null,
    rounds: mission?.rounds ?? null,
    runId: mission ? _missionRunId : null,
  };
}

function squadSize(mission: LevelCapMission): number | null {
  return mission.players.length || null;
}

function finishMission(mission: LevelCapMission): void {
  const deps = _deps;
  const runId = _missionRunId;
  _missionRunId = null;
  if (!deps) return;
  const durationSec =
    mission.endSec !== null ? Math.max(0, Math.round(mission.endSec - mission.startSec)) : null;
  const archgunUsed = "HEAVY_GUN_SLOT" in mission.gearXp;
  const suitId = mission.gearXp.SUIT_SLOT;
  const playedType = suitId ? suitTypeForId(deps.getInventory(), suitId) : null;

  if (runId) {
    let frameCorrected = false;
    store.updateRun(runId, (run) => {
      run.exolizers = mission.exolizers ?? run.exolizers;
      run.rounds = mission.rounds ?? run.rounds ?? null;
      run.durationSec = durationSec;
      run.squadSize = squadSize(mission) ?? run.squadSize;
      run.tile = mission.tile ?? run.tile;
      run.archgunUsed = archgunUsed;
      // The XP line names the frame that actually played; trust it over the
      // loadout guess taken when the key was pressed.
      if (playedType && playedType !== run.frameType) {
        run.frameType = playedType;
        run.frame = frameGroup(deps.frameName(playedType));
        run.build = snapshotBuildForFrame(deps.getInventory(), playedType) ?? run.build;
        frameCorrected = true;
      }
    });
    if (frameCorrected) store.relinkRun(runId);
    deps.onChanged();
    return;
  }

  // No key press, but the run made it: keep it without a screenshot rather than lose it.
  if ((mission.exolizers ?? 0) < LEVEL_CAP_EXOLIZER_TARGET) return;
  const build = playedType
    ? snapshotBuildForFrame(deps.getInventory(), playedType)
    : snapshotEquippedBuild(deps.getInventory());
  const run = store.addRun({
    completedAt: Date.now(),
    ...frameOf(build),
    source: "mission-end",
    exolizers: mission.exolizers,
    rounds: mission.rounds,
    durationSec,
    squadSize: squadSize(mission),
    tile: mission.tile,
    archgunUsed,
    build,
    screenshot: null,
  });
  log.info(`[LevelCap] ${run.frame} run logged at mission end without a screenshot`);
  deps.onChanged();
}

export function processLevelCapLine(line: string, source: "dbwin" | "file"): void {
  // File-poll lines are complete, ordered and deduped; dbwin duplicates them.
  if (source !== "file") return;
  let changed = false;
  for (const event of _parser.feedLine(line)) {
    if (event.type === "start") {
      _missionRunId = null;
      changed = true;
    } else {
      finishMission(event.mission);
    }
  }
  // Exolizer and round ticks update the live counter in the tab.
  if (changed || line.includes("Pillars used increased to") || line.includes("Gave reward tier")) {
    _deps?.onChanged();
  }
}

/** EE.log bytes the monitor skips at startup still say whether a Void Cascade
 * is under way, so replay them into a fresh parser. Ended missions are dropped
 * rather than finished: they may already be logged, and a restart must not
 * log them twice. `size` is where live reading starts, so no line is fed twice. */
export function primeLevelCapFromLog(filePath: string, size: number): void {
  if (size <= 0) return;
  let text: string;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(size);
      const read = fs.readSync(fd, buffer, 0, size, 0);
      text = buffer.toString("utf8", 0, read);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    log.warn("[LevelCap] could not read EE.log to catch up:", normalizeErrorMessage(err));
    return;
  }
  const parser = createLevelCapParser();
  for (const line of text.split("\n")) {
    if (isLevelCapLine(line)) parser.feedLine(line.replace(/\r$/, ""));
  }
  const mission = parser.current();
  if (!mission) return;
  _parser = parser;
  _missionRunId = null;
  log.info(
    `[LevelCap] joined a Void Cascade already in progress (${mission.exolizers ?? "?"} Exolizers, round ${mission.rounds ?? "?"})`,
  );
}

/** EE.log was truncated (game restart): whatever was open has ended. */
export function notifyLevelCapEeLogReset(): void {
  const mission = _parser.flush();
  if (mission) finishMission(mission);
  _parser = createLevelCapParser();
}

async function handleHotkey(deps: LevelCapDeps): Promise<LevelCapHotkeyOutcome | null> {
  const mission = _parser.current();
  if (!mission) {
    log.info("[LevelCap] finish-run key pressed outside a Void Cascade; ignored");
    return null;
  }
  if (mission.exolizers !== null && mission.exolizers < LEVEL_CAP_EXOLIZER_TARGET) {
    return { type: "below-target", exolizers: mission.exolizers };
  }
  const png = await deps.capture();
  if (!png) return { type: "capture-failed" };

  const existing = _missionRunId && store.getRuns().find((r) => r.id === _missionRunId);
  if (existing) {
    if (existing.screenshot) store.replaceScreenshot(existing.screenshot, png);
    else
      store.updateRun(
        existing.id,
        (run) => (run.screenshot = store.saveScreenshot(run.frame, png)),
      );
    return { type: "screenshot-replaced", run: existing };
  }

  const build = snapshotEquippedBuild(deps.getInventory());
  const { frame, frameType } = frameOf(build);
  const run: LevelCapRun = store.addRun({
    completedAt: Date.now(),
    frame,
    frameType,
    source: "hotkey",
    exolizers: mission.exolizers,
    rounds: mission.rounds,
    durationSec: null,
    squadSize: squadSize(mission),
    tile: mission.tile,
    archgunUsed: false,
    build,
    screenshot: store.saveScreenshot(frame, png),
  });
  _missionRunId = run.id;
  log.info(`[LevelCap] ${frame} run logged by hotkey (${mission.exolizers ?? "?"} Exolizers)`);
  const frameRuns = store.getRuns().filter((r) => r.frame === run.frame).length;
  return { type: "logged", run, frameRuns };
}

/** Bound to the finish-run key; does nothing outside a Void Cascade. */
export function onLevelCapHotkey(): void {
  const deps = _deps;
  const now = Date.now();
  if (!deps || _hotkeyBusy || now - _lastHotkeyAt < HOTKEY_DEBOUNCE_MS) return;
  _lastHotkeyAt = now;
  _hotkeyBusy = true;
  handleHotkey(deps)
    .then((outcome) => {
      if (!outcome) return;
      deps.onHotkey(outcome);
      deps.onChanged();
    })
    .catch((err) => log.warn("[LevelCap] hotkey failed:", normalizeErrorMessage(err)))
    .finally(() => {
      _hotkeyBusy = false;
    });
}

export function __resetLevelCapTrackerForTest(): void {
  _deps = null;
  _parser = createLevelCapParser();
  _missionRunId = null;
  _lastHotkeyAt = 0;
  _hotkeyBusy = false;
}
