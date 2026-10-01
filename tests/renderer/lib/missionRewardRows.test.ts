import { describe, expect, it } from "vitest";

import type { MissionRewardsStatus } from "../../../config/shared/missionRewardsTypes.js";
import { normalizeMarketName } from "../../../src/lib/marketNaming.js";
import {
  appendPage,
  applyMissionValuation,
  buildRewardRows,
  createPageLoader,
  freezeRows,
  matchRewardItemTypes,
  mergeFirstPage,
  missionPeriodStart,
  missionStatusText,
  missionTypeLabel,
  readyToFreeze,
  rewardRowTotals,
  type PageLoadMode,
  type RewardRowSources,
} from "../../../src/lib/missionRewardRows.js";
import type { MissionPool } from "../../../src/lib/missionRelicPool.js";
import type { ItemDbEntry } from "../../../src/types/inventory.js";

const FORMA_BP = "/Lotus/Types/Recipes/Components/FormaBlueprint";
const PLASTIDS = "/Lotus/Types/Items/MiscItems/Plastids";
const PRIME_PART = "/Lotus/Types/Recipes/WarframeRecipes/EmberPrimeChassisComponent";
const SET_ROOT = "/Lotus/Powersuits/Ember/EmberPrime";
const ARCANE = "/Lotus/Upgrades/CosmeticEnhancers/Offensive/ArcaneX";
const UNKNOWN = "/Lotus/Types/Items/MiscItems/SomeNewResource";

const DB: Record<string, ItemDbEntry> = {
  [FORMA_BP]: {
    name: "Forma Blueprint",
    displayName: "Forma-Blaupause",
    imageUrl: null,
    tradable: true,
  },
  [PLASTIDS]: { name: "Plastids", imageUrl: "https://assets/plastids.png" },
  [PRIME_PART]: {
    name: "Ember Prime Chassis",
    imageUrl: null,
    tradable: true,
    ducats: 45,
    vaulted: true,
  },
};

function sources(prices: Record<string, number>): RewardRowSources {
  return {
    db: DB,
    lookup: {
      [normalizeMarketName(FORMA_BP)]: { url_name: "forma_blueprint", gameRef: FORMA_BP },
      [normalizeMarketName(PRIME_PART)]: { url_name: "ember_prime_chassis", gameRef: PRIME_PART },
    },
    relics: null,
    priceOf: (key) => prices[key] ?? null,
  };
}

