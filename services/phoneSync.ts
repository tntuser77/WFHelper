import crypto from "node:crypto";

import { safeStorage } from "electron";
import QRCode from "qrcode";

import { createJsonCache } from "./jsonCache";
import { withScope } from "./logger";
import { validateWebhookUrl } from "./notificationChannels";
import { normalizeErrorMessage } from "../config/shared/errors";
import { withAbortTimeout } from "../config/shared/fetchWithTimeout";
import { readResponseText } from "../config/shared/readResponseText";
import type {
  PhonePairing,
  PhoneSnapshot,
  PhoneSnapshotKind,
  PhoneSyncResult,
  PhoneSyncState,
} from "../config/shared/phoneSnapshot";

// Sends relic and level cap snapshots to the mailbox Worker (WFHelper-mobile
// repo) for the phone app to read. The write key is a secret like the webhook
// URLs: kept with safeStorage, never handed to the renderer.

const log = withScope("phoneSync");

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const CHECK_INTERVAL_MS = 5 * 60_000;
const DIRTY_DELAY_MS = 30_000;
// Prices move all the time; the Worker's free tier allows 1,000 writes a day.
const MIN_INTERVAL_MS: Record<PhoneSnapshotKind, number> = {
  relics: 15 * 60_000,
  levelcap: 0,
};
const KINDS: PhoneSnapshotKind[] = ["relics", "levelcap"];
const ENCRYPTED_PREFIX = "enc:v1:";

interface StoredConfig {
  url: string;
  key: string;
  pairedAt: number | null;
}

interface PhoneSyncDeps {
  buildSnapshot: (kind: PhoneSnapshotKind) => PhoneSnapshot | null;
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function reviveConfig(parsed: unknown): StoredConfig | null {
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as Record<string, unknown>;
  let key = "";
  if (
    typeof raw.key === "string" &&
    raw.key.startsWith(ENCRYPTED_PREFIX) &&
    encryptionAvailable()
  ) {
    try {
      key = safeStorage.decryptString(
        Buffer.from(raw.key.slice(ENCRYPTED_PREFIX.length), "base64"),
      );
    } catch (err) {
      log.warn(`[PhoneSync] stored key unreadable: ${normalizeErrorMessage(err)}`);
    }
  }
  return {
    url: typeof raw.url === "string" ? raw.url : "",
    key,
    pairedAt: typeof raw.pairedAt === "number" ? raw.pairedAt : null,
  };
}

const cache = createJsonCache<StoredConfig>("phone-sync.json", reviveConfig);

let config: StoredConfig | null = null;
let deps: PhoneSyncDeps | null = null;
let timer: NodeJS.Timeout | null = null;
const dirtyTimers = new Map<PhoneSnapshotKind, NodeJS.Timeout>();
const lastSent: Record<PhoneSnapshotKind, number | null> = { relics: null, levelcap: null };
const lastHash: Partial<Record<PhoneSnapshotKind, string>> = {};
let lastError: string | null = null;
let syncing = false;

function load(): StoredConfig {
  if (!config) config = cache.read() ?? { url: "", key: "", pairedAt: null };
  return config;
}

// Without safeStorage the key is not written in the clear; it lasts this session.
function persist(): void {
  const current = load();
  let key = "";
  if (current.key && encryptionAvailable()) {
    try {
      key = `${ENCRYPTED_PREFIX}${safeStorage.encryptString(current.key).toString("base64")}`;
    } catch (err) {
      log.warn(`[PhoneSync] failed to encrypt the key: ${normalizeErrorMessage(err)}`);
    }
  }
  cache.write({ url: current.url, key, pairedAt: current.pairedAt });
}

export function getState(): PhoneSyncState {
  const current = load();
  return {
    url: current.url,
    keySet: !!current.key,
    keyPersisted: encryptionAvailable(),
    pairedAt: current.pairedAt,
    lastSent: { ...lastSent },
    lastError,
    syncing,
  };
}

function configured(): boolean {
  const current = load();
  return !!current.url && !!current.key;
}

async function request(
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; text: string }> {
  const current = load();
  const checked = await validateWebhookUrl(current.url);
  if (!checked.ok) throw new Error(`blocked url (${checked.error})`);
  const url = new URL(path, checked.url.endsWith("/") ? checked.url : `${checked.url}/`);
  return withAbortTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${current.key}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
      redirect: "manual",
      signal,
    });
    const text = await readResponseText(res, MAX_RESPONSE_BYTES, {
      truncate: true,
      allowPartial: true,
    });
    return { status: res.status, text };
  });
}

