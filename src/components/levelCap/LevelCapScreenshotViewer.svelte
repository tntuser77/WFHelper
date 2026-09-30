<script lang="ts">
  import { tick } from "svelte";

  import { tr as t } from "../../lib/i18n.js";
  import { invoke } from "../../lib/ipc.js";
  import { log } from "../../lib/log.js";
  import ModalShell from "../ModalShell.svelte";

  let { runId, onClose }: { runId: string; onClose: () => void } = $props();

  let url = $state<string | null>(null);
  let failed = $state(false);
  /** Fit to the window, or the picture's own pixels with scrolling. */
  let actualSize = $state(false);

  $effect(() => {
    const id = runId;
    let live = true;
    invoke("getLevelCapScreenshot", id)
      .then((value) => {
        if (!live) return;
        url = value;
        failed = !value;
      })
      .catch((err) => {
        log.warn("[LevelCap] screenshot failed", String(err));
        if (live) failed = true;
      });
    return () => {
      live = false;
    };
  });

  let scroller = $state<HTMLElement | null>(null);

  /** Zooming in keeps the clicked spot under the pointer. */
  async function toggleZoom(event: MouseEvent): Promise<void> {
    const img = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const rect = img?.getBoundingClientRect();
    actualSize = !actualSize;
    if (!actualSize || !rect || !scroller) return;
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    await tick();
    const box = scroller.getBoundingClientRect();
    scroller.scrollLeft = fx * scroller.scrollWidth - (event.clientX - box.left);
    scroller.scrollTop = fy * scroller.scrollHeight - (event.clientY - box.top);
  }

  // The frame window's panel uses CSS containment, which would pin this overlay
  // inside it; under body it covers the whole app window.
  function toBody(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<!-- Right-click anywhere closes it, like the app's other right-click-to-clear spots. -->
<div
  use:toBody
  role="presentation"
  oncontextmenu={(event) => {
    event.preventDefault();
    onClose();
  }}
  data-level-cap-screenshot-viewer
>
  <ModalShell ariaLabel={$t("levelCap.openScreenshot")} {onClose} overlayClass="!z-[1050]">
    <div
      class="relative flex max-h-[96vh] max-w-[96vw] flex-col gap-2 rounded-[var(--radius-lg)] border border-border-strong bg-[var(--ui-modal-bg)] p-2 shadow-[var(--ui-panel-shadow)]"
    >
      <div class="flex items-center gap-2">
        <span class="text-xs text-text-muted"
          >{$t(actualSize ? "levelCap.screenshot.fitHint" : "levelCap.screenshot.zoomHint")}</span
        >
        <button
          type="button"
          class="ml-auto cursor-pointer rounded px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-raised hover:text-text-primary"
          onclick={() => invoke("openLevelCapScreenshot", runId)}
          >{$t("levelCap.screenshot.openExternal")}</button
        >
        <button
          type="button"
          class="cursor-pointer rounded px-2 py-0.5 text-sm text-text-secondary hover:bg-bg-raised hover:text-text-primary"
          aria-label={$t("common.close")}
          onclick={onClose}>✕</button
        >
      </div>
      {#if url}
        <div class="min-h-0 overflow-auto" bind:this={scroller}>
          <button
            type="button"
            class="block p-0 {actualSize ? 'cursor-zoom-out' : 'cursor-zoom-in'}"
            onclick={toggleZoom}
          >
            <img
              src={url}
              alt=""
              class="block {actualSize ? 'max-w-none' : 'max-h-[calc(96vh-3rem)] max-w-full'}"
            />
          </button>
        </div>
      {:else}
        <div class="flex h-40 w-80 items-center justify-center text-xs text-text-muted">
          {failed ? $t("levelCap.noScreenshot") : $t("common.loading")}
        </div>
      {/if}
    </div>
  </ModalShell>
</div>
