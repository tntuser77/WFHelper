import { describe, expect, it } from "vitest";

import { levelCapCatalog } from "../../services/levelCapCatalog";
import type { LevelCapNamedBuild } from "../../config/shared/levelCapTypes";

const RED_STRENGTH =
  "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeAbilityStrength";
const AMBER_CAST =
  "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeCastingSpeedMythic";

describe("levelCapCatalog", () => {
  it("offers frames, weapons by slot, mods with their slot type, and Helminth abilities", () => {
    const catalog = levelCapCatalog(null, [], []);
    const has = (list: Array<{ name: string }>, name: string) => list.some((e) => e.name === name);
    expect(has(catalog.suits, "Dante")).toBe(true);
    expect(has(catalog.melee, "Prisma Obex")).toBe(true);
    expect(has(catalog.primary, "Prisma Obex")).toBe(false);
    expect(catalog.mods.find((m) => m.name === "Corrosive Projection")).toMatchObject({
      compat: "AURA",
      maxRank: 5,
    });
    expect(has(catalog.arcanes, "Molt Augmented")).toBe(true);
    expect(has(catalog.abilities, "Roar")).toBe(true);
    // Rivens are rolled, never picked; Flawed mods would list each name twice.
    expect(catalog.mods.some((m) => m.type.includes("/Randomized/"))).toBe(false);
    expect(catalog.mods.filter((m) => m.name === "Streamline")).toHaveLength(1);
  });

  it("lists the shard effects seen on owned frames and saved builds", () => {
    const inventory = {
      Suits: [{ ArchonCrystalUpgrades: [{ Color: "ACC_RED", UpgradeType: RED_STRENGTH }, {}] }],
    };
    const saved = {
      build: {
        suit: {
          kind: "suit",
          type: "/x",
          config: 0,
          upgrades: [],
          shards: [{ color: "ACC_YELLOW_MYTHIC", type: AMBER_CAST }],
        },
      },
    } as unknown as LevelCapNamedBuild;
    expect(levelCapCatalog(inventory, [saved], []).shards).toEqual([
      { color: "ACC_RED", type: RED_STRENGTH },
      { color: "ACC_YELLOW_MYTHIC", type: AMBER_CAST },
    ]);
  });
});
