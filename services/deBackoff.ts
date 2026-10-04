import fs from "node:fs";

import { writeFileAtomicSync } from "./atomicFile";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";

const log = withScope("deBackoff");

/** DE's Akamai edge answers an empty 403 once it flags an address, and the flag
 *  reaches game login. Requests made while flagged keep it in place, so one 403
 *  from any DE API host pauses every DE API call. Persisted so a restart does
 *  not fire a fresh round of startup fetches at a blocked address. */
const DE_FORBIDDEN_PAUSE_MS = 6 * 60 * 60 * 1000;

let _pausedUntil: number | null = null;

function statePath(): string {
  return userDataPath("de-backoff.json");
}

function loadPausedUntil(): number {
  if (_pausedUntil !== null) return _pausedUntil;
  _pausedUntil = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf-8")) as { pausedUntil?: unknown };
    if (typeof raw.pausedUntil === "number" && Number.isFinite(raw.pausedUntil)) {
      _pausedUntil = raw.pausedUntil;
    }
  } catch {
    // no saved pause
  }
  return _pausedUntil;
}

/** When DE API calls may resume, or null when they are not paused. */
export function dePausedUntil(now = Date.now()): number | null {
  const until = loadPausedUntil();
  return until > now ? until : null;
}

/** Throws without touching the network while DE API calls are paused. */
export function assertDeNotPaused(now = Date.now()): void {
  const until = dePausedUntil(now);
  if (until !== null) {
    throw new Error(`DE API requests paused until ${new Date(until).toLocaleString()} after a 403`);
  }
}

export function noteDeForbidden(source: string, now = Date.now()): void {
  _pausedUntil = now + DE_FORBIDDEN_PAUSE_MS;
  log.warn(
    `${source}: DE answered 403 - pausing all DE API requests until ` +
      new Date(_pausedUntil).toLocaleString(),
  );
  try {
    writeFileAtomicSync(statePath(), JSON.stringify({ pausedUntil: _pausedUntil }));
  } catch (err) {
    log.warn("Could not save the DE pause:", err instanceof Error ? err.message : String(err));
  }
}

export function _resetDeBackoffForTest(): void {
  _pausedUntil = 0;
}
