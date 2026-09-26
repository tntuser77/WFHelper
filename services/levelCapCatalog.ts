import { withScope } from "./logger";
import { loadRegionTranslation } from "./regionNames";
import { normalizeErrorMessage } from "../config/shared/errors";
import type {
  LevelCapCatalog,
  LevelCapNamedBuild,
  LevelCapRun,
} from "../config/shared/levelCapTypes";

const log = withScope("levelCapCatalog");

interface PepEntry {
  name?: string;
  productCategory?: string;
  type?: string;
  fusionLimit?: number;
  abilities?: Array<{ uniqueName?: string; name?: string }>;
}

type PepExport = Record<string, PepEntry>;

interface Pep {
  ExportWarframes?: PepExport;
  ExportWeapons?: PepExport;
  ExportSentinels?: PepExport;
  ExportUpgrades?: PepExport;
  ExportArcanes?: PepExport;
  ExportAbilities?: PepExport;
}

const WEAPON_SLOTS = {
  primary: "LongGuns",
  secondary: "Pistols",
  melee: "Melee",
  archgun: "SpaceGuns",
} as const;
const COMPANION_CATEGORIES = new Set(["Sentinels", "KubrowPets", "MoaPets"]);
// Operator gear shares the arcane export but never sits on a loadout slot.
const OPERATOR_ARCANE_RE = /\/CosmeticEnhancers\/Operator/;
const RIVEN_RE = /\/Mods\/Randomized\//;
// Flawed starter mods share their full version's name and would list it twice.
const FLAWED_RE = /\/Beginner\//;

let _static: Omit<LevelCapCatalog, "shards"> | null = null;

function byName<T extends { name: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = JSON.stringify({ ...entry, type: undefined });
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function staticCatalog(): Omit<LevelCapCatalog, "shards"> {
  if (_static) return _static;
  const empty = {
    suits: [],
    primary: [],
    secondary: [],
    melee: [],
    archgun: [],
    companion: [],
    mods: [],
    arcanes: [],
    abilities: [],
  };
  try {
    const pep = require("warframe-public-export-plus") as Pep;
    const dict = loadRegionTranslation().dict;
    const nameOf = (entry: PepEntry | undefined) => (entry?.name ? dict[entry.name] : undefined);
    const pick = (
      source: PepExport | undefined,
      keep: (entry: PepEntry, type: string) => boolean,
    ) =>
      byName(
        Object.entries(source ?? {}).flatMap(([type, entry]) => {
          const name = nameOf(entry);
          return name && keep(entry, type) ? [{ type, name }] : [];
        }),
      );
    const weapons = (category: string) =>
      pick(pep.ExportWeapons, (entry) => entry.productCategory === category);

    const abilities = new Map<string, string>();
    for (const [type, entry] of Object.entries(pep.ExportAbilities ?? {})) {
      const name = nameOf(entry);
      if (name) abilities.set(type, name);
    }
    for (const frame of Object.values(pep.ExportWarframes ?? {})) {
      for (const ability of frame.abilities ?? []) {
        const name = ability.name ? dict[ability.name] : undefined;
        if (ability.uniqueName && name && !abilities.has(ability.uniqueName)) {
          abilities.set(ability.uniqueName, name);
        }
      }
    }

    _static = {
      suits: pick(pep.ExportWarframes, (entry) => entry.productCategory === "Suits"),
      primary: weapons(WEAPON_SLOTS.primary),
      secondary: weapons(WEAPON_SLOTS.secondary),
      melee: weapons(WEAPON_SLOTS.melee),
      archgun: weapons(WEAPON_SLOTS.archgun),
      companion: pick(pep.ExportSentinels, (entry) =>
        COMPANION_CATEGORIES.has(entry.productCategory ?? ""),
      ),
      mods: byName(
        Object.entries(pep.ExportUpgrades ?? {}).flatMap(([type, entry]) => {
          const name = nameOf(entry);
          if (!name || !entry.type || RIVEN_RE.test(type) || FLAWED_RE.test(type)) return [];
          return [{ type, name, compat: entry.type, maxRank: entry.fusionLimit ?? 0 }];
        }),
      ),
      arcanes: byName(
        Object.entries(pep.ExportArcanes ?? {}).flatMap(([type, entry]) => {
          const name = nameOf(entry);
          if (!name || OPERATOR_ARCANE_RE.test(type)) return [];
          return [{ type, name, maxRank: entry.fusionLimit ?? 5 }];
        }),
      ),
      abilities: byName([...abilities].map(([type, name]) => ({ type, name }))),
    };
  } catch (err) {
    log.warn("[LevelCap] build catalogue unavailable:", normalizeErrorMessage(err));
    _static = empty;
  }
  return _static;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** Shard effects the export never lists: the ones socketed on any owned frame or saved build. */
function seenShards(
  inventory: unknown,
  builds: readonly LevelCapNamedBuild[],
  runs: readonly LevelCapRun[],
): LevelCapCatalog["shards"] {
  const found = new Map<string, { color: string; type: string }>();
  const add = (color: unknown, type: unknown) => {
    if (typeof color !== "string" || typeof type !== "string" || !color || !type) return;
    found.set(`${color}|${type}`, { color, type });
  };
  const suits = record(inventory)?.Suits;
  for (const suit of Array.isArray(suits) ? suits : []) {
    const slots = record(suit)?.ArchonCrystalUpgrades;
    for (const slot of Array.isArray(slots) ? slots : []) {
      add(record(slot)?.Color, record(slot)?.UpgradeType);
    }
  }
  for (const build of [...builds.map((b) => b.build), ...runs.map((r) => r.build)]) {
    for (const shard of build?.suit?.shards ?? []) add(shard.color, shard.type);
  }
  return [...found.values()].sort(
    (a, b) => a.color.localeCompare(b.color) || a.type.localeCompare(b.type),
  );
}

export function levelCapCatalog(
  inventory: unknown,
  builds: readonly LevelCapNamedBuild[],
  runs: readonly LevelCapRun[],
): LevelCapCatalog {
  return { ...staticCatalog(), shards: seenShards(inventory, builds, runs) };
}
