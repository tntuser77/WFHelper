<script lang="ts">
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import type {
    LevelCapCatalog,
    LevelCapItem,
    LevelCapSlotKind,
  } from "../../../config/shared/levelCapTypes.js";
  import { itemDb } from "../../stores/data.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import { levelCapSlotLayout, type LevelCapUpgradeRole } from "../../lib/levelCap.js";
  import {
    archonShardColorKey,
    archonShardUpgradeLabel,
    parseArchonShardSlot,
  } from "../../lib/inventory/archonShards.js";
  import LevelCapPicker from "./LevelCapPicker.svelte";

  let {
    kind,
    label,
    item,
    catalog,
    itemOptions,
    abilityNames = {},
    removable = true,
    onChange,
  }: {
    kind: LevelCapSlotKind;
    label: MessageKey;
    item: LevelCapItem | null;
    catalog: LevelCapCatalog;
    /** Items this slot may hold; the frame slot only offers variants of the build's frame. */
    itemOptions: LevelCapCatalog["suits"];
    abilityNames?: Record<string, string>;
    removable?: boolean;
    onChange: (item: LevelCapItem | null) => void;
  } = $props();

  const ROLE_KEYS: Record<LevelCapUpgradeRole, MessageKey> = {
    mod: "levelCap.role.mod",
    aura: "levelCap.role.aura",
    exilus: "levelCap.role.exilus",
    stance: "levelCap.role.stance",
    arcane: "levelCap.role.arcane",
  };
  // Socket colours as the inventory writes them; _MYTHIC is tauforged.
  const SHARD_COLORS = [
    "ACC_RED",
    "ACC_YELLOW",
    "ACC_BLUE",
    "ACC_GREEN",
    "ACC_ORANGE",
    "ACC_PURPLE",
  ].flatMap((acc) => [acc, `${acc}_MYTHIC`]);
  const SHARD_SOCKETS = 5;

  /** "item", "helminth", or the upgrade slot number being picked. */
  let picking = $state<"item" | "helminth" | number | null>(null);
  /** Ability slot chosen before the Helminth ability itself is picked. */
  let helminthIndex = $state(3);

  const layout = $derived(levelCapSlotLayout(kind, item));
  const upgradeInfo = $derived(
    new Map([...catalog.mods, ...catalog.arcanes].map((entry) => [entry.type, entry])),
  );
  const abilityName = (type: string) =>
    abilityNames[type] ??
    catalog.abilities.find((a) => a.type === type)?.name ??
    fallbackNameFromUniqueName(type);

  function nameOf(type: string | null): string {
    if (!type) return "?";
    return (
      itemLabel($itemDb[type]) ||
      upgradeInfo.get(type)?.name ||
      itemOptions.find((o) => o.type === type)?.name ||
      fallbackNameFromUniqueName(type)
    );
  }

  function shardLabel(color: string): string {
    const parsed = parseArchonShardSlot({ Color: color, UpgradeType: "x" }, 0);
    if (!parsed.color) return color;
    const name = $t(archonShardColorKey(parsed.color));
    return parsed.tauforged ? `${name} (${$t("archon.tauforged")})` : name;
  }

  function upgradeAt(slot: number) {
    return item?.upgrades.find((u) => u.slot === slot) ?? null;
  }

  function pickItem(type: string): void {
    picking = null;
    onChange(item ? { ...item, type } : { kind, type, config: 0, upgrades: [] });
  }

  function setUpgrade(slot: number, type: string | null, rank: number | null = null): void {
    if (!item) return;
    const rest = item.upgrades.filter((u) => u.slot !== slot);
    const upgrades = type ? [...rest, { slot, type, rank }] : rest;
    onChange({ ...item, upgrades: upgrades.sort((a, b) => a.slot - b.slot) });
  }

  function pickUpgrade(slot: number, type: string): void {
    picking = null;
    setUpgrade(slot, type, upgradeInfo.get(type)?.maxRank ?? null);
  }

  function setRank(slot: number, value: string): void {
    const upgrade = upgradeAt(slot);
    if (!upgrade) return;
    const max = upgradeInfo.get(upgrade.type ?? "")?.maxRank ?? 30;
    const rank = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    setUpgrade(slot, upgrade.type, rank);
  }

  function setHelminth(ability: string | null, index: number | null): void {
    if (!item) return;
    const next = { ...item };
    if (ability && index !== null) next.helminth = { ability, index };
    else delete next.helminth;
    onChange(next);
  }

  function setShard(socket: number, color: string, type: string): void {
    if (!item) return;
    const shards = Array.from(
      { length: SHARD_SOCKETS },
      (_, i) => item.shards?.[i] ?? { color: "", type: "" },
    );
    shards[socket] = { color, type };
    const filled = shards.filter((s) => s.type);
    const next = { ...item };
    if (filled.length) next.shards = filled;
    else delete next.shards;
    onChange(next);
  }

  function modOptions(compat: readonly string[]) {
    if (!compat.length) return catalog.arcanes;
    return catalog.mods.filter((mod) => compat.includes(mod.compat));
  }
