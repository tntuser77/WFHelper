import { describe, expect, it } from "vitest";

import {
  ownedSuitTypes,
  snapshotBuildForFrame,
  snapshotEquippedBuild,
  suitTypeForId,
} from "../../services/levelCapBuild";
import { DANTE_SUIT_ID, levelCapInventory } from "../fixtures/levelcap/inventory";

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

  it("tolerates missing or malformed inventory", () => {
    expect(snapshotEquippedBuild(null)).toBeNull();
    expect(snapshotEquippedBuild({ LoadOutPresets: "nope" })).toBeNull();
    expect(ownedSuitTypes(undefined)).toEqual([]);
  });
});
