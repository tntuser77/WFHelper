import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir = "";

vi.mock("electron", () => ({ app: { getPath: () => tmpDir } }));
vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  freezeValuations,
  getValuations,
  loadValuations,
  reviveValuation,
  unloadValuations,
} from "../../services/missionValuations";

const PART = "/Lotus/Types/Recipes/WarframeRecipes/BansheePrimeChassisComponent";

function valuation(platinum: number, at = 1_000) {
  return {
    at,
    goldAtLeast: 37,
    items: [{ uniqueName: PART, platinum, sale: "held" }],
  };
}

describe("missionValuations", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mission-valuations-"));
    loadValuations();
  });

  afterEach(() => {
    unloadValuations();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("freezes an estimate once and keeps it across a restart", () => {
    const known = new Set(["a", "b"]);
    expect(freezeValuations([{ id: "a", valuation: valuation(20) }], known)).toBe(1);
    // A later read of newer prices cannot rewrite what the mission was worth.
    expect(freezeValuations([{ id: "a", valuation: valuation(99) }], known)).toBe(0);
    expect(getValuations().get("a")?.items[0]?.platinum).toBe(20);

    unloadValuations();
    loadValuations();
    expect(getValuations().get("a")?.items[0]).toMatchObject({ platinum: 20, sale: "held" });
  });

  it("skips missions that are not recorded and estimates that fail validation", () => {
    const known = new Set(["a"]);
    const broken = { at: 1, goldAtLeast: null, items: [{ uniqueName: PART, platinum: -5 }] };
    expect(
      freezeValuations(
        [
          { id: "unknown", valuation: valuation(20) },
          { id: "a", valuation: broken },
        ],
        known,
      ),
    ).toBe(0);
    expect(freezeValuations("nope", known)).toBe(0);
    expect(getValuations().size).toBe(0);
  });

  it("rounds platinum and normalizes the rule and the sale", () => {
    const revived = reviveValuation({
      at: 5,
      goldAtLeast: "soon",
      items: [{ uniqueName: PART, platinum: 12.6, sale: "later" }],
    });
    expect(revived).toEqual({
      at: 5,
      goldAtLeast: null,
      items: [{ uniqueName: PART, platinum: 13, sale: null }],
    });
  });

  it("moves an unreadable file aside and starts empty", () => {
    fs.writeFileSync(path.join(tmpDir, "mission-valuations.json"), "{not json");
    loadValuations();
    expect(getValuations().size).toBe(0);
    expect(fs.readdirSync(tmpDir).some((name) => name.includes(".corrupt-"))).toBe(true);
  });
});
