<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    summary,
    children,
  }: {
    title: string;
    /** What the section is set to, shown while it is folded. */
    summary: string;
    children: Snippet;
  } = $props();

  let open = $state(false);
</script>

<div class="border-t border-border-subtle" data-analytics-section={title}>
  <button
    type="button"
    class="flex w-full items-center gap-2 bg-transparent py-2.5 text-left text-xs text-text-primary"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span
      class="w-3 text-text-muted transition-transform {open ? 'rotate-90' : ''}"
      aria-hidden="true">▸</span
    >
    <span>{title}</span>
    <span class="ml-auto min-w-0 truncate pl-3 text-text-muted">{summary}</span>
  </button>
  {#if open}
    <div class="flex flex-col gap-3 pb-3 pl-5 text-xs">
      {@render children()}
    </div>
  {/if}
</div>
