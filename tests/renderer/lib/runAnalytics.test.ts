import { describe, expect, it } from "vitest";

import type { LevelCapRun } from "../../../config/shared/levelCapTypes.js";
import {
  ANALYTICS_OTHER,
  ANALYTICS_SOLO,
  ANALYTICS_SQUAD,
  ANALYTICS_UNKNOWN,
  analyticsResult,
  analyticsSquadChoices,
  type AnalyticsChartSpec,
  type AnalyticsContext,
} from "../../../src/lib/analytics/runAnalytics.js";

const NOW = new Date(2026, 8, 27, 12).getTime();
const day = (month: number, date: number) => new Date(2026, month - 1, date, 20).getTime();

let seq = 0;
function run(overrides: Partial<LevelCapRun> = {}): LevelCapRun {
  return {
    id: `r${seq++}`,
    completedAt: day(9, 20),
    frame: "Dante",
    frameType: null,
    source: "hotkey",
    exolizers: 108,
    durationSec: 3600,
    squadSize: 1,
    tile: null,
    archgunUsed: false,
    build: null,
    screenshot: null,
    ...overrides,
  };
}

function spec(overrides: Partial<AnalyticsChartSpec> = {}): AnalyticsChartSpec {
  return {
    id: "c",
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
    ...overrides,
  };
}

const ctx: AnalyticsContext = { builds: [], itemName: (item) => item.type, now: NOW };

