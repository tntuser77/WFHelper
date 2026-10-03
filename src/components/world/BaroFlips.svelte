<script lang="ts">
  import { get } from "svelte/store";
  import { locale, tr as t } from "../../lib/i18n.js";
  import type { BaroFlipRow } from "../../lib/world/baroFlip.js";
  import { baroWishlist, setBaroWishQuantity } from "../../stores/baro.js";
  import {
    baroFlipHours,
    baroFlipLoading,
    baroFlipMinPerDucat,
    baroFlipPlan,
    baroPrimedMods,
    loadBaroFlipHistory,
  } from "../../stores/baroFlips.js";
  import ThemedPanel from "../ThemedPanel.svelte";

  $effect(() => {
    void loadBaroFlipHistory($baroPrimedMods.map((mod) => mod.slug));
  });

  const plan = $derived($baroFlipPlan);
  const suggested = $derived(plan.rows.filter((row) => row.buy > 0));

  function note(row: BaroFlipRow): string {
    const analysis = row.analysis;
    if (!analysis) return $t("common.loading");
    if (analysis.kind === "skip") {
      if (analysis.reason === "cheap")
        return $t("baroFlip.reason.cheap", { price: analysis.ceiling });
      return $t(
        analysis.reason === "history" ? "baroFlip.reason.history" : "baroFlip.reason.recovery",
      );
    }
    if (row.belowMinimum)
      return $t("baroFlip.reason.perDucat", {
        value: (row.platPerDucat ?? 0).toFixed(2),
        min: $baroFlipMinPerDucat.toFixed(2),
      });
    if (row.wanted === 0) return $t("baroFlip.reason.slow");
    const parts = [
      $t("baroFlip.reason.time", {
        count: (analysis.hourlyRate * $baroFlipHours).toFixed(1),
      }),
    ];
    if (analysis.fastRepeater) parts.push($t("baroFlip.reason.fast", { count: analysis.repeats }));
    if (row.owned > 0) parts.push($t("baroFlip.reason.owned", { count: row.owned }));
    return parts.join(". ");
  }

  function addToBasket(): void {
    for (const row of suggested)
      void setBaroWishQuantity(
        row.uniqueName,
        Math.max(row.buy, $baroWishlist[row.uniqueName] ?? 0),
      );
  }

  function setNumber(store: typeof baroFlipHours, input: HTMLInputElement): void {
    store.set(Number(input.value));
    input.value = String(get(store));
  }
</script>

{#if $baroPrimedMods.length > 0}
  <ThemedPanel className="flex flex-col gap-3 p-4">
    <div data-baro-flips class="contents">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <h4 class="m-0 font-display text-lg text-text-heading">{$t("baroFlip.title")}</h4>
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-sm text-text-secondary"
            >{$t("baroFlip.hours")}<input
              type="number"
              min="1"
              max="168"
              step="1"
              class="w-16 rounded border border-border bg-bg-soft px-2 py-1.5 text-right text-text-primary"
              value={$baroFlipHours}
              data-baro-flip-hours
              onchange={(event) => setNumber(baroFlipHours, event.currentTarget)}
            /></label
          >
          <label class="flex items-center gap-2 text-sm text-text-secondary"
            >{$t("baroFlip.minPerDucat")}<input
              type="number"
              min="0"
              max="2"
              step="0.01"
              class="w-20 rounded border border-border bg-bg-soft px-2 py-1.5 text-right text-text-primary"
              value={$baroFlipMinPerDucat}
              data-baro-flip-min
              onchange={(event) => setNumber(baroFlipMinPerDucat, event.currentTarget)}
            /></label
          >
          <button
            type="button"
            class="btn-secondary btn-sm"
            data-baro-flip-basket
            disabled={suggested.length === 0}
            onclick={addToBasket}>{$t("baroFlip.addToBasket")}</button
          >
        </div>
      </div>
      <p class="m-0 text-xs text-text-muted">{$t("baroFlip.hint")}</p>
      {#if plan.ducats > 0}<p class="m-0 text-sm text-text-secondary" data-baro-flip-total>
          {$t("baroFlip.total", {
            ducats: plan.ducats.toLocaleString($locale),
            credits: plan.credits.toLocaleString($locale),
          })}
        </p>{/if}
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-sm" data-baro-flip-table>
          <thead
            ><tr
              class="border-b border-border bg-bg-soft text-left text-xs uppercase text-text-muted"
              ><th class="px-3 py-2">{$t("common.item")}</th><th class="px-3 py-2 text-right"
                >{$t("baroFlip.sellAt")}</th
              ><th class="px-3 py-2 text-right">{$t("baroFlip.toBuy")}</th><th
                class="px-3 py-2 text-right">{$t("common.ducats")}</th
              ><th class="px-3 py-2 text-right">{$t("baroFlip.platPerDucat")}</th><th
                class="px-3 py-2 text-right">{$t("baroFlip.expected")}</th
              ><th class="px-3 py-2">{$t("baroFlip.note")}</th></tr
            ></thead
          >
          <tbody>
            {#each plan.rows as row (row.uniqueName)}
              {@const ok = row.analysis?.kind === "ok" ? row.analysis : null}
              <tr class="border-b border-border/40" data-baro-flip-row={row.uniqueName}>
                <td class="px-3 py-2 text-text-primary">{row.name}</td>
                <td
                  class="whitespace-nowrap px-3 py-2 text-right tabular-nums text-text-primary"
                  title={ok
                    ? $t("baroFlip.sellAtDetail", { ceiling: ok.ceiling, baseline: ok.baseline })
                    : undefined}
                  >{ok ? `${ok.target}p` : "-"}{#if ok?.crashedNow}<span
                      class="ml-1 text-xs text-warning">{$t("baroFlip.crashed")}</span
                    >{/if}</td
                >
                <td class="px-3 py-2 text-right font-semibold tabular-nums text-accent"
                  >{ok ? row.buy : "-"}</td
                >
                <td class="px-3 py-2 text-right tabular-nums text-text-secondary"
                  >{row.ducats === null
                    ? $t("common.unknown")
                    : row.ducats.toLocaleString($locale)}</td
                >
                <td class="px-3 py-2 text-right tabular-nums text-text-secondary"
                  >{row.platPerDucat === null ? "-" : row.platPerDucat.toFixed(2)}</td
                >
                <td class="px-3 py-2 text-right tabular-nums text-text-secondary"
                  >{row.expectedPlat ? `${row.expectedPlat}p` : "-"}</td
                >
                <td class="px-3 py-2 text-xs text-text-muted">{note(row)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if $baroFlipLoading}<p class="m-0 text-xs text-text-muted">{$t("common.loading")}</p>{/if}
    </div>
  </ThemedPanel>
{/if}
