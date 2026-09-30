<script lang="ts">
  import type { Snippet } from "svelte";

  let { x, y, children }: { x: number; y: number; children: Snippet } = $props();

  // A modal panel uses CSS containment, which pins fixed children to the panel
  // instead of the window; living under body keeps the tooltip on the pointer.
  function toBody(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // Flips to the pointer's left near the window's right edge.
  const flip = $derived(typeof window !== "undefined" && x > window.innerWidth - 240);
</script>

<div
  use:toBody
  class="pointer-events-none fixed z-[1100] min-w-[9rem] max-w-[16rem] rounded-[var(--radius-sm)] border border-border-strong bg-[var(--surface-tooltip)] px-2.5 py-1.5 text-xs shadow-[var(--ui-panel-shadow)]"
  style="left:{flip ? x - 14 : x + 14}px; top:{y + 14}px; {flip
    ? 'transform:translateX(-100%)'
    : ''}"
  aria-hidden="true"
>
  {@render children()}
</div>
