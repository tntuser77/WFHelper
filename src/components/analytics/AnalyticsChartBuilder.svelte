<script lang="ts">
  import { untrack } from "svelte";

  import {
    analyticsAutoTitle,
    CHART_LABEL,
    MEASURE_LABEL,
    RANGE_LABEL,
    SPLIT_LABEL,
    SQUAD_LABEL,
  } from "../../lib/analytics/analyticsLabels.js";
  import {
    ANALYTICS_CHARTS,
    ANALYTICS_MEASURES,
    ANALYTICS_RANGES,
    ANALYTICS_SPLITS,
    ANALYTICS_SQUAD_FILTERS,
    analyticsResult,
    isAnalyticsTimeSplit,
    type AnalyticsChartSpec,
    type AnalyticsContext,
    type AnalyticsSplit,
  } from "../../lib/analytics/runAnalytics.js";
  import { tr } from "../../lib/i18n.js";
  import { ANALYTICS_LIMITS, normalizeChartSpec } from "../../stores/runAnalytics.js";
  import type { LevelCapRun } from "../../types/ipc.js";
  import ModalShell from "../ModalShell.svelte";
  import SegmentedControl from "../SegmentedControl.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedSelect from "../ThemedSelect.svelte";
  import AnalyticsChart from "./AnalyticsChart.svelte";

  type Draft = Omit<AnalyticsChartSpec, "id"> & { id?: string };

  let {
    initial,
    runs,
    ctx,
    frames,
    squadFrames,
    players,
    onSave,
    onClose,
  }: {
    initial: Draft;
    runs: readonly LevelCapRun[];
    ctx: AnalyticsContext;
    /** Frames with at least one run, most-run first. */
    frames: string[];
    /** Frames squadmates were seen on, and squadmates' names, most seen first. */
    squadFrames: string[];
    players: string[];
    onSave: (draft: Draft) => void;
    onClose: () => void;
  } = $props();

  let draft = $state<Draft>(untrack(() => structuredClone($state.snapshot(initial) as Draft)));
  const NO_SERIES = "";
  let seriesChoice = $state<string>(untrack(() => initial.seriesBy ?? NO_SERIES));

  const MAX_CONDITIONS = 4;
  type PlayerMode = "any" | "is" | "not";
  interface ConditionRow {
    has: boolean;
    frame: string;
    mode: PlayerMode;
    player: string;
  }
  // Rows keep what is half typed; the spec only takes what is complete.
  let conditions = $state<ConditionRow[]>(
    untrack(() =>
      initial.squadConditions.map((c) => ({
        has: c.has,
        frame: c.frame ?? "",
        mode: c.player === null ? "any" : c.notPlayer ? "not" : "is",
        player: c.player ?? "",
      })),
    ),
  );
  const SELECT =
    "h-7 cursor-pointer rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-bg-surface px-1.5 text-xs text-text-primary [&_option]:bg-bg-surface";

  // What gets saved: the draft after the store's own rules, so the preview never lies.
  const spec = $derived(
    normalizeChartSpec({
      ...draft,
      id: draft.id ?? "preview",
      seriesBy: seriesChoice || null,
      squadConditions: conditions.map((row) => ({
        has: row.has,
        frame: row.frame || null,
        player: row.mode === "any" ? null : row.player || null,
        notPlayer: row.mode === "not",
      })),
    }) as AnalyticsChartSpec,
  );
  const result = $derived(analyticsResult(runs, spec, ctx));
  const autoTitle = $derived(analyticsAutoTitle(spec, $tr));

  const timeSplit = $derived(isAnalyticsTimeSplit(draft.splitBy));
  const takesSeries = $derived(
    draft.chart === "columns" || draft.chart === "line" || draft.chart === "table",
  );
  const seriesOptions = $derived(
    ANALYTICS_SPLITS.filter((s) => !isAnalyticsTimeSplit(s) && s !== draft.splitBy),
  );
  const chartOptions = $derived(
    ANALYTICS_CHARTS.map((value) => ({ value, label: $tr(CHART_LABEL[value]) })),
  );

  function setChart(chart: AnalyticsChartSpec["chart"]): void {
    draft.chart = chart;
  }

  function setSplit(split: AnalyticsSplit): void {
    draft.splitBy = split;
    // Time reads best as columns or a line; a ranking as bars.
    if (isAnalyticsTimeSplit(split) && draft.chart === "ranked") draft.chart = "columns";
    if (!isAnalyticsTimeSplit(split) && draft.chart === "line") draft.chart = "ranked";
    if (seriesChoice === split) seriesChoice = NO_SERIES;
  }

  function toggleFrame(frame: string): void {
    draft.frames = draft.frames.includes(frame)
      ? draft.frames.filter((f) => f !== frame)
      : [...draft.frames, frame];
  }

  function save(): void {
    const { id: _id, ...rest } = spec;
    onSave(draft.id ? { ...rest, id: draft.id } : rest);
  }
