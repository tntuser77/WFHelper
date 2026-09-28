<script lang="ts">
  import {
    analyticsKeyLabel,
    formatAnalyticsValue,
    MEASURE_LABEL,
    SPLIT_LABEL,
  } from "../../lib/analytics/analyticsLabels.js";
  import {
    ANALYTICS_OTHER,
    analyticsMeasureAddsUp,
    type AnalyticsChartSpec,
    type AnalyticsResult,
  } from "../../lib/analytics/runAnalytics.js";
  import { locale, tr as t } from "../../lib/i18n.js";
  import AnalyticsColumns from "./AnalyticsColumns.svelte";
  import AnalyticsPie from "./AnalyticsPie.svelte";
  import AnalyticsTooltip from "./AnalyticsTooltip.svelte";

  let {
    spec,
    result,
    title,
    asTable = false,
  }: {
    spec: AnalyticsChartSpec;
    result: AnalyticsResult;
    title: string;
    asTable?: boolean;
  } = $props();

  // Theme chart tokens in the order that keeps neighbours furthest apart for
  // colour-blind readers; "Other" always takes the muted ink.
  const SERIES_COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-5)",
    "var(--chart-3)",
    "var(--chart-6)",
    "var(--chart-4)",
  ];
  const OTHER_COLOR = "var(--text-muted)";

  const colors = $derived(
    result.series.map((key, i) => (key === ANALYTICS_OTHER ? OTHER_COLOR : SERIES_COLORS[i])),
  );
  const categoryLabels = $derived(
    result.categories.map((key) => analyticsKeyLabel(key, spec.splitBy, $t, $locale)),
  );
  const shortLabels = $derived(
    result.categories.map((key, c) =>
      analyticsKeyLabel(key, spec.splitBy, $t, $locale, true, c === 0),
    ),
  );
  const seriesLabels = $derived(
    result.series.map((key) => analyticsKeyLabel(key, spec.seriesBy, $t, $locale)),
  );
  const format = (value: number | null) => formatAnalyticsValue(value, spec.measure, $locale);
  const multi = $derived(result.series.length > 1);
  const kind = $derived(asTable ? "table" : spec.chart);

  // Ranked bars: one row per category, longest first. "Other" lumps many
  // together, so it keeps its number but draws no bar and sets no scale.
  const rankedPeak = $derived(
    Math.max(
      0,
      ...result.values[0].map((v, c) => (result.categories[c] === ANALYTICS_OTHER ? 0 : (v ?? 0))),
    ),
  );
  let rankedHover = $state<{ index: number; x: number; y: number } | null>(null);
</script>

{#if result.runCount === 0}
  <p class="py-8 text-center text-sm text-text-muted">{$t("analytics.noRuns")}</p>
{:else if kind === "stat"}
  <div class="flex flex-col items-start gap-1 py-4">
    <span class="font-display text-4xl text-text-heading">{format(result.total)}</span>
    <span class="text-xs text-text-muted"
      >{$t("analytics.runCount", { count: String(result.runCount) })}</span
    >
  </div>
{:else if kind === "table"}
  <div class="max-h-[260px] overflow-auto">
    <table class="w-full text-xs">
      <thead class="sticky top-0 bg-[var(--ui-panel-bg)] text-text-secondary">
        <tr>
          <th class="py-1 pr-3 text-left font-semibold">{$t(SPLIT_LABEL[spec.splitBy])}</th>
          {#each seriesLabels as label, s (s)}
            <th class="py-1 pl-3 text-right font-semibold"
              >{multi ? label : $t(MEASURE_LABEL[spec.measure])}</th
            >
          {/each}
          {#if multi}
            <th class="py-1 pl-3 text-right font-semibold">{$t("common.total")}</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each result.categories as category, c (category)}
          <tr class="border-t border-border-subtle">
            <td class="py-1 pr-3 text-text-primary">{categoryLabels[c]}</td>
            {#each result.values as row, s (s)}
              <td class="py-1 pl-3 text-right font-mono text-text-primary">{format(row[c])}</td>
            {/each}
            {#if multi}
              <td class="py-1 pl-3 text-right font-mono text-text-primary"
                >{format(result.totals[c])}</td
              >
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if kind === "pie" || kind === "donut"}
  <AnalyticsPie
    values={result.values[0]}
    labels={categoryLabels}
    colors={result.categories.map((key, i) =>
      key === ANALYTICS_OTHER ? OTHER_COLOR : SERIES_COLORS[i],
    )}
    donut={kind === "donut"}
    {title}
    {format}
  />
{:else if kind === "ranked"}
  <ul class="m-0 flex list-none flex-col gap-1 p-0">
    {#each result.categories as category, c (category)}
      {@const value = result.values[0][c]}
      <li
        class="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-sm)] px-1 text-xs {rankedHover?.index ===
        c
          ? 'bg-[var(--surface-hover)]'
          : ''}"
        onpointerenter={(e) => (rankedHover = { index: c, x: e.clientX, y: e.clientY })}
        onpointermove={(e) => (rankedHover = { index: c, x: e.clientX, y: e.clientY })}
        onpointerleave={() => (rankedHover = null)}
      >
        <span class="truncate py-1 text-text-secondary" title={categoryLabels[c]}
          >{categoryLabels[c]}</span
        >
        <span class="block h-3">
          {#if value && rankedPeak > 0 && category !== ANALYTICS_OTHER}
            <span
              class="block h-full rounded-r-[4px]"
              style="width:{Math.max(
                1,
                (value / rankedPeak) * 100,
              )}%; background:{SERIES_COLORS[0]}"
            ></span>
          {/if}
        </span>
        <span
          class="min-w-[2.5rem] text-right font-mono {category === ANALYTICS_OTHER
            ? 'text-text-muted'
            : 'text-text-primary'}">{format(value)}</span
        >
      </li>
    {/each}
  </ul>
  {#if rankedHover}
    {@const c = rankedHover.index}
    <AnalyticsTooltip x={rankedHover.x} y={rankedHover.y}>
      <div class="font-semibold text-text-primary">{categoryLabels[c]}</div>
      <div class="flex gap-3">
        <span class="text-text-secondary">{$t(MEASURE_LABEL[spec.measure])}</span>
        <span class="ml-auto font-mono text-text-primary">{format(result.values[0][c])}</span>
      </div>
    </AnalyticsTooltip>
  {/if}
{:else}
  {#if multi}
    <ul class="m-0 mb-2 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs">
      {#each seriesLabels as label, s (s)}
        <li class="flex items-center gap-1.5 text-text-secondary">
          <span class="h-2.5 w-2.5 rounded-sm" style="background:{colors[s]}"></span>
          {label}
        </li>
      {/each}
    </ul>
  {/if}
  <AnalyticsColumns
    {result}
    kind={kind === "line" ? "line" : "columns"}
    stacked={analyticsMeasureAddsUp(spec.measure)}
    whole={spec.measure !== "exolizersAvg" && spec.measure !== "durationAvg"}
    {title}
    {categoryLabels}
    {shortLabels}
    {seriesLabels}
    {colors}
    {format}
  />
{/if}
