<script lang="ts">
  import {
    analyticsConditionText,
    ANALYTICS_PLOT_PX,
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
    onGrab,
    onGrabKey,
    onEdit,
    onRemove,
    onResize,
  }: {
    spec: AnalyticsChartSpec;
    result: AnalyticsResult;
    title: string;
    onGrab: (event: PointerEvent) => void;
    onGrabKey: (event: KeyboardEvent) => void;
    onEdit: () => void;
    onRemove: () => void;
    onResize: (cols: AnalyticsCols, height: AnalyticsHeight) => void;
  } = $props();

  // Pixels of vertical drag between one height step and the next.
  const HEIGHT_STEP_PX = 90;

  let card = $state<HTMLDivElement | null>(null);
  // A resize under way: the free size the card follows the pointer at, and the
  // size it snaps to on release, drawn as a dashed outline underneath.
  let resizing = $state<{
    width: number;
    height: number;
    rowHeight: number;
    cols: AnalyticsCols;
    snapped: AnalyticsHeight;
    snapWidth: number;
    snapHeight: number;
    /** Past the right edge the card moves left to fit, and so does its outline. */
    snapLeft: number;
  } | null>(null);
  const shown = $derived(resizing ? { ...spec, height: resizing.snapped } : spec);

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
    const box = card.getBoundingClientRect();
    const startStep = ANALYTICS_HEIGHTS.indexOf(spec.height);
    const spanWidth = (cols: number) =>
      fourColumns ? cols * colWidth + (cols - 1) * gap : box.width;
    // The chart grows by its plot height; the rest of the card stays as it is.
    const heightFor = (h: AnalyticsHeight) =>
      box.height + ANALYTICS_PLOT_PX[h] - ANALYTICS_PLOT_PX[spec.height];

    const move = (e: PointerEvent) => {
      const width = clamp(box.width + e.clientX - event.clientX, colWidth * 0.6, grid.clientWidth);
      const height = Math.max(120, box.height + e.clientY - event.clientY);
      const cols = fourColumns
        ? (clamp(Math.round((width + gap) / (colWidth + gap)), 1, 4) as AnalyticsCols)
        : spec.cols;
      const snapped = heightAt(
        startStep + Math.round((e.clientY - event.clientY) / HEIGHT_STEP_PX),
      );
      resizing = {
        width,
        height,
        rowHeight: box.height,
        cols,
        snapped,
        snapWidth: spanWidth(cols),
        snapHeight: heightFor(snapped),
        snapLeft: fourColumns ? -Math.max(0, spec.col + cols - 4) * (colWidth + gap) : 0,
      };
    };
    const end = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      if (resizing && (resizing.cols !== spec.cols || resizing.snapped !== spec.height)) {
        onResize(resizing.cols, resizing.snapped);
      }
      resizing = null;
    };
    move(event);
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
  class="relative h-full"
  bind:this={card}
  style={resizing ? `height:${resizing.rowHeight}px` : undefined}
  data-analytics-card={spec.id}
  data-analytics-cols={resizing?.cols ?? spec.cols}
>
  {#if resizing}
    <!-- Where the card lands on release, drawn over it so a shrink shows too. -->
    <div
      class="pointer-events-none absolute left-0 top-0 z-30 rounded-[var(--radius-lg)] border-2 border-dashed border-accent bg-accent/5 transition-[left,width,height] duration-150"
      style="left:{resizing.snapLeft}px; width:{resizing.snapWidth}px; height:{resizing.snapHeight}px"
      data-analytics-snap
    ></div>
  {/if}
  <div
    class={resizing
      ? "absolute left-0 top-0 z-20 overflow-hidden rounded-[var(--radius-lg)] shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
      : "h-full"}
    style={resizing ? `width:${resizing.width}px; height:${resizing.height}px` : undefined}
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
      <AnalyticsChart spec={shown} {result} {title} />
    </ThemedPanel>
  </div>
  <!-- Drag to resize: sideways snaps to grid columns, up and down to the heights. -->
  <button
    type="button"
    style={resizing ? `left:${resizing.width - 22}px; top:${resizing.height - 22}px` : undefined}
    class="absolute z-40 cursor-nwse-resize {resizing
      ? ''
      : 'bottom-1 right-1'} rounded p-0.5 text-text-muted hover:text-accent"
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
  {#if resizing}
    <span
      class="pointer-events-none absolute z-40 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-on-accent)]"
      style="left:{resizing.width - 8}px; top:{resizing.height -
        8}px; transform:translate(-100%, -100%)"
      >{$tr(WIDTH_LABEL[resizing.cols])} · {$tr(HEIGHT_LABEL[resizing.snapped])}</span
    >
  {/if}
</div>
