import { describe, expect, it } from "vitest";

import { buildLevelCapSnapshot, buildRelicSnapshot } from "../../config/shared/phoneSnapshot";
import { relicGoldReward } from "../../config/shared/relicPlannerView";
import type { LevelCapNamedBuild, LevelCapRun } from "../../config/shared/levelCapTypes";

const NOW = Date.parse("2026-09-29T20:00:00Z");

function relic(name: string, vaulted: boolean) {
  const rewards = [
    { name: "Forma Blueprint", rarity: "Common", urlName: "forma_blueprint", ducats: null },
    { name: `${name} Part`, rarity: "Rare", urlName: `${name.toLowerCase()}_part`, ducats: 100 },
  ];
  return {
    name: `${name} Relic`,
    tier: name.split(" ")[0],
    vaulted,
    qualities: { intact: { rewards }, radiant: { rewards } },
  };
}

describe("buildRelicSnapshot", () => {
  const snapshot = buildRelicSnapshot({
    groups: { "Meso N9": relic("Meso N9", true), "Axi H5": relic("Axi H5", false) },
    owned: {
      "Axi H5": { intact: 3, exceptional: 0, flawless: 1, radiant: 2 },
      "Meso N9": { intact: 0, exceptional: 0, flawless: 0, radiant: 0 },
    },
    price: (urlName) => (urlName === "axi h5_part" ? 55 : null),
    ducats: (reward) => (typeof reward.ducats === "number" ? reward.ducats : null),
    goldReward: relicGoldReward,
    pricesAt: NOW - 60_000,
    now: NOW,
  });

  it("carries every relic by name, with the gold part, prices and owned counts", () => {
    expect(snapshot).toMatchObject({ v: 1, kind: "relics", generatedAt: NOW });
    expect(snapshot.relics.map((r) => r.name)).toEqual(["Axi H5", "Meso N9"]);
    expect(snapshot.relics[0]).toEqual({
      name: "Axi H5",
      tier: "Axi",
      vaulted: false,
      owned: [3, 0, 1, 2],
      gold: "Axi H5 Part",
      rewards: [
        { name: "Forma Blueprint", rarity: "Common", price: null, ducats: null },
        { name: "Axi H5 Part", rarity: "Rare", price: 55, ducats: 100 },
      ],
    });
  });

  it("says null for owned when every count is zero", () => {
    expect(snapshot.relics[1]).toMatchObject({ name: "Meso N9", vaulted: true, owned: null });
  });
});

describe("buildLevelCapSnapshot", () => {
  const build = {
    suit: {
      kind: "suit",
      type: "/Lotus/Powersuits/Dante/Dante",
      config: 0,
      upgrades: [
        { slot: 1, type: "/Lotus/Upgrades/Mods/Adaptation", rank: 10 },
        { slot: 2, type: null, rank: null },
      ],
      helminth: { ability: "/Lotus/Abilities/Roar", index: 3 },
      shards: [{ color: "Violet", type: "/Lotus/Shards/Violet" }],
    },
    primary: {
      kind: "primary",
      type: "/Lotus/Weapons/Torid",
      config: 0,
      upgrades: [
        {
          slot: 0,
          type: "/Lotus/Upgrades/Mods/Randomized/Riven",
          rank: 8,
          riven: { name: "Torid Critacan", stats: [] },
        },
      ],
    },
    secondary: null,
    melee: null,
    archgun: null,
    companion: null,
    focus: "madurai",
  } as LevelCapRun["build"];

  const run = (id: string, completedAt: number, extra: Partial<LevelCapRun> = {}) =>
    ({
      id,
      completedAt,
      frame: "Dante",
      frameType: null,
      source: "hotkey",
      exolizers: 107,
      durationSec: 3600,
      squadSize: 4,
      tile: null,
      archgunUsed: false,
      build: null,
      screenshot: "C:/shots/a.png",
      ...extra,
    }) as LevelCapRun;

  const names: Record<string, string> = {
    "/Lotus/Powersuits/Dante/Dante": "Dante",
    "/Lotus/Upgrades/Mods/Adaptation": "Adaptation",
    "/Lotus/Abilities/Roar": "Roar",
    "/Lotus/Weapons/Torid": "Torid",
  };

  const snapshot = buildLevelCapSnapshot({
    runs: [
      run("old", NOW - 86_400_000, { build, tags: ["slam"], players: ["Me", "WealthyPoet"] }),
      run("new", NOW, {
        buildId: "b1",
        build,
        squadmates: [{ name: "WealthyPoet", portrait: "p1", frame: "Titania" }],
      }),
    ],
    builds: [
      { id: "b1", frame: "Dante", name: "Pillage", tags: ["vaz"], build } as LevelCapNamedBuild,
    ],
    frameNotes: { Dante: "keep pillage up" },
    nameOf: (type) => names[type] ?? null,
    now: NOW,
  });

  it("lists runs newest first, taking tags and the name from a named build", () => {
    expect(snapshot.runs.map((r) => r.id)).toEqual(["new", "old"]);
    expect(snapshot.runs[0]).toMatchObject({
      buildName: "Pillage",
      tags: ["vaz"],
      squad: [{ name: "WealthyPoet", frame: "Titania" }],
    });
    expect(snapshot.runs[1]).toMatchObject({
      buildName: null,
      tags: ["slam"],
      players: ["Me", "WealthyPoet"],
    });
    expect(snapshot.frameNotes).toEqual({ Dante: "keep pillage up" });
  });

  it("turns build paths into names and leaves the screenshot behind", () => {
    expect(snapshot.runs[0].build).toEqual({
      focus: "madurai",
      slots: [
        {
          slot: "suit",
          name: "Dante",
          mods: ["Adaptation"],
          helminth: "Roar",
          shards: ["Violet"],
        },
        { slot: "primary", name: "Torid", mods: ["Torid Critacan"] },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("shots");
  });
});
