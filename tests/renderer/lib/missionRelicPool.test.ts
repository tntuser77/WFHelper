import { describe, expect, it } from "vitest";

import {
  buildRelicPoolRows,
  defaultRelicPool,
  filterRelicPoolRows,
  inRelicPool,
  normalizeRelicPool,
  resurgenceRelicKeys,
  setRelicsInPool,
} from "../../../src/lib/missionRelicPool.js";
import type { ItemDbEntry } from "../../../src/types/inventory.js";
import type { RelicDatabase, RelicGroup, RelicReward } from "../../../src/types/relics.js";

const RECIPES = "/Lotus/Types/Recipes/WarframeRecipes";
const BANSHEE = "/Lotus/Powersuits/Banshee/BansheePrime";

function reward(name: string, rarity: string, uniqueName?: string): RelicReward {
  return {
    name,
    rarity,
    chance: rarity === "Rare" ? 2 : 25,
    urlName: name.toLowerCase().replace(/ /g, "_"),
    uniqueName: uniqueName ?? null,
    ducats: null,
  };
}

function group(key: string, name: string, rewards: RelicReward[], vaulted = false): RelicGroup {
  return {
    key,
    name,
    tier: name.split(" ")[0],
    code: name.split(" ")[1],
    vaulted,
    imageUrl: null,
    qualities: { intact: { uniqueName: `/Lotus/Relics/${key}`, rewards } },
  };
}

const RELICS: RelicDatabase = {
  groups: {
    axi_h5: group("axi_h5", "Axi H5", [
      reward("Banshee Prime Blueprint", "Common", `${RECIPES}/BansheePrimeBlueprint`),
      reward("Cheap Gold", "Rare"),
    ]),
    meso_e5: group("meso_e5", "Meso E5", [reward("Pricey Gold", "Rare")], true),
    lith_x1: group("lith_x1", "Lith X1", [reward("Unpriced Gold", "Rare")]),
  },
  byUniqueName: { "/Lotus/Relics/lith_x1": { groupKey: "lith_x1", quality: "intact" } },
};

const PRICES: Record<string, number> = { cheap_gold: 12, pricey_gold: 80 };
const goldOf = (slug: string): number | null => PRICES[slug] ?? null;

describe("mission relic pool", () => {
  it("takes relics by the gold rule and lets hand picks override it", () => {
    const settings = defaultRelicPool();
    expect(inRelicPool("meso_e5", 80, settings)).toBe(true);
    expect(inRelicPool("axi_h5", 12, settings)).toBe(false);
    expect(inRelicPool("lith_x1", null, settings)).toBe(false);

    const picked = setRelicsInPool(settings, [{ key: "axi_h5", gold: 12 }], true);
    expect(picked.added).toEqual(["axi_h5"]);
    expect(inRelicPool("axi_h5", 12, picked)).toBe(true);

    const dropped = setRelicsInPool(picked, [{ key: "meso_e5", gold: 80 }], false);
    expect(dropped.removed).toEqual(["meso_e5"]);
    expect(inRelicPool("meso_e5", 80, dropped)).toBe(false);
  });

  it("stores nothing for a choice the rule already makes", () => {
    const picked = setRelicsInPool(defaultRelicPool(), [{ key: "axi_h5", gold: 12 }], true);
    const back = setRelicsInPool(
      picked,
      [
        { key: "axi_h5", gold: 12 },
        { key: "meso_e5", gold: 80 },
      ],
      false,
    );
    expect(back).toMatchObject({ added: [], removed: ["meso_e5"] });
    expect(setRelicsInPool(back, [{ key: "meso_e5", gold: 80 }], true).removed).toEqual([]);
  });

  it("revives stored settings and falls back on anything malformed", () => {
    expect(normalizeRelicPool(null)).toEqual(defaultRelicPool());
    expect(normalizeRelicPool({ goldAtLeast: null, added: ["a", 3, "a"], removed: "x" })).toEqual({
      goldAtLeast: null,
      added: ["a"],
      removed: [],
    });
    expect(normalizeRelicPool({ goldAtLeast: -4, added: ["a"], removed: ["a"] })).toEqual({
      goldAtLeast: 37,
      added: [],
      removed: ["a"],
    });
  });

  it("lists every relic, priciest gold part first, and filters the list", () => {
    const rows = buildRelicPoolRows(RELICS, defaultRelicPool(), goldOf, new Set(["axi_h5"]));
    expect(rows.map((row) => [row.key, row.gold, row.inPool])).toEqual([
      ["meso_e5", 80, true],
      ["axi_h5", 12, false],
      ["lith_x1", null, false],
    ]);
    expect(rows[0]).toMatchObject({ vaulted: true, goldName: "Pricey Gold", resurgence: false });

    const filter = { search: "", goldAtLeast: null, resurgenceOnly: false };
    expect(filterRelicPoolRows(rows, { ...filter, goldAtLeast: 10 })).toHaveLength(2);
    expect(filterRelicPoolRows(rows, { ...filter, resurgenceOnly: true })[0]?.key).toBe("axi_h5");
    expect(filterRelicPoolRows(rows, { ...filter, search: "lith" })[0]?.key).toBe("lith_x1");
    expect(filterRelicPoolRows(rows, { ...filter, search: "pricey" })[0]?.key).toBe("meso_e5");
    expect(buildRelicPoolRows(null, defaultRelicPool(), goldOf, new Set())).toEqual([]);
  });

  it("finds the resurgence relics Varzia sells and the ones dropping her frames' parts", () => {
    const db: Record<string, ItemDbEntry> = {
      [BANSHEE]: {
        name: "Banshee Prime",
        imageUrl: null,
        components: [
          { name: "Blueprint", uniqueName: `${RECIPES}/BansheePrimeBlueprint` },
          { name: "Chassis", uniqueName: `${RECIPES}/BansheePrimeChassisComponent` },
        ],
      },
    };
    expect([...resurgenceRelicKeys(RELICS, [BANSHEE], db)]).toEqual(["axi_h5"]);
    expect([...resurgenceRelicKeys(RELICS, ["/Lotus/Relics/lith_x1"], db)]).toEqual(["lith_x1"]);
    expect(resurgenceRelicKeys(RELICS, [], db).size).toBe(0);
  });
});
