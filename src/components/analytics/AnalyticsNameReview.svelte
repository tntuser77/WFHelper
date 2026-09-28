<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { invoke } from "../../lib/ipc.js";
  import { log } from "../../lib/log.js";
  import { fixLevelCapSquadmate, updateLevelCapSettings } from "../../stores/levelCap.js";
  import type { LevelCapRun, LevelCapSettings } from "../../types/ipc.js";
  import ModalShell from "../ModalShell.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import { namedSquadFix, squadNameReview } from "../../lib/analytics/squadNameReview.js";

  let {
    runs,
    settings,
    onClose,
  }: {
    runs: readonly LevelCapRun[];
    settings: LevelCapSettings | null;
    onClose: () => void;
  } = $props();

  const review = $derived(squadNameReview(runs));

  // Crops load once per run and stay while the window is open.
  let crops = $state<Record<string, string | null>>({});
  $effect(() => {
    const wanted = [
      ...review.cutOff.map((entry) => entry.rows[0].run.id),
      ...review.unnamed.map((entry) => entry.run.id),
    ];
    for (const id of wanted) {
      if (id in crops) continue;
      crops[id] = null;
      invoke("getLevelCapSquadCrop", id)
        .then((url) => (crops[id] = url))
        .catch((err) => log.warn("[Analytics] squad crop failed", String(err)));
    }
  });

  let typed = $state<Record<string, string>>({});
  let busy = $state(false);

  async function saveCutOff(name: string, rows: Array<{ run: LevelCapRun; slot: number }>) {
    // An untouched box still holds its starting text, and that is what gets saved.
    const full = (typed[`cut:${name}`] ?? name.replace(/…$/, "")).trim();
    if (!full || busy) return;
    busy = true;
    try {
      for (const { run, slot } of rows) {
        await fixLevelCapSquadmate(run.id, slot, namedSquadFix(run, slot, full));
      }
      // Later reads of this name snap to the full one.
      const known = settings?.knownPlayers ?? [];
      if (!known.includes(full)) await updateLevelCapSettings({ knownPlayers: [...known, full] });
    } finally {
      busy = false;
    }
  }

  async function saveRow(run: LevelCapRun, slot: number, notSquadmate = false) {
    const key = `row:${run.id}:${slot}`;
    const name = typed[key]?.trim();
    if (busy || (!name && !notSquadmate)) return;
    busy = true;
    try {
      await fixLevelCapSquadmate(
        run.id,
        slot,
        notSquadmate ? { notSquadmate: true } : namedSquadFix(run, slot, name!),
      );
    } finally {
      busy = false;
    }
  }

  const INPUT =
    "h-7 w-44 rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-bg-surface px-2 text-xs text-text-primary";
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
      {#if !review.cutOff.length && !review.unnamed.length}
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

      {#if review.unnamed.length}
        <section class="flex flex-col gap-3">
          <h3 class="m-0 text-sm font-semibold text-text-heading">
            {$tr("analytics.names.unnamed")}
          </h3>
          {#each review.unnamed as entry (entry.run.id)}
            <div
              class="grid gap-3 rounded-[var(--radius-md)] border border-border-subtle p-3 md:grid-cols-[minmax(0,20rem)_1fr]"
              data-name-review-run={entry.run.id}
            >
              {#if crops[entry.run.id]}
                <img src={crops[entry.run.id]} alt="" class="block w-full rounded" />
              {:else}
                <div class="h-32 rounded bg-bg-raised"></div>
              {/if}
              <div class="flex flex-col gap-2">
                <span class="text-text-muted">{entry.run.frame} · {entry.run.id.slice(0, 10)}</span>
                {#each entry.rows as row (row.slot)}
                  <form
                    class="flex flex-wrap items-center gap-2"
                    onsubmit={(e) => {
                      e.preventDefault();
                      void saveRow(entry.run, row.slot);
                    }}
                  >
                    <span class="w-28 text-text-secondary"
                      >{$tr("analytics.names.row", { row: String(row.slot + 1) })}{row.frame
                        ? ` · ${row.frame}`
                        : ""}</span
                    >
                    <input
                      class={INPUT}
                      placeholder={row.read ?? $tr("analytics.cond.playerName")}
                      aria-label={$tr("analytics.cond.playerName")}
                      maxlength="64"
                      list="analytics-review-players"
                      value={typed[`row:${entry.run.id}:${row.slot}`] ?? ""}
                      oninput={(e) =>
                        (typed[`row:${entry.run.id}:${row.slot}`] = e.currentTarget.value)}
                    />
                    <ThemedButton type="submit" active disabled={busy}
                      >{$tr("common.save")}</ThemedButton
                    >
                    <ThemedButton
                      disabled={busy}
                      onClick={() => void saveRow(entry.run, row.slot, true)}
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
    </div>
  </div>
</ModalShell>
