<script lang="ts">
  import { onMount } from "svelte";

  import { confirmWithDialog, invoke } from "../lib/ipc.js";
  import { tr, type MessageKey } from "../lib/i18n.js";
  import SettingsRow from "../components/settings/SettingsRow.svelte";
  import SettingsSection from "../components/settings/SettingsSection.svelte";
  import {
    COMBO_MAX_STEPS,
    COOLDOWN_MAX_MS,
    DEFAULT_MEXIAN_PROFILE,
    MACRO_KEY_NAMES,
    MEXIAN_MAX_MS,
    MEXIAN_TIMINGS,
    PROFILE_NAME_MAX,
    SPAM_RATE_MAX,
    TAP_MAX_MS,
    cleanProfileName,
    effectiveMexianTimes,
    type MacroPaths,
    type MacroScriptAction,
    type MacroSettings,
    type MacroStatus,
    type MacrosPayload,
    type MexianTiming,
  } from "../../config/shared/macros.js";

  // The script can be started or killed outside WFHelper, so its status is polled.
  const STATUS_POLL_MS = 3000;

  const TIMING_LABELS: Record<MexianTiming, MessageKey> = {
    swap: "macros.timing.swap",
    unblock: "macros.timing.unblock",
    jump: "macros.timing.jump",
    roll: "macros.timing.roll",
  };

  const KEY_LABELS: Record<(typeof MACRO_KEY_NAMES)[number], MessageKey> = {
    melee: "macros.key.melee",
    swap: "macros.key.swap",
    jump: "macros.key.jump",
    roll: "macros.key.roll",
    block: "macros.key.block",
  };

  let settings = $state<MacroSettings | null>(null);
  let paths = $state<MacroPaths | null>(null);
  let status = $state<MacroStatus | null>(null);
  let failed = $state(false);
  let busy = $state(false);
  let profileDraft = $state("");
  let scriptDraft = $state("");
  let mexianDraft = $state("");

  const activeProfile = $derived(
    settings?.mexian.profiles.find((p) => p.name === settings?.mexian.active) ?? null,
  );
  const timeline = $derived.by(() => {
    if (!settings || !activeProfile) return null;
    const times = effectiveMexianTimes(activeProfile, settings.frameMs);
    const end = Math.max(times.roll, times.swap) + settings.holdMs;
    const marks = [
      { label: $tr("rivens.type.melee"), at: 0 },
      ...MEXIAN_TIMINGS.map((field) => ({ label: $tr(TIMING_LABELS[field]), at: times[field] })),
    ].sort((a, b) => a.at - b.at);
    return { end, marks, adjusted: MEXIAN_TIMINGS.some((f) => times[f] !== activeProfile[f]) };
  });

  function apply(payload: MacrosPayload): void {
    settings = payload.settings;
    status = payload.status;
    if (!paths || paths.script !== payload.paths.script) scriptDraft = payload.paths.script;
    if (!paths || paths.mexianIni !== payload.paths.mexianIni)
      mexianDraft = payload.paths.mexianIni;
    paths = payload.paths;
  }

  async function load(): Promise<void> {
    try {
      apply(await invoke("getMacros"));
      failed = false;
    } catch {
      failed = true;
    }
  }

  async function save(): Promise<void> {
    if (!settings) return;
    try {
      apply(await invoke("saveMacros", $state.snapshot(settings)));
    } catch {
      failed = true;
    }
  }

  async function script(action: MacroScriptAction): Promise<void> {
    busy = true;
    try {
      apply(await invoke("runMacroScript", action));
      // The launcher takes a moment to hand over to the interpreter.
      if (action !== "folder") setTimeout(() => void pollStatus(), 1200);
    } finally {
      busy = false;
    }
  }

  async function pollStatus(): Promise<void> {
    try {
      status = await invoke("getMacroStatus");
    } catch {
      // keep the last known status
    }
  }

  async function setPaths(patch: { script?: string; mexianIni?: string }): Promise<void> {
    try {
      apply(await invoke("setMacroPaths", patch));
    } catch {
      failed = true;
    }
  }

  function nameTaken(name: string): boolean {
    return !!settings?.mexian.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase());
  }

  const draftName = $derived(cleanProfileName(profileDraft));

  function addProfile(): void {
    if (!settings || !draftName || nameTaken(draftName)) return;
    const base = activeProfile ?? { ...DEFAULT_MEXIAN_PROFILE };
    settings.mexian.profiles.push({
      name: draftName,
      swap: base.swap,
      unblock: base.unblock,
      jump: base.jump,
      roll: base.roll,
    });
    settings.mexian.active = draftName;
    profileDraft = "";
    void save();
  }

  function renameProfile(): void {
    if (!settings || !activeProfile || !draftName) return;
    // A case-only rename of the same profile is fine; another profile's name is not.
    if (draftName.toLowerCase() !== activeProfile.name.toLowerCase() && nameTaken(draftName))
      return;
    activeProfile.name = draftName;
    settings.mexian.active = draftName;
    profileDraft = "";
    void save();
  }

  async function deleteProfile(): Promise<void> {
    if (!settings || !activeProfile || settings.mexian.profiles.length < 2) return;
    const name = activeProfile.name;
    if (!(await confirmWithDialog($tr("macros.deleteProfileConfirm", { name }), $tr))) return;
    settings.mexian.profiles = settings.mexian.profiles.filter((p) => p.name !== name);
    settings.mexian.active = settings.mexian.profiles[0].name;
    void save();
  }

  function addStep(): void {
    if (!settings || settings.wheelCombo.steps.length >= COMBO_MAX_STEPS) return;
    const steps = settings.wheelCombo.steps;
    // The old last step's wait was unused; give it a real gap now that one follows.
    if (steps.length && steps[steps.length - 1].wait === 0) steps[steps.length - 1].wait = 50;
    steps.push({ key: steps[steps.length - 1]?.key ?? "e", wait: 0 });
    void save();
  }

  function removeStep(index: number): void {
    if (!settings || settings.wheelCombo.steps.length < 2) return;
    settings.wheelCombo.steps.splice(index, 1);
    void save();
  }

  function clearOnRightClick(event: MouseEvent, clear: () => void): void {
    event.preventDefault();
    clear();
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => void pollStatus(), STATUS_POLL_MS);
    // The wfm web app edits the same stance timings; pick those up on return.
    const onFocus = () => {
      if (!(document.activeElement instanceof HTMLInputElement)) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  });
