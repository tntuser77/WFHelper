<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import AnalyticsTooltip from "./AnalyticsTooltip.svelte";

  let {
    values,
    labels,
    colors,
    donut,
    title,
    format,
  }: {
    values: Array<number | null>;
    labels: string[];
    colors: string[];
    donut: boolean;
    title: string;
    format: (value: number | null) => string;
  } = $props();

  const SIZE = 180;
  const R = SIZE / 2 - 2;
  const INNER = $derived(donut ? R * 0.6 : 0);
  const C = SIZE / 2;

  let hover = $state<{ index: number; x: number; y: number } | null>(null);

  const total = $derived(values.reduce<number>((sum, v) => sum + (v ?? 0), 0));
  const share = (value: number | null) => (total > 0 ? ((value ?? 0) / total) * 100 : 0);

  const point = (radius: number, angle: number) =>
    `${C + radius * Math.sin(angle)},${C - radius * Math.cos(angle)}`;

  /** One slice from angle a to b, clockwise from twelve o'clock. */
  function slice(a: number, b: number): string {
    const large = b - a > Math.PI ? 1 : 0;
    const outer = `M${point(R, a)}A${R},${R} 0 ${large} 1 ${point(R, b)}`;
    if (!INNER) return `${outer}L${C},${C}Z`;
    return `${outer}L${point(INNER, b)}A${INNER},${INNER} 0 ${large} 0 ${point(INNER, a)}Z`;
  }

  const slices = $derived.by(() => {
    let at = 0;
    return values.map((value, i) => {
      const sweep = total > 0 ? ((value ?? 0) / total) * Math.PI * 2 : 0;
      const start = at;
      at += sweep;
      // A whole circle has no arc end to draw to, so it takes two halves.
      const d =
        sweep >= Math.PI * 2 - 1e-6
          ? `${slice(0, Math.PI)}${slice(Math.PI, Math.PI * 2)}`
          : sweep > 0
            ? slice(start, at)
            : "";
      return { d, color: colors[i] };
    });
  });

  function onEnter(index: number, event: PointerEvent): void {
    hover = { index, x: event.clientX, y: event.clientY };
  }
</script>

<div class="flex flex-wrap items-center gap-5">
  <svg
    viewBox="0 0 {SIZE} {SIZE}"
    width={SIZE}
    height={SIZE}
    class="shrink-0"
    role="img"
    aria-label={title}
  >
    {#each slices as s, i (i)}
      {#if s.d}
        <!-- The 2px surface-coloured edge is the gap between slices. -->
        <path
          role="presentation"
          d={s.d}
          fill={s.color}
          stroke="var(--ui-panel-bg)"
          stroke-width="2"
          stroke-linejoin="round"
          opacity={hover && hover.index !== i ? 0.45 : 1}
          onpointerenter={(e) => onEnter(i, e)}
          onpointermove={(e) => onEnter(i, e)}
          onpointerleave={() => (hover = null)}
        />
      {/if}
    {/each}
    {#if donut}
      <text
        x={C}
        y={C}
        dy="-2"
        text-anchor="middle"
        class="font-display"
        font-size="26"
        fill="var(--text-heading)">{format(total)}</text
      >
      <text x={C} y={C} dy="16" text-anchor="middle" font-size="11" fill="var(--text-muted)"
        >{$tr("common.total")}</text
      >
    {/if}
  </svg>

  <ul class="m-0 flex min-w-[12rem] flex-1 list-none flex-col gap-1 p-0 text-xs">
    {#each labels as label, i (i)}
      <li
        class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 {hover?.index ===
        i
          ? 'bg-[var(--surface-hover)]'
          : ''}"
        onpointerenter={(e) => onEnter(i, e)}
        onpointerleave={() => (hover = null)}
      >
        <span class="h-2.5 w-2.5 rounded-sm" style="background:{colors[i]}"></span>
        <span class="truncate text-text-secondary" title={label}>{label}</span>
        <span class="font-mono text-text-primary">{format(values[i])}</span>
        <span class="w-10 text-right font-mono text-text-muted">{share(values[i]).toFixed(0)}%</span
        >
      </li>
    {/each}
  </ul>
</div>

{#if hover}
  <AnalyticsTooltip x={hover.x} y={hover.y}>
    <div class="font-semibold text-text-primary">{labels[hover.index]}</div>
    <div class="flex gap-3">
      <span class="font-mono text-text-primary">{format(values[hover.index])}</span>
      <span class="ml-auto font-mono text-text-muted">{share(values[hover.index]).toFixed(1)}%</span
      >
    </div>
  </AnalyticsTooltip>
{/if}
