import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-phone-sync-"));
const configFile = path.join(tempDir, "phone-sync.json");

const URL_OK = "https://wfhelper-mailbox.example.workers.dev";
const WRITE_KEY = "desktop-secret";

const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  encryptionAvailable: true,
}));

vi.mock("electron", () => ({
  app: { getPath: () => tempDir },
  safeStorage: {
    isEncryptionAvailable: () => h.encryptionAvailable,
    encryptString: (text: string) => Buffer.from(`sealed:${text}`, "utf8"),
    decryptString: (raw: Buffer) => {
      const text = Buffer.from(raw).toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("bad ciphertext");
      return text.slice("sealed:".length);
    },
  },
}));

vi.mock("node:dns", () => ({
  default: { promises: { lookup: h.lookup } },
  promises: { lookup: h.lookup },
}));

vi.mock("../../services/warframeStatus", () => ({ isWarframeRunningCached: () => null }));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

type PhoneSync = typeof import("../../services/phoneSync");

async function importPhoneSync(): Promise<PhoneSync> {
  vi.resetModules();
  return import("../../services/phoneSync");
}

function response(status: number, body = ""): Response {
  return {
    status,
    headers: new Headers(),
    body: body
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          },
        })
      : null,
  } as unknown as Response;
}

const fetchMock = vi.fn();

/** Answers like the mailbox Worker for a correct key. */
function workerAnswers(): void {
  fetchMock.mockImplementation(
    async (url: URL, init: { method: string; headers: Record<string, string> }) => {
      const auth = init.headers.authorization;
      if (auth !== `Bearer ${WRITE_KEY}`) return response(401);
      const route = `${init.method} ${url.pathname}`;
      if (route === "GET /v1/pair") return response(405);
      if (route === "POST /v1/pair") return response(200, JSON.stringify({ key: "phone-key" }));
      if (route === "DELETE /v1/pair") return response(204);
      if (route === "GET /v1/inbox/notes") {
        return response(200, JSON.stringify({ Dante: { note: "from the phone", editedAt: 5 } }));
      }
      if (route === "POST /v1/inbox/notes/ack") return response(200, "{}");
      if (init.method === "PUT") return response(200, JSON.stringify({ etag: '"x"' }));
      return response(404);
    },
  );
}

