/** Turns squad names OCR'd off old screenshots into real names. Reads are
 *  matched to names the user plays with first; the rest are grouped across
 *  runs, so a player seen in several runs gets a name and one-offs are dropped. */

export interface SquadRead {
  /** Cleaned text, spaces and case as read. */
  text: string;
  /** The HUD cut the name short ("WealthyPoe..."), so only its start is known. */
  truncated: boolean;
}

/** One screenshot's squad slots; each slot holds the variant reads of one row. */
export type SquadSlots = readonly (readonly string[])[];

export interface SquadResolution {
  players: string[];
  /** Slots whose name could not be pinned to anyone. */
  unknown: number;
}

// Looser for names the user knows, since those are worth a best guess.
const KNOWN_MATCH = 0.25;
const CLUSTER_MATCH = 0.2;
const MIN_NAME = 4;

function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

/** Strips the platform icon, slot number and HUD dots a raw OCR line carries. */
export function cleanSquadRead(raw: string): SquadRead | null {
  let text = raw.replace(/[^\x20-\x7E]/g, " ");
  if (/\[\d/.test(text)) return null;
  const cut = text.match(/^(.*?)\s*(?:\.{2,}|…)/);
  const truncated = cut !== null;
  if (cut) text = cut[1];
  else text = text.replace(/\s+\S{1,3}\s*$/, "");
  text = text
    .replace(/[^A-Za-z0-9 ._-]/g, "")
    .replace(/^[\s.:]+/, "")
    .trim();
  if (fold(text).length < 3 || !/[a-z]/i.test(text)) return null;
  return { text, truncated };
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0 for the same name, rising with each misread character. A cut-off read is
 *  compared on its start only, and a full read may carry two junk characters. */
export function squadNameDistance(a: SquadRead, b: SquadRead): number {
  const [s, l] = [a, b]
    .map((read) => ({ text: fold(read.text), truncated: read.truncated }))
    .sort((x, y) => x.text.length - y.text.length);
  const short = s.text;
  if (short.length < MIN_NAME) return 1;
  const long = s.truncated ? l.text.slice(0, short.length) : l.text;
  let best = levenshtein(short, long);
  if (!s.truncated && !l.truncated) {
    for (let k = 1; k <= 2 && long.length - k >= short.length; k++) {
      best = Math.min(best, levenshtein(short, long.slice(0, long.length - k)));
    }
  }
  return best / short.length;
}

/** Against a name the user knows, a read may also be missing its start, as
 *  when a bright wall swallowed the first letters ("thyPoe..." for WealthyPoet). */
function knownNameDistance(read: SquadRead, known: SquadRead): number {
  let best = squadNameDistance(read, known);
  if (fold(read.text).length < MIN_NAME + 1) return best;
  const name = fold(known.text);
  for (let from = 1; from + MIN_NAME < name.length; from++) {
    const rest = { text: name.slice(from), truncated: false };
    best = Math.min(best, squadNameDistance({ ...read, truncated: true }, rest));
  }
  return best;
}

/** The name most reads agree on, position by position, up to where they stop
 *  agreeing; cut-off reads only vote on their start. Marked with an ellipsis
 *  when most reads were cut off. */
function consensus(reads: readonly SquadRead[]): string {
  const texts = reads.map((read) => read.text.replace(/\s+/g, ""));
  const picked: Array<{ char: string; agreed: boolean }> = [];
  for (let i = 0; ; i++) {
    const votes = new Map<string, number>();
    let covering = 0;
    for (const text of texts) {
      if (text.length <= i) continue;
      covering++;
      votes.set(text[i], (votes.get(text[i]) ?? 0) + 1);
    }
    if (!covering || covering < texts.length * 0.6) break;
    const [char, count] = [...votes].sort((x, y) => y[1] - x[1])[0];
    picked.push({ char, agreed: count >= covering * 0.6 });
  }
  // The platform icon reads as a different junk character every time, so the
  // tail stops where the reads stop agreeing; a misread letter mid-name stays.
  while (picked.length && !picked[picked.length - 1].agreed) picked.pop();
  const out = picked
    .map((p) => p.char)
    .join("")
    .replace(/[-._]+$/, "");
  const cut = reads.filter((read) => read.truncated).length > reads.length / 2;
  return cut ? `${out}…` : out;
}

/** Resolves every screenshot's slots at once, since a player only counts as a
 *  regular by turning up in more than one run. `known` are exact names. */
export function resolveSquadNames(
  runs: readonly SquadSlots[],
  known: readonly string[],
): SquadResolution[] {
  const knownReads = known.map((name) => ({ name, read: { text: name, truncated: false } }));
  const slots = runs.map((slotsOfRun) =>
    slotsOfRun.map((variants) =>
      variants.flatMap((raw) => {
        const read = cleanSquadRead(raw);
        return read ? [read] : [];
      }),
    ),
  );

  const results: Array<Array<string | null>> = slots.map((run) => run.map(() => null));
  const loose: Array<{ run: number; slot: number; reads: SquadRead[] }> = [];
  slots.forEach((run, r) =>
    run.forEach((variants, s) => {
      let best: { name: string; d: number } | null = null;
      for (const read of variants) {
        for (const known of knownReads) {
          const d = knownNameDistance(read, known.read);
          if (d <= KNOWN_MATCH && (!best || d < best.d)) best = { name: known.name, d };
        }
      }
      if (best) results[r][s] = best.name;
      else if (variants.length) loose.push({ run: r, slot: s, reads: variants });
    }),
  );

  // Single-link grouping of unmatched rows; any pair of their reads can link them.
  const rowDistance = (a: SquadRead[], b: SquadRead[]) =>
    Math.min(...a.flatMap((x) => b.map((y) => squadNameDistance(x, y))));
  const parent = loose.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < loose.length; i++) {
    for (let j = i + 1; j < loose.length; j++) {
      if (loose[i].run === loose[j].run) continue;
      if (rowDistance(loose[i].reads, loose[j].reads) <= CLUSTER_MATCH) parent[root(i)] = root(j);
    }
  }
  const groups = new Map<number, number[]>();
  loose.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));
  for (const members of groups.values()) {
    if (new Set(members.map((i) => loose[i].run)).size < 2) continue;
    // Each row votes with the read closest to the other rows, not its garbled ones.
    const picks = members.map((i) => {
      const others = members.filter((j) => j !== i).flatMap((j) => loose[j].reads);
      const score = (read: SquadRead) =>
        others.reduce((sum, other) => sum + Math.min(1, squadNameDistance(read, other)), 0);
      return loose[i].reads.reduce((a, b) => (score(b) < score(a) ? b : a));
    });
    const name = consensus(picks);
    if (fold(name).length < MIN_NAME) continue;
    for (const i of members) results[loose[i].run][loose[i].slot] = name;
  }

  return results.map((run) => {
    const players = [...new Set(run.filter((name): name is string => name !== null))];
    return { players, unknown: run.length - players.length };
  });
}
