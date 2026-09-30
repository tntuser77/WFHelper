import { describe, expect, it } from "vitest";

import type {
  LevelCapBuild,
  LevelCapItem,
  LevelCapRiven,
  LevelCapRun,
} from "../../../config/shared/levelCapTypes.js";
import {
  levelCapBuildKey,
  nextLevelCapBuildName,
  normalizeLevelCapBuild,
} from "../../../config/shared/levelCapBuild.js";
import {
  formatLevelCapDuration,
  levelCapFrames,
  levelCapGearUse,
  levelCapItemImage,
  levelCapItemKey,
  levelCapItemName,
  levelCapPlayerTerms,
  levelCapRunHasPlayer,
  levelCapSearchTerms,
  levelCapSquad,
  levelCapSlotLayout,
  levelCapTagSuggestions,
  levelCapUpgradeRole,
  orderLevelCapTags,
  toggleLevelCapSearchTag,
} from "../../../src/lib/levelCap.js";
import {
  underframeBuild,
  underframeCompanionBuild,
  underframeShareUrl,
} from "../../../src/lib/underframe.js";
import { sanitizeUnderframeBuild } from "../../../config/shared/underframe.js";

/** Share link for one item, the way the Underframe button builds it. */
function underframeUrl(
  item: LevelCapItem,
  name: (type: string) => string | null,
  helminthName?: string | null,
): string | null {
  const build = underframeBuild(item, name, helminthName);
  return build ? underframeShareUrl(build) : null;
}

const SUIT: LevelCapItem = {
  kind: "suit",
  type: "/Lotus/Powersuits/Pagemaster/Pagemaster",
  config: 0,
  upgrades: [
    { slot: 0, type: "/Mods/Intensify", rank: 5 },
    { slot: 8, type: "/Mods/Aura/CorrosiveProjection", rank: 5 },
    { slot: 9, type: "/Mods/Exilus/Sure", rank: 10 },
    { slot: 10, type: "/Lotus/Upgrades/CosmeticEnhancers/Offensive/Molt", rank: 5 },
  ],
  helminth: { ability: "/Rot", index: 3 },
};

function build(suit: LevelCapItem | null): LevelCapBuild {
  return {
    suit,
    primary: null,
    secondary: null,
    melee: null,
    archgun: null,
    companion: null,
    focus: "zenurik",
  };
}

function run(id: string, frame: string, at: number, extra: Partial<LevelCapRun> = {}): LevelCapRun {
  return {
    id,
    completedAt: at,
    frame,
    frameType: null,
    source: "hotkey",
    exolizers: 108,
    durationSec: null,
    squadSize: null,
    tile: null,
    archgunUsed: false,
    build: null,
    screenshot: null,
    ...extra,
  };
}

