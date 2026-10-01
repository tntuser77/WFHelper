/** What a reward is expected to fetch: sold as it is, or held until its set is complete. */
export type ValuationSale = "now" | "held";

/** One reward line as valued when it was frozen. */
export interface FrozenItem {
  uniqueName: string;
  /** Platinum for the whole count, rounded; 0 when the reward was worth no trade. */
  platinum: number;
  sale: ValuationSale | null;
}

/** A mission's estimate, written once and never re-priced. */
export interface MissionValuation {
  /** When the prices were read. */
  at: number;
  /** The relic pool's gold line in force, or null when the rule was off. */
  goldAtLeast: number | null;
  items: FrozenItem[];
}

export interface EstimateTotals {
  sellNow: number;
  held: number;
  /** Missions frozen. */
  missions: number;
}

export const MAX_VALUATION_ITEMS = 5_000;
