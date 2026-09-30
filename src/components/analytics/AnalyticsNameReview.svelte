<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { invoke } from "../../lib/ipc.js";
  import { log } from "../../lib/log.js";
  import {
    fixLevelCapSquadmate,
    labelLevelCapPortrait,
    updateLevelCapSettings,
  } from "../../stores/levelCap.js";
  import type { LevelCapRun, LevelCapSettings } from "../../types/ipc.js";
  import ModalShell from "../ModalShell.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import {
    mergedSquadFix,
    squadNameReview,
    type ReviewRow,
  } from "../../lib/analytics/squadNameReview.js";

  let {
    runs,
    settings,
    frames,
    onClose,
  }: {
    runs: readonly LevelCapRun[];
    settings: LevelCapSettings | null;
    /** Frame names to offer while typing, most seen first. */
    frames: string[];
    onClose: () => void;
  } = $props();

  const review = $derived(squadNameReview(runs));

  // Pictures load once per run or row and stay while the window is open.
  let crops = $state<Record<string, string | null>>({});
  let thumbs = $state<Record<string, string | null>>({});
  $effect(() => {
    const wanted = [
      ...review.cutOff.map((entry) => entry.rows[0].run.id),
      ...review.missing.map((entry) => entry.run.id),
    ];
    for (const id of wanted) {
      if (id in crops) continue;
      crops[id] = null;
      invoke("getLevelCapSquadCrop", id)
        .then((url) => (crops[id] = url))
        .catch((err) => log.warn("[Analytics] squad crop failed", String(err)));
    }
    for (const { run, rows } of review.missing) {
      for (const row of rows) {
        const key = `${run.id}:${row.slot}`;
        if (!row.portrait || key in thumbs) continue;
        thumbs[key] = null;
        invoke("getLevelCapPortraitThumb", run.id, row.slot)
          .then((url) => (thumbs[key] = url))
          .catch((err) => log.warn("[Analytics] portrait failed", String(err)));
      }
    }
  });

  let typed = $state<Record<string, string>>({});
  let busy = $state(false);
  // The row whose inputs have the pointer or focus; its box on the picture lights up.
  let active = $state<string | null>(null);

  async function saveCutOff(name: string, rows: Array<{ run: LevelCapRun; slot: number }>) {
    // An untouched box still holds its starting text, and that is what gets saved.
    const full = (typed[`cut:${name}`] ?? name.replace(/…$/, "")).trim();
    if (!full || busy) return;
    busy = true;
    try {
      for (const { run, slot } of rows) {
        await fixLevelCapSquadmate(run.id, slot, mergedSquadFix(run, slot, { name: full }));
      }
      // Later reads of this name snap to the full one.
      const known = settings?.knownPlayers ?? [];
      if (!known.includes(full)) await updateLevelCapSettings({ knownPlayers: [...known, full] });
    } finally {
      busy = false;
    }
  }

  async function saveRow(run: LevelCapRun, row: ReviewRow) {
    const key = `${run.id}:${row.slot}`;
    const name = row.name === null ? typed[`name:${key}`]?.trim() : undefined;
    const frame = row.frame === null ? typed[`frame:${key}`]?.trim() : undefined;
    if (busy || (!name && !frame)) return;
    busy = true;
    try {
      // A portrait's frame names every look like it; a row without one is fixed alone.
      const byPortrait = !!frame && !!row.portrait;
      const patch = { ...(name ? { name } : {}), ...(frame && !byPortrait ? { frame } : {}) };
      if (patch.name || patch.frame) {
        await fixLevelCapSquadmate(run.id, row.slot, mergedSquadFix(run, row.slot, patch));
      }
      if (byPortrait) await labelLevelCapPortrait(row.portrait!, frame!);
    } finally {
      busy = false;
    }
  }

  async function notAPlayer(run: LevelCapRun, slot: number) {
    if (busy) return;
    busy = true;
    try {
      await fixLevelCapSquadmate(run.id, slot, { notSquadmate: true });
    } finally {
      busy = false;
    }
  }

  const INPUT =
    "h-7 w-40 rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-bg-surface px-2 text-xs text-text-primary";
</script>

