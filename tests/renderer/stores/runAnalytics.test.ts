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
    store.updateAnalyticsChart({ ...charts[0], title: "Tags" });
    store.moveAnalyticsChart(1, 0);
    charts = get(store.analyticsCharts);
    expect(charts.map((c) => c.splitBy)).toEqual(["melee", "tag"]);
    expect(charts[1].title).toBe("Tags");
    store.removeAnalyticsChart(charts[0].id);
    expect(saved().charts.map((c: { splitBy: string }) => c.splitBy)).toEqual(["tag"]);
  });
});
