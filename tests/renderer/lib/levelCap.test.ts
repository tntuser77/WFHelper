import { describe, expect, it } from "vitest";

import type {
  LevelCapBuild,
  LevelCapItem,
  LevelCapRun,
} from "../../../config/shared/levelCapTypes.js";
import {
  levelCapBuildKey,
  nextLevelCapBuildName,
  normalizeLevelCapBuild,
} from "../../../config/shared/levelCapBuild.js";
import {
  formatLevelCapDuration,
  levelCapFrames,
  levelCapSearchTerms,
  levelCapSlotLayout,
  levelCapTagSuggestions,
  levelCapUpgradeRole,
  orderLevelCapTags,
  toggleLevelCapSearchTag,
} from "../../../src/lib/levelCap.js";
import { underframeUrl } from "../../../src/lib/underframe.js";

const SUIT: LevelCapItem = {
  kind: "suit",
  type: "/Lotus/Powersuits/Pagemaster/Pagemaster",
  config: 0,
  upgrades: [
    { slot: 0, type: "/Mods/Intensify", rank: 5 },
    { slot: 8, type: "/Mods/Aura/CorrosiveProjection", rank: 5 },
    { slot: 9, type: "/Mods/Exilus/Sure", rank: 10 },
    { slot: 10, type: "/Lotus/Upgrades/CosmeticEnhancers/Offensive/Molt", rank: 5 },
  ],
  helminth: { ability: "/Rot", index: 3 },
};

function build(suit: LevelCapItem | null): LevelCapBuild {
  return {
    suit,
    primary: null,
    secondary: null,
    melee: null,
    archgun: null,
    companion: null,
    focus: "zenurik",
  };
}

function run(id: string, frame: string, at: number, extra: Partial<LevelCapRun> = {}): LevelCapRun {
  return {
    id,
    completedAt: at,
    frame,
    frameType: null,
    source: "hotkey",
    exolizers: 108,
    durationSec: null,
    squadSize: null,
    tile: null,
    archgunUsed: false,
    build: null,
    screenshot: null,
    ...extra,
  };
}

describe("levelCap helpers", () => {
  it("lists frames most-run first and counts unverified runs", () => {
    const rows = levelCapFrames([
      run("1", "Dante", 1),
      run("2", "Cyte-09", 2, { buildUnverified: true }),
      run("3", "Dante", 3),
    ]);
    expect(rows.map((r) => [r.frame, r.count, r.unverified])).toEqual([
      ["Dante", 2, 0],
      ["Cyte-09", 1, 1],
    ]);
  });

  it("treats builds that differ only in mod ranks as the same build", () => {
    const reranked = { ...SUIT, upgrades: SUIT.upgrades.map((u) => ({ ...u, rank: 0 })) };
    const other = { ...SUIT, upgrades: [] };
    expect(levelCapBuildKey(build(reranked))).toBe(levelCapBuildKey(build(SUIT)));
    expect(levelCapBuildKey(build(other))).not.toBe(levelCapBuildKey(build(SUIT)));
  });

  it("keeps riven stats and repairs a doubled weapon name", () => {
    const riven = (name: string) => ({
      name,
      stats: [{ name: "Toxin", value: 154.1, positive: true, multiplier: false }],
    });
    const withRiven = (name: string) =>
      normalizeLevelCapBuild({
        ...build(null),
        melee: {
          type: "/Melee/Magistar",
          upgrades: [{ slot: 1, type: "/Mods/Randomized/X", rank: 8, riven: riven(name) }],
        },
      })?.melee?.upgrades[0].riven;
    expect(withRiven("Magistar Magistar Toxicron")).toEqual(riven("Magistar Toxicron"));
    expect(withRiven("Dark Split-Sword Dark Split-Sword Acri")?.name).toBe("Dark Split-Sword Acri");
    expect(withRiven("Magistar Toxicron")?.name).toBe("Magistar Toxicron");
  });

  it("names a new build with the first free letter", () => {
    expect(nextLevelCapBuildName([])).toBe("Build A");
    expect(nextLevelCapBuildName(["Build A", "caster", "build c"])).toBe("Build B");
  });

  it("lays out a frame's mod, aura, exilus and arcane slots", () => {
    const layout = levelCapSlotLayout("suit", SUIT);
    expect(layout).toHaveLength(12);
    expect(layout.slice(8).map((s) => s.role)).toEqual(["aura", "exilus", "arcane", "arcane"]);
    expect(layout[8].compat).toEqual(["AURA"]);
    expect(layout[0].compat).toEqual(["WARFRAME"]);
    expect(levelCapSlotLayout("melee", null)[8].compat).toEqual(["STANCE"]);
  });

  it("suggests tags by how often they are used", () => {
    expect(
      levelCapTagSuggestions([
        run("1", "Dante", 1, { tags: ["caster", "comfy"] }),
        run("2", "Dante", 2, { tags: ["Caster"] }),
      ]),
    ).toEqual(["caster", "comfy"]);
  });

  it("formats durations with hours only when needed", () => {
    expect(formatLevelCapDuration(4212)).toBe("1:10:12");
    expect(formatLevelCapDuration(75)).toBe("1:15");
    expect(formatLevelCapDuration(null)).toBe("");
  });

  it("reads slot roles from the game layout", () => {
    expect(levelCapUpgradeRole("suit", SUIT.upgrades[1])).toBe("aura");
    expect(levelCapUpgradeRole("suit", SUIT.upgrades[2])).toBe("exilus");
    expect(levelCapUpgradeRole("suit", SUIT.upgrades[3])).toBe("arcane");
    expect(
      levelCapUpgradeRole("melee", {
        slot: 8,
        type: "/Lotus/Weapons/Tenno/Melee/MeleeTrees/X",
        rank: 3,
      }),
    ).toBe("stance");
    expect(levelCapUpgradeRole("primary", { slot: 8, type: "/Mods/Vigilante", rank: 5 })).toBe(
      "exilus",
    );
  });
});

