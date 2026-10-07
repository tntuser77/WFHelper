/** Reads the "Total Kills" row off the end-of-mission screen: a second F12
 *  after a Void Cascade, so the run gets its kills without asking DE's servers. */

import { withScope } from "./logger";
import { paddleRecognizerAvailable, recognizePaddleCrops, type RgbCrop } from "./rivenOcrOnnx";
import { loadSharp } from "./sharpRuntime";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("levelCapKillsOcr");

// In 1080p pixels on a 16:9 picture. The stat labels sit in one column on the
// left, 50px a row. Where the table starts and where its columns sit moves with
// the screen (in mission or Mission Complete) and the squad size, so the numbers
// are found along the Total Kills row rather than at set places. Squad columns
// are 293.5px apart.
const LABEL_X = 230;
const LABEL_WIDTH = 240;
const LABEL_TOP = 170;
const LABEL_BOTTOM = 960;
const ROW_PX = 50;
const ROW_SCAN = { left: 480, right: 1650, height: 28 };
const COLUMN_STEP = 293.5;
const MAX_COLUMNS = 4;
// A number's digits sit closer than this; anything wider apart is another column.
const DIGIT_GAP = 18;
// Cells start this far left of a number's ink, as the names start about there too.
const CELL_LEAD = 6;
const NAME_LEAD = 17;
// How far off the column spacing a number may sit, as a share of a step.
const STEP_SLACK = 0.12;
// Names sit lower on the Mission Complete screen than on the in-mission one,
// with a line of stats right under them, so that box is a tight one.
const NAME_BOXES = [
  { y: 458, height: 44, width: 200 },
  { y: 569, height: 32, width: 200 },
];
// Tight cells keep the frames standing behind the numbers out of the read; two
// sizes vote, since one can still catch a stray edge. A cell ends this far past
// its number's ink, or a leaf beside it reads as one more digit.
const CELLS = [
  { width: 120, height: 30, tail: 10 },
  { width: 150, height: 36, tail: 16 },
];
const UPSCALE = 2;
// Label text is a dim grey, or gold on some end screens; anything this bright
// and unsaturated counts as ink, as does value gold. Only the labels' first
// 110px count: past the shortest label the floor behind the table shows through.
const INK_CUT = 110;
const INK_SPREAD = 55;
const LABEL_INK_WIDTH = 110;
const VALUE_RED = 140;
const VALUE_GREEN = 120;
// Inked pixels a column needs to count: specks off the frames behind have fewer.
const MIN_INK = 3;
// No one kills this many in one Cascade; past it the read is noise.
const MAX_KILLS = 100_000;

export interface KillsScreenRead {
  /** Kills per column, left to right; you are the first. Null where unreadable;
   *  empty when the picture is an end screen but no number could be read. */
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

/** Whether an OCR'd name box holds a name rather than a stat row it overlapped. */
export function looksLikeName(text: string): boolean {
  return /\p{L}/u.test(text) && !/%/.test(text);
}

/** Runs of inked columns along a row, digits of one number merged; in the
 *  profile's own units. */
export function findInkRuns(
  profile: number[],
  minInk: number,
  gap: number,
): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = [];
  profile.forEach((ink, x) => {
    if (ink < minInk) return;
    const last = runs[runs.length - 1];
    if (last && x - last.end <= gap) last.end = x;
    else runs.push({ start: x, end: x });
  });
  return runs;
}

/** The numbers that sit on one squad's column spacing: the largest such set, the
 *  surest on a tie. Stray reads off the frames behind the table fall off the grid. */
