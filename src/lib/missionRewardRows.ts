import {
  componentUniqueNameAliases,
  ownedComponentCount,
} from "../../config/shared/componentNames.js";
import { fallbackNameFromUniqueName } from "../../config/shared/displayName.js";
import type {
  MissionRewardsFailure,
  MissionRewardsStatus,
} from "../../config/shared/missionRewardsTypes.js";
import { MISSION_TYPE_LABELS } from "../../config/shared/missionTypes.js";
import { sanitizeWfmSlug, titleCase } from "../../config/shared/textNormalize.js";
import { rendererPriceCacheKey } from "../../config/shared/wfmCacheKeys.js";
import { accessDeniedKeys } from "./accessDenied.js";
import type { MessageKey, Translator } from "./i18n.js";
import { partConsumerIndex } from "./inventory/partConsumers.js";
import { reservableParts } from "./inventory/safetyRules.js";
import { getLookupByGameRef, getLookupByName } from "./inventoryMarket.js";
import type { MissionPool } from "./missionRelicPool.js";
import { relicGroupForUniqueName } from "./relic.js";
import type { ItemDbEntry } from "../types/inventory.js";
import type { MissionRewardItem, MissionRewardSummaryView, WfmItemsLookup } from "../types/ipc.js";
import type { FrozenItem, MissionValuation } from "../../config/shared/missionValuation.js";
import type { RelicDatabase } from "../types/relics.js";

export interface RewardRow {
  uniqueName: string;
  name: string;
  imageUrl: string | null;
  count: number;
  vaulted: boolean;
  /** Market slug it was priced under, for matching a sale back to it. */
  slug: string | null;
  platinum: number | null;
  /** How the platinum is reached: sold as it is, or held until a set or a maxed arcane. */
  sale: RewardSale | null;
  ducats: number | null;
  unpriced: boolean;
  openable: boolean;
  /** The platinum and sale above were frozen with the mission, not read from today's prices. */
  frozen: boolean;
}

type RewardSale = "now" | "held";

interface RewardRowTotals {
  sellNow: number;
  held: number;
  ducats: number;
  unpriced: number;
}

export interface RewardRowSources {
  db: Record<string, ItemDbEntry>;
  lookup: WfmItemsLookup;
  relics: RelicDatabase | null;
  /** Median for a renderer price cache key, from the price snapshot store. */
  priceOf: (cacheKey: string) => number | null;
  /** The relics being farmed and the parts held. Without it, any set a part builds can be
   *  completed. */
  pool?: MissionPool;
}

/** The cheapest sale worth a trade: a reward counts as platinum only when it, or the
 *  set it builds, sells for this or more. */
const MIN_TRADE_PLATINUM = 25;

const ARCANE_PATH = /\/CosmeticEnhancers\//;

interface MarketListing {
  slug: string;
  maxRank: number;
}

interface UnitValue {
  /** Platinum one copy adds; null when no sale of it reaches the trade floor. */
  platinum: number | null;
  sale: RewardSale | null;
  /** Copies that count at that value; the rest find no set to go into. Null is no limit. */
  cap: number | null;
  /** No price is cached for the sale this reward would go through. */
  unpriced: boolean;
}

function marketListing(
  uniqueName: string,
  name: string,
  lookup: WfmItemsLookup,
): MarketListing | null {
  const entry = getLookupByGameRef(uniqueName, lookup) ?? getLookupByName(name, lookup);
  const slug = entry ? sanitizeWfmSlug(entry.url_name) : null;
  return entry && slug ? { slug, maxRank: Math.max(0, entry.maxRank ?? 0) } : null;
}

// Rewards arrive unranked, so a rank-0 price wins over the bare slug. A ranked item's
// bare slug tracks whichever rank sold last, mostly maxed copies, so it never prices one.
function cachedPlatinum(
  listing: MarketListing,
  priceOf: RewardRowSources["priceOf"],
): number | null {
  const rankZero = priceOf(rendererPriceCacheKey(listing.slug, 0));
  if (rankZero !== null || listing.maxRank > 0) return rankZero;
  return priceOf(rendererPriceCacheKey(listing.slug, null));
}

const NO_SALE = { platinum: null, sale: null, cap: null } as const;

/** An arcane sells maxed, whatever that fetches: each copy is its share of the copies
 *  one maxed arcane takes. */
function arcaneValue(listing: MarketListing, priceOf: RewardRowSources["priceOf"]): UnitValue {
  const maxed = priceOf(rendererPriceCacheKey(listing.slug, listing.maxRank));
  if (maxed === null) return { ...NO_SALE, unpriced: true };
  const copies = ((listing.maxRank + 1) * (listing.maxRank + 2)) / 2;
  return { platinum: maxed / copies, sale: "held", cap: null, unpriced: false };
}

