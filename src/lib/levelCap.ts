import type {
  LevelCapItem,
  LevelCapSlotKind,
  LevelCapUpgrade,
} from "../../config/shared/levelCapTypes.js";
import type { LevelCapRun } from "../types/ipc.js";

export interface LevelCapFrameRow {
  frame: string;
  count: number;
  latest: number;
  /** Frame path of the most recent run, for the portrait. */
  frameType: string | null;
  unverified: number;
}

/** The card's gear strip, in display order. */
const LEVEL_CAP_CARD_SLOTS = ["primary", "secondary", "melee", "companion"] as const;

type LevelCapCardSlot = (typeof LEVEL_CAP_CARD_SLOTS)[number];

interface LevelCapGearUse {
  slot: LevelCapCardSlot;
  /** Every item run in this slot, most-used first; empty when the slot was never filled. */
  items: Array<{ type: string; count: number }>;
}

/** What a frame's runs carried in each card slot. A frame run with several
 * setups shows its most-used item per slot, the rest counted behind it. */
export function levelCapGearUse(runs: readonly LevelCapRun[]): LevelCapGearUse[] {
  return LEVEL_CAP_CARD_SLOTS.map((slot) => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      const type = run.build?.[slot]?.type;
      if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const items = [...counts]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    return { slot, items };
  });
}

/** One row per frame with at least one run, most-run first. */
export function levelCapFrames(runs: readonly LevelCapRun[]): LevelCapFrameRow[] {
  const rows = new Map<string, LevelCapFrameRow>();
  for (const run of runs) {
    const row = rows.get(run.frame) ?? {
      frame: run.frame,
      count: 0,
      latest: 0,
      frameType: null,
      unverified: 0,
    };
    row.count++;
    if (run.completedAt >= row.latest) {
      row.latest = run.completedAt;
      row.frameType = run.frameType ?? row.frameType;
    }
    if (run.buildUnverified) row.unverified++;
    rows.set(run.frame, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.frame.localeCompare(b.frame));
}

export function formatLevelCapDuration(sec: number | null): string {
  if (sec === null) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** "Melee, Influence" -> ["melee", "influence"]; every term has to match. */
export function levelCapSearchTerms(query: string): string[] {
  return query
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

/** Adds the tag to the comma list, or takes it out when it is already there. */
export function toggleLevelCapSearchTag(query: string, tag: string): string {
  const terms = query
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
  const key = tag.toLowerCase();
  const kept = terms.filter((term) => term.toLowerCase() !== key);
  return (kept.length === terms.length ? [...kept, tag] : kept).join(", ");
}

/** Puts tags in one app-wide order (`order`, usually the suggestions) so every
 *  build lists the same tags the same way; unknown tags go last, A-Z. */
export function orderLevelCapTags(tags: readonly string[], order: readonly string[]): string[] {
  const rank = new Map(order.map((tag, i) => [tag.toLowerCase(), i]));
  const at = (tag: string) => rank.get(tag.toLowerCase()) ?? order.length;
  return [...tags].sort((a, b) => at(a) - at(b) || a.localeCompare(b));
}

/** Every tag used so far, most used first, for autocomplete. */
export function levelCapTagSuggestions(tagged: ReadonlyArray<{ tags?: string[] }>): string[] {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const entry of tagged) {
    for (const tag of entry.tags ?? []) {
      const key = tag.toLowerCase();
      const entry = counts.get(key) ?? { tag, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
    .map((e) => e.tag);
}

export type LevelCapUpgradeRole = "mod" | "aura" | "exilus" | "stance" | "arcane";

// Game slot layout per item kind; everything else below slot 8 is a regular mod.
const SPECIAL_SLOTS: Partial<Record<LevelCapSlotKind, Record<number, LevelCapUpgradeRole>>> = {
  suit: { 8: "aura", 9: "exilus" },
  primary: { 8: "exilus" },
  secondary: { 8: "exilus" },
  melee: { 8: "stance", 9: "exilus" },
};

export function levelCapUpgradeRole(
  kind: LevelCapSlotKind,
  upgrade: LevelCapUpgrade,
): LevelCapUpgradeRole {
  if (upgrade.type?.includes("/CosmeticEnhancers/")) return "arcane";
  if (upgrade.type?.includes("/MeleeTrees/")) return "stance";
  return SPECIAL_SLOTS[kind]?.[upgrade.slot] ?? "mod";
}

/** Mod types (the export's `type`) that fit a slot; empty means arcanes. */
const MOD_COMPAT: Record<LevelCapSlotKind, readonly string[]> = {
  suit: ["WARFRAME"],
  primary: ["PRIMARY"],
  secondary: ["SECONDARY"],
  melee: ["MELEE"],
  archgun: ["ARCH-GUN"],
  companion: ["SENTINEL", "KAVAT", "KUBROW"],
};

// Slots past the eight regular mods, as the game numbers them.
const EXTRA_SLOTS: Record<LevelCapSlotKind, readonly LevelCapUpgradeRole[]> = {
  suit: ["aura", "exilus", "arcane", "arcane"],
  primary: ["exilus", "arcane"],
  secondary: ["exilus", "arcane"],
  melee: ["stance", "exilus", "arcane"],
  archgun: ["arcane", "arcane"],
  companion: ["mod", "mod"],
};

interface LevelCapSlotSpec {
  slot: number;
  role: LevelCapUpgradeRole;
  /** Mod types offered first; empty for arcane slots. */
  compat: readonly string[];
}

/** Every slot an item of this kind has, plus any the saved item uses outside that layout. */
export function levelCapSlotLayout(
  kind: LevelCapSlotKind,
  item: LevelCapItem | null,
): LevelCapSlotSpec[] {
  const roles: LevelCapUpgradeRole[] = [...Array(8).fill("mod"), ...EXTRA_SLOTS[kind]];
  const spec = (slot: number, role: LevelCapUpgradeRole): LevelCapSlotSpec => ({
    slot,
    role,
    compat:
      role === "arcane"
        ? []
        : role === "aura"
          ? ["AURA"]
          : role === "stance"
            ? ["STANCE"]
            : MOD_COMPAT[kind],
  });
  const out = roles.map((role, slot) => spec(slot, role));
  for (const upgrade of item?.upgrades ?? []) {
    if (upgrade.slot >= out.length)
      out.push(spec(upgrade.slot, levelCapUpgradeRole(kind, upgrade)));
  }
  return out.sort((a, b) => a.slot - b.slot);
}
