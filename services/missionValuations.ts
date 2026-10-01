import {
  MAX_VALUATION_ITEMS,
  type FrozenItem,
  type MissionValuation,
  type ValuationSale,
} from "../config/shared/missionValuation";
import { asRecord } from "../config/shared/objectValidation";
import { createJsonCache } from "./jsonCache";
import { withScope } from "./logger";

const log = withScope("missionValuations");

const VALUATIONS_VERSION = 1;
const MAX_VALUATIONS = 10_000;
const MAX_TEXT_CHARS = 256;
const MAX_PLATINUM = 100_000_000;

interface StoredValuations {
  version: number;
  /** Mission id to its frozen estimate. */
  missions: Record<string, MissionValuation>;
}

function reviveItem(raw: unknown): FrozenItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const { uniqueName, platinum, sale } = record;
  if (typeof uniqueName !== "string" || !uniqueName || uniqueName.length > MAX_TEXT_CHARS) {
    return null;
  }
  if (typeof platinum !== "number" || !Number.isFinite(platinum)) return null;
  if (platinum < 0 || platinum > MAX_PLATINUM) return null;
  const sold: ValuationSale | null = sale === "now" || sale === "held" ? sale : null;
  return {
    uniqueName,
    platinum: Math.round(platinum),
    sale: sold,
  };
}

/** Null when the estimate is not usable; a bad line drops the whole estimate rather
 *  than freezing half of one. */
export function reviveValuation(raw: unknown): MissionValuation | null {
  const record = asRecord(raw);
  if (!record || !Array.isArray(record.items) || record.items.length > MAX_VALUATION_ITEMS) {
    return null;
  }
  const { at, goldAtLeast } = record;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
  const items: FrozenItem[] = [];
  for (const entry of record.items) {
    const item = reviveItem(entry);
    if (!item) return null;
    items.push(item);
  }
  return {
    at,
    goldAtLeast:
      typeof goldAtLeast === "number" && Number.isFinite(goldAtLeast) ? goldAtLeast : null,
    items,
  };
}

function reviveStored(parsed: unknown): StoredValuations | null {
  const record = asRecord(parsed);
  if (!record || !Number.isInteger(record.version)) return null;
  const version = record.version as number;
  if (version > VALUATIONS_VERSION) return { version, missions: {} };
  if (version !== VALUATIONS_VERSION) return null;
  const raw = asRecord(record.missions);
  if (!raw) return null;
  const missions: Record<string, MissionValuation> = {};
  for (const [id, entry] of Object.entries(raw).slice(-MAX_VALUATIONS)) {
    const valuation = reviveValuation(entry);
    if (valuation) missions[id] = valuation;
  }
  return { version: VALUATIONS_VERSION, missions };
}

const cache = createJsonCache<StoredValuations>("mission-valuations.json", reviveStored);

let valuations = new Map<string, MissionValuation>();
let writable = true;

function persist(): void {
  if (!writable) return;
  cache.write({ version: VALUATIONS_VERSION, missions: Object.fromEntries(valuations) });
}

/** A missing file starts empty and an invalid one is moved aside first; a newer or
 *  unreadable file is left alone and this session's estimates are not saved. */
export function loadValuations(): void {
  const loaded = cache.load();
  writable = true;
  valuations = new Map();
  if (loaded.status === "ok" && loaded.value.version === VALUATIONS_VERSION) {
    valuations = new Map(Object.entries(loaded.value.missions));
    return;
  }
  if (loaded.status === "ok") {
    writable = false;
    log.warn(`mission-valuations.json has version ${loaded.value.version}; estimates not saved`);
  } else if (loaded.status === "unreadable") {
    writable = false;
    log.warn(`mission-valuations.json could not be read (${loaded.error}); estimates not saved`);
  } else if (loaded.status === "invalid") {
    writable = cache.quarantine();
  }
}

export function unloadValuations(): void {
  valuations = new Map();
  writable = true;
}

export function getValuations(): ReadonlyMap<string, MissionValuation> {
  return valuations;
}

/** Freezes the estimates of missions that have none. A frozen estimate is never
 *  replaced, so later price moves cannot rewrite what a mission was worth then.
 *  Returns how many were frozen. */
export function freezeValuations(entries: unknown, knownIds: ReadonlySet<string>): number {
  if (!Array.isArray(entries)) return 0;
  let frozen = 0;
  for (const entry of entries.slice(0, MAX_VALUATIONS)) {
    const record = asRecord(entry);
    const id = record?.id;
    if (typeof id !== "string" || !knownIds.has(id) || valuations.has(id)) continue;
    const valuation = reviveValuation(record?.valuation);
    if (!valuation) continue;
    valuations.set(id, valuation);
    frozen += 1;
  }
  if (frozen > 0) persist();
  return frozen;
}
