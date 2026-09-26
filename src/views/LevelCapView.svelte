<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";

  import { LEVEL_CAP_EXOLIZER_TARGET } from "../../config/shared/levelCapTypes.js";
  import type { LevelCapRun } from "../types/ipc.js";
  import { tr as t } from "../lib/i18n.js";
  import { log } from "../lib/log.js";
  import { formatRunDate } from "../lib/arbi/arbiChartData.js";
  import {
    formatLevelCapDuration,
    levelCapBuildKey,
    levelCapBuildLabels,
    levelCapFrames,
    levelCapTagSuggestions,
  } from "../lib/levelCap.js";
  import {
    applyLevelCapBuild,
    importLevelCapFolders,
    levelCap,
    loadLevelCap,
  } from "../stores/levelCap.js";
  import { itemDb } from "../stores/data.js";
  import { addToast } from "../stores/toasts.js";
  import ThemedButton from "../components/ThemedButton.svelte";
  import ThemedPanel from "../components/ThemedPanel.svelte";
  import LevelCapRunDetail from "../components/levelCap/LevelCapRunDetail.svelte";
  import LevelCapSettings from "../components/levelCap/LevelCapSettings.svelte";

  const target = String(LEVEL_CAP_EXOLIZER_TARGET);

  let showSettings = $state(false);
  let importing = $state(false);
  let frameSearch = $state("");
  let selectedFrame = $state<string | null>(null);
  let buildFilter = $state<string | null>(null);
  const expanded = new SvelteSet<string>();
  const checked = new SvelteSet<string>();
  let applySource = $state("equipped");

  onMount(() => {
    void loadLevelCap().catch((err) => log.warn("[LevelCap] load failed", String(err)));
  });

  const runs = $derived($levelCap?.runs ?? []);
  const settings = $derived($levelCap?.settings ?? null);
  const status = $derived($levelCap?.status ?? null);
  const abilityNames = $derived($levelCap?.abilityNames ?? {});
  const frames = $derived(levelCapFrames(runs));
  const visibleFrames = $derived(
    frames.filter((row) => row.frame.toLowerCase().includes(frameSearch.trim().toLowerCase())),
  );
  const activeFrame = $derived(
    selectedFrame && frames.some((row) => row.frame === selectedFrame)
      ? selectedFrame
      : (frames[0]?.frame ?? null),
  );
  const frameRuns = $derived(runs.filter((run) => run.frame === activeFrame));
  const buildLabels = $derived(levelCapBuildLabels(frameRuns));
  const buildCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const run of frameRuns) {
      const key = levelCapBuildKey(run.build);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  });
  const shownRuns = $derived(
    buildFilter === null
      ? frameRuns
      : frameRuns.filter((run) => levelCapBuildKey(run.build) === buildFilter),
  );
  const tagSuggestions = $derived(levelCapTagSuggestions(runs));
  const checkedRuns = $derived(frameRuns.filter((run) => checked.has(run.id)));
  // Runs of this frame that carry a build worth copying, newest first.
  const buildSources = $derived(frameRuns.filter((run) => run.build && !run.buildUnverified));

  function selectFrame(frame: string): void {
    selectedFrame = frame;
    buildFilter = null;
    checked.clear();
    expanded.clear();
  }

  function toggle(set: SvelteSet<string>, id: string): void {
    if (set.has(id)) set.delete(id);
    else set.add(id);
  }

  async function runImport(): Promise<void> {
    importing = true;
    try {
      const count = await importLevelCapFolders();
      addToast({
        level: count ? "success" : "info",
        message: count
          ? $t("levelCap.importDone", { count: String(count) })
          : $t("levelCap.importNone"),
      });
    } catch (err) {
      log.warn("[LevelCap] import failed", String(err));
    } finally {
      importing = false;
    }
  }

  async function applyBuild(): Promise<void> {
    if (!checkedRuns.length) return;
    await applyLevelCapBuild(
      checkedRuns.map((run) => run.id),
      applySource,
    );
    checked.clear();
  }

  function squadLabel(run: LevelCapRun): string {
    if (run.squadSize === null) return "";
    return run.squadSize <= 1
      ? $t("relics.squad.solo")
      : $t("levelCap.squad", { count: String(run.squadSize) });
  }

  function statusLine(): string {
    if (!settings) return "";
    if (status?.inCascade) {
      if (status.runId) return $t("levelCap.status.logged", { key: settings.hotkey });
      return status.exolizers === null
        ? $t("levelCap.status.liveUnknown")
        : $t("levelCap.status.live", { count: String(status.exolizers), target });
    }
    return settings.hotkey
      ? $t("levelCap.status.idle", { key: settings.hotkey })
      : $t("levelCap.status.noKey");
  }
