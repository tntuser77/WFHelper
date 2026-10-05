import { EE_LOG_LINE_TS } from "./arbiRunParser";
import { decodeLevelCapTile } from "../config/shared/levelCapTiles";
import type { LevelCapTile } from "../config/shared/levelCapTypes";

const MISSION_NAME = /ThemedSquadOverlay\.lua: (?:Mission name:|Host loading )/;
const STATE_STARTED = /Game \[Info\]: OnStateStarted, mission type=(MT_[A-Z_]+)/;
const BRIDGES = /HighLevelGraph setup (\d+) implicit bridges for zone (\d+)/;
// Every squad member logs one of these while loading into the mission.
const LOADOUT_LOADED = /Game \[Info\]: (.+?) loadout loader finished/;
// Host only: a squad client never logs the Exolizer count.
const EXOLIZERS = /Void Cascade\): Pillars used increased to: (\d+)/;
// One reward tier per completed round; clients log it too.
const ROUND = /ZarimanSurvivalMission\.lua: Gave reward tier (\d+) at/;
const ABORT = /TopMenu\.lua: Abort:/;
const EOM = /Sys \[Info\]: EOM missionLocationUnlocked=/;
// Logged right after EOM, once per piece of gear that got kills this mission.
const GEAR_XP = /Weapon in slot ([A-Z_]+) with ID ([0-9a-f]{24}) has gained \d+ XP/;
/** The XP lines share EOM's timestamp; anything this much later is past them. */
const XP_WINDOW_SEC = 2;

// The squad, which outlives any one mission: the host holds HUD slot 1 and the
// rest follow in join order, you included.
const LEAVE_SQUAD = /MatchingService::LeaveSquad/;
const JOIN_SESSION = /JoinSquadSessionCallback\. Session id=\w+, host name=(.+)$/;
const ADD_MEMBER = /AddSquadMember: (.+?), mm=/;
const REMOVE_MEMBER = /RemoveSquadMember: (.+?) has been removed/;
// Each other player's loadout gets a loader; the scripts it spot-loads name
// their frame, unless that frame was already in memory.
const PLAYER_LOADER = /Creating loader for \/Temp\/OtherPlayer\d+_(.+)_\d+ loadout\.\.\./;
const LOADER_DONE = /ResourceLoader \S+ \(\/Temp\/OtherPlayer/;
const SPOT_LOAD =
  /Spot-loading \/Lotus\/Powersuits\/(\w+)\/\S*(?: \(root-type: (\/Lotus\/Powersuits\/[^)]+)\))?/;
// Joining a host already in the level, their frame loads with the level
// instead, just after this line.
const REMOTE_PLAYER = /Progress\.lua: Remote player (.+)$/;
const SUIT_FOLDER = /\/Lotus\/Powersuits\/(\w+)\//;
/** Folders under Powersuits that hold no warframe. */
const NOT_A_FRAME = new Set([
  "PowersuitAbilities",
  "Operator",
  "Archwing",
  "EntratiMech",
  "NpcPowersuits",
]);
const LEVEL_HINTS_MAX = 4;

interface LevelCapSquadEntry {
  name: string;
  slot: number;
  host: boolean;
  /** You: the first name a squad adds. */
  local: boolean;
  /** Powersuits folder their loader spot-loaded, e.g. "Ember". */
  suitFolder: string | null;
  /** Suit path when a spot-load named it, e.g. /Lotus/Powersuits/Ember/EmberPrime. */
  suitType: string | null;
  /** Host only: Powersuits folders the level load touched after naming them,
   *  in order. Your own frame can be among them. */
  levelLoadFolders: string[];
}

export interface LevelCapMission {
  startSec: number;
  endSec: number | null;
  exolizers: number | null;
  rounds: number | null;
  players: string[];
  /** Everyone in the squad at some point of the mission, by name. */
  squad: LevelCapSquadEntry[];
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
  rounds: number | null;
  players: Set<string>;
  squad: Map<string, LevelCapSquadEntry>;
  tile: LevelCapTile | null;
  gearXp: Record<string, string>;
}

const NO_EVENTS: readonly LevelCapParserEvent[] = [];

// Every pattern above carries one of these; the rest of EE.log can be skipped
// when catching up on a long log without running each regex on it.
const LINE_HINTS = [
  "ThemedSquadOverlay.lua",
  "OnStateStarted",
  "implicit bridges",
  "loadout loader finished",
  "ZarimanSurvivalMission.lua",
  "TopMenu.lua: Abort",
  "EOM missionLocationUnlocked",
  "Weapon in slot",
  "LeaveSquad",
  "JoinSquadSessionCallback",
  "SquadMember",
  "/Temp/OtherPlayer",
  "Remote player",
  "/Lotus/Powersuits/",
];

/** False for lines the parser would ignore anyway. */
export function isLevelCapLine(line: string): boolean {
  return LINE_HINTS.some((hint) => line.includes(hint));
}

function freshPrelude(): Prelude {
  return { bridges: new Map(), lastZone: -1, players: new Set() };
}

function snapshot(active: Active): LevelCapMission {
  return {
    startSec: active.startSec,
    endSec: active.endSec,
    exolizers: active.exolizers,
    rounds: active.rounds,
    players: [...active.players],
    squad: [...active.squad.values()].map((entry) => ({
      ...entry,
      levelLoadFolders: [...entry.levelLoadFolders],
    })),
    tile: active.tile,
    gearXp: { ...active.gearXp },
  };
}

