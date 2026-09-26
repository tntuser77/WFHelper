<script lang="ts">
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import type {
    LevelCapCatalog,
    LevelCapItem,
    LevelCapSlotKind,
  } from "../../../config/shared/levelCapTypes.js";
  import { itemDb } from "../../stores/data.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { levelCapSlotLayout, type LevelCapUpgradeRole } from "../../lib/levelCap.js";
  import LevelCapModCard from "./LevelCapModCard.svelte";

  let {
    kind,
    item,
    catalog,
    selected = null,
    onSelect,
  }: {
    kind: LevelCapSlotKind;
    item: LevelCapItem;
    /** Rarity and max rank; the grid still draws without it. */
    catalog: LevelCapCatalog | null;
    selected?: number | null;
    /** Absent in read-only views. */
    onSelect?: (slot: number) => void;
  } = $props();

  const layout = $derived(levelCapSlotLayout(kind, item));
  const info = $derived(
    new Map([...(catalog?.mods ?? []), ...(catalog?.arcanes ?? [])].map((e) => [e.type, e])),
  );
  // The game's layout: special slots on top, regular mods in rows of four, arcanes last.
  const top = $derived(layout.filter((s) => s.role !== "mod" && s.role !== "arcane"));
  const mods = $derived(layout.filter((s) => s.role === "mod"));
  const arcanes = $derived(layout.filter((s) => s.role === "arcane"));

  function upgradeAt(slot: number) {
    return item.upgrades.find((u) => u.slot === slot) ?? null;
  }

  function nameOf(type: string | null | undefined): string {
    if (!type) return "";
    return itemLabel($itemDb[type]) || info.get(type)?.name || fallbackNameFromUniqueName(type);
  }
</script>

{#snippet card(spec: { slot: number; role: LevelCapUpgradeRole })}
  {@const upgrade = upgradeAt(spec.slot)}
  {@const meta = upgrade?.type ? info.get(upgrade.type) : undefined}
  <LevelCapModCard
    {upgrade}
    role={spec.role}
    name={nameOf(upgrade?.type)}
    maxRank={meta?.maxRank ?? null}
    rarity={meta?.rarity ?? null}
    selected={selected === spec.slot}
    onSelect={onSelect ? () => onSelect(spec.slot) : undefined}
  />
{/snippet}

<div class="flex flex-col gap-2" data-level-cap-mod-grid={kind}>
  {#if top.length}
    <div class="grid grid-cols-4 gap-2">
      <span class="hidden sm:block"></span>
      {#each top as spec (spec.slot)}
        {@render card(spec)}
      {/each}
    </div>
  {/if}
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {#each mods as spec (spec.slot)}
      {@render card(spec)}
    {/each}
  </div>
  {#if arcanes.length}
    <div class="grid grid-cols-4 gap-2">
      <span class="hidden sm:block"></span>
      {#each arcanes as spec (spec.slot)}
        {@render card(spec)}
      {/each}
    </div>
  {/if}
</div>
