<script lang="ts">
  import { onDestroy, untrack } from "svelte";

  import type { LevelCapItem } from "../../../config/shared/levelCapTypes.js";
  import type { LevelCapRun } from "../../types/ipc.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import { confirmWithDialog, invoke } from "../../lib/ipc.js";
  import { log } from "../../lib/log.js";
  import {
    deleteLevelCapRun,
    setLevelCapArchgun,
    setLevelCapNotes,
    setLevelCapTags,
  } from "../../stores/levelCap.js";
  import ThemedButton from "../ThemedButton.svelte";
  import LevelCapItemCard from "./LevelCapItemCard.svelte";

  let {
    run,
    tagSuggestions = [],
    abilityNames = {},
  }: {
    run: LevelCapRun;
    tagSuggestions?: string[];
    abilityNames?: Record<string, string>;
  } = $props();

  const tags = $derived(run.tags ?? []);
  const datalistId = $derived(`level-cap-tags-${run.id}`);
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
    if (run.archgunUsed) push(build.archgun, "rivens.type.archgun");
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

  let tagDraft = $state("");
  let notesDraft = $state(untrack(() => run.notes ?? ""));
  let notesTimer: ReturnType<typeof setTimeout> | null = null;

  function saveNotes(): void {
    void setLevelCapNotes(run.id, notesDraft).catch((err) =>
      log.warn("[LevelCap] notes save failed", String(err)),
    );
  }

  function onNotesInput(): void {
    if (notesTimer) clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      notesTimer = null;
      saveNotes();
    }, 600);
  }

  /** Collapsing the row inside the debounce window would drop the edit. */
  function flushNotes(): void {
    if (!notesTimer) return;
    clearTimeout(notesTimer);
    notesTimer = null;
    saveNotes();
  }

  onDestroy(flushNotes);

  async function addTag(): Promise<void> {
    const value = tagDraft.trim();
    if (!value) return;
    tagDraft = "";
    // Reuse the spelling already in use so "melee" and "Melee" stay one tag.
    const known = tagSuggestions.find((tag) => tag.toLowerCase() === value.toLowerCase());
    await setLevelCapTags(run.id, [...tags, known ?? value]);
  }

  async function removeTag(tag: string): Promise<void> {
    await setLevelCapTags(
      run.id,
      tags.filter((entry) => entry !== tag),
    );
  }

  function onTagKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void addTag();
    }
  }

  async function onDelete(): Promise<void> {
    if (!(await confirmWithDialog($t("levelCap.confirmDelete"), $t))) return;
    await deleteLevelCapRun(run.id);
  }
</script>

<div class="flex flex-col gap-3 px-3 pb-3" data-level-cap-detail>
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
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
          >{$t("common.tags")}</span
        >
        {#each tags as tag (tag)}
          <span
            class="inline-flex items-center gap-1 rounded border border-info/40 bg-info/10 px-2 py-0.5 text-xs font-semibold text-info"
          >
            {tag}
            <button
              type="button"
              class="cursor-pointer leading-none text-info/70 hover:text-info"
              title={$t("arbi.tags.remove")}
              aria-label={$t("arbi.tags.remove")}
              onclick={() => removeTag(tag)}>×</button
            >
          </span>
        {/each}
        <input
          class="w-40 rounded border border-border bg-bg-raised px-2 py-0.5 text-xs text-text-primary outline-none focus:border-info"
          type="text"
          maxlength="32"
          list={datalistId}
          placeholder={$t("arbi.tags.add")}
          bind:value={tagDraft}
          onkeydown={onTagKeydown}
          onblur={addTag}
        />
        <datalist id={datalistId}>
          {#each tagSuggestions.filter((tag) => !tags.includes(tag)) as tag (tag)}
            <option value={tag}></option>
          {/each}
        </datalist>
      </div>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
          >{$t("arbi.notes.label")}</span
        >
        <textarea
          class="min-h-[4.5rem] w-full resize-y rounded border border-border bg-bg-raised px-2 py-1.5 text-sm text-text-primary outline-none focus:border-info"
          maxlength="2000"
          placeholder={$t("arbi.notes.placeholder")}
          bind:value={notesDraft}
          oninput={onNotesInput}
          onblur={flushNotes}></textarea>
      </label>

      <div class="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
        <label class="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={run.archgunUsed}
            onchange={(e) => setLevelCapArchgun(run.id, e.currentTarget.checked)}
          />
          {$t("levelCap.archgunUsed")}
        </label>
        {#if run.build?.focus}
          <span
            >{$t("levelCap.build.focus")}: <span class="capitalize">{run.build.focus}</span></span
          >
        {/if}
        {#if run.build?.loadoutName}
          <span>{$t("levelCap.build.loadout", { name: run.build.loadoutName })}</span>
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

  {#if items.length}
    <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {#each items as { item, label } (label)}
        <LevelCapItemCard {item} {label} {abilityNames} />
      {/each}
    </div>
  {:else}
    <span class="text-xs text-text-muted">{$t("levelCap.build.none")}</span>
  {/if}
</div>
