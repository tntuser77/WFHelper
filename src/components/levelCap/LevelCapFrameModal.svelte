<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";

  import type { LevelCapRun } from "../../types/ipc.js";
  import { tr as t } from "../../lib/i18n.js";
  import { formatRunDate } from "../../lib/arbi/arbiChartData.js";
  import {
    formatLevelCapDuration,
    levelCapBuildKey,
    levelCapBuildLabels,
    type LevelCapFrameRow,
  } from "../../lib/levelCap.js";
  import { applyLevelCapBuild } from "../../stores/levelCap.js";
  import { itemDb } from "../../stores/data.js";
  import ModalShell from "../ModalShell.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import LevelCapRunDetail from "./LevelCapRunDetail.svelte";

  let {
    row,
    runs,
    tagSuggestions,
    abilityNames,
    onClose,
  }: {
    row: LevelCapFrameRow;
    /** This frame's runs only. */
    runs: LevelCapRun[];
    tagSuggestions: string[];
    abilityNames: Record<string, string>;
    onClose: () => void;
  } = $props();

  let buildFilter = $state<string | null>(null);
  const expanded = new SvelteSet<string>();
  const checked = new SvelteSet<string>();
  let applySource = $state("equipped");

  const buildLabels = $derived(levelCapBuildLabels(runs));
  const buildCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const run of runs) {
      const key = levelCapBuildKey(run.build);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  });
  const shownRuns = $derived(
    buildFilter === null ? runs : runs.filter((run) => levelCapBuildKey(run.build) === buildFilter),
  );
  const checkedRuns = $derived(runs.filter((run) => checked.has(run.id)));
  // Runs of this frame that carry a build worth copying, newest first.
  const buildSources = $derived(runs.filter((run) => run.build && !run.buildUnverified));

  function toggle(set: SvelteSet<string>, id: string): void {
    if (set.has(id)) set.delete(id);
    else set.add(id);
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
</script>

<ModalShell ariaLabel={row.frame} {onClose}>
  <div class="detail-panel level-cap-frame-panel flex flex-col" data-level-cap-modal={row.frame}>
    <div class="detail-panel-top-actions">
      <button class="detail-close" aria-label={$t("common.close")} onclick={onClose}>&times;</button
      >
    </div>

    <div class="flex items-center gap-3 border-b border-border/60 px-5 py-4 pr-14">
      <div
        class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-bg-raised"
      >
        {#if row.frameType && $itemDb[row.frameType]?.imageUrl}
          <img
            src={$itemDb[row.frameType].imageUrl ?? ""}
            alt=""
            class="h-full w-full object-contain"
          />
        {/if}
      </div>
      <h2 class="m-0 min-w-0 flex-1 truncate text-2xl font-bold text-text-primary">{row.frame}</h2>
      <span class="font-mono text-3xl font-bold text-accent">{runs.length}</span>
    </div>

    <div class="flex flex-col gap-3 p-4">
      {#if buildLabels.size > 1}
        <div class="flex flex-wrap items-center gap-1.5">
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
              >{$t("levelCap.buildBadge", { label })} · {buildCounts[key] ?? 0}</ThemedButton
            >
          {/each}
        </div>
      {/if}

      <div
        class="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40 px-3 py-2 text-xs"
      >
        <ThemedButton size="compact" onClick={() => shownRuns.forEach((run) => checked.add(run.id))}
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

      <ul
        class="m-0 list-none overflow-hidden rounded-[var(--radius-md)] border border-border/60 p-0"
      >
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
                <span class="w-16 font-mono text-text-secondary" title={$t("levelCap.col.duration")}
                  >{formatLevelCapDuration(run.durationSec)}</span
                >
                <span class="w-20 text-text-secondary" title={$t("relics.squadLabel")}
                  >{squadLabel(run)}</span
                >
                {#if run.exolizers === null && run.rounds != null}
                  <span class="w-16 text-text-secondary"
                    >{$t("arbi.rotations.round", { n: String(run.rounds) })}</span
                  >
                {:else}
                  <span
                    class="w-16 font-mono text-text-secondary"
                    title={$t("levelCap.col.exolizers")}>{run.exolizers ?? ""}</span
                  >
                {/if}
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
    </div>
  </div>
</ModalShell>
