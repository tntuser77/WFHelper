<script lang="ts">
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import { ARCHON_SHARD_EFFECTS } from "../../../config/shared/archonShardCatalog.js";
  import { isLevelCapRivenType } from "../../../config/shared/levelCapBuild.js";
  import type {
    LevelCapCatalog,
    LevelCapItem,
    LevelCapSlotKind,
  } from "../../../config/shared/levelCapTypes.js";
  import { itemDb } from "../../stores/data.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import { levelCapSlotLayout } from "../../lib/levelCap.js";
  import {
    archonShardColorKey,
    archonShardIconUrl,
    archonShardUpgradeLabel,
    parseArchonShardSlot,
  } from "../../lib/inventory/archonShards.js";
  import { log } from "../../lib/log.js";
  import { loadLevelCapItemConfigs } from "../../stores/levelCap.js";
  import LevelCapModGrid from "./LevelCapModGrid.svelte";
  import LevelCapPicker from "./LevelCapPicker.svelte";

  let {
    kind,
    label,
    item,
    catalog,
    itemOptions,
    abilityNames = {},
    removable = true,
    open = false,
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
    open?: boolean;
    onChange: (item: LevelCapItem | null) => void;
  } = $props();

  const SHARD_SOCKETS = 5;
  const TAUFORGED = ARCHON_SHARD_EFFECTS.filter((e) => e.color.endsWith("_MYTHIC"));

  // svelte-ignore state_referenced_locally
  let expanded = $state(open);
  /** "item", "helminth", a mod slot number, or `shard:N` for a socket. */
  let picking = $state<string | number | null>(null);
  /** The owned item's configs from the inventory, keyed to the type they were read for. */
  let configs = $state<{ type: string; list: LevelCapItem[] } | null>(null);

  $effect(() => {
    const type = item?.type;
    if (!type || configs?.type === type) return;
    let live = true;
    loadLevelCapItemConfigs(kind, type)
      .then((list) => {
        if (live) configs = { type, list };
      })
      .catch((err) => log.warn("[LevelCap] item configs failed", String(err)));
    return () => {
      live = false;
    };
  });

  const ownedConfigs = $derived(configs && configs.type === item?.type ? configs.list : []);

  const layout = $derived(item ? levelCapSlotLayout(kind, item) : []);
  const upgradeInfo = $derived(
    new Map([...catalog.mods, ...catalog.arcanes].map((entry) => [entry.type, entry])),
  );
  const pickedSlot = $derived(typeof picking === "number" ? picking : null);
  const pickedSpec = $derived(layout.find((s) => s.slot === pickedSlot) ?? null);
  const pickedUpgrade = $derived(
    pickedSlot === null ? null : (item?.upgrades.find((u) => u.slot === pickedSlot) ?? null),
  );
  const filled = $derived(item?.upgrades.filter((u) => u.type).length ?? 0);
  const shardOptions = $derived(
    TAUFORGED.map((e) => ({
      type: `${e.color}|${e.type}`,
      name: `${e.effect} · ${shardColor(e.color)}`,
    })),
  );

  function nameOf(type: string | null | undefined): string {
    if (!type) return "?";
    return (
      itemLabel($itemDb[type]) ||
      upgradeInfo.get(type)?.name ||
      itemOptions.find((o) => o.type === type)?.name ||
      fallbackNameFromUniqueName(type)
    );
  }

  function abilityName(type: string): string {
    return (
      abilityNames[type] ??
      catalog.abilities.find((a) => a.type === type)?.name ??
      fallbackNameFromUniqueName(type)
    );
  }

  function shardColor(color: string): string {
    const parsed = parseArchonShardSlot({ Color: color, UpgradeType: "x" }, 0);
    return parsed.color ? $t(archonShardColorKey(parsed.color)) : color;
  }

  function shardEffect(type: string): string {
    return (
      ARCHON_SHARD_EFFECTS.find((e) => e.type === type)?.effect ?? archonShardUpgradeLabel(type)
    );
  }

  function toggle(key: string | number): void {
    picking = picking === key ? null : key;
  }

  /** A new item arrives modded the way it is in the inventory, never with the old item's mods. */
  async function pickItem(type: string): Promise<void> {
    picking = null;
    expanded = true;
    let list: LevelCapItem[] = [];
    try {
      list = await loadLevelCapItemConfigs(kind, type);
    } catch (err) {
      log.warn("[LevelCap] item configs failed", String(err));
    }
    configs = { type, list };
    const modded = list.find((c) => c.upgrades.length) ?? list[0];
    onChange(modded ? structuredClone(modded) : { kind, type, config: 0, upgrades: [] });
  }

  function loadConfig(config: LevelCapItem): void {
    picking = null;
    // A companion's weapon is not part of its mod config, so it stays.
    const next = $state.snapshot(config);
    if (item?.weapon) next.weapon = $state.snapshot(item.weapon);
    onChange(next);
  }

  function configLabel(config: LevelCapItem): string {
    return config.configName || String.fromCharCode(65 + config.config);
  }

  function setUpgrade(slot: number, type: string | null, rank: number | null = null): void {
    if (!item) return;
    const rest = item.upgrades.filter((u) => u.slot !== slot);
    const upgrades = type ? [...rest, { slot, type, rank }] : rest;
    onChange({ ...item, upgrades: upgrades.sort((a, b) => a.slot - b.slot) });
  }

  const modFamilies = $derived(new Map(catalog.mods.map((mod) => [mod.type, mod.family])));

  /** The game will not equip two of a family, so Archon Stretch evicts Stretch. */
  function pickUpgrade(slot: number, type: string): void {
    picking = null;
    if (!item) return;
    const family = modFamilies.get(type) ?? type;
    const kept = item.upgrades.filter(
      (u) => u.slot === slot || !u.type || (modFamilies.get(u.type) ?? u.type) !== family,
    );
    const rest = kept.filter((u) => u.slot !== slot);
    // Nearly everything runs at max rank; the slot panel can lower it.
    const upgrades = [...rest, { slot, type, rank: upgradeInfo.get(type)?.maxRank ?? null }];
    onChange({ ...item, upgrades: upgrades.sort((a, b) => a.slot - b.slot) });
  }

  function setRank(slot: number, value: string): void {
    const upgrade = item?.upgrades.find((u) => u.slot === slot);
    if (!upgrade || !item) return;
    const max = upgradeInfo.get(upgrade.type ?? "")?.maxRank ?? 30;
    const rank = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    onChange({
      ...item,
      upgrades: item.upgrades.map((u) => (u.slot === slot ? { ...u, rank } : u)),
    });
  }

  function setHelminth(ability: string | null, index: number): void {
    if (!item) return;
    const next = { ...item };
    if (ability) next.helminth = { ability, index };
    else delete next.helminth;
    onChange(next);
  }

  function setShard(socket: number, value: string | null): void {
    if (!item) return;
    picking = null;
    const shards = [...(item.shards ?? [])];
    if (value) {
      const [color, type] = value.split("|");
      if (socket < shards.length) shards[socket] = { color, type };
      else shards.push({ color, type });
    } else {
      shards.splice(socket, 1);
    }
    const next = { ...item };
    if (shards.length) next.shards = shards;
    else delete next.shards;
    onChange(next);
  }

  /** Augments fit only this frame's own abilities or the one the Helminth grafted. */
  function fitsItem(mod: LevelCapCatalog["mods"][number]): boolean {
    if (!mod.augment) return true;
    if (kind !== "suit" || !item) return false;
    return (
      mod.augment.suit === catalog.suitParents[item.type] ||
      (mod.augment.ability !== null && mod.augment.ability === item.helminth?.ability)
    );
  }

  const fittingMods = $derived(catalog.mods.filter(fitsItem));

  function modOptions(compat: readonly string[]) {
    if (!compat.length) return catalog.arcanes;
    return fittingMods.filter((mod) => compat.includes(mod.compat));
  }
