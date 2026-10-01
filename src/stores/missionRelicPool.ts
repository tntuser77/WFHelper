import { writable } from "svelte/store";

import {
  defaultRelicPool,
  normalizeRelicPool,
  type RelicPoolSettings,
} from "../lib/missionRelicPool.js";
import { readStoredJson, writeStorage } from "../lib/persistence.js";

const STORAGE_KEY = "wf_missions_relic_pool";

const store = writable<RelicPoolSettings>(
  readStoredJson(STORAGE_KEY, normalizeRelicPool, defaultRelicPool),
);

export const missionRelicPool = { subscribe: store.subscribe };

export function updateMissionRelicPool(
  change: (settings: RelicPoolSettings) => RelicPoolSettings,
): void {
  store.update((current) => {
    const next = normalizeRelicPool(change(current));
    writeStorage(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
}
