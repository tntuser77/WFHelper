<script lang="ts">
  import type { LevelCapItem } from "../../../config/shared/levelCapTypes.js";
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import { itemDb } from "../../stores/data.js";
  import { invoke } from "../../lib/ipc.js";
  import { tr as t } from "../../lib/i18n.js";
  import { log } from "../../lib/log.js";
  import { underframeBuild, underframeShareUrl } from "../../lib/underframe.js";

  let {
    item,
    frame = null,
    abilityNames = {},
  }: {
    item: LevelCapItem;
    /** The build's warframe; a weapon opens with its buffs worked in. */
    frame?: LevelCapItem | null;
    abilityNames?: Record<string, string>;
  } = $props();

  // Underframe matches English names, which is what `name` holds in every locale.
  const nameOf = (type: string) => $itemDb[type]?.name ?? null;
  const helminthOf = (suit: LevelCapItem) =>
    suit.helminth
      ? (abilityNames[suit.helminth.ability] ?? fallbackNameFromUniqueName(suit.helminth.ability))
      : null;

  const build = $derived(underframeBuild(item, nameOf, helminthOf(item)));
  const frameBuild = $derived(
    item.kind !== "suit" && frame ? underframeBuild(frame, nameOf, helminthOf(frame)) : null,
  );

  let busy = $state(false);
  let noFrame = $state(false);

  async function open(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (!build || busy) return;
    const url = underframeShareUrl(build);
    if (!frameBuild) {
      window.api?.openExternal?.(url);
      return;
    }
    busy = true;
    try {
      const result = await invoke("openUnderframeDps", frameBuild, build, url);
      noFrame = !result.withFrame;
    } catch (err) {
      log.warn("[LevelCap] underframe failed", String(err));
      window.api?.openExternal?.(url);
      noFrame = true;
    } finally {
      busy = false;
    }
  }
</script>

{#if build}
  <button
    type="button"
    class="cursor-pointer rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:border-info disabled:cursor-wait disabled:opacity-60 {noFrame
      ? 'border-warning/60 text-warning'
      : 'border-border text-info'}"
    title={noFrame
      ? $t("levelCap.underframeNoFrame")
      : $t(frameBuild ? "levelCap.underframeDpsTitle" : "levelCap.underframeTitle")}
    disabled={busy}
    onclick={open}
    data-level-cap-underframe>{busy ? $t("levelCap.underframeOpening") : "Underframe"}</button
  >
{/if}