describe("levelCap helpers", () => {
  it("lists frames most-run first and counts unverified runs", () => {
    const rows = levelCapFrames([
      run("1", "Dante", 1),
      run("2", "Cyte-09", 2, { buildUnverified: true }),
      run("3", "Dante", 3),
    ]);
    expect(rows.map((r) => [r.frame, r.count, r.unverified])).toEqual([
      ["Dante", 2, 0],
      ["Cyte-09", 1, 1],
    ]);
  });

  it("shows the archgun slot only when a build carries one", () => {
    const archgun: LevelCapItem = {
      kind: "archgun",
      type: "/Lotus/Weapons/Archgun/Mausolon",
      config: 0,
      upgrades: [],
    };
    const carried = { ...build(SUIT), archgun };
    const slots = (runs: LevelCapRun[]) => levelCapGearUse(runs).map((g) => g.slot);
    expect(slots([run("1", "Caliban", 1, { build: build(SUIT) })])).not.toContain("archgun");
    const gear = levelCapGearUse([
      run("1", "Caliban", 1, { build: build(SUIT) }),
      run("2", "Caliban", 2, { build: carried }),
    ]);
    expect(gear.find((g) => g.slot === "archgun")?.items).toEqual([
      { item: archgun, count: 1, builds: [{ id: null, count: 1 }], sameMods: true, weapons: [] },
    ]);
  });

  it("counts each slot item per build, most-used first", () => {
    const melee: LevelCapItem = { kind: "melee", type: "/Melee/Magistar", config: 0, upgrades: [] };
    const withMelee = { ...build(SUIT), melee };
    const gear = levelCapGearUse([
      run("1", "Caliban", 1, { build: withMelee, buildId: "a" }),
      run("2", "Caliban", 2, { build: withMelee, buildId: "b" }),
      run("3", "Caliban", 3, { build: withMelee, buildId: "b" }),
    ]);
    expect(gear.find((g) => g.slot === "melee")?.items[0].builds).toEqual([
      { id: "b", count: 2 },
      { id: "a", count: 1 },
    ]);
  });

  it("tells whether a slot item's mods match across builds, and what a companion carried", () => {
    const melee = (rank: number, type = "/Mods/Reach"): LevelCapItem => ({
      kind: "melee",
      type: "/Melee/Magistar",
      config: 0,
      upgrades: [{ slot: 1, type, rank }],
    });
    const weapon: LevelCapItem = {
      kind: "companion",
      type: "/Sentinel/Laser",
      config: 0,
      upgrades: [],
    };
    const pet: LevelCapItem = {
      kind: "companion",
      type: "/Pets/Wyrm",
      config: 0,
      upgrades: [],
      weapon,
    };
    const gear = (a: LevelCapItem, b: LevelCapItem) =>
      levelCapGearUse([
        run("1", "Equinox", 1, {
          build: { ...build(SUIT), melee: a, companion: pet },
          buildId: "a",
        }),
        run("2", "Equinox", 2, {
          build: { ...build(SUIT), melee: b, companion: pet },
          buildId: "b",
        }),
      ]);
    // A rank apart is still the same setup.
    expect(gear(melee(5), melee(3)).find((g) => g.slot === "melee")?.items[0].sameMods).toBe(true);
    const differ = gear(melee(5), melee(5, "/Mods/Fury"));
    expect(differ.find((g) => g.slot === "melee")?.items[0].sameMods).toBe(false);
    expect(differ.find((g) => g.slot === "companion")?.items[0].weapons).toEqual([weapon]);
  });

  it("treats builds that differ only in mod ranks as the same build", () => {
    const reranked = { ...SUIT, upgrades: SUIT.upgrades.map((u) => ({ ...u, rank: 0 })) };
    const other = { ...SUIT, upgrades: [] };
    expect(levelCapBuildKey(build(reranked))).toBe(levelCapBuildKey(build(SUIT)));
    expect(levelCapBuildKey(build(other))).not.toBe(levelCapBuildKey(build(SUIT)));
  });

  it("keeps riven stats and repairs a doubled weapon name", () => {
    const riven = (name: string) => ({
      name,
      stats: [{ name: "Toxin", value: 154.1, positive: true, multiplier: false }],
    });
    const withRiven = (name: string) =>
      normalizeLevelCapBuild({
        ...build(null),
        melee: {
          type: "/Melee/Magistar",
          upgrades: [{ slot: 1, type: "/Mods/Randomized/X", rank: 8, riven: riven(name) }],
        },
      })?.melee?.upgrades[0].riven;
    expect(withRiven("Magistar Magistar Toxicron")).toEqual(riven("Magistar Toxicron"));
    expect(withRiven("Dark Split-Sword Dark Split-Sword Acri")?.name).toBe("Dark Split-Sword Acri");
    expect(withRiven("Magistar Toxicron")?.name).toBe("Magistar Toxicron");
  });

  it("keeps the roll behind a riven, and drops a malformed one", () => {
    const stat = { name: "Toxin", value: 154.1, positive: true, multiplier: false };
    const kept = (riven: object) =>
      normalizeLevelCapBuild({
        ...build(null),
        melee: {
          type: "/Melee/Magistar",
          upgrades: [{ slot: 1, type: "/Mods/Randomized/X", rank: 8, riven }],
        },
      })?.melee?.upgrades[0].riven;
    const full = {
      name: "Magistar Toxicron",
      rank: 8,
      disposition: 1.25,
      stats: [{ ...stat, tag: "WeaponToxinDamageMod", raw: 1.541 }],
    };
    expect(kept(full)).toEqual(full);
    const bad = kept({
      ...full,
      rank: 99,
      disposition: 0,
      stats: [{ ...stat, tag: "X", raw: "1" }],
    });
    expect(bad).toEqual({ name: "Magistar Toxicron", stats: [stat] });
  });

  it("names a new build with the first free letter", () => {
    expect(nextLevelCapBuildName([])).toBe("Build A");
    expect(nextLevelCapBuildName(["Build A", "caster", "build c"])).toBe("Build B");
  });

  it("lays out a frame's mod, aura, exilus and arcane slots", () => {
    const layout = levelCapSlotLayout("suit", SUIT);
    expect(layout).toHaveLength(12);
    expect(layout.slice(8).map((s) => s.role)).toEqual(["aura", "exilus", "arcane", "arcane"]);
    expect(layout[8].compat).toEqual(["AURA"]);
    expect(layout[0].compat).toEqual(["WARFRAME"]);
    expect(levelCapSlotLayout("melee", null)[8].compat).toEqual(["STANCE"]);
  });

  it("suggests tags by how often they are used", () => {
    expect(
      levelCapTagSuggestions([
        run("1", "Dante", 1, { tags: ["caster", "comfy"] }),
        run("2", "Dante", 2, { tags: ["Caster"] }),
      ]),
    ).toEqual(["caster", "comfy"]);
  });

  it("formats durations with hours only when needed", () => {
    expect(formatLevelCapDuration(4212)).toBe("1:10:12");
    expect(formatLevelCapDuration(75)).toBe("1:15");
    expect(formatLevelCapDuration(null)).toBe("");
  });

  it("reads slot roles from the game layout", () => {
    expect(levelCapUpgradeRole("suit", SUIT.upgrades[1])).toBe("aura");
    expect(levelCapUpgradeRole("suit", SUIT.upgrades[2])).toBe("exilus");
    expect(levelCapUpgradeRole("suit", SUIT.upgrades[3])).toBe("arcane");
    expect(
      levelCapUpgradeRole("melee", {
        slot: 8,
        type: "/Lotus/Weapons/Tenno/Melee/MeleeTrees/X",
        rank: 3,
      }),
    ).toBe("stance");
    expect(levelCapUpgradeRole("primary", { slot: 8, type: "/Mods/Vigilante", rank: 5 })).toBe(
      "exilus",
    );
  });
});