</script>

<section class="view active" data-macros-view>
  <div class="mx-auto flex w-full max-w-[1280px] flex-col gap-4 py-4">
    <header class="view-header mb-0 flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <h2>{$tr("nav.macros")}</h2>
        <p class="m-0 text-sm text-text-secondary">{$tr("macros.liveHint")}</p>
      </div>
      {#if status}
        <div class="ml-auto flex flex-wrap items-center gap-2" data-macros-status>
          <span
            class="flex items-center gap-1.5 text-sm"
            class:text-success={status.running}
            class:text-text-muted={!status.running && status.scriptFound}
            class:text-danger={!status.scriptFound}
          >
            <span class="h-2 w-2 rounded-full bg-current" aria-hidden="true"></span>
            {status.running
              ? $tr("macros.scriptRunning")
              : status.scriptFound
                ? $tr("macros.scriptStopped")
                : $tr("macros.scriptMissing")}
          </span>
          <button
            class="btn-secondary btn-sm"
            disabled={busy || !status.scriptFound}
            onclick={() => script("start")}
            >{status.running ? $tr("macros.restart") : $tr("macros.start")}</button
          >
          {#if status.running}
            <button class="btn-secondary btn-sm" disabled={busy} onclick={() => script("stop")}
              >{$tr("macros.stop")}</button
            >
          {/if}
          <button class="btn-secondary btn-sm" onclick={() => script("folder")}
            >{$tr("arbi.showInFolder")}</button
          >
        </div>
      {/if}
    </header>

    {#if failed && !settings}
      <p class="m-0 text-center text-sm text-text-muted">{$tr("macros.loadFailed")}</p>
    {:else if settings}
      <div class="macros-grid">
        <SettingsSection title="Mexian" description={$tr("macros.mexianDesc")}>
          <div class="mt-2.5 grid gap-1" data-macro="mexian">
            <SettingsRow label={$tr("marketAlerts.enabled")}>
              <input type="checkbox" bind:checked={settings.mexian.enabled} onchange={save} />
            </SettingsRow>
            <SettingsRow label={$tr("macros.cooldown")} inputRow>
              <input
                type="number"
                min="0"
                max={COOLDOWN_MAX_MS}
                step="10"
                class="macro-input"
                bind:value={settings.mexian.cooldownMs}
                onchange={save}
              />
            </SettingsRow>
            <SettingsRow label={$tr("macros.profile")} inputRow>
              <select
                class="macro-input macro-select"
                bind:value={settings.mexian.active}
                onchange={save}
                data-macro-profile
              >
                {#each settings.mexian.profiles as profile (profile.name)}
                  <option value={profile.name}>{profile.name}</option>
                {/each}
              </select>
            </SettingsRow>
            {#if activeProfile}
              {#each MEXIAN_TIMINGS as field (field)}
                <SettingsRow label={$tr(TIMING_LABELS[field])} inputRow>
                  <input
                    type="number"
                    min="0"
                    max={MEXIAN_MAX_MS}
                    step="1"
                    class="macro-input"
                    bind:value={activeProfile[field]}
                    onchange={save}
                    data-macro-timing={field}
                  />
                </SettingsRow>
              {/each}
            {/if}
            {#if timeline}
              <div class="macro-timeline" aria-hidden="true">
                {#each timeline.marks as mark (mark.label)}
                  <div class="macro-mark" style:left="{(mark.at / timeline.end) * 100}%">
                    <span>{mark.label}</span>
                    <span class="tabular-nums text-text-muted">{mark.at}</span>
                  </div>
                {/each}
              </div>
              <p class="m-0 text-xs text-text-muted">
                {timeline.adjusted ? $tr("macros.timingAdjusted") : $tr("macros.timingHint")}
              </p>
            {/if}
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <input
                class="macro-input flex-1"
                maxlength={PROFILE_NAME_MAX}
                placeholder={$tr("macros.profileName")}
                bind:value={profileDraft}
                oncontextmenu={(e) => clearOnRightClick(e, () => (profileDraft = ""))}
                onkeydown={(e) => e.key === "Enter" && addProfile()}
              />
              <button
                class="btn-secondary btn-sm"
                disabled={!draftName || nameTaken(draftName)}
                onclick={addProfile}>{$tr("macros.newProfile")}</button
              >
              <button class="btn-secondary btn-sm" disabled={!draftName} onclick={renameProfile}
                >{$tr("workspaces.rename")}</button
              >
              <button
                class="btn-secondary btn-sm"
                disabled={settings.mexian.profiles.length < 2}
                onclick={deleteProfile}>{$tr("common.delete")}</button
              >
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title={$tr("macros.wheelCombo")}
          description={$tr("macros.wheelComboDesc")}
        >
          <div class="mt-2.5 grid gap-1" data-macro="wheelCombo">
            <SettingsRow label={$tr("marketAlerts.enabled")}>
              <input type="checkbox" bind:checked={settings.wheelCombo.enabled} onchange={save} />
            </SettingsRow>
            <SettingsRow label={$tr("macros.cooldown")} inputRow>
              <input
                type="number"
                min="0"
                max={COOLDOWN_MAX_MS}
                step="10"
                class="macro-input"
                bind:value={settings.wheelCombo.cooldownMs}
                onchange={save}
              />
            </SettingsRow>
            <ol class="m-0 mt-1 flex list-none flex-col gap-1.5 p-0" data-macro-steps>
              {#each settings.wheelCombo.steps as step, i (i)}
                <li class="flex items-center gap-2 text-sm text-text-secondary">
                  <span class="w-5 text-right tabular-nums text-text-muted">{i + 1}.</span>
                  <input
                    class="macro-input macro-key"
                    aria-label={$tr("macros.stepKey")}
                    bind:value={step.key}
                    onchange={save}
                  />
                  {#if i < settings.wheelCombo.steps.length - 1}
                    <span>{$tr("macros.thenWait")}</span>
                    <input
                      type="number"
                      min="0"
                      max={MEXIAN_MAX_MS}
                      step="5"
                      class="macro-input macro-ms"
                      aria-label={$tr("macros.thenWait")}
                      bind:value={step.wait}
                      onchange={save}
                    />
                    <span>ms</span>
                  {/if}
                  <button
                    class="btn-secondary btn-sm ml-auto"
                    disabled={settings.wheelCombo.steps.length < 2}
                    onclick={() => removeStep(i)}>{$tr("market.riven.removeListing")}</button
                  >
                </li>
              {/each}
            </ol>
            <div class="mt-2">
              <button
                class="btn-secondary btn-sm"
                disabled={settings.wheelCombo.steps.length >= COMBO_MAX_STEPS}
                onclick={addStep}>{$tr("macros.addStep")}</button
              >
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title={$tr("macros.keySpam")} description={$tr("macros.keySpamDesc")}>
          <div class="mt-2.5 grid gap-1" data-macro="keySpam">
            <SettingsRow label={$tr("marketAlerts.enabled")}>
              <input type="checkbox" bind:checked={settings.keySpam.enabled} onchange={save} />
            </SettingsRow>
            <SettingsRow label={$tr("macros.stepKey")} inputRow>
              <input class="macro-input" bind:value={settings.keySpam.key} onchange={save} />
            </SettingsRow>
            <SettingsRow label={$tr("macros.spamRate")} inputRow>
              <input
                type="number"
                min="1"
                max={SPAM_RATE_MAX}
                class="macro-input"
                bind:value={settings.keySpam.rate}
                onchange={save}
                data-macro-spam-rate
              />
            </SettingsRow>
          </div>
        </SettingsSection>

        <SettingsSection title={$tr("macros.keys")} description={$tr("macros.keysDesc")}>
          <div class="mt-2.5 grid gap-1" data-macro="keys">
            {#each MACRO_KEY_NAMES as name (name)}
              <SettingsRow label={$tr(KEY_LABELS[name])} inputRow>
                <input class="macro-input" bind:value={settings.keys[name]} onchange={save} />
              </SettingsRow>
            {/each}
            <SettingsRow label={$tr("macros.holdMs")} hint={$tr("macros.holdHint")} inputRow>
              <input
                type="number"
                min="1"
                max={TAP_MAX_MS}
                class="macro-input"
                bind:value={settings.holdMs}
                onchange={save}
              />
            </SettingsRow>
            <SettingsRow label={$tr("macros.frameMs")} hint={$tr("macros.frameHint")} inputRow>
              <input
                type="number"
                min="1"
                max={TAP_MAX_MS}
                class="macro-input"
                bind:value={settings.frameMs}
                onchange={save}
              />
            </SettingsRow>
          </div>
        </SettingsSection>

        {#if paths}
          <SettingsSection title={$tr("macros.files")}>
            <div class="mt-2.5 grid gap-2 text-sm" data-macro="files">
              <label class="flex flex-col gap-1">
                <span class="text-text-secondary">{$tr("macros.scriptPath")}</span>
                <input
                  class="macro-input macro-path"
                  bind:value={scriptDraft}
                  onchange={() => setPaths({ script: scriptDraft })}
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-text-secondary">{$tr("macros.mexianPath")}</span>
                <input
                  class="macro-input macro-path"
                  bind:value={mexianDraft}
                  onchange={() => setPaths({ mexianIni: mexianDraft })}
                />
              </label>
              <p class="m-0 break-all text-xs text-text-muted">
                {$tr("macros.settingsPath", { path: paths.settingsIni })}
              </p>
            </div>
          </SettingsSection>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .macros-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
    gap: 0.85rem;
    align-items: start;
  }

  .macro-input {
    min-width: 0;
    width: 8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-base);
    color: var(--text-primary);
    padding: 0.3rem 0.55rem;
    font-size: 0.875rem;
    outline: none;
  }

  .macro-input:focus {
    border-color: var(--accent-dim);
  }

  .macro-select {
    width: 11rem;
  }

  .macro-key {
    width: 6rem;
  }

  .macro-ms {
    width: 5rem;
  }

  .macro-path {
    width: 100%;
  }

  /* Labels alternate above and below the track so close marks don't collide. */
  .macro-timeline {
    position: relative;
    height: 4.2rem;
    margin: 0.6rem 2.5rem 0.2rem;
    background: linear-gradient(var(--border), var(--border)) center / 100% 2px no-repeat;
  }

  .macro-mark {
    position: absolute;
    top: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    transform: translate(-50%, -100%);
    font-size: 0.7rem;
    line-height: 1.1;
    white-space: nowrap;
    color: var(--text-secondary);
  }

  .macro-mark::after {
    content: "";
    width: 2px;
    height: 0.45rem;
    background: var(--accent);
  }

  .macro-mark:nth-child(even) {
    flex-direction: column-reverse;
    transform: translate(-50%, 0);
  }
</style>
