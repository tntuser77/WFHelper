/** Reads the squadmates' names off a Void Cascade screenshot's top-right squad
 *  list, for runs imported from pictures. Rows are found by the solid slot disk
 *  each name ends in, then read masked and as-is; levelCapSquadNames decides
 *  who they are. */

import { withScope } from "./logger";
import { paddleRecognizerAvailable, recognizePaddleCrops, type RgbCrop } from "./rivenOcrOnnx";
import { PORTRAIT_BOX, PORTRAIT_GRID } from "./levelCapSquadPortraits";
import { loadSharp } from "./sharpRuntime";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("levelCapSquadOcr");

// In 1080p pixels from the right edge and the top; snips are hand-cropped, so
// the band is loose. Your frame and companion sit above it, squadmates in it.
const LEFT_PX = 440;
const RIGHT_PX = 60;
const TIGHT_RIGHT_PX = 20;
const TOP = 0.05;
const BOTTOM = 0.5;
const BAND_PX: [number, number] = [135, 310];
const MAX_SLOTS = 3;
const WHITE_CUTS = [165, 205];
const MAX_SPREAD = 55;
const MIN_ROW_PX = 9;
const MAX_ROW_PX = 30;
// Health bars are long thin lines; no letter has a stroke this wide.
const MAX_STROKE_PX = 45;
// Past this much empty space the row is a buff counter, not the name.
const MAX_GAP_PX = 16;
// The slot number sits in a solid disk after the name.
const DISK_PX: [number, number] = [10, 22];
const DISK_CUT = 185;
// Squadmates' disks line up in one column; your frame's sits further right.
const DISK_COLUMN_PX = 6;
const NAME_HALF_PX = 13;
const MAX_NAME_PX = 190;
const UPSCALE = 3;

type Raw = { data: Buffer; width: number; height: number };
interface Row {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  /** The slot disk's centre, which places the portrait; guessed for scanned rows. */
  disk?: { cx: number; cy: number };
}

export interface SquadScreenshotRead {
  /** Variant reads per squad row; empty for a solo run. */
  names: string[][];
  /** Portrait fingerprint per row, null where the row had no disk to place it. */
  portraits: Array<string | null>;
  /** Small PNG of each portrait, kept so a person can name the frame later. */
  thumbs: Array<Buffer | null>;
  /** Where each row sits, top and bottom as fractions of the image's height. */
  rows?: Array<{ top: number; bottom: number }>;
}

// The portrait ring's centre, in 1080p pixels from the slot disk's centre.
const PORTRAIT_FROM_DISK = { x: 43, y: -14 };
const THUMB = { width: 48, height: 42 };

function whiteMask(img: Raw, cut: number, scale: number): Uint8Array {
  const { data, width, height } = img;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const lo = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    const hi = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    mask[i] = lo > cut && hi - lo < MAX_SPREAD ? 1 : 0;
  }
  const maxStroke = Math.round(MAX_STROKE_PX * scale);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; ) {
      if (!mask[y * width + x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < width && mask[y * width + end]) end++;
      if (end - x > maxStroke) mask.fill(0, y * width + x, y * width + end);
      x = end;
    }
  }
  return mask;
}

/** The name rows in the band: the right-aligned text, minus the slot disk. */
function nameRows(mask: Uint8Array, width: number, height: number, scale: number): Row[] {
  const ink = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) ink[y] += mask[y * width + x];
  const rows: Row[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const on = y < height && ink[y] >= 3;
    if (on && start < 0) start = y;
    if (on || start < 0) continue;
    const a = start;
    start = -1;
    const top = a / scale;
    if (y - a < MIN_ROW_PX * scale || y - a > MAX_ROW_PX * scale) continue;
    if (top < BAND_PX[0] || top > BAND_PX[1]) continue;
    const col = new Array<number>(width).fill(0);
    for (let yy = a; yy < y; yy++) for (let x = 0; x < width; x++) col[x] += mask[yy * width + x];
    let x1 = width - 1;
    while (x1 > 0 && !col[x1]) x1--;
    let disk = x1;
    while (disk > 0 && col[disk]) disk--;
    if (x1 - disk >= DISK_PX[0] * scale && x1 - disk <= DISK_PX[1] * scale) {
      x1 = disk;
      while (x1 > 0 && !col[x1]) x1--;
    }
    let x0 = x1;
    for (let x = x1, gap = 0; x >= 0; x--) {
      if (col[x]) {
        x0 = x;
        gap = 0;
      } else if (++gap > MAX_GAP_PX * scale) break;
    }
    rows.push({ y0: Math.max(0, a - 4), y1: Math.min(height, y + 4), x0, x1 });
  }
  return rows.slice(0, MAX_SLOTS);
}

interface Disk {
  x0: number;
  cx: number;
  cy: number;
}

