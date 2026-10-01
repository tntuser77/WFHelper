import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LevelCapBuild, LevelCapRiven, LevelCapRun } from "../../config/shared/levelCapTypes";

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
      knownPlayers: [],
      playerAliases: {},
    });
  });

  it("saves player aliases and drops ones that point at themselves", async () => {
    const store = await freshStore();
    store.updateSettings({ playerAliases: { PoetAlt: "WealthyPoet", Me: "me" } });
    expect(store.getSettings().playerAliases).toEqual({ PoetAlt: "WealthyPoet" });
    // The index keeps the names as the game showed them.
    store.addRun(run({ players: ["Me", "PoetAlt"] }));
    expect(store.getRuns()[0].players).toEqual(["Me", "PoetAlt"]);
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

  it("reads each screenshot without an Exolizer count once", async () => {
    const store = await freshStore();
    const shot = path.join(tmpDir, "shot.png");
    const a = store.addRun(run({ source: "import", exolizers: null, screenshot: shot }));
    const b = store.addRun(run({ source: "import", exolizers: null, screenshot: shot }));
    // A squad client's hotkey run: the log had rounds but no Exolizers.
    const c = store.addRun(run({ exolizers: null, rounds: 27, screenshot: shot }));
    store.addRun(run({ screenshot: shot }));
    expect(store.runsAwaitingExolizerRead().map((r) => r.id)).toEqual([a.id, b.id, c.id]);

    store.recordExolizerRead(a.id, { exolizers: 112, rounds: 29 });
    store.recordExolizerRead(b.id, null);
    store.recordExolizerRead(c.id, { exolizers: 108, rounds: 28 });
    expect(store.runsAwaitingExolizerRead()).toEqual([]);
    const byId = new Map(store.getRuns().map((r) => [r.id, r]));
    expect(byId.get(a.id)).toMatchObject({ exolizers: 112, rounds: 29, exolizerOcr: "read" });
    expect(byId.get(b.id)).toMatchObject({ exolizers: null, exolizerOcr: "unreadable" });
    expect(byId.get(c.id)).toMatchObject({ exolizers: 108, rounds: 27, exolizerOcr: "read" });
  });

  it("names screenshot squads from known players and live runs", async () => {
    const store = await freshStore();
    store.updateSettings({ knownPlayers: ["WealthyPoet"] });
    store.addRun(run({ players: ["Me", "Frozenos"] }));
    store.addRun(run({ players: ["Me", "Kemani"] }));
    const shot = store.addRun(run({ source: "import", squadSize: null, screenshot: "a.png" }));
    const live = store.getRuns().find((r) => r.players?.includes("Kemani"))!;
    expect(store.runsAwaitingSquadRead().map((r) => r.id)).toEqual([shot.id]);

    const names = [["WealthyPoe...2"], ["Frozenosmo"], ["Me"], ["Pawcanale"]];
    store.recordSquadRead(shot.id, { names, portraits: [], thumbs: [] });
    const read = store.getRuns().find((r) => r.id === shot.id)!;
    // Your own name is in every live run, so it is never offered as a match.
    expect(read).toMatchObject({
      players: ["WealthyPoet", "Frozenos"],
      playersFromScreenshot: true,
      squadOcr: "read",
      squadSize: 5,
    });
    expect(store.runsAwaitingSquadRead()).toEqual([]);
    expect(live.players).toEqual(["Me", "Kemani"]);
  });

  it("groups squad portraits across runs and names them from one label", async () => {
    const store = await freshStore();
    const portrait = (shade: number) => Buffer.alloc(16 * 16 * 3, shade).toString("base64");
    const a = store.addRun(run({ source: "import", squadSize: null, screenshot: "a.png" }));
    const b = store.addRun(run({ source: "import", squadSize: null, screenshot: "b.png" }));
    store.recordSquadRead(a.id, {
      names: [["Kemani"], ["x"]],
      portraits: [portrait(200), portrait(40)],
      thumbs: [Buffer.from("png"), null],
    });
    store.recordSquadRead(b.id, {
      names: [["Kemani"]],
      portraits: [portrait(205)],
      thumbs: [null],
    });
    expect(
      fs.existsSync(path.join(tmpDir, "userData", "level-cap-portraits", `${a.id}-0.png`)),
    ).toBe(true);

    expect(store.portraitThumb(a.id, 0)).toEqual(Buffer.from("png"));
    expect(store.portraitThumb(a.id, 1)).toBeNull();
    expect(store.portraitThumb("../escape", 0)).toBeNull();

    const mates = () => new Map(store.getRuns().map((r) => [r.id, r.squadmates]));
    const [first, second] = [mates().get(a.id)!, mates().get(b.id)!];
    expect(first[0].portrait).toBe(second[0].portrait);
    expect(first[1].portrait).not.toBe(first[0].portrait);
    expect(first.map((m) => m.frame)).toEqual([null, null]);
    expect(second[0].name).toBe("Kemani");

    store.labelPortrait(portrait(202), "Titania Prime");
    expect(
      mates()
        .get(a.id)!
        .map((m) => m.frame),
    ).toEqual(["Titania Prime", null]);
    expect(mates().get(b.id)![0].frame).toBe("Titania Prime");
  });

  it("names squadmates on load from labels added while the app was closed", async () => {
    const file = path.join(tmpDir, "userData", "level-cap-runs.json");
    const portrait = Buffer.alloc(16 * 16 * 3, 200).toString("base64");
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 2,
        portraitLabels: [{ portrait, frame: "Titania" }],
        runs: [
          {
            ...run({ source: "import", squadSize: null, screenshot: "a.png" }),
            id: "a",
            squadReads: [["Kemani"]],
            squadOcr: "read",
            squadPortraits: [portrait],
            squadmates: [{ name: "Kemani", portrait: "a:0", frame: null }],
          },
        ],
      }),
    );
    const store = await freshStore();
    expect(store.getRuns()[0].squadmates?.[0].frame).toBe("Titania");
  });

  it("keeps a run's kill count from the index and drops junk ones", async () => {
    const file = path.join(tmpDir, "userData", "level-cap-runs.json");
    const kills = [1234, 0, -5, 2.5, "99", null];
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 2,
        runs: kills.map((value, i) => ({ ...run(), id: `r${i}`, kills: value })),
      }),
    );
    const store = await freshStore();
    const byId = new Map(store.getRuns().map((r) => [r.id, r]));
    expect(kills.map((_, i) => byId.get(`r${i}`)?.kills)).toEqual([
      1234,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect("kills" in byId.get("r2")!).toBe(false);
  });

  it("applies squad corrections: a frame, a name, and a row that was never a player", async () => {
    const store = await freshStore();
    const portrait = (shade: number) => Buffer.alloc(16 * 16 * 3, shade).toString("base64");
    const a = store.addRun(run({ source: "import", squadSize: null, screenshot: "a.png" }));
    store.recordSquadRead(a.id, {
      names: [["62%"], ["Kemani"], ["x"]],
      portraits: [portrait(10), portrait(200), null],
      thumbs: [null, null, null],
    });
    store.labelPortrait(portrait(200), "Titania");
    store.fixSquadmate(a.id, 0, { notSquadmate: true });
    store.fixSquadmate(a.id, 2, { name: "Clapher", frame: "Cyte-09" });
    store.fixSquadmate(a.id, 1, { frame: "Gauss" });
    let fixed = store.getRuns().find((r) => r.id === a.id)!;
    expect(fixed.squadmates?.map((m) => [m.name, m.frame])).toEqual([
      [null, "Gauss"],
      ["Clapher", "Cyte-09"],
    ]);
    expect(fixed.players).toEqual(["Clapher"]);
    expect(fixed.squadSize).toBe(3);

    // Clearing a correction hands the row back to what the screenshot says.
    store.fixSquadmate(a.id, 1, null);
    fixed = store.getRuns().find((r) => r.id === a.id)!;
    expect(fixed.squadmates?.[0].frame).toBe("Titania");
  });

  it("adds a squadmate the screenshot read missed", async () => {
    const store = await freshStore();
    const a = store.addRun(run({ source: "import", squadSize: null, screenshot: "a.png" }));
    store.recordSquadRead(a.id, { names: [["Kemani"]], portraits: [null], thumbs: [null] });
    store.fixSquadmate(a.id, 1, { name: "xSavxage", frame: "Operator" });
    // A row past the ones read only counts once it names someone or something.
    store.fixSquadmate(a.id, 2, { notSquadmate: true });
    const fixed = store.getRuns().find((r) => r.id === a.id)!;
    expect(fixed.squadmates?.map((m) => [m.name, m.frame])).toEqual([
      [null, null],
      ["xSavxage", "Operator"],
    ]);
    expect(fixed.squadSize).toBe(3);
    expect(fixed.players).toEqual(["xSavxage"]);
  });

  it("names a logged run's rows from its own log, and gives them the log's frames", async () => {
    const store = await freshStore();
    const portrait = (shade: number) => Buffer.alloc(16 * 16 * 3, shade).toString("base64");
    const a = store.addRun(
      run({
        screenshot: "a.png",
        players: ["Me", "Host", "Joiner", "Quiet"],
        squadLog: [
          { name: "Host", slot: 1, host: true, frame: "Inaros", frameGuess: true },
          { name: "Me", slot: 2, you: true },
          { name: "Joiner", slot: 3, frame: "Ember" },
          { name: "Quiet", slot: 4 },
        ],
      }),
    );
    store.recordSquadRead(a.id, {
      names: [["Foxy [30]"], ["Hosl ne"], ["Jolner"]],
      portraits: [null, portrait(10), portrait(200)],
      thumbs: [null, null, null],
    });
    store.labelPortrait(portrait(10), "Nidus");
    store.labelPortrait(portrait(200), "Saryn");
    const fixed = store.getRuns().find((r) => r.id === a.id)!;
    // A labelled portrait beats the host's guessed frame; a loaded one beats the
    // portrait; the player no row showed still counts, without a slot.
    expect(fixed.squadmates?.map((m) => [m.name, m.frame, m.slot])).toEqual([
      ["Host", "Nidus", 1],
      ["Joiner", "Ember", 2],
      ["Quiet", null, undefined],
    ]);
    expect(fixed.players).toEqual(["Me", "Host", "Joiner", "Quiet"]);
  });

  it("gives a logged run with no screenshot its squad from the log", async () => {
    const store = await freshStore();
    const a = store.addRun(
      run({
        players: ["Me", "Joiner"],
        squadLog: [
          { name: "Me", slot: 1, host: true, you: true },
          { name: "Joiner", slot: 2, frame: "Mesa" },
        ],
      }),
    );
    store.updateRun(a.id, () => {});
    expect(store.getRuns()[0].squadmates).toEqual([
      { name: "Joiner", portrait: null, frame: "Mesa" },
    ]);
  });

  it("counts a run as solo once every squad row is ruled out", async () => {
    const store = await freshStore();
    const a = store.addRun(run({ source: "import", squadSize: null, screenshot: "a.png" }));
    store.recordSquadRead(a.id, { names: [["Djinn"]], portraits: [null], thumbs: [null] });
    store.fixSquadmate(a.id, 0, { notSquadmate: true });
    const fixed = store.getRuns().find((r) => r.id === a.id)!;
    expect(fixed.squadmates).toEqual([]);
    expect(fixed.squadSize).toBe(1);
    expect(fixed.players).toBeUndefined();
  });

  it("learns where squad rows sit, but only off a read that matches the saved one", async () => {
    const file = path.join(tmpDir, "userData", "level-cap-runs.json");
    const shot = (id: string) => ({
      ...run({ source: "import", squadSize: null, screenshot: `${id}.png` }),
      id,
      squadOcr: "read",
      squadReads: [["Kemani"], ["Alaric"]],
      squadPortraits: [null, null],
      squadReader: 2,
    });
    fs.writeFileSync(
      file,
      JSON.stringify({ schemaVersion: 2, runs: [shot("same"), shot("moved")] }),
    );
    const store = await freshStore();
    expect(store.runsAwaitingSquadRows().map((r) => r.id)).toEqual(["same", "moved"]);
    const rows = [
      { top: 0.2, bottom: 0.23 },
      { top: 0.26, bottom: 0.29 },
    ];
    const read = { names: [["Kemani"], ["Alaric"]], portraits: [null, null], thumbs: [null, null] };
    store.recordSquadRows("same", { ...read, rows });
    // A read that found other rows would put the highlight on the wrong player.
    store.recordSquadRows("moved", { ...read, names: [["Kemani"]], rows: rows.slice(0, 1) });
    const byId = new Map(store.getRuns().map((r) => [r.id, r]));
    expect(byId.get("same")?.squadRows).toEqual(rows);
    expect(byId.get("moved")?.squadRows).toEqual([]);
    expect(store.runsAwaitingSquadRows()).toEqual([]);
  });

  it("reads a squad again once when an older reader found no portraits", async () => {
    const file = path.join(tmpDir, "userData", "level-cap-runs.json");
    const portrait = Buffer.alloc(16 * 16 * 3, 90).toString("base64");
    const shot = (id: string, portraits: Array<string | null>) => ({
      ...run({ source: "import", squadSize: null, screenshot: `${id}.png` }),
      id,
      squadOcr: "read",
      squadReads: portraits.map(() => ["Kemani"]),
      squadPortraits: portraits,
    });
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 2,
        runs: [shot("blank", [null, null]), shot("seen", [portrait, null]), shot("solo", [])],
      }),
    );
    const store = await freshStore();
    expect(store.runsAwaitingSquadRead().map((r) => r.id)).toEqual(["blank"]);
    // The new reader has had its go; a second blank read is final.
    store.recordSquadRead("blank", { names: [["Kemani"]], portraits: [null], thumbs: [null] });
    expect(store.runsAwaitingSquadRead()).toEqual([]);
  });

  it("cleans build tags and frame notes on the way in", async () => {
    const store = await freshStore();
    const { buildId } = store.addRun(run({ build: BUILD }));
    store.updateBuild(buildId!, { tags: ["melee", " Melee ", "caster", 7] as string[] });
    store.setFrameNotes("Dante", "  comfy\u0007 frame  ");
    expect(store.getBuilds()[0].tags).toEqual(["melee", "caster"]);
    expect(store.getFrameNotes()).toEqual({ Dante: "comfy frame" });
    store.setFrameNotes("Dante", "   ");
    expect(store.getFrameNotes()).toEqual({});
    store.setFrameIcon("Dante", "/Lotus/Upgrades/Skins/Pagemaster/PagemasterDeluxeSkin");
    store.setFrameIcon("Nezha", "default");
    store.setFrameIcon("Mesa", "https://example.com/skin.png");
    expect(store.getFrameIcons()).toEqual({
      Dante: "/Lotus/Upgrades/Skins/Pagemaster/PagemasterDeluxeSkin",
      Nezha: "default",
    });
    store.setFrameIcon("Nezha", null);
    expect(store.getFrameIcons()).toEqual({
      Dante: "/Lotus/Upgrades/Skins/Pagemaster/PagemasterDeluxeSkin",
    });
    store.updateBuild(buildId!, { tags: [] });
    expect(store.getBuilds()[0].tags).toBeUndefined();
  });

  it("files a new run under the frame's build with the same loadout", async () => {
    const store = await freshStore();
    const first = store.addRun(run({ build: BUILD }));
    const second = store.addRun(run({ build: structuredClone(BUILD) }));
    const other = store.addRun(run({ build: { ...BUILD, focus: "madurai" } }));
    expect(second.buildId).toBe(first.buildId);
    expect(other.buildId).not.toBe(first.buildId);
    expect(store.getBuilds().map((b) => b.name)).toEqual(["Build A", "Build B"]);
  });

  it("fills Incarnon perks into a build saved before they were read", async () => {
    const store = await freshStore();
    const gun = { kind: "secondary" as const, type: "/Laetum", config: 0, upgrades: [] };
    const first = store.addRun(run({ build: { ...BUILD, secondary: gun } }));
    const second = store.addRun(
      run({ build: { ...BUILD, secondary: { ...gun, incarnon: [0, 1, 2, 0, 1] } } }),
    );
    expect(second.buildId).toBe(first.buildId);
    const saved = store.getBuilds().find((b) => b.id === first.buildId);
    expect(saved?.build.secondary?.incarnon).toEqual([0, 1, 2, 0, 1]);
    // Perks already on the build are the player's and stay.
    store.addRun(run({ build: { ...BUILD, secondary: { ...gun, incarnon: [0, 0, 0] } } }));
    expect(store.getBuilds()[0].build.secondary?.incarnon).toEqual([0, 1, 2, 0, 1]);
  });

  it("editing a build rewrites every run that uses it", async () => {
    const store = await freshStore();
    const a = store.addRun(run({ build: BUILD }));
    const b = store.addRun(run({ build: BUILD }));
    const caster: LevelCapBuild = { ...BUILD, focus: "zenurik" };
    store.updateBuild(a.buildId!, { name: "Caster", build: caster });
    const runs = store.getRuns();
    expect(runs.map((r) => r.build?.focus)).toEqual(["zenurik", "zenurik"]);
    expect(runs.map((r) => r.buildId)).toEqual([a.buildId, b.buildId]);
    expect(store.getBuilds()[0].name).toBe("Caster");
  });

  it("migrates a version 1 index into named builds and keeps a copy of it", async () => {
    const file = path.join(tmpDir, "userData", "level-cap-runs.json");
    const other: LevelCapBuild = { ...BUILD, focus: "madurai" };
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        runs: [
          { ...run({ build: BUILD, tags: ["caster"], completedAt: 1 }), id: "a" },
          { ...run({ build: BUILD, tags: ["comfy"], completedAt: 2 }), id: "b" },
          { ...run({ build: other, buildUnverified: true, tags: ["?"], completedAt: 3 }), id: "c" },
        ],
      }),
    );
    const store = await freshStore();
    const builds = store.getBuilds();
    expect(builds.map((b) => [b.name, b.tags])).toEqual([
      // Vazarin focus guesses Vaz Dash when the build is made; run tags follow.
      ["Build A", ["Vaz Dash", "caster", "comfy"]],
      // A guessed loadout gets a build but keeps its tags until it is confirmed.
      ["Build B", undefined],
    ]);
    const byId = new Map(store.getRuns().map((r) => [r.id, r]));
    expect(byId.get("a")?.tags).toBeUndefined();
    expect(byId.get("c")).toMatchObject({ buildId: builds[1].id, buildUnverified: true });
    expect(byId.get("c")?.tags).toEqual(["?"]);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).schemaVersion).toBe(5);
    const legacy = JSON.parse(fs.readFileSync(file.replace(".json", ".v1.json"), "utf8"));
    expect(legacy.schemaVersion).toBe(1);
  });

  it("guesses tags on version 2 builds once, keeping the player's own", async () => {
    const file = path.join(tmpDir, "userData", "level-cap-runs.json");
    const build = (id: string, tags?: string[]) => ({
      id,
      frame: "Dante",
      name: id,
      tags,
      build: BUILD,
    });
    fs.writeFileSync(
      file,
      JSON.stringify({ schemaVersion: 2, builds: [build("a", ["vaz dash", "Slam"]), build("b")] }),
    );
    const store = await freshStore();
    expect(store.getBuilds().map((b) => b.tags)).toEqual([["vaz dash", "Slam"], ["Vaz Dash"]]);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).schemaVersion).toBe(5);
    expect(fs.existsSync(file.replace(".json", ".v2.json"))).toBe(true);
  });

  it("a version 3 index only gets the tags of rules added since", async () => {
    const file = path.join(tmpDir, "userData", "level-cap-runs.json");
    const magistar: LevelCapBuild = {
      ...BUILD,
      melee: {
        kind: "melee",
        type: "/Lotus/Weapons/Tenno/Melee/Maces/PaladinMace/PaladinMaceWeapon",
        config: 0,
        upgrades: [],
      },
    };
    // Vaz Dash was guessed at version 3 and removed by hand; it stays off.
    const builds = [{ id: "a", frame: "Dante", name: "a", build: magistar }];
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 3, builds }));
    const store = await freshStore();
    expect(store.getBuilds()[0].tags).toEqual(["Slam"]);
  });

  it("a loadout change adds only the tags it newly implies", async () => {
    const store = await freshStore();
    const record = store.createBuild("Dante", BUILD, "Caster");
    expect(record.tags).toEqual(["Vaz Dash"]);
    // Removed by hand: a later loadout that is still Vazarin leaves it off.
    store.updateBuild(record.id, { tags: [] });
    const huras: LevelCapBuild = {
      ...BUILD,
      companion: {
        kind: "companion",
        type: "/Lotus/Types/Game/KubrowPet/FurtiveKubrowPetPowerSuit",
        config: 0,
        upgrades: [],
      },
    };
    expect(store.updateBuild(record.id, { build: huras })?.tags).toEqual(["Invisible"]);
  });

  it("fills in riven stats on builds saved before rivens were captured", async () => {
    const store = await freshStore();
    const RIVEN = "/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare";
    const AKARIUS = "/Lotus/Weapons/Tenno/Pistols/PrimeAkarius/PrimeAkariusWeapon";
    const withRiven: LevelCapBuild = {
      ...BUILD,
      secondary: {
        kind: "secondary",
        type: AKARIUS,
        config: 0,
        upgrades: [{ slot: 1, type: RIVEN, rank: 8 }],
      },
    };
    store.addRun(run({ build: withRiven }));
    const riven = {
      name: "Akarius Critacan",
      stats: [{ name: "Critical Chance", value: 120, positive: true, multiplier: false }],
    };
    expect(store.backfillRivens((type) => (type === AKARIUS ? riven : null))).toBe(true);
    expect(store.getBuilds()[0].build.secondary?.upgrades[0].riven).toEqual(riven);
    expect(store.getRuns()[0].build?.secondary?.upgrades[0].riven).toEqual(riven);
    // Already filled, so a second pass changes nothing.
    expect(store.backfillRivens(() => riven)).toBe(false);
  });

  it("upgrades a riven saved without its full roll when the inventory has it", async () => {
    const store = await freshStore();
    const stat = { name: "Critical Chance", value: 120, positive: true, multiplier: false };
    const melee = (riven: LevelCapRiven) => ({
      kind: "melee" as const,
      type: "/Magistar",
      config: 0,
      upgrades: [{ slot: 1, type: "/Mods/Randomized/X", rank: 8, riven }],
    });
    store.addRun(
      run({ build: { ...BUILD, melee: melee({ name: "Magistar Toxicron", stats: [stat] }) } }),
    );
    const full = {
      name: "Magistar Toxicron",
      rank: 8,
      disposition: 1.25,
      stats: [{ ...stat, tag: "WeaponCritChanceMod", raw: 1.2 }],
    };
    // Another riven for the weapon is not the one saved.
    expect(store.backfillRivens((_t, named) => (named === "Magistar Other" ? full : null))).toBe(
      false,
    );
    expect(store.backfillRivens((_t, named) => (named === full.name ? full : null))).toBe(true);
    expect(store.getBuilds()[0].build.melee?.upgrades[0].riven).toEqual(full);
    expect(store.backfillRivens(() => full)).toBe(false);
  });

  it("deleting a build sends its runs back to needing one", async () => {
    const store = await freshStore();
    const a = store.addRun(run({ build: BUILD }));
    expect(store.deleteBuild(a.buildId!)).toBe(true);
    expect(store.getRuns()[0]).toMatchObject({ build: BUILD, buildUnverified: true });
    expect(store.getRuns()[0].buildId).toBeUndefined();
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

  it("assigning a build confirms the run and moves its tags onto the build", async () => {
    const store = await freshStore();
    const a = store.addRun(run({ buildUnverified: true, tags: ["caster"] }));
    const b = store.addRun(run({ buildUnverified: true }));
    const target = store.createBuild("Dante", BUILD, "Caster");
    store.assignBuild([a.id], target.id);
    const byId = new Map(store.getRuns().map((r) => [r.id, r]));
    expect(byId.get(a.id)).toMatchObject({ buildId: target.id, frameType: BUILD.suit!.type });
    expect(byId.get(a.id)?.buildUnverified).toBeUndefined();
    expect(byId.get(a.id)?.tags).toBeUndefined();
    expect(store.getBuilds()[0].tags).toEqual(["Vaz Dash", "caster"]);
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