const SUIT_SHARD = {
  color: "ACC_BLUE",
  type: "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeEnergyMax",
};

describe("underframeUrl", () => {
  const names: Record<string, string> = {
    [SUIT.type]: "Dante",
    "/Mods/Intensify": "Intensify",
    "/Mods/Aura/CorrosiveProjection": "Corrosive Projection",
    "/Mods/Exilus/Sure": "Primed Sure Footed",
    "/Lotus/Upgrades/CosmeticEnhancers/Offensive/Molt": "Molt Augmented",
  };
  const decode = (url: string) => {
    const token = url.split("#v4u.")[1];
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))),
    );
  };

  it("puts aura and exilus where Underframe expects them and splits out arcanes", () => {
    const url = underframeUrl(SUIT, (type) => names[type] ?? null, "Xata's Whisper");
    expect(url?.startsWith("https://www.underframe.site/share#v4u.")).toBe(true);
    const { v, b } = decode(url!);
    expect(v).toBe(1);
    expect(b.t).toBe("Warframe");
    expect(b.i).toBe("Dante");
    expect(b.m).toHaveLength(10);
    expect(b.m[0]).toEqual({ n: "Corrosive Projection", r: 5 });
    expect(b.m[1]).toEqual({ n: "Primed Sure Footed", r: 10 });
    expect(b.m[2]).toEqual({ n: "Intensify", r: 5 });
    expect(b.a).toEqual(["Molt Augmented"]);
    // Underframe counts abilities from 1; the inventory's index 3 is the fourth.
    expect(b.h).toEqual(["Xata's Whisper", 4]);
  });

  it("carries archon shards by colour and tier", () => {
    const shard = (color: string, type: string) => ({
      color,
      type: `/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/${type}`,
    });
    const built = underframeBuild(
      {
        ...SUIT,
        shards: [
          shard("ACC_RED_MYTHIC", "ArchonCrystalUpgradeWarframeAbilityStrengthMythic"),
          shard("ACC_BLUE", "ArchonCrystalUpgradeWarframeEnergyMax"),
        ],
      },
      (type) => names[type] ?? null,
    );
    expect(built?.archon_shards).toEqual([
      { type: "crimson", effect: expect.stringContaining("Ability Strength"), isTaufurged: true },
      { type: "azure", effect: "+50 Energy Max", isTaufurged: false },
    ]);
    const { b } = decode(
      underframeUrl({ ...SUIT, shards: [SUIT_SHARD] }, (t) => names[t] ?? null)!,
    );
    expect(b.as).toEqual([["azure", "+50 Energy Max"]]);
  });

  it("keeps a gun's exilus last, where Underframe puts it", () => {
    const gun: LevelCapItem = {
      kind: "primary",
      type: "/Soma",
      config: 0,
      upgrades: [
        { slot: 0, type: "/Mods/Serration", rank: 10 },
        { slot: 8, type: "/Mods/Vigilante", rank: 5 },
      ],
    };
    const built = underframeBuild(gun, (type) => type.split("/").pop() ?? null);
    expect(built?.type).toBe("Primary");
    expect(built?.mods).toHaveLength(9);
    expect(built?.mods[0]).toEqual({ name: "Serration", rank: 10 });
    expect(built?.mods[8]).toEqual({ name: "Vigilante", rank: 5 });
    expect(built?.helminth).toBeUndefined();
    expect(built?.incarnon).toBeUndefined();
  });

  it("turns a riven into its unscaled stats and keeps it out of share links", () => {
    const melee = (riven: LevelCapRiven): LevelCapItem => ({
      kind: "melee",
      type: "/Magistar",
      config: 0,
      upgrades: [
        { slot: 0, type: "/Mods/Randomized/PlayerMeleeWeaponRandomModRare", rank: 8, riven },
      ],
    });
    const stat = (tag: string, raw: number, positive = true) => ({
      name: tag,
      value: raw * 100,
      positive,
      multiplier: false,
      tag,
      raw,
    });
    const rolled = melee({
      name: "Magistar Toxicron",
      rank: 8,
      disposition: 1.25,
      stats: [
        stat("WeaponCritChanceMod", 1.25),
        stat("WeaponMeleeDamageMod", 0.5),
        stat("WeaponProcTimeMod", 0.25, false),
        stat("WeaponUnknownMod", 0.1),
      ],
    });
    const name = (type: string) => type.split("/").pop() ?? null;
    const built = underframeBuild(rolled, name);
    // Rank 8 leaves only the disposition: 1.25 / 1.25 = 1, and a curse goes negative.
    expect(built?.mods[2]?.riven).toEqual({
      rank: 8,
      disposition: 1.25,
      stats: [
        { name: "Critical Chance", value: 1 },
        { name: "Melee Damage", value: 0.4 },
        { name: "Status Duration", value: -0.2 },
      ],
    });
    expect(decode(underframeUrl(rolled, name)!).b.m).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    // Captures from before the roll was kept in full leave the slot as a plain mod.
    const old = underframeBuild(melee({ name: "Magistar Toxicron", stats: [] }), name);
    expect(old?.mods[2]?.riven).toBeUndefined();
  });

  it("sends Incarnon perks counted from 1, null past the last unlocked", () => {
    const gun: LevelCapItem = {
      kind: "secondary",
      type: "/Laetum",
      config: 0,
      upgrades: [],
      incarnon: [0, 1, 2],
    };
    const name = (type: string) => type.slice(1);
    expect(underframeBuild(gun, name)?.incarnon).toEqual({
      evolution_1_active: true,
      evolution_2_perk: 2,
      evolution_3_perk: 3,
      evolution_4_perk: null,
      evolution_5_perk: null,
    });
    expect(decode(underframeUrl(gun, name)!).b.ic).toEqual([1, 2, 3, null, null]);
  });

  it("lends a companion's bond mods as a partner build", () => {
    const pet = (type: string): LevelCapItem => ({
      kind: "companion",
      type,
      config: 0,
      upgrades: [
        { slot: 0, type: "/Mods/TenaciousBond", rank: 10 },
        { slot: 3, type: "/Mods/Unknown", rank: 1 },
      ],
    });
    const name = (type: string) => (type === "/Mods/Unknown" ? null : type.split("/").pop()!);
    expect(
      underframeCompanionBuild(pet("/Lotus/Types/Friendly/Pets/Catbrow/Smeeta"), name),
    ).toEqual({
      name: "Smeeta (Level Cap)",
      type: "Beast",
      itemName: "Smeeta",
      mods: [{ name: "TenaciousBond", rank: 10 }],
      arcanes: [],
    });
    expect(
      underframeCompanionBuild(pet("/Lotus/Types/Sentinels/SentinelPowersuits/Carrier"), name)
        ?.type,
    ).toBe("Sentinel");
    expect(underframeCompanionBuild({ ...pet("/X"), kind: "primary" }, name)).toBeNull();
  });

  it("returns null for companions and unknown items", () => {
    expect(underframeUrl({ ...SUIT, kind: "companion" }, () => "x")).toBeNull();
    expect(underframeUrl(SUIT, () => null)).toBeNull();
  });
});

