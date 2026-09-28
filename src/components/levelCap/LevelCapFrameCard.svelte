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
    type LevelCapGearItemUse,
  } from "../../lib/levelCap.js";

  let {
    row,
    matchedCount,
    runs,
    builds,
    searchTerms,
    tagOrder,
    onOpen,
    onOpenBuild,
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
    /** Opens the frame window on this build's editor, at the slot that was clicked. */
    onOpenBuild: (buildId: string, slot: string) => void;
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

  // Slots the frame never filled stay off the card.
  const gear = $derived(levelCapGearUse(runs).filter(({ items }) => items.length));
  const buildNames = $derived(new Map(builds.map((b) => [b.id, b.name])));
  let openSlot = $state<string | null>(null);
  let slotTimer: ReturnType<typeof setTimeout> | undefined;

  function showSlot(slot: string): void {
    clearTimeout(slotTimer);
    openSlot = slot;
  }

  function hideSlotSoon(): void {
    clearTimeout(slotTimer);
    slotTimer = setTimeout(() => (openSlot = null), 150);
  }
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

  function openBuild(id: string | null, slot: string): void {
    if (id) onOpenBuild(id, slot);
    else onOpen();
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

{#snippet slotPanel(slot: string, items: LevelCapGearItemUse[])}
  <!-- Each weapon with the builds that ran it; a row opens the frame window on that build. -->
  <div
    role="presentation"
    class="absolute inset-x-0 top-full z-30 mt-1 flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-border-strong bg-bg-surface p-1.5 shadow-lg"
    onmouseenter={() => showSlot(slot)}
    onmouseleave={hideSlotSoon}
    data-level-cap-slot-panel={slot}
  >
    <span class="px-1 pb-0.5 text-[10px] uppercase tracking-wide text-text-muted"
      >{$t(SLOT_KEYS[slot])}</span
    >
    {#each items as { item, count, builds: used, sameMods, weapons } (item)}
      {@const art = levelCapItemImage(item, $itemDb)}
      <!-- One row per item; clicking it opens its most-used build, a chip opens that one. -->
      <div class="flex flex-col gap-1 rounded px-1 py-1 hover:bg-bg-raised">
        <button
          type="button"
          class="flex cursor-pointer items-center gap-2 text-left"
          onclick={(event) => {
            event.stopPropagation();
            openBuild(used[0]?.id ?? null, slot);
          }}
        >
          <span class="flex h-6 w-6 shrink-0 items-center justify-center">
            {#if art}<img src={art} alt="" class="h-full w-full object-contain" />{/if}
          </span>
          <span class="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary"
            >{levelCapItemName(item, $itemDb)}</span
          >
          <span class="font-mono text-xs font-semibold text-accent">×{count}</span>
        </button>
        {#each weapons as weapon (weapon)}
          {@const weaponArt = levelCapItemImage(weapon, $itemDb)}
          <span class="flex items-center gap-1.5 pl-8 text-[11px] text-text-secondary">
            {#if weaponArt}<img src={weaponArt} alt="" class="h-4 w-4 object-contain" />{/if}
            <span class="truncate">{levelCapItemName(weapon, $itemDb)}</span>
          </span>
        {/each}
        <div class="flex flex-wrap items-center gap-1 pl-8">
          {#each used as use (use.id)}
            <button
              type="button"
              class="cursor-pointer rounded border border-border bg-bg-surface px-1.5 py-0.5 text-[10px] text-text-secondary hover:border-accent hover:text-text-primary"
              onclick={(event) => {
                event.stopPropagation();
                openBuild(use.id, slot);
              }}
              >{use.id ? (buildNames.get(use.id) ?? "") : $t("levelCap.builds.noBuild")}
              <span class="font-mono text-accent">{use.count}</span></button
            >
          {/each}
          {#if used.length > 1}
            <span
              class="text-[10px] {sameMods ? 'text-text-muted' : 'text-warning'}"
              title={$t(sameMods ? "levelCap.gear.sameModsHint" : "levelCap.gear.modsDifferHint")}
              >{$t(sameMods ? "levelCap.gear.sameMods" : "levelCap.gear.modsDiffer")}</span
            >
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/snippet}

<!-- A container, not a button, so the tags can be buttons of their own. Clicks
     anywhere else bubble up here; the frame name is the keyboard entry point. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="relative flex w-full cursor-pointer flex-col gap-3 rounded-[var(--radius-lg)] border border-[color:var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 text-left transition-[border-color,transform] duration-150 hover:z-20 hover:-translate-y-0.5 hover:border-accent"
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
      {@const art = levelCapItemImage(top.item, $itemDb)}
      <!-- The most-used item's build opens on click; the hover lists the rest. -->
      <button
        type="button"
        class="relative flex aspect-square cursor-pointer items-center justify-center rounded-[var(--radius-md)] bg-bg-raised transition-colors hover:bg-bg-surface"
        aria-label={$t(SLOT_KEYS[slot])}
        onmouseenter={() => showSlot(slot)}
        onmouseleave={hideSlotSoon}
        onfocus={() => showSlot(slot)}
        onblur={hideSlotSoon}
        onclick={(event) => {
          event.stopPropagation();
          openBuild(top.builds[0]?.id ?? null, slot);
        }}
        data-level-cap-slot={slot}
      >
        {#if art}
          <img src={art} alt="" class="h-4/5 w-4/5 object-contain" />
        {:else}
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
      </button>
    {/each}
    {#if openSlot}
      {@const open = gear.find((g) => g.slot === openSlot)}
      {#if open}
        {@render slotPanel(open.slot, open.items)}
      {/if}
    {/if}
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
