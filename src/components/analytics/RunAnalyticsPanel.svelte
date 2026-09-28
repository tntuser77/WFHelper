<script lang="ts">
  import { onMount } from "svelte";

  import { analyticsTitle } from "../../lib/analytics/analyticsLabels.js";
  import {
    analyticsResult,
    analyticsSquadChoices,
    type AnalyticsChartSpec,
    type AnalyticsContext,
  } from "../../lib/analytics/runAnalytics.js";
  import { tr } from "../../lib/i18n.js";
  import { levelCapFrames, levelCapItemName } from "../../lib/levelCap.js";
  import { createListDrag } from "../../lib/listDrag.js";
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

  const drag = createListDrag({
    rowSelector: "[data-analytics-card]",
    indexKey: "analyticsIndex",
    move: moveAnalyticsChart,
  });

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
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2" data-analytics-grid>
    {#each cards as card, index (card.spec.id)}
      <AnalyticsChartCard
        spec={card.spec}
        result={card.result}
        title={card.title}
        {index}
        onGrab={(e) => drag.onPointerDown(index, e)}
        onGrabKey={(e) => drag.onKeyDown(index, e)}
        onEdit={() => (editing = structuredClone(card.spec))}
        onRemove={() => removeAnalyticsChart(card.spec.id)}
      />
    {/each}
  </div>
{/if}

{#if editing}
  <AnalyticsChartBuilder
    initial={editing}
    {runs}
    {ctx}
    {frames}
    squadFrames={squadChoices.frames}
    players={squadChoices.players}
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
