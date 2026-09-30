<script lang="ts">
  import { LEVEL_CAP_INCARNON_PERKS } from "../../../config/shared/levelCapBuild.js";
  import { tr as t } from "../../lib/i18n.js";

  let {
    perks,
    onChange,
  }: {
    /** Perk per unlocked evolution, 0-based, evolution I first. */
    perks: number[];
    /** Set in the editor; the card only reads. */
    onChange?: (perks: number[] | null) => void;
  } = $props();

  const ROMAN = ["I", "II", "III", "IV", "V"];
  const CHOICES = Array.from({ length: LEVEL_CAP_INCARNON_PERKS }, (_, i) => i);

  // Picking a perk on a later evolution unlocks every one before it.
  function pick(tier: number, perk: number): void {
    const next = Array.from({ length: Math.max(perks.length, tier + 1) }, (_, i) => perks[i] ?? 0);
    next[tier] = perk;
    onChange?.(next);
  }

  function lock(tier: number): void {
    onChange?.(tier > 0 ? perks.slice(0, tier) : null);
  }
</script>

<div
  class="flex flex-wrap items-center gap-2 text-xs"
  title={$t("levelCap.build.incarnonHint")}
  data-level-cap-incarnon
>
  <span class="w-20 text-[10px] font-semibold uppercase tracking-wide text-accent"
    >{$t("levelCap.build.incarnon")}</span
  >
  {#if onChange}
    {#each ROMAN as roman, tier (roman)}
      {@const unlocked = tier < perks.length}
      <span class="flex items-center gap-1">
        <button
          type="button"
          class="cursor-pointer font-mono text-[11px] {unlocked
            ? 'text-text-secondary hover:text-danger'
            : 'text-text-muted/60 hover:text-info'}"
          title={$t(unlocked ? "levelCap.editor.incarnonLock" : "levelCap.editor.incarnonUnlock")}
          onclick={() => (unlocked ? lock(tier) : pick(tier, 0))}>{roman}</button
        >
        {#if tier > 0 && unlocked}
          <span class="flex overflow-hidden rounded border border-border">
            {#each CHOICES as perk (perk)}
              <button
                type="button"
                class="cursor-pointer px-1.5 py-0.5 font-mono {perks[tier] === perk
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:bg-bg-raised'}"
                onclick={() => pick(tier, perk)}>{perk + 1}</button
              >
            {/each}
          </span>
        {/if}
      </span>
    {/each}
  {:else}
    {#each perks as perk, tier (tier)}
      <span class="rounded border border-accent/40 px-1.5 py-0.5 font-mono text-accent"
        >{ROMAN[tier]}{tier > 0 ? ` · ${perk + 1}` : ""}</span
      >
    {/each}
  {/if}
</div>
