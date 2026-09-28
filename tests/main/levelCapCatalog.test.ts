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

  it("carries each mod's card text so a search can find it by effect", () => {
    const mod = (name: string) => catalog.mods.find((m) => m.name === name);
    expect(mod("Primed Continuity")?.stats).toContain("Ability Duration");
    expect(mod("Archon Stretch")?.stats).not.toMatch(/<|\n/);
    expect(catalog.arcanes.find((a) => a.name === "Arcane Energize")?.stats).toContain("Energy");
  });

  it("puts mods the game will not equip together in one family", () => {
    const family = (name: string) => catalog.mods.find((m) => m.name === name)?.family;
    expect(family("Primed Continuity")).toBe(family("Continuity"));
    expect(family("Archon Continuity")).toBe(family("Continuity"));
    expect(family("Archon Stretch")).toBe(family("Stretch"));
    expect(family("Umbral Fiber")).toBe(family("Steel Fiber"));
    expect(family("Galvanized Chamber")).toBe(family("Split Chamber"));
    // Amalgam mods stack with their namesakes, and Primed Chamber has no base.
    expect(family("Amalgam Serration")).not.toBe(family("Serration"));
    expect(family("Primed Chamber")).not.toBe(family("Split Chamber"));
    expect(family("Overextended")).not.toBe(family("Stretch"));
  });

  it("ties each augment to its frame and, where the card names it, its ability", () => {
    const mod = (name: string) => catalog.mods.find((m) => m.name === name);
    const ability = (name: string) => catalog.abilities.find((a) => a.name === name)?.type;
    const hydroid = catalog.suitParents["/Lotus/Powersuits/Pirate/HydroidPrime"];
    expect(hydroid).toBe(catalog.suitParents["/Lotus/Powersuits/Pirate/Pirate"]);
    expect(mod("Viral Tempest")?.augment).toEqual({
      suit: hydroid,
      ability: ability("Tempest Barrage"),
    });
    // The card path says Intimidate; only the card text says Warcry.
    expect(mod("Eternal War")?.augment?.ability).toBe(ability("Warcry"));
    expect(mod("Continuity")?.augment).toBeUndefined();
  });

  it("marks mods only some weapons take, and which weapons take them", () => {
    const mod = (name: string) => catalog.mods.find((m) => m.name === name);
    const weapon = (name: string) =>
      [...catalog.primary, ...catalog.secondary].find((w) => w.name === name)?.type ?? "";
    const takes = (gun: string, name: string) => {
      const target = mod(name)?.target;
      return !target || (catalog.weaponTargets[weapon(gun)] ?? []).includes(target.type);
    };
    expect(mod("Thundermiter")?.target?.weapon).toBe(true);
    expect(mod("Point Blank")?.target?.weapon).toBe(false);
    expect(mod("Vigilante Armaments")?.target).toBeUndefined();

    expect(takes("Miter", "Thundermiter")).toBe(true);
    expect(takes("Soma Prime", "Thundermiter")).toBe(false);
    expect(takes("Kuva Sobek", "Shattering Justice")).toBe(true);
    expect(takes("Soma Prime", "Serration")).toBe(true);
    expect(takes("Soma Prime", "Point Blank")).toBe(false);
    expect(takes("Hek", "Point Blank")).toBe(true);
    expect(takes("Hek", "Serration")).toBe(false);
    // The export's holster calls Phage a wide rifle; WFCD knows it is a shotgun.
    expect(takes("Phage", "Point Blank")).toBe(true);
    expect(takes("Paris Prime", "Split Flights")).toBe(true);
    expect(takes("Paris Prime", "Serration")).toBe(true);
    expect(takes("Rubico Prime", "Split Flights")).toBe(false);
    expect(takes("Lex Prime", "Stinging Truth")).toBe(false);
    expect(takes("Lex Prime", "Hornet Strike")).toBe(true);
  });

  it("keeps beast claw mods off player melee", () => {
    const melee = catalog.melee.find((w) => w.name === "Nikana Prime")?.type ?? "";
    const claw = catalog.mods.find((m) => m.name === "Maul");
    expect(claw?.target?.weapon).toBe(true);
    expect(catalog.weaponTargets[melee]).not.toContain(claw?.target?.type);
  });

  it("drops the export's dev copies of real mods", () => {
    const molten = catalog.mods.filter((m) => m.name === "Molten Impact");
    expect(molten).toHaveLength(1);
    expect(molten[0]).toMatchObject({ maxRank: 5, drain: 11 });
    expect(molten[0].stats).toContain("90%");
    expect(catalog.mods.filter((m) => m.name === "Rush")).toHaveLength(1);
  });

  it("carries each mod's max-rank drain, negative for auras", () => {
    const mod = (name: string) => catalog.mods.find((m) => m.name === name);
    expect(mod("Serration")?.drain).toBe(14);
    expect(mod("Corrosive Projection")?.drain).toBeLessThan(0);
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
