import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createLevelCapParser,
  isLevelCapLine,
  type LevelCapMission,
} from "../../services/levelCapParser";

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

  // The PC platform glyph the game appends to player names.
  const GLYPH = String.fromCharCode(0xe000);
  // Lines a squad client logs: a late join, rounds, but no Exolizer count.
  const CLIENT = [
    "1790.200 Sys [Info]: HighLevelGraph setup 226 implicit bridges for zone 2 in 5.06e-05s total 157",
    "1790.200 Sys [Info]: HighLevelGraph setup 402 implicit bridges for zone 6 in 5.94e-05s total 541",
    "1790.200 Sys [Info]: HighLevelGraph setup 493 implicit bridges for zone 8 in 7.29e-05s total 917",
    "1790.409 Sys [Info]: GameRulesImpl::OnStateStarted when WaitingForPlayers; assuming late join and starting session",
    "1790.410 Game [Info]: OnStateStarted, mission type=MT_VOID_CASCADE",
    `1791.000 Game [Info]: Player1${GLYPH} loadout loader finished.`,
    `1792.000 Game [Info]: Player2${GLYPH} loadout loader finished.`,
    "5848.140 Script [Info]: ZarimanSurvivalMission.lua: Zariman Survival (Void Cascade): Client: trying to catch up with new reward count= 26, current=25",
    "5848.140 Script [Info]: ZarimanSurvivalMission.lua: Gave reward tier 26 at 0",
    "5994.030 Script [Info]: ZarimanSurvivalMission.lua: Gave reward tier 27 at 0",
  ];

  it("follows a squad client's run by rounds", () => {
    const parser = createLevelCapParser();
    for (const line of CLIENT) parser.feedLine(line);
    const mission = parser.current();
    expect(mission?.rounds).toBe(27);
    expect(mission?.exolizers).toBeNull();
    expect(mission?.players).toEqual(["Player1", "Player2"]);
    expect(mission?.tile?.rooms.map((r) => r.name)).toEqual([
      "Albrecht's Park",
      "Hangar",
      "Schoolyard",
    ]);
  });

  it("flags only the lines the parser reads", () => {
    expect(CLIENT.every((line) => isLevelCapLine(line) || line.includes("late join"))).toBe(true);
    expect(isLevelCapLine("12.0 Net [Info]: NAT bound for client")).toBe(false);
  });
});
