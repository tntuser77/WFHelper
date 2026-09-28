import type { LevelCapRun } from "../../../config/shared/levelCapTypes.js";

/** The name reader ends a name it could only read part of with this. */
const CUT = "…";

interface UnnamedRow {
  slot: number;
  frame: string | null;
  /** The reader's best guess at the row: a hint only, often wrong for one-offs. */
  read: string | null;
}

interface ReviewRow {
  run: LevelCapRun;
  slot: number;
}

interface SquadNameReview {
  /** Cut-off names, each with every row that carries it, most seen first. */
  cutOff: Array<{ name: string; rows: ReviewRow[] }>;
  /** Screenshot runs with squadmates nobody could name, newest first. */
  unnamed: Array<{ run: LevelCapRun; rows: UnnamedRow[] }>;
  /** Full names already seen, most seen first, to offer while typing. */
  known: string[];
}

/** What is left for a person to read off the screenshots: names cut short, and
 *  squadmates with no name at all. Rows without a slot predate slots and wait. */
export function squadNameReview(runs: readonly LevelCapRun[]): SquadNameReview {
  const cut = new Map<string, ReviewRow[]>();
  const seen = new Map<string, number>();
  const unnamed: SquadNameReview["unnamed"] = [];
  for (const run of runs) {
    if (!run.screenshot) continue;
    const blank: UnnamedRow[] = [];
    for (const mate of run.squadmates ?? []) {
      if (mate.slot === undefined) continue;
      if (mate.name === null) {
        const read = run.squadReads?.[mate.slot]?.find((text) => text.trim()) ?? null;
        blank.push({ slot: mate.slot, frame: mate.frame, read: read?.trim() ?? null });
      } else if (mate.name.endsWith(CUT)) {
        cut.set(mate.name, [...(cut.get(mate.name) ?? []), { run, slot: mate.slot }]);
      } else seen.set(mate.name, (seen.get(mate.name) ?? 0) + 1);
    }
    if (blank.length) unnamed.push({ run, rows: blank });
  }
  const byCount = <T>(entries: Array<[string, T]>, size: (value: T) => number) =>
    entries.sort((a, b) => size(b[1]) - size(a[1]) || a[0].localeCompare(b[0]));
  return {
    cutOff: byCount([...cut], (rows) => rows.length).map(([name, rows]) => ({ name, rows })),
    unnamed: unnamed.sort((a, b) => b.run.completedAt - a.run.completedAt),
    known: byCount([...seen], (n) => n).map(([name]) => name),
  };
}

/** A name for one row that keeps a frame already set on it by hand. */
export function namedSquadFix(
  run: LevelCapRun,
  slot: number,
  name: string,
): { name: string; frame?: string } {
  const frame = run.squadFixes?.find((fix) => fix.slot === slot)?.frame;
  return frame ? { name, frame } : { name };
}
