import { expect, test, type Page } from "@playwright/test";

import { DB_GET_RELIC_DATABASE, SNAPSHOT_CACHE_LOAD } from "../config/shared/ipcChannels";
import { WFM_PRICE_BASIS } from "../config/shared/wfmStats";
import type { RelicDatabase, RelicQuality } from "../src/types/relics";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const QUALITIES: RelicQuality[] = ["intact", "exceptional", "flawless", "radiant"];
// Gold part slug -> its 48h price. Axi H5's part never gets a price.
const GOLD_PRICES: Record<string, number> = {
  gold_fixture_a1: 12,
  gold_fixture_b2: 40,
  gold_fixture_c3: 95,
};

const relics: RelicDatabase = { groups: {}, byUniqueName: {} };
const inventory = { Suits: [], LevelKeys: [] as { ItemType: string; ItemCount: number }[] };
for (const [tier, code, slug] of [
  ["Lith", "A1", "gold_fixture_a1"],
  ["Meso", "B2", "gold_fixture_b2"],
  ["Neo", "C3", "gold_fixture_c3"],
  ["Axi", "H5", "gold_fixture_h5"],
] as const) {
  const key = `${tier} ${code}`;
  relics.groups[key] = { key, name: key, tier, code, imageUrl: null, qualities: {} };
  for (const quality of QUALITIES) {
    const uniqueName = `/Lotus/Types/Game/Projections/${code}_${quality}`;
    relics.groups[key].qualities[quality] = {
      uniqueName,
      rewards: [
        {
          name: "Forma Blueprint",
          urlName: "forma_blueprint",
          rarity: "Common",
          chance: 25.33,
          ducats: 0,
        },
        { name: `${code} Gold Part`, urlName: slug, rarity: "Rare", chance: 2, ducats: 100 },
      ],
    };
    relics.byUniqueName[uniqueName] = { groupKey: key, quality };
    inventory.LevelKeys.push({ ItemType: uniqueName, ItemCount: quality === "intact" ? 3 : 0 });
  }
}

test.describe("relic planner gold filter", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-relic-gold-", { inventory });
    // The planner reads gold prices from the renderer's snapshot cache, so the
    // fixture prices go in through the disk snapshot it loads at startup.
    const now = Date.now();
    const snapshot = {
      version: 1,
      generatedAt: now,
      prices: Object.fromEntries(
        Object.entries(GOLD_PRICES).map(([slug, median]) => [
          slug,
          { status: "ok", median, timestamp: now, priceBasis: WFM_PRICE_BASIS },
        ]),
      ),
      meta: {},
      orderSummaries: {},
    };
    await evaluateInMain(
      harness.app,
      ({ ipcMain }, payload) => {
        for (const [channel, data] of [
          [payload.relicChannel, payload.relics],
          [payload.snapshotChannel, payload.snapshot],
        ] as const) {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, () => data);
        }
      },
      {
        relicChannel: DB_GET_RELIC_DATABASE,
        relics,
        snapshotChannel: SNAPSHOT_CACHE_LOAD,
        snapshot,
      },
    );
    page = harness.page;
    await page.reload();
    await setLayoutViewport(page, 1440, 900);
    await openView(page, "relics");
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("typed gold floor hides relics whose gold part sells for less", async () => {
    const gold = page.locator("[data-relic-gold-at-least]");
    const names = page.locator(".relic-row-name");
    await expect(names).toHaveText(["Lith A1", "Meso B2", "Neo C3", "Axi H5"]);

    await gold.fill("40");
    await expect(names).toHaveText(["Meso B2", "Neo C3"]);
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath("relic-gold-at-least-40.png"),
    });

    await gold.fill("41");
    await expect(names).toHaveText(["Neo C3"]);

    // Right-click clears the box and brings every relic back.
    await gold.click({ button: "right" });
    await expect(gold).toHaveValue("");
    await expect(names).toHaveText(["Lith A1", "Meso B2", "Neo C3", "Axi H5"]);
  });

  test("gold sort puts the priciest gold part first and unpriced last", async () => {
    const sort = page.locator('[data-tour="relic-filters"] .sort-control-select');
    const names = page.locator(".relic-row-name");
    await sort.selectOption("gold");
    await expect(names).toHaveText(["Neo C3", "Meso B2", "Lith A1", "Axi H5"]);
    // The card leads with the gold part and its price, not the relic's EV.
    const first = page.locator(".relic-compact-card").first();
    await expect(first.locator("[data-relic-gold-name]")).toHaveText("C3 Gold Part");
    await expect(first.locator(".relic-compact-head")).toContainText("95");
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath("relic-gold-sort.png"),
    });
  });
});