describe("analyticsResult", () => {
  it("ranks categories and folds the rest into Other", () => {
    const runs = [
      run({ frame: "Titania" }),
      run({ frame: "Titania" }),
      run({ frame: "Dante" }),
      run({ frame: "Mesa" }),
      run({ frame: "Saryn" }),
    ];
    const result = analyticsResult(runs, spec({ limit: 2 }), ctx);
    expect(result.categories).toEqual(["Titania", "Dante", ANALYTICS_OTHER]);
    expect(result.values).toEqual([[2, 1, 2]]);
    expect(result.total).toBe(5);
  });

  it("leaves excluded values out before ranking, so they never reach Other", () => {
    const runs = [
      run({ frame: "Titania" }),
      run({ frame: "Titania" }),
      run({ frame: "Mesa" }),
      run({ frame: "Saryn" }),
    ];
    const result = analyticsResult(runs, spec({ exclude: ["Titania"], limit: 1 }), ctx);
    expect(result.categories).toEqual(["Mesa", ANALYTICS_OTHER]);
    expect(result.values).toEqual([[1, 1]]);
  });

  it("shows every category when the limit is All", () => {
    const runs = ["A", "B", "C", "D", "E", "F", "G"].map((frame) => run({ frame }));
    expect(analyticsResult(runs, spec({ limit: 0 }), ctx).categories).toHaveLength(7);
  });

  it("totals Exolizers, skipping runs without a count", () => {
    const runs = [run({ exolizers: 110 }), run({ exolizers: 108 }), run({ exolizers: null })];
    const result = analyticsResult(runs, spec({ measure: "exolizersTotal", chart: "stat" }), ctx);
    expect(result.total).toBe(218);
  });

  it("stops a pie at five slices plus Other", () => {
    const runs = ["A", "B", "C", "D", "E", "F", "G"].map((frame) => run({ frame }));
    const result = analyticsResult(runs, spec({ chart: "donut", limit: 10 }), ctx);
    expect(result.categories).toHaveLength(6);
    expect(result.categories[5]).toBe(ANALYTICS_OTHER);
    expect(result.values[0][5]).toBe(2);
  });

  it("fills quiet weeks with zero and starts weeks on Monday", () => {
    // Tue 1 Sep and Sun 20 Sep 2026: weeks of Mon 31 Aug and Mon 14 Sep.
    const runs = [run({ completedAt: day(9, 1) }), run({ completedAt: day(9, 20) })];
    const result = analyticsResult(runs, spec({ splitBy: "week", chart: "columns" }), ctx);
    expect(result.categories).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(result.values).toEqual([[1, 0, 1]]);
  });

  it("stacks a second split without counting a run twice in the totals", () => {
    const runs = [
      run({ completedAt: day(8, 3), players: ["Kemani", "Alaric"], playersFromScreenshot: true }),
      run({ completedAt: day(9, 3), players: ["Kemani"], playersFromScreenshot: true }),
    ];
    const result = analyticsResult(
      runs,
      spec({ splitBy: "month", seriesBy: "squadmate", chart: "columns" }),
      ctx,
    );
    expect(result.categories).toEqual(["2026-08", "2026-09"]);
    expect(result.series).toEqual(["Kemani", "Alaric"]);
    expect(result.values).toEqual([
      [1, 1],
      [1, 0],
    ]);
    expect(result.totals).toEqual([1, 1]);
  });

  it("leaves your own name out of squadmates", () => {
    const runs = [
      run({ players: ["Me", "Kemani"], squadSize: 2 }),
      run({ players: ["Me", "Alaric"], squadSize: 2 }),
      run({ players: ["WealthyPoet"], playersFromScreenshot: true, squadSize: 2 }),
    ];
    const result = analyticsResult(runs, spec({ splitBy: "squadmate" }), ctx);
    expect(result.categories.sort()).toEqual(["Alaric", "Kemani", "WealthyPoet"]);
    // Solo runs have nobody to count, so the chart only covers squad runs.
    expect(result.runCount).toBe(3);
  });

  it("totals Exolizers per squadmate, crediting each run to everyone in it", () => {
    const runs = [
      run({ players: ["Me", "Kemani", "Alaric"], squadSize: 3, exolizers: 110 }),
      run({ players: ["Me", "Kemani"], squadSize: 2, exolizers: 120 }),
      run({ players: ["Me", "Alaric"], squadSize: 2, exolizers: null }),
    ];
    const result = analyticsResult(
      runs,
      spec({ measure: "exolizersTotal", splitBy: "squadmate" }),
      ctx,
    );
    expect(result.categories).toEqual(["Kemani", "Alaric"]);
    expect(result.totals).toEqual([230, 110]);
  });

  it("keeps only runs with every picked tag, from the build or the run", () => {
    const builds = [
      { id: "b1", frame: "Dante", name: "WP", tags: ["weapons platform"] },
    ] as unknown as AnalyticsContext["builds"];
    const runs = [
      run({ buildId: "b1", tags: ["melee"] }),
      run({ buildId: "b1", tags: ["primary"] }),
      run({ buildId: "b1", tags: ["melee"] }),
      run({ tags: ["melee"] }),
      run({ tags: ["weapons platform", "secondary"] }),
    ];
    const result = analyticsResult(
      runs,
      spec({
        splitBy: "tag",
        chart: "pie",
        tags: ["weapons platform"],
        exclude: ["weapons platform"],
      }),
      { ...ctx, builds },
    );
    expect(result.categories).toEqual(["melee", "primary", "secondary"]);
    expect(result.totals).toEqual([2, 1, 1]);
    expect(result.runCount).toBe(4);
  });

  it("names squadmates' frames and keeps unlabelled ones as unknown", () => {
    const runs = [
      run({
        squadmates: [
          { name: "A", portrait: "p1", frame: "Titania" },
          { name: "B", portrait: "p2", frame: null },
        ],
      }),
    ];
    const result = analyticsResult(runs, spec({ splitBy: "squadmateFrame" }), ctx);
    expect(result.categories.sort()).toEqual(["Titania", ANALYTICS_UNKNOWN].sort());
  });

  it("averages and takes the best Exolizer count, skipping runs without one", () => {
    const runs = [
      run({ exolizers: 110 }),
      run({ exolizers: 120 }),
      run({ exolizers: null }),
      run({ frame: "Mesa", exolizers: null }),
    ];
    const avg = analyticsResult(runs, spec({ measure: "exolizersAvg" }), ctx);
    expect(avg.categories).toEqual(["Dante", "Mesa"]);
    expect(avg.values).toEqual([[115, null]]);
    const best = analyticsResult(runs, spec({ measure: "exolizersBest", chart: "stat" }), ctx);
    expect(best.total).toBe(120);
  });

  it("filters by date range, squad and frame", () => {
    const runs = [
      run({ completedAt: day(5, 1) }),
      run({ squadSize: 3 }),
      run({ frame: "Mesa" }),
      run({ squadSize: null }),
    ];
    expect(analyticsResult(runs, spec({ range: "90d" }), ctx).total).toBe(3);
    expect(analyticsResult(runs, spec({ squad: "squad" }), ctx).total).toBe(1);
    expect(analyticsResult(runs, spec({ frames: ["Mesa"] }), ctx).total).toBe(1);
    const split = analyticsResult(runs, spec({ splitBy: "squad" }), ctx);
    expect(split.categories).toEqual([ANALYTICS_SOLO, ANALYTICS_SQUAD, ANALYTICS_UNKNOWN]);
  });

  it("names builds and gathers build and run tags", () => {
    const build = {
      id: "b1",
      frame: "Dante",
      name: "Build A",
      tags: ["caster"],
      build: {
        suit: null,
        primary: null,
        secondary: null,
        melee: null,
        archgun: null,
        companion: null,
        focus: null,
      },
    };
    const runs = [run({ buildId: "b1" }), run({ tags: ["comfy"] })];
    const withBuilds = { ...ctx, builds: [build] };
    expect(analyticsResult(runs, spec({ splitBy: "build" }), withBuilds).categories).toEqual([
      "Dante · Build A",
    ]);
    expect(analyticsResult(runs, spec({ splitBy: "tag" }), withBuilds).categories.sort()).toEqual([
      "caster",
      "comfy",
    ]);
  });

  describe("squad conditions", () => {
    const mate = (name: string | null, frame: string | null) => ({ name, portrait: null, frame });
    const runs = [
      run({ exolizers: 110, squadmates: [mate("xSavxage", "Dante"), mate("Poet", "Titania")] }),
      run({ exolizers: 118, squadmates: [mate("WealthyPoet", "Titania"), mate(null, "Titania")] }),
      run({ exolizers: 125, squadmates: [mate("WealthyPoet", "Titania")] }),
      run({ exolizers: 108, frame: "Dante", squadmates: [mate("HH_Saeed", "Mesa")] }),
    ];
    const titaniaNotPoet = {
      has: true,
      frame: "titania",
      player: "WealthyPoet",
      notPlayer: true,
    };

    it("counts the squadmates matching one condition, each one once", () => {
      const result = analyticsResult(
        runs,
        spec({ measure: "squadmates", chart: "stat", squadConditions: [titaniaNotPoet] }),
        ctx,
      );
      // Poet in the first run and the unnamed Titania in the second.
      expect(result.total).toBe(2);
      expect(result.runCount).toBe(2);
    });

    it("splits counted squadmates by who they were", () => {
      const result = analyticsResult(
        runs,
        spec({ measure: "squadmates", splitBy: "squadmate", squadConditions: [titaniaNotPoet] }),
        ctx,
      );
      expect(result.categories).toEqual(["Poet"]);
    });

    it("takes the best Exolizers of runs with someone on a frame", () => {
      const dante = { has: true, frame: "Dante", player: null, notPlayer: false };
      const best = analyticsResult(
        runs,
        spec({ measure: "exolizersBest", chart: "stat", squadConditions: [dante] }),
        ctx,
      );
      // Your own Dante run is not a squadmate on Dante.
      expect(best.total).toBe(110);
    });

    it("offers the frames and names seen in squads, most seen first", () => {
      expect(analyticsSquadChoices(runs)).toEqual({
        frames: ["Titania", "Dante", "Mesa"],
        players: ["WealthyPoet", "HH_Saeed", "Poet", "xSavxage"],
      });
    });

    it("keeps only runs without a matching squadmate when told to", () => {
      const noPoet = { has: false, frame: null, player: "wealthypoet", notPlayer: false };
      const result = analyticsResult(runs, spec({ chart: "stat", squadConditions: [noPoet] }), ctx);
      expect(result.total).toBe(2);
    });
  });
});
