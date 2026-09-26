<script lang="ts">
  import { untrack } from "svelte";

  import type {
    LevelCapBuild,
    LevelCapCatalog,
    LevelCapFocusSchool,
    LevelCapItem,
    LevelCapNamedBuild,
    LevelCapSlotKind,
  } from "../../../config/shared/levelCapTypes.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import { confirmWithDialog } from "../../lib/ipc.js";
  import { log } from "../../lib/log.js";
  import { orderLevelCapTags } from "../../lib/levelCap.js";
  import {
    deleteLevelCapBuild,
    loadLevelCapCatalog,
    updateLevelCapBuild,
  } from "../../stores/levelCap.js";
  import { addToast } from "../../stores/toasts.js";
  import ThemedButton from "../ThemedButton.svelte";
  import LevelCapSlotEditor from "./LevelCapSlotEditor.svelte";

  let {
    record,
    runCount,
    tagSuggestions,
    abilityNames = {},
    onDone,
  }: {
    record: LevelCapNamedBuild;
    runCount: number;
    tagSuggestions: string[];
    abilityNames?: Record<string, string>;
    onDone: () => void;
  } = $props();

  const SLOTS: Array<{ kind: Exclude<LevelCapSlotKind, "suit">; label: MessageKey }> = [
    { kind: "primary", label: "profile.primaryWeapon" },
    { kind: "secondary", label: "profile.secondaryWeapon" },
    { kind: "melee", label: "rivens.type.melee" },
    { kind: "companion", label: "levelCap.build.companion" },
    { kind: "archgun", label: "rivens.type.archgun" },
  ];
  const FOCUS: LevelCapFocusSchool[] = ["madurai", "vazarin", "naramon", "zenurik", "unairu"];

  let draft = $state<LevelCapBuild>(untrack(() => structuredClone(record.build)));
  let name = $state(untrack(() => record.name));
  let tags = $state<string[]>(untrack(() => [...(record.tags ?? [])]));
  let tagDraft = $state("");
  let busy = $state(false);
  let catalog = $state<LevelCapCatalog | null>(null);

  $effect(() => {
    loadLevelCapCatalog()
      .then((value) => (catalog = value))
      .catch((err) => log.warn("[LevelCap] catalogue failed", String(err)));
  });

  const dirty = $derived(
    name.trim() !== record.name ||
      JSON.stringify(tags) !== JSON.stringify(record.tags ?? []) ||
      JSON.stringify(draft) !== JSON.stringify(record.build),
  );
  // The frame slot only swaps between variants of this frame, e.g. Dante and Dante Prime.
  const suitOptions = $derived(
    catalog?.suits.filter((s) => s.name.replace(/\s+Prime$/i, "").trim() === record.frame) ?? [],
  );

  function setSlot(kind: LevelCapSlotKind, item: LevelCapItem | null): void {
    draft = { ...draft, [kind]: item };
  }

  /** The best unused tag starting with the draft; its tail shows faded after the text. */
  const tagMatch = $derived.by(() => {
    const draft = tagDraft.trimStart().toLowerCase();
    if (!draft) return null;
    const used = new Set(tags.map((tag) => tag.toLowerCase()));
    return (
      tagSuggestions.find(
        (tag) => !used.has(tag.toLowerCase()) && tag.toLowerCase().startsWith(draft),
      ) ?? null
    );
  });
  const tagCompletion = $derived(tagMatch ? tagMatch.slice(tagDraft.trimStart().length) : "");

  let listOpen = $state(false);
  let listActive = $state(0);
  /** Unused tags containing the draft, in the app-wide order. */
  const listOptions = $derived.by(() => {
    const draft = tagDraft.trim().toLowerCase();
    const used = new Set(tags.map((tag) => tag.toLowerCase()));
    return tagSuggestions.filter(
      (tag) => !used.has(tag.toLowerCase()) && tag.toLowerCase().includes(draft),
    );
  });

  function openTagList(): void {
    listOpen = true;
    listActive = 0;
  }

  function pickListTag(tag: string): void {
    tagDraft = tag;
    addTag();
    listActive = 0;
  }

  /** Tab and Enter take the suggestion; with none, Enter adds what was typed.
   *  With the list open, the arrows move through it and Enter takes the highlighted tag. */
  function onTagKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && (listOpen || tagDraft)) {
      e.preventDefault();
      e.stopPropagation();
      if (listOpen) listOpen = false;
      else tagDraft = "";
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!listOpen) return openTagList();
      const last = listOptions.length - 1;
      listActive = Math.max(0, Math.min(last, listActive + (e.key === "ArrowDown" ? 1 : -1)));
      return;
    }
    if (listOpen && e.key === "Enter" && listOptions[listActive]) {
      e.preventDefault();
      pickListTag(listOptions[listActive]);
      return;
    }
    if (e.key !== "Enter" && !(e.key === "Tab" && tagMatch)) return;
    e.preventDefault();
    if (tagMatch) tagDraft = tagMatch;
    addTag();
  }

  function addTag(): void {
    const value = tagDraft.trim();
    tagDraft = "";
    if (!value || tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) return;
    // Reuse the spelling already in use so "melee" and "Melee" stay one tag.
    tags = [
      ...tags,
      tagSuggestions.find((tag) => tag.toLowerCase() === value.toLowerCase()) ?? value,
    ];
  }

  async function save(): Promise<void> {
    busy = true;
    try {
      // IPC cannot clone Svelte's state proxies, so send plain copies.
      await updateLevelCapBuild(record.id, {
        name,
        tags: $state.snapshot(tags),
        build: $state.snapshot(draft),
      });
      onDone();
    } finally {
      busy = false;
    }
  }

  async function fromEquipped(): Promise<void> {
    busy = true;
    try {
      const ok = await updateLevelCapBuild(record.id, { fromEquipped: true });
      if (ok) onDone();
      else
        addToast({
          level: "warning",
          message: $t("levelCap.editor.equipFirst", { frame: record.frame }),
        });
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    const message = $t("levelCap.editor.confirmDelete", {
      name: record.name,
      count: String(runCount),
    });
    if (!(await confirmWithDialog(message, $t))) return;
    await deleteLevelCapBuild(record.id);
    onDone();
  }
</script>

<div class="flex flex-col gap-3" data-level-cap-build-editor={record.id}>
  <div class="flex flex-wrap items-end gap-3">
    <label class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-text-muted"
        >{$t("levelCap.editor.name")}</span
      >
      <input
        class="w-56 rounded border border-border bg-bg-raised px-2 py-1 text-sm font-semibold text-text-primary outline-none focus:border-info"
        type="text"
        maxlength="48"
        bind:value={name}
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-text-muted"
        >{$t("levelCap.build.focus")}</span
      >
      <select
        class="rounded border border-border bg-bg-raised px-2 py-1 text-sm capitalize text-text-primary"
        value={draft.focus ?? ""}
        onchange={(e) =>
          (draft = {
            ...draft,
            focus: (e.currentTarget.value || null) as LevelCapFocusSchool | null,
          })}
      >
        <option value="">{$t("common.none")}</option>
        {#each FOCUS as school (school)}
          <option value={school}>{school}</option>
        {/each}
      </select>
    </label>
    <span class="pb-1.5 text-xs text-text-muted"
      >{$t("levelCap.editor.usedBy", { count: String(runCount) })}</span
    >
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs uppercase tracking-wide text-text-muted">{$t("common.tags")}</span>
    {#each orderLevelCapTags(tags, tagSuggestions) as tag (tag)}
      <span
        class="inline-flex items-center gap-1.5 rounded border border-info/40 bg-info/10 px-2.5 py-1 text-sm font-semibold text-info"
      >
        {tag}
        <button
          type="button"
          class="cursor-pointer leading-none text-info/70 hover:text-info"
          aria-label={$t("arbi.tags.remove")}
          onclick={() => (tags = tags.filter((entry) => entry !== tag))}>×</button
        >
      </span>
    {/each}
    <span
      class="relative inline-block w-64 rounded border border-border bg-bg-raised focus-within:border-info"
      data-level-cap-tag-input
    >
      <span
        class="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-2.5 py-1 [font-family:inherit] text-sm leading-5"
        aria-hidden="true"
        ><span class="invisible">{tagDraft}</span><span class="text-text-muted"
          >{tagCompletion}</span
        ></span
      >
      <input
        class="relative w-full bg-transparent px-2.5 py-1 [font-family:inherit] text-sm leading-5 text-text-primary outline-none"
        type="text"
        maxlength="32"
        placeholder={$t("arbi.tags.add")}
        title={$t("levelCap.tags.acceptHint")}
        bind:value={tagDraft}
        oninput={() => (listActive = 0)}
        onkeydown={onTagKeydown}
        ondblclick={() => openTagList()}
        onblur={() => {
          listOpen = false;
          addTag();
        }}
      />
      {#if listOpen}
        <ul
          class="absolute left-0 right-0 top-full z-20 m-0 mt-1 max-h-48 list-none overflow-y-auto rounded-[var(--radius-md)] border border-info/60 bg-bg-surface p-1 shadow-lg"
          data-level-cap-tag-list
        >
          {#each listOptions as tag, i (tag)}
            <li>
              <button
                type="button"
                class="w-full cursor-pointer truncate rounded px-2 py-1 text-left text-sm {i ===
                listActive
                  ? 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent'
                  : 'text-text-primary hover:bg-bg-raised'}"
                onmouseenter={() => (listActive = i)}
                onmousedown={(e) => {
                  // Keep focus in the input so its blur does not add the half-typed draft.
                  e.preventDefault();
                  pickListTag(tag);
                }}>{tag}</button
              >
            </li>
          {:else}
            <li class="px-2 py-1 text-xs text-text-muted">{$t("levelCap.editor.noMatch")}</li>
          {/each}
        </ul>
      {/if}
    </span>
  </div>

  {#if catalog}
    <div class="flex flex-col gap-2">
      <LevelCapSlotEditor
        kind="suit"
        label="profile.warframe"
        item={draft.suit}
        {catalog}
        itemOptions={suitOptions}
        {abilityNames}
        removable={false}
        open
        onChange={(item) => setSlot("suit", item)}
      />
      {#each SLOTS as slot (slot.kind)}
        <LevelCapSlotEditor
          kind={slot.kind}
          label={slot.label}
          item={draft[slot.kind]}
          {catalog}
          itemOptions={catalog[slot.kind]}
          onChange={(item) => setSlot(slot.kind, item)}
        />
      {/each}
    </div>
  {:else}
    <span class="text-xs text-text-muted">{$t("common.loading")}</span>
  {/if}

  <div
    class="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border/60 bg-[var(--ui-modal-bg)] py-2"
  >
    <ThemedButton size="compact" disabled={busy} onClick={remove}
      >{$t("levelCap.editor.delete")}</ThemedButton
    >
    <ThemedButton
      size="compact"
      disabled={busy}
      title={$t("levelCap.editor.fromEquippedHint")}
      onClick={fromEquipped}>{$t("levelCap.editor.fromEquipped")}</ThemedButton
    >
    <span class="ml-auto"></span>
    <ThemedButton size="compact" disabled={busy} onClick={onDone}
      >{$t("common.cancel")}</ThemedButton
    >
    <ThemedButton size="compact" active disabled={busy || !dirty || !name.trim()} onClick={save}
      >{$t("levelCap.editor.save", { count: String(runCount) })}</ThemedButton
    >
  </div>
</div>
