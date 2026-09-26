/** Exolizers retired before a Void Cascade counts as a level cap run. */
export const LEVEL_CAP_EXOLIZER_TARGET = 107;

export type LevelCapFocusSchool = "madurai" | "vazarin" | "naramon" | "zenurik" | "unairu";

export type LevelCapSlotKind = "suit" | "primary" | "secondary" | "melee" | "archgun" | "companion";

export interface LevelCapUpgrade {
  slot: number;
  /** `/Lotus/...` path of the mod or arcane; null when the reference did not resolve. */
  type: string | null;
  rank: number | null;
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
  durationSec: number | null;
  /** Players in the mission including you; null when the log never said. */
  squadSize: number | null;
  tile: LevelCapTile | null;
  /** The archgun got kills this run, so it belongs in the build. */
  archgunUsed: boolean;
  build: LevelCapBuild | null;
  /** Build was guessed (imported run) and still needs a manual pass. */
  buildUnverified?: true;
  /** Absolute screenshot path; null when the run was logged without one. */
  screenshot: string | null;
  tags?: string[];
  notes?: string;
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
}

export interface LevelCapStatus {
  inCascade: boolean;
  exolizers: number | null;
  /** Id of the run F12 already logged for this mission, if any. */
  runId: string | null;
}

export interface LevelCapPayload {
  runs: LevelCapRun[];
  settings: LevelCapSettings;
  status: LevelCapStatus;
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
