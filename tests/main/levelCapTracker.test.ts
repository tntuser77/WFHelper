import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LevelCapHotkeyOutcome } from "../../config/shared/levelCapTypes";
import { DANTE_SUIT_ID, levelCapInventory } from "../fixtures/levelcap/inventory";

let tmpDir: string;

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(tmpDir, name),
  },
}));

type Tracker = typeof import("../../services/levelCapTracker");
type Store = typeof import("../../services/levelCapStore");

const NAMES: Record<string, string> = {
  "/Lotus/Powersuits/Pagemaster/Pagemaster": "Dante",
  "/Lotus/Powersuits/Nezha/NezhaPrime": "Nezha Prime",
};

let outcomes: LevelCapHotkeyOutcome[];
let captureResult: Buffer | null;

async function setup(): Promise<{ tracker: Tracker; store: Store }> {
  const store = await import("../../services/levelCapStore");
  const tracker = await import("../../services/levelCapTracker");
  store.__resetLevelCapStoreForTest();
  tracker.__resetLevelCapTrackerForTest();
  tracker.initLevelCapTracker({
    getInventory: () => levelCapInventory(),
    frameName: (type) => NAMES[type] ?? type,
    capture: async () => captureResult,
    onChanged: () => {},
    onHotkey: (outcome) => outcomes.push(outcome),
  });
  return { tracker, store };
}

const feed = (tracker: Tracker, lines: string[]) =>
  lines.forEach((line) => tracker.processLevelCapLine(line, "file"));

const START = [
  "10.0 Script [Info]: ThemedSquadOverlay.lua: Mission name: Tuvul Commons (Zariman) - THE STEEL PATH",
  "11.0 Game [Info]: Player1\uE000 loadout loader finished.",
  "12.0 Game [Info]: OnStateStarted, mission type=MT_VOID_CASCADE",
];
const exo = (ts: number, n: number) =>
  `${ts}.0 Script [Info]: ZarimanSurvivalMission.lua: Zariman Survival (Void Cascade): Pillars used increased to: ${n}`;
const END = (ts: number, heavy: boolean) => [
  `${ts}.0 Script [Info]: TopMenu.lua: Abort: host/no session`,
  `${ts}.0 Sys [Info]: EOM missionLocationUnlocked=1`,
  `${ts}.0 Sys [Info]: Weapon in slot SUIT_SLOT with ID ${DANTE_SUIT_ID} has gained 900 XP`,
  ...(heavy
    ? [
        `${ts}.0 Sys [Info]: Weapon in slot HEAVY_GUN_SLOT with ID ${"d1".padStart(24, "0")} has gained 69 XP`,
      ]
    : []),
  `${ts + 10}.0 Sys [Info]: later`,
];

