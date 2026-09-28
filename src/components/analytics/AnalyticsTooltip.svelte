<script lang="ts">
  import type { Snippet } from "svelte";

  let { x, y, children }: { x: number; y: number; children: Snippet } = $props();

  // Flips to the pointer's left near the window's right edge.
  const flip = $derived(typeof window !== "undefined" && x > window.innerWidth - 240);
</script>

<div
  class="pointer-events-none fixed z-[500] min-w-[9rem] max-w-[16rem] rounded-[var(--radius-sm)] border border-border-strong bg-[var(--surface-tooltip)] px-2.5 py-1.5 text-xs shadow-[var(--ui-panel-shadow)]"
  style="left:{flip ? x - 14 : x + 14}px; top:{y + 14}px; {flip
    ? 'transform:translateX(-100%)'
    : ''}"
  aria-hidden="true"
>
  {@render children()}
</div>