describe("sanitizeUnderframeBuild", () => {
  it("keeps a riven's roll and drops one with a bad rank or no stats", () => {
    const riven = { rank: 8, disposition: 1.25, stats: [{ name: "Critical Chance", value: 1 }] };
    const clean = (r: unknown) =>
      sanitizeUnderframeBuild({
        name: "a",
        type: "Melee",
        itemName: "b",
        mods: [{ name: "Riven Mod", riven: r, extra: 1 }],
        arcanes: [],
      })?.mods[0];
    expect(clean(riven)).toEqual({ name: "Riven Mod", riven });
    expect(clean({ ...riven, rank: 9 })).toEqual({ name: "Riven Mod" });
    expect(clean({ ...riven, stats: [] })).toEqual({ name: "Riven Mod" });
  });

  it("keeps known fields and drops everything else", () => {
    const clean = sanitizeUnderframeBuild({
      name: "Rhino (Level Cap)",
      type: "Warframe",
      itemName: "Rhino",
      mods: [{ name: "Intensify", rank: 5, extra: 1 }, null, { name: "Bad", rank: 99 }],
      arcanes: ["Arcane Avenger", 7, "Arcane Fury", "Third"],
      archon_shards: [
        { type: "crimson", effect: "+10% Ability Strength", isTaufurged: false },
        { type: "rainbow", effect: "x" },
      ],
      helminth: { name: "Roar", slot: 3 },
      slug: "evil",
    });
    expect(clean).toEqual({
      name: "Rhino (Level Cap)",
      type: "Warframe",
      itemName: "Rhino",
      mods: [{ name: "Intensify", rank: 5 }, null, { name: "Bad" }],
      arcanes: ["Arcane Avenger", "Arcane Fury"],
      archon_shards: [{ type: "crimson", effect: "+10% Ability Strength", isTaufurged: false }],
      helminth: { name: "Roar", slot: 3 },
    });
  });

  it("takes a companion partner with its mods", () => {
    expect(
      sanitizeUnderframeBuild({
        name: "Smeeta (Level Cap)",
        type: "Beast",
        itemName: "Smeeta Kavat",
        mods: [{ name: "Tenacious Bond", rank: 10 }],
        arcanes: [],
      }),
    ).toEqual({
      name: "Smeeta (Level Cap)",
      type: "Beast",
      itemName: "Smeeta Kavat",
      mods: [{ name: "Tenacious Bond", rank: 10 }],
      arcanes: [],
    });
  });

  it("rejects anything that is not a build", () => {
    expect(sanitizeUnderframeBuild(null)).toBeNull();
    expect(sanitizeUnderframeBuild("x")).toBeNull();
    expect(
      sanitizeUnderframeBuild({ name: "a", type: "Companion", itemName: "b", mods: [] }),
    ).toBeNull();
    expect(sanitizeUnderframeBuild({ name: "a", type: "Primary", itemName: "b" })).toBeNull();
    expect(
      sanitizeUnderframeBuild({
        name: "a",
        type: "Warframe",
        itemName: "b",
        mods: [],
        helminth: { name: "R", slot: 0 },
      })?.helminth,
    ).toBeNull();
  });
});

