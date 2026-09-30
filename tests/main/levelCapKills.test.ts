import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createKillCounter,
  parseLifetimeStats,
  type LifetimeStats,
} from "../../services/levelCapKills";

const stats = (kills: number, missionsEnded: number): LifetimeStats => ({ kills, missionsEnded });

type Reading = LifetimeStats | null | Error;

/** A counter whose profile reads come off a queue per account ("me" is you);
 *  an empty queue repeats its last reading. */
function counter(readings: Reading[], squad: Record<string, Reading[]> = {}) {
  const kills: Array<[string, number]> = [];
  const squadKills: Array<[string, string, number]> = [];
  const queues: Record<string, Reading[]> = { ...squad, me: readings };
  const last: Record<string, Reading> = {};
  const read = vi.fn(async (accountId: string) => {
    const queue = queues[accountId] ?? [];
    const next = queue.length ? queue.shift()! : (last[accountId] ?? null);
    last[accountId] = next;
    if (next instanceof Error) throw next;
    return next;
  });
  const onPending = vi.fn();
  const kc = createKillCounter({
    ownAccountId: () => "me",
    read,
    onKills: (runId, n) => kills.push([runId, n]),
    onSquadKills: (runId, name, n) => squadKills.push([runId, name, n]),
    onPending,
  });
  return { kc, read, kills, squadKills, onPending, readings, queues };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const minutes = (n: number) => vi.advanceTimersByTimeAsync(n * 60_000);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseLifetimeStats", () => {
  it("sums kills over every enemy and counts every way a mission ends", () => {
    expect(
      parseLifetimeStats({
        Results: [{ DisplayName: "TNTUSER55" }],
        Stats: {
          MissionsCompleted: 7739,
          MissionsQuit: 100,
          MissionsFailed: 20,
          MissionsInterrupted: 3,
          Enemies: [
            { type: "/Lotus/Types/Enemies/A", kills: 1000, executions: 2 },
            { type: "/Lotus/Types/Enemies/B", kills: 23 },
            { type: "/Lotus/Types/Enemies/C", assists: 4 },
            { type: "/Lotus/Types/Enemies/D", kills: -7 },
          ],
        },
      }),
    ).toEqual({ kills: 1023, missionsEnded: 7862, name: "TNTUSER55" });
  });

  it("is null when the response carries no stats", () => {
    expect(parseLifetimeStats(null)).toBeNull();
    expect(parseLifetimeStats({ Results: [] })).toBeNull();
    expect(parseLifetimeStats({ Stats: { MissionsCompleted: 3 } })).toBeNull();
  });
});

