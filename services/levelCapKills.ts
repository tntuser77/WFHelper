import { asRecord } from "../config/shared/objectValidation";
import { normalizeErrorMessage } from "../config/shared/errors";
import { withScope } from "./logger";

const log = withScope("levelCapKills");

/** Stats land on the profile about a minute after a mission ends; a Cascade
 *  started sooner than that would read the last mission as unposted. */
const BASELINE_REREADS_MS = [2 * 60_000, 10 * 60_000];
const AFTER_POLL_MS = 30_000;
const AFTER_GIVE_UP_MS = 10 * 60_000;

/** Lifetime totals off the public profile. */
export interface LifetimeStats {
  kills: number;
  /** Completed, quit, failed and interrupted: any way a mission can end. */
  missionsEnded: number;
  /** The profile's display name without its platform glyph, when it has one. */
  name?: string;
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

/** Reads `getProfileViewingData.php`; null when the response has no stats. */
export function parseLifetimeStats(raw: unknown): LifetimeStats | null {
  const record = asRecord(raw);
  const stats = asRecord(record?.Stats);
  if (!stats || !Array.isArray(stats.Enemies)) return null;
  let kills = 0;
  for (const enemy of stats.Enemies) kills += count(asRecord(enemy)?.kills);
  const missionsEnded =
    count(stats.MissionsCompleted) +
    count(stats.MissionsQuit) +
    count(stats.MissionsFailed) +
    count(stats.MissionsInterrupted);
  const out: LifetimeStats = { kills, missionsEnded };
  const first: unknown = Array.isArray(record?.Results) ? record.Results[0] : null;
  const displayName = asRecord(first)?.DisplayName;
  // Names end in a private-use platform glyph (U+E000 for PC).
  const name = typeof displayName === "string" ? displayName.replace(/[-]/g, "").trim() : "";
  if (name) out.name = name;
  return out;
}

interface KillCounterDeps {
  /** Your account id; null until an inventory fetch has seen it. */
  ownAccountId(): string | null;
  /** An account's lifetime stats now; null when its profile shows none. */
  read(accountId: string): Promise<LifetimeStats | null>;
  onKills(runId: string, kills: number): void;
  /** A squadmate's kills on the run, under the name on their profile. */
  onSquadKills(runId: string, name: string, kills: number): void;
  /** The runs waiting on their kills changed, for the "kills..." hint. */
  onPending(): void;
}

type Timer = ReturnType<typeof setTimeout>;

/** An account followed through one mission, with its reading from during the run. */
interface Tracked {
  baseline: LifetimeStats | null;
  reading: Promise<void>;
}

/** Kills on a run for you and each squadmate: lifetime kills after it less
 *  lifetime kills during it. Stats never move mid-mission, so any reading
 *  taken during the run will do. */
export function createKillCounter(deps: KillCounterDeps) {
  // Accounts in the mission under way; null between missions.
  let players: Map<string, Tracked> | null = null;
  const baselineTimers = new Set<Timer>();
  // Runs waiting on their after readings -> accounts still out. They outlive
  // the next mission starting.
  const pending = new Map<string, number>();
  const pollTimers = new Set<Timer>();

  function later(timers: Set<Timer>, ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timer.unref?.();
    timers.add(timer);
  }

  function clear(timers: Set<Timer>): void {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function settle(runId: string): void {
    const left = pending.get(runId);
    if (left === undefined) return;
    if (left > 1) {
      pending.set(runId, left - 1);
      return;
    }
    pending.delete(runId);
    deps.onPending();
  }

  function readBaseline(accountId: string, player: Tracked): void {
    player.reading = deps
      .read(accountId)
      .then((stats) => {
        // A later reading only ever adds a mission that was still posting.
        if (stats && stats.missionsEnded >= (player.baseline?.missionsEnded ?? 0)) {
          player.baseline = stats;
        }
      })
      .catch((err) =>
        log.warn("[LevelCap] kill baseline read failed:", normalizeErrorMessage(err)),
      );
  }

  function track(accountId: string): void {
    if (!players || players.has(accountId)) return;
    const player: Tracked = { baseline: null, reading: Promise.resolve() };
    players.set(accountId, player);
    readBaseline(accountId, player);
    for (const ms of BASELINE_REREADS_MS) {
      later(baselineTimers, ms, () => readBaseline(accountId, player));
    }
  }

  function poll(
    runId: string,
    accountId: string,
    before: LifetimeStats,
    deadline: number,
    you: boolean,
  ): void {
    const retry = () => {
      if (!pending.has(runId)) return;
      if (Date.now() + AFTER_POLL_MS > deadline) {
        log.warn("[LevelCap] run stats never reached the profile; kills left unknown");
        settle(runId);
        return;
      }
      later(pollTimers, AFTER_POLL_MS, () => poll(runId, accountId, before, deadline, you));
    };
    deps
      .read(accountId)
      .then((after) => {
        if (!pending.has(runId)) return;
        if (!after || after.missionsEnded <= before.missionsEnded) return retry();
        settle(runId);
        // Two missions ended: something else was counted too, so the difference is not this run's.
        if (after.missionsEnded - before.missionsEnded > 1) {
          log.warn("[LevelCap] more than one mission posted since the run began; kills skipped");
          return;
        }
        const kills = Math.max(0, after.kills - before.kills);
        if (you) {
          log.info(`[LevelCap] ${kills} kills on run ${runId}`);
          deps.onKills(runId, kills);
          return;
        }
        const name = before.name ?? after.name;
        if (!name) return;
        log.info(`[LevelCap] ${name} got ${kills} kills on run ${runId}`);
        deps.onSquadKills(runId, name, kills);
      })
      .catch((err) => {
        log.warn("[LevelCap] kill read after the run failed:", normalizeErrorMessage(err));
        retry();
      });
  }

  return {
    /** A Void Cascade began, or one under way was found at startup. */
    missionStarted(): void {
      clear(baselineTimers);
      players = new Map();
      const own = deps.ownAccountId();
      if (own) track(own);
    },

    /** An account id the log showed during the mission; yours is skipped. */
    squadmateSeen(accountId: string): void {
      if (accountId !== deps.ownAccountId()) track(accountId);
    },

    /** The mission ended; `runId` is the run it logged, or null when none was. */
    missionEnded(runId: string | null): void {
      clear(baselineTimers);
      const tracked = players;
      players = null;
      if (!runId || !tracked) return;
      pending.set(runId, 1);
      deps.onPending();
      // Readings still in flight were taken during the mission, so they count.
      void Promise.all([...tracked.values()].map((player) => player.reading)).then(() => {
        if (!pending.has(runId)) return;
        const own = deps.ownAccountId();
        if (!own || !tracked.get(own)?.baseline) {
          log.warn("[LevelCap] no kill reading from during the run; your kills left unknown");
        }
        const measured = [...tracked].flatMap(([accountId, player]) =>
          player.baseline ? [{ accountId, before: player.baseline }] : [],
        );
        if (!measured.length) {
          settle(runId);
          return;
        }
        pending.set(runId, measured.length);
        const deadline = Date.now() + AFTER_POLL_MS + AFTER_GIVE_UP_MS;
        for (const { accountId, before } of measured) {
          const you = accountId === own;
          later(pollTimers, AFTER_POLL_MS, () => poll(runId, accountId, before, deadline, you));
        }
      });
    },

    pendingRunIds: (): string[] => [...pending.keys()],

    reset(): void {
      clear(baselineTimers);
      clear(pollTimers);
      players = null;
      pending.clear();
    },
  };
}
