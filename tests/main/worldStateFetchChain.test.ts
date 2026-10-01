import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/worldStateFetch", () => ({
  fetchJsonWithTimeout: vi.fn(),
  fetchJsonIpv4: vi.fn(),
}));

vi.mock("../../config/shared/fetchWithTimeout", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchAndParse } from "../../services/worldStateParser";
import { fetchWithTimeout } from "../../config/shared/fetchWithTimeout";
import { fetchJsonIpv4, fetchJsonWithTimeout } from "../../services/worldStateFetch";

const mockFetch = vi.mocked(fetchWithTimeout);
const mockFetchJson = vi.mocked(fetchJsonWithTimeout);
const mockFetchIpv4 = vi.mocked(fetchJsonIpv4);

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
    expect(mockFetchIpv4).not.toHaveBeenCalled();
  });

  it("retries a DE 403 over IPv4", async () => {
    mockFetch.mockResolvedValue(response(403, {}));
    mockFetchIpv4.mockResolvedValue({ ActiveMissions: [] });

    await fetchAndParse();

    expect(mockFetchIpv4).toHaveBeenCalledWith(DE, expect.any(Number));
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

  it("names the IPv4 failure when the retry also fails", async () => {
    mockFetch.mockResolvedValue(response(403, {}));
    mockFetchIpv4.mockRejectedValue(new Error(`HTTP 403 for ${DE} (IPv4)`));

    await expect(fetchAndParse()).rejects.toThrow(/\(IPv4\)/);
  });
});
