/** Reads the "Total Kills" row off the end-of-mission screen: a second F12
 *  after a Void Cascade, so the run gets its kills without asking DE's servers. */

import { withScope } from "./logger";
import { paddleRecognizerAvailable, recognizePaddleCrops, type RgbCrop } from "./rivenOcrOnnx";
import { loadSharp } from "./sharpRuntime";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("levelCapKillsOcr");

// In 1080p pixels on a 16:9 picture. The stat labels sit in one column on the
// left, 50px a row; each player's column starts under their name, 293.5px apart.
const LABEL_X = 230;
const LABEL_WIDTH = 240;
const LABEL_TOP = 500;
const LABEL_BOTTOM = 960;
const ROW_PX = 50;
const COLUMN_X = 545;
const COLUMN_STEP = 293.5;
const MAX_COLUMNS = 4;
const NAME_BOX = { y: 458, height: 44, width: 200 };
// Tight cells keep the frames standing behind the numbers out of the read; two
// sizes vote, since one can still catch a stray edge.
const CELLS = [
  { width: 120, height: 30 },
  { width: 150, height: 36 },
];
const UPSCALE = 2;
// Label text is a dim grey; anything this bright and unsaturated counts as ink.
const INK_CUT = 110;
const INK_SPREAD = 55;
// No one kills this many in one Cascade; past it the read is noise.
const MAX_KILLS = 100_000;

export interface KillsScreenRead {
  /** Kills per column, left to right; you are the first. Null where unreadable. */
  kills: Array<number | null>;
  /** Name over each column as read; "" where unreadable. */
  names: string[];
}

/** A kill count out of one OCR'd cell; null unless it is just a number. */
export function parseKillCount(text: string): number | null {
  const digits = text.replace(/[\s,.']/g, "");
  if (!/^\d{1,6}$/.test(digits)) return null;
  const kills = Number(digits);
  return kills <= MAX_KILLS ? kills : null;
}

/** Whether an OCR'd stat label is "Total Kills"; the small grey "Kills" rarely
 *  survives, but no other row starts "Tota". */
export function isTotalKillsLabel(text: string): boolean {
  return /^\W*t[o0][tl][a4]/i.test(text);
}

/** The value most reads agree on; a tie goes to the surest read. */
function vote(reads: Array<{ text: string; confidence: number }>): number | null {
  const tally = new Map<number, { count: number; confidence: number }>();
  for (const read of reads) {
    const kills = parseKillCount(read.text);
    if (kills === null) continue;
    const seen = tally.get(kills) ?? { count: 0, confidence: 0 };
    tally.set(kills, {
      count: seen.count + 1,
      confidence: Math.max(seen.confidence, read.confidence),
    });
  }
  let best: number | null = null;
  let bestScore = { count: 0, confidence: 0 };
  for (const [kills, score] of tally) {
    if (
      score.count > bestScore.count ||
      (score.count === bestScore.count && score.confidence > bestScore.confidence)
    ) {
      best = kills;
      bestScore = score;
    }
  }
  return best;
}

type Source = string | Buffer;
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The end-of-mission kill counts, or null when the picture has no Total Kills row. */
export async function readKillsFromScreenshot(source: Source): Promise<KillsScreenRead | null> {
  if (!paddleRecognizerAvailable()) return null;
  try {
    const sharp = loadSharp();
    const meta = await sharp(source).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (W < 400 || H < 300) return null;
    const scale = H / 1080;
    // Wider than 16:9 pads both sides; the screen stays centred.
    const xOff = Math.max(0, (W - 1920 * scale) / 2);
    const box = (x: number, y: number, w: number, h: number): Box => {
      const left = Math.min(W - 1, Math.max(0, Math.round(xOff + x * scale)));
      const top = Math.min(H - 1, Math.max(0, Math.round(y * scale)));
      return {
        left,
        top,
        width: Math.max(1, Math.min(W - left, Math.round(w * scale))),
        height: Math.max(1, Math.min(H - top, Math.round(h * scale))),
      };
    };
    const crop = async (area: Box): Promise<RgbCrop> => {
      const width = area.width * UPSCALE;
      const height = area.height * UPSCALE;
      const data: Buffer = await sharp(source)
        .extract(area)
        .removeAlpha()
        .resize(width, height, { kernel: "cubic" })
        .raw()
        .toBuffer();
      return { data, width, height };
    };

    // One crop per row slot; the list can scroll, so try every half-row.
    const starts: number[] = [];
    for (let y = LABEL_TOP; y + ROW_PX <= LABEL_BOTTOM; y += ROW_PX / 2) starts.push(y);
    const labels = await recognizePaddleCrops(
      await Promise.all(starts.map((y) => crop(box(LABEL_X, y, LABEL_WIDTH, ROW_PX)))),
    );
    let hit = -1;
    labels.forEach((line, i) => {
      if (!isTotalKillsLabel(line.text)) return;
      if (hit < 0 || line.confidence > labels[hit].confidence) hit = i;
    });
    if (hit < 0) return null;

    // The cells are tight, so centre them on the label's ink rather than the slot.
    const slot = box(LABEL_X, starts[hit], LABEL_WIDTH, ROW_PX);
    const raw: Buffer = await sharp(source).extract(slot).removeAlpha().raw().toBuffer();
    let inkRows = 0;
    let inkSum = 0;
    for (let y = 0; y < slot.height; y++) {
      let ink = 0;
      for (let x = 0; x < slot.width; x++) {
        const i = (y * slot.width + x) * 3;
        const lo = Math.min(raw[i], raw[i + 1], raw[i + 2]);
        const hi = Math.max(raw[i], raw[i + 1], raw[i + 2]);
        if (lo > INK_CUT && hi - lo < INK_SPREAD) ink++;
      }
      inkRows += ink;
      inkSum += ink * y;
    }
    const centre = starts[hit] + (inkRows ? inkSum / inkRows / scale : ROW_PX / 2);

    const columns = Array.from({ length: MAX_COLUMNS }, (_, i) => COLUMN_X + i * COLUMN_STEP);
    const reads = await Promise.all(
      CELLS.map(async (cell) =>
        recognizePaddleCrops(
          await Promise.all(
            columns.map((x) => crop(box(x, centre - cell.height / 2, cell.width, cell.height))),
          ),
        ),
      ),
    );
    const kills = columns.map((_, i) => vote(reads.map((read) => read[i])));
    // Columns past the squad are empty; drop them from the end.
    while (kills.length && kills[kills.length - 1] === null) kills.pop();
    if (!kills.length || kills[0] === null) return null;

    const names = await recognizePaddleCrops(
      await Promise.all(
        columns
          .slice(0, kills.length)
          .map((x) => crop(box(x, NAME_BOX.y, NAME_BOX.width, NAME_BOX.height))),
      ),
    );
    return { kills, names: names.map((name) => name.text.trim()) };
  } catch (err) {
    log.warn("[LevelCapOcr] kills read failed:", normalizeErrorMessage(err));
    return null;
  }
}