</script>

<section class="view active">
  <div class="mx-auto flex w-full max-w-[1280px] flex-col gap-4 py-4">
    <header class="view-header mb-0 items-end" data-level-cap>
      <div class="flex flex-col gap-1">
        <h2>{$t("nav.levelCap")}</h2>
        <p class="m-0 text-sm text-text-secondary">{$t("levelCap.subtitle", { target })}</p>
        <p class="m-0 text-xs {status?.inCascade ? 'text-accent' : 'text-text-muted'}">
          {statusLine()}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <ThemedButton disabled={importing} onClick={runImport}>{$t("levelCap.import")}</ThemedButton
        >
        <ThemedButton active={showSettings} onClick={() => (showSettings = !showSettings)}
          >{$t("common.settings")}</ThemedButton
        >
      </div>
    </header>

    {#if showSettings && settings}
      <LevelCapSettings {settings} />
    {/if}

    {#if $levelCap && !runs.length}
      <ThemedPanel className="p-6 text-center text-sm text-text-secondary">
        {$t("levelCap.empty")}
      </ThemedPanel>
    {:else if runs.length}
      <div class="grid grid-cols-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <ThemedPanel className="flex flex-col gap-2 self-start p-2">
          <input
            class="rounded border border-border bg-bg-raised px-2 py-1 text-sm text-text-primary outline-none focus:border-info"
            type="search"
            placeholder={$t("levelCap.searchFrames")}
            bind:value={frameSearch}
          />
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            {#each visibleFrames as row (row.frame)}
              <li>
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors
                    {row.frame === activeFrame
                    ? 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent'
                    : 'text-text-secondary hover:bg-bg-raised'}"
                  onclick={() => selectFrame(row.frame)}
                >
                  {#if row.frameType && $itemDb[row.frameType]?.imageUrl}
                    <img
                      src={$itemDb[row.frameType].imageUrl ?? ""}
                      alt=""
                      class="h-7 w-7 shrink-0 object-contain"
                    />
                  {/if}
                  <span class="min-w-0 flex-1 truncate text-sm font-semibold">{row.frame}</span>
                  {#if row.unverified}
                    <span
                      class="h-2 w-2 shrink-0 rounded-full bg-warning"
                      title={$t("levelCap.unverifiedCount", { count: String(row.unverified) })}
                    ></span>
                  {/if}
                  <span class="font-mono text-lg font-bold">{row.count}</span>
                </button>
              </li>
            {/each}
          </ul>
        </ThemedPanel>

        <div class="flex min-w-0 flex-col gap-3">
          {#if activeFrame}
            <div class="flex flex-wrap items-end gap-3">
              <h3 class="m-0 text-2xl font-bold text-text-primary">{activeFrame}</h3>
              <span class="font-mono text-2xl font-bold text-accent">{frameRuns.length}</span>
              <div class="ml-auto flex flex-wrap items-center gap-1.5">
                {#if buildLabels.size > 1}
                  <ThemedButton
                    size="compact"
                    active={buildFilter === null}
                    onClick={() => (buildFilter = null)}>{$t("levelCap.allBuilds")}</ThemedButton
                  >
                  {#each [...buildLabels] as [key, label] (key)}
                    <ThemedButton
                      size="compact"
                      active={buildFilter === key}
                      onClick={() => (buildFilter = buildFilter === key ? null : key)}
                      >{$t("levelCap.buildBadge", { label })} · {buildCounts[key] ??
                        0}</ThemedButton
                    >
                  {/each}
                {/if}
              </div>
            </div>

            <div
              class="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40 px-3 py-2 text-xs"
            >
              <ThemedButton
                size="compact"
                onClick={() => shownRuns.forEach((run) => checked.add(run.id))}
                >{$t("common.selectAll")}</ThemedButton
              >
              {#if checkedRuns.length}
                <ThemedButton size="compact" onClick={() => checked.clear()}
                  >{$t("inventory.clearSelection")}</ThemedButton
                >
                <span class="text-text-secondary"
                  >{$t("common.selected", { count: String(checkedRuns.length) })}</span
                >
                <span class="ml-auto text-text-muted">{$t("levelCap.applyFrom")}</span>
                <select
                  class="rounded border border-border bg-bg-raised px-2 py-0.5 text-xs text-text-primary"
                  bind:value={applySource}
                >
                  <option value="equipped">{$t("levelCap.applyEquipped")}</option>
                  {#each buildSources as run (run.id)}
                    <option value={run.id}
                      >{$t("levelCap.applyRun", {
                        date: formatRunDate(run.completedAt),
                      })}{buildLabels.get(levelCapBuildKey(run.build))
                        ? ` (${buildLabels.get(levelCapBuildKey(run.build))})`
                        : ""}</option
                    >
                  {/each}
                </select>
                <ThemedButton size="compact" active onClick={applyBuild}
                  >{$t("levelCap.apply")}</ThemedButton
                >
              {/if}
            </div>

            <ThemedPanel className="overflow-hidden">
              <ul class="m-0 list-none p-0">
                {#each shownRuns as run (run.id)}
                  {@const open = expanded.has(run.id)}
                  {@const label = buildLabels.get(levelCapBuildKey(run.build))}
                  <li class="border-b border-border/50 last:border-b-0">
                    <div class="flex items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked.has(run.id)}
                        onchange={() => toggle(checked, run.id)}
                      />
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-left"
                        onclick={() => toggle(expanded, run.id)}
                      >
                        <span class="w-40 shrink-0 font-mono text-text-primary"
                          >{formatRunDate(run.completedAt)}</span
                        >
                        <span
                          class="w-16 font-mono text-text-secondary"
                          title={$t("levelCap.col.duration")}
                          >{formatLevelCapDuration(run.durationSec)}</span
                        >
                        <span class="w-20 text-text-secondary" title={$t("relics.squadLabel")}
                          >{squadLabel(run)}</span
                        >
                        <span
                          class="w-16 font-mono text-text-secondary"
                          title={$t("levelCap.col.exolizers")}>{run.exolizers ?? ""}</span
                        >
                        {#if label}
                          <span
                            class="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
                            >{$t("levelCap.buildBadge", { label })}</span
                          >
                        {/if}
                        {#if run.buildUnverified}
                          <span
                            class="rounded border border-warning/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning"
                            >{$t("levelCap.unverified")}</span
                          >
                        {/if}
                        {#each run.tags ?? [] as tag (tag)}
                          <span
                            class="rounded border border-info/40 bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info"
                            >{tag}</span
                          >
                        {/each}
                        <span class="ml-auto text-text-muted">{open ? "▾" : "▸"}</span>
                      </button>
                    </div>
                    {#if open}
                      <LevelCapRunDetail {run} {tagSuggestions} {abilityNames} />
                    {/if}
                  </li>
                {/each}
              </ul>
            </ThemedPanel>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</section>