/** Saves the mailbox address and write key after checking the Worker answers. */
export async function setConfig(url: string, key: string): Promise<PhoneSyncResult> {
  const trimmedKey = key.trim();
  const current = load();
  const nextKey = trimmedKey || current.key;
  if (!nextKey) return { ok: false, error: "empty-key" };
  const checked = await validateWebhookUrl(url);
  if (!checked.ok) {
    return { ok: false, error: checked.error === "blocked-host" ? "blocked-url" : "invalid-url" };
  }
  const previous = { ...current };
  config = { ...current, url: checked.url.replace(/\/+$/, ""), key: nextKey };
  try {
    // The pair route needs the write key but changes nothing on a GET.
    const res = await request("GET", "v1/pair");
    if (res.status === 401) throw new Error("the Worker refused the key");
    if (res.status !== 405) throw new Error(`unexpected answer (${res.status})`);
  } catch (err) {
    config = previous;
    log.warn(`[PhoneSync] config check failed: ${normalizeErrorMessage(err)}`);
    return { ok: false, error: "unreachable" };
  }
  if (previous.url !== config.url) config.pairedAt = null;
  persist();
  lastHash.relics = undefined;
  lastHash.levelcap = undefined;
  scheduleAll();
  return { ok: true, value: getState() };
}

export function clearConfig(): PhoneSyncState {
  config = { url: "", key: "", pairedAt: null };
  persist();
  lastError = null;
  return getState();
}

/** A new phone key; any earlier phone stops reading. */
export async function pair(): Promise<PhoneSyncResult<PhonePairing>> {
  if (!configured()) return { ok: false, error: "not-configured" };
  try {
    const res = await request("POST", "v1/pair");
    if (res.status !== 200) return { ok: false, error: `pair failed (${res.status})` };
    const { key } = JSON.parse(res.text) as { key?: unknown };
    if (typeof key !== "string" || !key) return { ok: false, error: "pair failed" };
    const payload = JSON.stringify({ wfhelper: 1, url: load().url, key });
    const qr = await QRCode.toDataURL(payload, { margin: 1, width: 320 });
    load().pairedAt = Date.now();
    persist();
    return { ok: true, value: { qr, code: payload, state: getState() } };
  } catch (err) {
    return { ok: false, error: normalizeErrorMessage(err) };
  }
}

export async function unpair(): Promise<PhoneSyncResult> {
  if (!configured()) return { ok: false, error: "not-configured" };
  try {
    const res = await request("DELETE", "v1/pair");
    if (res.status !== 204) return { ok: false, error: `unpair failed (${res.status})` };
    load().pairedAt = null;
    persist();
    return { ok: true, value: getState() };
  } catch (err) {
    return { ok: false, error: normalizeErrorMessage(err) };
  }
}

/** Same content, same hash: the build time alone never forces an upload. */
function snapshotHash(snapshot: PhoneSnapshot): string {
  const { generatedAt: _ignored, ...content } = snapshot;
  return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

async function upload(kind: PhoneSnapshotKind, force: boolean): Promise<void> {
  if (!configured() || !deps) return;
  const sentAt = lastSent[kind];
  if (!force && sentAt && Date.now() - sentAt < MIN_INTERVAL_MS[kind]) return;
  const snapshot = deps.buildSnapshot(kind);
  if (!snapshot) return;
  const hash = snapshotHash(snapshot);
  if (!force && hash === lastHash[kind]) return;
  const res = await request("PUT", `v1/data/${kind}`, JSON.stringify(snapshot));
  if (res.status !== 200) throw new Error(`${kind} upload failed (${res.status})`);
  lastHash[kind] = hash;
  lastSent[kind] = Date.now();
}

async function run(kinds: PhoneSnapshotKind[], force: boolean): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    for (const kind of kinds) await upload(kind, force);
    lastError = null;
  } catch (err) {
    lastError = normalizeErrorMessage(err);
    log.warn(`[PhoneSync] ${lastError}`);
  } finally {
    syncing = false;
  }
}

/** Uploads both snapshots now, even when nothing changed. */
export async function syncNow(): Promise<PhoneSyncState> {
  await run(KINDS, true);
  return getState();
}

/** Something behind this snapshot changed; upload it shortly. */
export function markDirty(kind: PhoneSnapshotKind): void {
  if (!configured() || dirtyTimers.has(kind)) return;
  const pending = setTimeout(() => {
    dirtyTimers.delete(kind);
    void run([kind], false);
  }, DIRTY_DELAY_MS);
  pending.unref();
  dirtyTimers.set(kind, pending);
}

function scheduleAll(): void {
  for (const kind of KINDS) markDirty(kind);
}

export function start(nextDeps: PhoneSyncDeps): void {
  deps = nextDeps;
  if (timer) return;
  // Inventory and price changes have no single event in main; a periodic look
  // with the hash check catches them without uploading unchanged data.
  timer = setInterval(() => void run(KINDS, false), CHECK_INTERVAL_MS);
  timer.unref();
  scheduleAll();
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  for (const pending of dirtyTimers.values()) clearTimeout(pending);
  dirtyTimers.clear();
}

export function __resetPhoneSyncForTest(): void {
  stop();
  config = null;
  deps = null;
  lastSent.relics = null;
  lastSent.levelcap = null;
  lastHash.relics = undefined;
  lastHash.levelcap = undefined;
  lastError = null;
  syncing = false;
}
