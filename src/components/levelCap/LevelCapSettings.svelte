<script lang="ts">
  import { untrack } from "svelte";

  import type { LevelCapSettings } from "../../types/ipc.js";
  import { tr as t } from "../../lib/i18n.js";
  import { pickLevelCapFolder, updateLevelCapSettings } from "../../stores/levelCap.js";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedPanel from "../ThemedPanel.svelte";

  let { settings }: { settings: LevelCapSettings } = $props();

  let hotkeyDraft = $state(untrack(() => settings.hotkey));

  function commitHotkey(): void {
    const next = hotkeyDraft.trim();
    if (next !== settings.hotkey) void updateLevelCapSettings({ hotkey: next });
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
  </label>

  <label class="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
    <input
      type="checkbox"
      checked={settings.passthrough}
      onchange={(e) => updateLevelCapSettings({ passthrough: e.currentTarget.checked })}
    />
    {$t("levelCap.settings.passthrough")}
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
