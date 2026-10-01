<script lang="ts">
  import { untrack } from "svelte";

  import type { LevelCapPayload, LevelCapSettings } from "../../types/ipc.js";
  import {
    formatPlayerAliasLines,
    parsePlayerAliasLines,
  } from "../../../config/shared/playerAliases.js";
  import { tr as t } from "../../lib/i18n.js";
  import { pickLevelCapFolder, updateLevelCapSettings } from "../../stores/levelCap.js";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedPanel from "../ThemedPanel.svelte";

  let {
    settings,
    hotkey,
  }: { settings: LevelCapSettings; hotkey: LevelCapPayload["hotkey"] | null } = $props();

  let hotkeyDraft = $state(untrack(() => settings.hotkey));

  function commitHotkey(): void {
    const next = hotkeyDraft.trim();
    if (next !== settings.hotkey) void updateLevelCapSettings({ hotkey: next });
  }

  let playersDraft = $state(untrack(() => settings.knownPlayers.join("\n")));

  function commitPlayers(): void {
    const next = playersDraft
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
    if (next.join("\n") !== settings.knownPlayers.join("\n")) {
      void updateLevelCapSettings({ knownPlayers: next });
    }
  }

  let aliasesDraft = $state(untrack(() => formatPlayerAliasLines(settings.playerAliases)));

  function commitAliases(): void {
    const next = parsePlayerAliasLines(aliasesDraft);
    if (JSON.stringify(next) !== JSON.stringify(settings.playerAliases)) {
      void updateLevelCapSettings({ playerAliases: next });
    }
    aliasesDraft = formatPlayerAliasLines(next);
  }
</script>

<ThemedPanel className="flex flex-col gap-3 p-4">
  <label class="flex flex-col gap-1">
    <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
      >{$t("levelCap.settings.hotkey")}</span
    >
    <input
      class="w-40 rounded border border-border bg-bg-raised px-2 py-1 font-mono text-sm text-text-primary outline-none focus:border-info"
      type="text"
      maxlength="64"
      bind:value={hotkeyDraft}
      onblur={commitHotkey}
      onkeydown={(e) => e.key === "Enter" && commitHotkey()}
    />
    <span class="text-xs text-text-muted">{$t("levelCap.settings.hotkeyHint")}</span>
    {#if settings.hotkey && hotkey && !hotkey.bound}
      <span class="text-xs text-warning" data-level-cap-hotkey-unbound
        >{$t("levelCap.settings.hotkeyUnbound", { key: settings.hotkey })}</span
      >
    {/if}
  </label>

  {#if hotkey?.canPassThrough !== false}
    <label class="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
      <input
        type="checkbox"
        checked={settings.passthrough}
        onchange={(e) => updateLevelCapSettings({ passthrough: e.currentTarget.checked })}
      />
      {$t("levelCap.settings.passthrough")}
    </label>
  {/if}

  <label class="flex flex-col gap-1">
    <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
      >{$t("levelCap.settings.knownPlayers")}</span
    >
    <textarea
      class="h-24 w-64 resize-y rounded border border-border bg-bg-raised px-2 py-1 font-mono text-sm text-text-primary outline-none focus:border-info"
      bind:value={playersDraft}
      onblur={commitPlayers}
      data-level-cap-known-players></textarea>
    <span class="text-xs text-text-muted">{$t("levelCap.settings.knownPlayersHint")}</span>
  </label>

  <label class="flex flex-col gap-1">
    <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
      >{$t("levelCap.settings.playerAliases")}</span
    >
    <textarea
      class="h-24 w-96 resize-y rounded border border-border bg-bg-raised px-2 py-1 font-mono text-sm text-text-primary outline-none focus:border-info"
      placeholder="MainName = AltName, OldName"
      bind:value={aliasesDraft}
      onblur={commitAliases}
      data-level-cap-player-aliases></textarea>
    <span class="text-xs text-text-muted">{$t("levelCap.settings.playerAliasesHint")}</span>
  </label>

  {#each [["screenshotDir", "levelCap.settings.screenshotDir"], ["backupDir", "levelCap.settings.backupDir"]] as const as [kind, labelKey] (kind)}
    <div class="flex flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
        >{$t(labelKey)}</span
      >
      <div class="flex items-center gap-2">
        <code
          class="min-w-0 flex-1 truncate rounded bg-bg-raised px-2 py-1 text-xs text-text-secondary"
          >{settings[kind] || $t("levelCap.settings.backupNone")}</code
        >
        <ThemedButton size="compact" onClick={() => pickLevelCapFolder(kind)}
          >{$t("levelCap.settings.change")}</ThemedButton
        >
        {#if kind === "backupDir" && settings.backupDir}
          <ThemedButton size="compact" onClick={() => updateLevelCapSettings({ backupDir: "" })}
            >{$t("levelCap.settings.clear")}</ThemedButton
          >
        {/if}
      </div>
      {#if kind === "backupDir"}
        <span class="text-xs text-text-muted">{$t("levelCap.settings.backupHint")}</span>
      {/if}
    </div>
  {/each}
</ThemedPanel>