</script>

<div
  class="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40 p-3"
  data-level-cap-slot={kind}
>
  <div class="flex items-center gap-2">
    {#if item && $itemDb[item.type]?.imageUrl}
      <img src={$itemDb[item.type].imageUrl ?? ""} alt="" class="h-8 w-8 shrink-0 object-contain" />
    {/if}
    <div class="flex min-w-0 flex-col">
      <span class="text-[10px] uppercase tracking-wide text-text-muted">{$t(label)}</span>
      <span class="truncate text-sm font-semibold text-text-primary"
        >{item ? nameOf(item.type) : $t("common.none")}</span
      >
    </div>
    <div class="ml-auto flex items-center gap-1">
      <button
        type="button"
        class="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary hover:border-info hover:text-info"
        onclick={() => (picking = picking === "item" ? null : "item")}>{$t("common.change")}</button
      >
      {#if item && removable}
        <button
          type="button"
          class="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary hover:border-danger hover:text-danger"
          onclick={() => onChange(null)}>{$t("levelCap.editor.removeItem")}</button
        >
      {/if}
    </div>
  </div>

  {#if picking === "item"}
    <LevelCapPicker
      options={itemOptions}
      placeholder={$t("levelCap.editor.searchItem")}
      onPick={pickItem}
      onCancel={() => (picking = null)}
    />
  {/if}

  {#if item}
    <ul class="m-0 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
      {#each layout as spec (spec.slot)}
        {@const upgrade = upgradeAt(spec.slot)}
        <li class="flex min-w-0 flex-col gap-1 {picking === spec.slot ? 'sm:col-span-2' : ''}">
          <div class="flex min-w-0 items-center gap-1.5 text-xs">
            <span
              class="w-12 shrink-0 text-[10px] uppercase tracking-wide {spec.role === 'mod'
                ? 'text-text-muted'
                : 'text-accent'}">{$t(ROLE_KEYS[spec.role])}</span
            >
            <button
              type="button"
              class="min-w-0 flex-1 cursor-pointer truncate rounded border px-1.5 py-0.5 text-left {upgrade?.type
                ? 'border-border/60 text-text-primary hover:border-info'
                : 'border-dashed border-border/60 text-text-muted hover:border-info'}"
              onclick={() => (picking = picking === spec.slot ? null : spec.slot)}
              >{upgrade?.type ? nameOf(upgrade.type) : $t("levelCap.editor.empty")}</button
            >
            {#if upgrade?.type}
              <input
                class="w-10 shrink-0 rounded border border-border bg-bg-raised px-1 py-0.5 text-center font-mono text-xs text-text-primary"
                type="number"
                min="0"
                max={upgradeInfo.get(upgrade.type)?.maxRank ?? 30}
                title={$t("common.rank")}
                value={upgrade.rank ?? ""}
                onchange={(e) => setRank(spec.slot, e.currentTarget.value)}
              />
              <button
                type="button"
                class="shrink-0 cursor-pointer px-1 text-text-muted hover:text-danger"
                aria-label={$t("levelCap.editor.clearSlot")}
                title={$t("levelCap.editor.clearSlot")}
                onclick={() => setUpgrade(spec.slot, null)}>×</button
              >
            {/if}
          </div>
          {#if picking === spec.slot}
            <LevelCapPicker
              options={modOptions(spec.compat)}
              fallback={spec.compat.length ? catalog.mods : []}
              placeholder={$t(
                spec.role === "arcane"
                  ? "levelCap.editor.searchArcane"
                  : "levelCap.editor.searchMod",
              )}
              onPick={(type) => pickUpgrade(spec.slot, type)}
              onCancel={() => (picking = null)}
            />
          {/if}
        </li>
      {/each}
    </ul>

    {#if kind === "suit"}
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="text-[10px] uppercase tracking-wide text-accent"
          >{$t("levelCap.build.helminth")}</span
        >
        <select
          class="rounded border border-border bg-bg-raised px-1.5 py-0.5 text-xs text-text-primary"
          value={item.helminth ? String(item.helminth.index) : ""}
          onchange={(e) => {
            const value = e.currentTarget.value;
            if (!value) setHelminth(null, null);
            else if (item.helminth) setHelminth(item.helminth.ability, Number(value));
            else {
              helminthIndex = Number(value);
              picking = "helminth";
            }
          }}
        >
          <option value="">{$t("common.none")}</option>
          {#each [0, 1, 2, 3] as index (index)}
            <option value={String(index)}
              >{$t("levelCap.editor.replaces", { n: String(index + 1) })}</option
            >
          {/each}
        </select>
        <button
          type="button"
          class="min-w-0 cursor-pointer truncate rounded border border-dashed border-border/60 px-1.5 py-0.5 text-left text-text-primary hover:border-info"
          onclick={() => (picking = picking === "helminth" ? null : "helminth")}
          >{item.helminth
            ? abilityName(item.helminth.ability)
            : $t("levelCap.editor.pickAbility")}</button
        >
      </div>
      {#if picking === "helminth"}
        <LevelCapPicker
          options={catalog.abilities}
          placeholder={$t("levelCap.editor.searchAbility")}
          onPick={(type) => {
            picking = null;
            setHelminth(type, item.helminth?.index ?? helminthIndex);
          }}
          onCancel={() => (picking = null)}
        />
      {/if}

      <div class="flex flex-col gap-1 text-xs">
        <span class="text-[10px] uppercase tracking-wide text-accent"
          >{$t("levelCap.editor.shards")}</span
        >
        {#each Array.from({ length: SHARD_SOCKETS }, (_, i) => i) as socket (socket)}
          {@const shard = item.shards?.[socket] ?? null}
          {@const effects = catalog.shards.filter((s) => s.color === shard?.color)}
          <div class="flex items-center gap-1.5">
            <select
              class="w-40 rounded border border-border bg-bg-raised px-1.5 py-0.5 text-xs text-text-primary"
              value={shard?.color ?? ""}
              onchange={(e) => {
                const color = e.currentTarget.value;
                const first = catalog.shards.find((s) => s.color === color)?.type ?? "";
                setShard(socket, color, color ? first : "");
              }}
            >
              <option value="">{$t("levelCap.editor.emptySocket")}</option>
              {#each SHARD_COLORS as color (color)}
                <option value={color}>{shardLabel(color)}</option>
              {/each}
            </select>
            {#if shard?.color}
              <select
                class="min-w-0 flex-1 rounded border border-border bg-bg-raised px-1.5 py-0.5 text-xs text-text-primary"
                value={shard.type}
                onchange={(e) => setShard(socket, shard.color, e.currentTarget.value)}
              >
                {#if !effects.some((s) => s.type === shard.type)}
                  <option value={shard.type}>{archonShardUpgradeLabel(shard.type) || "?"}</option>
                {/if}
                {#each effects as effect (effect.type)}
                  <option value={effect.type}>{archonShardUpgradeLabel(effect.type)}</option>
                {/each}
              </select>
            {/if}
          </div>
        {/each}
        <span class="text-[10px] text-text-muted">{$t("levelCap.editor.shardsHint")}</span>
      </div>
    {/if}

    {#if item.weapon}
      <span class="text-xs text-text-muted"
        >{$t("levelCap.editor.companionWeapon", { name: nameOf(item.weapon.type) })}</span
      >
    {/if}
  {/if}
</div>
