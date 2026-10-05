import { describe, expect, it } from "vitest";

import { isTotalKillsLabel, parseKillCount } from "../../services/levelCapKillsOcr";

describe("parseKillCount", () => {
  it("reads a count, separators and all", () => {
    expect(parseKillCount("472")).toBe(472);
    expect(parseKillCount("3,055")).toBe(3055);
    expect(parseKillCount(" 1 478 ")).toBe(1478);
  });

  it("drops cells with junk or no number", () => {
    expect(parseKillCount("14788厂1")).toBeNull();
    expect(parseKillCount("")).toBeNull();
    expect(parseKillCount("48%")).toBeNull();
    expect(parseKillCount("9999999")).toBeNull();
  });
});

describe("isTotalKillsLabel", () => {
  it("knows the row through the usual misreads of the grey label", () => {
    expect(isTotalKillsLabel("Total Kills")).toBe(true);
    expect(isTotalKillsLabel("Total illo")).toBe(true);
    expect(isTotalKillsLabel("Totarkis")).toBe(true);
  });

  it("skips the other rows", () => {
    for (const label of [
      "Damage Dealt",
      "Damage Taken",
      "Headshot Kills",
      "Melee Kills",
      "Deaths",
    ]) {
      expect(isTotalKillsLabel(label)).toBe(false);
    }
  });
});
