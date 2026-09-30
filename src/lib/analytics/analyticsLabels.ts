import type { MessageKey, Translator } from "../i18n.js";
import { formatLevelCapDuration } from "../levelCap.js";
import {
  ANALYTICS_OTHER,
  ANALYTICS_SOLO,
  ANALYTICS_SQUAD,
  ANALYTICS_UNKNOWN,
  type AnalyticsChartKind,
  type AnalyticsChartSpec,
  type AnalyticsMeasure,
  type AnalyticsRange,
  type AnalyticsSplit,
  type AnalyticsSquadCondition,
  type AnalyticsSquadFilter,
} from "./runAnalytics.js";

export const MEASURE_LABEL: Record<AnalyticsMeasure, MessageKey> = {
  runs: "analytics.measure.runs",
  squadmates: "analytics.measure.squadmates",
  exolizersAvg: "analytics.measure.exolizersAvg",
  exolizersBest: "analytics.measure.exolizersBest",
  durationAvg: "analytics.measure.durationAvg",
  killsAvg: "analytics.measure.killsAvg",
  killsPerMin: "analytics.measure.killsPerMin",
};

export const SPLIT_LABEL: Record<AnalyticsSplit, MessageKey> = {
  week: "analytics.split.week",
  month: "analytics.split.month",
  frame: "analytics.split.frame",
  build: "analytics.split.build",
  tag: "arbi.filter.tag",
  primary: "profile.primaryWeapon",
  secondary: "profile.secondaryWeapon",
  melee: "rivens.type.melee",
  companion: "levelCap.build.companion",
  squadmate: "analytics.split.squadmate",
  squadmateFrame: "analytics.split.squadmateFrame",
  squad: "analytics.field.squad",
};

export const CHART_LABEL: Record<AnalyticsChartKind, MessageKey> = {
  columns: "analytics.chart.columns",
  line: "analytics.chart.line",
  ranked: "analytics.chart.ranked",
  stat: "analytics.chart.stat",
  table: "analytics.chart.table",
};

export const RANGE_LABEL: Record<AnalyticsRange, MessageKey> = {
  all: "analysis.range.all",
  "30d": "analytics.range.30d",
  "90d": "analytics.range.90d",
  "365d": "analytics.range.365d",
};

export const SQUAD_LABEL: Record<AnalyticsSquadFilter, MessageKey> = {
  all: "analytics.squad.all",
  solo: "analytics.squad.solo",
  squad: "analytics.squad.squad",
};

/** The card's own name when the user left the title empty. */
export function analyticsAutoTitle(spec: AnalyticsChartSpec, t: Translator): string {
  const measure = t(MEASURE_LABEL[spec.measure]);
  if (spec.chart === "stat") return measure;
  const split = t(SPLIT_LABEL[spec.splitBy]).toLowerCase();
  if (!spec.seriesBy) return t("analytics.autoTitle", { measure, split });
  const series = t(SPLIT_LABEL[spec.seriesBy]).toLowerCase();
  return t("analytics.autoTitleSeries", { measure, split, series });
}

export function analyticsTitle(spec: AnalyticsChartSpec, t: Translator): string {
  return spec.title || analyticsAutoTitle(spec, t);
}

/** A category or series key as the user reads it. */
export function analyticsKeyLabel(
  key: string,
  split: AnalyticsSplit | null,
  t: Translator,
  locale: string,
  short = false,
  first = false,
): string {
  if (key === ANALYTICS_OTHER) return t("arbi.type.other");
  if (key === ANALYTICS_UNKNOWN) return t("common.unknown");
  if (key === ANALYTICS_SOLO) return t("relics.squad.solo");
  if (key === ANALYTICS_SQUAD) return t("relics.squadLabel");
  if (split === "week") {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    });
    return short ? date : t("analytics.weekOf", { date });
  }
  if (split === "month") {
    const [y, m] = key.split("-").map(Number);
    // An axis names the year only where it starts or turns over.
    const withYear = !short || m === 1 || first;
    return new Date(y, m - 1, 1).toLocaleDateString(locale, {
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  }
  return key;
}

/** "With Titania not played by WealthyPoet", for the card's subtitle. */
export function analyticsConditionText(condition: AnalyticsSquadCondition, t: Translator): string {
  const frame = condition.frame ?? t("analytics.cond.anyone");
  let who = frame;
  if (condition.player !== null && !condition.notPlayer && condition.frame === null) {
    who = condition.player;
  } else if (condition.player !== null) {
    who = t(condition.notPlayer ? "analytics.cond.notBy" : "analytics.cond.by", {
      frame,
      player: condition.player,
    });
  }
  return t(condition.has ? "analytics.cond.with" : "analytics.cond.without", { who });
}

export function formatAnalyticsValue(
  value: number | null,
  measure: AnalyticsMeasure,
  locale: string,
): string {
  if (value === null) return "–";
  if (measure === "durationAvg") return formatLevelCapDuration(Math.round(value));
  const digits = measure === "exolizersAvg" || measure === "killsPerMin" ? 1 : 0;
  return value.toLocaleString(locale, { maximumFractionDigits: digits });
}
