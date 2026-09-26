import { expect, test } from "@playwright/test";

import { snapshotBuildForFrame } from "../services/levelCapBuild";
import { levelCapInventory } from "../tests/fixtures/levelcap/inventory";
import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const DANTE = "/Lotus/Powersuits/Pagemaster/Pagemaster";

/** A version 1 index as the screenshot import left it: guessed builds, no named ones. */
function legacyIndex() {
  const build = snapshotBuildForFrame(levelCapInventory(), DANTE);
  const run = (id: string, day: number) => ({
    id,
    completedAt: new Date(2026, 8, day, 21).getTime(),
    frame: "Dante",
    frameType: DANTE,
    source: "import",
    exolizers: null,
    durationSec: null,
    squadSize: null,
    tile: null,
    archgunUsed: false,
    build,
    buildUnverified: true,
    screenshot: null,
  });
  return { schemaVersion: 1, runs: [run("a", 20), run("b", 21), run("c", 22)] };
}

test("level cap runs move onto named builds that edit in one place", async () => {
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-level-cap-builds-", {
      inventory: levelCapInventory(),
      userDataFiles: { "level-cap-runs.json": legacyIndex() },
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { page } = harness;
    await setLayoutViewport(page, 1400, 1000);
    await page.locator('#sidebar [data-view="arbi"]').click();

    await page.locator('[data-level-cap-frame="Dante"]').click();
    const modal = page.locator('[data-level-cap-modal="Dante"]');
    await expect(modal).toBeVisible();
    // The three guesses were identical, so migration made one build that still needs a check.
    const builds = modal.locator("[data-level-cap-builds]");
    await expect(builds).toContainText("Build A");
    await expect(builds).toContainText("Needs a check");
    await modal.screenshot({ path: test.info().outputPath("frame-popup.png") });

    // A caster variant starts as a copy, then only the focus changes.
    await builds.getByRole("button", { name: "+ New build" }).click();
    await builds.getByRole("button", { name: "Copy of Build A" }).click();
    const editor = modal.locator("[data-level-cap-build-editor]");
    await expect(editor).toBeVisible();
    await expect(editor.locator('[data-level-cap-slot="suit"]')).toBeVisible();
    await editor.getByRole("textbox").first().fill("Caster");
    await editor.locator("select").first().selectOption("zenurik");
    await editor
      .locator('[data-level-cap-slot="suit"] button', { hasText: "Empty" })
      .first()
      .click();
    const picker = editor.locator("[data-level-cap-picker]");
    await picker.locator("input").fill("streamline");
    await expect(picker.getByRole("button", { name: "Streamline", exact: true })).toBeVisible();
    await editor.screenshot({ path: test.info().outputPath("build-editor.png") });
    await picker.getByRole("button", { name: "Streamline", exact: true }).click();
    await editor.getByRole("button", { name: /^Save/ }).click();
    await expect(builds).toContainText("Caster");

    // Two runs go to the caster build, the third is confirmed on Build A.
    const rows = modal.locator("ul > li");
    await rows.nth(0).locator("select").selectOption({ label: "Caster" });
    await rows.nth(1).locator("select").selectOption({ label: "Caster" });
    await rows
      .nth(2)
      .getByRole("button", { name: /Confirm/ })
      .click();
    await expect(builds).not.toContainText("Needs a check");
    await modal.screenshot({ path: test.info().outputPath("frame-popup-sorted.png") });

    const saved = await page.evaluate(() => window.api.getLevelCap());
    const caster = saved.builds.find((b) => b.name === "Caster");
    expect(caster?.build.focus).toBe("zenurik");
    expect(saved.runs.filter((r) => r.buildId === caster?.id)).toHaveLength(2);
    expect(saved.runs.every((r) => !r.buildUnverified)).toBe(true);
    // Every run on the caster build carries the edited loadout.
    for (const run of saved.runs.filter((r) => r.buildId === caster?.id)) {
      expect(
        run.build?.suit?.upgrades.some((u) => u.type?.endsWith("/AvatarAbilityEfficiencyMod")),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
