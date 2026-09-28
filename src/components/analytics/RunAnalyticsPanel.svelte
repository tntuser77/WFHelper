<script lang="ts">
  import { onMount } from "svelte";
  import { flip } from "svelte/animate";

  import { analyticsTitle } from "../../lib/analytics/analyticsLabels.js";
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
    moveAnalyticsChart,
    newChartDraft,
    removeAnalyticsChart,
    resetAnalyticsCharts,
    setAnalyticsOrder,
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

  // Static class names, so the stylesheet keeps all four spans.
  const SPAN = {
    1: "md:col-span-1",
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
  } as const;
  // Cards slide into place for this long; no reorder is tried until they settle.
  const REFLOW_MS = 200;
  // How far ahead of the held card's centre a sideways swap is checked: a share
  // of its width, capped so a wide card does not swap from far off.
  const SWAP_LEAD = 0.2;
  const SWAP_LEAD_MAX_PX = 96;
  const SWAP_TURN_PX = 24;

  let grid = $state<HTMLDivElement | null>(null);
  // A card being moved: where the pointer is, where it grabbed the card, and the
  // order the grid shows while it is held. Nothing is saved until it is dropped.
  let moving = $state<{
    id: string;
    x: number;
    y: number;
    offX: number;
    offY: number;
    width: number;
    height: number;
  } | null>(null);
  let order = $state<string[] | null>(null);
  const shownCards = $derived(
    order ? order.flatMap((id) => cards.find((c) => c.spec.id === id) ?? []) : cards,
  );
  const movingCard = $derived(moving ? cards.find((c) => c.spec.id === moving!.id) : undefined);

  function startMove(id: string, event: PointerEvent): void {
    if (event.button !== 0) return;
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
      height: box.height,
    };
    const start = cards.map((c) => c.spec.id);
    order = start;
    let settledAt = 0;
    let swappedWith: string | null = null;
    let swappedHeading = 0;
    // Which way the card is heading sideways. It only turns once the card comes
    // back SWAP_TURN_PX from the furthest point, so a wobble does not swing the
    // look-ahead from one side of the card to the other.
    let turnX = event.clientX;
    let headingX = 0;

    const move = (e: PointerEvent) => {
      if (!moving || !order) return;
      moving = { ...moving, x: e.clientX, y: e.clientY };
      const pastTurn = (e.clientX - turnX) * headingX;
      if (headingX === 0 ? Math.abs(e.clientX - turnX) >= 3 : pastTurn < -SWAP_TURN_PX) {
        headingX = Math.sign(e.clientX - turnX);
        turnX = e.clientX;
      } else if (pastTurn > 0) {
        turnX = e.clientX;
      }
      if (performance.now() < settledAt) return;
      // The held card's centre decides, not the pointer, so where it was grabbed
      // does not change how far it has to travel. It looks a little ahead of the
      // centre the way the card is going, so a swap comes when the hand expects it.
      const lead = headingX * Math.min(moving.width * SWAP_LEAD, SWAP_LEAD_MAX_PX);
      const cx = e.clientX - moving.offX + moving.width / 2 + lead;
      const cy = e.clientY - moving.offY + moving.height / 2;
      const over = document.elementFromPoint(cx, cy)?.closest<HTMLElement>("[data-analytics-slot]");
      const target = over?.dataset.analyticsSlot;
      // A card that just traded places may still sit under the centre. It only
      // trades back once the card turns around, reaches its own slot, or meets
      // another card; the gap between cards does not count, or the two would
      // swap back and forth on the way across it.
      if (!over || !target) return;
      if (target === moving.id) {
        swappedWith = null;
        return;
      }
      if (target === swappedWith && headingX === swappedHeading) return;
      // A card spanning most of a row splits top and bottom at its middle. A card
      // beside it trades places as soon as the centre reaches it.
      const box = over.getBoundingClientRect();
      const rowWide = box.width > (grid?.clientWidth ?? 0) * 0.6;
      const after = rowWide
        ? cy > box.top + box.height / 2
        : order.indexOf(target) > order.indexOf(moving.id);
      const rest = order.filter((cardId) => cardId !== moving!.id);
      const at = rest.indexOf(target) + (after ? 1 : 0);
      const next = [...rest.slice(0, at), moving.id, ...rest.slice(at)];
      if (next.join() === order.join()) return;
      order = next;
      swappedWith = rowWide ? null : target;
      swappedHeading = headingX;
      settledAt = performance.now() + REFLOW_MS;
    };
    const end = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      if (order && order.join() !== start.join()) setAnalyticsOrder(order);
      moving = null;
      order = null;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  }

  function keyMove(index: number, event: KeyboardEvent): void {
    const step =
      event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowDown" || event.key === "ArrowRight"
          ? 1
          : 0;
    if (!step) return;
    event.preventDefault();
    moveAnalyticsChart(index, index + step);
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
    {#each shownCards as card, index (card.spec.id)}
      {@const lifted = moving?.id === card.spec.id}
      <!-- self-start: a card is as tall as its own chart, not its row's tallest. -->
      <div
        class="{SPAN[card.spec.cols]} self-start {lifted
          ? 'rounded-[var(--radius-lg)] outline-dashed outline-2 outline-accent'
          : ''}"
        data-analytics-slot={card.spec.id}
        animate:flip={{ duration: REFLOW_MS }}
      >
        <!-- The moved card's own slot stays as a faint gap where it will land. -->
        <div class="h-full {lifted ? 'opacity-20' : ''}">
          <AnalyticsChartCard
            spec={card.spec}
            result={card.result}
            title={card.title}
            onGrab={(e) => startMove(card.spec.id, e)}
            onGrabKey={(e) => keyMove(index, e)}
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