/** The hotkey handler is async; let its capture promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "levelcap-tracker-"));
  fs.mkdirSync(path.join(tmpDir, "userData"), { recursive: true });
  outcomes = [];
  captureResult = Buffer.from("png");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("levelCapTracker", () => {
  it("ignores the hotkey outside a Void Cascade", async () => {
    const { tracker, store } = await setup();
    tracker.onLevelCapHotkey();
    await settle();
    expect(outcomes).toEqual([]);
    expect(store.getRuns()).toEqual([]);
  });

  it("refuses a run short of 107 Exolizers", async () => {
    const { tracker, store } = await setup();
    feed(tracker, [...START, exo(100, 54)]);
    tracker.onLevelCapHotkey();
    await settle();
    expect(outcomes).toEqual([{ type: "below-target", exolizers: 54 }]);
    expect(store.getRuns()).toEqual([]);
  });

  it("logs the run with screenshot and build, then fills it in at mission end", async () => {
    const { tracker, store } = await setup();
    feed(tracker, [...START, exo(4000, 108)]);
    tracker.onLevelCapHotkey();
    await settle();
    expect(outcomes[0]).toMatchObject({ type: "logged", frameRuns: 1 });
    const [logged] = store.getRuns();
    expect(logged.frame).toBe("Dante");
    expect(logged.build?.loadoutName).toBe("Cap Dante");
    expect(logged.build?.archgun).toBeNull();
    expect(logged.screenshot && fs.readFileSync(logged.screenshot, "utf8")).toBe("png");
    expect(tracker.getStatus()).toEqual({
      inCascade: true,
      exolizers: 108,
      rounds: null,
      runId: logged.id,
    });

    feed(tracker, [exo(4100, 110), ...END(4212, true)]);
    const [done] = store.getRuns();
    expect(done.exolizers).toBe(110);
    expect(done.durationSec).toBe(4200);
    expect(done.squadSize).toBe(1);
    expect(done.archgunUsed).toBe(true);
    // The archgun gained XP, so it joins the build and every run on it.
    expect(done.build?.archgun).not.toBeNull();
    expect(store.getBuilds().find((b) => b.id === done.buildId)?.build.archgun).toEqual(
      done.build?.archgun,
    );
  });

  it("a second press replaces the screenshot instead of logging again", async () => {
    const { tracker, store } = await setup();
    feed(tracker, [...START, exo(4000, 108)]);
    tracker.onLevelCapHotkey();
    await settle();
    vi.useFakeTimers({ now: Date.now() + 5000 });
    captureResult = Buffer.from("second");
    tracker.onLevelCapHotkey();
    vi.useRealTimers();
    await settle();
    expect(outcomes.map((o) => o.type)).toEqual(["logged", "screenshot-replaced"]);
    expect(store.getRuns()).toHaveLength(1);
    expect(fs.readFileSync(store.getRuns()[0].screenshot!, "utf8")).toBe("second");
  });

  it("reports a failed capture without logging", async () => {
    const { tracker, store } = await setup();
    captureResult = null;
    feed(tracker, [...START, exo(4000, 108)]);
    tracker.onLevelCapHotkey();
    await settle();
    expect(outcomes).toEqual([{ type: "capture-failed" }]);
    expect(store.getRuns()).toEqual([]);
  });

  it("keeps a successful run the hotkey missed, without a screenshot", async () => {
    const { tracker, store } = await setup();
    feed(tracker, [...START, exo(4000, 107), ...END(4100, false)]);
    const [run] = store.getRuns();
    expect(run.source).toBe("mission-end");
    expect(run.screenshot).toBeNull();
    expect(run.frame).toBe("Dante");
    expect(run.archgunUsed).toBe(false);
    expect(run.build?.archgun).toBeNull();
  });

  it("puts the archgun on a missed run's build when it gained XP", async () => {
    const { tracker, store } = await setup();
    feed(tracker, [...START, exo(4000, 107), ...END(4100, true)]);
    const [run] = store.getRuns();
    expect(run.build?.archgun).not.toBeNull();
    expect(store.getBuilds().find((b) => b.id === run.buildId)?.build.archgun).not.toBeNull();
  });

  it("drops a short run the hotkey never logged", async () => {
    const { tracker, store } = await setup();
    feed(tracker, [...START, exo(400, 12), ...END(500, false)]);
    expect(store.getRuns()).toEqual([]);
  });

  it("catches up on a Void Cascade that started before the app", async () => {
    const { tracker, store } = await setup();
    const log = path.join(tmpDir, "EE.log");
    fs.writeFileSync(log, [...START, exo(4000, 108), ""].join("\r\n"));
    tracker.primeLevelCapFromLog(log, fs.statSync(log).size);
    expect(tracker.getStatus()).toMatchObject({ inCascade: true, exolizers: 108 });
    tracker.onLevelCapHotkey();
    await settle();
    expect(outcomes[0]?.type).toBe("logged");
    expect(store.getRuns()).toHaveLength(1);
  });

  it("does not revive or re-log a mission that ended before the app started", async () => {
    const { tracker, store } = await setup();
    const log = path.join(tmpDir, "EE.log");
    fs.writeFileSync(log, [...START, exo(4000, 108), ...END(4100, false), ""].join("\n"));
    tracker.primeLevelCapFromLog(log, fs.statSync(log).size);
    expect(tracker.getStatus().inCascade).toBe(false);
    expect(store.getRuns()).toEqual([]);
  });

  it("logs a squad client's run, which has rounds but no Exolizer count", async () => {
    const { tracker, store } = await setup();
    feed(tracker, [
      ...START,
      "5994.0 Script [Info]: ZarimanSurvivalMission.lua: Gave reward tier 27 at 0",
    ]);
    tracker.onLevelCapHotkey();
    await settle();
    expect(outcomes[0]?.type).toBe("logged");
    expect(store.getRuns()[0]).toMatchObject({ exolizers: null, rounds: 27 });
  });

  it("groups a Prime under its base frame", async () => {
    const { tracker } = await setup();
    expect(tracker.frameGroup("Nezha Prime")).toBe("Nezha");
    expect(tracker.frameGroup("Cyte-09")).toBe("Cyte-09");
  });
});
