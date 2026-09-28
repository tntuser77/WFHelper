/**
 * The tallest height up to `room` that ends on a whole row of `list`, so a
 * scrolling list never shows half a row. Rows are measured as drawn, since
 * font size and zoom move them off any fixed pitch. Undefined leaves the list
 * alone: no room measured yet, or too few rows to measure.
 */
export function wholeRowsPx(list: HTMLElement | null, room: number): string | undefined {
  if (!list || room <= 0 || list.children.length < 2) return undefined;
  const first = list.children[0] as HTMLElement;
  const second = list.children[1] as HTMLElement;
  const pitch = second.offsetTop - first.offsetTop;
  if (pitch <= 0) return undefined;
  const rows = Math.max(1, Math.floor((room - first.offsetHeight) / pitch) + 1);
  return `${(rows - 1) * pitch + first.offsetHeight}px`;
}
