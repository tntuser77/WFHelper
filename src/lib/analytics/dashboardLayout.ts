/**
 * Where cards sit on the analytics dashboard: four columns, rows as tall as
 * their tallest card, and gaps allowed anywhere. A row with nothing left in it
 * closes up, so rows are always numbered 0, 1, 2 ... with no empty ones.
 */

export const DASHBOARD_COLS = 4;

export interface LayoutBox {
  id: string;
  row: number;
  col: number;
  cols: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function overlaps(a: LayoutBox, b: LayoutBox): boolean {
  return a.row === b.row && a.col < b.col + b.cols && b.col < a.col + a.cols;
}

/** Row by row, left to right: the order the cards read in, and the DOM order. */
export function sortLayout<T extends LayoutBox>(boxes: readonly T[]): T[] {
  return [...boxes].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** Empty rows close up; everything below moves up to fill them. */
export function compactLayout<T extends LayoutBox>(boxes: readonly T[]): T[] {
  const rows = [...new Set(boxes.map((b) => b.row))].sort((a, b) => a - b);
  const to = new Map(rows.map((row, i) => [row, i]));
  return sortLayout(boxes.map((b) => ({ ...b, row: to.get(b.row)! })));
}

export function layoutRowCount(boxes: readonly LayoutBox[]): number {
  return boxes.length ? Math.max(...boxes.map((b) => b.row)) + 1 : 0;
}

/** Cards in order, left to right, starting a new row whenever the next does not
 *  fit. How dashboards saved before positions existed are laid out. */
export function flowLayout<T extends { cols: number }>(
  items: readonly T[],
): Array<T & { row: number; col: number }> {
  let row = 0;
  let col = 0;
  return items.map((item) => {
    const cols = clamp(item.cols, 1, DASHBOARD_COLS);
    if (col + cols > DASHBOARD_COLS) {
      row++;
      col = 0;
    }
    const placed = { ...item, row, col };
    col += cols;
    return placed;
  });
}

/** Puts every card on the grid and moves any that overlaps an earlier one down a
 *  row at a time until it is clear; for layouts that did not come from here. */
export function tidyLayout<T extends LayoutBox>(boxes: readonly T[]): T[] {
  const placed: T[] = [];
  for (const box of sortLayout(boxes)) {
    const cols = clamp(box.cols, 1, DASHBOARD_COLS);
    let at = {
      ...box,
      cols,
      row: Math.max(0, box.row),
      col: clamp(box.col, 0, DASHBOARD_COLS - cols),
    };
    while (placed.some((p) => overlaps(p, at))) at = { ...at, row: at.row + 1 };
    placed.push(at);
  }
  return compactLayout(placed);
}

/**
 * Card `id` at `row` and `col`, `cols` wide; a row past the last starts a new
 * one. The cards it lands on move to a new row just below, keeping their
 * columns, and everything under that moves down one; the rest stay where they
 * are. The column is pulled in so the card never hangs off the right edge.
 */
export function placeInLayout<T extends LayoutBox>(
  boxes: readonly T[],
  id: string,
  row: number,
  col: number,
  cols?: number,
): T[] {
  const card = boxes.find((b) => b.id === id);
  if (!card) return [...boxes];
  const span = clamp(cols ?? card.cols, 1, DASHBOARD_COLS);
  const at = {
    ...card,
    cols: span,
    row: Math.max(0, row),
    col: clamp(col, 0, DASHBOARD_COLS - span),
  };
  const others = boxes.filter((b) => b.id !== id);
  const hit = new Set(others.filter((b) => overlaps(b, at)).map((b) => b.id));
  const moved = others.map((b) =>
    hit.has(b.id)
      ? { ...b, row: at.row + 1 }
      : hit.size && b.row > at.row
        ? { ...b, row: b.row + 1 }
        : b,
  );
  return compactLayout([...moved, at]);
}