<ModalShell ariaLabel={$tr("analytics.names.title")} {onClose}>
  <div class="detail-panel analytics-builder-panel flex flex-col" data-analytics-name-review>
    <div class="detail-panel-top-actions">
      <button class="detail-close" aria-label={$tr("common.close")} onclick={onClose}
        >&times;</button
      >
    </div>
    <div class="border-b border-border/60 px-5 py-4 pr-14">
      <h2 class="m-0 text-lg text-text-heading">{$tr("analytics.names.title")}</h2>
      <p class="m-0 mt-1 text-xs text-text-secondary">{$tr("analytics.names.intro")}</p>
    </div>

    <div class="flex flex-col gap-5 p-5 text-xs">
      {#if !review.cutOff.length && !review.missing.length}
        <p class="m-0 py-6 text-center text-sm text-text-muted">{$tr("analytics.names.done")}</p>
      {/if}

      {#if review.cutOff.length}
        <section class="flex flex-col gap-3">
          <h3 class="m-0 text-sm font-semibold text-text-heading">
            {$tr("analytics.names.cutOff")}
          </h3>
          {#each review.cutOff as entry (entry.name)}
            <div
              class="grid gap-3 rounded-[var(--radius-md)] border border-border-subtle p-3 md:grid-cols-[minmax(0,20rem)_1fr]"
              data-name-review-cut={entry.name}
            >
              {#if crops[entry.rows[0].run.id]}
                <img src={crops[entry.rows[0].run.id]} alt="" class="block w-full rounded" />
              {:else}
                <div class="h-32 rounded bg-bg-raised"></div>
              {/if}
              <div class="flex flex-col gap-2">
                <span class="text-text-primary"
                  >{$tr("analytics.names.cutOffRuns", {
                    name: entry.name,
                    count: String(entry.rows.length),
                  })}</span
                >
                <form
                  class="flex flex-wrap items-center gap-2"
                  onsubmit={(e) => {
                    e.preventDefault();
                    void saveCutOff(entry.name, entry.rows);
                  }}
                >
                  <input
                    class={INPUT}
                    placeholder={$tr("analytics.names.fullName")}
                    aria-label={$tr("analytics.names.fullName")}
                    maxlength="64"
                    value={typed[`cut:${entry.name}`] ?? entry.name.replace(/…$/, "")}
                    oninput={(e) => (typed[`cut:${entry.name}`] = e.currentTarget.value)}
                  />
                  <ThemedButton type="submit" active disabled={busy}
                    >{$tr("common.save")}</ThemedButton
                  >
                </form>
              </div>
            </div>
          {/each}
        </section>
      {/if}

      {#if review.missing.length}
        <section class="flex flex-col gap-3">
          <h3 class="m-0 text-sm font-semibold text-text-heading">
            {$tr("analytics.names.missing")}
          </h3>
          {#each review.missing as entry (entry.run.id)}
            <div
              class="grid gap-3 rounded-[var(--radius-md)] border border-border-subtle p-3 md:grid-cols-[minmax(0,20rem)_1fr]"
              data-name-review-run={entry.run.id}
            >
              <div class="relative self-start">
                {#if crops[entry.run.id]}
                  <img src={crops[entry.run.id]} alt="" class="block w-full rounded" />
                  <!-- Each row being filled in, outlined where it sits on the picture. -->
                  {#each entry.rows as row, i (row.slot)}
                    {#if row.box}
                      <div
                        class="pointer-events-none absolute inset-x-0 rounded-sm border-2 {active ===
                        `${entry.run.id}:${row.slot}`
                          ? 'border-accent bg-accent/15'
                          : 'border-accent/40'}"
                        style="top:{row.box.top}%; height:{row.box.height}%"
                        data-name-review-box={row.slot}
                      >
                        <span
                          class="absolute -left-1 top-1/2 flex h-4 w-4 -translate-x-full -translate-y-1/2 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-[var(--text-on-accent)]"
                          >{i + 1}</span
                        >
                      </div>
                    {/if}
                  {/each}
                {:else}
                  <div class="h-32 rounded bg-bg-raised"></div>
                {/if}
              </div>
              <div class="flex flex-col gap-2">
                <span class="text-text-muted">{entry.run.frame} · {entry.run.id.slice(0, 10)}</span>
                {#each entry.rows as row, i (row.slot)}
                  {@const key = `${entry.run.id}:${row.slot}`}
                  <form
                    class="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] p-1 {active ===
                    key
                      ? 'bg-[var(--surface-hover)]'
                      : ''}"
                    data-name-review-row={row.slot}
                    onpointerenter={() => (active = key)}
                    onfocusin={() => (active = key)}
                    onsubmit={(e) => {
                      e.preventDefault();
                      void saveRow(entry.run, row);
                    }}
                  >
                    <span
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-[var(--text-on-accent)]"
                      >{i + 1}</span
                    >
                    {#if thumbs[key]}
                      <img src={thumbs[key]} alt="" class="h-[42px] w-12 shrink-0 rounded" />
                    {/if}
                    {#if row.name === null}
                      <input
                        class={INPUT}
                        placeholder={row.read ?? $tr("analytics.cond.playerName")}
                        aria-label={$tr("analytics.cond.playerName")}
                        maxlength="64"
                        list="analytics-review-players"
                        value={typed[`name:${key}`] ?? ""}
                        oninput={(e) => (typed[`name:${key}`] = e.currentTarget.value)}
                      />
                    {:else}
                      <span class="w-40 truncate text-text-primary">{row.name}</span>
                    {/if}
                    {#if row.frame === null}
                      <input
                        class={INPUT}
                        placeholder={$tr("analytics.split.frame")}
                        aria-label={$tr("analytics.split.frame")}
                        title={row.portrait ? $tr("analytics.names.frameHint") : undefined}
                        maxlength="64"
                        list="analytics-review-frames"
                        value={typed[`frame:${key}`] ?? ""}
                        oninput={(e) => (typed[`frame:${key}`] = e.currentTarget.value)}
                      />
                    {:else}
                      <span class="w-40 truncate text-text-secondary">{row.frame}</span>
                    {/if}
                    <ThemedButton type="submit" active disabled={busy}
                      >{$tr("common.save")}</ThemedButton
                    >
                    <ThemedButton
                      disabled={busy}
                      onClick={() => void notAPlayer(entry.run, row.slot)}
                      >{$tr("analytics.names.notPlayer")}</ThemedButton
                    >
                  </form>
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}
      <datalist id="analytics-review-players">
        {#each review.known as name (name)}
          <option value={name}></option>
        {/each}
      </datalist>
      <datalist id="analytics-review-frames">
        {#each frames as frame (frame)}
          <option value={frame}></option>
        {/each}
      </datalist>
    </div>
  </div>
</ModalShell>
