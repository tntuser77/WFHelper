import { componentUniqueNameAliases } from "../../config/shared/componentNames.js";
import { asRecord } from "../../config/shared/objectValidation.js";
import { relicGoldReward } from "../../config/shared/relicPlannerView.js";
import { partsConsumedBy } from "./inventory/partConsumers.js";
import type { ItemDbEntry } from "../types/inventory.js";
import type { RelicDatabase, RelicGroup, RelicReward } from "../types/relics.js";

/** The relics worth running: a standing gold-price rule, with hand-picked relics on top. */
export interface RelicPoolSettings {
  /** Relics whose gold part sells for this or more are in the pool; null turns the rule off. */
  goldAtLeast: number | null;
  /** Relic group keys in the pool although the rule leaves them out. */
  added: string[];
  /** Relic group keys out of the pool although the rule takes them. */
  removed: string[];
}

const RELIC_POOL_GOLD_AT_LEAST = 37;
const RELIC_POOL_GOLD_MAX = 100_000;
const MAX_POOL_OVERRIDES = 5_000;

export function defaultRelicPool(): RelicPoolSettings {
  return { goldAtLeast: RELIC_POOL_GOLD_AT_LEAST, added: [], removed: [] };
}

function keyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter((key): key is string => typeof key === "string" && key.length > 0);
  return [...new Set(keys)].slice(0, MAX_POOL_OVERRIDES);
}

export function normalizeRelicPool(parsed: unknown): RelicPoolSettings {
  const record = asRecord(parsed);
  if (!record) return defaultRelicPool();
  const gold = record.goldAtLeast;
  const removed = keyList(record.removed);
  return {
    goldAtLeast:
      typeof gold === "number" && Number.isFinite(gold) && gold >= 0 && gold <= RELIC_POOL_GOLD_MAX
        ? gold
        : gold === null
          ? null
          : RELIC_POOL_GOLD_AT_LEAST,
    added: keyList(record.added).filter((key) => !removed.includes(key)),
    removed,
  };
}

function takenByRule(gold: number | null, settings: RelicPoolSettings): boolean {
  return gold !== null && settings.goldAtLeast !== null && gold >= settings.goldAtLeast;
}

export function inRelicPool(
  key: string,
  gold: number | null,
  settings: RelicPoolSettings,
): boolean {
  if (settings.removed.includes(key)) return false;
  return settings.added.includes(key) || takenByRule(gold, settings);
}

interface PoolTarget {
  key: string;
  gold: number | null;
}

/** Puts the relics in or out of the pool. A choice the rule already makes is not stored,
 *  so that relic goes on following the rule. */
export function setRelicsInPool(
  settings: RelicPoolSettings,
  relics: readonly PoolTarget[],
  inPool: boolean,
): RelicPoolSettings {
  const added = new Set(settings.added);
  const removed = new Set(settings.removed);
  for (const relic of relics) {
    added.delete(relic.key);
    removed.delete(relic.key);
    if (takenByRule(relic.gold, settings) === inPool) continue;
    (inPool ? added : removed).add(relic.key);
  }
  return { ...settings, added: [...added], removed: [...removed] };
}

export interface RelicPoolRow {
  key: string;
  name: string;
  vaulted: boolean;
  goldName: string | null;
  /** The gold part's price; null while none is cached. */
  gold: number | null;
  resurgence: boolean;
  inPool: boolean;
}

function rewardsOf(group: RelicGroup): RelicReward[] {
  return Object.values(group.qualities).find((quality) => quality?.rewards.length)?.rewards ?? [];
}

export function buildRelicPoolRows(
  relics: RelicDatabase | null,
  settings: RelicPoolSettings,
  goldOf: (slug: string) => number | null,
  resurgence: ReadonlySet<string>,
): RelicPoolRow[] {
  if (!relics) return [];
  return Object.values(relics.groups)
    .map((group) => {
      const goldReward = relicGoldReward(rewardsOf(group));
      const slug = goldReward?.urlName?.trim().toLowerCase() ?? "";
      const gold = slug ? goldOf(slug) : null;
      return {
        key: group.key,
        name: group.name,
        vaulted: group.vaulted === true,
        goldName: goldReward ? goldReward.displayName || goldReward.name : null,
        gold,
        resurgence: resurgence.has(group.key),
        inPool: inRelicPool(group.key, gold, settings),
      };
    })
    .sort((a, b) => (b.gold ?? -1) - (a.gold ?? -1) || a.name.localeCompare(b.name));
}

interface RelicPoolFilter {
  search: string;
  goldAtLeast: number | null;
  resurgenceOnly: boolean;
}

/** The search reads the relic's name and its gold part's. */
export function filterRelicPoolRows(
  rows: readonly RelicPoolRow[],
  filter: RelicPoolFilter,
): RelicPoolRow[] {
  const needle = filter.search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filter.resurgenceOnly && !row.resurgence) return false;
    if (filter.goldAtLeast !== null && (row.gold === null || row.gold < filter.goldAtLeast)) {
      return false;
    }
    if (!needle) return true;
    return (
      row.name.toLocaleLowerCase().includes(needle) ||
      (row.goldName?.toLocaleLowerCase().includes(needle) ?? false)
    );
  });
}

/** Relics of the running Prime Resurgence: the ones Varzia sells, and every relic that
 *  drops a part of a frame or weapon she sells. */
export function resurgenceRelicKeys(
  relics: RelicDatabase | null,
  offers: readonly string[],
  db: Record<string, ItemDbEntry>,
): Set<string> {
  const keys = new Set<string>();
  if (!relics) return keys;
  const parts = new Set<string>();
  for (const offer of offers) {
    const sold = relics.byUniqueName[offer];
    if (sold) keys.add(sold.groupKey);
    for (const part of partsConsumedBy(offer, db[offer])) {
      for (const alias of componentUniqueNameAliases(part.uniqueName ?? "")) parts.add(alias);
    }
  }
  if (parts.size === 0) return keys;
  for (const group of Object.values(relics.groups)) {
    const drops = rewardsOf(group).some((reward) =>
      componentUniqueNameAliases(reward.uniqueName ?? "").some((alias) => parts.has(alias)),
    );
    if (drops) keys.add(group.key);
  }
  return keys;
}

/** What the valuation reads of the pool: the parts its relics drop, and the parts held. */
export interface MissionPool {
  /** Every alias of every part a pool relic drops, all counted as farmable. */
  farmable: ReadonlySet<string>;
  /** Copies held per part uniqueName. */
  owned: ReadonlyMap<string, number>;
}

export function buildMissionPool(
  relics: RelicDatabase | null,
  settings: RelicPoolSettings,
  goldOf: (slug: string) => number | null,
  owned: ReadonlyMap<string, number>,
): MissionPool {
  const farmable = new Set<string>();
  const rows = new Map(
    buildRelicPoolRows(relics, settings, goldOf, new Set()).map((row) => [row.key, row]),
  );
  for (const group of Object.values(relics?.groups ?? {})) {
    if (!rows.get(group.key)?.inPool) continue;
    for (const reward of rewardsOf(group)) {
      for (const alias of componentUniqueNameAliases(reward.uniqueName ?? "")) farmable.add(alias);
    }
  }
  return { farmable, owned };
}
