import { describe, expect, it } from "vitest";

import {
  compactLayout,
  flowLayout,
  placeInLayout,
  tidyLayout,
  type LayoutBox,
} from "../../../src/lib/analytics/dashboardLayout.js";

const box = (id: string, row: number, col: number, cols: number): LayoutBox => ({
  id,
  row,
  col,
  cols,
});
const cells = (boxes: readonly LayoutBox[]) => boxes.map((b) => `${b.id}@${b.row},${b.col}`);

// The dashboard from the bug report: a quarter and a half with the pie in the
// gap at the top right, and two halves under them.
const reported = [
  box("solo", 0, 0, 1),
  box("mates", 0, 1, 2),
  box("pie", 0, 3, 1),
  box("exo", 1, 0, 2),
  box("frames", 1, 2, 2),
];

describe("dashboard layout", () => {
  it("flows cards left to right, wrapping when the next does not fit", () => {
    const flowed = flowLayout([
      { id: "a", cols: 1 },
      { id: "b", cols: 2 },
      { id: "c", cols: 2 },
      { id: "d", cols: 4 },
    ]);
    expect(cells(flowed)).toEqual(["a@0,0", "b@0,1", "c@1,0", "d@2,0"]);
  });

  it("drops a card at the start of a lower row, leaving a gap where it was", () => {
    const placed = placeInLayout(reported, "pie", 1, 0);
    // The pie sits bottom left; "exo" it landed on moves to a row just below,
    // and the top right is left empty.
    expect(cells(placed)).toEqual(["solo@0,0", "mates@0,1", "pie@1,0", "frames@1,2", "exo@2,0"]);
  });

  it("moves into an empty spot without disturbing anything", () => {
    const withGap = placeInLayout(reported, "pie", 1, 0);
    const back = placeInLayout(withGap, "pie", 0, 3);
    expect(cells(back)).toEqual(["solo@0,0", "mates@0,1", "pie@0,3", "frames@1,2", "exo@2,0"]);
  });

  it("starts a new row past the last one, and closes up a row left empty", () => {
    const layout = [box("a", 0, 0, 4), box("b", 1, 0, 4)];
    expect(cells(placeInLayout(layout, "a", 2, 0))).toEqual(["b@0,0", "a@1,0"]);
  });

  it("pulls a card in so it never hangs off the right edge", () => {
    expect(cells(placeInLayout([box("a", 0, 0, 2)], "a", 0, 3))).toEqual(["a@0,2"]);
    expect(cells(placeInLayout([box("a", 0, 3, 1)], "a", 0, 3, 3))).toEqual(["a@0,1"]);
  });

  it("pushes rows below down to make room for the cards it lands on", () => {
    const layout = [box("a", 0, 0, 2), box("b", 1, 0, 2), box("c", 2, 0, 2)];
    expect(cells(placeInLayout(layout, "c", 0, 1))).toEqual(["c@0,1", "a@1,0", "b@2,0"]);
  });

  it("closes up empty rows", () => {
    expect(cells(compactLayout([box("a", 2, 0, 1), box("b", 5, 1, 1)]))).toEqual([
      "a@0,0",
      "b@1,1",
    ]);
  });

  it("tidies overlapping or off-grid cards from storage", () => {
    const tidy = tidyLayout([box("a", 0, 0, 2), box("b", 0, 1, 2), box("c", 0, 7, 9)]);
    expect(cells(tidy)).toEqual(["a@0,0", "b@1,1", "c@2,0"]);
    expect(tidy.find((b) => b.id === "c")?.cols).toBe(4);
  });
});