describe("level cap search", () => {
  it("splits on commas and drops empty terms", () => {
    expect(levelCapSearchTerms(" Melee, Influence ,, ")).toEqual(["melee", "influence"]);
    expect(levelCapSearchTerms("")).toEqual([]);
  });

  it("toggles a tag in and out of the comma list", () => {
    expect(toggleLevelCapSearchTag("", "Melee")).toBe("Melee");
    expect(toggleLevelCapSearchTag("Melee", "Influence")).toBe("Melee, Influence");
    expect(toggleLevelCapSearchTag("melee, Influence", "Melee")).toBe("Influence");
  });

  it("matches squad players by part of their name", () => {
    const run = { players: ["Me", "WealthyPoet", "Alaric.Saltzman"] };
    expect(levelCapRunHasPlayer(run, "wealthy")).toBe(true);
    expect(levelCapRunHasPlayer(run, "saltz")).toBe(true);
    expect(levelCapRunHasPlayer(run, "melee")).toBe(false);
    expect(levelCapRunHasPlayer({}, "wealthy")).toBe(false);
  });

  it("counts the squadmates a run could not name", () => {
    // A screenshot run of four that named one squadmate: you plus two others.
    expect(
      levelCapSquad({ players: ["WealthyPoet"], squadSize: 4, playersFromScreenshot: true }),
    ).toEqual({ names: ["WealthyPoet"], others: 2 });
    expect(levelCapSquad({ squadSize: null, squadReads: [["a"], ["b"]] })).toEqual({
      names: [],
      others: 2,
    });
    // The log's list already includes you.
    expect(levelCapSquad({ players: ["Me", "Kemani"], squadSize: 3 })).toEqual({
      names: ["Me", "Kemani"],
      others: 1,
    });
  });

  it("keeps only the terms that name a player on some run", () => {
    const runs = [{ players: ["WealthyPoet"] }, {}];
    expect(levelCapPlayerTerms(runs, ["melee", "wealthy"])).toEqual(["wealthy"]);
    expect(levelCapPlayerTerms(runs, ["melee"])).toEqual([]);
  });
});

