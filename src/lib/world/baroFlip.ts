import type { MarketStatPoint } from "../../../config/shared/marketStats.js";

/*
 * Baro flip advisor, ported from relic tools (Documents/wfm/web/baro_flip.py).
 * Baro's primed mods crash on warframe.market each time he stocks them and climb
 * back over the following weeks. For each one this picks a list price from the
 * level the last recovery reached and a buy count from how many unranked copies
 * the market absorbs while the user is online.
 */

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 120;
const MIN_HISTORY_DAYS = 30;
/** A day at or below this share of the prior two weeks' peak starts a crash. */
const CRASH_RATIO = 0.7;
const CRASH_LOOKBACK_DAYS = 14;
/** Prices are still settling this long after a crash starts. */
const SETTLE_DAYS = 7;
const PRIOR_RECOVERY_DAYS = 60;
const REPEAT_WINDOW_DAYS = 90;
/** Share of the market's sales the user wins while online. */
const CAPTURE_SHARE = 0.1;
/** Every copy should be sold within this many weeks. */
const EXIT_WEEKS = 4;
const REPEAT_HALVE = 0.5;
const UNDERCUT = 2;
/** Below this a mod is not worth a trade slot. */
const MIN_TARGET = 25;
const CEILING_PERCENTILE = 0.75;

type BaroFlipAnalysis =
  | {
      kind: "ok";
      baseline: number;
      ceiling: number;
      target: number;
      crashedNow: boolean;
      repeats: number;
      fastRepeater: boolean;
      dailyVolume: number;
      hourlyRate: number;
    }
  | { kind: "skip"; reason: "history" | "recovery" }
  | { kind: "skip"; reason: "cheap"; ceiling: number };

interface Day {
  time: number;
  median: number;
  volume: number | null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * share;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** One rank 0 row per day, oldest first, inside the history window. */
function rankZeroDays(points: readonly MarketStatPoint[], now: number): Day[] {
  const byDay = new Map<number, Day>();
  const cutoff = now - HISTORY_DAYS * DAY_MS;
  for (const point of points) {
    if (point.rank !== 0 && point.rank !== null) continue;
    if (!(point.median > 0) || point.time < cutoff || point.time > now) continue;
    const day = Math.floor(point.time / DAY_MS);
    const existing = byDay.get(day);
    // WFM's own measurement beats the archive's copy of the same day.
    if (existing && point.source !== "wfm") continue;
    byDay.set(day, { time: point.time, median: point.median, volume: point.volume });
  }
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}

/** Start times of crashes; days within two weeks of a start belong to it. */
function findCrashes(days: readonly Day[]): number[] {
  const starts: number[] = [];
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const from = day.time - CRASH_LOOKBACK_DAYS * DAY_MS;
    let peak = 0;
    for (let back = index - 1; back >= 0 && days[back].time >= from; back -= 1)
      peak = Math.max(peak, days[back].median);
    if (peak === 0 || day.median > CRASH_RATIO * peak) continue;
    const last = starts[starts.length - 1];
    if (last !== undefined && day.time - last <= CRASH_LOOKBACK_DAYS * DAY_MS) continue;
    starts.push(day.time);
  }
  return starts;
}

function between(days: readonly Day[], from: number, to: number): Day[] {
  return days.filter((day) => day.time >= from && day.time < to);
}

/** The recovery before the latest crash: from the crash before it, or two months. */
function priorRecovery(days: readonly Day[], crashes: readonly number[]): Day[] {
  const anchor = crashes[crashes.length - 1];
  const prior = crashes[crashes.length - 2];
  const from =
    prior !== undefined ? prior + SETTLE_DAYS * DAY_MS : anchor - PRIOR_RECOVERY_DAYS * DAY_MS;
  return between(days, from, anchor);
}

