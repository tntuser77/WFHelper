import type {
  LevelCapItem,
  LevelCapRiven,
  LevelCapSlotKind,
} from "../../config/shared/levelCapTypes.js";
import { ARCHON_SHARD_EFFECTS } from "../../config/shared/archonShardCatalog.js";
import {
  UNDERFRAME_RIVEN_STATS,
  UNDERFRAME_SHARE_BASE,
  type UnderframeBuild,
  type UnderframeBuildType,
  type UnderframeRiven,
} from "../../config/shared/underframe.js";
import { isLevelCapRivenType } from "../../config/shared/levelCapBuild.js";
import { levelCapUpgradeRole } from "./levelCap.js";

// Underframe share links carry the whole build in the URL fragment, so opening
// one sends nothing to their server until the page itself loads. The format is
// their v4 token: `v4u.` + base64url(JSON {v: 1, b: build}). Every field falls
// back to a plain English name when it is not one of their hashed indexes.

// Companions only ride along as partner builds; see underframeCompanionBuild.
type LoadoutBuildType = Exclude<UnderframeBuildType, "Sentinel" | "Beast">;

const BUILD_TYPE: Partial<Record<LevelCapSlotKind, LoadoutBuildType>> = {
  suit: "Warframe",
  primary: "Primary",
  secondary: "Secondary",
  melee: "Melee",
  archgun: "Archgun",
};

// Their mod array per build type: which index holds each special slot, and how
// many slots there are. Regular mods fill whatever is left in order.
const LAYOUT: Record<
  LoadoutBuildType,
  { count: number; aura?: number; stance?: number; exilus?: number }
> = {
  Warframe: { count: 10, aura: 0, exilus: 1 },
  Melee: { count: 10, stance: 0, exilus: 1 },
  Primary: { count: 9, exilus: 8 },
  Secondary: { count: 9, exilus: 8 },
  Archgun: { count: 8 },
};

const SHARD_COLORS: Record<string, string> = {
  RED: "crimson",
  YELLOW: "amber",
  BLUE: "azure",
  PURPLE: "violet",
  GREEN: "emerald",
  ORANGE: "topaz",
};

/** The roll as Underframe keeps it, or null when the capture lacks what it needs
 *  (builds saved before rolls were kept in full) or no stat maps across. */
function underframeRiven(riven: LevelCapRiven | undefined): UnderframeRiven | null {
  if (riven?.rank === undefined || !riven.disposition) return null;
  const scale = (riven.disposition * (riven.rank + 1)) / 9;
  const stats = riven.stats.flatMap((stat) => {
    const name = stat.tag ? UNDERFRAME_RIVEN_STATS[stat.tag] : undefined;
    if (!name || stat.raw === undefined) return [];
    const base = Math.abs(stat.raw) / scale;
    return [{ name, value: stat.positive ? base : -base }];
  });
  return stats.length ? { rank: riven.rank, disposition: riven.disposition, stats } : null;
}

/** The item as Underframe keeps a build, or null for kinds it does not model.
 * `name` resolves a `/Lotus/` path to the English name Underframe matches on. */