describe("mission reward rows", () => {
  it("counts a reward as platinum only when it sells for the trade floor or more", () => {
    const rows = buildRewardRows(
      [
        { uniqueName: PLASTIDS, count: 200 },
        { uniqueName: FORMA_BP, count: 2 },
        { uniqueName: PRIME_PART, count: 1 },
        { uniqueName: UNKNOWN, count: 3 },
      ],
      sources({ "forma_blueprint:rank-v3:r0": 30, ember_prime_chassis: 9 }),
    );

    expect(rows.map((row) => row.uniqueName)).toEqual([FORMA_BP, PRIME_PART, PLASTIDS, UNKNOWN]);
    expect(rows[0]).toMatchObject({ name: "Forma-Blaupause", platinum: 60, openable: true });
    expect(rows[1]).toMatchObject({ platinum: null, ducats: 45, vaulted: true, unpriced: false });
    expect(rows[3]).toMatchObject({ openable: false, platinum: null, unpriced: false });
    expect(rewardRowTotals(rows)).toEqual({ sellNow: 60, held: 0, ducats: 45, unpriced: 0 });
  });

  it("flags a tradable reward with no cached price as unpriced", () => {
    const [row] = buildRewardRows([{ uniqueName: PRIME_PART, count: 1 }], sources({}));
    expect(row).toMatchObject({ platinum: null, unpriced: true });
  });

  it("falls back to the bare slug price when no rank-0 price is cached", () => {
    const [row] = buildRewardRows(
      [{ uniqueName: FORMA_BP, count: 1 }],
      sources({ forma_blueprint: 25 }),
    );
    expect(row?.platinum).toBe(25);
  });

  it("leaves a ranked mod uncounted instead of using the bare slug price", () => {
    const ranked = sources({ forma_blueprint: 40 });
    ranked.lookup[normalizeMarketName(FORMA_BP)] = {
      url_name: "forma_blueprint",
      gameRef: FORMA_BP,
      maxRank: 5,
    };
    const [row] = buildRewardRows([{ uniqueName: FORMA_BP, count: 6 }], ranked);
    expect(row).toMatchObject({ platinum: null, unpriced: true });

    ranked.priceOf = (key) => (key === "forma_blueprint:rank-v3:r0" ? 30 : 40);
    expect(buildRewardRows([{ uniqueName: FORMA_BP, count: 6 }], ranked)[0]?.platinum).toBe(180);
  });

  it("values a cheap part at its share of a set worth trading", () => {
    const recipes = "/Lotus/Types/Recipes/WarframeRecipes";
    const blueprintSpelling = PRIME_PART.replace(/Component$/, "Blueprint");
    const set = sources({ ember_prime_chassis: 6, ember_prime_set: 80 });
    set.db = {
      ...DB,
      [blueprintSpelling]: DB[PRIME_PART],
      [SET_ROOT]: {
        name: "Ember Prime",
        imageUrl: null,
        components: [
          { name: "Blueprint", uniqueName: `${recipes}/EmberPrimeBlueprint` },
          { name: "Chassis", uniqueName: PRIME_PART },
          { name: "Neuroptics", uniqueName: `${recipes}/EmberPrimeHelmetComponent` },
          { name: "Systems", uniqueName: `${recipes}/EmberPrimeSystemsComponent` },
          { name: "Orokin Cell", uniqueName: "/Lotus/Types/Items/MiscItems/OrokinCell" },
        ],
      },
    };
    set.lookup[normalizeMarketName("Ember Prime Set")] = { url_name: "ember_prime_set" };
    set.lookup[normalizeMarketName(blueprintSpelling)] = {
      url_name: "ember_prime_chassis",
      gameRef: blueprintSpelling,
    };
    const reward = [{ uniqueName: blueprintSpelling, count: 6 }];

    expect(buildRewardRows(reward, set)[0]).toMatchObject({
      platinum: 120,
      sale: "held",
      unpriced: false,
    });

    set.priceOf = (key) => (key === "ember_prime_set" ? 24 : 6);
    expect(buildRewardRows(reward, set)[0]?.platinum).toBeNull();
  });

  describe("with a relic pool", () => {
    const recipes = "/Lotus/Types/Recipes/WarframeRecipes";
    const chassis = PRIME_PART.replace(/Component$/, "Blueprint");
    const others = [
      `${recipes}/EmberPrimeBlueprint`,
      `${recipes}/EmberPrimeHelmetComponent`,
      `${recipes}/EmberPrimeSystemsComponent`,
    ];

    function poolSources(pool: MissionPool): RewardRowSources {
      const set = sources({ ember_prime_chassis: 6, ember_prime_set: 80 });
      set.db = {
        ...DB,
        [chassis]: DB[PRIME_PART],
        [SET_ROOT]: {
          name: "Ember Prime",
          imageUrl: null,
          components: [
            { name: "Blueprint", uniqueName: others[0] },
            { name: "Chassis", uniqueName: PRIME_PART },
            { name: "Neuroptics", uniqueName: others[1] },
            { name: "Systems", uniqueName: others[2] },
          ],
        },
      };
      set.lookup[normalizeMarketName("Ember Prime Set")] = { url_name: "ember_prime_set" };
      set.lookup[normalizeMarketName(chassis)] = {
        url_name: "ember_prime_chassis",
        gameRef: chassis,
      };
      return { ...set, pool };
    }
    const reward = [{ uniqueName: chassis, count: 6 }];

    it("holds a part whose set the pool can finish", () => {
      const pool = { farmable: new Set(others), owned: new Map<string, number>() };
      expect(buildRewardRows(reward, poolSources(pool))[0]).toMatchObject({
        platinum: 120,
        sale: "held",
      });
    });

    it("leaves a part out when the rest of its set is neither farmed nor owned", () => {
      const pool = { farmable: new Set<string>(), owned: new Map<string, number>() };
      expect(buildRewardRows(reward, poolSources(pool))[0]).toMatchObject({
        platinum: null,
        sale: null,
      });
    });

    it("counts only as many copies as the scarcest unfarmed part allows", () => {
      const pool = {
        farmable: new Set(others.slice(1)),
        owned: new Map([[others[0], 2]]),
      };
      expect(buildRewardRows(reward, poolSources(pool))[0]).toMatchObject({
        platinum: 40,
        sale: "held",
      });
    });
  });

  it("puts a frozen estimate over the live rows", () => {
    const live = buildRewardRows(
      [{ uniqueName: FORMA_BP, count: 2 }],
      sources({ "forma_blueprint:rank-v3:r0": 30 }),
    );
    const rows = applyMissionValuation(live, {
      valuation: {
        at: 1,
        goldAtLeast: 37,
        items: [{ uniqueName: FORMA_BP, platinum: 44, sale: "now" }],
      },
    });
    expect(rows[0]).toMatchObject({ platinum: 44, sale: "now", frozen: true });
    expect(rewardRowTotals(rows).sellNow).toBe(44);
    expect(applyMissionValuation(live, {})[0]).toMatchObject({ platinum: 60, frozen: false });
  });

  it("freezes the valued rows and waits on unpriced ones until the grace runs out", () => {
    const rows = buildRewardRows(
      [
        { uniqueName: FORMA_BP, count: 2 },
        { uniqueName: PRIME_PART, count: 1 },
        { uniqueName: PLASTIDS, count: 9 },
      ],
      sources({ "forma_blueprint:rank-v3:r0": 30 }),
    );
    expect(freezeRows(rows, 37, 5)).toEqual({
      at: 5,
      goldAtLeast: 37,
      items: [
        { uniqueName: FORMA_BP, platinum: 60, sale: "now" },
        { uniqueName: PRIME_PART, platinum: 0, sale: null },
      ],
    });

    const read = { readAt: 1_000 };
    expect(readyToFreeze(read, rows, 1_000 + 60_000)).toBe(false);
    expect(readyToFreeze(read, rows, 1_000 + 31 * 60_000)).toBe(true);
    expect(
      readyToFreeze(
        read,
        rows.filter((row) => !row.unpriced),
        1_000,
      ),
    ).toBe(true);
  });

  it("values an arcane at its share of a maxed copy, with no trade floor", () => {
    const arcane = sources({ "arcane_x:rank-v3:r0": 2, "arcane_x:rank-v3:r5": 42, arcane_x: 42 });
    arcane.db = { ...DB, [ARCANE]: { name: "Arcane X", imageUrl: null, tradable: true } };
    arcane.lookup[normalizeMarketName(ARCANE)] = {
      url_name: "arcane_x",
      gameRef: ARCANE,
      maxRank: 5,
    };
    const reward = [{ uniqueName: ARCANE, count: 5 }];

    const rows = buildRewardRows(reward, arcane);
    expect(rows[0]).toMatchObject({ platinum: 10, sale: "held" });
    expect(rewardRowTotals(rows)).toMatchObject({ sellNow: 0, held: 10 });

    arcane.priceOf = (key) => (key === "arcane_x:rank-v3:r5" ? 21 : null);
    expect(buildRewardRows(reward, arcane)[0]).toMatchObject({ platinum: 5, sale: "held" });

    arcane.priceOf = () => null;
    expect(buildRewardRows(reward, arcane)[0]).toMatchObject({ platinum: null, unpriced: true });
  });

  it("searches shown, English and fallback names of recorded items only", () => {
    const recorded = [FORMA_BP, PLASTIDS, UNKNOWN];
    expect(matchRewardItemTypes(recorded, "blaupause", DB)).toEqual([FORMA_BP]);
    expect(matchRewardItemTypes(recorded, "FORMA", DB)).toEqual([FORMA_BP]);
    expect(matchRewardItemTypes(recorded, "new resource", DB)).toEqual([UNKNOWN]);
    expect(matchRewardItemTypes(recorded, "chassis", DB)).toEqual([]);
    expect(matchRewardItemTypes(recorded, "   ", DB)).toEqual([]);
  });

  it("labels mission types, including ones without a known name", () => {
    expect(missionTypeLabel("MT_SURVIVAL")).toBe("Survival");
    expect(missionTypeLabel("MT_BRAND_NEW")).toBe("Brand New");
    expect(missionTypeLabel(undefined)).toBeNull();
  });

  it("says a new read is in progress even after a failed one, and explains a failure", () => {
    const text = (status: Partial<MissionRewardsStatus> | null, platform = "win32") =>
      missionStatusText(
        status && { phase: "idle", pendingMissions: 0, ...status },
        (key) => key,
        platform,
      );
    expect(text({ phase: "reading", lastFailure: "no-fresh-copy" })).toBe(
      "dashboard.lastMission.reading",
    );
    expect(text({ blocked: "tracking-off", phase: "waiting" })).toBe(
      "dashboard.lastMission.trackingOff",
    );
    expect(text({ lastFailure: "access-denied" })).toBe(
      "dashboard.lastMission.readFailed titlebar.tooltip.accessDenied",
    );
    expect(text({ lastFailure: "access-denied" }, "linux")).toBe(
      "dashboard.lastMission.readFailed titlebar.tooltip.memoryBlocked",
    );
    expect(text({ lastFailure: "error" })).toBe("dashboard.lastMission.readFailed");
    expect(text({})).toBeNull();
    expect(text(null)).toBeNull();
  });

  it("starts a period at local midnight, a rolling window or never", () => {
    const now = new Date(2026, 8, 20, 15, 30).getTime();
    expect(missionPeriodStart("today", now)).toBe(new Date(2026, 8, 20).getTime());
    expect(missionPeriodStart("7d", now)).toBe(now - 7 * 86_400_000);
    expect(missionPeriodStart("30d", now)).toBe(now - 30 * 86_400_000);
    expect(missionPeriodStart("all", now)).toBeNull();
  });

  it("keeps every loaded row when a refreshed first page arrives", () => {
    const rows = (ids: string[]) => ids.map((id) => ({ id }));
    const loaded = rows(Array.from({ length: 250 }, (_, i) => `m${250 - i}`));
    const first = rows(["m252", "m251", ...Array.from({ length: 48 }, (_, i) => `m${250 - i}`)]);

    const merged = mergeFirstPage(loaded, first, 252);
    expect(merged).toHaveLength(252);
    expect(merged.slice(0, 3).map((row) => row.id)).toEqual(["m252", "m251", "m250"]);
    expect(merged[merged.length - 1]?.id).toBe("m1");
    expect(new Set(merged.map((row) => row.id)).size).toBe(252);
  });

  it("appends a later page without the rows a newly recorded mission pushed into it", () => {
    const rows = (ids: string[]) => ids.map((id) => ({ id }));
    expect(appendPage(rows(["m3", "m2"]), rows(["m2", "m1"]))).toEqual(rows(["m3", "m2", "m1"]));
  });

  it("starts over when the fresh page no longer meets the loaded rows", () => {
    const loaded = [{ id: "a" }, { id: "b" }];
    expect(mergeFirstPage(loaded, [{ id: "x" }, { id: "y" }], 10)).toEqual([
      { id: "x" },
      { id: "y" },
    ]);
    expect(mergeFirstPage([], [{ id: "x" }], 1)).toEqual([{ id: "x" }]);
  });
});

