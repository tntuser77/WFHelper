<script lang="ts">
  import { tr as t } from "../../lib/i18n.js";

  interface Option {
    type: string;
    name: string;
  }

  let {
    options,
    fallback = [],
    placeholder,
    onPick,
    onCancel,
  }: {
    options: readonly Option[];
    /** Searched when nothing in `options` matches, e.g. every mod when the slot's own type has none. */
    fallback?: readonly Option[];
    placeholder: string;
    onPick: (type: string) => void;
    onCancel: () => void;
  } = $props();

  const LIMIT = 60;

  let query = $state("");
  let active = $state(0);
  let input = $state<HTMLInputElement | null>(null);

  function search(list: readonly Option[], words: string[]): Option[] {
    const hits = list.filter((o) => words.every((w) => o.name.toLowerCase().includes(w)));
    // Names starting with the query first: "prim" finds Primed mods before Reaper Prime.
    const lead = words[0] ?? "";
    return hits.sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(lead)) -
          Number(!b.name.toLowerCase().startsWith(lead)) || a.name.localeCompare(b.name),
    );
  }

  const results = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const own = search(options, words);
    return (own.length || !words.length ? own : search(fallback, words)).slice(0, LIMIT);
  });

  $effect(() => {
    input?.focus();
  });

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, results.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) onPick(hit.type);
    } else if (e.key === "Escape") {
      // Close the picker, not the whole dialog.
      e.stopPropagation();
      onCancel();
    }
  }
</script>

<div
  class="flex flex-col gap-1 rounded-[var(--radius-md)] border border-info/60 bg-bg-surface p-1.5 shadow-lg"
  data-level-cap-picker
>
  <input
    bind:this={input}
    class="w-full rounded border border-border bg-bg-raised px-2 py-1 text-sm text-text-primary outline-none focus:border-info"
    type="search"
    {placeholder}
    bind:value={query}
    oninput={() => (active = 0)}
    onkeydown={onKeydown}
  />
  <ul class="m-0 max-h-64 list-none overflow-y-auto p-0">
    {#each results as option, i (option.type)}
      <li>
        <button
          type="button"
          class="w-full cursor-pointer truncate rounded px-2 py-1 text-left text-sm {i === active
            ? 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent'
            : 'text-text-primary hover:bg-bg-raised'}"
          onmouseenter={() => (active = i)}
          onclick={() => onPick(option.type)}>{option.name}</button
        >
      </li>
    {:else}
      <li class="px-2 py-1 text-xs text-text-muted">{$t("levelCap.editor.noMatch")}</li>
    {/each}
  </ul>
  <button
    type="button"
    class="cursor-pointer self-end rounded px-2 py-0.5 text-xs text-text-muted hover:text-text-primary"
    onclick={onCancel}>{$t("common.cancel")}</button
  >
</div>
