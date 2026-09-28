import { describe, expect, it } from "vitest";

import type { LevelCapRun, LevelCapSquadmate } from "../../../config/shared/levelCapTypes.js";
import { namedSquadFix, squadNameReview } from "../../../src/lib/analytics/squadNameReview.js";

let seq = 0;
function run(squadmates: LevelCapSquadmate[], overrides: Partial<LevelCapRun> = {}): LevelCapRun {
  return {
    id: `r${seq}`,
    completedAt: seq++,
    frame: "Dante",
    frameType: null,
    source: "import",
    exolizers: 108,
    durationSec: null,
    squadSize: squadmates.length + 1,
    tile: null,
    archgunUsed: false,
    build: null,
    screenshot: "shot.png",
    squadmates,
    ...overrides,
  };
}
const mate = (name: string | null, slot?: number, frame: string | null = null) => ({
  name,
  portrait: null,
  frame,
  ...(slot === undefined ? {} : { slot }),
});

describe("squadNameReview", () => {
  it("groups cut-off names and lists unnamed rows, newest run first", () => {
    const a = run([mate("yungunnaw…", 0), mate(null, 1, "Titania")], {
      squadReads: [["yungunnaw..."], ["", " Fastr097@ "]],
    });
    const b = run([mate("yungunnaw…", 2), mate("WealthyPoet", 0), mate("Kemani", 1)]);
    const c = run([mate(null, 0), mate("WealthyPoet", 1)]);
    const review = squadNameReview([a, b, c]);
    expect(review.cutOff).toEqual([
      {
        name: "yungunnaw…",
        rows: [
          { run: a, slot: 0 },
          { run: b, slot: 2 },
        ],
      },
    ]);
    expect(review.unnamed.map((entry) => [entry.run.id, entry.rows])).toEqual([
      [c.id, [{ slot: 0, frame: null, read: null }]],
      [a.id, [{ slot: 1, frame: "Titania", read: "Fastr097@" }]],
    ]);
    expect(review.known).toEqual(["WealthyPoet", "Kemani"]);
  });

  it("skips runs without a screenshot and rows saved before slots", () => {
    const review = squadNameReview([
      run([mate(null, 0)], { screenshot: null }),
      run([mate(null), mate("Cut…")]),
    ]);
    expect(review).toEqual({ cutOff: [], unnamed: [], known: [] });
  });

  it("keeps a frame already set by hand when naming a row", () => {
    const fixed = run([mate(null, 1, "Vauban")], {
      squadFixes: [{ slot: 1, frame: "Vauban" }],
    });
    expect(namedSquadFix(fixed, 1, "TimeToReap")).toEqual({ name: "TimeToReap", frame: "Vauban" });
    expect(namedSquadFix(fixed, 0, "Kemani")).toEqual({ name: "Kemani" });
  });
});
