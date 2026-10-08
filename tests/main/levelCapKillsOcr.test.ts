import { describe, expect, it } from "vitest";

import {
  findInkRuns,
  isTotalKillsLabel,
  looksLikeName,
  parseKillCount,
  pickColumns,
} from "../../services/levelCapKillsOcr";

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

describe("looksLikeName", () => {
  it("keeps names and drops stat rows a name box overlapped", () => {
    expect(looksLikeName("TNTUSER55")).toBe(true);
    expect(looksLikeName("-Uber-")).toBe(true);
    expect(looksLikeName("38%")).toBe(false);
    expect(looksLikeName("1,438")).toBe(false);
    expect(looksLikeName("")).toBe(false);
  });
});

describe("findInkRuns", () => {
  it("merges a number's digits and splits columns apart", () => {
    const profile = [0, 5, 6, 0, 4, 0, 0, 0, 0, 0, 7, 7, 0, 1, 0];
    expect(findInkRuns(profile, 3, 2)).toEqual([
      { start: 1, end: 4 },
      { start: 10, end: 11 },
    ]);
  });
});

describe("pickColumns", () => {
  const at = (x: number, confidence = 0.9) => ({ x, confidence });

  it("keeps the numbers on the squad's spacing and drops a stray between them", () => {
    const picked = pickColumns(
      [at(562), at(714, 0.6), at(855), at(1150), at(1442)],
      293.5,
      0.12,
      4,
    );
    expect(picked.map((p) => p.x)).toEqual([562, 855, 1150, 1442]);
  });

  it("keeps one number a column, the one nearest the spacing", () => {
    const picked = pickColumns([at(855), at(1128), at(1146)], 293.5, 0.12, 4);
    expect(picked.map((p) => p.x)).toEqual([855, 1146]);
  });

  it("takes a lone number for a solo run", () => {
    expect(pickColumns([at(920)], 293.5, 0.12, 4).map((p) => p.x)).toEqual([920]);
  });
});
