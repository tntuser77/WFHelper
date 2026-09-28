import { describe, expect, it } from "vitest";

import { wholeRowsPx } from "../../../src/lib/analytics/wholeRows.js";

/** A list whose rows are `height` tall and start `pitch` apart. */
function list(rows: number, height: number, pitch: number): HTMLElement {
  const children = Array.from({ length: rows }, (_, i) => ({
    offsetTop: i * pitch,
    offsetHeight: height,
  }));
  return { children } as unknown as HTMLElement;
}

describe("wholeRowsPx", () => {
  it("stops on the last row that fits whole", () => {
    // Rows 26px tall, 30px apart: 8 fit in 248px (7 * 30 + 26 = 236), a 9th would not.
    expect(wholeRowsPx(list(20, 26, 30), 248)).toBe("236px");
  });

  it("keeps the whole room when it ends exactly on a row", () => {
    expect(wholeRowsPx(list(20, 24, 28), 248)).toBe("248px");
  });

  it("always shows at least one row", () => {
    expect(wholeRowsPx(list(5, 24, 28), 10)).toBe("24px");
  });

  it("leaves the list alone before it can measure", () => {
    expect(wholeRowsPx(null, 248)).toBeUndefined();
    expect(wholeRowsPx(list(20, 24, 28), 0)).toBeUndefined();
    expect(wholeRowsPx(list(1, 24, 28), 248)).toBeUndefined();
  });
});
