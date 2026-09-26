<script lang="ts">
  import type { LevelCapItem } from "../../../config/shared/levelCapTypes.js";
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import { itemDb } from "../../stores/data.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import { levelCapUpgradeRole } from "../../lib/levelCap.js";
  import {
    archonShardIconUrl,
    archonShardUpgradeLabel,
    parseArchonShardSlot,
  } from "../../lib/inventory/archonShards.js";
  import { underframeUrl } from "../../lib/underframe.js";
  import Self from "./LevelCapItemCard.svelte";

  let {
    item,
    label,
    abilityNames = {},
  }: { item: LevelCapItem; label: MessageKey; abilityNames?: Record<string, string> } = $props();

  const ROLE_KEYS: Record<string, MessageKey> = {
    aura: "levelCap.role.aura",
    exilus: "levelCap.role.exilus",
    stance: "levelCap.role.stance",
  };

  function nameOf(type: string | null): string {
    if (!type) return "?";
    return itemLabel($itemDb[type]) || fallbackNameFromUniqueName(type);
  }

  const upgrades = $derived(
    [...item.upgrades]
      .sort((a, b) => a.slot - b.slot)
      .map((upgrade) => ({ upgrade, role: levelCapUpgradeRole(item.kind, upgrade) })),
  );
  const mods = $derived(upgrades.filter((u) => u.role !== "arcane"));
  const arcanes = $derived(upgrades.filter((u) => u.role === "arcane"));
  const helminth = $derived(
    item.helminth
      ? (abilityNames[item.helminth.ability] ?? fallbackNameFromUniqueName(item.helminth.ability))
      : null,
  );
  // Underframe matches English names, which is what `name` holds in every locale.
  const link = $derived(underframeUrl(item, (type) => $itemDb[type]?.name ?? null, helminth));
</script>

<div
  class="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40 p-3"
>
  <div class="flex items-center gap-2">
    {#if $itemDb[item.type]?.imageUrl}
      <img src={$itemDb[item.type].imageUrl ?? ""} alt="" class="h-8 w-8 shrink-0 object-contain" />
    {/if}
    <div class="flex min-w-0 flex-col">
      <span class="text-[10px] uppercase tracking-wide text-text-muted">{$t(label)}</span>
      <span class="truncate text-sm font-semibold text-text-primary">{nameOf(item.type)}</span>
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
          {archonShardUpgradeLabel(shard.type)}
        </span>
      {/each}
    </div>
  {/if}

  {#if mods.length}
    <ul class="m-0 grid list-none grid-cols-1 gap-x-3 gap-y-0.5 p-0 text-xs sm:grid-cols-2">
      {#each mods as { upgrade, role } (upgrade.slot)}
        <li class="flex items-center gap-1.5 text-text-secondary">
          {#if ROLE_KEYS[role]}
            <span class="text-[10px] uppercase tracking-wide text-text-muted"
              >{$t(ROLE_KEYS[role])}</span
            >
          {/if}
          <span class="truncate">{nameOf(upgrade.type)}</span>
          {#if upgrade.rank !== null}<span class="text-text-muted">R{upgrade.rank}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if arcanes.length}
    <div class="flex flex-wrap gap-1.5 text-xs">
      {#each arcanes as { upgrade } (upgrade.slot)}
        <span class="rounded border border-warning/40 px-1.5 py-0.5 text-warning"
          >{nameOf(upgrade.type)}{upgrade.rank !== null ? ` R${upgrade.rank}` : ""}</span
        >
      {/each}
    </div>
  {/if}

  {#if item.weapon}
    <Self item={item.weapon} label="levelCap.build.companion" {abilityNames} />
  {/if}
</div>
