import { writable, type Readable } from "svelte/store";

import {
  ANALYTICS_CHARTS,
  ANALYTICS_MEASURES,
  ANALYTICS_RANGES,
  ANALYTICS_SPLITS,
  ANALYTICS_SQUAD_FILTERS,
  analyticsMeasureCounts,
  isAnalyticsPie,
  isAnalyticsTimeSplit,
  type AnalyticsChartSpec,
  type AnalyticsSquadCondition,
} from "../lib/analytics/runAnalytics.js";
import { readStoredJson, writeStorage } from "../lib/persistence.js";

const RUN_ANALYTICS_STORAGE_KEY = "wf_run_analytics_v1";

const MAX_CHARTS = 40;
const MAX_TITLE = 80;
const MAX_CONDITIONS = 4;
export const ANALYTICS_LIMITS = [5, 10, 15, 25] as const;

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
  squadConditions: [],
  limit: 10,
  wide: false,
};

/** What a fresh dashboard shows; ordinary cards once they are on it. */
const STARTER: ChartDraft[] = [
  { ...BLANK, splitBy: "week", chart: "columns", wide: true },
  { ...BLANK, splitBy: "squadmate" },
  { ...BLANK, splitBy: "squadmateFrame" },
  { ...BLANK, splitBy: "frame" },
  { ...BLANK, splitBy: "squad" },
  { ...BLANK, splitBy: "month", seriesBy: "frame", chart: "columns", wide: true },
];

export function newChartDraft(): ChartDraft {
  return structuredClone(BLANK);
}

function newId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function starterCharts(): AnalyticsChartSpec[] {
  return STARTER.map((draft) => ({ ...structuredClone(draft), id: newId() }));
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
  if (isAnalyticsPie(chart) && !analyticsMeasureCounts(measure)) chart = "ranked";
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
    squadConditions: Array.isArray(value.squadConditions)
      ? value.squadConditions.flatMap((c) => normalizeCondition(c) ?? []).slice(0, MAX_CONDITIONS)
      : [],
    limit: pick<number>(ANALYTICS_LIMITS, value.limit, BLANK.limit),
    wide: value.wide === true,
  };
}

function normalizeCharts(parsed: unknown): AnalyticsChartSpec[] {
  const list = (parsed as { charts?: unknown })?.charts;
  if (!Array.isArray(list)) return starterCharts();
  const seen = new Set<string>();
  return list
    .flatMap((raw) => {
      const spec = normalizeChartSpec(raw);
      if (!spec || seen.has(spec.id)) return [];
      seen.add(spec.id);
      return [spec];
    })
    .slice(0, MAX_CHARTS);
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

export function addAnalyticsChart(draft: ChartDraft): void {
  const spec = normalizeChartSpec({ ...draft, id: newId() });
  if (spec) save((charts) => [...charts, spec].slice(0, MAX_CHARTS));
}

export function updateAnalyticsChart(spec: AnalyticsChartSpec): void {
  const clean = normalizeChartSpec(spec);
  if (clean) save((charts) => charts.map((c) => (c.id === clean.id ? clean : c)));
}

export function removeAnalyticsChart(id: string): void {
  save((charts) => charts.filter((c) => c.id !== id));
}

export function moveAnalyticsChart(from: number, to: number): void {
  save((charts) => {
    if (to < 0 || to >= charts.length || from === to) return charts;
    const next = [...charts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
}

export function resetAnalyticsCharts(): void {
  save(() => starterCharts());
}
