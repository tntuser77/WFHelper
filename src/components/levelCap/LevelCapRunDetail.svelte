<script lang="ts">
  import type { LevelCapItem } from "../../../config/shared/levelCapTypes.js";
  import type { LevelCapRun } from "../../types/ipc.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import { confirmWithDialog, invoke } from "../../lib/ipc.js";
  import { levelCapSquad } from "../../lib/levelCap.js";
  import { log } from "../../lib/log.js";
  import { deleteLevelCapRun } from "../../stores/levelCap.js";
  import ThemedButton from "../ThemedButton.svelte";
  import LevelCapItemCard from "./LevelCapItemCard.svelte";

  let { run, abilityNames = {} }: { run: LevelCapRun; abilityNames?: Record<string, string> } =
    $props();

  // Tags live on builds; a run only keeps its own until it is put on one.
  const legacyTags = $derived(run.tags ?? []);
  const squad = $derived(levelCapSquad(run));
  const squadNames = $derived(
    [
      ...squad.names,
      ...(squad.others
        ? [
            $t(squad.others === 1 ? "levelCap.squadOther" : "levelCap.squadOthers", {
              count: String(squad.others),
            }),
          ]
        : []),
    ].join(", "),
  );
  const items = $derived.by(() => {
    const build = run.build;
    if (!build) return [];
    const rows: Array<{ item: LevelCapItem; label: MessageKey }> = [];
    const push = (item: LevelCapItem | null, label: MessageKey) =>
      item && rows.push({ item, label });
    push(build.suit, "profile.warframe");
    push(build.primary, "profile.primaryWeapon");
    push(build.secondary, "profile.secondaryWeapon");
    push(build.melee, "rivens.type.melee");
    push(build.archgun, "rivens.type.archgun");
    push(build.companion, "levelCap.build.companion");
    return rows;
  });

  let thumbnail = $state<string | null>(null);
  $effect(() => {
    const id = run.id;
    const shot = run.screenshot;
    thumbnail = null;
    if (!shot) return;
    let live = true;
    invoke("getLevelCapThumbnail", id)
      .then((url) => {
        if (live) thumbnail = url;
      })
      .catch((err) => log.warn("[LevelCap] thumbnail failed", String(err)));
    return () => {
      live = false;
    };
  });

  async function onDelete(): Promise<void> {
    if (!(await confirmWithDialog($t("levelCap.confirmDelete"), $t))) return;
    await deleteLevelCapRun(run.id);
  }
</script>

<div class="flex flex-col gap-3 px-3 pb-3" data-level-cap-detail>
  {#if items.length}
    <div class="flex flex-col gap-2">
      {#each items as { item, label } (label)}
        <LevelCapItemCard {item} {label} {abilityNames} />
      {/each}
    </div>
  {:else}
    <span class="text-xs text-text-muted">{$t("levelCap.build.none")}</span>
  {/if}
  <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,420px)_1fr]">
    <div class="flex flex-col gap-1">
      {#if thumbnail}
        <button
          type="button"
          class="cursor-zoom-in overflow-hidden rounded-[var(--radius-md)] border border-border p-0"
          title={$t("levelCap.openScreenshot")}
          onclick={() => invoke("openLevelCapScreenshot", run.id)}
        >
          <img src={thumbnail} alt="" class="block w-full" />
        </button>
      {:else}
        <div
          class="flex h-24 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border text-xs text-text-muted"
        >
          {run.screenshot ? "..." : $t("levelCap.noScreenshot")}
        </div>
      {/if}
      {#if run.tile}
        <span class="text-xs text-text-muted">
          {run.tile.rooms.map((room) => room.name ?? `#${room.fingerprint}`).join(" · ")}
        </span>
      {/if}
    </div>

    <div class="flex flex-col gap-3">
      {#if legacyTags.length}
        <div class="flex flex-wrap items-center gap-2" title={$t("levelCap.legacyTagsHint")}>
          <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
            >{$t("common.tags")}</span
          >
          {#each legacyTags as tag (tag)}
            <span
              class="rounded border border-info/40 bg-info/10 px-2 py-0.5 text-xs font-semibold text-info"
              >{tag}</span
            >
          {/each}
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
        {#if run.build?.focus}
          <span
            >{$t("levelCap.build.focus")}: <span class="capitalize">{run.build.focus}</span></span
          >
        {/if}
        {#if run.build?.loadoutName}
          <span>{$t("levelCap.build.loadout", { name: run.build.loadoutName })}</span>
        {/if}
        {#if squad.names.length}
          <span
            data-level-cap-players
            title={run.playersFromScreenshot ? $t("levelCap.playersOcrHint") : undefined}
            >{$t("levelCap.players", { names: squadNames })}{#if run.playersFromScreenshot}
              <span class="text-text-muted">{$t("levelCap.playersOcr")}</span>{/if}</span
          >
        {/if}
        {#if run.source === "mission-end"}
          <span class="text-text-muted">{$t("levelCap.missionEnd")}</span>
        {/if}
        <ThemedButton size="compact" className="ml-auto" onClick={onDelete}
          >{$t("common.delete")}</ThemedButton
        >
      </div>
    </div>
  </div>
</div>
