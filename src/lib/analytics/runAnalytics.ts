import type {
  LevelCapItem,
  LevelCapNamedBuild,
  LevelCapRun,
} from "../../../config/shared/levelCapTypes.js";

export const ANALYTICS_MEASURES = [
  "runs",
  "squadmates",
  "exolizersTotal",
  "exolizersAvg",
  "exolizersBest",
  "durationAvg",
] as const;
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

export const ANALYTICS_CHARTS = [
  "columns",
  "line",
  "ranked",
  "pie",
  "donut",
  "stat",
  "table",
] as const;
export type AnalyticsChartKind = (typeof ANALYTICS_CHARTS)[number];

export const ANALYTICS_RANGES = ["all", "30d", "90d", "365d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ANALYTICS_SQUAD_FILTERS = ["all", "solo", "squad"] as const;

/** Columns a card spans on the dashboard's four-column grid. */
export const ANALYTICS_COLS = [1, 2, 3, 4] as const;
export type AnalyticsCols = (typeof ANALYTICS_COLS)[number];

export const ANALYTICS_HEIGHTS = ["short", "normal", "tall"] as const;
export type AnalyticsHeight = (typeof ANALYTICS_HEIGHTS)[number];
export type AnalyticsSquadFilter = (typeof ANALYTICS_SQUAD_FILTERS)[number];

/** A run passes when it has (or, with `has` false, lacks) a squadmate matching
 *  every part that is set: the frame, and the player being or not being someone. */
export interface AnalyticsSquadCondition {
  has: boolean;
  frame: string | null;
  player: string | null;
  notPlayer: boolean;
}

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
  /** Frames you played to keep; empty keeps every frame. */
  frames: string[];
  /** Every one has to hold. The first `has` condition also picks which
   *  squadmates the "squadmates" measure counts. */
  squadConditions: AnalyticsSquadCondition[];
  /** Split values left out, e.g. "Operator" or a player's name. */
  exclude: string[];
  /** Categories shown before the rest fold into "Other"; 0 shows them all, and
   *  time splits never fold. */
  limit: number;
  cols: AnalyticsCols;
  /** How much room the card's chart gets; a list longer than that scrolls. */
  height: AnalyticsHeight;
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
  /** Runs behind the chart; with the "squadmates" measure, the runs they were in. */
  runCount: number;
  time: boolean;
}

interface Mate {
  name: string | null;
  frame: string | null;
}

/** What gets counted: a run, or one squadmate in it for the "squadmates" measure. */
interface Unit {
  run: LevelCapRun;
  mate: Mate | null;
}

interface Acc {
  runs: number;
  sum: number;
  n: number;
  max: number | null;
}

const newAcc = (): Acc => ({ runs: 0, sum: 0, n: 0, max: null });

const counts = (measure: AnalyticsMeasure) => measure === "runs" || measure === "squadmates";

/** Slices and stacks only make a whole when the measure counts or totals something. */
export function analyticsMeasureAddsUp(measure: AnalyticsMeasure): boolean {
  return counts(measure) || measure === "exolizersTotal";
}

export function isAnalyticsPie(chart: AnalyticsChartKind): boolean {
  return chart === "pie" || chart === "donut";
}

function measureOf(run: LevelCapRun, measure: AnalyticsMeasure): number | null {
  if (measure === "durationAvg") return run.durationSec;
  if (counts(measure)) return null;
  return run.exolizers;
}

function add(acc: Acc, { run }: Unit, measure: AnalyticsMeasure): void {
  acc.runs++;
  const value = measureOf(run, measure);
  if (value === null) return;
  acc.sum += value;
  acc.n++;
  acc.max = acc.max === null ? value : Math.max(acc.max, value);
}

