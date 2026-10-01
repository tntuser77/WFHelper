import type { LevelCapRun } from "./levelCapTypes.js";

/** Alias -> main name, as the user typed them. Lookups ignore case. */
type PlayerAliases = Record<string, string>;

const MAX_ALIASES = 200;
const MAX_NAME = 64;
/** Enough for a renamed alt of a renamed main; past that it is a cycle. */
const MAX_HOPS = 8;

/** Drops anything that is not a plain name -> different name pair. */
export function normalizePlayerAliases(raw: unknown): PlayerAliases {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: PlayerAliases = {};
  for (const [alias, main] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof main !== "string") continue;
    const from = alias.trim().slice(0, MAX_NAME);
    const to = main.trim().slice(0, MAX_NAME);
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
    out[from] = to;
    if (Object.keys(out).length >= MAX_ALIASES) break;
  }
  return out;
}

/** Returns a resolver from any name to its main name; unknown names come back as given. */
export function playerAliasResolver(aliases: PlayerAliases): (name: string) => string {
  const byLower = new Map(
    Object.entries(aliases).map(([alias, main]) => [alias.toLowerCase(), main]),
  );
  return (name) => {
    let current = name;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const next = byLower.get(current.toLowerCase());
      if (next === undefined) break;
      current = next;
    }
    return current;
  };
}

/** Copies of the runs with every squad name swapped for its main name. The name
 *  the game showed stays on squadmates and log entries as `alias`. */
export function applyPlayerAliases(runs: LevelCapRun[], aliases: PlayerAliases): LevelCapRun[] {
  if (!Object.keys(aliases).length) return runs;
  const main = playerAliasResolver(aliases);
  return runs.map((run) => {
    const out: LevelCapRun = { ...run };
    if (run.players) out.players = [...new Set(run.players.map(main))];
    if (run.squadmates) {
      out.squadmates = run.squadmates.map((mate) => {
        if (mate.name === null) return mate;
        const name = main(mate.name);
        return name === mate.name ? mate : { ...mate, name, alias: mate.name };
      });
    }
    if (run.squadLog) {
      out.squadLog = run.squadLog.map((mate) => {
        const name = main(mate.name);
        return name === mate.name ? mate : { ...mate, name, alias: mate.name };
      });
    }
    return out;
  });
}

/** "Main = Alt1, Alt2" per line, one line per main name. */
export function formatPlayerAliasLines(aliases: PlayerAliases): string {
  const byMain = new Map<string, string[]>();
  for (const [alias, main] of Object.entries(aliases)) {
    byMain.set(main, [...(byMain.get(main) ?? []), alias]);
  }
  return [...byMain].map(([main, alts]) => `${main} = ${alts.join(", ")}`).join("\n");
}

/** Reads the "Main = Alt1, Alt2" lines back; a line without "=" is skipped. */
export function parsePlayerAliasLines(text: string): PlayerAliases {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const main = line.slice(0, eq).trim();
    for (const alias of line.slice(eq + 1).split(",")) out[alias.trim()] = main;
  }
  return normalizePlayerAliases(out);
}
