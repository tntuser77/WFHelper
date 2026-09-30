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
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

/** Reads `getProfileViewingData.php`; null when the response has no stats. */
export function parseLifetimeStats(raw: unknown): LifetimeStats | null {
  const stats = asRecord(asRecord(raw)?.Stats);
  if (!stats || !Array.isArray(stats.Enemies)) return null;
  let kills = 0;
  for (const enemy of stats.Enemies) kills += count(asRecord(enemy)?.kills);
  const missionsEnded =
    count(stats.MissionsCompleted) +
    count(stats.MissionsQuit) +
    count(stats.MissionsFailed) +
    count(stats.MissionsInterrupted);
  return { kills, missionsEnded };
}

interface KillCounterDeps {
  /** Your lifetime stats now; null when there is no account to ask about. */
  read(): Promise<LifetimeStats | null>;
  onKills(runId: string, kills: number): void;
  /** The runs waiting on their kills changed, for the "kills…" hint. */
  onPending(): void;
}

/** Your kills on a run: lifetime kills after it less lifetime kills during it.
 *  Stats never move mid-mission, so any reading taken during the run will do. */
export function createKillCounter(deps: KillCounterDeps) {
  // Bumped by each mission start and end; a baseline read from an older one is dropped.
  let mission = 0;
  let baseline: LifetimeStats | null = null;
  let reading: Promise<void> = Promise.resolve();
  const baselineTimers = new Set<ReturnType<typeof setTimeout>>();
  // Runs waiting on their after reading; they outlive the next mission starting.
  const pending = new Set<string>();
  const pollTimers = new Set<ReturnType<typeof setTimeout>>();

  function later(timers: Set<ReturnType<typeof setTimeout>>, ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timer.unref?.();
    timers.add(timer);
  }

  function clear(timers: Set<ReturnType<typeof setTimeout>>): void {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function settle(runId: string): void {
    if (pending.delete(runId)) deps.onPending();
  }

  function readBaseline(at: number): void {
    reading = deps
      .read()
      .then((stats) => {
        // A later reading only ever adds a mission that was still posting.
        if (at === mission && stats && stats.missionsEnded >= (baseline?.missionsEnded ?? 0)) {
          baseline = stats;
        }
      })
      .catch((err) =>
        log.warn("[LevelCap] kill baseline read failed:", normalizeErrorMessage(err)),
      );
  }

  function poll(runId: string, before: LifetimeStats, deadline: number): void {
    const retry = () => {
      if (!pending.has(runId)) return;
      if (Date.now() + AFTER_POLL_MS > deadline) {
        log.warn("[LevelCap] run stats never reached the profile; kills left unknown");
        settle(runId);
        return;
      }
      later(pollTimers, AFTER_POLL_MS, () => poll(runId, before, deadline));
    };
    deps
      .read()
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
        log.info(`[LevelCap] ${kills} kills on run ${runId}`);
        deps.onKills(runId, kills);
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
      const at = ++mission;
      baseline = null;
      readBaseline(at);
      for (const ms of BASELINE_REREADS_MS) later(baselineTimers, ms, () => readBaseline(at));
    },

    /** The mission ended; `runId` is the run it logged, or null when none was. */
    missionEnded(runId: string | null): void {
      clear(baselineTimers);
      const at = mission;
      if (!runId) {
        mission++;
        baseline = null;
        return;
      }
      pending.add(runId);
      deps.onPending();
      // A reading still in flight was taken during the mission, so it counts.
      void reading.then(() => {
        const before = at === mission ? baseline : null;
        if (at === mission) {
          mission++;
          baseline = null;
        }
        if (!pending.has(runId)) return;
        if (!before) {
          log.warn("[LevelCap] no kill reading from during the run; kills left unknown");
          settle(runId);
          return;
        }
        later(pollTimers, AFTER_POLL_MS, () => poll(runId, before, Date.now() + AFTER_GIVE_UP_MS));
      });
    },

    pendingRunIds: (): string[] => [...pending],

    reset(): void {
      clear(baselineTimers);
      clear(pollTimers);
      mission++;
      baseline = null;
      pending.clear();
    },
  };
}
