import { describe, expect, it } from "vitest";

import type { LevelCapRun, LevelCapSquadmate } from "../../../config/shared/levelCapTypes.js";
import {
  mergedSquadFix,
  squadNameReview,
  squadReviewCount,
} from "../../../src/lib/analytics/squadNameReview.js";

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
const mate = (name: string | null, slot?: number, frame: string | null = "Titania") => ({
  name,
  portrait: null,
  frame,
  ...(slot === undefined ? {} : { slot }),
});

describe("squadNameReview", () => {
  it("groups cut-off names and lists rows missing a name or a frame", () => {
    const a = run([mate("yungunnaw…", 0), mate(null, 1)], {
      squadReads: [["yungunnaw..."], ["", " Fastr097@ "]],
      squadPortraits: [null, "fp"],
      // The crop spans 5% to 45% of the height, so 25% sits halfway down it.
      squadRows: [
        { top: 0.15, bottom: 0.17 },
        { top: 0.25, bottom: 0.29 },
      ],
    });
    const b = run([mate("yungunnaw…", 2), mate("WealthyPoet", 0, null), mate("Kemani", 1)], {
      squadReads: [["x"], ["y"], ["z"]],
    });
    const review = squadNameReview([a, b]);
    expect(review.cutOff).toEqual([
      {
        name: "yungunnaw…",
        rows: [
          { run: a, slot: 0 },
          { run: b, slot: 2 },
        ],
      },
    ]);
    expect(review.missing.map((entry) => entry.run.id)).toEqual([b.id, a.id]);
    const [row] = review.missing[1].rows;
    expect(row).toMatchObject({ slot: 1, name: null, frame: "Titania", read: "Fastr097@" });
    expect(row.portrait).toBe("fp");
    expect(row.box?.top).toBeCloseTo(50);
    expect(row.box?.height).toBeCloseTo(10);
    expect(review.missing[0].rows[0]).toMatchObject({ name: "WealthyPoet", frame: null });
    expect(review.known).toEqual(["Kemani", "WealthyPoet"]);
    expect(squadReviewCount([a, b])).toBe(4);
  });

  it("gives a row added by hand no read, portrait or place on the picture", () => {
    const added = run([mate(null, 3, null)], {
      squadReads: [["a"]],
      squadPortraits: ["fp"],
      squadRows: [{ top: 0.2, bottom: 0.22 }],
    });
    expect(squadNameReview([added]).missing[0].rows[0]).toMatchObject({
      read: null,
      portrait: null,
      box: null,
    });
  });

  it("skips runs without a screenshot and rows saved before slots", () => {
    const review = squadNameReview([
      run([mate(null, 0)], { screenshot: null }),
      run([mate(null), mate("Cut…")]),
    ]);
    expect(review).toEqual({ cutOff: [], missing: [], known: [] });
  });

  it("keeps what was already set by hand when adding to a row's fix", () => {
    const fixed = run([mate(null, 1, "Vauban")], {
      squadFixes: [{ slot: 1, frame: "Vauban" }],
    });
    expect(mergedSquadFix(fixed, 1, { name: "TimeToReap" })).toEqual({
      name: "TimeToReap",
      frame: "Vauban",
    });
    expect(mergedSquadFix(fixed, 0, { frame: "Mesa" })).toEqual({ frame: "Mesa" });
  });
});