describe("orderLevelCapTags", () => {
  it("lists tags in the shared order, unknown ones last A-Z", () => {
    const order = ["Weapon Platform", "Secondary", "Vaz Dash"];
    expect(orderLevelCapTags(["vaz dash", "Zeta", "Secondary", "Alpha"], order)).toEqual([
      "Secondary",
      "vaz dash",
      "Alpha",
      "Zeta",
    ]);
  });
});

describe("modular build items", () => {
  const zaw = {
    type: "/Lotus/Weapons/Ostron/Melee/LotusModularWeapon",
    parts: ["/Parts/Handle/HandleFour", "/Parts/Tip/TipTen"],
  };
  const db = {
    "/Parts/Tip/TipTen": { name: "Rabvee", imageUrl: "https://x/rabvee.png" },
    [zaw.type]: { name: "Lotus Modular Weapon", imageUrl: null },
  };

  it("shows the given name, else the strike, and the strike's art", () => {
    expect(levelCapItemName({ ...zaw, customName: "Rabve Status" }, db)).toBe("Rabve Status");
    expect(levelCapItemName(zaw, db)).toBe("Rabvee");
    expect(levelCapItemImage(zaw, db)).toBe("https://x/rabvee.png");
    expect(levelCapItemName({ type: zaw.type }, db)).toBe("Lotus Modular Weapon");
  });

  it("tells two zaws apart by parts, in any order", () => {
    expect(levelCapItemKey(zaw)).toBe(levelCapItemKey({ ...zaw, parts: [...zaw.parts].reverse() }));
    expect(levelCapItemKey(zaw)).not.toBe(levelCapItemKey({ type: zaw.type }));
  });
});
