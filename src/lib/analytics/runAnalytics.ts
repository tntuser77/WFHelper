import type {
  LevelCapItem,
  LevelCapNamedBuild,
  LevelCapRun,
} from "../../../config/shared/levelCapTypes.js";

export const ANALYTICS_MEASURES = ["runs", "exolizersAvg", "exolizersBest", "durationAvg"] as const;
export type AnalyticsMeasure = (typeof ANALYTICS_MEASURES)[number];

const ANALYTICS_TIME_SPLITS = ["week", "month"] as const;

export const ANALYTICS_SPLITS = [
  ...ANALYTICS_TIME_SPLITS,
  "frame",
  "build",
  "tag",
  "primary",
  "secondary",
  "melee",
  "companion",
  "squadmate",
  "squadmateFrame",
  "squad",
] as const;
export type AnalyticsSplit = (typeof ANALYTICS_SPLITS)[number];

export const ANALYTICS_CHARTS = ["columns", "line", "ranked", "stat", "table"] as const;
export type AnalyticsChartKind = (typeof ANALYTICS_CHARTS)[number];

export const ANALYTICS_RANGES = ["all", "30d", "90d", "365d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ANALYTICS_SQUAD_FILTERS = ["all", "solo", "squad"] as const;
export type AnalyticsSquadFilter = (typeof ANALYTICS_SQUAD_FILTERS)[number];

/** One card on the dashboard. Only level cap runs exist as a source so far. */
export interface AnalyticsChartSpec {
  id: string;
  /** Empty means the card names itself from what it counts. */
  title: string;
  source: "levelCap";
  measure: AnalyticsMeasure;
  splitBy: AnalyticsSplit;
  /** Second split drawn as stacked segments or several lines; never a time split. */
  seriesBy: AnalyticsSplit | null;
  chart: AnalyticsChartKind;
  range: AnalyticsRange;
  squad: AnalyticsSquadFilter;
  /** Frames to keep; empty keeps every frame. */
  frames: string[];
  /** Categories shown before the rest fold into "Other"; time splits never fold. */
  limit: number;
  wide: boolean;
}

/** The theme has six chart colours, so five series plus "Other". */
const ANALYTICS_MAX_SERIES = 5;

// Keys the UI swaps for translated labels.
export const ANALYTICS_OTHER = "\u0000other";
export const ANALYTICS_UNKNOWN = "\u0000unknown";
export const ANALYTICS_SOLO = "\u0000solo";
export const ANALYTICS_SQUAD = "\u0000squad";

export function isAnalyticsTimeSplit(split: AnalyticsSplit | null): split is "week" | "month" {
  return split === "week" || split === "month";
}

export interface AnalyticsContext {
  builds: readonly LevelCapNamedBuild[];
  itemName: (item: LevelCapItem) => string;
  now: number;
}

export interface AnalyticsResult {
  /** Time buckets oldest first ("2026-09-21" weeks start on Monday, "2026-09"
   *  months), or categories best first with "Other" last. */
  categories: string[];
  /** A single "" when the chart has no second split. */
  series: string[];
  /** [series][category]; null where no run gave the measure a value. */
  values: Array<Array<number | null>>;
  /** Per category over every series; a run in two series counts once. */
  totals: Array<number | null>;
  total: number | null;
  runCount: number;
  time: boolean;
}

interface Acc {
  runs: number;
  sum: number;
  n: number;
  max: number | null;
}

const newAcc = (): Acc => ({ runs: 0, sum: 0, n: 0, max: null });

function measureOf(run: LevelCapRun, measure: AnalyticsMeasure): number | null {
  if (measure === "durationAvg") return run.durationSec;
  if (measure === "runs") return null;
  return run.exolizers;
}

function add(acc: Acc, run: LevelCapRun, measure: AnalyticsMeasure): void {
  acc.runs++;
  const value = measureOf(run, measure);
  if (value === null) return;
  acc.sum += value;
  acc.n++;
  acc.max = acc.max === null ? value : Math.max(acc.max, value);
}

function read(acc: Acc | undefined, measure: AnalyticsMeasure): number | null {
  if (!acc) return measure === "runs" ? 0 : null;
  if (measure === "runs") return acc.runs;
  if (measure === "exolizersBest") return acc.max;
  return acc.n ? acc.sum / acc.n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function monthKey(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function weekStart(time: number): Date {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function weekKey(time: number): string {
  const d = weekStart(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every bucket from the first to the last, so a quiet week still shows as zero. */
function timeBuckets(split: "week" | "month", times: number[]): string[] {
  if (!times.length) return [];
  const first = Math.min(...times);
  const last = Math.max(...times);
  const out: string[] = [];
  if (split === "week") {
    const end = weekKey(last);
    for (const d = weekStart(first); ; d.setDate(d.getDate() + 7)) {
      const key = weekKey(d.getTime());
      out.push(key);
      if (key >= end) break;
    }
  } else {
    const end = monthKey(last);
    const start = new Date(first);
    for (
      let d = new Date(start.getFullYear(), start.getMonth(), 1);
      ;
      d.setMonth(d.getMonth() + 1)
    ) {
      const key = monthKey(d.getTime());
      out.push(key);
      if (key >= end) break;
    }
  }
  return out;
}

/** Your own name: on every live run's squad list once there are two to compare. */
function selfNames(runs: readonly LevelCapRun[]): Set<string> {
  const live = runs.filter((run) => run.players?.length && !run.playersFromScreenshot);
  if (live.length < 2) return new Set();
  const counts = new Map<string, number>();
  for (const run of live)
    for (const name of new Set(run.players)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n === live.length).map(([name]) => name));
}

function squadKey(run: LevelCapRun): string {
  if (run.squadSize === 1) return ANALYTICS_SOLO;
  if (run.squadSize !== null && run.squadSize > 1) return ANALYTICS_SQUAD;
  return ANALYTICS_UNKNOWN;
}

type ValuesOf = (run: LevelCapRun) => string[];

function valuesFor(
  split: AnalyticsSplit,
  ctx: AnalyticsContext,
  runs: readonly LevelCapRun[],
): ValuesOf {
  const builds = new Map(ctx.builds.map((b) => [b.id, b]));
  switch (split) {
    case "week":
      return (run) => [weekKey(run.completedAt)];
    case "month":
      return (run) => [monthKey(run.completedAt)];
    case "frame":
      return (run) => [run.frame];
    case "build":
      return (run) => {
        const build = run.buildId ? builds.get(run.buildId) : undefined;
        return build ? [`${build.frame} · ${build.name}`] : [];
      };
    case "tag":
      return (run) => {
        const build = run.buildId ? builds.get(run.buildId) : undefined;
        return [...(build?.tags ?? []), ...(run.tags ?? [])];
      };
    case "primary":
    case "secondary":
    case "melee":
    case "companion":
      return (run) => {
        const item = run.build?.[split];
        return item ? [ctx.itemName(item)] : [];
      };
    case "squadmate": {
      const self = selfNames(runs);
      return (run) => (run.players ?? []).filter((name) => !self.has(name));
    }
    case "squadmateFrame":
      return (run) => (run.squadmates ?? []).map((mate) => mate.frame ?? ANALYTICS_UNKNOWN);
    case "squad":
      return (run) => [squadKey(run)];
  }
}

function keepRun(run: LevelCapRun, spec: AnalyticsChartSpec, now: number): boolean {
  if (spec.range !== "all") {
    const days = Number.parseInt(spec.range, 10);
    if (run.completedAt < now - days * 86_400_000) return false;
  }
  if (spec.squad === "solo" && run.squadSize !== 1) return false;
  if (spec.squad === "squad" && !(run.squadSize !== null && run.squadSize > 1)) return false;
  return !spec.frames.length || spec.frames.includes(run.frame);
}

/** The `limit` keys with the highest measure; the rest are what folds into "Other". */
function topKeys(
  runs: readonly LevelCapRun[],
  valuesOf: ValuesOf,
  measure: AnalyticsMeasure,
  limit: number,
): string[] {
  const accs = new Map<string, Acc>();
  for (const run of runs) {
    for (const key of new Set(valuesOf(run))) {
      const acc = accs.get(key) ?? newAcc();
      add(acc, run, measure);
      accs.set(key, acc);
    }
  }
  return [...accs]
    .sort(
      ([ak, a], [bk, b]) =>
        (read(b, measure) ?? -Infinity) - (read(a, measure) ?? -Infinity) ||
        b.runs - a.runs ||
        ak.localeCompare(bk),
    )
    .slice(0, Math.max(1, limit))
    .map(([key]) => key);
}

/** Folds a run's values onto the kept keys, "Other" standing in for the rest. */
function folded(values: string[], kept: Set<string> | null): string[] {
  const out = new Set<string>();
  for (const value of values) out.add(!kept || kept.has(value) ? value : ANALYTICS_OTHER);
  return [...out];
}

function hasOther(runs: readonly LevelCapRun[], valuesOf: ValuesOf, kept: Set<string>): boolean {
  return runs.some((run) => valuesOf(run).some((value) => !kept.has(value)));
}

/** Filters the runs, splits them and works out the measure for every cell. */
export function analyticsResult(
  runs: readonly LevelCapRun[],
  spec: AnalyticsChartSpec,
  ctx: AnalyticsContext,
): AnalyticsResult {
  const kept = runs.filter((run) => keepRun(run, spec, ctx.now));
  const time = isAnalyticsTimeSplit(spec.splitBy);
  const catValues = valuesFor(spec.splitBy, ctx, runs);
  const seriesBy = spec.seriesBy && !isAnalyticsTimeSplit(spec.seriesBy) ? spec.seriesBy : null;
  const seriesValues = seriesBy ? valuesFor(seriesBy, ctx, runs) : () => [""];

  let categories: string[];
  let catKept: Set<string> | null = null;
  if (time) {
    categories = timeBuckets(
      spec.splitBy as "week" | "month",
      kept.map((run) => run.completedAt),
    );
  } else {
    categories = topKeys(kept, catValues, spec.measure, spec.limit);
    catKept = new Set(categories);
    if (hasOther(kept, catValues, catKept)) categories.push(ANALYTICS_OTHER);
  }

  let series = [""];
  let seriesKept: Set<string> | null = null;
  if (seriesBy) {
    series = topKeys(kept, seriesValues, "runs", ANALYTICS_MAX_SERIES);
    seriesKept = new Set(series);
    if (hasOther(kept, seriesValues, seriesKept)) series.push(ANALYTICS_OTHER);
  }

  const cells = new Map<string, Acc>();
  const catTotals = new Map<string, Acc>();
  const overall = newAcc();
  for (const run of kept) {
    const cats = folded(catValues(run), catKept);
    if (!cats.length) continue;
    const sers = folded(seriesValues(run), seriesKept);
    add(overall, run, spec.measure);
    for (const cat of cats) {
      const total = catTotals.get(cat) ?? newAcc();
      add(total, run, spec.measure);
      catTotals.set(cat, total);
      for (const ser of sers) {
        const key = `${ser}\u0001${cat}`;
        const acc = cells.get(key) ?? newAcc();
        add(acc, run, spec.measure);
        cells.set(key, acc);
      }
    }
  }

  return {
    categories,
    series,
    values: series.map((ser) =>
      categories.map((cat) => read(cells.get(`${ser}\u0001${cat}`), spec.measure)),
    ),
    totals: categories.map((cat) => read(catTotals.get(cat), spec.measure)),
    total: overall.runs ? read(overall, spec.measure) : null,
    runCount: overall.runs,
    time,
  };
}
