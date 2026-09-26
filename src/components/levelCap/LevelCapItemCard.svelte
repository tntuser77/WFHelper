<script lang="ts">
  import type { LevelCapCatalog, LevelCapItem } from "../../../config/shared/levelCapTypes.js";
  import { ARCHON_SHARD_EFFECTS } from "../../../config/shared/archonShardCatalog.js";
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import { itemDb } from "../../stores/data.js";
  import { loadLevelCapCatalog } from "../../stores/levelCap.js";
  import { levelCapItemImage, levelCapItemName } from "../../lib/levelCap.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import { log } from "../../lib/log.js";
  import {
    archonShardIconUrl,
    archonShardUpgradeLabel,
    parseArchonShardSlot,
  } from "../../lib/inventory/archonShards.js";
  import { underframeUrl } from "../../lib/underframe.js";
  import LevelCapModGrid from "./LevelCapModGrid.svelte";
  import Self from "./LevelCapItemCard.svelte";

  let {
    item,
    label,
    abilityNames = {},
  }: { item: LevelCapItem; label: MessageKey; abilityNames?: Record<string, string> } = $props();

  let catalog = $state<LevelCapCatalog | null>(null);
  $effect(() => {
    loadLevelCapCatalog()
      .then((value) => (catalog = value))
      .catch((err) => log.warn("[LevelCap] catalogue failed", String(err)));
  });

  const helminth = $derived(
    item.helminth
      ? (abilityNames[item.helminth.ability] ?? fallbackNameFromUniqueName(item.helminth.ability))
      : null,
  );
  // Underframe matches English names, which is what `name` holds in every locale.
  const link = $derived(underframeUrl(item, (type) => $itemDb[type]?.name ?? null, helminth));
</script>

<div
  class="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40 p-3"
>
  <div class="flex items-center gap-2">
    {#if levelCapItemImage(item, $itemDb)}
      <img
        src={levelCapItemImage(item, $itemDb) ?? ""}
        alt=""
        class="h-10 w-10 shrink-0 object-contain"
      />
    {/if}
    <div class="flex min-w-0 flex-col">
      <span class="text-[10px] uppercase tracking-wide text-text-muted">{$t(label)}</span>
      <span class="truncate text-base font-semibold text-text-primary"
        >{levelCapItemName(item, $itemDb)}</span
      >
    </div>
    <span class="ml-auto text-[10px] uppercase tracking-wide text-text-muted">
      {item.configName ||
        $t("levelCap.build.config", { letter: String.fromCharCode(65 + item.config) })}
    </span>
    {#if link}
      <button
        type="button"
        class="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-info hover:border-info"
        title={$t("levelCap.underframeTitle")}
        onclick={() => window.api?.openExternal?.(link)}>Underframe</button
      >
    {/if}
  </div>

  {#if helminth || item.shards?.length}
    <div class="flex flex-wrap items-center gap-1.5 text-xs">
      {#if helminth}
        <span class="rounded border border-accent/40 px-1.5 py-0.5 text-accent"
          >{$t("levelCap.build.helminth")}: {helminth}</span
        >
      {/if}
      {#each item.shards ?? [] as shard, i (i)}
        {@const slot = parseArchonShardSlot({ Color: shard.color, UpgradeType: shard.type }, i)}
        {@const icon = archonShardIconUrl($itemDb, slot.color, slot.tauforged)}
        <span
          class="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-text-secondary"
        >
          {#if icon}<img src={icon} alt="" class="h-4 w-4 object-contain" />{/if}
          {ARCHON_SHARD_EFFECTS.find((e) => e.type === shard.type)?.effect ??
            archonShardUpgradeLabel(shard.type)}
        </span>
      {/each}
    </div>
  {/if}

  {#if item.upgrades.length}
    <LevelCapModGrid kind={item.kind} {item} {catalog} />
  {/if}

  {#if item.weapon}
    <Self item={item.weapon} label="levelCap.build.companion" {abilityNames} />
  {/if}
</div>
