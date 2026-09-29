import { describe, expect, it } from "vitest";

import {
  findModularIdentity,
  ownedModularItems,
  ownedSuitTypes,
  rivensByWeapon,
  snapshotBuildForFrame,
  snapshotEquippedBuild,
  snapshotItemConfigs,
  suitTypeForId,
} from "../../services/levelCapBuild";
import { DANTE_SUIT_ID, levelCapInventory } from "../fixtures/levelcap/inventory";

const ZAW = "/Lotus/Weapons/Ostron/Melee/LotusModularWeapon";
const STRIKE = "/Lotus/Weapons/Ostron/Melee/ModularMelee02/Tip/TipTen";
const RABVE = [
  "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Balance/BalanceSpeedIStatusII",
  "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Handle/HandleFour",
  STRIKE,
];
const BALLA = [
  "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Balance/BalanceDamageI",
  "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Handle/HandleOne",
  "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Tip/TipOne",
];

/** Two zaws: every build of the kind shares one ItemType. */
function zawInventory(): Record<string, unknown> {
  const inventory = levelCapInventory();
  const zaw = (id: string, name: string, parts: string[], mods: string[]) => ({
    ItemId: { $oid: id },
    ItemType: ZAW,
    ItemName: name,
    ModularParts: parts,
    Configs: [{ Upgrades: mods }, { Upgrades: [] }],
  });
  (inventory.Melee as unknown[]).push(
    zaw("z1", "Balla dagger", BALLA, ["/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageMod"]),
    zaw("z2", "Rabve Status", RABVE, ["/Lotus/Upgrades/Mods/Melee/WeaponMeleeRangeIncMod"]),
  );
  return inventory;
}

describe("levelCapBuild modular weapons", () => {
  it("lists every owned zaw by the name it was given, with its parts", () => {
    const owned = ownedModularItems(zawInventory(), "melee");
    expect(owned.map((item) => item.customName)).toEqual(["Balla dagger", "Rabve Status"]);
    expect(owned[1]).toMatchObject({ type: ZAW, parts: RABVE, config: 0 });
    expect(ownedModularItems(zawInventory(), "suit")).toEqual([]);
  });

  it("reads the configs of the zaw with these parts, not the most modded one", () => {
    const configs = snapshotItemConfigs(zawInventory(), "melee", ZAW, [...RABVE].reverse());
    expect(configs[0]?.customName).toBe("Rabve Status");
    expect(configs[0]?.upgrades[0]?.type).toContain("WeaponMeleeRangeIncMod");
  });

  it("finds the zaw an older build used by its mods, only when one fits", () => {
    const item = {
      kind: "melee" as const,
      type: ZAW,
      config: 0,
      upgrades: [{ slot: 0, type: "/Lotus/Upgrades/Mods/Melee/WeaponMeleeRangeIncMod", rank: 3 }],
    };
    expect(findModularIdentity(zawInventory(), item)).toEqual({
      parts: RABVE,
      customName: "Rabve Status",
    });
    // Both zaws have an empty config B, so an unmodded build is ambiguous.
    expect(findModularIdentity(zawInventory(), { ...item, upgrades: [] })).toBeNull();
  });
});

