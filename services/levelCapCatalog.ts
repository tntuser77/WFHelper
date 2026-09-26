import { withScope } from "./logger";
import { loadRegionTranslation } from "./regionNames";
import { normalizeErrorMessage } from "../config/shared/errors";
import type { LevelCapCatalog } from "../config/shared/levelCapTypes";

const log = withScope("levelCapCatalog");

interface PepEntry {
  name?: string;
  productCategory?: string;
  type?: string;
  rarity?: string;
  fusionLimit?: number;
  resultType?: string;
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
  ExportRecipes?: PepExport;
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
// The Helminth's subsume recipes; each one's result is the ability it can graft.
const HELMINTH_RECIPE_RE = /\/Recipes\/AbilityOverrides\//;

let _catalog: LevelCapCatalog | null = null;

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

function build(): LevelCapCatalog {
  const pep = require("warframe-public-export-plus") as Pep;
  const dict = loadRegionTranslation().dict;
  const nameOf = (entry: PepEntry | undefined) => (entry?.name ? dict[entry.name] : undefined);
  const pick = (source: PepExport | undefined, keep: (entry: PepEntry) => boolean) =>
    byName(
      Object.entries(source ?? {}).flatMap(([type, entry]) => {
        const name = nameOf(entry);
        return name && keep(entry) ? [{ type, name }] : [];
      }),
    );
  const weapons = (category: string) =>
    pick(pep.ExportWeapons, (entry) => entry.productCategory === category);

  const abilityNames = new Map<string, string>();
  for (const [type, entry] of Object.entries(pep.ExportAbilities ?? {})) {
    const name = nameOf(entry);
    if (name) abilityNames.set(type, name);
  }
  for (const frame of Object.values(pep.ExportWarframes ?? {})) {
    for (const ability of frame.abilities ?? []) {
      const name = ability.name ? dict[ability.name] : undefined;
      if (ability.uniqueName && name) abilityNames.set(ability.uniqueName, name);
    }
  }
  const helminth = Object.entries(pep.ExportRecipes ?? {}).flatMap(([recipe, entry]) => {
    const type = entry.resultType;
    const name = type && abilityNames.get(type);
    return HELMINTH_RECIPE_RE.test(recipe) && type && name ? [{ type, name }] : [];
  });

  return {
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
        return [
          {
            type,
            name,
            compat: entry.type,
            maxRank: entry.fusionLimit ?? 0,
            rarity: entry.rarity ?? "COMMON",
          },
        ];
      }),
    ),
    arcanes: byName(
      Object.entries(pep.ExportArcanes ?? {}).flatMap(([type, entry]) => {
        const name = nameOf(entry);
        if (!name || OPERATOR_ARCANE_RE.test(type)) return [];
        return [{ type, name, maxRank: entry.fusionLimit ?? 5, rarity: entry.rarity ?? "RARE" }];
      }),
    ),
    abilities: byName(helminth),
  };
}

/** Built once; the export only changes with an app update. */
export function levelCapCatalog(): LevelCapCatalog {
  if (_catalog) return _catalog;
  try {
    _catalog = build();
  } catch (err) {
    log.warn("[LevelCap] build catalogue unavailable:", normalizeErrorMessage(err));
    return {
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
  }
  return _catalog;
}