</script>

<div
  class="flex flex-col rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40"
  data-level-cap-slot={kind}
>
  <div class="flex items-center gap-3 p-3">
    <button
      type="button"
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      aria-expanded={expanded}
      onclick={() => {
        expanded = !expanded;
        picking = null;
      }}
    >
      <span class="flex h-10 w-10 shrink-0 items-center justify-center">
        {#if item && $itemDb[item.type]?.imageUrl}
          <img src={$itemDb[item.type].imageUrl ?? ""} alt="" class="h-10 w-10 object-contain" />
        {/if}
      </span>
      <span class="flex min-w-0 flex-col">
        <span class="text-[10px] uppercase tracking-wide text-text-muted">{$t(label)}</span>
        <span class="truncate text-base font-semibold text-text-primary"
          >{item ? nameOf(item.type) : $t("common.none")}</span
        >
      </span>
      {#if item}
        <span class="ml-2 text-xs text-text-muted"
          >{$t("levelCap.editor.filled", { count: String(filled) })}</span
        >
      {/if}
      <span class="ml-auto text-text-muted">{expanded ? "▾" : "▸"}</span>
    </button>
    {#if item && ownedConfigs.length}
      <div
        class="flex max-w-[45%] flex-wrap items-center justify-end gap-1"
        title={$t("levelCap.editor.configsHint")}
        data-level-cap-configs
      >
        {#each ownedConfigs as config (config.config)}
          <button
            type="button"
            class="max-w-32 cursor-pointer truncate rounded border px-1.5 py-0.5 text-[11px] {config.config ===
            item.config
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border text-text-secondary hover:border-info hover:text-info'}"
            onclick={() => loadConfig(config)}>{configLabel(config)}</button
          >
        {/each}
      </div>
    {/if}
    <button
      type="button"
      class="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary hover:border-info hover:text-info"
      onclick={() => toggle("item")}>{$t("common.change")}</button
    >
    {#if item && removable}
      <button
        type="button"
        class="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary hover:border-danger hover:text-danger"
        onclick={() => onChange(null)}>{$t("levelCap.editor.removeItem")}</button
      >
    {/if}
  </div>

  {#if picking === "item"}
    <div class="px-3 pb-3">
      <LevelCapPicker
        options={itemOptions}
        placeholder={$t("levelCap.editor.searchItem")}
        onPick={pickItem}
        onCancel={() => (picking = null)}
      />
    </div>
  {/if}

  {#if item && expanded}
    <div class="flex flex-col gap-3 border-t border-border/50 p-3">
      <LevelCapModGrid
        {kind}
        {item}
        {catalog}
        selected={pickedSlot}
        onSelect={(slot) => toggle(slot)}
      />

      {#if pickedSpec}
        <div class="flex flex-col gap-2 rounded-[var(--radius-md)] border border-info/40 p-2">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="font-semibold text-text-primary"
              >{pickedUpgrade?.type
                ? nameOf(pickedUpgrade.type)
                : $t("levelCap.editor.empty")}</span
            >
            {#if pickedUpgrade?.type && !isLevelCapRivenType(pickedUpgrade.type)}
              <label class="flex items-center gap-1 text-text-muted">
                {$t("common.rank")}
                <input
                  class="w-12 rounded border border-border bg-bg-raised px-1 py-0.5 text-center font-mono text-xs text-text-primary"
                  type="number"
                  min="0"
                  max={upgradeInfo.get(pickedUpgrade.type)?.maxRank ?? 30}
                  value={pickedUpgrade.rank ?? ""}
                  onchange={(e) => setRank(pickedSpec.slot, e.currentTarget.value)}
                />
              </label>
            {/if}
            {#if pickedUpgrade?.type}
              <button
                type="button"
                class="ml-auto cursor-pointer rounded border border-border px-1.5 py-0.5 text-text-secondary hover:border-danger hover:text-danger"
                onclick={() => {
                  setUpgrade(pickedSpec.slot, null);
                  picking = null;
                }}>{$t("levelCap.editor.clearSlot")}</button
              >
            {/if}
          </div>
          {#if isLevelCapRivenType(pickedUpgrade?.type ?? null)}
            <span class="text-[11px] text-text-muted">{$t("levelCap.editor.rivenHint")}</span>
          {/if}
          <LevelCapPicker
            options={modOptions(pickedSpec.compat)}
            fallback={pickedSpec.compat.length ? fittingMods : []}
            placeholder={$t(
              pickedSpec.role === "arcane"
                ? "levelCap.editor.searchArcane"
                : "levelCap.editor.searchMod",
            )}
            onPick={(type) => pickUpgrade(pickedSpec.slot, type)}
            onCancel={() => (picking = null)}
          />
        </div>
      {/if}

      {#if kind === "suit"}
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="w-20 text-[10px] font-semibold uppercase tracking-wide text-accent"
            >{$t("levelCap.build.helminth")}</span
          >
          <button
            type="button"
            class="min-w-40 cursor-pointer rounded-[var(--radius-md)] border px-2 py-1 text-left text-sm {item.helminth
              ? 'border-accent/50 text-text-primary'
              : 'border-dashed border-border text-text-muted'} hover:border-info"
            onclick={() => toggle("helminth")}
            data-level-cap-helminth
            >{item.helminth
              ? abilityName(item.helminth.ability)
              : $t("levelCap.editor.pickAbility")}</button
          >
          {#if item.helminth}
            {@const current = item.helminth}
            <span class="text-text-muted">{$t("levelCap.editor.replacing")}</span>
            <div class="flex overflow-hidden rounded border border-border">
              {#each [0, 1, 2, 3] as index (index)}
                <button
                  type="button"
                  class="cursor-pointer px-2 py-0.5 font-mono {current.index === index
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:bg-bg-raised'}"
                  title={$t("levelCap.editor.replaces", { n: String(index + 1) })}
                  onclick={() => setHelminth(current.ability, index)}>{index + 1}</button
                >
              {/each}
            </div>
            <button
              type="button"
              class="cursor-pointer px-1 text-text-muted hover:text-danger"
              aria-label={$t("levelCap.editor.clearSlot")}
              onclick={() => setHelminth(null, 0)}>×</button
            >
          {/if}
        </div>
        {#if picking === "helminth"}
          <LevelCapPicker
            options={catalog.abilities}
            placeholder={$t("levelCap.editor.searchAbility")}
            onPick={(type) => {
              picking = null;
              setHelminth(type, item.helminth?.index ?? 3);
            }}
            onCancel={() => (picking = null)}
          />
        {/if}

        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="w-20 text-[10px] font-semibold uppercase tracking-wide text-accent"
            >{$t("levelCap.editor.shards")}</span
          >
          {#each Array.from({ length: SHARD_SOCKETS }, (_, i) => i) as socket (socket)}
            {@const shard = item.shards?.[socket] ?? null}
            {@const parsed = shard
              ? parseArchonShardSlot({ Color: shard.color, UpgradeType: shard.type }, socket)
              : null}
            {@const icon = parsed
              ? archonShardIconUrl($itemDb, parsed.color, parsed.tauforged)
              : null}
            {#if shard || socket === (item.shards?.length ?? 0)}
              <button
                type="button"
                class="flex max-w-56 cursor-pointer items-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-1 text-left {picking ===
                `shard:${socket}`
                  ? 'border-info'
                  : shard
                    ? 'border-border'
                    : 'border-dashed border-border text-text-muted'} hover:border-info"
                title={shard ? shardEffect(shard.type) : undefined}
                onclick={() => toggle(`shard:${socket}`)}
                data-level-cap-shard={socket}
              >
                {#if icon}<img src={icon} alt="" class="h-5 w-5 shrink-0 object-contain" />{/if}
                <span class="truncate"
                  >{shard ? shardEffect(shard.type) : `+ ${$t("levelCap.editor.addShard")}`}</span
                >
              </button>
            {/if}
          {/each}
        </div>
        {#if typeof picking === "string" && picking.startsWith("shard:")}
          {@const socket = Number(picking.slice(6))}
          <div class="flex flex-col gap-1">
            <LevelCapPicker
              options={shardOptions}
              placeholder={$t("levelCap.editor.searchShard")}
              onPick={(value) => setShard(socket, value)}
              onCancel={() => (picking = null)}
            />
            {#if item.shards?.[socket]}
              <button
                type="button"
                class="cursor-pointer self-start text-xs text-text-muted hover:text-danger"
                onclick={() => setShard(socket, null)}>{$t("levelCap.editor.removeShard")}</button
              >
            {/if}
          </div>
        {/if}
      {/if}

      {#if item.weapon}
        <span class="text-xs text-text-muted"
          >{$t("levelCap.editor.companionWeapon", { name: nameOf(item.weapon.type) })}</span
        >
      {/if}
    </div>
  {/if}
</div>