interface SetShare {
  each: number;
  /** Copies of the part the sets it can still complete take; null when it is not limited. */
  cap: number | null;
}

/** Sets this build can still complete: a part the pool farms is unlimited, any other is
 *  held only as often as it is owned, counting what this mission brought. */
function completableSets(
  parts: readonly { uniqueName?: string; itemCount?: number }[],
  pool: MissionPool,
  received: ReadonlyMap<string, number>,
): number {
  let sets = Infinity;
  for (const part of parts) {
    const uniqueName = part.uniqueName ?? "";
    if (componentUniqueNameAliases(uniqueName).some((alias) => pool.farmable.has(alias))) continue;
    const perBuild = part.itemCount && part.itemCount > 0 ? part.itemCount : 1;
    const held = Math.max(
      ownedComponentCount(uniqueName, pool.owned),
      ownedComponentCount(uniqueName, received),
    );
    sets = Math.min(sets, Math.floor(held / perBuild));
  }
  return sets;
}

/** A part's even share of the best-priced set it builds, when that set is worth a trade
 *  and the pool can complete it. */
function setShare(
  uniqueName: string,
  sources: RewardRowSources,
  received: ReadonlyMap<string, number>,
): SetShare | null {
  const consumers = new Map<string, number>();
  const index = partConsumerIndex(sources.db);
  for (const alias of componentUniqueNameAliases(uniqueName)) {
    for (const link of index.get(alias) ?? []) consumers.set(link.parent, link.perBuild);
  }
  let best: SetShare | null = null;
  for (const [parent, perBuild] of consumers) {
    const setName = sources.db[parent]?.name;
    const set = setName ? getLookupByName(`${setName} Set`, sources.lookup) : null;
    const slug = set ? sanitizeWfmSlug(set.url_name) : null;
    const price = slug ? sources.priceOf(rendererPriceCacheKey(slug, null)) : null;
    if (price === null || price < MIN_TRADE_PLATINUM) continue;
    const parts = reservableParts(sources.db, parent);
    const partCount = parts.reduce(
      (sum, part) => sum + (part.itemCount && part.itemCount > 0 ? part.itemCount : 1),
      0,
    );
    if (partCount <= 0) continue;
    const sets = sources.pool ? completableSets(parts, sources.pool, received) : Infinity;
    if (sets <= 0) continue;
    const each = price / partCount;
    if (best && best.each >= each) continue;
    best = { each, cap: Number.isFinite(sets) ? sets * perBuild : null };
  }
  return best;
}

function unitValue(
  uniqueName: string,
  listing: MarketListing,
  sources: RewardRowSources,
  received: ReadonlyMap<string, number>,
): UnitValue {
  if (listing.maxRank > 0 && ARCANE_PATH.test(uniqueName)) {
    return arcaneValue(listing, sources.priceOf);
  }
  const own = cachedPlatinum(listing, sources.priceOf);
  if (own !== null && own >= MIN_TRADE_PLATINUM) {
    return { platinum: own, sale: "now", cap: null, unpriced: false };
  }
  const share = setShare(uniqueName, sources, received);
  if (share !== null) {
    return { platinum: share.each, sale: "held", cap: share.cap, unpriced: false };
  }
  return { ...NO_SALE, unpriced: own === null };
}

function buildRow(
  item: MissionRewardItem,
  sources: RewardRowSources,
  received: ReadonlyMap<string, number>,
): RewardRow {
  const entry: ItemDbEntry | undefined = sources.db[item.uniqueName];
  const englishName = entry?.name || fallbackNameFromUniqueName(item.uniqueName);
  const listing =
    entry?.tradable === true ? marketListing(item.uniqueName, englishName, sources.lookup) : null;
  const value = listing ? unitValue(item.uniqueName, listing, sources, received) : null;
  const each = value?.platinum ?? null;
  const ducats = typeof entry?.ducats === "number" && entry.ducats > 0 ? entry.ducats : null;
  return {
    uniqueName: item.uniqueName,
    name: entry?.displayName || englishName,
    imageUrl: entry?.imageUrl ?? null,
    count: item.count,
    vaulted: entry?.vaulted === true,
    slug: listing?.slug ?? null,
    platinum:
      each === null ? null : Math.round(each * Math.min(item.count, value?.cap ?? Infinity)),
    sale: value?.sale ?? null,
    ducats: ducats === null ? null : ducats * item.count,
    unpriced: entry?.tradable === true && (value === null || value.unpriced),
    openable: Boolean(entry) || relicGroupForUniqueName(sources.relics, item.uniqueName) !== null,
    frozen: false,
  };
}

