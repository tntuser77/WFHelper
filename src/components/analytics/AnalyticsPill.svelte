<script lang="ts" generics="T extends string | number">
  import { tick } from "svelte";

  let {
    value,
    options,
    onChange,
    label,
  }: {
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (value: T) => void;
    /** What the pill chooses, for screen readers. */
    label: string;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLSpanElement | null>(null);
  let menu = $state<HTMLUListElement | null>(null);

  const current = $derived(options.find((o) => o.value === value)?.label ?? String(value));

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
    await tick();
    menu?.querySelector<HTMLButtonElement>("[aria-selected=true], button")?.focus();
  }

  function pick(next: T): void {
    open = false;
    onChange(next);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!open) return;
    const items = [...(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      // Closes the menu without the editor behind it closing too.
      event.stopPropagation();
      open = false;
      root?.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  }
</script>

<svelte:window
  onclick={(e) => {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span class="relative inline-block" bind:this={root} onkeydown={onKeydown}>
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-accent-dim bg-accent/10 px-2 py-0.5 font-semibold text-accent hover:bg-accent/20"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="{label}: {current}"
    onclick={toggle}
    data-analytics-pill
    >{current}<span aria-hidden="true" class="text-[0.7em] opacity-80">▾</span></button
  >
  {#if open}
    <ul
      class="absolute left-0 top-full z-20 m-0 mt-1 flex max-h-72 min-w-[11rem] list-none flex-col overflow-y-auto rounded-[var(--radius-md)] border border-border-strong bg-bg-raised p-1 text-xs shadow-[var(--ui-panel-shadow)]"
      role="listbox"
      aria-label={label}
      bind:this={menu}
    >
      {#each options as option (option.value)}
        <li>
          <button
            type="button"
            role="option"
            aria-selected={option.value === value}
            class="w-full whitespace-nowrap rounded px-2 py-1 text-left font-normal hover:bg-bg-hover hover:text-accent focus:bg-bg-hover focus:text-accent focus:outline-none {option.value ===
            value
              ? 'text-accent'
              : 'text-text-primary'}"
            onclick={() => pick(option.value)}>{option.label}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</span>
