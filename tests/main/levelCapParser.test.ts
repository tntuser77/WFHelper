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
  const accounts: string[] = [];
  for (const line of lines) {
    for (const event of parser.feedLine(line)) {
      if (event.type === "account") accounts.push(event.accountId);
      else (event.type === "start" ? starts : ends).push(event.mission);
    }
  }
  return { parser, starts, ends, accounts };
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

  // Three squads cut from one real EE.log (names replaced): a public mission you
  // hosted, a Void Cascade you joined by invite, and a public mission you joined.
  const SQUAD = fs
    .readFileSync(path.join(__dirname, "..", "fixtures", "levelcap", "squad.log"), "utf8")
    .split("\n");
  const upTo = (text: string) => SQUAD.slice(0, SQUAD.findIndex((l) => l.includes(text)) + 1);
  const slots = (entries: readonly { name: string; slot: number }[]) =>
    entries.map((entry) => `${entry.slot}:${entry.name}`);

  it("makes you slot 1 when you host", () => {
    const parser = createLevelCapParser();
    for (const line of upTo("OtherPlayer1_JoinerDeep")) parser.feedLine(line);
    const squad = parser.squad();
    expect(slots(squad)).toEqual(["1:MeLocal", "2:JoinerDeep"]);
    expect(squad[0]).toMatchObject({ host: true, local: true });
  });

  it("puts the host first and you second when you join them", () => {
    const { parser } = run(upTo("OtherPlayer3_JoinerNou"));
    // Spot-loads print after the loader line, before the loader starts.
    for (const line of SQUAD.slice(upTo("OtherPlayer3_JoinerNou").length)) {
      parser.feedLine(line);
      if (line.includes("(/Temp/OtherPlayer3_JoinerNou")) break;
    }
    const squad = parser.current()?.squad ?? [];
    expect(slots(squad)).toEqual(["1:HostUt", "2:MeLocal", "3:.dotted", "4:JoinerNou"]);
    const byName = new Map(squad.map((entry) => [entry.name, entry]));
    expect(byName.get("HostUt")).toMatchObject({ host: true, local: false, suitFolder: null });
    expect(byName.get("MeLocal")).toMatchObject({ host: false, local: true });
    expect(byName.get(".dotted")).toMatchObject({ suitFolder: "Volt", suitType: null });
    expect(byName.get("JoinerNou")).toMatchObject({
      suitFolder: "Ember",
      suitType: "/Lotus/Powersuits/Ember/EmberPrime",
    });
  });

  it("notes the frame a host's level load touched, and players joining mid-mission", () => {
    const parser = createLevelCapParser();
    for (const line of upTo("RemoveSquadMember: JoinerKv")) parser.feedLine(line);
    const squad = parser.squad();
    expect(slots(squad)).toEqual(["1:HostZoo", "2:MeLocal", "4:JoinerKi"]);
    expect(squad[0].levelLoadFolders[0]).toBe("Sandman");
    expect(squad[2]).toMatchObject({
      suitFolder: "Ranger",
      suitType: "/Lotus/Powersuits/Ranger/RangerBaseSuit",
    });
  });

  it("gives a leaver's slot to the next player to join", () => {
    const parser = createLevelCapParser();
    for (const line of upTo("RemoveSquadMember: JoinerKv")) parser.feedLine(line);
    parser.feedLine("8900.000 Net [Info]: AddSquadMember: Late, mm=ABC, squadCount=4");
    expect(slots(parser.squad())).toEqual(["1:HostZoo", "2:MeLocal", "3:Late", "4:JoinerKi"]);
  });

  it("forgets the squad when you leave it", () => {
    const parser = createLevelCapParser();
    for (const line of SQUAD) parser.feedLine(line);
    parser.feedLine("9000.000 Net [Info]: MatchingService::LeaveSquad");
    expect(parser.squad()).toEqual([]);
  });

  it("collects squad account ids from joining the host and from relic rewards", () => {
    const HOST = "6ab92b4d61dc54d6b009e00b";
    const MATE = "6ab4ff4ca40bc1f6a101d786";
    const ME = "5b9b0220f2f2eb3a7c067544";
    const lines = [
      "63.502 Net [Info]: JoinSquadSessionCallback. Session id=6abd8aa4f9941e7fcf0a5d8f, host name=l7ese",
      `64.638 Net [Info]: Trying to connect to l7ese, flags: 0, id=${HOST}`,
      "70.0 Game [Info]: OnStateStarted, mission type=MT_VOID_CASCADE",
      `228.406 Sys [Info]: VoidProjections: Client got reward info from ${ME}`,
      `228.406 Sys [Info]: VoidProjections: Still waiting on response from ${HOST}`,
      `228.406 Sys [Info]: VoidProjections: Still waiting on response from ${MATE}`,
      `228.466 Sys [Info]: VoidProjections: Client got reward info from ${HOST}`,
      `229.556 Sys [Info]: VoidProjections: Client got reward info from ${MATE}`,
    ];
    expect(lines.every(isLevelCapLine)).toBe(true);
    const { parser, starts, accounts } = run(lines);
    expect(starts[0].accountIds).toEqual([HOST]);
    // The host was known at the start; each later id is announced once.
    expect(accounts).toEqual([ME, MATE]);
    expect(parser.current()?.accountIds).toEqual([HOST, ME, MATE]);

    // Leaving the squad forgets the host, so the next Cascade starts without it.
    const after = run([
      ...lines,
      "300.0 Net [Info]: MatchingService::LeaveSquad",
      ...lines.slice(2, 3),
    ]);
    expect(after.starts[1].accountIds).toEqual([]);
  });

  it("reads both ids off a host's reward lines", () => {
    const { accounts } = run([
      "10.0 Game [Info]: OnStateStarted, mission type=MT_VOID_CASCADE",
      "20.0 Sys [Info]: VoidProjections: Host got reward info from 5b9b0220f2f2eb3a7c067544",
      "20.1 Sys [Info]: VoidProjections: Host sending reward info for 5b9b0220f2f2eb3a7c067544 to 66ccde192a203d71870a46e2",
    ]);
    expect(accounts).toEqual(["5b9b0220f2f2eb3a7c067544", "66ccde192a203d71870a46e2"]);
  });

  it("flags only the lines the parser reads", () => {
    expect(CLIENT.every((line) => isLevelCapLine(line) || line.includes("late join"))).toBe(true);
    expect(isLevelCapLine("12.0 Net [Info]: NAT bound for client")).toBe(false);
  });
});
