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
    <span class="text-[10px] uppercase tracking-wide text-text-muted">{$t("common.tags")}</span>
    {#each tags as tag (tag)}
      <span
        class="inline-flex items-center gap-1 rounded border border-info/40 bg-info/10 px-2 py-0.5 text-xs font-semibold text-info"
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
    <input
      class="w-40 rounded border border-border bg-bg-raised px-2 py-0.5 text-xs text-text-primary outline-none focus:border-info"
      type="text"
      maxlength="32"
      list="level-cap-build-tags"
      placeholder={$t("arbi.tags.add")}
      bind:value={tagDraft}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addTag();
        }
      }}
      onblur={addTag}
    />
    <datalist id="level-cap-build-tags">
      {#each tagSuggestions.filter((tag) => !tags.includes(tag)) as tag (tag)}
        <option value={tag}></option>
      {/each}
    </datalist>
  </div>

  {#if catalog}
    <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
      <LevelCapSlotEditor
        kind="suit"
        label="profile.warframe"
        item={draft.suit}
        {catalog}
        itemOptions={suitOptions}
        {abilityNames}
        removable={false}
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
