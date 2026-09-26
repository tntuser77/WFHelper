import { describe, expect, it } from "vitest";

import { levelCapCatalog } from "../../services/levelCapCatalog";
import { ARCHON_SHARD_EFFECTS } from "../../config/shared/archonShardCatalog";

describe("levelCapCatalog", () => {
  const catalog = levelCapCatalog();
  const has = (list: Array<{ name: string }>, name: string) => list.some((e) => e.name === name);

  it("offers frames, weapons by slot, and mods with their slot type and rarity", () => {
    expect(has(catalog.suits, "Dante")).toBe(true);
    expect(has(catalog.melee, "Prisma Obex")).toBe(true);
    expect(has(catalog.primary, "Prisma Obex")).toBe(false);
    expect(catalog.mods.find((m) => m.name === "Corrosive Projection")).toMatchObject({
      compat: "AURA",
      maxRank: 5,
    });
    expect(catalog.mods.find((m) => m.name === "Primed Flow")?.rarity).toBe("LEGENDARY");
    expect(has(catalog.arcanes, "Molt Augmented")).toBe(true);
    // Rivens are rolled, never picked; Flawed mods would list each name twice.
    expect(catalog.mods.some((m) => m.type.includes("/Randomized/"))).toBe(false);
    expect(catalog.mods.filter((m) => m.name === "Streamline")).toHaveLength(1);
  });

  it("offers only what the Helminth can graft, once each", () => {
    expect(has(catalog.abilities, "Roar")).toBe(true);
    expect(has(catalog.abilities, "Radial Blind")).toBe(true);
    expect(has(catalog.abilities, "Expedite Suffering")).toBe(true);
    expect(has(catalog.abilities, "Slash Dash")).toBe(false);
    expect(catalog.abilities.filter((a) => a.name === "Energized Munitions")).toHaveLength(1);
  });
});

describe("archon shard catalogue", () => {
  it("lists effects for every shard colour, tauforged included", () => {
    const colors = new Set(ARCHON_SHARD_EFFECTS.map((e) => e.color));
    expect(colors.size).toBe(12);
    const castingSpeed = ARCHON_SHARD_EFFECTS.find((e) =>
      e.type.endsWith("/ArchonCrystalUpgradeWarframeCastingSpeedMythic"),
    );
    expect(castingSpeed?.color).toBe("ACC_YELLOW_MYTHIC");
    expect(ARCHON_SHARD_EFFECTS.every((e) => !/Sheild|Dmg[A-Z]/.test(e.effect))).toBe(true);
  });
});
