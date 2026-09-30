<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "../../lib/ipc.js";
  import { tr, type MessageKey } from "../../lib/i18n.js";
  import SettingsSection from "./SettingsSection.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import type { PhoneSyncState } from "../../../config/shared/phoneSnapshot.js";

  const ERROR_KEYS: Record<string, MessageKey> = {
    "invalid-url": "settings.phoneErrorInvalid",
    "blocked-url": "settings.phoneErrorBlocked",
    "empty-key": "settings.phoneErrorEmptyKey",
    unreachable: "settings.phoneErrorUnreachable",
  };
  // The sent times tick over while the card is open.
  const REFRESH_MS = 15_000;

  let sync = $state<PhoneSyncState | null>(null);
  let urlDraft = $state("");
  let keyDraft = $state("");
  let busy = $state(false);
  let qr = $state<string | null>(null);
  let code = $state<string | null>(null);
  let copied = $state(false);
  let message = $state<{ text: string; error: boolean } | null>(null);
  let now = $state(Date.now());

  const configured = $derived(!!sync?.url && !!sync?.keySet);

  async function refresh(): Promise<void> {
    try {
      sync = await invoke("getPhoneSync");
      if (!urlDraft) urlDraft = sync.url;
    } catch {
      sync = null;
    }
  }

  function say(text: string, error = false): void {
    message = { text, error };
  }

  async function act(run: () => Promise<void>): Promise<void> {
    busy = true;
    message = null;
    try {
      await run();
    } catch {
      say($tr("settings.saveFailed"), true);
    } finally {
      busy = false;
    }
  }

  const save = () =>
    act(async () => {
      const result = await invoke("setPhoneSyncConfig", urlDraft, keyDraft);
      if (result.ok) {
        sync = result.value;
        urlDraft = result.value.url;
        keyDraft = "";
        say($tr("settings.phoneSaved"));
      } else {
        say($tr(ERROR_KEYS[result.error] ?? "settings.phoneErrorUnreachable"), true);
      }
    });

  const clear = () =>
    act(async () => {
      sync = await invoke("clearPhoneSync");
      urlDraft = "";
      keyDraft = "";
      qr = null;
    });

  const pair = () =>
    act(async () => {
      const result = await invoke("pairPhone");
      if (result.ok) {
        sync = result.value.state;
        qr = result.value.qr;
        code = result.value.code;
        copied = false;
      } else {
        say(result.error, true);
      }
    });

  const unpair = () =>
    act(async () => {
      const result = await invoke("unpairPhone");
      if (result.ok) {
        sync = result.value;
        qr = null;
      } else {
        say(result.error, true);
      }
    });

  const sendNow = () =>
    act(async () => {
      sync = await invoke("syncPhoneNow");
      if (sync.lastError) say(sync.lastError, true);
    });

  function sentLabel(at: number | null | undefined): string {
    if (!at) return $tr("settings.phoneNotSent");
    const sec = Math.max(0, Math.floor((now - at) / 1000));
    if (sec < 60) return $tr("common.updatedJustNow");
    if (sec < 3600) return $tr("common.updatedMAgo", { min: Math.floor(sec / 60) });
    if (sec < 86400) return $tr("common.updatedHAgo", { hr: Math.floor(sec / 3600) });
    return $tr("common.updatedDAgo", { days: Math.floor(sec / 86400) });
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => {
      now = Date.now();
      void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  });
</script>

<SettingsSection
  title={$tr("settings.phoneTitle")}
  description={$tr("settings.phoneDesc")}
  info={$tr("settings.phoneInfo")}
  sectionId="phone"
>
  <div class="mt-2.5 grid gap-1">
    <SettingsRow label={$tr("settings.phoneUrl")} dataSetting="phone-url" inputRow>
      <input
        type="url"
        class="settings-input"
        placeholder="https://…workers.dev"
        autocomplete="off"
        spellcheck="false"
        disabled={busy}
        bind:value={urlDraft}
      />
    </SettingsRow>
    <SettingsRow
      label={$tr("settings.phoneKey")}
      hint={sync?.keySet
        ? sync.keyPersisted
          ? $tr("settings.phoneKeySaved")
          : $tr("settings.phoneKeyNotPersisted")
        : undefined}
      dataSetting="phone-key"
      inputRow
    >
      <input
        type="password"
        class="settings-input"
        autocomplete="off"
        spellcheck="false"
        disabled={busy}
        bind:value={keyDraft}
      />
    </SettingsRow>

    <div class="mt-1 flex flex-wrap justify-end gap-2">
      <button
        class="btn-secondary btn-sm"
        disabled={busy || !urlDraft || (!keyDraft && !sync?.keySet)}
        onclick={save}>{$tr("common.save")}</button
      >
      <button class="btn-secondary btn-sm" disabled={busy || !configured} onclick={clear}
        >{$tr("settings.webhookClear")}</button
      >
    </div>

    {#if configured}
      <SettingsRow
        label={sync?.pairedAt ? $tr("settings.phonePaired") : $tr("settings.phoneNotPaired")}
        dataSetting="phone-pairing"
        as="div"
      >
        <span class="flex flex-wrap justify-end gap-2">
          <button class="btn-secondary btn-sm" disabled={busy} onclick={pair}
            >{sync?.pairedAt ? $tr("settings.phoneRepair") : $tr("settings.phonePair")}</button
          >
          {#if sync?.pairedAt}
            <button class="btn-secondary btn-sm" disabled={busy} onclick={unpair}
              >{$tr("settings.phoneUnpair")}</button
            >
          {/if}
        </span>
      </SettingsRow>

      {#if qr}
        <!-- Right-click closes it, like other viewers in the app. -->
        <div
          class="mt-1 flex flex-col items-center gap-2 rounded-md bg-white p-3"
          data-phone-qr
          role="presentation"
          oncontextmenu={(event) => {
            event.preventDefault();
            qr = null;
          }}
        >
          <img src={qr} alt={$tr("settings.phonePairHint")} class="size-56" />
          <p class="m-0 max-w-64 text-center text-xs text-black">
            {$tr("settings.phonePairHint")}
          </p>
          <span class="flex gap-2">
            <button
              class="btn-secondary btn-sm"
              disabled={!code}
              onclick={async () => {
                if (!code) return;
                await navigator.clipboard.writeText(code);
                copied = true;
              }}>{copied ? $tr("settings.copied") : $tr("settings.phoneCopyCode")}</button
            >
            <button class="btn-secondary btn-sm" onclick={() => (qr = null)}
              >{$tr("settings.phoneHideQr")}</button
            >
          </span>
        </div>
      {/if}

      <SettingsRow
        label={$tr("common.relics")}
        hint={sentLabel(sync?.lastSent.relics)}
        dataSetting="phone-sent-relics"
        as="div"
      >
        <span></span>
      </SettingsRow>
      <SettingsRow
        label={$tr("settings.phoneLevelCap")}
        hint={sentLabel(sync?.lastSent.levelcap)}
        dataSetting="phone-sent-levelcap"
        as="div"
      >
        <button class="btn-secondary btn-sm" disabled={busy} onclick={sendNow}
          >{$tr("settings.phoneSyncNow")}</button
        >
      </SettingsRow>
    {/if}

    {#if message}
      <p class="m-0 text-xs {message.error ? 'text-danger' : 'text-success'}" data-phone-message>
        {message.text}
      </p>
    {:else if sync?.lastError}
      <p class="m-0 text-xs text-danger">{sync.lastError}</p>
    {/if}
  </div>
</SettingsSection>
