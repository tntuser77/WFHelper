import { describe, expect, it } from "vitest";

import type { LevelCapBuild, LevelCapItem } from "../../config/shared/levelCapTypes";
import { guessLevelCapTags } from "../../services/levelCapTagGuess";

const FAST_DEFLECTION = "/Lotus/Upgrades/Mods/Warframe/AvatarShieldRechargeRateMod";
const PRIMED_FAST_DEFLECTION =
  "/Lotus/Upgrades/Mods/Warframe/Expert/AvatarShieldRechargeRateModExpert";
const VIGILANTE_VIGOR = "/Lotus/Upgrades/Mods/Sets/Vigilante/WarframeVigilanteVigorMod";
const ARCANE_PERSISTENCE = "/Lotus/Upgrades/CosmeticEnhancers/Defensive/MaxDPSTakenForArmour";

function suit(...mods: string[]): LevelCapItem {
  return {
    kind: "suit",
    type: "/Lotus/Powersuits/Pagemaster/Pagemaster",
    config: 0,
    upgrades: mods.map((type, slot) => ({ slot, type, rank: 5 })),
  };
}

function build(overrides: Partial<LevelCapBuild> = {}): LevelCapBuild {
  return {
    suit: suit(),
    primary: null,
    secondary: null,
    melee: null,
    archgun: null,
    companion: null,
    focus: "madurai",
    ...overrides,
  };
}

describe("guessLevelCapTags", () => {
  it("guesses nothing from a plain loadout", () => {
    expect(guessLevelCapTags(build())).toEqual([]);
    expect(guessLevelCapTags(null)).toEqual([]);
  });

  it("reads Vazarin, Arcane Persistence and Huras", () => {
    const huras: LevelCapItem = {
      kind: "companion",
      type: "/Lotus/Types/Game/KubrowPet/FurtiveKubrowPetPowerSuit",
      config: 0,
      upgrades: [],
    };
    expect(
      guessLevelCapTags(
        build({ focus: "vazarin", suit: suit(ARCANE_PERSISTENCE), companion: huras }),
      ),
    ).toEqual(["Vaz Dash", "Persistence", "Invisible"]);
  });

  it("needs both shield recharge delay mods for Lazy Gate", () => {
    expect(guessLevelCapTags(build({ suit: suit(FAST_DEFLECTION) }))).toEqual([]);
    expect(guessLevelCapTags(build({ suit: suit(VIGILANTE_VIGOR) }))).toEqual([]);
    expect(guessLevelCapTags(build({ suit: suit(FAST_DEFLECTION, VIGILANTE_VIGOR) }))).toEqual([
      "Lazy Gate",
    ]);
    expect(
      guessLevelCapTags(build({ suit: suit(PRIMED_FAST_DEFLECTION, VIGILANTE_VIGOR) })),
    ).toEqual(["Lazy Gate"]);
  });

  it("reads slam melees and Falcor", () => {
    const melee = (type: string): LevelCapItem => ({
      kind: "melee",
      type,
      config: 0,
      upgrades: [],
    });
    for (const type of [
      "/Lotus/Weapons/Tenno/Melee/Maces/PaladinMace/PaladinMaceWeapon",
      "/Lotus/Weapons/Syndicates/NewLoka/Melee/NLMagistar",
      "/Lotus/Weapons/Corpus/Melee/Hammer/CorpusHammerWeapon",
      "/Lotus/Weapons/Infested/InfestedLich/Melee/CodaMire",
    ]) {
      expect(guessLevelCapTags(build({ melee: melee(type) }))).toEqual(["Slam"]);
    }
    expect(
      guessLevelCapTags(
        build({ melee: melee("/Lotus/Weapons/Corpus/Melee/Glaive/CrpGlaive/CrpGlaive") }),
      ),
    ).toEqual(["Influence"]);
  });

  it("reads the Melee Afflictions and Melee Influence arcanes", () => {
    const arcane = (type: string): LevelCapItem => ({
      kind: "melee",
      type: "/Lotus/Weapons/Tenno/Melee/Swords/Xoris",
      config: 0,
      upgrades: [{ slot: 8, type, rank: 5 }],
    });
    expect(
      guessLevelCapTags(
        build({
          melee: arcane("/Lotus/Upgrades/CosmeticEnhancers/Offensive/DuplicateStatusOnKnock"),
        }),
      ),
    ).toEqual(["Afflictions"]);
    // Falcor with Melee Influence still reads as one tag.
    const falcor = {
      ...arcane("/Lotus/Upgrades/CosmeticEnhancers/Offensive/MeleeProcsSpread"),
      type: "/Lotus/Weapons/Corpus/Melee/Glaive/CrpGlaive/CrpGlaive",
    };
    expect(guessLevelCapTags(build({ melee: falcor }))).toEqual(["Influence"]);
  });

  it("skips rules an index version already had", () => {
    expect(guessLevelCapTags(build({ focus: "vazarin" }), 3)).toEqual([]);
  });
});