export function underframeBuild(
  item: LevelCapItem,
  name: (type: string) => string | null,
  helminthName?: string | null,
): UnderframeBuild | null {
  const type = BUILD_TYPE[item.kind];
  const itemName = name(item.type);
  if (!type || !itemName) return null;
  const layout = LAYOUT[type];
  const mods: UnderframeBuild["mods"] = Array.from({ length: layout.count }, () => null);
  const arcanes: string[] = [];
  const free = mods
    .map((_, i) => i)
    .filter((i) => i !== layout.aura && i !== layout.stance && i !== layout.exilus);

  for (const upgrade of [...item.upgrades].sort((a, b) => a.slot - b.slot)) {
    const riven = isLevelCapRivenType(upgrade.type) ? underframeRiven(upgrade.riven) : null;
    const modName = upgrade.type ? (name(upgrade.type) ?? (riven ? "Riven Mod" : null)) : null;
    if (!modName) continue;
    const role = levelCapUpgradeRole(item.kind, upgrade);
    if (role === "arcane") {
      arcanes.push(modName);
      continue;
    }
    const index =
      role === "aura"
        ? layout.aura
        : role === "stance"
          ? layout.stance
          : role === "exilus"
            ? layout.exilus
            : free.shift();
    if (index !== undefined) {
      mods[index] = {
        name: modName,
        ...(upgrade.rank !== null ? { rank: upgrade.rank } : {}),
        ...(riven ? { riven } : {}),
      };
    }
  }

  const build: UnderframeBuild = {
    name: `${itemName} (Level Cap)`,
    type,
    itemName,
    mods,
    arcanes,
  };
  if (type !== "Warframe") {
    if (item.incarnon?.length) {
      // Their perks count from 1, and an evolution not reached yet is null.
      const perk = (tier: number) => {
        const pick = item.incarnon?.[tier - 1];
        return pick === undefined ? null : pick + 1;
      };
      build.incarnon = {
        evolution_1_active: true,
        evolution_2_perk: perk(2),
        evolution_3_perk: perk(3),
        evolution_4_perk: perk(4),
        evolution_5_perk: perk(5),
      };
    }
    return build;
  }
  build.archon_shards = (item.shards ?? []).flatMap((shard) => {
    const effect = ARCHON_SHARD_EFFECTS.find((e) => e.type === shard.type)?.effect;
    const color = SHARD_COLORS[shard.color.replace(/^ACC_/, "").replace(/_MYTHIC$/, "")];
    return effect && color
      ? [{ type: color, effect, isTaufurged: shard.color.endsWith("_MYTHIC") }]
      : [];
  });
  // Underframe counts abilities from 1; the inventory from 0.
  build.helminth =
    item.helminth && helminthName ? { name: helminthName, slot: item.helminth.index + 1 } : null;
  return build;
}

/** A companion as a partner build, which is how Underframe hands its bond mods
 *  buffs to a weapon. Only the mod list matters there, so slot order does not. */
export function underframeCompanionBuild(
  item: LevelCapItem,
  name: (type: string) => string | null,
): UnderframeBuild | null {
  const itemName = item.customName ?? name(item.type);
  if (item.kind !== "companion" || !itemName) return null;
  const mods = item.upgrades.flatMap((upgrade) => {
    const modName = upgrade.type ? name(upgrade.type) : null;
    return modName
      ? [upgrade.rank !== null ? { name: modName, rank: upgrade.rank } : { name: modName }]
      : [];
  });
  return {
    name: `${itemName} (Level Cap)`,
    type: item.type.includes("/Sentinels/") ? "Sentinel" : "Beast",
    itemName,
    mods,
    arcanes: [],
  };
}

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Share link for one build, in Underframe's short-key form. */
export function underframeShareUrl(build: UnderframeBuild): string {
  const short: Record<string, unknown> = { n: build.name, t: build.type, i: build.itemName };
  if (build.mods.some(Boolean)) {
    // A riven only exists in their editor, so a share link leaves its slot empty.
    short.m = build.mods.map((mod) =>
      mod && !mod.riven
        ? mod.rank !== undefined
          ? { n: mod.name, r: mod.rank }
          : { n: mod.name }
        : null,
    );
  }
  if (build.arcanes.length) short.a = build.arcanes;
  if (build.archon_shards?.length) {
    short.as = build.archon_shards.map((s) => [s.type, s.effect, ...(s.isTaufurged ? [1] : [])]);
  }
  if (build.helminth) short.h = [build.helminth.name, build.helminth.slot];
  if (build.incarnon) {
    const i = build.incarnon;
    short.ic = [
      i.evolution_1_active ? 1 : 0,
      i.evolution_2_perk,
      i.evolution_3_perk,
      i.evolution_4_perk,
      i.evolution_5_perk,
    ];
  }
  return `${UNDERFRAME_SHARE_BASE}v4u.${base64Url(JSON.stringify({ v: 1, b: short }))}`;
}

/** Share link for one item, or null for kinds Underframe does not model. */
export function underframeUrl(
  item: LevelCapItem,
  name: (type: string) => string | null,
  helminthName?: string | null,
): string | null {
  const build = underframeBuild(item, name, helminthName);
  return build ? underframeShareUrl(build) : null;
}
