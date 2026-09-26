import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createLevelCapParser, type LevelCapMission } from "../../services/levelCapParser";

// Two solo Void Cascades and an Extermination between them, cut from a real
// EE.log: the first summoned an archgun, the second retired two Exolizers.
const SESSION = fs
  .readFileSync(path.join(__dirname, "..", "fixtures", "levelcap", "session.log"), "utf8")
  .split("\n");

function run(lines: readonly string[]) {
  const parser = createLevelCapParser();
  const starts: LevelCapMission[] = [];
  const ends: LevelCapMission[] = [];
  for (const line of lines) {
    for (const event of parser.feedLine(line)) {
      (event.type === "start" ? starts : ends).push(event.mission);
    }
  }
  return { parser, starts, ends };
}

describe("levelCapParser", () => {
  it("opens a mission only for Void Cascade", () => {
    const { starts } = run(SESSION);
    expect(starts.map((m) => m.startSec)).toEqual([60.969, 289.911]);
  });

  it("decodes the room layout printed while the mission loads", () => {
    const { starts } = run(SESSION);
    expect(starts[0].tile?.rooms.map((r) => r.name)).toEqual([
      "Habitation Zone",
      "Hall of Legems",
      "Hangar",
    ]);
    expect(starts[0].tile?.total).toBe(11);
    expect(starts[1].tile?.rooms.map((r) => r.name)).toEqual([
      "Schoolyard",
      "Hall of Legems",
      "Cargo Bay",
    ]);
  });

  it("counts Exolizers and collects the gear that got kills", () => {
    const { ends } = run(SESSION);
    expect(ends).toHaveLength(2);
    expect(ends[0].exolizers).toBeNull();
    expect(Object.keys(ends[0].gearXp)).toContain("HEAVY_GUN_SLOT");
    expect(ends[1].exolizers).toBe(2);
    expect(ends[1].endSec).toBe(598.951);
    expect(Object.keys(ends[1].gearXp).sort()).toEqual(["MELEE_SLOT", "SUIT_SLOT"]);
  });

  it("records a solo squad once however often the loader repeats", () => {
    const { ends } = run(SESSION);
    expect(ends[1].players).toEqual(["Player1"]);
  });

  it("reports the live mission and forgets it after the end", () => {
    const upToExo = SESSION.findIndex((l) => l.includes("Pillars used increased to: 2"));
    const { parser } = run(SESSION.slice(0, upToExo + 1));
    expect(parser.current()?.exolizers).toBe(2);
    const { parser: done } = run(SESSION);
    expect(done.current()).toBeNull();
  });

  it("counts every squad member that loads in", () => {
    const { ends } = run([
      "1.0 Script [Info]: ThemedSquadOverlay.lua: Mission name: Tuvul Commons (Zariman) - THE STEEL PATH",
      "2.0 Game [Info]: Player1 loadout loader finished.",
      "2.1 Game [Info]: Player2 loadout loader finished.",
      "3.0 Game [Info]: OnStateStarted, mission type=MT_VOID_CASCADE",
      "3.1 Game [Info]: Player3 loadout loader finished.",
      "9.0 Sys [Info]: EOM missionLocationUnlocked=1",
      "20.0 Sys [Info]: unrelated",
    ]);
    expect(ends[0].players).toEqual(["Player1", "Player2", "Player3"]);
    expect(ends[0].tile).toBeNull();
  });

  it("flush closes an open mission", () => {
    const parser = createLevelCapParser();
    parser.feedLine("3.0 Game [Info]: OnStateStarted, mission type=MT_VOID_CASCADE");
    expect(parser.flush()?.startSec).toBe(3);
    expect(parser.flush()).toBeNull();
  });
});
