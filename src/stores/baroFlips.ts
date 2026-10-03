import { derived, get, writable, type Writable } from "svelte/store";

import type { MarketStatPoint } from "../../config/shared/marketStats.js";
import { normalizeWfmSlug } from "../../config/shared/wfm.js";
import { activeWindow } from "../lib/format.js";
import { getLookupByName } from "../lib/inventoryMarket.js";
import { readStorage, writeStorage } from "../lib/persistence.js";
import { fetchBackendPriceHistory } from "../lib/wfm/priceHistory.js";
import { analyzeBaroFlip, planBaroFlips, type BaroFlipInput } from "../lib/world/baroFlip.js";
import { currencyBalance } from "../lib/world/baroPlanner.js";
import type { RawInventoryData } from "../types/inventory.js";
import { inventoryData, wfmItems } from "./data.js";
import { worldData } from "./world.js";

const HOURS_KEY = "baro-flip-hours";
const DEFAULT_HOURS = 9;
const MAX_HOURS = 168;
const CONCURRENCY = 4;

function clampHours(value: number): number {
  return Number.isFinite(value)
    ? Math.min(MAX_HOURS, Math.max(1, Math.round(value)))
    : DEFAULT_HOURS;
}

function hoursStore(): Writable<number> {
  const raw = readStorage(HOURS_KEY);
  const store = writable(raw == null ? DEFAULT_HOURS : clampHours(Number(raw)));
  const set = (value: number) => {
    const next = clampHours(value);
    writeStorage(HOURS_KEY, String(next));
    store.set(next);
  };
  return { subscribe: store.subscribe, set, update: (fn) => set(fn(get(store))) };
}

/** Hours a week the user is online to sell; sizes every buy suggestion. */
export const baroFlipHours = hoursStore();

/** Archive rows per slug for this session; null when the backend had nothing. */
const histories = writable<Record<string, readonly MarketStatPoint[] | null>>({});
export const baroFlipLoading = writable(false);
const requested = new Set<string>();

function unrankedCount(inventory: RawInventoryData | null, uniqueName: string): number {
  const rows = inventory?.RawUpgrades;
  if (!Array.isArray(rows)) return 0;
  const row = rows.find((entry) => entry?.ItemType === uniqueName);
  const count = Number(row?.ItemCount);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/** Baro's primed mods this visit, with their warframe.market slugs. */
export const baroPrimedMods = derived([worldData, wfmItems], ([world, lookup]) => {
  const visit = world?.voidTrader;
  if (!visit || !activeWindow(visit.activation, visit.expiry, Date.now())) return [];
  const seen = new Set<string>();
  return (visit.inventory ?? []).flatMap((offer) => {
    const name = typeof offer?.item === "string" ? offer.item.trim() : "";
    if (!offer?.uniqueName || !name.startsWith("Primed ") || seen.has(offer.uniqueName)) return [];
    seen.add(offer.uniqueName);
    return [
      {
        uniqueName: offer.uniqueName,
        name,
        // Before the item catalogue loads, primed mod names fold to their slugs.
        slug: getLookupByName(name, lookup)?.url_name ?? normalizeWfmSlug(name),
        ducats: typeof offer.ducats === "number" ? offer.ducats : null,
        credits: typeof offer.credits === "number" ? offer.credits : null,
      },
    ];
  });
});

/** Fetches the archive once per slug per session, a few at a time. */
export async function loadBaroFlipHistory(slugs: readonly (string | null)[]): Promise<void> {
  const queue = [...new Set(slugs)].filter(
    (slug): slug is string => !!slug && !requested.has(slug),
  );
  if (!queue.length) return;
  for (const slug of queue) requested.add(slug);
  baroFlipLoading.set(true);
  try {
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let slug = queue.shift(); slug; slug = queue.shift()) {
          const points = await fetchBackendPriceHistory(slug);
          // A failed fetch can be retried on the next visit to the tab.
          if (!points) requested.delete(slug);
          histories.update((all) => ({ ...all, [slug]: points }));
        }
      }),
    );
  } finally {
    baroFlipLoading.set(false);
  }
}

export const baroFlipPlan = derived(
  [baroPrimedMods, histories, inventoryData, baroFlipHours],
  ([mods, loaded, inventory, hours]) => {
    const now = Date.now();
    const inputs: BaroFlipInput[] = mods.map((mod) => {
      const points = mod.slug ? loaded[mod.slug] : null;
      return {
        ...mod,
        owned: unrankedCount(inventory, mod.uniqueName),
        analysis:
          points === undefined
            ? null
            : points === null
              ? { kind: "skip", reason: "history" }
              : analyzeBaroFlip(points, now),
      };
    });
    const balance = currencyBalance(inventory, "ducats");
    return { ...planBaroFlips(inputs, balance, hours), balance };
  },
);
