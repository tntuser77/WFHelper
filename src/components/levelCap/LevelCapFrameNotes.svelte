<script lang="ts">
  import { onDestroy, untrack } from "svelte";

  import { tr as t } from "../../lib/i18n.js";
  import { log } from "../../lib/log.js";
  import { setLevelCapNotes } from "../../stores/levelCap.js";

  let { frame, notes }: { frame: string; notes: string } = $props();

  let draft = $state(untrack(() => notes));
  let timer: ReturnType<typeof setTimeout> | null = null;

  function save(): void {
    void setLevelCapNotes(frame, draft).catch((err) =>
      log.warn("[LevelCap] notes save failed", String(err)),
    );
  }

  function onInput(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      save();
    }, 600);
  }

  /** Closing the modal inside the debounce window would drop the edit. */
  function flush(): void {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    save();
  }

  onDestroy(flush);
</script>

<label class="flex flex-col gap-1" data-level-cap-frame-notes>
  <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
    >{$t("arbi.notes.label")}</span
  >
  <textarea
    class="min-h-[3rem] w-full resize-y rounded border border-border bg-bg-raised px-2 py-1.5 text-sm text-text-primary outline-none focus:border-info"
    maxlength="2000"
    placeholder={$t("levelCap.notes.placeholder", { frame })}
    bind:value={draft}
    oninput={onInput}
    onblur={flush}></textarea>
</label>
