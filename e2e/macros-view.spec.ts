import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

let harness: ElectronTestHarness | undefined;
// Its own folder, so the tab never reads or writes the real Documents files.
const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-macros-e2e-"));
const script = path.join(scriptDir, "Warframe Macros.ahk");
const timings = path.join(scriptDir, "mexian_timings.ini");
const settingsIni = path.join(scriptDir, "warframe_macros.ini");

test.beforeAll(async () => {
  fs.writeFileSync(script, "#Requires AutoHotkey v2.0\n");
  fs.writeFileSync(settingsIni, `[Files]\r\nMexian=${timings}\r\n`);
  fs.writeFileSync(
    timings,
    "[Settings]\nactive = Obex\n\n[Default]\nswap = 0\nunblock = 40\njump = 70\nroll = 170\n\n[Obex]\nswap = 0\nunblock = 40\njump = 90\nroll = 210\n",
  );
  harness = await launchElectronTestHarness("macros-view-", {
    // The harness serialises each file itself.
    userDataFiles: { "macros.json": { script } },
  });
});

test.afterAll(async () => {
  await closeElectronTestHarness(harness);
  harness = undefined;
  fs.rmSync(scriptDir, { recursive: true, force: true });
});

test.describe("macros view", () => {
  test.skip(process.platform !== "win32", "AutoHotkey macros are Windows only");

  test("edits the script's ini files", async () => {
    const page = harness!.page;
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    await openView(page, "macros");

    const view = page.locator("[data-macros-view]");
    await expect(view.locator("[data-macro-profile]")).toHaveValue("Obex");
    await expect(view.locator('[data-macro-timing="roll"]')).toHaveValue("210");
    await expect(view.locator("[data-macros-status]")).toBeVisible();

    await view.locator('[data-macro="mexian"] input[type="checkbox"]').uncheck();
    await expect.poll(() => fs.readFileSync(settingsIni, "utf-8")).toContain("Enabled=0");

    const roll = view.locator('[data-macro-timing="roll"]');
    await roll.fill("230");
    await roll.press("Tab");
    await expect.poll(() => fs.readFileSync(timings, "utf-8")).toContain("roll = 230");

    await view.locator('[data-macro="mexian"] input[placeholder]').fill("Ceramic Dagger");
    await view.getByRole("button", { name: "New profile" }).click();
    await expect(view.locator("[data-macro-profile]")).toHaveValue("Ceramic Dagger");
    await expect
      .poll(() => fs.readFileSync(timings, "utf-8"))
      .toMatch(/active = Ceramic Dagger[\s\S]*\[Ceramic Dagger\]\r\nswap = 0/);

    await view.getByRole("button", { name: "Add step" }).click();
    await expect(view.locator("[data-macro-steps] li")).toHaveCount(4);
    await expect
      .poll(() => fs.readFileSync(settingsIni, "utf-8"))
      .toContain("Steps=e:80|[:50|[:50|[:0");

    await view.screenshot({ path: test.info().outputPath("macros-view.png") });
  });
});