interface Row {
  id: string;
  missionType: string;
}

interface RowPage {
  summaries: Row[];
  matched: number;
}

function missionRows(prefix: string, count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    missionType: "MT_SURVIVAL",
  }));
}

function pageOf(rows: Row[], offset = 0, size = 50): RowPage {
  return { summaries: rows.slice(offset, offset + size), matched: rows.length };
}

/** The view's rows and page, with every query held until the test answers it. */
function pageList() {
  const view = {
    rows: [] as Row[],
    page: null as RowPage | null,
    failed: false,
    failedFilterChange: false,
  };
  const load = createPageLoader<Row, RowPage>({
    rows: () => view.rows,
    show: (rows, page) => {
      view.rows = rows;
      if (page) view.page = page;
      view.failed = false;
      view.failedFilterChange = false;
    },
    fail: (_error, rowsOutdated) => {
      view.failed = true;
      if (rowsOutdated) view.failedFilterChange = true;
    },
  });
  function request(mode: PageLoadMode) {
    let answer: (page: RowPage | null) => void = () => {};
    let refuse: (error: Error) => void = () => {};
    const query = new Promise<RowPage | null>((resolve, reject) => {
      answer = resolve;
      refuse = reject;
    });
    const done = load(mode, () => query);
    return {
      resolve: async (page: RowPage | null) => {
        answer(page);
        await done;
      },
      reject: async () => {
        refuse(new Error("query failed"));
        await done;
      },
    };
  }
  return { view, request };
}

