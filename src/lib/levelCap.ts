import type {
  LevelCapBuild,
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

function itemKey(item: LevelCapItem | null): string {
  if (!item) return "-";
  const upgrades = item.upgrades
    .map((u) => `${u.slot}:${u.type ?? "?"}`)
    .sort()
    .join(",");
  const helminth = item.helminth ? `h${item.helminth.index}:${item.helminth.ability}` : "";
  const weapon = item.weapon ? `+${itemKey(item.weapon)}` : "";
  return `${item.type}[${upgrades}]${helminth}${weapon}`;
}

/** Identity of a build for grouping; ranks and the archgun are left out because
 * they change without the build meaningfully changing. */
export function levelCapBuildKey(build: LevelCapBuild | null): string {
  if (!build) return "";
  return [build.suit, build.primary, build.secondary, build.melee, build.companion]
    .map(itemKey)
    .concat(build.focus ?? "-")
    .join("|");
}

/** "A", "B", ... per distinct build, lettered in the order they were first run. */
export function levelCapBuildLabels(runs: readonly LevelCapRun[]): Map<string, string> {
  const labels = new Map<string, string>();
  const oldestFirst = [...runs].sort((a, b) => a.completedAt - b.completedAt);
  for (const run of oldestFirst) {
    const key = levelCapBuildKey(run.build);
    if (!key || labels.has(key)) continue;
    const n = labels.size;
    labels.set(key, n < 26 ? String.fromCharCode(65 + n) : `#${n + 1}`);
  }
  return labels;
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

/** Every tag used so far, most used first, for autocomplete. */
export function levelCapTagSuggestions(runs: readonly LevelCapRun[]): string[] {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const run of runs) {
    for (const tag of run.tags ?? []) {
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

type LevelCapUpgradeRole = "mod" | "aura" | "exilus" | "stance" | "arcane";

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
