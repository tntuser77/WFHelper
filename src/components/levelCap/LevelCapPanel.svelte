<script lang="ts">
  import { onMount } from "svelte";

  import { LEVEL_CAP_EXOLIZER_TARGET } from "../../../config/shared/levelCapTypes.js";
  import { tr as t } from "../../lib/i18n.js";
  import { log } from "../../lib/log.js";
  import { levelCapFrames, levelCapTagSuggestions } from "../../lib/levelCap.js";
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
  const visibleFrames = $derived.by(() => {
    const query = frameSearch.trim().toLowerCase();
    if (!query) return frames;
    return frames.filter(
      (row) =>
        row.frame.toLowerCase().includes(query) ||
        (tagsByFrame[row.frame] ?? []).some((tag) => tag.includes(query)),
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

  function isSearch(tag: string): boolean {
    return frameSearch.trim().toLowerCase() === tag.toLowerCase();
  }

  /** Clicking a tag searches for it; clicking the searched tag again clears it. */
  function searchTag(tag: string): void {
    frameSearch = isSearch(tag) ? "" : tag;
  }

  function clearTag(tag: string): void {
    if (isSearch(tag)) frameSearch = "";
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

<header class="view-header mb-0 items-end" data-level-cap>
  <div class="flex flex-col gap-1">
    <h2>{$t("nav.levelCap")}</h2>
    <p class="m-0 text-sm text-text-secondary">{$t("levelCap.subtitle", { target })}</p>
    <p class="m-0 text-xs {status?.inCascade ? 'text-accent' : 'text-text-muted'}">
      {statusLine()}
    </p>
  </div>
  <div class="flex items-center gap-2">
    {#if frames.length}
      <input
        class="w-80 rounded border border-border bg-bg-raised px-2 py-1 text-sm text-text-primary outline-none focus:border-info"
        type="search"
        placeholder={$t("levelCap.searchFrames")}
        bind:value={frameSearch}
      />
    {/if}
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
        search={frameSearch}
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
