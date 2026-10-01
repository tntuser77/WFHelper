import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  setLayoutViewport,
} from "./electronTestHarness";

// Push-tier breadth check: one app launch opens every sidebar view and every
// header tab, so a view that throws on mount fails fast without the full suite.
test("every sidebar view and header tab mounts without a page error", async () => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const harness = await launchElectronTestHarness("wfh-views-mount-e2e-", {
    onPage: (page) => {
      page.on("pageerror", (error) => errors.push(error.message));
    },
  });
  try {
    const { page } = harness;
    await setLayoutViewport(page, 1440, 960);
    const views = await page
      .locator("#sidebar [data-view]")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-view")!));
    expect(views.length).toBeGreaterThan(5);

    for (const view of views) {
      await page.locator(`#sidebar [data-view="${view}"]`).click();
      const active = page.locator("#content .view.active");
      await expect(active, view).toBeVisible();
      const tabs = await active
        .locator("[data-tour-tab]")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-tour-tab")!));
      for (const tab of tabs) {
        const button = active.locator(`[data-tour-tab="${tab}"]`).first();
        if (!(await button.isVisible())) continue;
        await button.click();
        await expect(active, `${view}/${tab}`).toBeVisible();
      }
      expect(errors, view).toEqual([]);
    }
  } finally {
    await closeElectronTestHarness(harness);
  }
});
