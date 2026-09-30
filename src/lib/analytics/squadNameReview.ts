import {
  LEVEL_CAP_SQUAD_CROP,
  type LevelCapRun,
  type LevelCapSquadFixPatch,
} from "../../../config/shared/levelCapTypes.js";

/** The name reader ends a name it could only read part of with this. */
const CUT = "…";

export interface ReviewRow {
  slot: number;
  name: string | null;
  frame: string | null;
  /** The reader's best guess at the name: a hint only, often wrong for one-offs. */
  read: string | null;
  /** Fingerprint of the row's portrait; naming its frame names every look like it. */
  portrait: string | null;
  /** Where the row sits on the squad crop, as percentages, when it is known. */
  box: { top: number; height: number } | null;
}

interface SquadNameReview {
  /** Cut-off names, each with every row that carries it, most seen first. */
  cutOff: Array<{ name: string; rows: Array<{ run: LevelCapRun; slot: number }> }>;
  /** Screenshot runs with a squadmate missing a name or a frame, newest first. */
  missing: Array<{ run: LevelCapRun; rows: ReviewRow[] }>;
  /** Full names already seen, most seen first, to offer while typing. */
  known: string[];
}

/** Where a row sits on the squad crop the review shows, in percent. */
function cropBox(row: { top: number; bottom: number } | undefined): ReviewRow["box"] {
  if (!row) return null;
  const span = LEVEL_CAP_SQUAD_CROP.bottom - LEVEL_CAP_SQUAD_CROP.top;
  const top = ((row.top - LEVEL_CAP_SQUAD_CROP.top) / span) * 100;
  const height = ((row.bottom - row.top) / span) * 100;
  return top >= 0 && top + height <= 100 ? { top, height } : null;
}

/** What is left for a person to read off the screenshots: names cut short, and
 *  squadmates with no name or no frame. Rows without a slot predate slots and wait. */
export function squadNameReview(runs: readonly LevelCapRun[]): SquadNameReview {
  const cut = new Map<string, Array<{ run: LevelCapRun; slot: number }>>();
  const seen = new Map<string, number>();
  const missing: SquadNameReview["missing"] = [];
  for (const run of runs) {
    if (!run.screenshot) continue;
    const rows: ReviewRow[] = [];
    const readRows = run.squadReads?.length ?? 0;
    for (const mate of run.squadmates ?? []) {
      if (mate.slot === undefined) continue;
      if (mate.name?.endsWith(CUT)) {
        cut.set(mate.name, [...(cut.get(mate.name) ?? []), { run, slot: mate.slot }]);
      } else if (mate.name) seen.set(mate.name, (seen.get(mate.name) ?? 0) + 1);
      if (mate.name !== null && mate.frame !== null) continue;
      // Rows added by hand have no read, portrait or place on the picture.
      const fromRead = mate.slot < readRows;
      const read = fromRead ? run.squadReads?.[mate.slot] : undefined;
      rows.push({
        slot: mate.slot,
        name: mate.name,
        frame: mate.frame,
        read: read?.find((text) => text.trim())?.trim() ?? null,
        portrait: fromRead ? (run.squadPortraits?.[mate.slot] ?? null) : null,
        box: fromRead ? cropBox(run.squadRows?.[mate.slot]) : null,
      });
    }
    if (rows.length) missing.push({ run, rows });
  }
  const byCount = <T>(entries: Array<[string, T]>, size: (value: T) => number) =>
    entries.sort((a, b) => size(b[1]) - size(a[1]) || a[0].localeCompare(b[0]));
  return {
    cutOff: byCount([...cut], (rows) => rows.length).map(([name, rows]) => ({ name, rows })),
    missing: missing.sort((a, b) => b.run.completedAt - a.run.completedAt),
    known: byCount([...seen], (n) => n).map(([name]) => name),
  };
}

/** A correction for one row that keeps whatever was already set on it by hand. */
export function mergedSquadFix(
  run: LevelCapRun,
  slot: number,
  patch: { name?: string; frame?: string },
): LevelCapSquadFixPatch {
  const { slot: _slot, ...had } = run.squadFixes?.find((fix) => fix.slot === slot) ?? { slot };
  return { ...had, ...patch };
}

/** Rows still to fill in, for the button that opens the review. */
export function squadReviewCount(runs: readonly LevelCapRun[]): number {
  const review = squadNameReview(runs);
  return (
    review.cutOff.reduce((n, entry) => n + entry.rows.length, 0) +
    review.missing.reduce((n, entry) => n + entry.rows.length, 0)
  );
}
