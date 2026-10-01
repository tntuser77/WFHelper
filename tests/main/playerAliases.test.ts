import { describe, expect, it } from "vitest";

import type { LevelCapRun } from "../../config/shared/levelCapTypes";
import {
  applyPlayerAliases,
  formatPlayerAliasLines,
  normalizePlayerAliases,
  parsePlayerAliasLines,
  playerAliasResolver,
} from "../../config/shared/playerAliases";

function run(extra: Partial<LevelCapRun>): LevelCapRun {
  return {
    id: "r1",
    frame: "Titania",
    completedAt: 1,
    frameType: null,
    exolizers: null,
    rounds: null,
    durationSec: null,
    squadSize: 4,
    tile: null,
    archgunUsed: false,
    build: null,
    screenshot: null,
    ...extra,
  } as LevelCapRun;
}

describe("player aliases", () => {
  it("keeps only name -> different name pairs", () => {
    expect(
      normalizePlayerAliases({ " Alt ": " Main ", same: "SAME", empty: "", n: 3, "": "x" }),
    ).toEqual({ Alt: "Main" });
    expect(normalizePlayerAliases(["Alt"])).toEqual({});
    expect(normalizePlayerAliases(null)).toEqual({});
  });

  it("resolves case-insensitively, follows chains and stops on a cycle", () => {
    const main = playerAliasResolver({ alt: "Renamed", renamed: "Main", a: "b", b: "a" });
    expect(main("ALT")).toBe("Main");
    expect(main("Stranger")).toBe("Stranger");
    expect(["a", "b"]).toContain(main("a"));
  });

  it("renames squad names and keeps the shown name as the alias", () => {
    const [out] = applyPlayerAliases(
      [
        run({
          players: ["Me", "PoetAlt", "WealthyPoet"],
          squadmates: [{ name: "PoetAlt", portrait: null, frame: "Ember" }],
          squadLog: [{ name: "PoetAlt", slot: 2, kills: 40 }],
        }),
      ],
      { poetalt: "WealthyPoet" },
    );
    expect(out.players).toEqual(["Me", "WealthyPoet"]);
    expect(out.squadmates).toEqual([
      { name: "WealthyPoet", alias: "PoetAlt", portrait: null, frame: "Ember" },
    ]);
    expect(out.squadLog).toEqual([{ name: "WealthyPoet", alias: "PoetAlt", slot: 2, kills: 40 }]);
  });

  it("leaves runs untouched when there are no aliases", () => {
    const runs = [run({ players: ["Me"] })];
    expect(applyPlayerAliases(runs, {})).toBe(runs);
  });

  it("round-trips the settings text, one line per main name", () => {
    const aliases = parsePlayerAliasLines("Main = Alt1, Alt2\nnot a line\nOther=Old\n = Orphan");
    expect(aliases).toEqual({ Alt1: "Main", Alt2: "Main", Old: "Other" });
    expect(formatPlayerAliasLines(aliases)).toBe("Main = Alt1, Alt2\nOther = Old");
  });
});
