import { writable, type Readable } from "svelte/store";

import {
  ANALYTICS_CHARTS,
  ANALYTICS_COLS,
  ANALYTICS_HEIGHTS,
  ANALYTICS_MEASURES,
  ANALYTICS_RANGES,
  ANALYTICS_SPLITS,
  ANALYTICS_SQUAD_FILTERS,
  analyticsMeasureAddsUp,
  isAnalyticsPie,
  isAnalyticsTimeSplit,
  type AnalyticsChartSpec,
  type AnalyticsCols,
  type AnalyticsSquadCondition,
} from "../lib/analytics/runAnalytics.js";
import {
  compactLayout,
  flowLayout,
  layoutRowCount,
  placeInLayout,
  tidyLayout,
} from "../lib/analytics/dashboardLayout.js";
import { readStoredJson, writeStorage } from "../lib/persistence.js";

const RUN_ANALYTICS_STORAGE_KEY = "wf_run_analytics_v1";

const MAX_CHARTS = 40;
const MAX_TITLE = 80;
const MAX_CONDITIONS = 4;
/** 0 is "All": every category shown, the card scrolling instead of folding. */
export const ANALYTICS_LIMITS = [5, 10, 15, 25, 0] as const;

type ChartDraft = Omit<AnalyticsChartSpec, "id">;

const BLANK: ChartDraft = {
  title: "",
  source: "levelCap",
  measure: "runs",
  splitBy: "frame",
  seriesBy: null,
  chart: "ranked",
  range: "all",
  squad: "all",
  frames: [],
  tags: [],
  squadConditions: [],
  exclude: [],
  limit: 10,
  cols: 2,
  height: "normal",
  row: 0,
  col: 0,
};

/** What a fresh dashboard shows; ordinary cards once they are on it. */
const STARTER: ChartDraft[] = [
  { ...BLANK, splitBy: "week", chart: "columns", cols: 4 },
  { ...BLANK, splitBy: "squadmate" },
  { ...BLANK, splitBy: "squadmateFrame" },
  { ...BLANK, splitBy: "frame" },
  { ...BLANK, splitBy: "squad" },
  { ...BLANK, splitBy: "month", seriesBy: "frame", chart: "columns", cols: 4 },
];

export function newChartDraft(): ChartDraft {
  return structuredClone(BLANK);
}

function newId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function starterCharts(): AnalyticsChartSpec[] {
  return flowLayout(STARTER.map((draft) => ({ ...structuredClone(draft), id: newId() })));
}

function pick<T extends string | number | null>(
  allowed: readonly T[],
  raw: unknown,
  fallback: T,
): T {
  return (allowed as readonly unknown[]).includes(raw) ? (raw as T) : fallback;
}

/** A condition naming neither a frame nor a player matches everyone, so it is dropped. */
function normalizeCondition(raw: unknown): AnalyticsSquadCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : null);
  const frame = text(value.frame);
  const player = text(value.player);
  if (!frame && !player) return null;
  return {
    has: value.has !== false,
    frame,
    player,
    notPlayer: !!player && value.notPlayer === true,
  };
}

