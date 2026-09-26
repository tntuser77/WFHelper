<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";

  import type { LevelCapNamedBuild, LevelCapRun } from "../../types/ipc.js";
  import { locale, tr as t } from "../../lib/i18n.js";
  import { formatLevelCapDuration, type LevelCapFrameRow } from "../../lib/levelCap.js";
  import { assignLevelCapBuild, createLevelCapBuild } from "../../stores/levelCap.js";
  import { itemDb } from "../../stores/data.js";
  import { addToast } from "../../stores/toasts.js";
  import ModalShell from "../ModalShell.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import LevelCapBuildEditor from "./LevelCapBuildEditor.svelte";
  import LevelCapRunDetail from "./LevelCapRunDetail.svelte";

  let {
    row,
    runs,
    builds,
    tagSuggestions,
    abilityNames,
    onClose,
  }: {
    row: LevelCapFrameRow;
    /** This frame's runs only. */
    runs: LevelCapRun[];
    /** This frame's builds only. */
    builds: LevelCapNamedBuild[];
    tagSuggestions: string[];
    abilityNames: Record<string, string>;
    onClose: () => void;
  } = $props();

  const GEAR = ["primary", "secondary", "melee", "companion"] as const;
  const UNVERIFIED = "unverified";

  let editingId = $state<string | null>(null);
  /** A build id, UNVERIFIED, or null for every run. */
  let filter = $state<string | null>(null);
  let moveTarget = $state("");
  let showNew = $state(false);
  const expanded = new SvelteSet<string>();
  const checked = new SvelteSet<string>();

  const editing = $derived(builds.find((b) => b.id === editingId) ?? null);
  const runCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const run of runs) if (run.buildId) counts[run.buildId] = (counts[run.buildId] ?? 0) + 1;
    return counts;
  });
  const unverified = $derived(runs.filter((run) => run.buildUnverified || !run.buildId));
  const shownRuns = $derived(
    filter === null
      ? runs
      : filter === UNVERIFIED
        ? unverified
        : runs.filter((run) => run.buildId === filter),
  );
  const checkedRuns = $derived(runs.filter((run) => checked.has(run.id)));
  const buildName = (id: string | undefined) => builds.find((b) => b.id === id)?.name ?? "";

  function toggle(set: SvelteSet<string>, id: string): void {
    if (set.has(id)) set.delete(id);
    else set.add(id);
  }

  async function newBuild(source: { kind: "equipped" } | { kind: "build"; id: string }) {
    showNew = false;
    const id = await createLevelCapBuild(row.frame, source);
    if (id) editingId = id;
    else
      addToast({
        level: "warning",
        message: $t("levelCap.editor.equipFirst", { frame: row.frame }),
      });
  }

  async function assign(ids: string[], buildId: string): Promise<void> {
    if (!ids.length || !buildId) return;
    await assignLevelCapBuild(ids, buildId);
  }

  /** Keeps each checked run on the build it already has, clearing the unverified flag. */
  async function confirmChecked(): Promise<void> {
    const byBuild: Record<string, string[]> = {};
    for (const run of checkedRuns) if (run.buildId) (byBuild[run.buildId] ??= []).push(run.id);
    for (const [buildId, ids] of Object.entries(byBuild)) await assign(ids, buildId);
    checked.clear();
  }

  async function moveChecked(): Promise<void> {
    await assign(
      checkedRuns.map((run) => run.id),
      moveTarget,
    );
    checked.clear();
  }

  function tileRooms(run: LevelCapRun): string[] {
    return run.tile?.rooms.map((room) => room.name ?? `#${room.fingerprint}`) ?? [];
  }

  function runDate(ms: number): string {
    const d = new Date(ms);
    return $t("levelCap.dateAt", {
      date: d.toLocaleDateString($locale, { year: "numeric", month: "short", day: "numeric" }),
      time: d.toLocaleTimeString($locale, { hour: "numeric", minute: "2-digit" }),
    });
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
      <div class="flex min-w-0 flex-1 flex-col">
        <h2 class="m-0 truncate text-2xl font-bold text-text-primary">{row.frame}</h2>
        {#if editing}
          <button
            type="button"
            class="cursor-pointer self-start text-xs text-info hover:underline"
            onclick={() => (editingId = null)}>← {$t("levelCap.editor.backToRuns")}</button
          >
        {/if}
      </div>
      <span class="font-mono text-3xl font-bold text-accent">{runs.length}</span>
    </div>

    <div class="flex flex-col gap-3 p-4">
      {#if editing}
        {#key editing.id}
          <LevelCapBuildEditor
            record={editing}
            runCount={runCounts[editing.id] ?? 0}
            {tagSuggestions}
            {abilityNames}
            onDone={() => (editingId = null)}
          />
        {/key}
      {:else}
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-level-cap-builds>
          {#each builds as build (build.id)}
            {@const active = filter === build.id}
            <div
              class="flex flex-col gap-2 rounded-[var(--radius-md)] border p-2.5 transition-colors {active
                ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]'
                : 'border-border/60 bg-bg-raised/40'}"
            >
              <button
                type="button"
                class="flex cursor-pointer items-center gap-2 text-left"
                title={$t("levelCap.builds.filterHint")}
                onclick={() => (filter = active ? null : build.id)}
              >
                <span class="min-w-0 flex-1 truncate text-sm font-bold text-text-primary"
                  >{build.name}</span
                >
                <span class="font-mono text-lg font-bold text-accent"
                  >{runCounts[build.id] ?? 0}</span
                >
              </button>
              <div class="flex items-center gap-1.5">
                {#each GEAR as slot (slot)}
                  {@const type = build.build[slot]?.type}
                  <div
                    class="flex h-8 w-8 items-center justify-center rounded bg-bg-raised {type
                      ? ''
                      : 'border border-dashed border-border'}"
                  >
                    {#if type && $itemDb[type]?.imageUrl}
                      <img
                        src={$itemDb[type].imageUrl ?? ""}
                        alt=""
                        class="h-4/5 w-4/5 object-contain"
                      />
                    {/if}
                  </div>
                {/each}
                <ThemedButton
                  size="compact"
                  className="ml-auto"
                  onClick={() => (editingId = build.id)}>{$t("levelCap.builds.edit")}</ThemedButton
                >
              </div>
              {#if build.tags?.length}
                <div class="flex flex-wrap gap-1">
                  {#each build.tags as tag (tag)}
                    <span
                      class="rounded border border-info/40 bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info"
                      >{tag}</span
                    >
                  {/each}
                </div>
              {/if}
            </div>
          {/each}

          {#if unverified.length}
            <button
              type="button"
              class="flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-2.5 text-left transition-colors {filter ===
              UNVERIFIED
                ? 'border-warning bg-warning/10'
                : 'border-warning/40 bg-warning/5 hover:border-warning'}"
              onclick={() => (filter = filter === UNVERIFIED ? null : UNVERIFIED)}
            >
              <span class="flex items-center gap-2">
                <span class="flex-1 text-sm font-bold text-warning"
                  >{$t("levelCap.builds.needsCheck")}</span
                >
                <span class="font-mono text-lg font-bold text-warning">{unverified.length}</span>
              </span>
              <span class="text-xs text-text-secondary">{$t("levelCap.builds.needsCheckHint")}</span
              >
            </button>
          {/if}

          <div
            class="relative flex flex-col justify-center rounded-[var(--radius-md)] border border-dashed border-border p-2.5"
          >
            <button
              type="button"
              class="cursor-pointer text-sm font-semibold text-text-secondary hover:text-accent"
              onclick={() => (showNew = !showNew)}>+ {$t("levelCap.builds.new")}</button
            >
            {#if showNew}
              <div class="mt-2 flex flex-col gap-1">
                <ThemedButton size="compact" onClick={() => newBuild({ kind: "equipped" })}
                  >{$t("levelCap.builds.fromEquipped")}</ThemedButton
                >
                {#each builds as build (build.id)}
                  <ThemedButton
                    size="compact"
                    onClick={() => newBuild({ kind: "build", id: build.id })}
                    >{$t("levelCap.builds.copyOf", { name: build.name })}</ThemedButton
                  >
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div
          class="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40 px-3 py-2 text-xs"
        >
          {#if filter !== null}
            <ThemedButton size="compact" onClick={() => (filter = null)}
              >{$t("levelCap.allBuilds")}</ThemedButton
            >
          {/if}
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
            {#if checkedRuns.some((run) => run.buildUnverified && run.buildId)}
              <ThemedButton size="compact" onClick={confirmChecked}
                >{$t("levelCap.builds.confirm")}</ThemedButton
              >
            {/if}
            <span class="ml-auto text-text-muted">{$t("levelCap.builds.moveTo")}</span>
            <select
              class="rounded border border-border bg-bg-raised px-2 py-0.5 text-xs text-text-primary"
              bind:value={moveTarget}
            >
              <option value="" disabled>{$t("levelCap.builds.pick")}</option>
              {#each builds as build (build.id)}
                <option value={build.id}>{build.name}</option>
              {/each}
            </select>
            <ThemedButton size="compact" active disabled={!moveTarget} onClick={moveChecked}
              >{$t("levelCap.builds.move")}</ThemedButton
            >
          {/if}
        </div>

        <ul
          class="m-0 list-none overflow-hidden rounded-[var(--radius-md)] border border-border/60 p-0"
        >
          {#each shownRuns as run (run.id)}
            {@const open = expanded.has(run.id)}
            <li class="border-b border-border/50 last:border-b-0">
              <div class="flex min-h-[3.75rem] items-center gap-4 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={checked.has(run.id)}
                  onchange={() => toggle(checked, run.id)}
                />
                <div class="flex w-[22rem] shrink-0 items-center gap-2">
                  <div class="flex shrink-0 items-center gap-1">
                    {#each GEAR as slot (slot)}
                      {@const type = run.build?.[slot]?.type}
                      <div
                        class="flex h-9 w-9 items-center justify-center rounded bg-bg-raised {type
                          ? ''
                          : 'border border-dashed border-border'}"
                        title={type ? ($itemDb[type]?.name ?? "") : ""}
                      >
                        {#if type && $itemDb[type]?.imageUrl}
                          <img
                            src={$itemDb[type].imageUrl ?? ""}
                            alt=""
                            class="h-4/5 w-4/5 object-contain"
                          />
                        {/if}
                      </div>
                    {/each}
                  </div>
                  <select
                    class="min-w-0 flex-1 truncate rounded border px-2 py-1 text-sm font-bold {run.buildUnverified ||
                    !run.buildId
                      ? 'border-warning/60 bg-warning/5 text-warning'
                      : 'border-border bg-bg-raised text-text-primary'}"
                    title={run.buildUnverified
                      ? $t("levelCap.unverified")
                      : $t("levelCap.builds.runBuild")}
                    value={run.buildId ?? ""}
                    onchange={(e) => assign([run.id], e.currentTarget.value)}
                  >
                    {#if !run.buildId}
                      <option value="" disabled>{$t("levelCap.builds.pick")}</option>
                    {/if}
                    {#each builds as build (build.id)}
                      <option value={build.id}>{build.name}</option>
                    {/each}
                  </select>
                  {#if run.buildUnverified && run.buildId}
                    <button
                      type="button"
                      class="shrink-0 cursor-pointer rounded border border-warning/60 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning hover:bg-warning/10"
                      title={$t("levelCap.builds.confirmHint", { name: buildName(run.buildId) })}
                      onclick={() => assign([run.id], run.buildId ?? "")}
                      >✓ {$t("common.confirm")}</button
                    >
                  {/if}
                </div>
                <button
                  type="button"
                  class="grid min-w-0 flex-1 cursor-pointer grid-cols-[4.5rem_6.5rem_minmax(0,1fr)_auto] items-center gap-4 text-left"
                  onclick={() => toggle(expanded, run.id)}
                >
                  <span
                    class="font-mono text-base font-semibold text-text-primary"
                    title={$t("levelCap.col.duration")}
                    >{formatLevelCapDuration(run.durationSec)}</span
                  >
                  {#if run.exolizers === null && run.rounds != null}
                    <span class="text-text-secondary"
                      >{$t("arbi.rotations.round", { n: String(run.rounds) })}</span
                    >
                  {:else}
                    <span class="flex items-baseline gap-1" title={$t("levelCap.col.exolizers")}>
                      <span class="font-mono text-base font-bold text-accent"
                        >{run.exolizers ?? ""}</span
                      >
                      {#if run.exolizers !== null}
                        <span class="text-[10px] uppercase tracking-wide text-text-muted"
                          >{$t("levelCap.exo")}</span
                        >
                      {/if}
                    </span>
                  {/if}
                  <span
                    class="flex min-w-0 flex-col text-xs leading-snug text-text-secondary"
                    title={tileRooms(run).join(" · ")}
                  >
                    {#each tileRooms(run) as room, i (i)}
                      <span class="truncate">{room}</span>
                    {/each}
                  </span>
                  <span class="flex flex-col items-end text-xs text-text-muted">
                    <span class="whitespace-nowrap">{runDate(run.completedAt)}</span>
                    <span>{squadLabel(run)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="cursor-pointer text-text-muted"
                  aria-label={$t("levelCap.builds.details")}
                  onclick={() => toggle(expanded, run.id)}>{open ? "▾" : "▸"}</button
                >
              </div>
              {#if open}
                <LevelCapRunDetail {run} {abilityNames} />
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</ModalShell>