/** What sells now first, then what is held; within each the most platinum, then ducats, then name. */
export function buildRewardRows(
  items: readonly MissionRewardItem[],
  sources: RewardRowSources,
): RewardRow[] {
  const received = new Map(items.map((item) => [item.uniqueName, item.count]));
  return items
    .map((item) => buildRow(item, sources, received))
    .sort(
      (a, b) =>
        saleOrder(a.sale) - saleOrder(b.sale) ||
        (b.platinum ?? -1) - (a.platinum ?? -1) ||
        (b.ducats ?? -1) - (a.ducats ?? -1) ||
        a.name.localeCompare(b.name),
    );
}

function saleOrder(sale: RewardSale | null): number {
  return sale === "now" ? 0 : sale === "held" ? 1 : 2;
}

/** Puts a mission's frozen estimate on its rows. A mission with no frozen estimate keeps
 *  the live prices the rows were built with. */
export function applyMissionValuation(
  rows: readonly RewardRow[],
  mission: Pick<MissionRewardSummaryView, "valuation">,
): RewardRow[] {
  const valuation = mission.valuation;
  if (!valuation) return [...rows];
  const frozen = new Map(valuation.items.map((item) => [item.uniqueName, item]));
  const out = rows.map((row) => {
    const item = frozen.get(row.uniqueName);
    if (!item) return row;
    return {
      ...row,
      platinum: item.sale === null && item.platinum === 0 ? null : item.platinum,
      sale: item.sale,
      unpriced: false,
      frozen: true,
    };
  });
  return out.sort(
    (a, b) =>
      saleOrder(a.sale) - saleOrder(b.sale) ||
      (b.platinum ?? -1) - (a.platinum ?? -1) ||
      (b.ducats ?? -1) - (a.ducats ?? -1) ||
      a.name.localeCompare(b.name),
  );
}

/** A mission whose rewards still have no price is left unfrozen this long after its read,
 *  so a price that is still on its way is not frozen in as nothing. */
const UNPRICED_GRACE_MS = 30 * 60_000;

/** What a mission's rows are worth now, as the estimate it keeps from here on. */
export function freezeRows(
  rows: readonly RewardRow[],
  goldAtLeast: number | null,
  at: number,
): MissionValuation {
  const items: FrozenItem[] = rows
    .filter((row) => row.slug !== null || row.sale !== null)
    .map((row) => ({
      uniqueName: row.uniqueName,
      platinum: row.platinum ?? 0,
      sale: row.sale,
    }));
  return { at, goldAtLeast, items };
}

/** Whether the mission's rewards are priced enough to freeze what they are worth. */
export function readyToFreeze(
  summary: Pick<MissionRewardSummaryView, "readAt">,
  rows: readonly RewardRow[],
  now: number,
): boolean {
  return rows.every((row) => !row.unpriced) || now - summary.readAt > UNPRICED_GRACE_MS;
}

export function rewardRowTotals(rows: readonly RewardRow[]): RewardRowTotals {
  let sellNow = 0;
  let held = 0;
  let ducats = 0;
  let unpriced = 0;
  for (const row of rows) {
    if (row.sale === "now") sellNow += row.platinum ?? 0;
    else if (row.sale === "held") held += row.platinum ?? 0;
    ducats += row.ducats ?? 0;
    if (row.unpriced) unpriced += 1;
  }
  return { sellNow, held, ducats, unpriced };
}

export function missionTypeLabel(missionType: string | undefined): string | null {
  if (!missionType) return null;
  return MISSION_TYPE_LABELS[missionType] ?? titleCase(missionType.slice(3).replace(/_/g, " "));
}

export function missionName(summary: MissionRewardSummaryView, unknown: string): string {
  return summary.nodeLabel ?? missionTypeLabel(summary.missionType) ?? unknown;
}

const FAILURE_DETAIL_KEYS: Partial<Record<MissionRewardsFailure, MessageKey>> = {
  "game-not-running": "titlebar.tooltip.gameNotRunning",
  "no-fresh-copy": "dashboard.lastMission.noFreshCopy",
};

/** Tracking off, then a read in progress, then the last failed read. */
export function missionStatusKey(status: MissionRewardsStatus | null): MessageKey | null {
  if (!status) return null;
  if (status.blocked === "tracking-off") return "dashboard.lastMission.trackingOff";
  if (status.phase !== "idle") return "dashboard.lastMission.reading";
  if (status.lastFailure) return "dashboard.lastMission.readFailed";
  return null;
}

