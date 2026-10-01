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

const DE_PRIMARY = "https://api.warframe.com/cdn/worldState.php";
const DE_LEGACY = "https://content.warframe.com/dynamic/worldState.php";
const ORACLE = "https://oracle.browse.wf/worldState.json";

function response(status: number, body: unknown): Awaited<ReturnType<typeof fetchWithTimeout>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Awaited<ReturnType<typeof fetchWithTimeout>>;
}

function worldStateUrls(): string[] {
  return [
    ...mockFetch.mock.calls.map((call) => String(call[0])),
    ...mockFetchJson.mock.calls.map((call) => String(call[0])),
  ].filter((url) => url === DE_PRIMARY || url === DE_LEGACY || url === ORACLE);
}

describe("world-state source chain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchJson.mockRejectedValue(new Error("no cycles in this test"));
  });

  it("uses DE first and never touches the community oracle", async () => {
    mockFetch.mockResolvedValue(response(200, { ActiveMissions: [] }));

    await fetchAndParse();

    expect(worldStateUrls()).toEqual([DE_PRIMARY]);
  });

  it("falls through to the legacy DE path, then the oracle", async () => {
    mockFetch.mockResolvedValue(response(404, {}));
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url === ORACLE) return { ActiveMissions: [] };
      throw new Error("no cycles in this test");
    });

    await fetchAndParse();

    expect(worldStateUrls()).toEqual([DE_PRIMARY, DE_LEGACY, ORACLE]);
  });

  it("rejects an empty successful response and tries the next DE path", async () => {
    mockFetch.mockImplementation(async (input: string | URL | Request) =>
      response(200, String(input) === DE_PRIMARY ? {} : { ActiveMissions: [] }),
    );

    await fetchAndParse();

    expect(worldStateUrls()).toEqual([DE_PRIMARY, DE_LEGACY]);
  });

  it("rejects empty responses from both DE paths before using the oracle", async () => {
    mockFetch.mockResolvedValue(response(200, {}));
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url === ORACLE) return { ActiveMissions: [] };
      throw new Error("no cycles in this test");
    });

    await fetchAndParse();

    expect(worldStateUrls()).toEqual([DE_PRIMARY, DE_LEGACY, ORACLE]);
  });

  it("retries a DE 403 over IPv4 before falling through", async () => {
    mockFetch.mockResolvedValue(response(403, {}));
    mockFetchIpv4.mockResolvedValue({ ActiveMissions: [] });

    await fetchAndParse();

    expect(mockFetchIpv4).toHaveBeenCalledWith(DE_PRIMARY, expect.any(Number));
    expect(worldStateUrls()).toEqual([DE_PRIMARY]);
  });

  it("throws instead of reporting an empty world when every source fails", async () => {
    mockFetch.mockResolvedValue(response(404, {}));

    await expect(fetchAndParse()).rejects.toThrow(/every world-state source failed/);
  });
});
