/** Reads "Round: 28 | Exolizers retired: 108" off a Void Cascade screenshot, for
 * runs imported from pictures that never had a log behind them. */

import { withScope } from "./logger";
import { paddleRecognizerAvailable, recognizePaddleCrops, type RgbCrop } from "./rivenOcrOnnx";
import { loadSharp } from "./sharpRuntime";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("levelCapExolizerOcr");

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// The mission panel sits on the left under the threat bar; screenshots are often
// hand-cropped snips, so the boxes are fractions and the wide one catches shifted crops.
const BOXES: Box[] = [
  { x0: 0, x1: 0.25, y0: 0.2, y1: 0.45 },
  { x0: 0, x1: 0.3, y0: 0.08, y1: 0.6 },
];
// Minimum channel for "white" HUD text; the higher cut splits text from a bright wall.
const WHITE_CUTS = [165, 205];
const MAX_SPREAD = 55;
// One HUD line is ~16-22px tall at 1080p.
const MIN_ROW_PX = 9;
const MAX_ROW_PX = 34;
const UPSCALE = 3;

interface ExolizerRead {
  exolizers: number;
  rounds: number | null;
}

/** Pulls the counts out of one OCR'd line; null unless it is the Exolizer line. */
export function parseExolizerLine(text: string): ExolizerRead | null {
  const exo = text.match(/xoli\w*\W+\w*\W*(\d{2,3})\s*\W*$/i);
  if (!exo) return null;
  const exolizers = Number(exo[1]);
  // A cap run needs 107; anything far past a long run is a misread.
  if (exolizers < 100 || exolizers > 400) return null;
  const round = text.match(/^\W*R\w{0,4}\W+(\d{1,3})/i);
  const rounds = round ? Number(round[1]) : null;
  return { exolizers, rounds: rounds && rounds <= 150 ? rounds : null };
}

type Raw = { data: Buffer; width: number; height: number };

function textRows(img: Raw, cut: number, scale: number): Array<{ crop: RgbCrop }> {
  const { data, width, height } = img;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    const lo = Math.min(r, g, b);
    mask[i] = lo > cut && Math.max(r, g, b) - lo < MAX_SPREAD ? 1 : 0;
  }
  const minRow = Math.round(MIN_ROW_PX * scale);
  const maxRow = Math.round(MAX_ROW_PX * scale);
  const ink = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) ink[y] += mask[y * width + x];
  const rows: Array<[number, number]> = [];
  // Lines packed tight ("Round..." over "NEXT EXOLIZER") merge; cut at the thinnest row.
  const keep = (a: number, b: number): void => {
    if (b - a < minRow) return;
    if (b - a <= maxRow) {
      rows.push([a, b]);
      return;
    }
    let cut = a + minRow;
    for (let y = cut; y < b - minRow; y++) if (ink[y] < ink[cut]) cut = y;
    keep(a, cut);
    keep(cut + 1, b);
  };
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const on = y < height && ink[y] >= 3;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      keep(start, y);
      start = -1;
    }
  }
  return rows.map(([a, b]) => {
    const y0 = Math.max(0, a - 4);
    const y1 = Math.min(height, b + 4);
    let xs = width;
    let xe = 0;
    for (let y = a; y < b; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y * width + x]) continue;
        xs = Math.min(xs, x);
        xe = Math.max(xe, x);
      }
    }
    const x0 = Math.max(0, xs - 6);
    const cw = Math.min(width, xe + 7) - x0;
    const ch = y1 - y0;
    // Black text on white, straight from the mask: whatever was behind it is gone.
    const out = Buffer.alloc(cw * ch * 3, 255);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (mask[(y0 + y) * width + x0 + x]) out.fill(0, (y * cw + x) * 3, (y * cw + x) * 3 + 3);
      }
    }
    return { crop: { data: out, width: cw, height: ch } };
  });
}

async function upscale(crop: RgbCrop): Promise<RgbCrop> {
  const sharp = loadSharp();
  const data: Buffer = await sharp(crop.data, {
    raw: { width: crop.width, height: crop.height, channels: 3 },
  })
    .resize(crop.width * UPSCALE, crop.height * UPSCALE, { kernel: "cubic" })
    .raw()
    .toBuffer();
  return { data, width: crop.width * UPSCALE, height: crop.height * UPSCALE };
}

/** The Exolizer count on a screenshot, or null when the line cannot be read. */
export async function readExolizersFromScreenshot(file: string): Promise<ExolizerRead | null> {
  if (!paddleRecognizerAvailable()) return null;
  try {
    const sharp = loadSharp();
    const meta = await sharp(file).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (W < 200 || H < 200) return null;
    const scale = H / 1080;
    for (const box of BOXES) {
      const left = Math.round(W * box.x0);
      const top = Math.round(H * box.y0);
      const width = Math.round(W * box.x1) - left;
      const height = Math.round(H * box.y1) - top;
      const data: Buffer = await sharp(file)
        .extract({ left, top, width, height })
        .removeAlpha()
        .raw()
        .toBuffer();
      for (const cut of WHITE_CUTS) {
        const rows = textRows({ data, width, height }, cut, scale);
        if (!rows.length) continue;
        const crops = await Promise.all(rows.map((row) => upscale(row.crop)));
        for (const line of await recognizePaddleCrops(crops)) {
          const read = parseExolizerLine(line.text);
          if (read) return read;
        }
      }
    }
  } catch (err) {
    log.warn("[LevelCapOcr] screenshot read failed:", normalizeErrorMessage(err));
  }
  return null;
}
