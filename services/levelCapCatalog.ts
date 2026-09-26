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
  compat?: string;
  parentName?: string;
  abilities?: Array<{ uniqueName?: string; name?: string }>;
}

type PepExport = Record<string, PepEntry>;

interface Pep {
  dict_en?: Record<string, string>;
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

// Variants the game will not equip beside their base mod.
const VARIANT_PREFIX_RE = /^(?:Primed|Archon|Umbral) /;
// Variants whose base goes by another name; nothing in the export links them.
const VARIANT_BASES: Record<string, string> = {
  "Galvanized Chamber": "Split Chamber",
  "Galvanized Diffusion": "Barrel Diffusion",
  "Galvanized Hell": "Hell's Chamber",
  "Umbral Fiber": "Steel Fiber",
  "Sacrificial Pressure": "Pressure Point",
  "Sacrificial Steel": "True Steel",
};

// Augment cards open with the ability they change: "Tempest Barrage Augment: ...".
const AUGMENT_TEXT_RE = /^(.+?) Augment:/;
const AUGMENT_COMPAT_RE = /^\/Lotus\/Powersuits\//;

let _catalog: LevelCapCatalog | null = null;

/** "/Lotus/Powersuits/Pirate/CannonBarrageAugmentCard" -> "cannonbarrage". */
function abilityStem(type: string): string {
  return (type.split("/").pop() ?? "")
    .replace(/Augment.*$/, "")
    .replace(/Ability$/, "")
    .toLowerCase();
}

/** The ability an augment changes, by the card text first and the path second. */
export function levelCapAugmentAbility(
  type: string,
  stats: string,
  abilities: ReadonlyArray<{ type: string; name: string }>,
): string | null {
  const named = AUGMENT_TEXT_RE.exec(stats)?.[1]?.toLowerCase();
  const byText = named && abilities.find((a) => a.name.toLowerCase() === named);
  if (byText) return byText.type;
  const stem = abilityStem(type);
  const byPath = abilities.find((a) => {
    const other = abilityStem(a.type);
    return stem && (other.includes(stem) || stem.includes(other));
  });
  return byPath?.type ?? null;
}

/** Mods that share a family cannot sit on one item together: Continuity, Primed
 *  Continuity and Archon Continuity are all "WARFRAME|Continuity". */
export function levelCapModFamily(
  name: string,
  compat: string,
  known: ReadonlySet<string>,
): string {
  const alias = VARIANT_BASES[name];
  if (alias) return `${compat}|${alias}`;
  const base = name.replace(VARIANT_PREFIX_RE, "");
  return `${compat}|${base !== name && known.has(`${compat}|${base}`) ? base : name}`;
}

/** Max-rank stat lines from WFCD, keyed by uniqueName; the DE export has no card text. */
function loadStatText(): Map<string, string> {
  const text = new Map<string, string>();
  try {
    const Items = require("@wfcd/items");
    const items = new Items({ category: ["Mods", "Arcanes"] }) as Array<{
      uniqueName?: string;
      levelStats?: Array<{ stats?: string[] }>;
    }>;
    for (const item of items) {
      const stats = item.levelStats?.[item.levelStats.length - 1]?.stats;
      if (!item.uniqueName || !stats?.length) continue;
      const lines = stats.map((line) =>
        line
          .replace(/<[^>]*>/g, "")
          // WFCD escapes its line breaks as a literal backslash-n.
          .replace(/(?:\\n|\s)+/g, " ")
          .trim(),
      );
      text.set(item.uniqueName, [...new Set(lines)].filter(Boolean).join(" · "));
    }
  } catch (err) {
    log.warn("[LevelCap] mod stat text unavailable:", normalizeErrorMessage(err));
  }
  return text;
}

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
  const statText = loadStatText();
  const modEntries = Object.entries(pep.ExportUpgrades ?? {}).flatMap(([type, entry]) => {
    const name = nameOf(entry);
    if (!name || !entry.type || RIVEN_RE.test(type) || FLAWED_RE.test(type)) return [];
    return [{ type, name, compat: entry.type, entry }];
  });
  const knownMods = new Set(modEntries.map((mod) => `${mod.compat}|${mod.name}`));

  // Augments target a frame's base suit, which every variant (Prime too) shares.
  const english = pep.dict_en ?? {};
  const suitParents: Record<string, string> = {};
  const suitAbilities = new Map<string, Array<{ type: string; name: string }>>();
  for (const [type, frame] of Object.entries(pep.ExportWarframes ?? {})) {
    if (!frame.parentName) continue;
    suitParents[type] = frame.parentName;
    const list = suitAbilities.get(frame.parentName) ?? [];
    for (const ability of frame.abilities ?? []) {
      if (!ability.uniqueName || list.some((a) => a.type === ability.uniqueName)) continue;
      list.push({ type: ability.uniqueName, name: english[ability.name ?? ""] ?? "" });
    }
    suitAbilities.set(frame.parentName, list);
  }
  const augmentOf = (type: string, entry: PepEntry, stats: string) => {
    const suit = entry.compat;
    if (!suit || !AUGMENT_COMPAT_RE.test(suit)) return {};
    const ability = levelCapAugmentAbility(type, stats, suitAbilities.get(suit) ?? []);
    return { augment: { suit, ability } };
  };

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
      modEntries.map(({ type, name, compat, entry }) => ({
        type,
        name,
        compat,
        maxRank: entry.fusionLimit ?? 0,
        rarity: entry.rarity ?? "COMMON",
        family: levelCapModFamily(name, compat, knownMods),
        stats: statText.get(type) ?? "",
        ...augmentOf(type, entry, statText.get(type) ?? ""),
      })),
    ),
    arcanes: byName(
      Object.entries(pep.ExportArcanes ?? {}).flatMap(([type, entry]) => {
        const name = nameOf(entry);
        if (!name || OPERATOR_ARCANE_RE.test(type)) return [];
        return [
          {
            type,
            name,
            maxRank: entry.fusionLimit ?? 5,
            rarity: entry.rarity ?? "RARE",
            stats: statText.get(type) ?? "",
          },
        ];
      }),
    ),
    abilities: byName(helminth),
    suitParents,
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
      suitParents: {},
    };
  }
  return _catalog;
}
