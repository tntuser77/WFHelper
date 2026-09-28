<script lang="ts">
  import type { AnalyticsResult } from "../../lib/analytics/runAnalytics.js";
  import { tr } from "../../lib/i18n.js";
  import AnalyticsTooltip from "./AnalyticsTooltip.svelte";

  let {
    result,
    kind,
    stacked,
    title,
    categoryLabels,
    shortLabels,
    seriesLabels,
    colors,
    format,
    whole,
  }: {
    result: AnalyticsResult;
    kind: "columns" | "line";
    /** Counts stack; averages sit side by side, since they do not add up. */
    stacked: boolean;
    /** The measure only takes whole numbers. */
    whole: boolean;
    title: string;
    categoryLabels: string[];
    shortLabels: string[];
    seriesLabels: string[];
    colors: string[];
    format: (value: number | null) => string;
  } = $props();

  const H = 220;
  const M = { top: 12, right: 8, bottom: 24, left: 40 };
  const GAP = 2;

  let width = $state(600);
  let hover = $state<{ index: number; x: number; y: number } | null>(null);

  const plotW = $derived(Math.max(40, width - M.left - M.right));
  const plotH = H - M.top - M.bottom;
  const n = $derived(result.categories.length);
  const band = $derived(plotW / Math.max(1, n));
  const multi = $derived(result.series.length > 1);

  const peak = $derived.by(() => {
    let max = 0;
    for (let c = 0; c < n; c++) {
      if (stacked)
        max = Math.max(
          max,
          result.values.reduce((s, row) => s + (row[c] ?? 0), 0),
        );
      else for (const row of result.values) max = Math.max(max, row[c] ?? 0);
    }
    return max;
  });

  // Four or so gridlines on a 1-2-5 step; run counts never get a half-run line.
  const axis = $derived.by(() => {
    const target = Math.max(peak, 1) / 4;
    const mag = 10 ** Math.floor(Math.log10(target));
    let step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= target) ?? mag * 10;
    if (whole) step = Math.max(1, Math.round(step));
    const top = Math.max(step, Math.ceil(peak / step) * step);
    const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
    return { top, ticks };
  });

  const y = (value: number) => plotH - (value / axis.top) * plotH;

  const labelStride = $derived(Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64)))));

  /** A bar's data end is rounded; the end on the baseline stays square. */
  function bar(x: number, top: number, w: number, h: number, round: boolean): string {
    if (h <= 0) return "";
    const r = round ? Math.min(4, w / 2, h) : 0;
    const bottom = top + h;
    return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
  }

  interface Mark {
    d: string;
    color: string;
  }

  const marks = $derived.by<Mark[]>(() => {
    if (kind !== "columns") return [];
    const out: Mark[] = [];
    const series = result.series.length;
    for (let c = 0; c < n; c++) {
      if (stacked || !multi) {
        const w = Math.max(2, Math.min(36, band * 0.72));
        const x = band * c + (band - w) / 2;
        let base = 0;
        const filled = result.values.map((row) => row[c] ?? 0);
        let last = filled.length - 1;
        while (last > 0 && filled[last] <= 0) last--;
        filled.forEach((value, s) => {
          if (value <= 0) return;
          const top = y(base + value);
          // A 2px surface gap parts each segment from the one it sits on.
          const h = y(base) - top - (base > 0 ? GAP : 0);
          out.push({ d: bar(x, top, w, h, s === last), color: colors[s] });
          base += value;
        });
      } else {
        const groupW = Math.min(band * 0.8, 36 * series);
        const w = Math.max(1, (groupW - GAP * (series - 1)) / series);
        const x0 = band * c + (band - groupW) / 2;
        result.values.forEach((row, s) => {
          const value = row[c];
          if (!value) return;
          const top = y(value);
          out.push({ d: bar(x0 + s * (w + GAP), top, w, plotH - top, true), color: colors[s] });
        });
      }
    }
    return out;
  });

  const lines = $derived.by(() => {
    if (kind !== "line") return [];
    return result.values.map((row, s) => {
      let d = "";
      let pen = false;
      const points: Array<{ x: number; y: number }> = [];
      row.forEach((value, c) => {
        if (value === null) {
          pen = false;
          return;
        }
        const px = band * (c + 0.5);
        const py = y(value);
        d += `${pen ? "L" : "M"}${px},${py}`;
        pen = true;
        points.push({ x: px, y: py });
      });
      return { d, points, color: colors[s] };
    });
  });

  // Past a few dozen points the markers crowd the line; the hovered one still shows.
  const showMarkers = $derived(n <= 40);

  function onEnter(index: number, event: PointerEvent): void {
    hover = { index, x: event.clientX, y: event.clientY };
  }
