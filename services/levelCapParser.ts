import { EE_LOG_LINE_TS } from "./arbiRunParser";
import { decodeLevelCapTile } from "../config/shared/levelCapTiles";
import type { LevelCapTile } from "../config/shared/levelCapTypes";

const MISSION_NAME = /ThemedSquadOverlay\.lua: (?:Mission name:|Host loading )/;
const STATE_STARTED = /Game \[Info\]: OnStateStarted, mission type=(MT_[A-Z_]+)/;
const BRIDGES = /HighLevelGraph setup (\d+) implicit bridges for zone (\d+)/;
// Every squad member logs one of these while loading into the mission.
const LOADOUT_LOADED = /Game \[Info\]: (.+?) loadout loader finished/;
const EXOLIZERS = /Void Cascade\): Pillars used increased to: (\d+)/;
const ABORT = /TopMenu\.lua: Abort:/;
const EOM = /Sys \[Info\]: EOM missionLocationUnlocked=/;
// Logged right after EOM, once per piece of gear that got kills this mission.
const GEAR_XP = /Weapon in slot ([A-Z_]+) with ID ([0-9a-f]{24}) has gained \d+ XP/;
/** The XP lines share EOM's timestamp; anything this much later is past them. */
const XP_WINDOW_SEC = 2;

export interface LevelCapMission {
  startSec: number;
  endSec: number | null;
  exolizers: number | null;
  players: string[];
  tile: LevelCapTile | null;
  /** Loadout slot -> item id for every slot that gained XP at mission end. */
  gearXp: Record<string, string>;
}

type LevelCapParserEvent =
  | { type: "start"; mission: LevelCapMission }
  | { type: "end"; mission: LevelCapMission };

interface Prelude {
  bridges: Map<number, number>;
  lastZone: number;
  players: Set<string>;
}

interface Active {
  startSec: number;
  endSec: number | null;
  exolizers: number | null;
  players: Set<string>;
  tile: LevelCapTile | null;
  gearXp: Record<string, string>;
}

const NO_EVENTS: readonly LevelCapParserEvent[] = [];

function freshPrelude(): Prelude {
  return { bridges: new Map(), lastZone: -1, players: new Set() };
}

function snapshot(active: Active): LevelCapMission {
  return {
    startSec: active.startSec,
    endSec: active.endSec,
    exolizers: active.exolizers,
    players: [...active.players],
    tile: active.tile,
    gearXp: { ...active.gearXp },
  };
}

/** Follows EE.log through Void Cascade missions. The room layout and squad
 * loaders print while the mission loads, so they are collected ahead of the
 * start line and handed to the mission when it begins. */
export function createLevelCapParser() {
  let prelude = freshPrelude();
  let active: Active | null = null;

  function close(events: LevelCapParserEvent[]): void {
    if (!active) return;
    events.push({ type: "end", mission: snapshot(active) });
    active = null;
  }

  function feedLine(line: string): readonly LevelCapParserEvent[] {
    if (!line) return NO_EVENTS;
    const tsMatch = line.match(EE_LOG_LINE_TS);
    const ts = tsMatch ? parseFloat(tsMatch[1]) : null;
    let events: LevelCapParserEvent[] | null = null;
    const out = (): LevelCapParserEvent[] => (events ??= []);

    // After EOM only the XP lines matter; the first later line closes the mission.
    if (active?.endSec != null) {
      const xp = line.match(GEAR_XP);
      if (xp) {
        active.gearXp[xp[1]] = xp[2];
        return NO_EVENTS;
      }
      if (ts !== null && ts > active.endSec + XP_WINDOW_SEC) close(out());
    }

    if (MISSION_NAME.test(line)) {
      close(out());
      prelude = freshPrelude();
      return events ?? NO_EVENTS;
    }

    const bridges = line.match(BRIDGES);
    if (bridges) {
      const zone = Number(bridges[2]);
      // Zones print in ascending order per level load; a drop starts a new level.
      if (zone <= prelude.lastZone) {
        prelude.bridges = new Map();
      }
      prelude.lastZone = zone;
      prelude.bridges.set(zone, Number(bridges[1]));
      return events ?? NO_EVENTS;
    }

    const loaded = line.match(LOADOUT_LOADED);
    if (loaded) {
      // Names end in a private-use platform glyph (U+E000 for PC).
      const name = loaded[1].replace(/[-]/g, "").trim();
      if (name) (active && active.endSec == null ? active.players : prelude.players).add(name);
      return events ?? NO_EVENTS;
    }

    const started = line.match(STATE_STARTED);
    if (started) {
      close(out());
      if (started[1] === "MT_VOID_CASCADE") {
        active = {
          startSec: ts ?? 0,
          endSec: null,
          exolizers: null,
          players: new Set(prelude.players),
          tile: decodeLevelCapTile(prelude.bridges),
          gearXp: {},
        };
        out().push({ type: "start", mission: snapshot(active) });
      }
      return events ?? NO_EVENTS;
    }

    if (!active || active.endSec != null) return events ?? NO_EVENTS;

    const exo = line.match(EXOLIZERS);
    if (exo) {
      active.exolizers = Math.max(active.exolizers ?? 0, Number(exo[1]));
      return NO_EVENTS;
    }

    if (ABORT.test(line) || EOM.test(line)) {
      active.endSec = ts ?? active.startSec;
    }
    return events ?? NO_EVENTS;
  }

  return {
    feedLine,
    /** The mission in progress, or null outside a Void Cascade. */
    current(): LevelCapMission | null {
      return active && active.endSec == null ? snapshot(active) : null;
    },
    /** End whatever is open, e.g. when EE.log was reset by a game restart. */
    flush(): LevelCapMission | null {
      const events: LevelCapParserEvent[] = [];
      close(events);
      return events[0]?.mission ?? null;
    },
  };
}
