<script lang="ts">
  import { onMount } from "svelte";

  import { LEVEL_CAP_EXOLIZER_TARGET } from "../../../config/shared/levelCapTypes.js";
  import { tr as t } from "../../lib/i18n.js";
  import { log } from "../../lib/log.js";
  import {
    levelCapFrames,
    levelCapSearchTerms,
    levelCapTagSuggestions,
    toggleLevelCapSearchTag,
  } from "../../lib/levelCap.js";
  import { importLevelCapFolders, levelCap, loadLevelCap } from "../../stores/levelCap.js";
  import { addToast } from "../../stores/toasts.js";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedPanel from "../ThemedPanel.svelte";
  import LevelCapFrameCard from "./LevelCapFrameCard.svelte";
  import LevelCapFrameModal from "./LevelCapFrameModal.svelte";
  import LevelCapSettings from "./LevelCapSettings.svelte";

  const target = String(LEVEL_CAP_EXOLIZER_TARGET);

  let showSettings = $state(false);
  let importing = $state(false);
  let frameSearch = $state("");
  let openFrame = $state<string | null>(null);

  onMount(() => {
    void loadLevelCap().catch((err) => log.warn("[LevelCap] load failed", String(err)));
  });

  const runs = $derived($levelCap?.runs ?? []);
  const settings = $derived($levelCap?.settings ?? null);
  const status = $derived($levelCap?.status ?? null);
  const abilityNames = $derived($levelCap?.abilityNames ?? {});
  const frames = $derived(levelCapFrames(runs));
  const builds = $derived($levelCap?.builds ?? []);
  // Build tags plus the ones still on untagged-build runs, lowercased for search.
  const tagsByFrame = $derived.by(() => {
    const byFrame: Record<string, string[]> = {};
    for (const entry of [...builds, ...runs]) {
      for (const tag of entry.tags ?? []) (byFrame[entry.frame] ??= []).push(tag.toLowerCase());
    }
    return byFrame;
  });
  const searchTerms = $derived(levelCapSearchTerms(frameSearch));
  const visibleFrames = $derived.by(() => {
    if (!searchTerms.length) return frames;
    return frames.filter((row) =>
      searchTerms.every(
        (term) =>
          row.frame.toLowerCase().includes(term) ||
          (tagsByFrame[row.frame] ?? []).some((tag) => tag.includes(term)),
      ),
    );
  });
  const runsByFrame = $derived.by(() => {
    const byFrame: Record<string, typeof runs> = {};
    for (const run of runs) (byFrame[run.frame] ??= []).push(run);
    return byFrame;
  });
  const buildsByFrame = $derived.by(() => {
    const byFrame: Record<string, typeof builds> = {};
    for (const build of builds) (byFrame[build.frame] ??= []).push(build);
    return byFrame;
  });
  // The frame vanishes from the list when its last run is deleted; close with it.
  const openRow = $derived(frames.find((row) => row.frame === openFrame) ?? null);
  // Runs still carry tags until they are put on a build, so offer those too.
  const tagSuggestions = $derived(levelCapTagSuggestions([...builds, ...runs]));
  const QUICK_TAG_COUNT = 8;
  const quickTags = $derived(tagSuggestions.slice(0, QUICK_TAG_COUNT));

  function isSearch(tag: string): boolean {
    return searchTerms.includes(tag.toLowerCase());
  }

  /** Clicking a tag adds it to the search; clicking it again takes it out. */
  function searchTag(tag: string): void {
    frameSearch = toggleLevelCapSearchTag(frameSearch, tag);
  }

  function clearTag(tag: string): void {
    if (isSearch(tag)) frameSearch = toggleLevelCapSearchTag(frameSearch, tag);
  }

  async function runImport(): Promise<void> {
    importing = true;
    try {
      const count = await importLevelCapFolders();
      addToast({
        level: count ? "success" : "info",
        message: count
          ? $t("levelCap.importDone", { count: String(count) })
          : $t("levelCap.importNone"),
      });
    } catch (err) {
      log.warn("[LevelCap] import failed", String(err));
    } finally {
      importing = false;
    }
  }

  function statusLine(): string {
    if (!settings) return "";
    if (status?.inCascade) {
      if (status.runId) return $t("levelCap.status.logged", { key: settings.hotkey });
      // A squad client's log has rounds but never the Exolizer count.
      if (status.exolizers !== null) {
        return $t("levelCap.status.live", { count: String(status.exolizers), target });
      }
      return status.rounds !== null
        ? $t("levelCap.status.liveRound", { round: String(status.rounds) })
        : $t("levelCap.status.liveUnknown");
    }
    return settings.hotkey
      ? $t("levelCap.status.idle", { key: settings.hotkey })
      : $t("levelCap.status.noKey");
  }
</script>

<header class="view-header mb-0 flex-nowrap items-start" data-level-cap>
  <div class="flex shrink-0 flex-col gap-1">
    <h2>{$t("nav.levelCap")}</h2>
    <p class="m-0 text-sm text-text-secondary">{$t("levelCap.subtitle", { target })}</p>
    <p class="m-0 text-xs {status?.inCascade ? 'text-accent' : 'text-text-muted'}">
      {statusLine()}
    </p>
  </div>
  {#if frames.length}
    <div class="flex min-w-0 max-w-3xl flex-1 flex-col gap-2">
      <input
        class="w-full rounded-[var(--radius-md)] border border-border bg-bg-raised px-4 py-3 text-base text-text-primary outline-none focus:border-info"
        type="search"
        placeholder={$t("levelCap.searchFrames")}
        bind:value={frameSearch}
      />
      {#if quickTags.length}
        <div class="flex flex-wrap gap-1.5" data-level-cap-quick-tags>
          {#each quickTags as tag (tag)}
            <button
              type="button"
              class="cursor-pointer rounded border px-2 py-0.5 text-xs font-semibold transition-colors duration-100 {isSearch(
                tag,
              )
                ? 'border-info bg-info/25 text-text-primary'
                : 'border-info/40 bg-info/10 text-info hover:border-info'}"
              title={$t("levelCap.tagHint")}
              onclick={() => searchTag(tag)}
              oncontextmenu={(event) => {
                event.preventDefault();
                clearTag(tag);
              }}>{tag}</button
            >
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  <div class="flex shrink-0 items-center gap-2">
    <ThemedButton disabled={importing} onClick={runImport}>{$t("levelCap.import")}</ThemedButton>
    <ThemedButton active={showSettings} onClick={() => (showSettings = !showSettings)}
      >{$t("common.settings")}</ThemedButton
    >
  </div>
</header>

{#if showSettings && settings}
  <LevelCapSettings {settings} />
{/if}

{#if $levelCap && !runs.length}
  <ThemedPanel className="p-6 text-center text-sm text-text-secondary">
    {$t("levelCap.empty")}
  </ThemedPanel>
{:else if runs.length}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {#each visibleFrames as row (row.frame)}
      <LevelCapFrameCard
        {row}
        runs={runsByFrame[row.frame] ?? []}
        builds={buildsByFrame[row.frame] ?? []}
        {searchTerms}
        tagOrder={tagSuggestions}
        onOpen={() => (openFrame = row.frame)}
        onSearchTag={searchTag}
        onClearTag={clearTag}
      />
    {/each}
  </div>
{/if}

{#if openRow}
  <LevelCapFrameModal
    row={openRow}
    runs={runsByFrame[openRow.frame] ?? []}
    builds={buildsByFrame[openRow.frame] ?? []}
    {tagSuggestions}
    {abilityNames}
    onClose={() => (openFrame = null)}
  />
{/if}