/** The status line, with the cause of a failed read when it has a sentence. */
export function missionStatusText(
  status: MissionRewardsStatus | null,
  t: Translator,
  platform: string,
): string | null {
  const key = missionStatusKey(status);
  if (!key) return null;
  const failure = key === "dashboard.lastMission.readFailed" ? status?.lastFailure : undefined;
  const detail =
    failure === "access-denied"
      ? accessDeniedKeys(platform).detail
      : failure
        ? FAILURE_DETAIL_KEYS[failure]
        : undefined;
  return detail ? `${t(key)} ${t(detail)}` : t(key);
}

export const MISSION_PERIODS = ["today", "7d", "30d", "all"] as const;
export type MissionPeriod = (typeof MISSION_PERIODS)[number];

const DAY_MS = 86_400_000;

export function localMidnight(now: number): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime();
}

/** Earliest endedAt a period covers, in local time; null for all time. */
export function missionPeriodStart(period: MissionPeriod, now: number): number | null {
  if (period === "all") return null;
  if (period === "today") return localMidnight(now);
  return now - (period === "7d" ? 7 : 30) * DAY_MS;
}

export function endedAtLabel(endedAt: number, code: string): string {
  return new Date(endedAt).toLocaleString(code, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A later page after the loaded rows; a mission recorded since the last request shifts
 *  the offsets, so the page can repeat rows already loaded. */
export function appendPage<T extends { id: string }>(
  loaded: readonly T[],
  next: readonly T[],
): T[] {
  const ids = new Set(loaded.map((entry) => entry.id));
  return [...loaded, ...next.filter((entry) => !ids.has(entry.id))];
}

/** Lays a fresh first page over a longer loaded list, keeping every row already loaded;
 *  starts over only when the two no longer overlap. */
export function mergeFirstPage<T extends { id: string }>(
  loaded: readonly T[],
  first: readonly T[],
  matched: number,
): T[] {
  const firstIds = new Set(first.map((entry) => entry.id));
  const overlaps = first.length >= matched || loaded.some((entry) => firstIds.has(entry.id));
  if (!overlaps) return [...first];
  const merged = [...first, ...loaded.filter((entry) => !firstIds.has(entry.id))];
  return merged.slice(0, matched);
}

export type PageLoadMode = "replace" | "append" | "merge";

interface LoadedPage<T> {
  summaries: readonly T[];
  matched: number;
}

interface PageLoaderTarget<T, P> {
  rows: () => readonly T[];
  show: (rows: T[], page: P | null) => void;
  /** `rowsOutdated`: the rows shown were loaded under an earlier filter. */
  fail: (error: unknown, rowsOutdated: boolean) => void;
}

/** Orders a paged list's loads: a filter change drops every older answer, a first page drops
 *  those older than the one shown, and rows loaded under an earlier filter are replaced,
 *  never merged into or appended to. */
export function createPageLoader<T extends { id: string }, P extends LoadedPage<T>>(
  target: PageLoaderTarget<T, P>,
): (mode: PageLoadMode, load: () => Promise<P | null>) => Promise<void> {
  let filterSeq = 0;
  let firstSent = 0;
  let firstShown = 0;
  let rowsFilter = 0;
  return async (mode, load) => {
    if (mode === "replace") filterSeq += 1;
    const filters = filterSeq;
    const first = mode === "append" ? firstSent : ++firstSent;
    const base = rowsFilter;
    const stale = (): boolean =>
      filters !== filterSeq || (mode === "append" ? base !== filters : first <= firstShown);
    try {
      const next = await load();
      if (stale()) return;
      if (!next) throw new Error("mission page query rejected");
      let rows: T[];
      if (mode === "append") {
        rows = appendPage(target.rows(), next.summaries);
      } else {
        rows =
          mode === "merge" && rowsFilter === filters
            ? mergeFirstPage(target.rows(), next.summaries, next.matched)
            : [...next.summaries];
        firstShown = first;
        rowsFilter = filters;
      }
      target.show(rows, first >= firstShown ? next : null);
    } catch (error: unknown) {
      if (stale()) return;
      target.fail(error, rowsFilter !== filters);
    }
  };
}

/** Recorded item types whose shown or English name contains the search text. */
export function matchRewardItemTypes(
  itemTypes: readonly string[],
  search: string,
  db: Record<string, ItemDbEntry>,
): string[] {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return [];
  return itemTypes.filter((uniqueName) => {
    const entry: ItemDbEntry | undefined = db[uniqueName];
    const names = [
      entry?.displayName,
      entry?.name,
      entry ? undefined : fallbackNameFromUniqueName(uniqueName),
    ];
    return names.some((name) => name?.toLocaleLowerCase().includes(needle));
  });
}
