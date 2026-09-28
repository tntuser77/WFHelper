import type { LevelCapBuild } from "../config/shared/levelCapTypes";

const ARCANE_PERSISTENCE = "/Lotus/Upgrades/CosmeticEnhancers/Defensive/MaxDPSTakenForArmour";
const HURAS_KUBROW = "/Lotus/Types/Game/KubrowPet/FurtiveKubrowPetPowerSuit";
/** Fast Deflection and its primed version; the beginner copy has no delay reduction. */
const FAST_DEFLECTION = new Set([
  "/Lotus/Upgrades/Mods/Warframe/AvatarShieldRechargeRateMod",
  "/Lotus/Upgrades/Mods/Warframe/Expert/AvatarShieldRechargeRateModExpert",
]);
const VIGILANTE_VIGOR = "/Lotus/Upgrades/Mods/Sets/Vigilante/WarframeVigilanteVigorMod";
/** Heavy slam melees: Magistar, Sancti Magistar, Arca Titron and Coda Mire. */
const SLAM_MELEES = new Set([
  "/Lotus/Weapons/Tenno/Melee/Maces/PaladinMace/PaladinMaceWeapon",
  "/Lotus/Weapons/Syndicates/NewLoka/Melee/NLMagistar",
  "/Lotus/Weapons/Corpus/Melee/Hammer/CorpusHammerWeapon",
  "/Lotus/Weapons/Infested/InfestedLich/Melee/CodaMire",
]);
const FALCOR = "/Lotus/Weapons/Corpus/Melee/Glaive/CrpGlaive/CrpGlaive";

interface TagRule {
  tag: string;
  /** Index schema version the rule arrived with; older indexes get it on upgrade. */
  since: number;
  test: (build: LevelCapBuild, suitMods: Set<string | null>) => boolean;
}

const RULES: TagRule[] = [
  { tag: "Vaz Dash", since: 3, test: (build) => build.focus === "vazarin" },
  { tag: "Persistence", since: 3, test: (_, mods) => mods.has(ARCANE_PERSISTENCE) },
  {
    tag: "Lazy Gate",
    since: 3,
    test: (_, mods) =>
      mods.has(VIGILANTE_VIGOR) && [...FAST_DEFLECTION].some((type) => mods.has(type)),
  },
  { tag: "Invisible", since: 3, test: (build) => build.companion?.type === HURAS_KUBROW },
  { tag: "Slam", since: 4, test: (build) => SLAM_MELEES.has(build.melee?.type ?? "") },
  { tag: "Influence", since: 4, test: (build) => build.melee?.type === FALCOR },
];

/** Tags a loadout implies on its own: Vazarin for dashing, Arcane Persistence, both
 *  shield recharge delay mods for passive shield gating, Huras for invisibility, a
 *  slam melee, and Falcor for Melee Influence. Only rules newer than `afterVersion`
 *  count, so an index upgrade adds just the tags its new rules bring. */
export function guessLevelCapTags(build: LevelCapBuild | null, afterVersion = 0): string[] {
  if (!build) return [];
  const suitMods = new Set((build.suit?.upgrades ?? []).map((upgrade) => upgrade.type));
  return RULES.filter((rule) => rule.since > afterVersion && rule.test(build, suitMods)).map(
    (rule) => rule.tag,
  );
}

/** Guessed tags the new loadout implies that the old one did not, so a tag the
 *  player removed stays removed until a loadout change calls for it again. */
export function newlyGuessedLevelCapTags(
  before: LevelCapBuild | null,
  after: LevelCapBuild | null,
): string[] {
  const had = new Set(guessLevelCapTags(before));
  return guessLevelCapTags(after).filter((tag) => !had.has(tag));
}
