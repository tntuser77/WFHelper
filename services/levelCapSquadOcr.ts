/** Reads the squadmates' names off a Void Cascade screenshot's top-right squad
 *  list, for runs imported from pictures. Each row is read twice, with a loose
 *  and a strict white cut, and levelCapSquadNames decides who they are. */

import { withScope } from "./logger";
import { paddleRecognizerAvailable, recognizePaddleCrops, type RgbCrop } from "./rivenOcrOnnx";
import { loadSharp } from "./sharpRuntime";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("levelCapSquadOcr");

// In 1080p pixels from the right edge and the top; snips are hand-cropped, so
// the band is loose. Your frame and companion sit above it, squadmates in it.
const LEFT_PX = 440;
const RIGHT_PX = 60;
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
const UPSCALE = 3;

type Raw = { data: Buffer; width: number; height: number };
interface Row {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

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

/** Raw reads per squad row (empty for a solo run), or null when unreadable. */
export async function readSquadFromScreenshot(file: string): Promise<string[][] | null> {
  if (!paddleRecognizerAvailable()) return null;
  try {
    const sharp = loadSharp();
    const meta = await sharp(file).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (W < 400 || H < 300) return null;
    const scale = H / 1080;
    const left = Math.max(0, Math.round(W - LEFT_PX * scale));
    const top = Math.round(H * TOP);
    const width = Math.round(W - RIGHT_PX * scale) - left;
    const height = Math.round(H * BOTTOM) - top;
    const data: Buffer = await sharp(file)
      .extract({ left, top, width, height })
      .removeAlpha()
      .raw()
      .toBuffer();
    const img = { data, width, height };
    const masks = WHITE_CUTS.map((cut) => whiteMask(img, cut, scale));
    // Row boxes come from the loose cut; the strict one re-reads the same boxes.
    const rows = nameRows(masks[0], width, height, scale);
    if (!rows.length) return [];
    const crops = await Promise.all(
      masks.flatMap((mask) => rows.map((row) => rowCrop(mask, width, row))),
    );
    const lines = await recognizePaddleCrops(crops);
    return rows.map((_, i) =>
      masks.map((_, m) => lines[m * rows.length + i]?.text.trim() ?? "").filter(Boolean),
    );
  } catch (err) {
    log.warn("[LevelCapOcr] squad read failed:", normalizeErrorMessage(err));
    return null;
  }
}
