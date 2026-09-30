import { describe, expect, it } from "vitest";

import { wholeRowsPx } from "../../../src/lib/analytics/wholeRows.js";

/** A list whose rows are `height` tall and start `pitch` apart. */
function list(rows: number, height: number, pitch: number): HTMLElement {
  const children = Array.from({ length: rows }, (_, i) => ({
    getBoundingClientRect: () => ({ top: 100 + i * pitch, bottom: 100 + i * pitch + height }),
  }));
  return { children } as unknown as HTMLElement;
}

describe("wholeRowsPx", () => {
  it("stops on the last row that fits whole", () => {
    // Rows 26px tall, 30px apart: 8 fit in 248px (7 * 30 + 26 = 236), a 9th would not.
    expect(wholeRowsPx(list(20, 26, 30), 248)).toBe("236px");
  });

  it("keeps fractional row sizes, so the last row is not clipped by rounding", () => {
    expect(wholeRowsPx(list(20, 25.6, 29.6), 100)).toBe(`${100 + 2 * 29.6 + 25.6 - 100}px`);
  });

  it("sets no cap when every row fits, so there is nothing to scroll", () => {
    expect(wholeRowsPx(list(3, 25.6, 29.6), 90)).toBeUndefined();
  });

  it("always shows at least one row", () => {
    expect(wholeRowsPx(list(5, 24, 28), 10)).toBe("24px");
  });

  it("leaves the list alone before it can measure", () => {
    expect(wholeRowsPx(null, 248)).toBeUndefined();
    expect(wholeRowsPx(list(20, 24, 28), 0)).toBeUndefined();
  });
});
