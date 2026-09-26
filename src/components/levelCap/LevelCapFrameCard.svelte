<script lang="ts">
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import type { LevelCapNamedBuild, LevelCapRun } from "../../types/ipc.js";
  import { itemDb } from "../../stores/data.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import {
    levelCapGearUse,
    levelCapTagSuggestions,
    type LevelCapFrameRow,
  } from "../../lib/levelCap.js";

  let {
    row,
    runs,
    builds,
    onOpen,
  }: {
    row: LevelCapFrameRow;
    runs: LevelCapRun[];
    builds: LevelCapNamedBuild[];
    onOpen: () => void;
  } = $props();

  const SLOT_KEYS: Record<string, MessageKey> = {
    primary: "profile.primaryWeapon",
    secondary: "profile.secondaryWeapon",
    melee: "rivens.type.melee",
    companion: "levelCap.build.companion",
  };

  const gear = $derived(levelCapGearUse(runs));
  const tags = $derived(levelCapTagSuggestions(builds).slice(0, 3));

  function nameOf(type: string): string {
    return itemLabel($itemDb[type]) || fallbackNameFromUniqueName(type);
  }

  /** Every item run in the slot with its count, for the hover. */
  function slotTitle(slot: string, items: Array<{ type: string; count: number }>): string {
    const label = $t(SLOT_KEYS[slot]);
    if (!items.length) return label;
    return [label, ...items.map((item) => `${nameOf(item.type)} × ${item.count}`)].join("\n");
  }
</script>

<button
  type="button"
  class="relative flex w-full cursor-pointer flex-col gap-3 rounded-[var(--radius-lg)] border border-[color:var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 text-left transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-accent"
  onclick={onOpen}
  data-level-cap-frame={row.frame}
>
  <div class="flex items-center gap-3">
    <div
      class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-bg-raised"
    >
      {#if row.frameType && $itemDb[row.frameType]?.imageUrl}
        <img
          src={$itemDb[row.frameType].imageUrl ?? ""}
          alt=""
          class="h-full w-full object-contain"
        />
      {/if}
    </div>
    <span class="min-w-0 flex-1 truncate text-xl font-bold text-text-primary">{row.frame}</span>
    <span class="font-mono text-3xl font-bold text-accent">{row.count}</span>
  </div>

  <div class="flex min-h-5 flex-wrap gap-1">
    {#each tags as tag (tag)}
      <span
        class="rounded border border-info/40 bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info"
        >{tag}</span
      >
    {/each}
  </div>

  <div class="grid grid-cols-4 gap-2">
    {#each gear as { slot, items } (slot)}
      {@const top = items[0]}
      <div
        class="relative flex aspect-square items-center justify-center rounded-[var(--radius-md)] {top
          ? 'bg-bg-raised'
          : 'border border-dashed border-border'}"
        title={slotTitle(slot, items)}
      >
        {#if top && $itemDb[top.type]?.imageUrl}
          <img src={$itemDb[top.type].imageUrl ?? ""} alt="" class="h-4/5 w-4/5 object-contain" />
        {:else if top}
          <span class="px-1 text-center text-[10px] leading-tight text-text-secondary"
            >{nameOf(top.type)}</span
          >
        {/if}
        {#if items.length > 1}
          <span
            class="absolute -right-1 -top-1 rounded-full border border-border bg-bg-surface px-1 text-[10px] font-semibold text-text-secondary"
            >+{items.length - 1}</span
          >
        {/if}
      </div>
    {/each}
  </div>

  {#if row.unverified}
    <span
      class="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-warning"
      title={$t("levelCap.unverifiedCount", { count: String(row.unverified) })}
    ></span>
  {/if}
</button>
