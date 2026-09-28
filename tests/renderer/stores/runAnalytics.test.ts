import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "wf_run_analytics_v1";
let storage = new Map<string, string>();

// The store reads localStorage at import time, so each case imports it afresh.
async function freshStore(stored?: unknown) {
  storage = new Map(stored === undefined ? [] : [[KEY, JSON.stringify(stored)]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
  vi.resetModules();
  return import("../../../src/stores/runAnalytics.js");
}

const saved = () => JSON.parse(storage.get(KEY) ?? "null");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("run analytics dashboard store", () => {
  it("starts a fresh dashboard with the starter charts", async () => {
    const store = await freshStore();
    const charts = get(store.analyticsCharts);
    expect(charts.map((c) => c.splitBy)).toEqual([
      "week",
      "squadmate",
      "squadmateFrame",
      "frame",
      "squad",
      "month",
    ]);
    expect(new Set(charts.map((c) => c.id)).size).toBe(charts.length);
  });

  it("keeps an emptied dashboard empty", async () => {
    const store = await freshStore({ version: 1, charts: [] });
    expect(get(store.analyticsCharts)).toEqual([]);
  });

  it("cleans stored cards and drops broken ones", async () => {
    const store = await freshStore({
      version: 1,
      charts: [
        { id: "a", splitBy: "frame", chart: "line", seriesBy: "frame", limit: 7, title: " Mine " },
        { id: "a", splitBy: "tag" },
        { splitBy: "tag" },
        { id: "b", splitBy: "nonsense", seriesBy: "week", measure: "exolizersBest" },
        { id: "c", splitBy: "month", seriesBy: "frame", chart: "ranked" },
        { id: "d", splitBy: "month", seriesBy: "frame", chart: "line" },
        { id: "e", measure: "exolizersAvg", chart: "pie" },
        { id: "f", measure: "squadmates", chart: "donut" },
        {
          id: "g",
          measure: "exolizersTotal",
          chart: "pie",
          limit: 0,
          exclude: ["Operator", 3, "Operator"],
        },
        { id: "h", height: "tall" },
        { id: "i", height: "giant" },
        { id: "j", wide: true },
        { id: "k", cols: 3 },
        { id: "l", cols: 9 },
      ],
    });
    expect(get(store.analyticsCharts)).toMatchObject([
      { id: "a", chart: "columns", seriesBy: null, limit: 10, title: "Mine" },
      { id: "b", splitBy: "frame", seriesBy: null, measure: "exolizersBest" },
      // Ranked bars have nowhere to draw a second split; a line over time does.
      { id: "c", seriesBy: null },
      { id: "d", seriesBy: "frame" },
      // An average does not share out into slices; a count does.
      { id: "e", chart: "ranked" },
      { id: "f", chart: "donut" },
      // A total shares out too; "All" is a limit, and junk leaves the exclude list.
      { id: "g", chart: "pie", limit: 0, exclude: ["Operator"] },
      { id: "h", height: "tall" },
      { id: "i", height: "normal" },
      // Old full-width cards span all four columns.
      { id: "j", cols: 4 },
      { id: "k", cols: 3 },
      { id: "l", cols: 2 },
    ]);
  });

  it("keeps squad conditions that name a frame or a player", async () => {
    const store = await freshStore({
      version: 1,
      charts: [
        {
          id: "a",
          squadConditions: [
            { has: true, frame: " Titania ", player: "WealthyPoet", notPlayer: true },
            { has: false, frame: null, player: "", notPlayer: true },
            { frame: "Dante" },
            "junk",
          ],
        },
      ],
    });
    expect(get(store.analyticsCharts)[0].squadConditions).toEqual([
      { has: true, frame: "Titania", player: "WealthyPoet", notPlayer: true },
      { has: true, frame: "Dante", player: null, notPlayer: false },
    ]);
  });

  it("adds, edits, moves and removes cards and saves each change", async () => {
    const store = await freshStore({ version: 1, charts: [] });
    store.addAnalyticsChart({ ...store.newChartDraft(), splitBy: "tag" });
    store.addAnalyticsChart({ ...store.newChartDraft(), splitBy: "melee" });
    let charts = get(store.analyticsCharts);
    // Each new card starts its own row at the bottom.
    expect(charts.map((c) => [c.row, c.col])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    store.updateAnalyticsChart({ ...charts[0], title: "Tags" });
    store.placeAnalyticsChart(charts[1].id, 0, 2);
    charts = get(store.analyticsCharts);
    expect(charts.map((c) => [c.splitBy, c.row, c.col])).toEqual([
      ["tag", 0, 0],
      ["melee", 0, 2],
    ]);
    expect(charts[0].title).toBe("Tags");
    store.removeAnalyticsChart(charts[0].id);
    expect(saved().charts.map((c: { splitBy: string }) => c.splitBy)).toEqual(["melee"]);
  });

  it("lays out a dashboard saved before positions the way it used to flow", async () => {
    const store = await freshStore({
      version: 1,
      charts: [
        { id: "a", cols: 1 },
        { id: "b", cols: 2 },
        { id: "c", cols: 2 },
        { id: "d", cols: 1 },
      ],
    });
    expect(get(store.analyticsCharts).map((c) => [c.id, c.row, c.col])).toEqual([
      ["a", 0, 0],
      ["b", 0, 1],
      ["c", 1, 0],
      ["d", 1, 2],
    ]);
  });

  it("keeps gaps, and pushes a card a wider neighbour now covers down a row", async () => {
    const store = await freshStore({
      version: 1,
      charts: [
        { id: "a", cols: 1, row: 0, col: 0 },
        { id: "b", cols: 1, row: 0, col: 3 },
      ],
    });
    expect(get(store.analyticsCharts).map((c) => [c.id, c.row, c.col])).toEqual([
      ["a", 0, 0],
      ["b", 0, 3],
    ]);
    store.updateAnalyticsChart({ ...get(store.analyticsCharts)[0], cols: 4 });
    expect(get(store.analyticsCharts).map((c) => [c.id, c.row, c.col])).toEqual([
      ["a", 0, 0],
      ["b", 1, 3],
    ]);
  });

  it("nudges a card with the arrow keys, never above the top row", async () => {
    const store = await freshStore({
      version: 1,
      charts: [
        { id: "a", cols: 2, row: 0, col: 0 },
        { id: "b", cols: 2, row: 1, col: 0 },
      ],
    });
    store.nudgeAnalyticsChart("a", -1, 0);
    store.nudgeAnalyticsChart("b", 0, 1);
    expect(get(store.analyticsCharts).map((c) => [c.id, c.row, c.col])).toEqual([
      ["a", 0, 0],
      ["b", 1, 1],
    ]);
    store.nudgeAnalyticsChart("b", -1, 0);
    // "b" lands on "a", which moves down to the row "b" left.
    expect(get(store.analyticsCharts).map((c) => [c.id, c.row, c.col])).toEqual([
      ["b", 0, 1],
      ["a", 1, 0],
    ]);
  });
});
