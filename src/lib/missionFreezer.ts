import { get } from "svelte/store";

import { missionRelicPool } from "../stores/missionRelicPool.js";
import { priceCacheRevision } from "../stores/pricing.js";
import { relicDb } from "../stores/relics.js";
import { invoke, on } from "./ipc.js";
import { log } from "./log.js";
import { buildRewardRows, freezeRows, readyToFreeze } from "./missionRewardRows.js";
import { missionRowSources } from "./missionSources.js";
import { startupPriceCacheReady } from "./startupLoader.js";

const RUN_DEBOUNCE_MS = 2_000;
const RECHECK_MS = 5 * 60_000;

let running = false;

async function freezePending(): Promise<void> {
  if (running || !get(startupPriceCacheReady)) return;
  const sources = missionRowSources();
  if (Object.keys(sources.db).length === 0 || Object.keys(sources.lookup).length === 0) return;
  if (!sources.relics) return;
  running = true;
  try {
    const now = Date.now();
    const goldAtLeast = get(missionRelicPool).goldAtLeast;
    const pending = await invoke("getPendingMissionValuations");
    const entries = pending
      .map((summary) => ({ summary, rows: buildRewardRows(summary.items, sources) }))
      .filter(({ summary, rows }) => readyToFreeze(summary, rows, now))
      .map(({ summary, rows }) => ({
        id: summary.id,
        valuation: freezeRows(rows, goldAtLeast, now),
      }));
    if (entries.length > 0) await invoke("freezeMissionValuations", entries);
  } catch (err) {
    log.warn("Freezing mission estimates failed", err);
  } finally {
    running = false;
  }
}

/** Freezes the estimate of every mission the moment its rewards can be priced, so a
 *  mission keeps what it was worth then. Returns the stop function. */
export function startMissionFreezer(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void freezePending();
    }, RUN_DEBOUNCE_MS);
  };
  const stops = [
    startupPriceCacheReady.subscribe(schedule),
    priceCacheRevision.subscribe(schedule),
    relicDb.subscribe(schedule),
    on("mission-rewards-updated", schedule),
  ];
  const interval = setInterval(schedule, RECHECK_MS);
  return () => {
    if (timer) clearTimeout(timer);
    clearInterval(interval);
    for (const stop of stops) stop();
  };
}
