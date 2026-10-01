<script lang="ts">
  import { itemDb } from "../../stores/data.js";
  import { levelCap, setLevelCapFrameIcon } from "../../stores/levelCap.js";
  import { tr as t } from "../../lib/i18n.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { levelCapFrameSkin, type LevelCapFrameRow } from "../../lib/levelCap.js";
  import { LEVEL_CAP_DEFAULT_SKIN } from "../../../config/shared/levelCapTypes.js";

  let {
    row,
    sizeClass,
    editable = false,
  }: {
    row: LevelCapFrameRow;
    /** Tailwind size of the square, e.g. "h-16 w-16". */
    sizeClass: string;
    /** Click picks a skin, right-click goes back to the equipped one. */
    editable?: boolean;
  } = $props();

  const skins = $derived($levelCap?.frameSkins ?? {});
  const icons = $derived($levelCap?.frameIcons ?? {});
  const pinned = $derived(icons[row.frame] ?? null);
  // A pinned skin stays on offer after it leaves every appearance config.
  const options = $derived.by(() => {
    const owned = (row.frameType && skins[row.frameType]?.options) || [];
    return pinned && pinned !== LEVEL_CAP_DEFAULT_SKIN && !owned.includes(pinned)
      ? [...owned, pinned]
      : owned;
  });
  const frameArt = $derived(row.frameType ? ($itemDb[row.frameType]?.imageUrl ?? null) : null);
  // Skins newer than the bundled data can have no mirrored icon yet.
  let broken = $state<Record<string, true>>({});
  const art = $derived(skinArt(levelCapFrameSkin(row, skins, icons)));
  const equippedArt = $derived(skinArt(levelCapFrameSkin(row, skins, {})));
  let open = $state(false);

  /** The skin's icon, or the frame's own art when it has none or it failed to load. */
  function skinArt(skin: string | null): string | null {
    const url = skin ? $itemDb[skin]?.imageUrl : null;
    return url && !broken[url] ? url : frameArt;
  }

  function markBroken(url: string | null): void {
    if (url && url !== frameArt) broken = { ...broken, [url]: true };
  }

  function pick(skin: string | null): void {
    open = false;
    void setLevelCapFrameIcon(row.frame, skin).catch((err) =>
      console.error("[LevelCap] frame icon not saved:", err),
    );
  }
</script>

{#snippet tile(src: string | null, label: string, selected: boolean, skin: string | null)}
  <button
    type="button"
    class="flex w-16 cursor-pointer flex-col items-center gap-1 rounded-[var(--radius-md)] border p-1 text-[10px] leading-tight transition-colors {selected
      ? 'border-accent bg-accent/10 text-text-primary'
      : 'border-transparent text-text-secondary hover:border-border-strong hover:text-text-primary'}"
    title={label}
    onclick={() => pick(skin)}
    data-level-cap-skin={skin ?? "auto"}
  >
    <span class="flex h-12 w-12 items-center justify-center overflow-hidden rounded bg-bg-raised">
      {#if src}<img
          {src}
          alt=""
          class="h-full w-full object-contain"
          onerror={() => markBroken(src)}
        />{/if}
    </span>
    <span class="w-full truncate text-center">{label}</span>
  </button>
{/snippet}

{#if editable}
  <div class="relative shrink-0">
    <button
      type="button"
      class="flex {sizeClass} cursor-pointer items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-bg-raised outline-offset-2 hover:outline hover:outline-1 hover:outline-accent"
      title={$t("levelCap.skin.hint")}
      onclick={() => (open = !open)}
      oncontextmenu={(event) => {
        event.preventDefault();
        if (pinned) pick(null);
        open = false;
      }}
      data-level-cap-frame-icon
    >
      {#if art}<img
          src={art}
          alt=""
          class="h-full w-full object-contain"
          onerror={() => markBroken(art)}
        />{/if}
    </button>
    {#if open}
      <!-- Dismissed by any click outside it, or a right-click on it. -->
      <button
        type="button"
        class="fixed inset-0 z-30 cursor-default"
        aria-label={$t("common.close")}
        onclick={() => (open = false)}
        oncontextmenu={(event) => {
          event.preventDefault();
          open = false;
        }}
      ></button>
      <div
        role="presentation"
        class="absolute left-0 top-full z-40 mt-1 flex max-w-[22rem] flex-wrap gap-1 rounded-[var(--radius-md)] border border-border-strong bg-bg-surface p-1.5 shadow-lg"
        oncontextmenu={(event) => {
          event.preventDefault();
          open = false;
        }}
        data-level-cap-skin-picker
      >
        {@render tile(equippedArt, $t("levelCap.skin.equipped"), !pinned, null)}
        {@render tile(
          frameArt,
          $t("common.default"),
          pinned === LEVEL_CAP_DEFAULT_SKIN,
          LEVEL_CAP_DEFAULT_SKIN,
        )}
        {#each options as skin (skin)}
          {@render tile(
            skinArt(skin),
            itemLabel($itemDb[skin]) || skin.split("/").pop() || skin,
            pinned === skin,
            skin,
          )}
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div
    class="flex {sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-bg-raised"
  >
    {#if art}<img
        src={art}
        alt=""
        class="h-full w-full object-contain"
        onerror={() => markBroken(art)}
      />{/if}
  </div>
{/if}
