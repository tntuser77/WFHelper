import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LevelCapBuild, LevelCapRun } from "../../config/shared/levelCapTypes";

let tmpDir: string;

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(tmpDir, name),
  },
}));

type Store = typeof import("../../services/levelCapStore");

async function freshStore(): Promise<Store> {
  const store = await import("../../services/levelCapStore");
  store.__resetLevelCapStoreForTest();
  return store;
}

const BUILD: LevelCapBuild = {
  suit: { kind: "suit", type: "/Lotus/Powersuits/Pagemaster/Pagemaster", config: 0, upgrades: [] },
  primary: null,
  secondary: null,
  melee: null,
  archgun: null,
  companion: null,
  focus: "vazarin",
};

function run(overrides: Partial<LevelCapRun> = {}): Omit<LevelCapRun, "id"> {
  return {
    completedAt: new Date(2026, 8, 25, 21, 0, 0).getTime(),
    frame: "Dante",
    frameType: null,
    source: "hotkey",
    exolizers: 108,
    durationSec: 3900,
    squadSize: 1,
    tile: null,
    archgunUsed: false,
    build: null,
    screenshot: null,
    ...overrides,
  };
}

function writeImage(file: string, bytes = 4): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "levelcap-"));
  fs.mkdirSync(path.join(tmpDir, "userData"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("levelCapStore", () => {
  it("defaults to F12 with pass-through and the Pictures folder", async () => {
    const store = await freshStore();
    expect(store.getSettings()).toEqual({
      hotkey: "F12",
      passthrough: true,
      screenshotDir: path.join(tmpDir, "pictures", "WarframeCaps"),
      backupDir: "",
    });
  });

  it("persists runs and reloads them newest first", async () => {
    const store = await freshStore();
    store.addRun(run({ completedAt: 1_000 }));
    store.addRun(run({ completedAt: 2_000, frame: "Cyte-09" }));
    store.__resetLevelCapStoreForTest();
    expect(store.getRuns().map((r) => r.frame)).toEqual(["Cyte-09", "Dante"]);
  });

  it("gives runs finished in the same second distinct ids", async () => {
    const store = await freshStore();
    const a = store.addRun(run());
    const b = store.addRun(run());
    expect(a.id).not.toBe(b.id);
    expect(b.id).toBe(`${a.id}-2`);
  });

  it("cleans tags and notes on the way in", async () => {
    const store = await freshStore();
    const { id } = store.addRun(run());
    store.setRunTags(id, ["melee", " Melee ", "caster", 7]);
    store.setRunNotes(id, "  comfy\u0007 run  ");
    const saved = store.getRuns()[0];
    expect(saved.tags).toEqual(["melee", "caster"]);
    expect(saved.notes).toBe("comfy run");
    store.setRunTags(id, []);
    expect(store.getRuns()[0].tags).toBeUndefined();
  });

  it("numbers screenshots after the highest in an existing frame folder", async () => {
    const store = await freshStore();
    const root = store.getSettings().screenshotDir;
    writeImage(path.join(root, "Cyte", "Cyte 1.png"));
    writeImage(path.join(root, "Cyte", "Cyte 10.png"));
    // "Cyte-09" is the game's name; the folder predates the tab and is reused.
    const file = store.saveScreenshot("Cyte-09", Buffer.from("png"));
    expect(file).toBe(path.join(root, "Cyte", "Cyte 11.png"));
    expect(store.saveScreenshot("Gyre", Buffer.from("png"))).toBe(
      path.join(root, "Gyre", "Gyre 1.png"),
    );
  });

  it("imports each screenshot once and flags the guessed build", async () => {
    const store = await freshStore();
    const root = store.getSettings().screenshotDir;
    writeImage(path.join(root, "Dante", "Dante 1.png"));
    writeImage(path.join(root, "Dante", "Dante 2.jpg"));
    writeImage(path.join(root, "Dante", "notes.txt"));
    writeImage(path.join(root, "__pycache__", "sort_caps.png"));
    const resolver = {
      frameForFolder: (folder: string) => ({ frame: folder, frameType: BUILD.suit!.type }),
      buildForFrame: () => BUILD,
    };
    expect(store.importScreenshotFolders(resolver)).toEqual({ imported: 2, skipped: 0 });
    expect(store.importScreenshotFolders(resolver)).toEqual({ imported: 0, skipped: 2 });
    const runs = store.getRuns();
    expect(runs.every((r) => r.buildUnverified && r.source === "import")).toBe(true);
    expect(runs[0].build).toEqual(BUILD);
  });

  it("applying a build clears the unverified flag", async () => {
    const store = await freshStore();
    const a = store.addRun(run({ buildUnverified: true }));
    const b = store.addRun(run({ buildUnverified: true }));
    store.applyBuild([a.id], BUILD, "Dante");
    const byId = new Map(store.getRuns().map((r) => [r.id, r]));
    expect(byId.get(a.id)?.buildUnverified).toBeUndefined();
    expect(byId.get(a.id)?.frameType).toBe(BUILD.suit!.type);
    expect(byId.get(b.id)?.buildUnverified).toBe(true);
  });

  it("mirrors the index and screenshots into the backup folder", async () => {
    const store = await freshStore();
    const backup = path.join(tmpDir, "backup");
    store.updateSettings({ backupDir: backup });
    const shot = store.saveScreenshot("Dante", Buffer.from("png"));
    store.addRun(run({ screenshot: shot }));
    await store.awaitBackupForTest();
    const mirrored = JSON.parse(fs.readFileSync(path.join(backup, "level-cap-runs.json"), "utf8"));
    expect(mirrored.runs).toHaveLength(1);
    expect(fs.existsSync(path.join(backup, "screenshots", "Dante", "Dante 1.png"))).toBe(true);
  });

  it("deleting a run keeps its screenshot", async () => {
    const store = await freshStore();
    const shot = store.saveScreenshot("Dante", Buffer.from("png"));
    const { id } = store.addRun(run({ screenshot: shot }));
    expect(store.deleteRun(id)).toBe(true);
    expect(store.getRuns()).toEqual([]);
    expect(fs.existsSync(shot)).toBe(true);
  });

  it("drops hand-edited entries that lost their shape", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "userData", "level-cap-runs.json"),
      JSON.stringify({ runs: [{ id: "x" }, { ...run(), id: "ok" }], settings: { hotkey: 5 } }),
    );
    const store = await freshStore();
    expect(store.getRuns().map((r) => r.id)).toEqual(["ok"]);
    expect(store.getSettings().hotkey).toBe("F12");
  });
});
