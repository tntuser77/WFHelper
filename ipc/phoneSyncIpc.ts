import fs from "node:fs";

import { assertMainRendererSender, handleAuthorized } from "./ipcSecurity";
import ctx from "./context";
import { addInventoryListener } from "./inventoryIpc";
import {
  getCacheFileMtimeMs,
  loadPersistedCacheMaps,
  parseOwnedRelicCounts,
} from "./overlay/relicSelection";
import * as itemDb from "../services/itemDatabase";
import * as levelCapStore from "../services/levelCapStore";
import { levelCapCatalog } from "../services/levelCapCatalog";
import * as phoneSync from "../services/phoneSync";
import * as relicService from "../services/relicService";
import { userDataPath } from "../services/userDataPath";
import { getCachedPriceBySlug } from "../services/wfmStatsPrice";
import {
  PHONE_SYNC_CLEAR,
  PHONE_SYNC_GET,
  PHONE_SYNC_NOW,
  PHONE_SYNC_PAIR,
  PHONE_SYNC_SET_CONFIG,
  PHONE_SYNC_UNPAIR,
} from "../config/shared/ipcChannels";
import { normalizeDucats } from "../config/shared/numeric";
import {
  buildLevelCapSnapshot,
  buildRelicSnapshot,
  type PhoneSnapshot,
  type PhoneSnapshotKind,
} from "../config/shared/phoneSnapshot";
import { relicGoldReward } from "../config/shared/relicPlannerView";
import { normalizeWfmSlugKey } from "../config/shared/wfm";

// The renderer's market price cache, which main already reads for the overlay.
const PRICE_CACHE_FILE = userDataPath("snapshot-cache.json");

let catalogNames: Map<string, string> | null = null;

function nameOf(type: string): string | null {
  if (!catalogNames) {
    const catalog = levelCapCatalog();
    catalogNames = new Map();
    for (const list of [
      catalog.suits,
      catalog.primary,
      catalog.secondary,
      catalog.melee,
      catalog.archgun,
      catalog.companion,
      catalog.mods,
      catalog.arcanes,
      catalog.abilities,
    ]) {
      for (const entry of list) catalogNames.set(entry.type, entry.name);
    }
  }
  return catalogNames.get(type) ?? itemDb.lookupItem(type)?.name ?? null;
}

function relicSnapshot(): PhoneSnapshot | null {
  const db = relicService.getRelicDatabase();
  if (!Object.keys(db.groups).length) return null;
  const { prices, ducats } = loadPersistedCacheMaps(fs, PRICE_CACHE_FILE);
  const slugOf = (urlName: string | null | undefined) => normalizeWfmSlugKey(urlName);
  const mtime = getCacheFileMtimeMs(fs, PRICE_CACHE_FILE);
  return buildRelicSnapshot({
    groups: db.groups,
    owned: parseOwnedRelicCounts(ctx.currentInventoryData, db.byUniqueName),
    price: (urlName) => {
      const slug = slugOf(urlName);
      if (!slug) return null;
      return prices.get(slug) ?? getCachedPriceBySlug(slug);
    },
    ducats: (reward) => {
      const own = normalizeDucats(reward.ducats);
      if (own != null && own > 0) return own;
      const slug = slugOf(reward.urlName);
      return slug ? (ducats.get(slug) ?? null) : null;
    },
    goldReward: relicGoldReward,
    pricesAt: mtime || null,
    now: Date.now(),
  });
}

function levelCapSnapshot(): PhoneSnapshot {
  return buildLevelCapSnapshot({
    runs: levelCapStore.getRuns(),
    builds: levelCapStore.getBuilds(),
    frameNotes: levelCapStore.getFrameNotes(),
    nameOf,
    now: Date.now(),
  });
}

function buildSnapshot(kind: PhoneSnapshotKind): PhoneSnapshot | null {
  return kind === "relics" ? relicSnapshot() : levelCapSnapshot();
}

let refreshLevelCap: (() => void) | null = null;

/** levelCapIpc hands over its broadcast so notes from the phone show in the open window. */
export function setLevelCapRefresh(refresh: () => void): void {
  refreshLevelCap = refresh;
}

function applyNotes(notes: Record<string, string>): void {
  for (const [frame, note] of Object.entries(notes)) {
    if (frame.trim() && frame.length <= 120) levelCapStore.setFrameNotes(frame, note);
  }
  refreshLevelCap?.();
}

/** Level cap changes land here from levelCapIpc so the phone hears of them soon. */
export function levelCapChanged(): void {
  phoneSync.markDirty("levelcap");
}

function register(): void {
  handleAuthorized(PHONE_SYNC_GET, assertMainRendererSender, () => phoneSync.getState());

  handleAuthorized(
    PHONE_SYNC_SET_CONFIG,
    assertMainRendererSender,
    async (_event, url: unknown, key: unknown) => {
      if (typeof url !== "string" || typeof key !== "string") {
        return { ok: false as const, error: "invalid-url" };
      }
      return phoneSync.setConfig(url, key);
    },
  );

  handleAuthorized(PHONE_SYNC_CLEAR, assertMainRendererSender, () => phoneSync.clearConfig());
  handleAuthorized(PHONE_SYNC_PAIR, assertMainRendererSender, () => phoneSync.pair());
  handleAuthorized(PHONE_SYNC_UNPAIR, assertMainRendererSender, () => phoneSync.unpair());
  handleAuthorized(PHONE_SYNC_NOW, assertMainRendererSender, () => phoneSync.syncNow());

  addInventoryListener(() => phoneSync.markDirty("relics"));
  phoneSync.start({ buildSnapshot, applyNotes });
}

export { register };
