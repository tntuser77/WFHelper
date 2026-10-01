import https from "node:https";
import { WORLD_STATE_CONFIG } from "../config/runtime/worldState";
import { fetchWithTimeout } from "../config/shared/fetchWithTimeout";

export async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number = WORLD_STATE_CONFIG.cycleFetchTimeoutMs,
): Promise<unknown> {
  // The abort reason becomes the rejection, so a timed-out world-state fetch
  // logs "timeout" instead of the generic AbortError text.
  const resp = await fetchWithTimeout(
    url,
    timeoutMs,
    { headers: { Accept: "application/json" } },
    new Error("timeout"),
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

/** GET `url` over IPv4 only. DE's Akamai edge 403s some IPv6 ranges (seen on
 *  Verizon cellular) while serving the same address fine over IPv4, and the
 *  global fetch gives no way to pin the address family. */
export function fetchJsonIpv4(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { family: 4, headers: { Accept: "application/json" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url} (IPv4)`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}