/** One card from storage; anything off the menu falls back to the blank card's choice. */
export function normalizeChartSpec(raw: unknown): AnalyticsChartSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  const splitBy = pick(ANALYTICS_SPLITS, value.splitBy, BLANK.splitBy);
  const seriesBy =
    value.seriesBy === null ? null : pick([...ANALYTICS_SPLITS, null], value.seriesBy, null);
  let chart = pick(ANALYTICS_CHARTS, value.chart, BLANK.chart);
  const measure = pick(ANALYTICS_MEASURES, value.measure, BLANK.measure);
  // A line needs time along the bottom; a pie needs a count to share out.
  if (chart === "line" && !isAnalyticsTimeSplit(splitBy)) chart = "columns";
  if (isAnalyticsPie(chart) && !analyticsMeasureAddsUp(measure)) chart = "ranked";
  // Ranked bars and a single number have nowhere to draw a second split.
  const stacks = chart === "columns" || chart === "line" || chart === "table";
  return {
    id: value.id.slice(0, 40),
    title: typeof value.title === "string" ? value.title.trim().slice(0, MAX_TITLE) : "",
    source: "levelCap",
    measure,
    splitBy,
    seriesBy:
      stacks && seriesBy && seriesBy !== splitBy && !isAnalyticsTimeSplit(seriesBy)
        ? seriesBy
        : null,
    chart,
    range: pick(ANALYTICS_RANGES, value.range, BLANK.range),
    squad: pick(ANALYTICS_SQUAD_FILTERS, value.squad, BLANK.squad),
    frames: Array.isArray(value.frames)
      ? value.frames.filter((f): f is string => typeof f === "string").slice(0, 100)
      : [],
    tags: Array.isArray(value.tags)
      ? [...new Set(value.tags.filter((t): t is string => typeof t === "string" && !!t))]
          .map((t) => t.slice(0, 64))
          .slice(0, 20)
      : [],
    squadConditions: Array.isArray(value.squadConditions)
      ? value.squadConditions.flatMap((c) => normalizeCondition(c) ?? []).slice(0, MAX_CONDITIONS)
      : [],
    exclude: Array.isArray(value.exclude)
      ? [...new Set(value.exclude.filter((v): v is string => typeof v === "string" && !!v))]
          .map((v) => v.slice(0, 64))
          .slice(0, 50)
      : [],
    limit: pick<number>(ANALYTICS_LIMITS, value.limit, BLANK.limit),
    // Cards saved before the four-column grid were half or full width.
    cols: pick<number>(ANALYTICS_COLS, value.cols, value.wide === true ? 4 : 2) as AnalyticsCols,
    height: pick(ANALYTICS_HEIGHTS, value.height, BLANK.height),
    // -1 until laid out: cards saved before positions existed have none.
    row: Number.isInteger(value.row) && (value.row as number) >= 0 ? (value.row as number) : -1,
    col: Number.isInteger(value.col) && (value.col as number) >= 0 ? (value.col as number) : -1,
  };
}

function normalizeCharts(parsed: unknown): AnalyticsChartSpec[] {
  const list = (parsed as { charts?: unknown })?.charts;
  if (!Array.isArray(list)) return starterCharts();
  const seen = new Set<string>();
  const charts = list
    .flatMap((raw) => {
      const spec = normalizeChartSpec(raw);
      if (!spec || seen.has(spec.id)) return [];
      seen.add(spec.id);
      return [spec];
    })
    .slice(0, MAX_CHARTS);
  // A dashboard from before positions keeps the order it had, laid out as it looked.
  return charts.some((c) => c.row < 0 || c.col < 0) ? flowLayout(charts) : tidyLayout(charts);
}

const store = writable<AnalyticsChartSpec[]>(
  readStoredJson(RUN_ANALYTICS_STORAGE_KEY, normalizeCharts, starterCharts),
);

function save(update: (charts: AnalyticsChartSpec[]) => AnalyticsChartSpec[]): void {
  store.update((charts) => {
    const next = update(charts);
    writeStorage(RUN_ANALYTICS_STORAGE_KEY, JSON.stringify({ version: 1, charts: next }));
    return next;
  });
}

export const analyticsCharts: Readable<AnalyticsChartSpec[]> = { subscribe: store.subscribe };

/** A new card starts a row of its own at the bottom. */
export function addAnalyticsChart(draft: ChartDraft): void {
  save((charts) => {
    if (charts.length >= MAX_CHARTS) return charts;
    const spec = normalizeChartSpec({ ...draft, id: newId(), row: layoutRowCount(charts), col: 0 });
    return spec ? [...charts, spec] : charts;
  });
}

/** Edits keep the card where it is; a wider card pushes what it now covers down a row. */
export function updateAnalyticsChart(spec: AnalyticsChartSpec): void {
  const clean = normalizeChartSpec(spec);
  if (!clean) return;
  save((charts) => {
    const old = charts.find((c) => c.id === clean.id);
    if (!old) return charts;
    const next = charts.map((c) =>
      c.id === clean.id ? { ...clean, row: old.row, col: old.col } : c,
    );
    return clean.cols === old.cols ? next : placeInLayout(next, clean.id, old.row, old.col);
  });
}

export function removeAnalyticsChart(id: string): void {
  save((charts) => compactLayout(charts.filter((c) => c.id !== id)));
}

/** Drops a card at a row and column; see placeInLayout for what it pushes aside. */
export function placeAnalyticsChart(id: string, row: number, col: number): void {
  save((charts) => placeInLayout(charts, id, row, col));
}

/** Moves a card one step with the arrow keys: a column sideways, or a row up or down. */
export function nudgeAnalyticsChart(id: string, rows: number, cols: number): void {
  save((charts) => {
    const card = charts.find((c) => c.id === id);
    if (!card || card.row + rows < 0) return charts;
    return placeInLayout(charts, id, card.row + rows, card.col + cols);
  });
}

export function resetAnalyticsCharts(): void {
  save(() => starterCharts());
}
