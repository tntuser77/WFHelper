/**
 * The tallest height up to `room` that ends on a whole row of `list`, so a
 * scrolling list never shows half a row. Rows are measured as drawn, since
 * font size and zoom move them off any fixed pitch, and fractionally, since
 * rounding would leave a scrollbar over a sliver. Undefined leaves the list
 * alone: nothing measured yet, or every row fits and nothing needs to scroll.
 */
export function wholeRowsPx(list: HTMLElement | null, room: number): string | undefined {
  if (!list || room <= 0 || list.children.length === 0) return undefined;
  const rows = Array.from(list.children);
  const top = rows[0].getBoundingClientRect().top;
  const bottoms = rows.map((row) => row.getBoundingClientRect().bottom - top);
  const fit = bottoms.filter((bottom) => bottom <= room).length;
  if (fit === rows.length) return undefined;
  return `${bottoms[Math.max(fit, 1) - 1]}px`;
}