describe("levelCapBuild", () => {
  it("snapshots the equipped loadout with the selected mod config", () => {
    const build = snapshotEquippedBuild(levelCapInventory());
    expect(build?.loadoutName).toBe("Cap Dante");
    expect(build?.suit?.type).toBe("/Lotus/Powersuits/Pagemaster/Pagemaster");
    expect(build?.suit?.config).toBe(1);
    expect(build?.suit?.configName).toBe("Cap");
    expect(build?.suit?.upgrades).toEqual([
      { slot: 0, type: "/Lotus/Upgrades/Mods/Warframe/AvatarPowerMaxMod", rank: 10 },
      { slot: 8, type: "/Lotus/Upgrades/Mods/Aura/EnemyArmorReductionAuraMod", rank: 5 },
      {
        slot: 10,
        type: "/Lotus/Upgrades/CosmeticEnhancers/Offensive/PowerStrengthOnKill",
        rank: 5,
      },
    ]);
  });

  it("keeps the Helminth ability, shards, focus school and companion", () => {
    const build = snapshotEquippedBuild(levelCapInventory());
    expect(build?.suit?.helminth).toEqual({
      ability: "/Lotus/Powersuits/BrokenFrame/Abilities/BrokenRotAbility",
      index: 3,
    });
    expect(build?.suit?.shards).toHaveLength(1);
    expect(build?.focus).toBe("vazarin");
    expect(build?.companion?.type).toBe(
      "/Lotus/Types/Sentinels/SentinelPowersuits/PrimeWyrmPowerSuit",
    );
    expect(build?.companion?.weapon?.type).toBe(
      "/Lotus/Types/Sentinels/SentinelWeapons/SentElecRailgun",
    );
  });

  it("leaves a hidden slot empty and records the archgun", () => {
    const build = snapshotEquippedBuild(levelCapInventory());
    expect(build?.primary).toBeNull();
    expect(build?.archgun?.type).toContain("PrimeLarkspur");
    // An unranked mod is referenced by its path rather than an owned copy.
    expect(build?.secondary?.upgrades[1]).toEqual({
      slot: 1,
      type: "/Lotus/Upgrades/Mods/Pistol/RawUnrankedMod",
      rank: null,
    });
  });

  it("uses a saved loadout for a frame that is not equipped", () => {
    const build = snapshotBuildForFrame(levelCapInventory(), "/Lotus/Powersuits/Nezha/NezhaPrime");
    expect(build?.loadoutName).toBe("Nezha Tank");
    expect(build?.suit?.type).toBe("/Lotus/Powersuits/Nezha/NezhaPrime");
  });

  it("falls back to the bare frame when no loadout carries it", () => {
    const build = snapshotBuildForFrame(levelCapInventory(), "/Lotus/Powersuits/Nezha/Nezha");
    expect(build?.loadoutName).toBeUndefined();
    expect(build?.suit?.type).toBe("/Lotus/Powersuits/Nezha/Nezha");
    // The preset carries no school, so the account's active one is used.
    expect(build?.focus).toBe("vazarin");
    expect(snapshotBuildForFrame(levelCapInventory(), "/Lotus/Powersuits/Unowned")).toBeNull();
  });

  it("resolves suit ids and owned frames", () => {
    expect(suitTypeForId(levelCapInventory(), DANTE_SUIT_ID)).toBe(
      "/Lotus/Powersuits/Pagemaster/Pagemaster",
    );
    expect(ownedSuitTypes(levelCapInventory())).toHaveLength(3);
  });

  it("freezes a slotted riven's rolled stats into the build", () => {
    const inventory = levelCapInventory();
    const rivenId = "f1".padStart(24, "0");
    const roll = 0x3fffffff;
    (inventory.Upgrades as unknown[]).push({
      ItemId: { $oid: rivenId },
      ItemType: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
      UpgradeFingerprint: JSON.stringify({
        compat: "/Lotus/Weapons/Tenno/Rifle/Rifle",
        lvl: 8,
        buffs: [{ Tag: "WeaponFireDamageMod", Value: Math.round(roll * 0.72) }],
        curses: [{ Tag: "WeaponFireRateMod", Value: Math.round(roll * 0.3) }],
      }),
    });
    const akarius = (inventory.Pistols as Array<{ Configs: Array<{ Upgrades: string[] }> }>)[0];
    akarius.Configs[0].Upgrades.push(rivenId);

    const riven = snapshotEquippedBuild(inventory)?.secondary?.upgrades.find((u) => u.riven)?.riven;
    expect(riven?.name).toMatch(/^Braton /);
    expect(riven?.stats.map((s) => s.positive)).toEqual([true, false]);
    // Enough to rebuild the roll elsewhere: its rank, disposition, and each bonus as a fraction.
    expect(riven?.rank).toBe(8);
    expect(riven?.disposition).toBeGreaterThan(0);
    expect(riven?.stats.map((s) => s.tag)).toEqual(["WeaponFireDamageMod", "WeaponFireRateMod"]);
    for (const stat of riven?.stats ?? []) expect(stat.raw).toBeCloseTo(stat.value / 100, 2);
    expect(riven?.stats[1].raw).toBeLessThan(0);
    expect([...rivensByWeapon(inventory).keys()]).toEqual(["braton"]);
  });

  it("reads every mod config of an owned item for the build editor", () => {
    const configs = snapshotItemConfigs(
      levelCapInventory(),
      "suit",
      "/Lotus/Powersuits/Pagemaster/Pagemaster",
    );
    expect(configs.map((c) => c.config)).toEqual([0, 1]);
    expect(configs[1].configName).toBe("Cap");
    expect(configs[1].upgrades.length).toBeGreaterThan(configs[0].upgrades.length);
    expect(snapshotItemConfigs(levelCapInventory(), "primary", "/Lotus/Weapons/Unowned")).toEqual(
      [],
    );
  });

  it("tolerates missing or malformed inventory", () => {
    expect(snapshotEquippedBuild(null)).toBeNull();
    expect(snapshotEquippedBuild({ LoadOutPresets: "nope" })).toBeNull();
    expect(ownedSuitTypes(undefined)).toEqual([]);
  });
});

describe("levelCapBuild incarnon evolutions", () => {
  const LAETUM = "/Lotus/Weapons/Tenno/Zariman/Pistols/HeavyPistol/ZarimanHeavyPistol";
  const LEX_PRIME = "/Lotus/Weapons/Tenno/Pistols/PrimeLex/PrimeLex";
  // The export names Lex Prime's parent, which is where its progress row sits.
  const LEX = "/Lotus/Weapons/Tenno/Pistol/HeavyPistol";
  const inventory = (evolutions: unknown[], weapons: Array<[string, string]>) => ({
    Suits: [],
    EvolutionProgress: evolutions,
    Pistols: weapons.map(([type, tree], n) => ({
      ItemType: type,
      ItemId: { $oid: `pistol${n}` },
      // The editor only offers copies carrying mods.
      Configs: [{ Upgrades: ["/Lotus/Upgrades/Mods/Pistol/WeaponDamageAmountMod"] }],
      SkillTree: tree,
    })),
  });
  const perks = (inv: unknown, type: string) =>
    snapshotItemConfigs(inv, "secondary", type)[0]?.incarnon;

  it("reads the perk picked at each evolution", () => {
    const inv = inventory(
      [{ ItemType: LAETUM, Rank: 5 }],
      [
        [LAETUM, "00022"],
        [LEX_PRIME, "0102"],
      ],
    );
    expect(perks(inv, LAETUM)).toEqual([0, 0, 0, 2, 2]);
    // A Genesis tree stops at IV, and no progress row means it is complete.
    expect(perks(inv, LEX_PRIME)).toEqual([0, 1, 0, 2]);
  });

  it("stops at the evolutions unlocked so far, looking at the parent for a Genesis weapon", () => {
    const inv = inventory([{ ItemType: LEX, Rank: 2 }], [[LEX_PRIME, "0102"]]);
    expect(perks(inv, LEX_PRIME)).toEqual([0, 1, 0]);
  });

  it("ignores weapons without an Incarnon", () => {
    expect(perks(inventory([], [[LAETUM, ""]]), LAETUM)).toBeUndefined();
  });
});
