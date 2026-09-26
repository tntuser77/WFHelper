<script lang="ts">
  import type { LevelCapUpgrade } from "../../../config/shared/levelCapTypes.js";
  import { isLevelCapRivenType } from "../../../config/shared/levelCapBuild.js";
  import { itemDb } from "../../stores/data.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import type { LevelCapUpgradeRole } from "../../lib/levelCap.js";

  let {
    upgrade,
    role,
    name,
    maxRank = null,
    rarity = null,
    selected = false,
    onSelect,
  }: {
    upgrade: LevelCapUpgrade | null;
    role: LevelCapUpgradeRole;
    name: string;
    maxRank?: number | null;
    /** The export's rarity: COMMON, UNCOMMON, RARE or LEGENDARY. */
    rarity?: string | null;
    selected?: boolean;
    /** Absent in read-only views. */
    onSelect?: (() => void) | undefined;
  } = $props();

  const ROLE_KEYS: Partial<Record<LevelCapUpgradeRole, MessageKey>> = {
    aura: "levelCap.role.aura",
    exilus: "levelCap.role.exilus",
    stance: "levelCap.role.stance",
    arcane: "levelCap.role.arcane",
  };
  // Card frame colours as the game draws them: bronze, silver, gold, platinum.
  const FRAME: Record<string, string> = {
    COMMON: "var(--rarity-common)",
    UNCOMMON: "var(--rarity-uncommon)",
    RARE: "var(--rarity-rare)",
    LEGENDARY: "var(--text-primary)",
  };

  const type = $derived(upgrade?.type ?? null);
  const art = $derived(type ? ($itemDb[type]?.imageUrl ?? null) : null);
  const riven = $derived(isLevelCapRivenType(type) ? (upgrade?.riven ?? null) : null);
  const frame = $derived(
    isLevelCapRivenType(type) ? "var(--riven-reroll)" : (FRAME[rarity ?? ""] ?? "var(--border)"),
  );
  // Nearly every mod runs at max rank, so only an under-ranked one is worth a badge.
  const underRanked = $derived(
    upgrade?.rank !== null &&
      upgrade?.rank !== undefined &&
      maxRank !== null &&
      upgrade.rank < maxRank,
  );
  const shell = $derived(
    `relative flex min-h-16 w-full flex-col items-center justify-center overflow-hidden rounded-[var(--radius-md)] border-2 bg-bg-raised px-2 py-1.5 text-center ${
      type ? "" : "border-dashed"
    } ${selected ? "ring-2 ring-info ring-offset-1 ring-offset-[var(--ui-modal-bg)]" : ""}`,
  );

  function statText(stat: { value: number; multiplier: boolean }): string {
    if (stat.multiplier) return `x${stat.value}`;
    return `${stat.value >= 0 ? "+" : ""}${stat.value}%`;
  }
</script>

{#snippet body()}
  {#if art && !riven}
    <img
      src={art}
      alt=""
      class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-45"
      style:object-position="50% 22%"
    />
    <span
      class="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg-deep/90 via-bg-deep/40 to-transparent"
    ></span>
  {/if}

  {#if ROLE_KEYS[role]}
    <span
      class="absolute left-1.5 top-1 z-[1] text-[9px] font-semibold uppercase tracking-wider text-text-muted"
      >{$t(ROLE_KEYS[role] as MessageKey)}</span
    >
  {/if}
  {#if underRanked}
    <span
      class="absolute right-1.5 top-1 z-[1] rounded bg-bg-deep/80 px-1 font-mono text-[10px] text-warning"
      title={$t("levelCap.editor.underRanked", {
        rank: String(upgrade?.rank),
        max: String(maxRank),
      })}>R{upgrade?.rank}</span
    >
  {/if}

  {#if type}
    <span
      class="relative z-[1] line-clamp-2 text-sm font-semibold leading-tight text-text-primary [text-shadow:0_1px_3px_var(--bg-deep)]"
      >{riven?.name ?? name}</span
    >
    {#if riven}
      <ul class="relative z-[1] m-0 mt-1 list-none p-0 text-left text-[11px] leading-snug">
        {#each riven.stats as stat, i (i)}
          <li class={stat.positive ? "text-success" : "text-danger"}>
            <span class="font-mono">{statText(stat)}</span>
            {stat.name}
          </li>
        {/each}
      </ul>
    {:else if isLevelCapRivenType(type)}
      <span class="relative z-[1] text-[10px] text-text-muted"
        >{$t("levelCap.editor.rivenUnknown")}</span
      >
    {/if}
  {:else}
    <span class="text-xs text-text-muted">{$t("levelCap.editor.empty")}</span>
  {/if}
{/snippet}

{#if onSelect}
  <button
    type="button"
    class="{shell} cursor-pointer transition-transform hover:-translate-y-0.5"
    style:border-color={type ? frame : "var(--border)"}
    onclick={onSelect}
    data-level-cap-mod={role}
  >
    {@render body()}
  </button>
{:else}
  <div class={shell} style:border-color={type ? frame : "var(--border)"} data-level-cap-mod={role}>
    {@render body()}
  </div>
{/if}
