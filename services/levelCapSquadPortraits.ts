/** Squadmates' frames from the portrait beside each name in the squad list.
 *  The HUD draws the same helmet art every time, so portraits are grouped by
 *  likeness across runs; a group gets a frame once one of its portraits is
 *  labelled, and every later portrait that matches it inherits the name. */

/** Portrait fingerprints are a PORTRAIT_GRID square of RGB bytes, base64. */
export const PORTRAIT_GRID = 16;
// Mean per-channel difference, 0-255, under which two portraits are the same art.
const SAME_PORTRAIT = 22;

interface PortraitLabel {
  portrait: string;
  frame: string;
}

interface PortraitGroup {
  /** Key of the group's first portrait; stable while the group holds together. */
  group: string;
  frame: string | null;
}

/** The fingerprint covers the ring and the helmet above it, but not the level
 *  number and badge drawn over the bottom, nor the ring's colour. Grid cells
 *  span x -24..24 and y -34..8 (1080p pixels) around the ring's centre. */
export const PORTRAIT_BOX = { left: 24, right: 24, top: 34, bottom: 8 };

const MASK = (() => {
  const mask: boolean[] = [];
  const w = PORTRAIT_BOX.left + PORTRAIT_BOX.right;
  const h = PORTRAIT_BOX.top + PORTRAIT_BOX.bottom;
  for (let y = 0; y < PORTRAIT_GRID; y++) {
    for (let x = 0; x < PORTRAIT_GRID; x++) {
      const ux = -PORTRAIT_BOX.left + ((x + 0.5) * w) / PORTRAIT_GRID;
      const uy = -PORTRAIT_BOX.top + ((y + 0.5) * h) / PORTRAIT_GRID;
      if (uy > 6) mask.push(false);
      else if (uy >= -12) mask.push(ux * ux + uy * uy <= 400);
      else mask.push(Math.abs(ux) <= 20);
    }
  }
  return mask;
})();

const decoded = new Map<string, Buffer>();
function bytes(portrait: string): Buffer {
  let buf = decoded.get(portrait);
  if (!buf) {
    buf = Buffer.from(portrait, "base64");
    decoded.set(portrait, buf);
  }
  return buf;
}

export function isPortrait(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Buffer.from(value, "base64").length === PORTRAIT_GRID * PORTRAIT_GRID * 3
  );
}

/** Mean per-channel difference over the masked cells. */
function portraitDistance(a: string, b: string): number {
  const x = bytes(a);
  const y = bytes(b);
  let sum = 0;
  let n = 0;
  MASK.forEach((on, cell) => {
    if (!on) return;
    for (let c = cell * 3; c < cell * 3 + 3; c++) sum += Math.abs(x[c] - y[c]);
    n += 3;
  });
  return n ? sum / n : 255;
}

/** Groups every portrait by likeness and names the groups a label reaches. */
export function groupPortraits(
  portraits: ReadonlyArray<{ key: string; portrait: string }>,
  labels: readonly PortraitLabel[],
): Map<string, PortraitGroup> {
  const parent = portraits.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < portraits.length; i++) {
    for (let j = i + 1; j < portraits.length; j++) {
      if (portraitDistance(portraits[i].portrait, portraits[j].portrait) <= SAME_PORTRAIT) {
        parent[root(i)] = root(j);
      }
    }
  }
  const members = new Map<number, number[]>();
  portraits.forEach((_, i) => members.set(root(i), [...(members.get(root(i)) ?? []), i]));

  const out = new Map<string, PortraitGroup>();
  for (const group of members.values()) {
    const keys = group.map((i) => portraits[i].key).sort();
    let best: { frame: string; d: number } | null = null;
    for (const label of labels) {
      for (const i of group) {
        const d = portraitDistance(portraits[i].portrait, label.portrait);
        if (d <= SAME_PORTRAIT && (!best || d < best.d)) best = { frame: label.frame, d };
      }
    }
    for (const i of group)
      out.set(portraits[i].key, { group: keys[0], frame: best?.frame ?? null });
  }
  return out;
}
