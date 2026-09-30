/** The tallest height up to `room` that ends on a whole row of `list`, so a
 *  scrolling list never shows half a row. Rows are measured as drawn and
 *  fractionally: zoom moves them off any fixed pitch, and rounding would leave a
 *  sliver to scroll. Undefined (nothing measured, or all fits) leaves it alone. */
export function wholeRowsPx(list: HTMLElement | null, room: number): string | undefined {
  if (!list || room <= 0 || list.children.length === 0) return undefined;
  const rows = Array.from(list.children);
  const top = rows[0].getBoundingClientRect().top;
  const bottoms = rows.map((row) => row.getBoundingClientRect().bottom - top);
  const fit = bottoms.filter((bottom) => bottom <= room).length;
  if (fit === rows.length) return undefined;
  return `${bottoms[Math.max(fit, 1) - 1]}px`;
}