</script>

<ModalShell ariaLabel={draft.id ? $tr("analytics.editChart") : $tr("analytics.newChart")} {onClose}>
  <div class="detail-panel analytics-builder-panel flex flex-col" data-analytics-builder>
    <div class="detail-panel-top-actions">
      <button class="detail-close" aria-label={$tr("common.close")} onclick={onClose}
        >&times;</button
      >
    </div>
    <h2 class="m-0 border-b border-border/60 px-5 py-4 pr-14 text-lg text-text-heading">
      {draft.id ? $tr("analytics.editChart") : $tr("analytics.newChart")}
    </h2>

    <div class="grid gap-5 p-5 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <form
        class="flex flex-col gap-3 text-xs"
        onsubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label class="flex flex-col gap-1">
          <span class="text-text-secondary">{$tr("analytics.field.title")}</span>
          <input
            class="h-7 rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-bg-surface px-2 text-xs text-text-primary"
            maxlength="80"
            placeholder={autoTitle}
            bind:value={draft.title}
            data-analytics-title
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-text-secondary">{$tr("analytics.field.measure")}</span>
          <ThemedSelect bind:value={draft.measure} className="h-7">
            {#each ANALYTICS_MEASURES as value (value)}
              <option {value}>{$tr(MEASURE_LABEL[value])}</option>
            {/each}
          </ThemedSelect>
        </label>

        <div class="flex flex-col gap-1">
          <span class="text-text-secondary">{$tr("analytics.field.chart")}</span>
          <SegmentedControl value={draft.chart} options={chartOptions} onChange={setChart} wrap />
        </div>

        {#if draft.chart !== "stat"}
          <label class="flex flex-col gap-1">
            <span class="text-text-secondary">{$tr("analytics.field.splitBy")}</span>
            <select
              class="h-7 cursor-pointer rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-bg-surface px-1.5 text-xs text-text-primary [&_option]:bg-bg-surface"
              value={draft.splitBy}
              onchange={(e) => setSplit(e.currentTarget.value as AnalyticsSplit)}
              data-analytics-split
            >
              {#each ANALYTICS_SPLITS as value (value)}
                <option {value}>{$tr(SPLIT_LABEL[value])}</option>
              {/each}
            </select>
          </label>
        {:else}
          <p class="m-0 text-text-muted">{$tr("analytics.seriesStatHint")}</p>
        {/if}

        {#if takesSeries}
          <label class="flex flex-col gap-1">
            <span class="text-text-secondary">{$tr("analytics.field.seriesBy")}</span>
            <ThemedSelect bind:value={seriesChoice} className="h-7">
              <option value={NO_SERIES}>{$tr("analytics.noSecondSplit")}</option>
              {#each seriesOptions as value (value)}
                <option {value}>{$tr(SPLIT_LABEL[value])}</option>
              {/each}
            </ThemedSelect>
          </label>
        {/if}

        {#if draft.chart !== "stat" && !timeSplit}
          <label class="flex flex-col gap-1">
            <span class="text-text-secondary">{$tr("analytics.field.limit")}</span>
            <ThemedSelect bind:value={draft.limit} className="h-7">
              {#each ANALYTICS_LIMITS as value (value)}
                <option {value}>{value}</option>
              {/each}
            </ThemedSelect>
          </label>
        {/if}

        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1">
            <span class="text-text-secondary">{$tr("analytics.field.range")}</span>
            <ThemedSelect bind:value={draft.range} className="h-7">
              {#each ANALYTICS_RANGES as value (value)}
                <option {value}>{$tr(RANGE_LABEL[value])}</option>
              {/each}
            </ThemedSelect>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-text-secondary">{$tr("analytics.field.squad")}</span>
            <ThemedSelect bind:value={draft.squad} className="h-7">
              {#each ANALYTICS_SQUAD_FILTERS as value (value)}
                <option {value}>{$tr(SQUAD_LABEL[value])}</option>
              {/each}
            </ThemedSelect>
          </label>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-text-secondary">{$tr("analytics.field.frames")}</span>
          <div class="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            <ThemedButton
              size="compact"
              active={draft.frames.length === 0}
              onClick={() => (draft.frames = [])}>{$tr("analytics.allFrames")}</ThemedButton
            >
            {#each frames as frame (frame)}
              <ThemedButton
                size="compact"
                active={draft.frames.includes(frame)}
                onClick={() => toggleFrame(frame)}>{frame}</ThemedButton
              >
            {/each}
          </div>
        </div>

        <div class="flex flex-col gap-1" data-analytics-condition-editor>
          <span class="text-text-secondary">{$tr("analytics.field.squadConditions")}</span>
          {#each conditions as row, i (i)}
            <div
              class="flex flex-wrap items-center gap-1 rounded-[var(--radius-md)] border border-border-subtle p-1.5"
              data-analytics-condition={i}
            >
              <select class={SELECT} bind:value={row.has} data-condition-has>
                <option value={true}>{$tr("analytics.cond.has")}</option>
                <option value={false}>{$tr("analytics.cond.hasNot")}</option>
              </select>
              <select class={SELECT} bind:value={row.frame} data-condition-frame>
                <option value="">{$tr("analytics.cond.anyFrame")}</option>
                {#each squadFrames as frame (frame)}
                  <option value={frame}>{frame}</option>
                {/each}
              </select>
              <select class={SELECT} bind:value={row.mode} data-condition-mode>
                <option value="any">{$tr("analytics.cond.anyPlayer")}</option>
                <option value="is">{$tr("analytics.cond.playedBy")}</option>
                <option value="not">{$tr("analytics.cond.notPlayedBy")}</option>
              </select>
              {#if row.mode !== "any"}
                <input
                  class="h-7 w-32 rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-bg-surface px-2 text-xs text-text-primary"
                  list="analytics-players"
                  maxlength="64"
                  placeholder={$tr("analytics.cond.playerName")}
                  aria-label={$tr("analytics.cond.playerName")}
                  bind:value={row.player}
                  data-condition-player
                />
              {/if}
              <button
                type="button"
                class="ml-auto rounded px-1.5 text-lg leading-none text-text-muted hover:text-[var(--danger)]"
                aria-label={$tr("analytics.cond.remove")}
                title={$tr("analytics.cond.remove")}
                onclick={() => conditions.splice(i, 1)}>&times;</button
              >
            </div>
          {/each}
          {#if conditions.length < MAX_CONDITIONS}
            <ThemedButton
              size="compact"
              className="self-start"
              onClick={() => conditions.push({ has: true, frame: "", mode: "any", player: "" })}
              >+ {$tr("analytics.cond.add")}</ThemedButton
            >
          {/if}
          {#if draft.measure === "squadmates"}
            <p class="m-0 text-text-muted">{$tr("analytics.cond.hint")}</p>
          {/if}
          <datalist id="analytics-players">
            {#each players as name (name)}
              <option value={name}></option>
            {/each}
          </datalist>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-text-secondary">{$tr("analytics.field.width")}</span>
          <SegmentedControl
            value={draft.wide ? "full" : "half"}
            options={[
              { value: "half", label: $tr("analytics.halfWidth") },
              { value: "full", label: $tr("layout.spanFull") },
            ]}
            onChange={(v) => (draft.wide = v === "full")}
          />
        </div>

        <div class="mt-2 flex justify-end gap-2">
          <ThemedButton onClick={onClose}>{$tr("common.cancel")}</ThemedButton>
          <ThemedButton type="submit" active>{$tr("common.save")}</ThemedButton>
        </div>
      </form>

      <section class="flex min-w-0 flex-col gap-2" aria-label={$tr("analytics.preview")}>
        <span class="text-xs text-text-secondary">{$tr("analytics.preview")}</span>
        <div
          class="rounded-[var(--radius-lg)] border border-[color:var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4"
        >
          <h3 class="m-0 mb-3 text-sm font-semibold text-text-heading">
            {spec.title || autoTitle}
          </h3>
          <AnalyticsChart {spec} {result} title={spec.title || autoTitle} />
        </div>
      </section>
    </div>
  </div>
</ModalShell>
