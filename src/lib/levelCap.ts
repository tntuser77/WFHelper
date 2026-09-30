import type {
  LevelCapItem,
  LevelCapSlotKind,
  LevelCapUpgrade,
} from "../../config/shared/levelCapTypes.js";
import type { LevelCapRun } from "../types/ipc.js";
import { fallbackNameFromUniqueName } from "../../config/shared/displayName.js";
import { itemLabel } from "./itemLabel.js";

/** What names and pictures a build item: its type, plus the parts of a modular build. */
export type LevelCapItemRef = Pick<LevelCapItem, "type" | "parts" | "customName">;

type ItemArt = Record<
  string,
  { name?: string | null; displayName?: string | null; imageUrl?: string | null } | undefined
>;

// The part that makes a modular build what it is: a zaw's strike, a kitgun's chamber.
const DEFINING_PART_RE = /\/Tips?\/|\/Barrels?\/|MoaPetHead|ZanukaPetPartHead/i;

function definingPart(item: LevelCapItemRef): string | null {
  return item.parts?.find((part) => DEFINING_PART_RE.test(part)) ?? null;
}

/** "Rabve Status" for a named zaw, else its strike's name, else the item's own. */
export function levelCapItemName(item: LevelCapItemRef, db: ItemArt): string {
  const part = definingPart(item);
  return (
    item.customName ||
    (part ? itemLabel(db[part]) : "") ||
    itemLabel(db[item.type]) ||
    fallbackNameFromUniqueName(item.type)
  );
}

/** A modular build shows its strike or chamber; the shared base type has no art. */
export function levelCapItemImage(item: LevelCapItemRef, db: ItemArt): string | null {
  const part = definingPart(item);
  return (part ? db[part]?.imageUrl : null) ?? db[item.type]?.imageUrl ?? null;
}

/** Same item for counting and matching: two zaws differ by parts, not by type. */
export function levelCapItemKey(item: LevelCapItemRef): string {
  return item.parts?.length ? `${item.type}<${[...item.parts].sort().join(",")}>` : item.type;
}

export interface LevelCapFrameRow {
  frame: string;
  count: number;
  latest: number;
  /** Frame path of the most recent run, for the portrait. */
  frameType: string | null;
  unverified: number;
}

/** The card's gear strip, in display order. */
const LEVEL_CAP_CARD_SLOTS = ["primary", "secondary", "melee", "archgun", "companion"] as const;

type LevelCapCardSlot = (typeof LEVEL_CAP_CARD_SLOTS)[number];

interface LevelCapGearUse {
  slot: LevelCapCardSlot;
  /** Every item run in this slot, most-used first; empty when the slot was never filled. */
  items: Array<{ item: LevelCapItemRef; count: number }>;
}

/** What a frame's runs carried in each card slot. A frame run with several
 * setups shows its most-used item per slot, the rest counted behind it. The
 * archgun slot only shows when some build carries one. */
export function levelCapGearUse(runs: readonly LevelCapRun[]): LevelCapGearUse[] {
  const gear = LEVEL_CAP_CARD_SLOTS.map((slot) => {
    const counts = new Map<string, { item: LevelCapItemRef; count: number }>();
    for (const run of runs) {
      const item = run.build?.[slot];
      if (!item) continue;
      const key = levelCapItemKey(item);
      const entry = counts.get(key) ?? { item, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
    const items = [...counts.values()].sort(
      (a, b) => b.count - a.count || levelCapItemKey(a.item).localeCompare(levelCapItemKey(b.item)),
    );
    return { slot, items };
  });
  return gear.filter(({ slot, items }) => slot !== "archgun" || items.length);
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

/** Your kills per minute of run time; null when either is unknown. */
export function levelCapKillsPerMin(
  run: Pick<LevelCapRun, "kills" | "durationSec">,
): number | null {
  if (run.kills == null || !run.durationSec || run.durationSec <= 0) return null;
  return run.kills / (run.durationSec / 60);
}

/** "Melee, Influence" -> ["melee", "influence"]; every term has to match. */
export function levelCapSearchTerms(query: string): string[] {
  return query
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

/** The squad names a run knows, and how many squadmates it could not name. A
 *  screenshot never shows your own name; the log's list includes it. */
export function levelCapSquad(
  run: Pick<LevelCapRun, "players" | "squadSize" | "squadReads" | "playersFromScreenshot">,
): { names: string[]; others: number } {
  const names = run.players ?? [];
  const fromShot = run.playersFromScreenshot === true || run.squadReads !== undefined;
  const known = fromShot ? names.length + 1 : names.length;
  const size = run.squadSize ?? (fromShot ? (run.squadReads?.length ?? 0) + 1 : names.length);
  return { names, others: Math.max(0, size - known) };
}

/** Whether a squad player's name contains the (lowercased) search term. */
export function levelCapRunHasPlayer(run: { players?: string[] }, term: string): boolean {
  return (run.players ?? []).some((name) => name.toLowerCase().includes(term));
}

/** The search terms that name a player on at least one of these runs. */
export function levelCapPlayerTerms(
  runs: ReadonlyArray<{ players?: string[] }>,
  terms: readonly string[],
): string[] {
  return terms.filter((term) => runs.some((run) => levelCapRunHasPlayer(run, term)));
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
