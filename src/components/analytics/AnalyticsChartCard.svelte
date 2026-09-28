<script lang="ts">
  import { analyticsConditionText } from "../../lib/analytics/analyticsLabels.js";
  import type { AnalyticsChartSpec, AnalyticsResult } from "../../lib/analytics/runAnalytics.js";
  import { tr } from "../../lib/i18n.js";
  import ThemedPanel from "../ThemedPanel.svelte";
  import AnalyticsChart from "./AnalyticsChart.svelte";

  let {
    spec,
    result,
    title,
    index,
    onGrab,
    onGrabKey,
    onEdit,
    onRemove,
  }: {
    spec: AnalyticsChartSpec;
    result: AnalyticsResult;
    title: string;
    index: number;
    onGrab: (event: PointerEvent) => void;
    onGrabKey: (event: KeyboardEvent) => void;
    onEdit: () => void;
    onRemove: () => void;
  } = $props();
</script>

<div
  class={spec.wide ? "md:col-span-2" : ""}
  data-analytics-card={spec.id}
  data-analytics-index={index}
>
  <ThemedPanel className="flex h-full flex-col gap-3 p-4">
    <header class="flex items-start gap-2">
      <button
        type="button"
        class="mt-0.5 cursor-grab rounded border border-transparent p-0.5 text-text-muted hover:border-border hover:text-accent active:cursor-grabbing"
        aria-label={$tr("analytics.dragToMove")}
        title={$tr("analytics.dragToMove")}
        onpointerdown={onGrab}
        onkeydown={onGrabKey}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
          <circle cx="6" cy="4" r="1.3" />
          <circle cx="10" cy="4" r="1.3" />
          <circle cx="6" cy="8" r="1.3" />
          <circle cx="10" cy="8" r="1.3" />
          <circle cx="6" cy="12" r="1.3" />
          <circle cx="10" cy="12" r="1.3" />
        </svg>
      </button>
      <div class="flex min-w-0 flex-1 flex-col">
        <h3 class="m-0 truncate text-sm font-semibold text-text-heading">{title}</h3>
        {#if spec.squadConditions.length}
          <span class="truncate text-xs text-text-secondary" data-analytics-conditions
            >{spec.squadConditions.map((c) => analyticsConditionText(c, $tr)).join(" · ")}</span
          >
        {/if}
        {#if spec.chart !== "stat"}
          <span class="text-xs text-text-muted"
            >{$tr("analytics.runCount", { count: String(result.runCount) })}</span
          >
        {/if}
      </div>
      <div class="flex shrink-0 items-center gap-1 text-xs">
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-text-secondary hover:text-accent"
          onclick={onEdit}>{$tr("analytics.editChart")}</button
        >
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-lg leading-none text-text-muted hover:text-[var(--danger)]"
          aria-label={$tr("analytics.removeChart")}
          title={$tr("analytics.removeChart")}
          onclick={onRemove}>&times;</button
        >
      </div>
    </header>
    <AnalyticsChart {spec} {result} {title} />
  </ThemedPanel>
</div>
