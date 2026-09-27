/** Exolizers retired before a Void Cascade counts as a level cap run. */
export const LEVEL_CAP_EXOLIZER_TARGET = 107;

export type LevelCapFocusSchool = "madurai" | "vazarin" | "naramon" | "zenurik" | "unairu";

export type LevelCapSlotKind = "suit" | "primary" | "secondary" | "melee" | "archgun" | "companion";

interface LevelCapRivenStat {
  name: string;
  /** At the riven's rank when captured; a multiplier stat reads as xN. */
  value: number;
  positive: boolean;
  multiplier: boolean;
}

/** The rolled stats of a riven in a slot, frozen with the build. */
export interface LevelCapRiven {
  name: string;
  stats: LevelCapRivenStat[];
}

export interface LevelCapUpgrade {
  slot: number;
  /** `/Lotus/...` path of the mod or arcane; null when the reference did not resolve. */
  type: string | null;
  rank: number | null;
  riven?: LevelCapRiven;
}

export interface LevelCapItem {
  kind: LevelCapSlotKind;
  type: string;
  /** Mod config the loadout had selected (A = 0). */
  config: number;
  configName?: string;
  upgrades: LevelCapUpgrade[];
  /** Helminth ability replacing an ability, suits only. */
  helminth?: { ability: string; index: number };
  /** Archon shard upgrade paths, suits only. */
  shards?: Array<{ color: string; type: string }>;
  /** Companion weapon riding with a companion. */
  weapon?: LevelCapItem;
  /** Fitted parts of a zaw, kitgun or MOA, whose `type` every build of its kind shares. */
  parts?: string[];
  /** The name the player gave a modular build, e.g. "Rabve Status". */
  customName?: string;
}

export interface LevelCapBuild {
  suit: LevelCapItem | null;
  primary: LevelCapItem | null;
  secondary: LevelCapItem | null;
  melee: LevelCapItem | null;
  archgun: LevelCapItem | null;
  companion: LevelCapItem | null;
  focus: LevelCapFocusSchool | null;
  /** Saved loadout the build came from, when it had a name. */
  loadoutName?: string;
}

interface LevelCapTileRoom {
  zone: number;
  fingerprint: number;
  name: string | null;
  exoSpawns: number | null;
}

export interface LevelCapTile {
  rooms: LevelCapTileRoom[];
  /** Sum of Exolizer spawns across known rooms; null when any room is unknown. */
  total: number | null;
}

type LevelCapRunSource = "hotkey" | "mission-end" | "import";

export interface LevelCapRun {
  /** "YYYY-MM-DD_HH-mm-ss" wall clock at completion, unique within the index. */
  id: string;
  completedAt: number;
  /** Group key shown in the list, e.g. "Dante"; a Prime shares its base frame's row. */
  frame: string;
  /** `/Lotus/Powersuits/...` path of the frame played, when known. */
  frameType: string | null;
  source: LevelCapRunSource;
  exolizers: number | null;
  /** Imported runs only: whether the Exolizer count was read off the screenshot. */
  exolizerOcr?: "read" | "unreadable";
  /** Rounds completed; the only progress a squad client's log carries. */
  rounds?: number | null;
  durationSec: number | null;
  /** Players in the mission including you; null when the log never said. */
  squadSize: number | null;
  /** Names the log gave for the squad, you included; on screenshot runs, the
   *  squadmates read off the picture that could be pinned to someone. */
  players?: string[];
  /** Screenshot runs: raw OCR of each squad row, variant reads per row. */
  squadReads?: string[][];
  squadOcr?: "read" | "unreadable";
  /** `players` came from `squadReads` and is redone as names are learned. */
  playersFromScreenshot?: boolean;
  tile: LevelCapTile | null;
  /** The archgun got kills this run, so it belongs in the build. */
  archgunUsed: boolean;
  /** Copy of the named build's loadout, kept in step with it by the store. */
  build: LevelCapBuild | null;
  /** Named build the run was played with; editing that build rewrites `build`. */
  buildId?: string;
  /** Build was guessed (imported run) and still needs a manual pass. */
  buildUnverified?: true;
  /** Absolute screenshot path; null when the run was logged without one. */
  screenshot: string | null;
  /** Only on runs without a named build; assigning one moves these onto the build. */
  tags?: string[];
}