</script>

<div class="relative w-full" bind:clientWidth={width}>
  <svg
    viewBox="0 0 {width} {H}"
    {width}
    height={H}
    class="block font-mono text-[10px]"
    role="img"
    aria-label={title}
  >
    <g transform="translate({M.left},{M.top})">
      {#each axis.ticks as tick (tick)}
        <line x1="0" x2={plotW} y1={y(tick)} y2={y(tick)} stroke="var(--border-subtle)" />
        <text x="-6" y={y(tick)} dy="3" text-anchor="end" fill="var(--text-muted)"
          >{format(tick)}</text
        >
      {/each}

      {#if hover}
        <rect
          x={band * hover.index}
          y="0"
          width={band}
          height={plotH}
          fill="var(--surface-hover)"
        />
      {/if}

      {#each marks as mark, i (i)}
        <path d={mark.d} fill={mark.color} />
      {/each}

      {#if kind === "line"}
        {#if hover}
          <line
            x1={band * (hover.index + 0.5)}
            x2={band * (hover.index + 0.5)}
            y1="0"
            y2={plotH}
            stroke="var(--chart-axis)"
            stroke-dasharray="3 3"
          />
        {/if}
        {#each lines as line, s (s)}
          <path
            d={line.d}
            fill="none"
            stroke={line.color}
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          {#each line.points as p (p.x)}
            {#if showMarkers || (hover && Math.abs(p.x - band * (hover.index + 0.5)) < 0.5)}
              <circle
                cx={p.x}
                cy={p.y}
                r="4"
                fill={line.color}
                stroke="var(--ui-panel-bg)"
                stroke-width="2"
              />
            {/if}
          {/each}
        {/each}
      {/if}

      <line x1="0" x2={plotW} y1={plotH} y2={plotH} stroke="var(--chart-axis)" />
      {#each shortLabels as label, c (c)}
        {#if c % labelStride === 0}
          <text x={band * (c + 0.5)} y={plotH + 15} text-anchor="middle" fill="var(--text-muted)"
            >{label}</text
          >
        {/if}
      {/each}

      <!-- Hit targets span the whole column, wider than any mark in it. -->
      {#each result.categories as category, c (category)}
        <rect
          role="presentation"
          x={band * c}
          y="0"
          width={band}
          height={plotH}
          fill="transparent"
          onpointerenter={(e) => onEnter(c, e)}
          onpointermove={(e) => onEnter(c, e)}
          onpointerleave={() => (hover = null)}
        />
      {/each}
    </g>
  </svg>

  {#if hover}
    {@const c = hover.index}
    <AnalyticsTooltip x={hover.x} y={hover.y}>
      <div class="mb-1 font-semibold text-text-primary">{categoryLabels[c]}</div>
      {#each result.series as _series, s (s)}
        <div class="flex items-center gap-2">
          {#if multi}
            <span class="h-2 w-2 shrink-0 rounded-sm" style="background:{colors[s]}"></span>
            <span class="text-text-secondary">{seriesLabels[s]}</span>
          {/if}
          <span class="ml-auto font-mono text-text-primary">{format(result.values[s][c])}</span>
        </div>
      {/each}
      {#if multi}
        <div class="mt-1 flex border-t border-border-subtle pt-1">
          <span class="text-text-secondary">{$tr("common.total")}</span>
          <span class="ml-auto font-mono text-text-primary">{format(result.totals[c])}</span>
        </div>
      {/if}
    </AnalyticsTooltip>
  {/if}
</div>