describe("mission page loader", () => {
  // Two pages of every mission type are loaded, then the type filter narrows to survival.
  const ALL = missionRows("m", 60).map((row, i) =>
    i === 50 ? { ...row, missionType: "MT_DEFENSE" } : row,
  );
  const SURVIVAL = ALL.filter((row) => row.missionType === "MT_SURVIVAL");

  async function loadAll(): Promise<ReturnType<typeof pageList>> {
    const list = pageList();
    await list.request("replace").resolve(pageOf(ALL));
    await list.request("append").resolve(pageOf(ALL, 50));
    expect(list.view.rows).toEqual(ALL);
    return list;
  }

  it.each(["replacement", "refresh"])(
    "keeps only the new filter's rows when a refresh overlaps a filter change, %s answered first",
    async (earlier) => {
      const list = await loadAll();
      const replacement = list.request("replace");
      const refresh = list.request("merge");
      const [first, second] =
        earlier === "replacement" ? [replacement, refresh] : [refresh, replacement];
      await first.resolve(pageOf(SURVIVAL));
      await second.resolve(pageOf(SURVIVAL));
      expect(list.view.rows).toEqual(SURVIVAL.slice(0, 50));
      expect(list.view.page?.matched).toBe(59);

      await list.request("append").resolve(pageOf(SURVIVAL, 50));
      expect(list.view.rows).toEqual(SURVIVAL);
    },
  );

  it("recovers from a rejected filter change and ignores an earlier filter's late answer", async () => {
    const list = await loadAll();
    const superseded = list.request("replace");
    const replacement = list.request("replace");
    const refresh = list.request("merge");
    await replacement.reject();
    await refresh.resolve(pageOf(SURVIVAL));
    await superseded.resolve(pageOf(ALL));
    expect(list.view.rows).toEqual(SURVIVAL.slice(0, 50));
    expect(list.view.failed).toBe(false);

    await list.request("merge").reject();
    expect(list.view.failed).toBe(true);
    expect(list.view.rows).toEqual(SURVIVAL.slice(0, 50));
  });

  it("shows a rejected filter change as failed instead of the previous filter's rows", async () => {
    const list = await loadAll();
    await list.request("replace").reject();
    expect(list.view.failedFilterChange).toBe(true);

    await list.request("merge").reject();
    expect(list.view.failedFilterChange).toBe(true);

    await list.request("merge").resolve(pageOf(SURVIVAL));
    expect(list.view.rows).toEqual(SURVIVAL.slice(0, 50));
    expect(list.view).toMatchObject({ failed: false, failedFilterChange: false });

    await list.request("merge").reject();
    expect(list.view).toMatchObject({ failed: true, failedFilterChange: false });
  });

  it("drops a Load more sent before the new filter's first page arrived", async () => {
    // Pages of four: its offset counts the eight rows loaded under the previous filter.
    const previous = missionRows("p", 12);
    const next = missionRows("n", 10);
    const list = pageList();
    await list.request("replace").resolve(pageOf(previous, 0, 4));
    await list.request("append").resolve(pageOf(previous, 4, 4));
    const replacement = list.request("replace");
    const more = list.request("append");
    await replacement.resolve(pageOf(next, 0, 4));
    await more.resolve(pageOf(next, 8, 4));
    expect(list.view.rows).toEqual(next.slice(0, 4));

    await list.request("append").resolve(pageOf(next, 4, 4));
    expect(list.view.rows).toEqual(next.slice(0, 8));
  });
});