export function analyzeBaroFlip(points: readonly MarketStatPoint[], now: number): BaroFlipAnalysis {
  const days = rankZeroDays(points, now);
  if (days.length < MIN_HISTORY_DAYS) return { kind: "skip", reason: "history" };

  const crashes = findCrashes(days);
  // Baseline is the calm price before the first crash. When the window opens mid
  // crash there is no such stretch, so the days clear of any crash stand in.
  const before = crashes.length ? days.filter((day) => day.time < crashes[0]) : days;
  const calm =
    before.length >= SETTLE_DAYS
      ? before.slice(-30)
      : days.filter((day) =>
          crashes.every(
            (start) => day.time < start || day.time >= start + CRASH_LOOKBACK_DAYS * DAY_MS,
          ),
        );
  const baseline = median((calm.length ? calm : days).map((day) => day.median));
  const crashedNow = days[days.length - 1].median <= CRASH_RATIO * baseline;

  let zone: Day[] = days;
  if (crashes.length) {
    const settled = between(days, crashes[crashes.length - 1] + SETTLE_DAYS * DAY_MS, Infinity);
    // Mid crash, or too soon after one to have climbed, the last recovery is the guide.
    zone = crashedNow || settled.length < 3 ? priorRecovery(days, crashes) : settled;
  }
  if (zone.length === 0) return { kind: "skip", reason: "recovery" };

  // A high percentile rather than the top day, so one thin spike can't set the price.
  const ceiling = Math.min(
    percentile(
      zone.map((day) => day.median),
      CEILING_PERCENTILE,
    ),
    baseline,
  );
  const target = Math.floor(ceiling - UNDERCUT);
  if (target < MIN_TARGET) return { kind: "skip", reason: "cheap", ceiling: round(ceiling) };

  const repeats = crashes.filter((start) => start >= now - REPEAT_WINDOW_DAYS * DAY_MS).length;
  // Sales in the recovered market, not the crash dump; days with no row sold nothing.
  const span = Math.max(1, Math.round((zone[zone.length - 1].time - zone[0].time) / DAY_MS) + 1);
  const dailyVolume = zone.reduce((sum, day) => sum + (day.volume ?? 0), 0) / span;
  return {
    kind: "ok",
    baseline: round(baseline),
    ceiling: round(ceiling),
    target,
    crashedNow,
    repeats,
    fastRepeater: repeats >= 2,
    dailyVolume: round(dailyVolume),
    hourlyRate: (dailyVolume * CAPTURE_SHARE) / 24,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Copies the user can sell within EXIT_WEEKS, halved when Baro restocks it often. */
export function baroFlipQuantity(
  analysis: Extract<BaroFlipAnalysis, { kind: "ok" }>,
  hoursPerWeek: number,
): number {
  const exit = Math.floor(analysis.hourlyRate * hoursPerWeek * EXIT_WEEKS);
  return analysis.fastRepeater ? Math.floor(exit * REPEAT_HALVE) : exit;
}

export interface BaroFlipInput {
  uniqueName: string;
  name: string;
  slug: string | null;
  ducats: number | null;
  credits: number | null;
  owned: number;
  analysis: BaroFlipAnalysis | null;
}

export interface BaroFlipRow extends BaroFlipInput {
  wanted: number;
  buy: number;
  /** Sells for too little platinum per ducat to be worth buying. */
  belowMinimum: boolean;
  platPerDucat: number | null;
  expectedPlat: number;
}

/**
 * Sizes every mod by how many copies sell in time, less the unranked copies already
 * owned. The ducat balance is left out on purpose: the user trades prime parts in
 * for ducats on demand, so the totals say how many ducats to raise instead. A mod
 * under minPerDucat buys nothing: its ducats earn more as the prime parts they come from.
 */
export function planBaroFlips(
  inputs: readonly BaroFlipInput[],
  hoursPerWeek: number,
  minPerDucat: number,
): { rows: BaroFlipRow[]; ducats: number; credits: number } {
  let ducats = 0;
  let credits = 0;
  const rows: BaroFlipRow[] = inputs.map((input) => {
    const analysis = input.analysis?.kind === "ok" ? input.analysis : null;
    const wanted = analysis ? baroFlipQuantity(analysis, hoursPerWeek) : 0;
    const platPerDucat = analysis && input.ducats ? analysis.target / input.ducats : null;
    const belowMinimum = platPerDucat !== null && platPerDucat < minPerDucat;
    const buy = belowMinimum ? 0 : Math.max(0, wanted - input.owned);
    ducats += (input.ducats ?? 0) * buy;
    credits += (input.credits ?? 0) * buy;
    return {
      ...input,
      wanted,
      buy,
      belowMinimum,
      platPerDucat,
      expectedPlat: (analysis?.target ?? 0) * buy,
    };
  });
  rows.sort((a, b) => b.expectedPlat - a.expectedPlat || a.name.localeCompare(b.name));
  return { rows, ducats, credits };
}
