// A build as underframe.site keeps it in its own page state; the renderer builds
// these from a level cap item and main hands them to the site's page.

export const UNDERFRAME_ORIGIN = "https://www.underframe.site";
export const UNDERFRAME_SHARE_BASE = `${UNDERFRAME_ORIGIN}/share#`;

export const UNDERFRAME_BUILD_TYPES = [
  "Warframe",
  "Primary",
  "Secondary",
  "Melee",
  "Archgun",
  "Sentinel",
  "Beast",
] as const;
/** Builds a DPS check runs on; the others only lend buffs. */
export const UNDERFRAME_WEAPON_TYPES: readonly UnderframeBuildType[] = [
  "Primary",
  "Secondary",
  "Melee",
  "Archgun",
];
export type UnderframeBuildType = (typeof UNDERFRAME_BUILD_TYPES)[number];

export const UNDERFRAME_SHARD_TYPES = [
  "crimson",
  "amber",
  "azure",
  "violet",
  "emerald",
  "topaz",
] as const;

export interface UnderframeBuild {
  name: string;
  type: UnderframeBuildType;
  itemName: string;
  /** Their slot order: aura/stance and exilus lead, except guns keep exilus last. */
  mods: Array<{ name: string; rank?: number } | null>;
  arcanes: string[];
  /** `effect` is our English card text; the page matches it to its own wording. */
  archon_shards?: Array<{ type: string; effect: string; isTaufurged: boolean }>;
  /** `slot` counts abilities from 1. */
  helminth?: { name: string; slot: number } | null;
  /** Perks count from 1; null where that evolution is not unlocked. */
  incarnon?: UnderframeIncarnon | null;
}

export interface UnderframeIncarnon {
  evolution_1_active: boolean;
  evolution_2_perk: number | null;
  evolution_3_perk: number | null;
  evolution_4_perk: number | null;
  evolution_5_perk: number | null;
}

function incarnon(value: unknown): UnderframeIncarnon | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const perk = (key: string) => {
    const n = raw[key];
    return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 3 ? (n as number) : null;
  };
  const out: UnderframeIncarnon = {
    evolution_1_active: raw.evolution_1_active === true,
    evolution_2_perk: perk("evolution_2_perk"),
    evolution_3_perk: perk("evolution_3_perk"),
    evolution_4_perk: perk("evolution_4_perk"),
    evolution_5_perk: perk("evolution_5_perk"),
  };
  return out.evolution_1_active ? out : null;
}

const MAX_TEXT = 200;
const MAX_MODS = 16;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT ? value : null;

/** Rebuilds a renderer-sent build from known fields only, or null if it is not one. */
export function sanitizeUnderframeBuild(value: unknown): UnderframeBuild | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name);
  const itemName = text(raw.itemName);
  const type = UNDERFRAME_BUILD_TYPES.find((t) => t === raw.type);
  if (!name || !itemName || !type || !Array.isArray(raw.mods) || raw.mods.length > MAX_MODS) {
    return null;
  }
  const mods = raw.mods.map((mod) => {
    const modName = text((mod as { name?: unknown } | null)?.name);
    if (!modName) return null;
    const rank = (mod as { rank?: unknown }).rank;
    return Number.isInteger(rank) && (rank as number) >= 0 && (rank as number) <= 30
      ? { name: modName, rank: rank as number }
      : { name: modName };
  });
  const arcanes = (Array.isArray(raw.arcanes) ? raw.arcanes : [])
    .map(text)
    .filter((a): a is string => a !== null)
    .slice(0, 2);
  const build: UnderframeBuild = { name, type, itemName, mods, arcanes };
  if (type !== "Warframe") {
    const evolutions = incarnon(raw.incarnon);
    if (evolutions) build.incarnon = evolutions;
    return build;
  }

  const shards = (Array.isArray(raw.archon_shards) ? raw.archon_shards : []).slice(0, 5);
  build.archon_shards = shards.flatMap((shard) => {
    const s = shard as { type?: unknown; effect?: unknown; isTaufurged?: unknown } | null;
    const shardType = UNDERFRAME_SHARD_TYPES.find((t) => t === s?.type);
    const effect = text(s?.effect);
    return shardType && effect
      ? [{ type: shardType, effect, isTaufurged: s?.isTaufurged === true }]
      : [];
  });
  const helminth = raw.helminth as { name?: unknown; slot?: unknown } | null | undefined;
  const helminthName = text(helminth?.name);
  const slot = helminth?.slot;
  build.helminth =
    helminthName && Number.isInteger(slot) && (slot as number) >= 1 && (slot as number) <= 4
      ? { name: helminthName, slot: slot as number }
      : null;
  return build;
}