/** Solid white disks the slot size, with the digit's hole in them. */
function findDisks(img: Raw, scale: number): Disk[] {
  const { data, width, height } = img;
  const on = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const lo = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    const hi = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    on[i] = lo > DISK_CUT && hi - lo < MAX_SPREAD ? 1 : 0;
  }
  const [min, max] = DISK_PX.map((px) => px * scale);
  const disks: Disk[] = [];
  const stack: number[] = [];
  for (let start = 0; start < on.length; start++) {
    if (on[start] !== 1) continue;
    on[start] = 2;
    stack.push(start);
    let area = 0;
    let [x0, x1, y0, y1] = [width, 0, height, 0];
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      area++;
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
      for (const n of [i - 1, i + 1, i - width, i + width]) {
        if (n < 0 || n >= on.length || on[n] !== 1) continue;
        if (Math.abs((n % width) - x) > 1) continue;
        on[n] = 2;
        stack.push(n);
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const fill = area / (w * h);
    if (w < min || w > max || h < min || h > max || Math.abs(w - h) > 4 * scale) continue;
    if (fill < 0.45 || fill > 0.9) continue;
    disks.push({ x0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  const column = (d: Disk) => disks.filter((o) => Math.abs(o.cx - d.cx) <= DISK_COLUMN_PX * scale);
  const best = disks.reduce<Disk[]>((acc, d) => {
    const members = column(d);
    return members.length > acc.length ? members : acc;
  }, []);
  return best.sort((a, b) => a.cy - b.cy).slice(0, MAX_SLOTS);
}

/** The name left of each disk, trimmed to where the masked text starts. */
function diskRows(
  disks: Disk[],
  mask: Uint8Array,
  width: number,
  height: number,
  scale: number,
): Row[] {
  return disks.map((disk) => {
    const y0 = Math.max(0, Math.round(disk.cy - NAME_HALF_PX * scale));
    const y1 = Math.min(height, Math.round(disk.cy + NAME_HALF_PX * scale));
    const x1 = Math.max(0, disk.x0 - 1);
    const floor = Math.max(0, Math.round(x1 - MAX_NAME_PX * scale));
    let x0 = Math.max(floor, Math.round(x1 - 60 * scale));
    for (let x = x1, gap = 0; x >= floor; x--) {
      let ink = false;
      for (let y = y0; y < y1 && !ink; y++) ink = mask[y * width + x] === 1;
      if (ink) {
        x0 = Math.min(x0, x);
        gap = 0;
      } else if (++gap > MAX_GAP_PX * scale) break;
    }
    return { y0, y1, x0, x1, disk: { cx: disk.cx, cy: disk.cy } };
  });
}

/** Fingerprint and thumbnail of the portrait beside a row, from the full image. */
async function portraitOf(
  file: string,
  W: number,
  H: number,
  at: { x: number; y: number },
  scale: number,
): Promise<{ portrait: string; thumb: Buffer } | null> {
  const sharp = loadSharp();
  const x0 = Math.round(at.x - PORTRAIT_BOX.left * scale);
  const y0 = Math.round(at.y - PORTRAIT_BOX.top * scale);
  const w = Math.round((PORTRAIT_BOX.left + PORTRAIT_BOX.right) * scale);
  const h = Math.round((PORTRAIT_BOX.top + PORTRAIT_BOX.bottom) * scale);
  // Snips are often cut close on the right; pad what the picture lacks.
  const cw = Math.min(w, W - x0);
  if (x0 < 0 || y0 < 0 || y0 + h > H || cw < w * 0.6) return null;
  const crop: Buffer = await sharp(file)
    .extract({ left: x0, top: y0, width: cw, height: h })
    .removeAlpha()
    .extend({ right: w - cw, background: "#000" })
    .png()
    .toBuffer();
  const grid: Buffer = await sharp(crop)
    .resize(PORTRAIT_GRID, PORTRAIT_GRID, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const thumb: Buffer = await sharp(crop).resize(THUMB.width, THUMB.height).png().toBuffer();
  return { portrait: grid.toString("base64"), thumb };
}

/** The row as the game drew it, for scenes too bright for the white mask. */
async function plainCrop(img: Raw, row: Row): Promise<RgbCrop> {
  const x0 = Math.max(0, row.x0 - 6);
  const cw = Math.min(img.width, row.x1 + 1) - x0;
  const ch = row.y1 - row.y0;
  const out = Buffer.alloc(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    const from = ((row.y0 + y) * img.width + x0) * 3;
    img.data.copy(out, y * cw * 3, from, from + cw * 3);
  }
  const data: Buffer = await loadSharp()(out, { raw: { width: cw, height: ch, channels: 3 } })
    .resize(cw * UPSCALE, ch * UPSCALE, { kernel: "cubic" })
    .raw()
    .toBuffer();
  return { data, width: cw * UPSCALE, height: ch * UPSCALE };
}

/** Black text on white, straight from the mask, so the minimap behind is gone. */
async function rowCrop(mask: Uint8Array, width: number, row: Row): Promise<RgbCrop> {
  const x0 = Math.max(0, row.x0 - 6);
  const cw = Math.min(width, row.x1 + 7) - x0;
  const ch = row.y1 - row.y0;
  const out = Buffer.alloc(cw * ch * 3, 255);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (mask[(row.y0 + y) * width + x0 + x]) out.fill(0, (y * cw + x) * 3, (y * cw + x) * 3 + 3);
    }
  }
  const data: Buffer = await loadSharp()(out, { raw: { width: cw, height: ch, channels: 3 } })
    .resize(cw * UPSCALE, ch * UPSCALE, { kernel: "cubic" })
    .raw()
    .toBuffer();
  return { data, width: cw * UPSCALE, height: ch * UPSCALE };
}

/** A read counts when every row has a word in it, not a stray digit or symbol. */
function readsLikeNames(read: SquadScreenshotRead): boolean {
  return (
    read.names.length > 0 &&
    read.names.every((variants) => variants.some((text) => /\p{L}.*\p{L}.*\p{L}/u.test(text)))
  );
}

/** Names and portraits per squad row, or null when the screenshot is unreadable. */
export async function readSquadFromScreenshot(file: string): Promise<SquadScreenshotRead | null> {
  if (!paddleRecognizerAvailable()) return null;
  try {
    const meta = await loadSharp()(file).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (W < 400 || H < 300) return null;
    const first = await readBand(file, W, H, RIGHT_PX);
    if (first.disks) return first.read;
    // A snip cut close on the right can leave every slot disk in the margin; a
    // wider band also takes in the level numbers, so it has to read as names.
    const tight = await readBand(file, W, H, TIGHT_RIGHT_PX);
    return tight.disks && readsLikeNames(tight.read) ? tight.read : first.read;
  } catch (err) {
    log.warn("[LevelCapOcr] squad read failed:", normalizeErrorMessage(err));
    return null;
  }
}

/** One pass over the squad band, `rightPx` short of the image's right edge. */
async function readBand(
  file: string,
  W: number,
  H: number,
  rightPx: number,
): Promise<{ read: SquadScreenshotRead; disks: number }> {
  const sharp = loadSharp();
  const scale = H / 1080;
  const left = Math.max(0, Math.round(W - LEFT_PX * scale));
  const top = Math.round(H * TOP);
  const width = Math.round(W - rightPx * scale) - left;
  const height = Math.round(H * BOTTOM) - top;
  const data: Buffer = await sharp(file)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer();
  const img = { data, width, height };
  const masks = WHITE_CUTS.map((cut) => whiteMask(img, cut, scale));
  // Disks survive bright scenes; the old line scan only covers screenshots without them.
  // A disk touching its platform icon is missed, so the scan fills the gaps.
  const byDisk = diskRows(findDisks(img, scale), masks[0], width, height, scale);
  const mid = (row: Row) => (row.y0 + row.y1) / 2;
  const scanned = nameRows(masks[0], width, height, scale).filter((row) =>
    byDisk.every((disk) => Math.abs(mid(disk) - mid(row)) > NAME_HALF_PX * 1.5 * scale),
  );
  // A scanned row's disk sits in the same column as the found ones.
  const column = byDisk[0]?.disk?.cx;
  for (const row of scanned) if (column !== undefined) row.disk = { cx: column, cy: mid(row) };
  const rows = [...byDisk, ...scanned.slice(0, MAX_SLOTS - byDisk.length)].sort(
    (a, b) => a.y0 - b.y0,
  );
  if (!rows.length) {
    return { read: { names: [], portraits: [], thumbs: [], rows: [] }, disks: 0 };
  }
  const crops = await Promise.all([
    ...masks.flatMap((mask) => rows.map((row) => rowCrop(mask, width, row))),
    ...rows.map((row) => plainCrop(img, row)),
  ]);
  const lines = await recognizePaddleCrops(crops);
  const reads = rows.map((_, i) =>
    [0, 1, 2].map((v) => lines[v * rows.length + i]?.text.trim() ?? "").filter(Boolean),
  );
  const faces = await Promise.all(
    rows.map((row) =>
      row.disk
        ? portraitOf(
            file,
            W,
            H,
            {
              x: left + row.disk.cx + PORTRAIT_FROM_DISK.x * scale,
              y: top + row.disk.cy + PORTRAIT_FROM_DISK.y * scale,
            },
            scale,
          )
        : null,
    ),
  );
  // A lone disk can be your own frame's level; its row names the frame.
  const keep = reads.map((variants) => !variants.some((text) => /\[\d/.test(text)));
  return {
    read: {
      names: reads.filter((_, i) => keep[i]),
      portraits: faces.flatMap((face, i) => (keep[i] ? [face?.portrait ?? null] : [])),
      thumbs: faces.flatMap((face, i) => (keep[i] ? [face?.thumb ?? null] : [])),
      rows: rows.flatMap((row, i) =>
        keep[i] ? [{ top: (top + row.y0) / H, bottom: (top + row.y1) / H }] : [],
      ),
    },
    disks: byDisk.length,
  };
}
