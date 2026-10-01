<script lang="ts">
  import { locale, tr, type MessageKey } from "../../lib/i18n.js";

  interface Props {
    sellNow: number;
    held: number;
    ducats: number;
    credits: number;
    endo: number;
    /** Leads with a mission count tile when set. */
    missions?: number;
  }

  interface Tile {
    key: string;
    labelKey: MessageKey;
    hintKey?: MessageKey;
    value: number;
  }

  const { sellNow, held, ducats, credits, endo, missions }: Props = $props();

  const estimateTiles = $derived<Tile[]>([
    {
      key: "sellNow",
      labelKey: "missions.sellNow",
      hintKey: "missions.sellNowHint",
      value: sellNow,
    },
    { key: "held", labelKey: "missions.held", hintKey: "missions.heldHint", value: held },
  ]);
  const otherTiles = $derived<Tile[]>([
    ...(missions === undefined
      ? []
      : [{ key: "missions", labelKey: "enemy.missions" as const, value: missions }]),
    {
      key: "ducats",
      labelKey: "missions.ducatValue",
      hintKey: "missions.ducatValueHint",
      value: ducats,
    },
    { key: "credits", labelKey: "common.credits", value: credits },
    { key: "endo", labelKey: "stats.endo", value: endo },
  ]);
</script>

{#snippet tiles(list: Tile[])}
  <dl class="m-0 flex flex-wrap gap-x-6 gap-y-2">
    {#each list as tile (tile.key)}
      <div
        class="min-w-0"
        data-reward-total={tile.key}
        title={tile.hintKey ? $tr(tile.hintKey) : undefined}
      >
        <dt class="text-[0.68rem] uppercase tracking-[0.06em] text-text-muted">
          {$tr(tile.labelKey)}
        </dt>
        <dd class="m-0 font-display text-lg tabular-nums text-text-primary">
          {tile.value.toLocaleString($locale)}
        </dd>
      </div>
    {/each}
  </dl>
{/snippet}

<div class="flex flex-wrap items-start gap-x-8 gap-y-3">
  <section class="flex min-w-0 flex-col gap-1" data-reward-group="estimate">
    <h4 class="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-accent">
      {$tr("missions.estimate")}
    </h4>
    {@render tiles(estimateTiles)}
  </section>
  <section class="flex min-w-0 flex-col gap-1 sm:ml-auto" data-reward-group="other">
    <div class="hidden h-4 sm:block" aria-hidden="true"></div>
    {@render tiles(otherTiles)}
  </section>
</div>