/** A frame's loadout under a name, shared by every run played with it. */
export interface LevelCapNamedBuild {
  id: string;
  /** Frame group, the same key runs use, e.g. "Dante". */
  frame: string;
  name: string;
  tags?: string[];
  build: LevelCapBuild;
}

export interface LevelCapBuildPatch {
  name?: string;
  tags?: string[];
  build?: LevelCapBuild;
}

/** Where a new build starts from: the loadout equipped now, or a copy of another build. */
export type LevelCapBuildSource = { kind: "equipped" } | { kind: "build"; id: string };

interface LevelCapCatalogEntry {
  type: string;
  name: string;
}

/** Choices for the build editor's pickers, from the game's public export. */
export interface LevelCapCatalog {
  suits: LevelCapCatalogEntry[];
  primary: LevelCapCatalogEntry[];
  secondary: LevelCapCatalogEntry[];
  melee: LevelCapCatalogEntry[];
  archgun: LevelCapCatalogEntry[];
  companion: LevelCapCatalogEntry[];
  /** `compat` is the export's mod type, e.g. "WARFRAME", "AURA", "STANCE"; one item
   *  holds one mod per `family`; `stats` is the max-rank card text. */
  mods: Array<
    LevelCapCatalogEntry & {
      compat: string;
      maxRank: number;
      rarity: string;
      family: string;
      stats: string;
      /** Set on augments: the base suit they fit and the ability they change. */
      augment?: { suit: string; ability: string | null };
    }
  >;
  arcanes: Array<LevelCapCatalogEntry & { maxRank: number; rarity: string; stats: string }>;
  /** What the Helminth can graft: one ability per frame plus its own. */
  abilities: LevelCapCatalogEntry[];
  /** Frame type -> the base suit its augments name, e.g. HydroidPrime -> PirateBaseSuit. */
  suitParents: Record<string, string>;
}

export interface LevelCapSettings {
  /** Electron accelerator for "finish run"; empty disables the hotkey. */
  hotkey: string;
  /** Let the key through to the game and Steam instead of swallowing it. */
  passthrough: boolean;
  /** Root of the per-frame screenshot folders. */
  screenshotDir: string;
  /** Mirror of the index and screenshots; empty disables the backup. */
  backupDir: string;
  /** Exact names of players the user runs with, so screenshot reads snap to them. */
  knownPlayers: string[];
}

export interface LevelCapStatus {
  inCascade: boolean;
  exolizers: number | null;
  rounds: number | null;
  /** Id of the run F12 already logged for this mission, if any. */
  runId: string | null;
}

export interface LevelCapPayload {
  runs: LevelCapRun[];
  builds: LevelCapNamedBuild[];
  settings: LevelCapSettings;
  status: LevelCapStatus;
  /** Free-form notes per frame, keyed by the frame's display name. */
  frameNotes: Record<string, string>;
  /** Whether the finish-run key is live, and whether this platform can share it
   *  with the game (Linux shortcuts always take the key). */
  hotkey: { bound: boolean; canPassThrough: boolean };
  /** English names of the Helminth abilities the runs use, keyed by ability path. */
  abilityNames: Record<string, string>;
}

export interface LevelCapImportResult {
  imported: number;
  skipped: number;
}

/** What the hotkey did, for the toast. */
export type LevelCapHotkeyOutcome =
  | { type: "logged"; run: LevelCapRun; frameRuns: number }
  | { type: "screenshot-replaced"; run: LevelCapRun }
  | { type: "below-target"; exolizers: number }
  | { type: "capture-failed" };
