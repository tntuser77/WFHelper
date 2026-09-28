import type { LevelCapItem, LevelCapSlotKind } from "../../config/shared/levelCapTypes.js";
import { levelCapUpgradeRole } from "./levelCap.js";

// Underframe share links carry the whole build in the URL fragment, so opening
// one sends nothing to their server until the page itself loads. The format is
// their v4 token: `v4u.` + base64url(JSON {v: 1, b: build}). Every field falls
// back to a plain English name when it is not one of their hashed indexes.
const SHARE_BASE = "https://www.underframe.site/share#";

const BUILD_TYPE: Partial<Record<LevelCapSlotKind, string>> = {
  suit: "Warframe",
  primary: "Primary",
  secondary: "Secondary",
  melee: "Melee",
  archgun: "Archgun",
};

// Their mod array per build type: which index holds each special slot, and how
// many slots there are. Regular mods fill whatever is left in order.
const LAYOUT: Record<string, { count: number; aura?: number; stance?: number; exilus?: number }> = {
  Warframe: { count: 10, aura: 0, exilus: 1 },
  Melee: { count: 10, stance: 0, exilus: 1 },
  Primary: { count: 9, exilus: 8 },
  Secondary: { count: 9, exilus: 8 },
  Archgun: { count: 8 },
};

type ModSlot = { n: string; r?: number } | null;

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Share link for one item, or null for kinds Underframe does not model.
 * `name` resolves a `/Lotus/` path to the English name Underframe matches on. */
export function underframeUrl(
  item: LevelCapItem,
  name: (type: string) => string | null,
  helminthName?: string | null,
): string | null {
  const type = BUILD_TYPE[item.kind];
  const itemName = name(item.type);
  if (!type || !itemName) return null;
  const layout = LAYOUT[type];
  const mods: ModSlot[] = Array.from({ length: layout.count }, () => null);
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
    const slot: ModSlot = upgrade.rank !== null ? { n: modName, r: upgrade.rank } : { n: modName };
    const index =
      role === "aura"
        ? layout.aura
        : role === "stance"
          ? layout.stance
          : role === "exilus"
            ? layout.exilus
            : free.shift();
    if (index !== undefined) mods[index] = slot;
  }

  const build: Record<string, unknown> = { n: `${itemName} (Level Cap)`, t: type, i: itemName };
  if (mods.some(Boolean)) build.m = mods;
  if (arcanes.length) build.a = arcanes;
  if (item.helminth && helminthName) build.h = [helminthName, item.helminth.index];
  return `${SHARE_BASE}v4u.${base64Url(JSON.stringify({ v: 1, b: build }))}`;
}
