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
const RIVEN_ID = "f1".padStart(24, "0");

/** The fixture loadout with an Akarius riven slotted on the Akarius Prime. */
function inventoryWithRiven(): Record<string, unknown> {
  const inventory = levelCapInventory();
  const roll = 0x3fffffff;
  (inventory.Upgrades as unknown[]).push({
    ItemId: { $oid: RIVEN_ID },
    ItemType: "/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare",
    UpgradeFingerprint: JSON.stringify({
      compat: "/Lotus/Weapons/Tenno/Pistols/SapientPistol/SapientPistol",
      lvl: 8,
      buffs: [{ Tag: "WeaponFireDamageMod", Value: Math.round(roll * 0.72) }],
      curses: [{ Tag: "WeaponFireRateMod", Value: Math.round(roll * 0.3) }],
    }),
  });
  const akarius = (inventory.Pistols as Array<{ Configs: Array<{ Upgrades: string[] }> }>)[0];
  akarius.Configs[0].Upgrades.push(RIVEN_ID);
  return inventory;
}

/** A version 1 index as the screenshot import left it: guessed builds, no named ones,
 * and rivens named without their stats. */
function legacyIndex(inventory: Record<string, unknown>) {
  const build = snapshotBuildForFrame(inventory, DANTE);
  for (const upgrade of build?.secondary?.upgrades ?? []) delete upgrade.riven;
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
    const inventory = inventoryWithRiven();
    harness = await launchElectronTestHarness("wfh-level-cap-builds-", {
      inventory,
      userDataFiles: { "level-cap-runs.json": legacyIndex(inventory) },
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

    // A caster variant starts as a copy, then only what differs changes.
    await builds.getByRole("button", { name: "+ New build" }).click();
    await builds.getByRole("button", { name: "Copy of Build A" }).click();
    const editor = modal.locator("[data-level-cap-build-editor]");
    const suit = editor.locator('[data-level-cap-slot="suit"]');
    await expect(suit.locator("[data-level-cap-mod-grid]")).toBeVisible();
    // The frame's in-game mod configs load straight from the inventory.
    const configs = suit.locator("[data-level-cap-configs]");
    await configs.getByRole("button", { name: "A", exact: true }).click();
    await expect(suit.locator('[data-level-cap-mod="aura"]')).toContainText("Empty");
    await configs.getByRole("button", { name: "Cap", exact: true }).click();
    await expect(suit.locator('[data-level-cap-mod="aura"]')).toContainText("Corrosive Projection");

    await editor.getByRole("textbox").first().fill("Caster");
    await editor.locator("select").first().selectOption("zenurik");

    await suit.locator(`[data-level-cap-mod="mod"]`, { hasText: "Empty" }).first().click();
    const picker = editor.locator("[data-level-cap-picker]");
    await picker.locator("input").fill("streamline");
    // A mod row shows its card text too, so the name alone is the row's identity.
    await picker
      .locator("li", { has: page.getByText("Streamline", { exact: true }) })
      .getByRole("button")
      .click();

    await suit.locator("[data-level-cap-helminth]").click();
    await picker.locator("input").fill("roar");
    await picker.getByRole("button", { name: "Roar", exact: true }).click();

    // Searching the effect picks the colour: casting speed is Amber.
    await suit.locator('[data-level-cap-shard="1"]').click();
    await picker.locator("input").fill("casting speed");
    await picker.getByRole("button").first().click();
    await expect(suit.locator('[data-level-cap-shard="1"]')).toContainText("Casting Speed");

    // The riven's stats came from the inventory though the old index lacked them.
    const secondary = editor.locator('[data-level-cap-slot="secondary"]');
    await secondary.getByRole("button", { expanded: false }).click();
    await expect(secondary.locator("[data-level-cap-mod]", { hasText: "Akarius " })).toContainText(
      "%",
    );
    await expect(secondary).not.toContainText("Akarius Akarius");
    await editor.screenshot({ path: test.info().outputPath("build-editor.png") });

    // A swapped-in weapon brings its own mods (none, unowned here), not the old weapon's.
    await secondary.getByRole("button", { name: "Change" }).click();
    await picker.locator("input").fill("lex prime");
    await picker.getByRole("button", { name: "Lex Prime", exact: true }).click();
    await expect(secondary).toContainText("Lex Prime");
    await expect(secondary).not.toContainText("Hornet Strike");
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
    expect(caster?.build.suit?.helminth?.ability).toMatch(/\/Rhino\//);
    expect(caster?.build.suit?.shards?.[1]).toEqual({
      color: "ACC_YELLOW_MYTHIC",
      type: "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeCastingSpeedMythic",
    });
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
