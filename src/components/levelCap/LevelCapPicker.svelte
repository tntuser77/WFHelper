<script lang="ts">
  import { tr as t } from "../../lib/i18n.js";

  interface Option {
    type: string;
    name: string;
    /** Card text, e.g. "+55% Ability Duration"; searched after the name. */
    stats?: string;
    /** Mod capacity at max rank; mods list heaviest first and show it. */
    drain?: number;
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
  // Shorthand players type for mod stats; each stands for the whole phrase.
  const ALIASES: Record<string, string> = {
    pv: "parkour velocity",
    as: "attack speed",
    cc: "critical chance",
    cd: "critical damage",
    sc: "status chance",
    sd: "status damage",
  };

  let query = $state("");
  let active = $state(0);
  let input = $state<HTMLInputElement | null>(null);

  function search(list: readonly Option[], words: string[]): Option[] {
    const inName = (o: Option) => words.every((w) => o.name.toLowerCase().includes(w));
    const inText = (o: Option) =>
      words.every((w) => `${o.name} ${o.stats ?? ""}`.toLowerCase().includes(w));
    const hits = list.filter(inText);
    // Name hits beat card-text hits, and names starting with the query lead:
    // "prim" finds Primed mods before Reaper Prime.
    const lead = words[0] ?? "";
    const rank = (o: Option) => (inName(o) ? Number(!o.name.toLowerCase().startsWith(lead)) : 2);
    // Then by drain, heaviest first; auras by how much they give back.
    const drain = (o: Option) => Math.abs(o.drain ?? 0);
    return hits.sort(
      (a, b) => rank(a) - rank(b) || drain(b) - drain(a) || a.name.localeCompare(b.name),
    );
  }

  const results = $derived.by(() => {
    const words = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => ALIASES[word] ?? word);
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
          class="flex w-full cursor-pointer flex-col rounded px-2 py-1 text-left text-sm {i ===
          active
            ? 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent'
            : 'text-text-primary hover:bg-bg-raised'}"
          title={option.stats || undefined}
          onmouseenter={() => (active = i)}
          onclick={() => onPick(option.type)}
        >
          <span class="flex items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate">{option.name}</span>
            {#if option.drain}
              <span class="shrink-0 font-mono text-[11px] text-text-muted"
                >{option.drain > 0 ? option.drain : `+${-option.drain}`}</span
              >
            {/if}
          </span>
          {#if option.stats}
            <span class="truncate text-[11px] text-text-muted">{option.stats}</span>
          {/if}
        </button>
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
