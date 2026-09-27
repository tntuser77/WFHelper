import { describe, expect, it } from "vitest";

import {
  cleanSquadRead,
  resolveSquadNames,
  squadNameDistance,
} from "../../services/levelCapSquadNames";

const read = (text: string, truncated = false) => ({ text, truncated });

describe("cleanSquadRead", () => {
  it("keeps a cut-off name's start and flags it", () => {
    expect(cleanSquadRead("WealthyPoe...2")).toEqual(read("WealthyPoe", true));
    expect(cleanSquadRead("nolimitreap... o")).toEqual(read("nolimitreap", true));
  });

  it("drops a platform icon read as a trailing word", () => {
    expect(cleanSquadRead("Frozenos ne")).toEqual(read("Frozenos"));
    expect(cleanSquadRead("Kemani o")).toEqual(read("Kemani"));
  });

  it("skips the companion line and noise", () => {
    expect(cleanSquadRead("Foxy [30]")).toBeNull();
    expect(cleanSquadRead(": :30810")).toBeNull();
    expect(cleanSquadRead("x")).toBeNull();
  });
});

describe("squadNameDistance", () => {
  it("compares a cut-off read on its start only", () => {
    expect(squadNameDistance(read("WealthyPoe", true), read("WealthyPoet"))).toBe(0);
    expect(squadNameDistance(read("Alaric.Saltz", true), read("Alaric.Saltzman"))).toBe(0);
  });

  it("forgives junk glued to the end and a misread letter", () => {
    expect(squadNameDistance(read("Frozenosmo"), read("Frozenos"))).toBe(0);
    expect(squadNameDistance(read("WealthyPpe"), read("WealthyPoet"))).toBeLessThan(0.25);
  });

  it("keeps different players apart", () => {
    expect(squadNameDistance(read("Kemani"), read("Frozenos"))).toBeGreaterThan(0.5);
    expect(squadNameDistance(read("abc"), read("abc"))).toBe(1);
  });
});

describe("resolveSquadNames", () => {
  it("snaps close reads to a known name, even a cut-off one", () => {
    const [run] = resolveSquadNames(
      [[["WealthyPpe.."], ["Alaric.Saltz... Q"]]],
      ["WealthyPoet", "Alaric.Saltzman"],
    );
    expect(run).toEqual({ players: ["WealthyPoet", "Alaric.Saltzman"], unknown: 0 });
  });

  it("tries every variant read of a row against known names", () => {
    const [run] = resolveSquadNames([[["W3a!thy", "WealthyPoe...2"]]], ["WealthyPoet"]);
    expect(run.players).toEqual(["WealthyPoet"]);
  });

  it("matches a known name whose first letters were lost", () => {
    const [run] = resolveSquadNames([[["yPoe...", "thyPoe..."]]], ["WealthyPoet"]);
    expect(run.players).toEqual(["WealthyPoet"]);
  });

  it("names a row by its cleanest read, keeping a misread letter mid-name", () => {
    const out = resolveSquadNames(
      [[["N UReSs", "NouRsSs"]], [["0NouRssa", "NouRsSs!"]], [["NouReSs o"]]],
      [],
    );
    expect(out.map((run) => run.players)).toEqual([["NouRsSs"], ["NouRsSs"], ["NouRsSs"]]);
  });

  it("names a player seen across runs by what the reads agree on", () => {
    const runs = [
      [["piova-777-82"], ["Pawcanale"]],
      [["piova-777-0"]],
      [["piova-777-@"], ["Frozenos ne"]],
      [["Frozenosmo"]],
    ];
    const out = resolveSquadNames(runs, []);
    expect(out.map((run) => run.players)).toEqual([
      ["piova-777"],
      ["piova-777"],
      ["piova-777", "Frozenos"],
      ["Frozenos"],
    ]);
    // A one-off stays unknown rather than getting a guessed name.
    expect(out[0].unknown).toBe(1);
  });

  it("marks a regular only ever seen cut off", () => {
    const out = resolveSquadNames([[["Testobruder..."]], [["Testobruder..0"]]], []);
    expect(out[0].players).toEqual(["Testobruder…"]);
  });
});
