import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-de-backoff-"));

vi.mock("../../services/userDataPath", () => ({
  userDataPath: (...segments: string[]) => path.join(userData, ...segments),
}));

vi.mock("../../services/worldStateFetch", () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

vi.mock("../../config/shared/fetchWithTimeout", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchAndParse } from "../../services/worldStateParser";
import { fetchWithTimeout } from "../../config/shared/fetchWithTimeout";
import { fetchJsonWithTimeout } from "../../services/worldStateFetch";
import { _resetDeBackoffForTest, dePausedUntil } from "../../services/deBackoff";

const mockFetch = vi.mocked(fetchWithTimeout);
const mockFetchJson = vi.mocked(fetchJsonWithTimeout);

const DE = "https://api.warframe.com/cdn/worldState.php";

function response(status: number, body: unknown): Awaited<ReturnType<typeof fetchWithTimeout>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Awaited<ReturnType<typeof fetchWithTimeout>>;
}

describe("world-state source chain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _resetDeBackoffForTest();
    mockFetchJson.mockRejectedValue(new Error("no cycles in this test"));
  });

  it("uses DE and never touches the community oracle world state", async () => {
    mockFetch.mockResolvedValue(response(200, { ActiveMissions: [] }));

    await fetchAndParse();

    const urls = [...mockFetch.mock.calls, ...mockFetchJson.mock.calls].map((call) =>
      String(call[0]),
    );
    expect(urls.filter((url) => url.endsWith("worldState.php"))).toEqual([DE]);
    expect(urls.some((url) => url.includes("oracle.browse.wf/worldState"))).toBe(false);
  });

  it("pauses DE after a 403 instead of retrying", async () => {
    mockFetch.mockResolvedValue(response(403, {}));

    await expect(fetchAndParse()).rejects.toThrow(/HTTP 403 for https:\/\/api\.warframe\.com/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(dePausedUntil()).not.toBeNull();

    await expect(fetchAndParse()).rejects.toThrow(/paused until/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the pause across a restart", async () => {
    mockFetch.mockResolvedValue(response(403, {}));
    await expect(fetchAndParse()).rejects.toThrow(/HTTP 403/);

    vi.resetModules();
    const reloaded = await import("../../services/deBackoff");
    expect(reloaded.dePausedUntil()).not.toBeNull();
  });

  it("rejects an empty successful response instead of reporting an empty world", async () => {
    mockFetch.mockResolvedValue(response(200, {}));

    await expect(fetchAndParse()).rejects.toThrow(/invalid payload/);
  });

  it("names the failure when DE is down", async () => {
    mockFetch.mockResolvedValue(response(503, {}));

    await expect(fetchAndParse()).rejects.toThrow(
      /every world-state source failed: HTTP 503 for https:\/\/api\.warframe\.com/,
    );
  });
});