beforeEach(() => {
  fs.rmSync(configFile, { force: true });
  h.encryptionAvailable = true;
  h.lookup.mockReset();
  h.lookup.mockResolvedValue([{ address: "104.21.0.1", family: 4 }]);
  fetchMock.mockReset();
  workerAnswers();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("phone sync config", () => {
  it("keeps the key encrypted on disk and never hands it to the renderer", async () => {
    const sync = await importPhoneSync();
    const result = await sync.setConfig(`${URL_OK}/`, `  ${WRITE_KEY}  `);
    expect(result.ok).toBe(true);
    expect(sync.getState()).toMatchObject({ url: URL_OK, keySet: true, keyPersisted: true });
    expect(JSON.stringify(sync.getState())).not.toContain(WRITE_KEY);

    const onDisk = fs.readFileSync(configFile, "utf8");
    expect(onDisk).not.toContain(WRITE_KEY);
    expect(onDisk).toContain("enc:v1:");

    const reloaded = await importPhoneSync();
    expect(reloaded.getState().keySet).toBe(true);
    sync.stop();
  });

  it("refuses a key the Worker does not accept and keeps the old settings", async () => {
    const sync = await importPhoneSync();
    await expect(sync.setConfig(URL_OK, "wrong")).resolves.toEqual({
      ok: false,
      error: "unreachable",
    });
    expect(sync.getState().keySet).toBe(false);
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it("refuses plain http and private addresses", async () => {
    const sync = await importPhoneSync();
    await expect(sync.setConfig("http://example.com", WRITE_KEY)).resolves.toMatchObject({
      ok: false,
      error: "invalid-url",
    });
    await expect(sync.setConfig("https://192.168.1.10", WRITE_KEY)).resolves.toMatchObject({
      ok: false,
      error: "blocked-url",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not write the key in the clear when safeStorage is unavailable", async () => {
    h.encryptionAvailable = false;
    const sync = await importPhoneSync();
    await sync.setConfig(URL_OK, WRITE_KEY);
    expect(sync.getState()).toMatchObject({ keySet: true, keyPersisted: false });
    expect(fs.readFileSync(configFile, "utf8")).not.toContain(WRITE_KEY);
    sync.stop();
  });
});

describe("pairing", () => {
  it("returns a QR code holding the address and a fresh phone key", async () => {
    const sync = await importPhoneSync();
    await sync.setConfig(URL_OK, WRITE_KEY);
    const paired = await sync.pair();
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    expect(paired.value.qr).toMatch(/^data:image\/png;base64,/);
    expect(paired.value.state.pairedAt).toEqual(expect.any(Number));

    const unpaired = await sync.unpair();
    expect(unpaired.ok && unpaired.value.pairedAt).toBeNull();
    sync.stop();
  });

  it("says not-configured before an address and key are saved", async () => {
    const sync = await importPhoneSync();
    await expect(sync.pair()).resolves.toEqual({ ok: false, error: "not-configured" });
  });
});

describe("uploads", () => {
  it("sends both snapshots, then skips ones whose content did not change", async () => {
    const sync = await importPhoneSync();
    await sync.setConfig(URL_OK, WRITE_KEY);
    let generatedAt = 1;
    sync.start({
      buildSnapshot: (kind) =>
        kind === "relics"
          ? { v: 1, kind, generatedAt: generatedAt++, pricesAt: null, relics: [] }
          : { v: 1, kind, generatedAt: generatedAt++, frameNotes: {}, runs: [] },
    });

    const state = await sync.syncNow();
    const puts = () => fetchMock.mock.calls.filter(([, init]) => init.method === "PUT");
    expect(puts().map(([url]) => (url as URL).pathname)).toEqual([
      "/v1/data/relics",
      "/v1/data/levelcap",
    ]);
    expect(state.lastSent.relics).toEqual(expect.any(Number));
    expect(state.lastError).toBeNull();

    // A newer build time alone is not a change worth an upload.
    // Drop the upload setConfig queued, so this one is the only one pending.
    sync.stop();
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    sync.markDirty("levelcap");
    await vi.advanceTimersByTimeAsync(31_000);
    vi.useRealTimers();
    await vi.waitFor(() => expect(sync.getState().syncing).toBe(false));
    expect(generatedAt).toBeGreaterThan(3);
    expect(puts()).toHaveLength(2);
    sync.stop();
  });

  it("queues a change that arrives while another upload is running", async () => {
    const sync = await importPhoneSync();
    await sync.setConfig(URL_OK, WRITE_KEY);
    sync.stop();
    sync.start({
      buildSnapshot: (kind) =>
        kind === "relics"
          ? { v: 1, kind, generatedAt: 1, pricesAt: null, relics: [] }
          : { v: 1, kind, generatedAt: 1, frameNotes: {}, runs: [] },
    });
    // Both kinds come due together, as they do right after start-up.
    sync.stop();
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    sync.markDirty("relics");
    sync.markDirty("levelcap");
    await vi.advanceTimersByTimeAsync(31_000);
    vi.useRealTimers();
    await vi.waitFor(() => expect(sync.getState().syncing).toBe(false));
    const puts = fetchMock.mock.calls.filter(([, init]) => init.method === "PUT");
    expect(puts.map(([url]) => (url as URL).pathname).sort()).toEqual([
      "/v1/data/levelcap",
      "/v1/data/relics",
    ]);
    sync.stop();
  });

  it("applies notes from the phone and acknowledges them by edit time", async () => {
    const sync = await importPhoneSync();
    await sync.setConfig(URL_OK, WRITE_KEY);
    sync.stop();
    const applied: Array<Record<string, string>> = [];
    sync.start({
      buildSnapshot: () => ({ v: 1, kind: "levelcap", generatedAt: 1, frameNotes: {}, runs: [] }),
      applyNotes: (notes) => applied.push(notes),
    });
    await sync.syncNow();
    expect(applied[0]).toEqual({ Dante: "from the phone" });
    const ack = fetchMock.mock.calls.find(([url]) => (url as URL).pathname.endsWith("/ack"));
    expect(JSON.parse(ack?.[1].body as string)).toEqual({ Dante: 5 });
    sync.stop();
  });

  it("reports a failed upload in the state", async () => {
    const sync = await importPhoneSync();
    await sync.setConfig(URL_OK, WRITE_KEY);
    fetchMock.mockResolvedValue(response(500));
    sync.start({
      buildSnapshot: () => ({ v: 1, kind: "levelcap", generatedAt: 1, frameNotes: {}, runs: [] }),
    });
    const state = await sync.syncNow();
    expect(state.lastError).toContain("upload failed (500)");
    sync.stop();
  });
});
