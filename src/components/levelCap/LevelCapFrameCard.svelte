<script lang="ts">
  import type { LevelCapNamedBuild, LevelCapRun } from "../../types/ipc.js";
  import { itemDb } from "../../stores/data.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import {
    levelCapGearUse,
    levelCapItemImage,
    levelCapItemName,
    levelCapTagSuggestions,
    orderLevelCapTags,
    type LevelCapFrameRow,
    type LevelCapItemRef,
  } from "../../lib/levelCap.js";

  let {
    row,
    matchedCount,
    runs,
    builds,
    searchTerms,
    tagOrder,
    onOpen,
    onSearchTag,
    onClearTag,
  }: {
    row: LevelCapFrameRow;
    /** Runs matching the current search; falls back to the frame total when nothing matches by player. */
    matchedCount: number;
    runs: LevelCapRun[];
    builds: LevelCapNamedBuild[];
    /** Lowercased comma-separated search terms. */
    searchTerms: string[];
    /** App-wide tag order, so every card lists shared tags alike. */
    tagOrder: string[];
    onOpen: () => void;
    onSearchTag: (tag: string) => void;
    onClearTag: (tag: string) => void;
  } = $props();

  const SLOT_KEYS: Record<string, MessageKey> = {
    primary: "profile.primaryWeapon",
    secondary: "profile.secondaryWeapon",
    melee: "rivens.type.melee",
    archgun: "rivens.type.archgun",
    companion: "levelCap.build.companion",
  };

  const gear = $derived(levelCapGearUse(runs));
  const allTags = $derived(orderLevelCapTags(levelCapTagSuggestions(builds), tagOrder));
  const tags = $derived(allTags.slice(0, 3));
  const hiddenTags = $derived(allTags.slice(3));
  let showAllTags = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  // The panel sits below the chip across the row gap, so closing waits a beat
  // for the pointer to cross into it.
  function openTags(): void {
    clearTimeout(hideTimer);
    showAllTags = true;
  }

  function closeTagsSoon(): void {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (showAllTags = false), 150);
  }

  function isSearched(tag: string): boolean {
    return searchTerms.includes(tag.toLowerCase());
  }

  /** Every item run in the slot with its count, for the hover. */
  function slotTitle(slot: string, items: Array<{ item: LevelCapItemRef; count: number }>): string {
    const label = $t(SLOT_KEYS[slot]);
    if (!items.length) return label;
    return [
      label,
      ...items.map(({ item, count }) => `${levelCapItemName(item, $itemDb)} × ${count}`),
    ].join("\n");
  }
</script>

{#snippet tagChip(tag: string)}
  <button
    type="button"
    class="cursor-pointer rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors duration-100 {isSearched(
      tag,
    )
      ? 'border-info bg-info/25 text-text-primary'
      : 'border-info/40 bg-info/10 text-info hover:border-info'}"
    title={$t("levelCap.tagHint")}
    onclick={(event) => {
      event.stopPropagation();
      onSearchTag(tag);
    }}
    oncontextmenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onClearTag(tag);
    }}>{tag}</button
  >
{/snippet}

<!-- A container, not a button, so the tags can be buttons of their own. Clicks
     anywhere else bubble up here; the frame name is the keyboard entry point. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
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
    <!-- No handler of its own: its click bubbles to the card, so Enter opens it too. -->
    <button
      type="button"
      class="min-w-0 flex-1 cursor-pointer truncate text-left text-xl font-bold text-text-primary"
      >{row.frame}</button
    >
    <span class="font-mono text-3xl font-bold text-accent">{matchedCount}</span>
  </div>

  <div class="flex min-h-5 flex-wrap gap-1">
    {#each tags as tag (tag)}
      {@render tagChip(tag)}
    {/each}
    {#if hiddenTags.length}
      <span
        class="rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors duration-100 {showAllTags
          ? 'border-info/40 text-info'
          : 'border-border text-text-secondary'} bg-bg-surface"
        role="presentation"
        onmouseenter={openTags}
        onmouseleave={closeTagsSoon}
        data-level-cap-more-tags>+{hiddenTags.length}</span
      >
    {/if}
  </div>

  <div class="relative grid gap-2 {gear.length > 4 ? 'grid-cols-5' : 'grid-cols-4'}">
    {#each gear as { slot, items } (slot)}
      {@const top = items[0]}
      {@const art = top ? levelCapItemImage(top.item, $itemDb) : null}
      <div
        class="relative flex aspect-square items-center justify-center rounded-[var(--radius-md)] {top
          ? 'bg-bg-raised'
          : 'border border-dashed border-border'}"
        title={slotTitle(slot, items)}
      >
        {#if art}
          <img src={art} alt="" class="h-4/5 w-4/5 object-contain" />
        {:else if top}
          <span class="px-1 text-center text-[10px] leading-tight text-text-secondary"
            >{levelCapItemName(top.item, $itemDb)}</span
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
    {#if showAllTags}
      <!-- Grows past the gear row into the card padding rather than clipping. -->
      <div
        role="presentation"
        onmouseenter={openTags}
        onmouseleave={closeTagsSoon}
        class="absolute inset-x-0 top-0 z-10 flex min-h-full flex-wrap content-center gap-1 rounded-[var(--radius-md)] border border-border-strong bg-bg-surface/95 p-2"
      >
        {#each hiddenTags as tag (tag)}
          {@render tagChip(tag)}
        {/each}
      </div>
    {/if}
  </div>

  {#if row.unverified}
    <span
      class="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-warning"
      title={$t("levelCap.unverifiedCount", { count: String(row.unverified) })}
    ></span>
  {/if}
</div>
