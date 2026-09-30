<script lang="ts">
  import { untrack } from "svelte";

  import {
    analyticsAutoTitle,
    analyticsConditionText,
    analyticsKeyLabel,
    HEIGHT_LABEL,
    WIDTH_LABEL,
    CHART_LABEL,
    MEASURE_LABEL,
    RANGE_LABEL,
    SPLIT_LABEL,
    SQUAD_LABEL,
  } from "../../lib/analytics/analyticsLabels.js";
  import {
    ANALYTICS_CHARTS,
    ANALYTICS_COLS,
    ANALYTICS_HEIGHTS,
    ANALYTICS_OTHER,
    ANALYTICS_MEASURES,
    ANALYTICS_RANGES,
    ANALYTICS_SPLITS,
    ANALYTICS_SQUAD_FILTERS,
    analyticsResult,
    analyticsMeasureAddsUp,
    isAnalyticsPie,
    isAnalyticsTimeSplit,
    type AnalyticsChartSpec,
    type AnalyticsContext,
    type AnalyticsSplit,
  } from "../../lib/analytics/runAnalytics.js";
  import { locale, tr } from "../../lib/i18n.js";
  import { ANALYTICS_LIMITS, normalizeChartSpec } from "../../stores/runAnalytics.js";
  import type { LevelCapRun } from "../../types/ipc.js";
  import ModalShell from "../ModalShell.svelte";
  import SegmentedControl from "../SegmentedControl.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedSelect from "../ThemedSelect.svelte";
  import AnalyticsChart from "./AnalyticsChart.svelte";
  import AnalyticsPill from "./AnalyticsPill.svelte";
  import AnalyticsSection from "./AnalyticsSection.svelte";

  type Draft = Omit<AnalyticsChartSpec, "id"> & { id?: string };

  let {
    initial,
    runs,
    ctx,
    frames,
    squadFrames,
    players,
    tags,
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
    /** Tags on runs or their builds, most used first. */
    tags: string[];
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

  // Renamed in the header; Escape puts back what it said before.
  let renaming = $state(false);
  let titleBefore = "";
  function startRename(): void {
    titleBefore = draft.title;
    renaming = true;
  }
  function onTitleKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      renaming = false;
    } else if (e.key === "Escape") {
      // Keeps the editor open; only the rename is dropped.
      e.stopPropagation();
      draft.title = titleBefore;
      renaming = false;
    }
  }

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
    // A pie shares out a count; averages do not add up to a whole.
    if (isAnalyticsPie(chart) && !analyticsMeasureAddsUp(draft.measure)) draft.measure = "runs";
    draft.chart = chart;
  }

  // Picking an average while a pie is showing turns it into ranked bars.
  $effect(() => {
    if (isAnalyticsPie(draft.chart) && !analyticsMeasureAddsUp(draft.measure)) {
      draft.chart = "ranked";
    }
  });

  function setSplit(split: AnalyticsSplit): void {
    draft.splitBy = split;
    // Time reads best as columns or a line; a ranking as bars.
    if (isAnalyticsTimeSplit(split) && draft.chart === "ranked") draft.chart = "columns";
    if (!isAnalyticsTimeSplit(split) && draft.chart === "line") draft.chart = "ranked";
    if (seriesChoice === split) seriesChoice = NO_SERIES;
  }

  // What can be left out: every value the splits produce, unlimited and unfiltered.
  const listed = (split: AnalyticsSplit | null) =>
    split && !isAnalyticsTimeSplit(split)
      ? analyticsResult(
          runs,
          { ...spec, splitBy: split, seriesBy: null, chart: "ranked", limit: 0, exclude: [] },
          ctx,
        ).categories.filter((key) => key !== ANALYTICS_OTHER)
      : [];
  const splitKeys = $derived(spec.chart === "stat" ? [] : listed(spec.splitBy));
  const seriesKeys = $derived(listed(spec.seriesBy));
  const excludeOptions = $derived([...new Set([...splitKeys, ...seriesKeys, ...draft.exclude])]);
  const excludeSplit = (key: string): AnalyticsSplit | null =>
    splitKeys.includes(key) ? spec.splitBy : spec.seriesBy;

  function toggleExclude(key: string): void {
    draft.exclude = draft.exclude.includes(key)
      ? draft.exclude.filter((k) => k !== key)
      : [...draft.exclude, key];
  }

  function toggleFrame(frame: string): void {
    draft.frames = draft.frames.includes(frame)
      ? draft.frames.filter((f) => f !== frame)
      : [...draft.frames, frame];
  }

  function toggleTag(tag: string): void {
    draft.tags = draft.tags.includes(tag)
      ? draft.tags.filter((t) => t !== tag)
      : [...draft.tags, tag];
  }

  // What each folded section is set to, so nothing hides behind a closed one.
  const filtersSummary = $derived(
    [
      draft.range !== "all" ? $tr(RANGE_LABEL[draft.range]) : "",
      draft.squad !== "all" ? $tr(SQUAD_LABEL[draft.squad]) : "",
      draft.frames.join(", "),
      draft.tags.join(" + "),
    ]
      .filter(Boolean)
      .join(" · ") || $tr("analytics.summary.allRuns"),
  );
  const conditionsSummary = $derived(
    spec.squadConditions.map((c) => analyticsConditionText(c, $tr)).join(" · ") ||
      $tr("common.none"),
  );
  const excludeSummary = $derived(
    draft.exclude
      .map((key) => analyticsKeyLabel(key, excludeSplit(key), $tr, $locale))
      .join(", ") || $tr("common.none"),
  );
  const layoutSummary = $derived(
    `${$tr(HEIGHT_LABEL[draft.height])} · ${$tr(WIDTH_LABEL[draft.cols])}`,
  );

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
    <div class="flex items-center gap-2 border-b border-border/60 px-5 py-4 pr-14">
      {#if renaming}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-bg-surface px-2 text-lg text-text-heading"
          maxlength="80"
          placeholder={autoTitle}
          aria-label={$tr("analytics.field.title")}
          bind:value={draft.title}
          onkeydown={onTitleKey}
          onblur={() => (renaming = false)}
          autofocus
          data-analytics-title
        />
      {:else}
        <h2 class="m-0 min-w-0 truncate text-lg text-text-heading" data-analytics-heading>
          {draft.title || autoTitle}
        </h2>
        <button
          type="button"
          class="shrink-0 rounded p-1 text-text-muted hover:text-accent"
          aria-label={$tr("analytics.rename")}
          title={$tr("analytics.rename")}
          onclick={startRename}
          data-analytics-rename
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5z" />
            <path d="M9.5 4l2.5 2.5" />
          </svg>
        </button>
      {/if}
    </div>

    <div class="grid gap-5 p-5 md:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
      <div class="flex flex-col text-xs">
        <!-- The whole chart as one sentence; each gold word is a menu. -->
        <p class="m-0 mb-4 text-base leading-[2.4] text-text-primary" data-analytics-sentence>
          {$tr("analytics.sentence.show")}
          <AnalyticsPill
            label={$tr("analytics.field.measure")}
            value={draft.measure}
            options={ANALYTICS_MEASURES.map((value) => ({
              value,
              label: $tr(MEASURE_LABEL[value]),
            }))}
            onChange={(v) => (draft.measure = v)}
          />
          {#if draft.chart !== "stat"}
            {$tr("analytics.sentence.by")}
            <AnalyticsPill
              label={$tr("analytics.field.splitBy")}
              value={draft.splitBy}
              options={ANALYTICS_SPLITS.map((value) => ({ value, label: $tr(SPLIT_LABEL[value]) }))}
              onChange={setSplit}
            />
          {/if}
          {$tr("analytics.sentence.as")}
          <AnalyticsPill
            label={$tr("analytics.field.chart")}
            value={draft.chart}
            options={chartOptions}
            onChange={setChart}
          />{#if takesSeries},
            {$tr("analytics.sentence.then")}
            <AnalyticsPill
              label={$tr("analytics.field.seriesBy")}
              value={seriesChoice}
              options={[
                { value: NO_SERIES, label: $tr("analytics.noSecondSplit") },
                ...seriesOptions.map((value) => ({ value, label: $tr(SPLIT_LABEL[value]) })),
              ]}
              onChange={(v) => (seriesChoice = v)}
            />{/if}{#if draft.chart !== "stat" && !timeSplit},
            {$tr("analytics.sentence.top")}
            <AnalyticsPill
              label={$tr("analytics.field.limit")}
              value={draft.limit}
              options={ANALYTICS_LIMITS.map((value) => ({
                value,
                label: value ? String(value) : $tr("common.all"),
              }))}
              onChange={(v) => (draft.limit = v)}
            />{/if}
        </p>

        <AnalyticsSection title={$tr("analytics.section.filters")} summary={filtersSummary}>
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
                onClick={() => (draft.frames = [])}
                onContextMenu={() => (draft.frames = [])}>{$tr("analytics.allFrames")}</ThemedButton
              >
              {#each frames as frame (frame)}
                <ThemedButton
                  size="compact"
                  active={draft.frames.includes(frame)}
                  onClick={() => toggleFrame(frame)}
                  onContextMenu={() => (draft.frames = draft.frames.filter((f) => f !== frame))}
                  >{frame}</ThemedButton
                >
              {/each}
            </div>
          </div>
          {#if tags.length}
            <div class="flex flex-col gap-1">
              <span class="text-text-secondary">{$tr("analytics.field.tags")}</span>
              <div class="flex max-h-28 flex-wrap gap-1 overflow-y-auto" data-analytics-tags>
                <ThemedButton
                  size="compact"
                  active={draft.tags.length === 0}
                  onClick={() => (draft.tags = [])}
                  onContextMenu={() => (draft.tags = [])}>{$tr("analytics.anyTags")}</ThemedButton
                >
                {#each tags as tag (tag)}
                  <ThemedButton
                    size="compact"
                    active={draft.tags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                    onContextMenu={() => (draft.tags = draft.tags.filter((t) => t !== tag))}
                    >{tag}</ThemedButton
                  >
                {/each}
              </div>
            </div>
          {/if}
        </AnalyticsSection>

        <AnalyticsSection
          title={$tr("analytics.field.squadConditions")}
          summary={conditionsSummary}
        >
          <div class="flex flex-col gap-1" data-analytics-condition-editor>
            {#each conditions as row, i (i)}
              <!-- Right-click anywhere on the row drops the condition, like its close button. -->
              <div
                role="presentation"
                class="flex flex-wrap items-center gap-1 rounded-[var(--radius-md)] border border-border-subtle p-1.5"
                oncontextmenu={(event) => {
                  event.preventDefault();
                  conditions.splice(i, 1);
                }}
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
        </AnalyticsSection>

        {#if excludeOptions.length}
          <AnalyticsSection title={$tr("analytics.field.exclude")} summary={excludeSummary}>
            <div class="flex max-h-32 flex-wrap gap-1 overflow-y-auto" data-analytics-exclude>
              {#each excludeOptions as key (key)}
                <ThemedButton
                  size="compact"
                  active={draft.exclude.includes(key)}
                  onClick={() => toggleExclude(key)}
                  onContextMenu={() => (draft.exclude = draft.exclude.filter((k) => k !== key))}
                  >{analyticsKeyLabel(key, excludeSplit(key), $tr, $locale)}</ThemedButton
                >
              {/each}
            </div>
          </AnalyticsSection>
        {/if}

        <AnalyticsSection title={$tr("analytics.section.layout")} summary={layoutSummary}>
          <div class="flex flex-col gap-1">
            <span class="text-text-secondary">{$tr("analytics.field.height")}</span>
            <SegmentedControl
              value={draft.height}
              options={ANALYTICS_HEIGHTS.map((value) => ({
                value,
                label: $tr(HEIGHT_LABEL[value]),
              }))}
              onChange={(v) => (draft.height = v)}
            />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-text-secondary">{$tr("analytics.field.width")}</span>
            <SegmentedControl
              value={draft.cols}
              options={ANALYTICS_COLS.map((value) => ({ value, label: $tr(WIDTH_LABEL[value]) }))}
              onChange={(v) => (draft.cols = v)}
              wrap
            />
          </div>
        </AnalyticsSection>
      </div>

      <section class="flex min-w-0 flex-col gap-2" aria-label={$tr("analytics.preview")}>
        <div
          class="rounded-[var(--radius-lg)] border border-[color:var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4"
        >
          <h3 class="m-0 text-sm font-semibold text-text-heading">
            {spec.title || autoTitle}
          </h3>
          <span class="mb-3 block text-xs text-text-muted"
            >{$tr("analytics.runCount", { count: String(result.runCount) })}</span
          >
          <AnalyticsChart {spec} {result} title={spec.title || autoTitle} />
        </div>
        <div class="mt-auto flex justify-end gap-2 pt-4">
          <ThemedButton onClick={onClose}>{$tr("common.cancel")}</ThemedButton>
          <ThemedButton active onClick={save}>{$tr("common.save")}</ThemedButton>
        </div>
      </section>
    </div>
  </div>
</ModalShell>
