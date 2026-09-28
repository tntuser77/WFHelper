<script lang="ts">
  import {
    analyticsConditionText,
    HEIGHT_LABEL,
    WIDTH_LABEL,
  } from "../../lib/analytics/analyticsLabels.js";
  import {
    ANALYTICS_HEIGHTS,
    type AnalyticsChartSpec,
    type AnalyticsCols,
    type AnalyticsHeight,
    type AnalyticsResult,
  } from "../../lib/analytics/runAnalytics.js";
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
    onResize,
  }: {
    spec: AnalyticsChartSpec;
    result: AnalyticsResult;
    title: string;
    index: number;
    onGrab: (event: PointerEvent) => void;
    onGrabKey: (event: KeyboardEvent) => void;
    onEdit: () => void;
    onRemove: () => void;
    onResize: (cols: AnalyticsCols, height: AnalyticsHeight) => void;
  } = $props();

  // Static class names, so the stylesheet keeps all four spans.
  const SPAN: Record<AnalyticsCols, string> = {
    1: "md:col-span-1",
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
  };
  // Pixels of vertical drag between one height step and the next.
  const HEIGHT_STEP_PX = 90;

  let card = $state<HTMLDivElement | null>(null);
  // The size shown while a resize is under way; saved when the pointer lets go.
  let live = $state<{ cols: AnalyticsCols; height: AnalyticsHeight } | null>(null);
  const cols = $derived(live?.cols ?? spec.cols);
  const height = $derived(live?.height ?? spec.height);
  const shown = $derived(live ? { ...spec, height: live.height } : spec);

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const heightAt = (i: number) => ANALYTICS_HEIGHTS[clamp(i, 0, ANALYTICS_HEIGHTS.length - 1)];

  function onResizeStart(event: PointerEvent): void {
    if (event.button !== 0 || !card) return;
    const grid = card.closest<HTMLElement>("[data-analytics-grid]");
    if (!grid) return;
    event.preventDefault();
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.columnGap) || 0;
    // A narrow window stacks the cards, and then only the height can change.
    const fourColumns = style.gridTemplateColumns.split(" ").length === 4;
    const colWidth = (grid.clientWidth - 3 * gap) / 4;
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: card.getBoundingClientRect().width,
      height: ANALYTICS_HEIGHTS.indexOf(spec.height),
    };
    live = { cols: spec.cols, height: spec.height };

    const move = (e: PointerEvent) => {
      const width = start.width + e.clientX - start.x;
      live = {
        cols: fourColumns
          ? (clamp(Math.round((width + gap) / (colWidth + gap)), 1, 4) as AnalyticsCols)
          : spec.cols,
        height: heightAt(start.height + Math.round((e.clientY - start.y) / HEIGHT_STEP_PX)),
      };
    };
    const end = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      if (live && (live.cols !== spec.cols || live.height !== spec.height)) {
        onResize(live.cols, live.height);
      }
      live = null;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  }

  function onResizeKey(event: KeyboardEvent): void {
    const h = ANALYTICS_HEIGHTS.indexOf(spec.height);
    const next =
      event.key === "ArrowLeft"
        ? { cols: clamp(spec.cols - 1, 1, 4) as AnalyticsCols, height: spec.height }
        : event.key === "ArrowRight"
          ? { cols: clamp(spec.cols + 1, 1, 4) as AnalyticsCols, height: spec.height }
          : event.key === "ArrowUp"
            ? { cols: spec.cols, height: heightAt(h - 1) }
            : event.key === "ArrowDown"
              ? { cols: spec.cols, height: heightAt(h + 1) }
              : null;
    if (!next) return;
    event.preventDefault();
    if (next.cols !== spec.cols || next.height !== spec.height) onResize(next.cols, next.height);
  }
</script>

<div
  class="relative {SPAN[cols]}"
  bind:this={card}
  data-analytics-card={spec.id}
  data-analytics-index={index}
  data-analytics-cols={cols}
>
  <ThemedPanel
    className="flex h-full flex-col gap-3 p-4 {live ? 'outline outline-2 outline-accent' : ''}"
  >
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
    <AnalyticsChart spec={shown} {result} {title} />
  </ThemedPanel>
  <!-- Drag to resize: sideways snaps to grid columns, up and down to the heights. -->
  <button
    type="button"
    class="absolute bottom-1 right-1 cursor-nwse-resize rounded p-0.5 text-text-muted hover:text-accent"
    aria-label={$tr("analytics.resize")}
    title={$tr("analytics.resize")}
    onpointerdown={onResizeStart}
    onkeydown={onResizeKey}
    data-analytics-resize
  >
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M11 4 4 11M11 8 8 11"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  </button>
  {#if live}
    <span
      class="pointer-events-none absolute bottom-2 right-7 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-on-accent)]"
      >{$tr(WIDTH_LABEL[cols])} · {$tr(HEIGHT_LABEL[height])}</span
    >
  {/if}
</div>