export function pickColumns<T extends { x: number; confidence: number }>(
  found: T[],
  step: number,
  slack: number,
  max: number,
): T[] {
  let best: T[] = [];
  let bestSure = 0;
  for (const anchor of found) {
    // One number a column: a frame behind it can split its ink in two.
    const byColumn = new Map<number, { item: T; off: number }>();
    for (const other of found) {
      const steps = (other.x - anchor.x) / step;
      const column = Math.round(steps);
      const off = Math.abs(steps - column);
      if (off > slack) continue;
      const seen = byColumn.get(column);
      if (!seen || off < seen.off) byColumn.set(column, { item: other, off });
    }
    const onGrid = [...byColumn.entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry.item);
    const sure = onGrid.reduce((sum, other) => sum + other.confidence, 0);
    if (onGrid.length > best.length || (onGrid.length === best.length && sure > bestSure)) {
      best = onGrid;
      bestSure = sure;
    }
  }
  return best.slice(0, max);
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

/** An end screen whose numbers could not be read. */
const NO_NUMBERS: KillsScreenRead = { kills: [], names: [] };

/** Whether a pixel is label or value ink: bright grey/white or gold. */
function isInk(r: number, g: number, b: number): boolean {
  const lo = Math.min(r, g, b);
  const hi = Math.max(r, g, b);
  return (lo > INK_CUT && hi - lo < INK_SPREAD) || isValueInk(r, g, b);
}

/** Values are gold, the leader's white: bright red and green, no blue cast. */
function isValueInk(r: number, g: number, b: number): boolean {
  return r > VALUE_RED && g > VALUE_GREEN && r >= b;
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
      for (let x = 0; x < Math.min(slot.width, Math.round(LABEL_INK_WIDTH * scale)); x++) {
        const i = (y * slot.width + x) * 3;
        if (isInk(raw[i], raw[i + 1], raw[i + 2])) ink++;
      }
      inkRows += ink;
      inkSum += ink * y;
    }
    const centre = starts[hit] + (inkRows ? inkSum / inkRows / scale : ROW_PX / 2);

    // The numbers along the row: gold or white ink, one run per number.
    const strip = box(
      ROW_SCAN.left,
      centre - ROW_SCAN.height / 2,
      ROW_SCAN.right - ROW_SCAN.left,
      ROW_SCAN.height,
    );
    const row: Buffer = await sharp(source).extract(strip).removeAlpha().raw().toBuffer();
    const profile = Array.from({ length: strip.width }, (_, x) => {
      let ink = 0;
      for (let y = 0; y < strip.height; y++) {
        const i = (y * strip.width + x) * 3;
        if (isValueInk(row[i], row[i + 1], row[i + 2])) ink++;
      }
      return ink;
    });
    const runs = findInkRuns(
      profile,
      Math.max(MIN_INK, Math.round(MIN_INK * scale)),
      Math.round(DIGIT_GAP * scale),
    );
    // Back into 1080p units, where the crops are laid out.
    const starts1080 = runs.map(
      (run) => ROW_SCAN.left + (strip.left - box(ROW_SCAN.left, 0, 1, 1).left + run.start) / scale,
    );
    const inkWidths = runs.map((run) => (run.end - run.start + 1) / scale);
    if (!starts1080.length) return NO_NUMBERS;
    const reads = await Promise.all(
      CELLS.map(async (cell) =>
        recognizePaddleCrops(
          await Promise.all(
            starts1080.map((x, i) =>
              crop(
                box(
                  x - CELL_LEAD,
                  centre - cell.height / 2,
                  Math.min(cell.width, CELL_LEAD + inkWidths[i] + cell.tail),
                  cell.height,
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const numbers = starts1080
      .map((x, i) => ({
        x,
        kills: vote(reads.map((read) => read[i])),
        confidence: Math.max(...reads.map((read) => read[i].confidence)),
      }))
      .filter((found) => found.kills !== null);
    const columns = pickColumns(numbers, COLUMN_STEP, STEP_SLACK, MAX_COLUMNS);
    if (!columns.length) return NO_NUMBERS;
    const kills = columns.map((column) => column.kills);

    const nameReads = await Promise.all(
      NAME_BOXES.map(async (nameBox) =>
        recognizePaddleCrops(
          await Promise.all(
            columns.map((column) =>
              crop(box(column.x - NAME_LEAD, nameBox.y, nameBox.width, nameBox.height)),
            ),
          ),
        ),
      ),
    );
    const names = columns.map((_, c) => {
      const best = nameReads
        .map((read) => read[c])
        .filter((read) => looksLikeName(read.text))
        .sort((a, b) => b.confidence - a.confidence)[0];
      return best ? best.text.trim() : "";
    });
    return { kills, names };
  } catch (err) {
    log.warn("[LevelCapOcr] kills read failed:", normalizeErrorMessage(err));
    return null;
  }
}