function read(acc: Acc | undefined, measure: AnalyticsMeasure): number | null {
  if (!acc) return analyticsMeasureAddsUp(measure) ? 0 : null;
  if (counts(measure)) return acc.runs;
  if (measure === "exolizersBest") return acc.max;
  if (measure === "exolizersTotal") return acc.sum;
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

/** Squadmates off the screenshot, else the log's squad list minus you. */
function matesOf(run: LevelCapRun, self: Set<string>): Mate[] {
  if (run.squadmates?.length) return run.squadmates.map(({ name, frame }) => ({ name, frame }));
  return (run.players ?? [])
    .filter((name) => !self.has(name))
    .map((name) => ({ name, frame: null }));
}

const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();

function mateMatches(mate: Mate, condition: AnalyticsSquadCondition): boolean {
  if (condition.frame !== null && !same(mate.frame, condition.frame)) return false;
  if (condition.player === null) return true;
  return same(mate.name, condition.player) !== condition.notPlayer;
}

function squadKey(run: LevelCapRun): string {
  if (run.squadSize === 1) return ANALYTICS_SOLO;
  if (run.squadSize !== null && run.squadSize > 1) return ANALYTICS_SQUAD;
  return ANALYTICS_UNKNOWN;
}

type ValuesOf = (unit: Unit) => string[];

function valuesFor(
  split: AnalyticsSplit,
  ctx: AnalyticsContext,
  mates: (run: LevelCapRun) => Mate[],
): ValuesOf {
  const builds = new Map(ctx.builds.map((b) => [b.id, b]));
  // A counted squadmate splits by itself; a run by everyone in it.
  const each = ({ run, mate }: Unit) => (mate ? [mate] : mates(run));
  switch (split) {
    case "week":
      return ({ run }) => [weekKey(run.completedAt)];
    case "month":
      return ({ run }) => [monthKey(run.completedAt)];
    case "frame":
      return ({ run }) => [run.frame];
    case "build":
      return ({ run }) => {
        const build = run.buildId ? builds.get(run.buildId) : undefined;
        return build ? [`${build.frame} · ${build.name}`] : [];
      };
    case "tag":
      return ({ run }) => {
        const build = run.buildId ? builds.get(run.buildId) : undefined;
        return [...(build?.tags ?? []), ...(run.tags ?? [])];
      };
    case "primary":
    case "secondary":
    case "melee":
    case "companion":
      return ({ run }) => {
        const item = run.build?.[split];
        return item ? [ctx.itemName(item)] : [];
      };
    case "squadmate":
      return (unit) => each(unit).flatMap((mate) => (mate.name ? [mate.name] : []));
    case "squadmateFrame":
      return (unit) => each(unit).map((mate) => mate.frame ?? ANALYTICS_UNKNOWN);
    case "squad":
      return ({ run }) => [squadKey(run)];
  }
}

function keepRun(
  run: LevelCapRun,
  spec: AnalyticsChartSpec,
  now: number,
  mates: (run: LevelCapRun) => Mate[],
): boolean {
  if (spec.range !== "all") {
    const days = Number.parseInt(spec.range, 10);
    if (run.completedAt < now - days * 86_400_000) return false;
  }
  if (spec.squad === "solo" && run.squadSize !== 1) return false;
  if (spec.squad === "squad" && !(run.squadSize !== null && run.squadSize > 1)) return false;
  if (spec.frames.length && !spec.frames.includes(run.frame)) return false;
  return spec.squadConditions.every(
    (condition) => mates(run).some((mate) => mateMatches(mate, condition)) === condition.has,
  );
}

/** The `limit` keys with the highest measure; the rest are what folds into "Other". */
function topKeys(
  units: readonly Unit[],
  valuesOf: ValuesOf,
  measure: AnalyticsMeasure,
  limit: number,
): string[] {
  const accs = new Map<string, Acc>();
  for (const unit of units) {
    for (const key of new Set(valuesOf(unit))) {
      const acc = accs.get(key) ?? newAcc();
      add(acc, unit, measure);
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
    .slice(0, limit > 0 ? limit : undefined)
    .map(([key]) => key);
}

/** Folds a unit's values onto the kept keys, "Other" standing in for the rest. */
function folded(values: string[], kept: Set<string> | null): string[] {
  const out = new Set<string>();
  for (const value of values) out.add(!kept || kept.has(value) ? value : ANALYTICS_OTHER);
  return [...out];
}

function hasOther(units: readonly Unit[], valuesOf: ValuesOf, kept: Set<string>): boolean {
  return units.some((unit) => valuesOf(unit).some((value) => !kept.has(value)));
}

function mostSeenFirst(values: Array<string | null | undefined>): string[] {
  const seen = new Map<string, number>();
  for (const value of values) if (value) seen.set(value, (seen.get(value) ?? 0) + 1);
  return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

/** What squad conditions offer: squadmates' frames and names, most seen first. */
export function analyticsSquadChoices(runs: readonly LevelCapRun[]): {
  frames: string[];
  players: string[];
} {
  const self = selfNames(runs);
  const mates = runs.flatMap((run) => matesOf(run, self));
  return {
    frames: mostSeenFirst(mates.map((mate) => mate.frame)),
    players: mostSeenFirst(mates.map((mate) => mate.name)),
  };
}

/** Filters the runs, splits them and works out the measure for every cell. */
export function analyticsResult(
  runs: readonly LevelCapRun[],
  spec: AnalyticsChartSpec,
  ctx: AnalyticsContext,
): AnalyticsResult {
  const self = selfNames(runs);
  const mateCache = new Map<LevelCapRun, Mate[]>();
  const mates = (run: LevelCapRun): Mate[] => {
    let list = mateCache.get(run);
    if (!list) mateCache.set(run, (list = matesOf(run, self)));
    return list;
  };
  const kept = runs.filter((run) => keepRun(run, spec, ctx.now, mates));
  const focus = spec.squadConditions.find((condition) => condition.has);
  const units: Unit[] =
    spec.measure === "squadmates"
      ? kept.flatMap((run) =>
          mates(run)
            .filter((mate) => !focus || mateMatches(mate, focus))
            .map((mate) => ({ run, mate })),
        )
      : kept.map((run) => ({ run, mate: null }));
  // A single number counts everything that passed, split or not.
  const stat = spec.chart === "stat";
  const time = !stat && isAnalyticsTimeSplit(spec.splitBy);
  // Left-out values go before anything is ranked, so they never reach "Other".
  const drop = new Set(spec.exclude);
  const without = (of: ValuesOf): ValuesOf =>
    drop.size ? (unit) => of(unit).filter((value) => !drop.has(value)) : of;
  const catValues = stat ? () => [""] : without(valuesFor(spec.splitBy, ctx, mates));
  const seriesBy = spec.seriesBy && !isAnalyticsTimeSplit(spec.seriesBy) ? spec.seriesBy : null;
  const seriesValues = seriesBy ? without(valuesFor(seriesBy, ctx, mates)) : () => [""];

  let categories: string[];
  let catKept: Set<string> | null = null;
  if (time) {
    categories = timeBuckets(
      spec.splitBy as "week" | "month",
      units.map(({ run }) => run.completedAt),
    );
  } else {
    // A pie gets a colour per slice, so it stops where the palette does.
    const limit = isAnalyticsPie(spec.chart)
      ? Math.min(spec.limit || ANALYTICS_MAX_SERIES, ANALYTICS_MAX_SERIES)
      : spec.limit;
    categories = topKeys(units, catValues, spec.measure, limit);
    catKept = new Set(categories);
    if (hasOther(units, catValues, catKept)) categories.push(ANALYTICS_OTHER);
  }

  let series = [""];
  let seriesKept: Set<string> | null = null;
  if (seriesBy) {
    series = topKeys(units, seriesValues, "runs", ANALYTICS_MAX_SERIES);
    seriesKept = new Set(series);
    if (hasOther(units, seriesValues, seriesKept)) series.push(ANALYTICS_OTHER);
  }

  const cells = new Map<string, Acc>();
  const catTotals = new Map<string, Acc>();
  const overall = newAcc();
  const counted = new Set<LevelCapRun>();
  for (const unit of units) {
    const cats = folded(catValues(unit), catKept);
    if (!cats.length) continue;
    const sers = folded(seriesValues(unit), seriesKept);
    add(overall, unit, spec.measure);
    counted.add(unit.run);
    for (const cat of cats) {
      const total = catTotals.get(cat) ?? newAcc();
      add(total, unit, spec.measure);
      catTotals.set(cat, total);
      for (const ser of sers) {
        const key = `${ser}\u0001${cat}`;
        const acc = cells.get(key) ?? newAcc();
        add(acc, unit, spec.measure);
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
    runCount: counted.size,
    time,
  };
}
