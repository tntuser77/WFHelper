<script lang="ts">
  import { PLATINUM_ICON_URL } from "../../lib/assetUrls.js";
  import { formatNumber } from "../../lib/format.js";
  import { locale, tr } from "../../lib/i18n.js";
  import {
    buildRelicPoolRows,
    filterRelicPoolRows,
    resurgenceRelicKeys,
    setRelicsInPool,
    type RelicPoolRow,
  } from "../../lib/missionRelicPool.js";
  import { itemDb } from "../../stores/data.js";
  import { getCachedMedian } from "../../stores/hydration/hydrationCacheHelpers.js";
  import { missionRelicPool, updateMissionRelicPool } from "../../stores/missionRelicPool.js";
  import { priceCacheRevision } from "../../stores/pricing.js";
  import { relicDb } from "../../stores/relics.js";
  import { worldData } from "../../stores/world.js";
  import ModalShell from "../ModalShell.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedInput from "../ThemedInput.svelte";

  interface Props {
    onClose: () => void;
  }

  const { onClose }: Props = $props();

  let search = $state("");
  let goldFilter = $state("");
  let resurgenceOnly = $state(false);

  const resurgence = $derived(
    resurgenceRelicKeys(
      $relicDb,
      ($worldData?.vaultTrader?.inventory ?? []).flatMap((offer) =>
        offer.uniqueName ? [offer.uniqueName] : [],
      ),
      $itemDb,
    ),
  );
  const rows = $derived.by(() => {
    void $priceCacheRevision;
    return buildRelicPoolRows($relicDb, $missionRelicPool, getCachedMedian, resurgence);
  });
  const shown = $derived(
    filterRelicPoolRows(rows, {
      search,
      goldAtLeast: numberOrNull(goldFilter),
      resurgenceOnly,
    }),
  );
  const pooled = $derived(rows.filter((row) => row.inPool).length);
  const ruleText = $derived(
    $missionRelicPool.goldAtLeast === null ? "" : String($missionRelicPool.goldAtLeast),
  );

  function numberOrNull(text: string | number): number | null {
    const value = typeof text === "number" ? text : text.trim() === "" ? Number.NaN : Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function setRule(text: string): void {
    updateMissionRelicPool((settings) => ({ ...settings, goldAtLeast: numberOrNull(text) }));
  }

  function setShown(inPool: boolean): void {
    const targets = shown;
    updateMissionRelicPool((settings) => setRelicsInPool(settings, targets, inPool));
  }

  function toggle(row: RelicPoolRow): void {
    updateMissionRelicPool((settings) => setRelicsInPool(settings, [row], !row.inPool));
  }
</script>

<ModalShell ariaLabel={$tr("missions.relicPool")} {onClose}>
  <div
    class="relative z-10 flex max-h-[85vh] w-[min(46rem,92vw)] flex-col gap-3 overflow-hidden rounded-[var(--radius-xl)] border border-border-strong bg-bg-surface p-4 shadow-[var(--ui-panel-shadow)]"
    data-relic-pool
  >
    <div class="flex shrink-0 flex-wrap items-start justify-between gap-2">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="text-sm font-semibold uppercase tracking-wide text-text-muted">
          {$tr("missions.relicPool")}
        </span>
        <span class="text-xs text-text-muted">{$tr("missions.relicPool.hint")}</span>
      </div>
      <ThemedButton onClick={onClose}>{$tr("common.close")}</ThemedButton>
    </div>

    <label
      class="flex shrink-0 flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40 px-3 py-2 text-xs text-text-secondary"
      title={$tr("missions.relicPool.ruleTitle")}
    >
      <span>{$tr("missions.relicPool.rule")}</span>
      <input
        type="number"
        min="0"
        value={ruleText}
        class="w-20 rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-[var(--ui-control-bg)] px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-dim"
        data-relic-pool-rule
        onchange={(event) => setRule(event.currentTarget.value)}
        oncontextmenu={(event) => {
          event.preventDefault();
          setRule("");
        }}
      />
      <img src={PLATINUM_ICON_URL} alt={$tr("common.platinum")} class="h-3 w-3 object-contain" />
    </label>

    <div class="flex shrink-0 flex-wrap items-center gap-2 text-xs">
      <div
        class="min-w-[10rem] flex-1"
        role="presentation"
        oncontextmenu={(event) => {
          event.preventDefault();
          search = "";
        }}
      >
        <ThemedInput bind:value={search} placeholder={$tr("common.searchPlaceholder")} />
      </div>
      <label class="flex items-center gap-1.5 text-text-secondary">
        <span>{$tr("relics.goldAtLeastLabel")}</span>
        <input
          type="number"
          min="0"
          bind:value={goldFilter}
          class="w-16 rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] bg-[var(--ui-control-bg)] px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-dim"
          data-relic-pool-gold-filter
          oncontextmenu={(event) => {
            event.preventDefault();
            goldFilter = "";
          }}
        />
      </label>
      <ThemedButton
        active={resurgenceOnly}
        disabled={resurgence.size === 0}
        onClick={() => (resurgenceOnly = !resurgenceOnly)}
      >
        {$tr("missions.relicPool.resurgence")}
      </ThemedButton>
    </div>

    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
      <span class="text-text-muted" data-relic-pool-count={pooled}>
        {$tr("missions.relicPool.count", {
          count: formatNumber(pooled, $locale),
          total: formatNumber(rows.length, $locale),
        })}
      </span>
      <div class="flex items-center gap-2">
        <ThemedButton disabled={shown.length === 0} onClick={() => setShown(true)}>
          {$tr("missions.relicPool.selectShown", { count: formatNumber(shown.length, $locale) })}
        </ThemedButton>
        <ThemedButton disabled={shown.length === 0} onClick={() => setShown(false)}>
          {$tr("missions.relicPool.clearShown")}
        </ThemedButton>
      </div>
    </div>

    {#if shown.length === 0}
      <p class="m-0 py-6 text-center text-sm text-text-muted">{$tr("missions.noMatch")}</p>
    {:else}
      <ul class="m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p-0">
        {#each shown as row (row.key)}
          <li data-relic-pool-row={row.key}>
            <label
              class="flex min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-1 py-1 text-sm text-text-secondary hover:bg-bg-raised"
            >
              <input type="checkbox" checked={row.inPool} onchange={() => toggle(row)} />
              <span class="w-24 shrink-0 text-text-primary">{row.name}</span>
              {#if row.vaulted}<span
                  class="vault-badge vault-badge--inline shrink-0"
                  title={$tr("common.vaulted")}>V</span
                >{/if}
              <span class="min-w-0 flex-1 truncate text-xs">{row.goldName ?? ""}</span>
              <span class="inline-flex w-16 shrink-0 items-center justify-end gap-1 tabular-nums">
                {#if row.gold === null}-{:else}{row.gold.toLocaleString($locale)}<img
                    src={PLATINUM_ICON_URL}
                    alt=""
                    class="h-3 w-3 object-contain"
                  />{/if}
              </span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</ModalShell>
