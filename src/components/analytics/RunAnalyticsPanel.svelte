<script lang="ts">
  import { onMount } from "svelte";
  import { flip } from "svelte/animate";

  import { analyticsTitle } from "../../lib/analytics/analyticsLabels.js";
  import {
    DASHBOARD_COLS,
    layoutRowCount,
    placeInLayout,
    sortLayout,
    type LayoutBox,
  } from "../../lib/analytics/dashboardLayout.js";
  import {
    analyticsResult,
    analyticsSquadChoices,
    analyticsTagChoices,
    type AnalyticsChartSpec,
    type AnalyticsContext,
  } from "../../lib/analytics/runAnalytics.js";
  import { tr } from "../../lib/i18n.js";
  import { levelCapFrames, levelCapItemName } from "../../lib/levelCap.js";
  import { log } from "../../lib/log.js";
  import { itemDb } from "../../stores/data.js";
  import { levelCap, loadLevelCap } from "../../stores/levelCap.js";
  import {
    addAnalyticsChart,
    analyticsCharts,
    newChartDraft,
    nudgeAnalyticsChart,
    placeAnalyticsChart,
    removeAnalyticsChart,
    resetAnalyticsCharts,
    updateAnalyticsChart,
  } from "../../stores/runAnalytics.js";
  import ThemedButton from "../ThemedButton.svelte";
  import AnalyticsChartBuilder from "./AnalyticsChartBuilder.svelte";
  import AnalyticsChartCard from "./AnalyticsChartCard.svelte";
  import AnalyticsNameReview from "./AnalyticsNameReview.svelte";
  import { squadReviewCount } from "../../lib/analytics/squadNameReview.js";

  type Draft = Omit<AnalyticsChartSpec, "id"> & { id?: string };

  onMount(() => {
    void loadLevelCap().catch((err) => log.warn("[Analytics] load failed", String(err)));
  });

  const runs = $derived($levelCap?.runs ?? []);
  const ctx = $derived<AnalyticsContext>({
    builds: $levelCap?.builds ?? [],
    itemName: (item) => levelCapItemName(item, $itemDb),
    now: Date.now(),
  });
  const frames = $derived(levelCapFrames(runs).map((row) => row.frame));
  const squadChoices = $derived(analyticsSquadChoices(runs));
  const tagChoices = $derived(analyticsTagChoices(runs, $levelCap?.builds ?? []));
  const namesToReview = $derived(squadReviewCount(runs));
  let reviewingNames = $state(false);
  const cards = $derived(
    $analyticsCharts.map((spec) => ({
      spec,
      result: analyticsResult(runs, spec, ctx),
      title: analyticsTitle(spec, $tr),
    })),
  );

  let editing = $state<Draft | null>(null);

  // Cards slide into place for this long; no new spot is tried until they settle.
  const REFLOW_MS = 200;
  // How far below the held card's top edge decides which row it is over:
  // about its title, so a row is picked by where the card's header is.
  const ROW_PROBE_PX = 32;

  let grid = $state<HTMLDivElement | null>(null);
  // A card being moved: where the pointer is, and where it grabbed the card.
  let moving = $state<{
    id: string;
    x: number;
    y: number;
    offX: number;
    offY: number;
    width: number;
  } | null>(null);
  // Where every card would sit if the held one dropped now. Nothing is saved
  // until it does.
  let preview = $state<LayoutBox[] | null>(null);
  const shownCards = $derived.by(() => {
    if (!preview) return cards;
    const order = new Map(sortLayout(preview).map((b, i) => [b.id, i]));
    return [...cards].sort((a, b) => order.get(a.spec.id)! - order.get(b.spec.id)!);
  });
  const movingCard = $derived(moving ? cards.find((c) => c.spec.id === moving!.id) : undefined);

  const boxOf = (spec: AnalyticsChartSpec): LayoutBox => ({
    id: spec.id,
    row: spec.row,
    col: spec.col,
    cols: spec.cols,
  });

  /** The saved row under screen height `y`, or null over a gap between rows. The
   *  grid shows the preview, whose rows can differ from the saved ones, so a row
   *  is known by the other cards in it; a row holding only the held card keeps
   *  the current target. */
  function rowAt(
    y: number,
    start: readonly LayoutBox[],
    shown: readonly LayoutBox[],
    id: string,
    current: number,
  ): number | null {
    if (!grid) return null;
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.rowGap) || 0;
    const tracks = style.gridTemplateRows.split(" ").map((t) => parseFloat(t) || 0);
    let top = grid.getBoundingClientRect().top;
    for (let row = 0; row < tracks.length; row++) {
      const bottom = top + tracks[row];
      if (y < bottom + gap / 2) {
        const other = shown.find((b) => b.row === row && b.id !== id);
        return other ? start.find((b) => b.id === other.id)!.row : current;
      }
      top = bottom + gap;
    }
    // Below the last row: a row of its own at the bottom.
    return layoutRowCount(start);
  }

  function startMove(id: string, event: PointerEvent): void {
    if (event.button !== 0 || !grid) return;
    // A narrow window stacks every card in one column; the arrow keys still move
    // cards, but there is no grid on screen to drop one into.
    if (getComputedStyle(grid).gridTemplateColumns.split(" ").length !== DASHBOARD_COLS) return;
    const slot = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-analytics-slot]");
    if (!slot) return;
    event.preventDefault();
    const box = slot.getBoundingClientRect();
    moving = {
      id,
      x: event.clientX,
      y: event.clientY,
      offX: event.clientX - box.left,
      offY: event.clientY - box.top,
      width: box.width,
    };
    const start = cards.map((c) => boxOf(c.spec));
    const self = start.find((b) => b.id === id)!;
    let target = { row: self.row, col: self.col };
    preview = start;
    let settledAt = 0;

    const move = (e: PointerEvent) => {
      if (!moving || !preview || !grid) return;
      moving = { ...moving, x: e.clientX, y: e.clientY };
      if (performance.now() < settledAt) return;
      // The card's own left edge picks the column, rounded to the nearest one.
      const g = grid.getBoundingClientRect();
      const colGap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      const pitch = (g.width + colGap) / DASHBOARD_COLS;
      const col = Math.min(
        DASHBOARD_COLS - self.cols,
        Math.max(0, Math.round((e.clientX - moving.offX - g.left) / pitch)),
      );
      const row = rowAt(e.clientY - moving.offY + ROW_PROBE_PX, start, preview, id, target.row);
      if (row === null || (row === target.row && col === target.col)) return;
      target = { row, col };
      preview = row === self.row && col === self.col ? start : placeInLayout(start, id, row, col);
      settledAt = performance.now() + REFLOW_MS;
    };
    const end = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      if (target.row !== self.row || target.col !== self.col) {
        placeAnalyticsChart(id, target.row, target.col);
      }
      moving = null;
      preview = null;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  }

  function keyMove(id: string, event: KeyboardEvent): void {
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const by = step[event.key];
    if (!by) return;
    event.preventDefault();
    nudgeAnalyticsChart(id, by[0], by[1]);
  }

  // The lifted card floats above everything, clear of any containing panel.
  function toBody(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function save(draft: Draft): void {
    const { id, ...rest } = draft;
    if (id) updateAnalyticsChart({ ...rest, id });
    else addAnalyticsChart(rest);
    editing = null;
  }

  function reset(): void {
    if (window.confirm($tr("analytics.resetConfirm"))) resetAnalyticsCharts();
  }
</script>

<header class="view-header mb-0 items-end">
  <div class="flex flex-col gap-1">
    <h2>{$tr("common.analytics")}</h2>
    <p class="m-0 text-sm text-text-secondary">{$tr("analytics.subtitle")}</p>
  </div>
  <div class="flex items-center gap-2">
    {#if namesToReview}
      <ThemedButton onClick={() => (reviewingNames = true)}
        >{$tr("analytics.names.open", { count: String(namesToReview) })}</ThemedButton
      >
    {/if}
    <ThemedButton onClick={reset}>{$tr("analytics.resetCharts")}</ThemedButton>
    <ThemedButton active onClick={() => (editing = newChartDraft())}
      >{$tr("analytics.addChart")}</ThemedButton
    >
  </div>
</header>

{#if cards.length === 0}
  <p class="py-10 text-center text-sm text-text-muted">{$tr("analytics.empty")}</p>
{:else}
  <div
    class="grid grid-cols-1 gap-4 md:grid-cols-4"
    bind:this={grid}
    data-analytics-grid
    data-analytics-moving={moving ? "true" : undefined}
  >
    {#each shownCards as card (card.spec.id)}
      {@const lifted = moving?.id === card.spec.id}
      {@const at = preview?.find((b) => b.id === card.spec.id) ?? card.spec}
      <!-- self-start: a card is as tall as its own chart, not its row's tallest. -->
      <div
        class="analytics-slot self-start {lifted
          ? 'rounded-[var(--radius-lg)] outline-dashed outline-2 outline-accent'
          : ''}"
        style="--row:{at.row + 1}; --col:{at.col + 1}; --span:{card.spec.cols}"
        data-analytics-slot={card.spec.id}
        data-analytics-row={at.row}
        data-analytics-col={at.col}
        animate:flip={{ duration: REFLOW_MS }}
      >
        <!-- The moved card's own slot stays as a faint gap where it will land. -->
        <div class="h-full {lifted ? 'opacity-20' : ''}">
          <AnalyticsChartCard
            spec={card.spec}
            result={card.result}
            title={card.title}
            onGrab={(e) => startMove(card.spec.id, e)}
            onGrabKey={(e) => keyMove(card.spec.id, e)}
            onEdit={() => (editing = structuredClone(card.spec))}
            onRemove={() => removeAnalyticsChart(card.spec.id)}
            onResize={(cols, height) => updateAnalyticsChart({ ...card.spec, cols, height })}
          />
        </div>
      </div>
    {/each}
  </div>
  {#if moving && movingCard}
    <div
      use:toBody
      class="pointer-events-none fixed z-[900] rotate-1 opacity-95 shadow-[0_18px_50px_rgba(0,0,0,0.6)]"
      style="left:{moving.x - moving.offX}px; top:{moving.y -
        moving.offY}px; width:{moving.width}px"
      data-analytics-ghost
    >
      <AnalyticsChartCard
        spec={movingCard.spec}
        result={movingCard.result}
        title={movingCard.title}
        onGrab={() => {}}
        onGrabKey={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
        onResize={() => {}}
      />
    </div>
  {/if}
{/if}

{#if editing}
  <AnalyticsChartBuilder
    initial={editing}
    {runs}
    {ctx}
    {frames}
    squadFrames={squadChoices.frames}
    players={squadChoices.players}
    tags={tagChoices}
    onSave={save}
    onClose={() => (editing = null)}
  />
{/if}

{#if reviewingNames}
  <AnalyticsNameReview
    {runs}
    settings={$levelCap?.settings ?? null}
    frames={[...new Set([...squadChoices.frames, ...frames])]}
    onClose={() => (reviewingNames = false)}
  />
{/if}

<style>
  /* Four columns and up: every card at its own row and column, gaps allowed.
     Narrower, the grid is one column and the cards stack in reading order. */
  @media (min-width: 768px) {
    .analytics-slot {
      grid-row: var(--row);
      grid-column: var(--col) / span var(--span);
    }
  }
</style>
