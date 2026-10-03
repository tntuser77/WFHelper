import { describe, expect, it } from "vitest";

import type { MarketStatPoint } from "../../../../config/shared/marketStats";
import {
  analyzeBaroFlip,
  baroFlipQuantity,
  planBaroFlips,
  type BaroFlipInput,
} from "../../../../src/lib/world/baroFlip";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 3);

function series(prices: readonly number[], volume = 48): MarketStatPoint[] {
  return prices.map((median, index) => ({
    source: "archive",
    time: NOW - (prices.length - 1 - index) * DAY,
    volume,
    median,
    movingAvg: null,
    avgPrice: null,
    openPrice: null,
    closedPrice: null,
    minPrice: null,
    maxPrice: null,
    donchTop: null,
    donchBot: null,
    rank: 0,
  }));
}

const flat = (days: number, price: number) => Array.from({ length: days }, () => price);
const climb = (days: number, from: number, to: number) =>
  Array.from({ length: days }, (_, i) => Math.round(from + ((to - from) * i) / (days - 1)));

describe("analyzeBaroFlip", () => {
  it("prices from the last recovery while the market is crashed", () => {
    // Calm at 60p, a visit crashes it, it climbs back to 50p, then Baro returns.
    const prices = [...flat(40, 60), ...flat(5, 30), ...climb(40, 30, 50), ...flat(5, 28)];
    const result = analyzeBaroFlip(series(prices), NOW);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.crashedNow).toBe(true);
    expect(result.baseline).toBe(60);
    expect(result.repeats).toBe(2);
    expect(result.fastRepeater).toBe(true);
    // 75th percentile of the climb, under its 50p top, minus the 2p undercut.
    expect(result.target).toBeGreaterThan(38);
    expect(result.target).toBeLessThan(48);
  });

  it("caps the target at the calm price", () => {
    const prices = [...flat(40, 40), ...flat(5, 20), ...climb(40, 20, 70)];
    const result = analyzeBaroFlip(series(prices), NOW);

    expect(result.kind === "ok" && result.target).toBe(38);
  });

  it("ignores a single spike day when picking the ceiling", () => {
    const prices = [...flat(40, 60), ...flat(5, 30), ...flat(30, 40)];
    prices[prices.length - 3] = 59;
    const result = analyzeBaroFlip(series(prices), NOW);

    expect(result.kind === "ok" && result.target).toBe(38);
  });

  it("skips mods that recover under the trade floor", () => {
    expect(analyzeBaroFlip(series(flat(60, 20)), NOW)).toEqual({
      kind: "skip",
      reason: "cheap",
      ceiling: 20,
    });
  });

  it("needs a month of history", () => {
    expect(analyzeBaroFlip(series(flat(20, 60)), NOW)).toEqual({
      kind: "skip",
      reason: "history",
    });
  });

  it("ignores ranked rows", () => {
    const ranked = series(flat(60, 200)).map((point) => ({ ...point, rank: 10 }));
    expect(analyzeBaroFlip([...ranked, ...series(flat(60, 40))], NOW)).toMatchObject({
      kind: "ok",
      target: 38,
    });
  });

  it("sizes from recovered volume and halves fast repeaters", () => {
    const result = analyzeBaroFlip(series(flat(60, 40), 48), NOW);
    if (result.kind !== "ok") throw new Error("expected ok");
    // 48 a day, 10% captured, 9 h a week for 4 weeks.
    expect(baroFlipQuantity(result, 9)).toBe(7);
    expect(baroFlipQuantity({ ...result, fastRepeater: true }, 9)).toBe(3);
  });
});

describe("planBaroFlips", () => {
  const ok = (target: number, hourlyRate: number) =>
    ({
      kind: "ok",
      baseline: target,
      ceiling: target,
      target,
      crashedNow: false,
      repeats: 0,
      fastRepeater: false,
      dailyVolume: 0,
      hourlyRate,
    }) as const;
  const mod = (name: string, ducats: number, target: number, owned = 0): BaroFlipInput => ({
    uniqueName: `/Lotus/${name}`,
    name,
    slug: name,
    ducats,
    credits: 100_000,
    owned,
    analysis: ok(target, 0.1),
  });

  it("spends ducats on the best platinum per ducat first and saves the rest", () => {
    // 0.1/h * 10 h * 4 weeks = 4 wanted each.
    const { rows, unspent } = planBaroFlips(
      [mod("Weak", 300, 30), mod("Strong", 300, 60)],
      1500,
      10,
    );
    const strong = rows.find((row) => row.name === "Strong")!;
    const weak = rows.find((row) => row.name === "Weak")!;

    expect(strong).toMatchObject({ buy: 4, limitedBy: "time", expectedPlat: 240 });
    expect(weak).toMatchObject({ buy: 1, limitedBy: "saved", creditCost: 100_000 });
    expect(unspent).toBe(0);
  });

  it("subtracts owned copies and plans by time without a balance", () => {
    const { rows, unspent } = planBaroFlips([mod("Owned", 300, 40, 3)], null, 10);

    expect(rows[0]).toMatchObject({ wanted: 4, need: 1, buy: 1 });
    expect(unspent).toBeNull();
  });

  it("buys nothing for skipped mods", () => {
    const { rows } = planBaroFlips(
      [{ ...mod("Skip", 300, 40), analysis: { kind: "skip", reason: "history" } }],
      5000,
      10,
    );

    expect(rows[0]).toMatchObject({ buy: 0, limitedBy: null, platPerDucat: null });
  });
});