/** Follows EE.log through Void Cascade missions. The room layout and squad
 * loaders print while the mission loads, so they are collected ahead of the
 * start line and handed to the mission when it begins. */
/** Names end in a private-use platform glyph (U+E000 for PC). */
function cleanName(raw: string): string {
  return raw.replace(/[-]/g, "").trim();
}

export function createLevelCapParser() {
  let prelude = freshPrelude();
  let active: Active | null = null;
  let squad: LevelCapSquadEntry[] = [];
  let joinedHost: string | null = null;
  let loaderOf: LevelCapSquadEntry | null = null;
  let levelLoadOf: LevelCapSquadEntry | null = null;

  function member(name: string, host = false): LevelCapSquadEntry {
    const known = squad.find((entry) => entry.name === name);
    if (known) return known;
    // A leaver's slot goes to the next to join.
    let slot = 1;
    while (squad.some((entry) => entry.slot === slot)) slot++;
    const entry: LevelCapSquadEntry = {
      name,
      slot,
      host,
      local: false,
      suitFolder: null,
      suitType: null,
      levelLoadFolders: [],
    };
    squad.push(entry);
    if (active && active.endSec == null) active.squad.set(name, entry);
    return entry;
  }

  /** Squad lines; true when the line was one. */
  function feedSquad(line: string): boolean {
    if (LEAVE_SQUAD.test(line)) {
      squad = [];
      joinedHost = null;
      loaderOf = levelLoadOf = null;
      return true;
    }
    const join = line.match(JOIN_SESSION);
    if (join) {
      squad = [];
      joinedHost = cleanName(join[1]);
      return true;
    }
    const add = line.match(ADD_MEMBER);
    if (add) {
      const name = cleanName(add[1]);
      if (!name) return true;
      if (!squad.length) {
        // The first add is always you: after the host when you joined one,
        // otherwise you are the host.
        if (joinedHost && joinedHost !== name) member(joinedHost, true);
        member(name, !joinedHost).local = true;
      } else {
        member(name);
      }
      return true;
    }
    const removed = line.match(REMOVE_MEMBER);
    if (removed) {
      const name = cleanName(removed[1]);
      squad = squad.filter((entry) => entry.name !== name);
      return true;
    }
    const loader = line.match(PLAYER_LOADER);
    if (loader) {
      const name = cleanName(loader[1]);
      loaderOf = name ? member(name) : null;
      levelLoadOf = null;
      return true;
    }
    if (loaderOf && LOADER_DONE.test(line)) {
      loaderOf = null;
      return true;
    }
    const remote = line.match(REMOTE_PLAYER);
    if (remote) {
      const name = cleanName(remote[1]);
      levelLoadOf = name ? member(name) : null;
      return true;
    }
    if (loaderOf) {
      const spot = line.match(SPOT_LOAD);
      if (spot && !NOT_A_FRAME.has(spot[1])) {
        const folder = spot[1];
        loaderOf.suitFolder ??= folder;
        const root = spot[2];
        // A root-type straight under the frame's folder is the suit itself.
        if (loaderOf.suitFolder === folder && root && root.split("/").length === 5) {
          loaderOf.suitType ??= root;
        }
      }
      return !!spot;
    }
    if (levelLoadOf) {
      const folder = line.match(SUIT_FOLDER)?.[1];
      const folders = levelLoadOf.levelLoadFolders;
      if (
        folder &&
        !NOT_A_FRAME.has(folder) &&
        !folders.includes(folder) &&
        folders.length < LEVEL_HINTS_MAX
      ) {
        folders.push(folder);
      }
      return !!folder;
    }
    return false;
  }

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

    if (feedSquad(line)) return events ?? NO_EVENTS;

    const loaded = line.match(LOADOUT_LOADED);
    if (loaded) {
      const name = cleanName(loaded[1]);
      if (name) (active && active.endSec == null ? active.players : prelude.players).add(name);
      return events ?? NO_EVENTS;
    }

    const started = line.match(STATE_STARTED);
    if (started) {
      close(out());
      levelLoadOf = null;
      if (started[1] === "MT_VOID_CASCADE") {
        active = {
          startSec: ts ?? 0,
          endSec: null,
          exolizers: null,
          rounds: null,
          players: new Set(prelude.players),
          squad: new Map(squad.map((entry) => [entry.name, entry])),
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

    const round = line.match(ROUND);
    if (round) {
      active.rounds = Math.max(active.rounds ?? 0, Number(round[1]));
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
    /** A Void Cascade is on its end screen: over, but not yet closed. */
    closing(): boolean {
      return active?.endSec != null;
    },
    /** The squad as it stands, by HUD slot. */
    squad(): LevelCapSquadEntry[] {
      return [...squad]
        .sort((a, b) => a.slot - b.slot)
        .map((entry) => ({ ...entry, levelLoadFolders: [...entry.levelLoadFolders] }));
    },
    /** End whatever is open, e.g. when EE.log was reset by a game restart. */
    flush(): LevelCapMission | null {
      const events: LevelCapParserEvent[] = [];
      close(events);
      return events[0]?.mission ?? null;
    },
  };
}
