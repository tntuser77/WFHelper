import type { LevelCapBuild } from "../config/shared/levelCapTypes";

const ARCANE_PERSISTENCE = "/Lotus/Upgrades/CosmeticEnhancers/Defensive/MaxDPSTakenForArmour";
const HURAS_KUBROW = "/Lotus/Types/Game/KubrowPet/FurtiveKubrowPetPowerSuit";
/** Fast Deflection and its primed version; the beginner copy has no delay reduction. */
const FAST_DEFLECTION = new Set([
  "/Lotus/Upgrades/Mods/Warframe/AvatarShieldRechargeRateMod",
  "/Lotus/Upgrades/Mods/Warframe/Expert/AvatarShieldRechargeRateModExpert",
]);
const VIGILANTE_VIGOR = "/Lotus/Upgrades/Mods/Sets/Vigilante/WarframeVigilanteVigorMod";

/** Tags a loadout implies on its own: Vazarin for dashing, Arcane Persistence, both
 *  shield recharge delay mods for passive shield gating, and Huras for invisibility. */
export function guessLevelCapTags(build: LevelCapBuild | null): string[] {
  if (!build) return [];
  const suitMods = new Set((build.suit?.upgrades ?? []).map((upgrade) => upgrade.type));
  const tags: string[] = [];
  if (build.focus === "vazarin") tags.push("Vaz Dash");
  if (suitMods.has(ARCANE_PERSISTENCE)) tags.push("Persistence");
  if (suitMods.has(VIGILANTE_VIGOR) && [...FAST_DEFLECTION].some((type) => suitMods.has(type))) {
    tags.push("Lazy Gate");
  }
  if (build.companion?.type === HURAS_KUBROW) tags.push("Invisible");
  return tags;
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