describe("createKillCounter", () => {
  it("diffs the reading during the run against the first one after it posts", async () => {
    const { kc, kills, readings } = counter([stats(1_979_602, 7739)]);
    kc.missionStarted();
    await flush();
    kc.missionEnded("run-1");
    await flush();
    expect(kc.pendingRunIds()).toEqual(["run-1"]);

    // Not posted yet at the first poll, posted at the second.
    readings.push(stats(1_979_602, 7739), stats(1_979_715, 7740));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(kills).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(kills).toEqual([["run-1", 113]]);
    expect(kc.pendingRunIds()).toEqual([]);
  });

  it("takes a later reading when the mission before the run was still posting", async () => {
    const { kc, kills, readings } = counter([stats(500, 10)]);
    kc.missionStarted();
    await flush();
    // The previous mission lands two minutes into the Cascade.
    readings.push(stats(600, 11));
    await minutes(2);
    kc.missionEnded("run-1");
    readings.push(stats(900, 12));
    await minutes(1);
    expect(kills).toEqual([["run-1", 300]]);
  });

  it("never lets an older reading replace a newer one", async () => {
    const { kc, kills, readings } = counter([stats(600, 11)]);
    kc.missionStarted();
    await flush();
    readings.push(stats(500, 10));
    await minutes(2);
    kc.missionEnded("run-1");
    readings.push(stats(700, 12));
    await minutes(1);
    expect(kills).toEqual([["run-1", 100]]);
  });

  it("gives up after ten minutes when the run never posts", async () => {
    const { kc, kills, read } = counter([stats(100, 5)]);
    kc.missionStarted();
    await flush();
    kc.missionEnded("run-1");
    await minutes(15);
    expect(kills).toEqual([]);
    expect(kc.pendingRunIds()).toEqual([]);
    const calls = read.mock.calls.length;
    await minutes(15);
    expect(read.mock.calls.length).toBe(calls);
  });

  it("skips the count when two missions posted since the reading", async () => {
    const { kc, kills, readings } = counter([stats(100, 5)]);
    kc.missionStarted();
    await flush();
    kc.missionEnded("run-1");
    readings.push(stats(400, 7));
    await minutes(1);
    expect(kills).toEqual([]);
    expect(kc.pendingRunIds()).toEqual([]);
  });

  it("keeps polling through a failed read", async () => {
    const { kc, kills, readings } = counter([stats(100, 5)]);
    kc.missionStarted();
    await flush();
    kc.missionEnded("run-1");
    readings.push(new Error("HTTP 503"), stats(150, 6));
    await minutes(1);
    expect(kills).toEqual([["run-1", 50]]);
  });

  it("does nothing without an account, or when the mission logged no run", async () => {
    const none = counter([null]);
    none.kc.missionStarted();
    await flush();
    none.kc.missionEnded("run-1");
    await minutes(15);
    expect(none.kills).toEqual([]);
    expect(none.kc.pendingRunIds()).toEqual([]);

    const noRun = counter([stats(100, 5)]);
    noRun.kc.missionStarted();
    await flush();
    noRun.kc.missionEnded(null);
    await minutes(15);
    expect(noRun.read).toHaveBeenCalledTimes(1);
  });

  it("finishes the last run while the next Cascade is already under way", async () => {
    const { kc, kills, readings } = counter([stats(100, 5)]);
    kc.missionStarted();
    await flush();
    kc.missionEnded("run-1");
    await flush();
    readings.push(stats(100, 5));
    kc.missionStarted();
    await flush();
    readings.push(stats(180, 6), stats(180, 6));
    await minutes(1);
    expect(kills).toEqual([["run-1", 80]]);
    // The two-minute re-read sees run 1 posted, so run 2 is measured from there.
    await minutes(2);
    kc.missionEnded("run-2");
    readings.push(stats(250, 7));
    await minutes(1);
    expect(kills).toEqual([
      ["run-1", 80],
      ["run-2", 70],
    ]);
  });

  it("counts each squadmate seen during the run under their profile name", async () => {
    const { kc, kills, squadKills, readings, queues } = counter([stats(100, 5)], {
      host: [{ kills: 7000, missionsEnded: 115, name: "l7ese" }],
      mate: [{ kills: 43_000, missionsEnded: 548, name: "A_jie0929" }],
    });
    kc.missionStarted();
    kc.squadmateSeen("host");
    await minutes(5);
    // Relic rewards name everyone, you included; you are not counted twice.
    kc.squadmateSeen("me");
    kc.squadmateSeen("mate");
    kc.squadmateSeen("host");
    await flush();
    kc.missionEnded("run-1");
    readings.push(stats(250, 6));
    queues.host.push({ kills: 7400, missionsEnded: 116, name: "l7ese" });
    queues.mate.push({ kills: 43_000, missionsEnded: 548, name: "A_jie0929" });
    await minutes(1);
    expect(kills).toEqual([["run-1", 150]]);
    expect(squadKills).toEqual([["run-1", "l7ese", 400]]);
    // One squadmate's stats are late, so the run stays pending for them.
    expect(kc.pendingRunIds()).toEqual(["run-1"]);
    queues.mate.push({ kills: 43_900, missionsEnded: 549, name: "A_jie0929" });
    await minutes(1);
    expect(squadKills).toEqual([
      ["run-1", "l7ese", 400],
      ["run-1", "A_jie0929", 900],
    ]);
    expect(kc.pendingRunIds()).toEqual([]);
  });

  it("skips a squadmate whose profile shows no stats, and ids seen between missions", async () => {
    const { kc, kills, squadKills, readings, read } = counter([stats(100, 5)], {
      hidden: [null],
      stray: [stats(1, 1)],
    });
    kc.squadmateSeen("stray");
    kc.missionStarted();
    kc.squadmateSeen("hidden");
    await flush();
    kc.missionEnded("run-1");
    readings.push(stats(130, 6));
    await minutes(1);
    expect(kills).toEqual([["run-1", 30]]);
    expect(squadKills).toEqual([]);
    expect(kc.pendingRunIds()).toEqual([]);
    expect(read.mock.calls.some(([id]) => id === "stray")).toBe(false);
  });

  it("stops every timer on reset", async () => {
    const { kc, read } = counter([stats(100, 5)]);
    kc.missionStarted();
    await flush();
    kc.missionEnded("run-1");
    await flush();
    kc.reset();
    const calls = read.mock.calls.length;
    await minutes(20);
    expect(read.mock.calls.length).toBe(calls);
    expect(kc.pendingRunIds()).toEqual([]);
  });
});
