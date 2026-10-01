import { get } from "svelte/store";

import { itemDb, wfmItems } from "../stores/data.js";
import { getCachedMedian } from "../stores/hydration/hydrationCacheHelpers.js";
import { inventorySafetyContext } from "../stores/inventorySafety.js";
import { missionRelicPool } from "../stores/missionRelicPool.js";
import { relicDb } from "../stores/relics.js";
import { buildMissionPool } from "./missionRelicPool.js";
import type { RewardRowSources } from "./missionRewardRows.js";

/** The sources a mission is valued from, with the relic pool as it stands. */
export function missionRowSources(): RewardRowSources {
  const relics = get(relicDb);
  return {
    db: get(itemDb),
    lookup: get(wfmItems),
    relics,
    priceOf: getCachedMedian,
    pool: buildMissionPool(
      relics,
      get(missionRelicPool),
      getCachedMedian,
      get(inventorySafetyContext).ownedCounts,
    ),
  };
}
