import type { LevelCapItem, LevelCapSlotKind } from "../../config/shared/levelCapTypes.js";
import { ARCHON_SHARD_EFFECTS } from "../../config/shared/archonShardCatalog.js";
import {
  UNDERFRAME_SHARE_BASE,
  type UnderframeBuild,
  type UnderframeBuildType,
} from "../../config/shared/underframe.js";
import { levelCapUpgradeRole } from "./levelCap.js";

// Underframe share links carry the whole build in the URL fragment, so opening
// one sends nothing to their server until the page itself loads. The format is
// their v4 token: `v4u.` + base64url(JSON {v: 1, b: build}). Every field falls
// back to a plain English name when it is not one of their hashed indexes.

const BUILD_TYPE: Partial<Record<LevelCapSlotKind, UnderframeBuildType>> = {
  suit: "Warframe",
  primary: "Primary",
  secondary: "Secondary",
  melee: "Melee",
  archgun: "Archgun",
};

// Their mod array per build type: which index holds each special slot, and how
// many slots there are. Regular mods fill whatever is left in order.
const LAYOUT: Record<
  UnderframeBuildType,
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

/** Underframe models this kind of item. */
export function underframeSupports(kind: LevelCapSlotKind): boolean {
  return kind in BUILD_TYPE;
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
    const modName = upgrade.type ? name(upgrade.type) : null;
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
      mods[index] =
        upgrade.rank !== null ? { name: modName, rank: upgrade.rank } : { name: modName };
    }
  }

  const build: UnderframeBuild = {
    name: `${itemName} (Level Cap)`,
    type,
    itemName,
    mods,
    arcanes,
  };
  if (type !== "Warframe") return build;
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
    short.m = build.mods.map((mod) =>
      mod ? (mod.rank !== undefined ? { n: mod.name, r: mod.rank } : { n: mod.name }) : null,
    );
  }
  if (build.arcanes.length) short.a = build.arcanes;
  if (build.archon_shards?.length) {
    short.as = build.archon_shards.map((s) => [s.type, s.effect, ...(s.isTaufurged ? [1] : [])]);
  }
  if (build.helminth) short.h = [build.helminth.name, build.helminth.slot];
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