describe("underframeUrl", () => {
  const names: Record<string, string> = {
    [SUIT.type]: "Dante",
    "/Mods/Intensify": "Intensify",
    "/Mods/Aura/CorrosiveProjection": "Corrosive Projection",
    "/Mods/Exilus/Sure": "Primed Sure Footed",
    "/Lotus/Upgrades/CosmeticEnhancers/Offensive/Molt": "Molt Augmented",
  };
  const decode = (url: string) => {
    const token = url.split("#v4u.")[1];
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))),
    );
  };

  it("puts aura and exilus where Underframe expects them and splits out arcanes", () => {
    const url = underframeUrl(SUIT, (type) => names[type] ?? null, "Xata's Whisper");
    expect(url?.startsWith("https://www.underframe.site/share#v4u.")).toBe(true);
    const { v, b } = decode(url!);
    expect(v).toBe(1);
    expect(b.t).toBe("Warframe");
    expect(b.i).toBe("Dante");
    expect(b.m).toHaveLength(10);
    expect(b.m[0]).toEqual({ n: "Corrosive Projection", r: 5 });
    expect(b.m[1]).toEqual({ n: "Primed Sure Footed", r: 10 });
    expect(b.m[2]).toEqual({ n: "Intensify", r: 5 });
    expect(b.a).toEqual(["Molt Augmented"]);
    expect(b.h).toEqual(["Xata's Whisper", 3]);
  });

  it("returns null for companions and unknown items", () => {
    expect(underframeUrl({ ...SUIT, kind: "companion" }, () => "x")).toBeNull();
    expect(underframeUrl(SUIT, () => null)).toBeNull();
  });
});

describe("level cap search", () => {
  it("splits on commas and drops empty terms", () => {
    expect(levelCapSearchTerms(" Melee, Influence ,, ")).toEqual(["melee", "influence"]);
    expect(levelCapSearchTerms("")).toEqual([]);
  });

  it("toggles a tag in and out of the comma list", () => {
    expect(toggleLevelCapSearchTag("", "Melee")).toBe("Melee");
    expect(toggleLevelCapSearchTag("Melee", "Influence")).toBe("Melee, Influence");
    expect(toggleLevelCapSearchTag("melee, Influence", "Melee")).toBe("Influence");
  });
});

describe("orderLevelCapTags", () => {
  it("lists tags in the shared order, unknown ones last A-Z", () => {
    const order = ["Weapon Platform", "Secondary", "Vaz Dash"];
    expect(orderLevelCapTags(["vaz dash", "Zeta", "Secondary", "Alpha"], order)).toEqual([
      "Secondary",
      "vaz dash",
      "Alpha",
      "Zeta",
    ]);
  });
});
