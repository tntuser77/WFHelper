import { unwrapInventoryPayload } from "../config/shared/inventoryPayload";
import { asRecord } from "../config/shared/objectValidation";
import { toNonEmptyString } from "../config/shared/stringValidation";
import { decodeRivenUpgrade } from "./rivenFingerprint";
import { isLevelCapRivenType, LEVEL_CAP_INCARNON_TIERS } from "../config/shared/levelCapBuild";
import type {
  LevelCapBuild,
  LevelCapFocusSchool,
  LevelCapItem,
  LevelCapRiven,
  LevelCapSlotKind,
  LevelCapUpgrade,
} from "../config/shared/levelCapTypes";

/** The loadout the player has on right now carries this placeholder id. */
const CURRENT_PRESET_ID = "000000000000000000000001";

// DE presets abbreviate each slot; the value names the inventory array it points into.
const NORMAL_SLOTS: Array<{ key: string; kind: LevelCapSlotKind; category: string }> = [
  { key: "s", kind: "suit", category: "Suits" },
  { key: "l", kind: "primary", category: "LongGuns" },
  { key: "p", kind: "secondary", category: "Pistols" },
  { key: "m", kind: "melee", category: "Melee" },
  { key: "h", kind: "archgun", category: "SpaceGuns" },
];
const COMPANION_CATEGORIES = ["Sentinels", "KubrowPets", "MoaPets"];

const FOCUS_BY_POLARITY: Record<string, LevelCapFocusSchool> = {
  AP_ATTACK: "madurai",
  AP_DEFENSE: "vazarin",
  AP_TACTIC: "naramon",
  AP_POWER: "zenurik",
  AP_WARD: "unairu",
};
const FOCUS_BY_PATH: Record<string, LevelCapFocusSchool> = {
  Attack: "madurai",
  Defense: "vazarin",
  Tactic: "naramon",
  Power: "zenurik",
  Ward: "unairu",
};

type Json = Record<string, unknown>;

function oid(value: unknown): string | null {
  return toNonEmptyString(asRecord(value)?.$oid, 64);
}

function lotusPath(value: unknown): string | null {
  const text = toNonEmptyString(value, 512);
  return text?.startsWith("/Lotus/") ? text : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function upgradeRank(fingerprint: unknown): number | null {
  if (typeof fingerprint !== "string" || fingerprint.length > 16_384) return null;
  try {
    const rank = asRecord(JSON.parse(fingerprint))?.lvl;
    return typeof rank === "number" && Number.isSafeInteger(rank) && rank >= 0 && rank <= 100
      ? rank
      : null;
  } catch {
    return null;
  }
}

function decodeRiven(type: string | null, fingerprint: unknown) {
  if (!type || !isLevelCapRivenType(type) || typeof fingerprint !== "string") return null;
  return decodeRivenUpgrade({ ItemType: type, UpgradeFingerprint: fingerprint });
}

/** A riven's rolled stats from its inventory entry, for freezing into the build. */
function rivenOf(type: string | null, fingerprint: unknown): LevelCapRiven | undefined {
  const decoded = decodeRiven(type, fingerprint);
  if (!decoded) return undefined;
  return {
    // The decoder's name usually leads with the weapon already ("Akarius Ignipha").
    name: decoded.rivenName.startsWith(decoded.weaponName)
      ? decoded.rivenName
      : `${decoded.weaponName} ${decoded.rivenName}`,
    stats: decoded.stats.map((stat) => ({
      name: stat.name,
      value: stat.displayValue,
      positive: stat.positive,
      multiplier: stat.multiplier,
    })),
  };
}

/** Every unveiled riven in the inventory, keyed by the lower-cased weapon family it
 * rolled for ("akarius" also covers Akarius Prime). */
export function rivensByWeapon(payload: unknown): Map<string, LevelCapRiven[]> {
  const inventory = asRecord(unwrapInventoryPayload(payload)) ?? {};
  const out = new Map<string, LevelCapRiven[]>();
  for (const entry of array(inventory.Upgrades).slice(0, 100_000)) {
    const upgrade = asRecord(entry);
    const type = lotusPath(upgrade?.ItemType);
    const decoded = decodeRiven(type, upgrade?.UpgradeFingerprint);
    const riven = rivenOf(type, upgrade?.UpgradeFingerprint);
    if (!decoded || !riven) continue;
    const key = decoded.weaponName.toLowerCase();
    out.set(key, [...(out.get(key) ?? []), riven]);
  }
  return out;
}

/** Indexes built once per inventory so each item lookup is a map hit. */
function indexInventory(inventory: Json) {
  const upgrades = new Map<
    string,
    { type: string | null; rank: number | null; riven?: LevelCapRiven }
  >();
  for (const entry of array(inventory.Upgrades).slice(0, 100_000)) {
    const upgrade = asRecord(entry);
    const id = oid(upgrade?.ItemId);
    if (id && upgrade) {
      const type = lotusPath(upgrade.ItemType);
      const riven = rivenOf(type, upgrade.UpgradeFingerprint);
      upgrades.set(id, {
        type,
        rank: upgradeRank(upgrade.UpgradeFingerprint),
        ...(riven ? { riven } : {}),
      });
    }
  }
  const items = new Map<string, Json>();
  for (const category of [
    ...NORMAL_SLOTS.map((s) => s.category),
    ...COMPANION_CATEGORIES,
    "SentinelWeapons",
  ]) {
    for (const entry of array(inventory[category]).slice(0, 10_000)) {
      const item = asRecord(entry);
      const id = oid(item?.ItemId);
      if (id && item) items.set(`${category}:${id}`, item);
    }
  }
  // Highest evolution per weapon; a Genesis weapon's sits on its base weapon.
  const evolutions = new Map<string, number>();
  for (const entry of array(inventory.EvolutionProgress).slice(0, 1000)) {
    const row = asRecord(entry);
    const type = lotusPath(row?.ItemType);
    if (type && typeof row?.Rank === "number" && Number.isFinite(row.Rank)) {
      evolutions.set(type, row.Rank);
    }
  }
  return { upgrades, items, evolutions };
}

let weaponParents: Record<string, { parentName?: string }> | null = null;

function weaponParent(type: string): string | undefined {
  try {
    weaponParents ??=
      (
        require("warframe-public-export-plus") as {
          ExportWeapons?: Record<string, { parentName?: string }>;
        }
      ).ExportWeapons ?? {};
  } catch {
    weaponParents = {};
  }
  return weaponParents[type]?.parentName;
}

/** Perk picks from the weapon's SkillTree, one digit per evolution, the last four
 *  being II to V (Zariman weapons add a leading one for I). Only the evolutions
 *  unlocked so far count; with no progress row the weapon is taken as complete. */
function incarnonPerks(index: InventoryIndex, type: string, skillTree: unknown): number[] | null {
  if (typeof skillTree !== "string" || !/^[0-9]{4,5}$/.test(skillTree)) return null;
  const parent = weaponParent(type);
  const rank = index.evolutions.get(type) ?? (parent ? index.evolutions.get(parent) : undefined);
  // Rank counts from 0 and runs one past the last evolution once it is done.
  const unlocked =
    rank === undefined ? LEVEL_CAP_INCARNON_TIERS : Math.min(LEVEL_CAP_INCARNON_TIERS, rank + 1);
  const picks = [0, ...[...skillTree.slice(-4)].map(Number)];
  return picks.slice(0, unlocked);
}

type InventoryIndex = ReturnType<typeof indexInventory>;

/** A zaw, kitgun or MOA shares its ItemType with every other build of its kind;
 *  the fitted parts and the name the player gave it are what tell them apart. */
function modularIdentity(raw: Json): Pick<LevelCapItem, "parts" | "customName"> {
  const parts = array(raw.ModularParts)
    .flatMap((part) => lotusPath(part) ?? [])
    .slice(0, 8);
  if (!parts.length) return {};
  // Pets store "Name|suffix"; the part before the bar is what the game shows.
  const customName = toNonEmptyString(raw.ItemName, 120)?.split("|")[0].trim();
  return { parts, ...(customName ? { customName } : {}) };
}

function sameParts(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a?.length || !b?.length || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((part) => set.has(part));
}

function readItem(
  index: InventoryIndex,
  kind: LevelCapSlotKind,
  raw: Json,
  configIndex: number,
): LevelCapItem | null {
  const type = lotusPath(raw.ItemType);
  if (!type) return null;
  const configs = array(raw.Configs);
  const config = configIndex >= 0 && configIndex < configs.length ? configIndex : 0;
  const source = asRecord(configs[config]);
  const upgrades: LevelCapUpgrade[] = array(source?.Upgrades)
    .slice(0, 32)
    .flatMap((ref, slot) => {
      if (typeof ref !== "string" || ref === "") return [];
      const resolved = index.upgrades.get(ref);
      // Unranked mods are referenced by path instead of by owned-copy id.
      return [{ slot, ...(resolved ?? { type: lotusPath(ref), rank: null }) }];
    });
  const item: LevelCapItem = { kind, type, config, upgrades, ...modularIdentity(raw) };
  const name = toNonEmptyString(source?.Name, 120);
  if (name) item.configName = name;
  if (kind === "suit") {
    const override = asRecord(source?.AbilityOverride);
    const ability = lotusPath(override?.Ability);
    if (ability && typeof override?.Index === "number") {
      item.helminth = { ability, index: override.Index };
    }
    const shards = array(raw.ArchonCrystalUpgrades).flatMap((entry) => {
      const shard = asRecord(entry);
      const shardType = lotusPath(shard?.UpgradeType);
      return shardType
        ? [{ color: toNonEmptyString(shard?.Color, 64) ?? "", type: shardType }]
        : [];
    });
    if (shards.length) item.shards = shards;
  }
  if (kind === "primary" || kind === "secondary" || kind === "melee") {
    const perks = incarnonPerks(index, type, raw.SkillTree);
    if (perks) item.incarnon = perks;
  }
  return item;
}

function selection(preset: Json | null, key: string): { id: string; config: number } | null {
  const slot = asRecord(preset?.[key]);
  const id = oid(slot?.ItemId);
  if (!id) return null;
  return { id, config: typeof slot?.mod === "number" ? slot.mod : 0 };
}

function currentPreset(inventory: Json, kind: string): Json | null {
  const presets = array(asRecord(inventory.LoadOutPresets)?.[kind]).map(asRecord);
  const current = new Set(array(inventory.CurrentLoadOutIds).map(oid));
  return (
    presets.find((p) => p && current.has(oid(p.ItemId)) && oid(p.ItemId) !== CURRENT_PRESET_ID) ??
    presets.find((p) => p && oid(p.ItemId) === CURRENT_PRESET_ID) ??
    null
  );
}

function focusSchool(inventory: Json, preset: Json | null): LevelCapFocusSchool | null {
  const polarity = toNonEmptyString(preset?.FocusSchool, 32);
  if (polarity && FOCUS_BY_POLARITY[polarity]) return FOCUS_BY_POLARITY[polarity];
  const ability = toNonEmptyString(inventory.FocusAbility, 256);
  const school = ability?.match(/\/Focus\/([A-Za-z]+)\//)?.[1];
  return (school && FOCUS_BY_PATH[school]) || null;
}

function companion(index: InventoryIndex, preset: Json | null): LevelCapItem | null {
  const pet = selection(preset, "s");
  if (!pet) return null;
  for (const category of COMPANION_CATEGORIES) {
    const raw = index.items.get(`${category}:${pet.id}`);
    if (!raw) continue;
    const item = readItem(index, "companion", raw, pet.config);
    const weaponSel = selection(preset, "l");
    const weaponRaw = weaponSel && index.items.get(`SentinelWeapons:${weaponSel.id}`);
    const weapon = weaponRaw && readItem(index, "companion", weaponRaw, weaponSel.config);
    if (item && weapon) item.weapon = weapon;
    return item;
  }
  return null;
}

function buildFromPreset(inventory: Json, index: InventoryIndex, preset: Json): LevelCapBuild {
  const build: LevelCapBuild = {
    suit: null,
    primary: null,
    secondary: null,
    melee: null,
    archgun: null,
    companion: companion(index, currentPreset(inventory, "SENTINEL")),
    focus: focusSchool(inventory, preset),
  };
  for (const { key, kind, category } of NORMAL_SLOTS) {
    const sel = selection(preset, key);
    const raw = sel && index.items.get(`${category}:${sel.id}`);
    if (sel && raw)
      build[kind as Exclude<LevelCapSlotKind, "companion">] = readItem(
        index,
        kind,
        raw,
        sel.config,
      );
  }
  const name = toNonEmptyString(preset.n, 120);
  if (name) build.loadoutName = name;
  return build;
}

function inventoryRecord(payload: unknown): Json | null {
  return asRecord(unwrapInventoryPayload(payload));
}

/** The loadout equipped right now, as the inventory last reported it. */
export function snapshotEquippedBuild(payload: unknown): LevelCapBuild | null {
  const inventory = inventoryRecord(payload);
  const preset = inventory && currentPreset(inventory, "NORMAL");
  if (!inventory || !preset) return null;
  return buildFromPreset(inventory, indexInventory(inventory), preset);
}

/** Best guess at how a frame is played: the equipped loadout when it carries
 * that frame, else the first saved loadout that does, else the bare frame. */
export function snapshotBuildForFrame(payload: unknown, frameType: string): LevelCapBuild | null {
  const inventory = inventoryRecord(payload);
  if (!inventory) return null;
  const index = indexInventory(inventory);
  const suitType = (preset: Json | null): string | null => {
    const sel = selection(preset, "s");
    const raw = sel && index.items.get(`Suits:${sel.id}`);
    return raw ? lotusPath(raw.ItemType) : null;
  };
  const current = currentPreset(inventory, "NORMAL");
  if (current && suitType(current) === frameType) {
    return buildFromPreset(inventory, index, current);
  }
  const saved = array(asRecord(inventory.LoadOutPresets)?.NORMAL)
    .map(asRecord)
    .find(
      (preset) =>
        preset && oid(preset.ItemId) !== CURRENT_PRESET_ID && suitType(preset) === frameType,
    );
  if (saved) return buildFromPreset(inventory, index, saved);
  const owned = array(inventory.Suits)
    .map(asRecord)
    .find((suit) => suit && lotusPath(suit.ItemType) === frameType);
  if (!owned) return null;
  return {
    suit: readItem(index, "suit", owned, 0),
    primary: null,
    secondary: null,
    melee: null,
    archgun: null,
    companion: null,
    focus: focusSchool(inventory, current),
  };
}

/** Frame type of an owned suit id, e.g. from an EOM XP line. */
export function suitTypeForId(payload: unknown, id: string): string | null {
  const inventory = inventoryRecord(payload);
  const suit = array(inventory?.Suits)
    .map(asRecord)
    .find((entry) => entry && oid(entry.ItemId) === id);
  return suit ? lotusPath(suit.ItemType) : null;
}

/** Frame types the player owns, for matching screenshot folder names. */
export function ownedSuitTypes(payload: unknown): string[] {
  const inventory = inventoryRecord(payload);
  return array(inventory?.Suits).flatMap((entry) => {
    const type = lotusPath(asRecord(entry)?.ItemType);
    return type ? [type] : [];
  });
}

const CATEGORIES_BY_KIND: Record<LevelCapSlotKind, readonly string[]> = {
  ...(Object.fromEntries(NORMAL_SLOTS.map((s) => [s.kind, [s.category]])) as Record<
    Exclude<LevelCapSlotKind, "companion">,
    string[]
  >),
  companion: COMPANION_CATEGORIES,
};

function ownedCopies(inventory: Json, kind: LevelCapSlotKind, type?: string): Json[] {
  return CATEGORIES_BY_KIND[kind].flatMap((category) =>
    array(inventory[category]).flatMap((entry) => {
      const raw = asRecord(entry);
      return raw && (!type || lotusPath(raw.ItemType) === type) ? [raw] : [];
    }),
  );
}

/** Every owned zaw, kitgun or MOA that fits the slot, each on its first modded
 *  config, so the picker can offer them by the names the player gave them. */
export function ownedModularItems(payload: unknown, kind: LevelCapSlotKind): LevelCapItem[] {
  const inventory = inventoryRecord(payload);
  if (!inventory) return [];
  const index = indexInventory(inventory);
  return ownedCopies(inventory, kind).flatMap((raw) => {
    if (!modularIdentity(raw).parts) return [];
    const configs = array(raw.Configs).flatMap((_, n) => readItem(index, kind, raw, n) ?? []);
    const item = configs.find((c) => c.upgrades.length) ?? readItem(index, kind, raw, 0);
    return item ? [item] : [];
  });
}

/** Name and parts for a modular item saved before builds kept them: the owned copy
 *  with a config holding exactly these mods. Null unless exactly one copy fits. */
export function findModularIdentity(
  payload: unknown,
  item: LevelCapItem,
): Pick<LevelCapItem, "parts" | "customName"> | null {
  const inventory = inventoryRecord(payload);
  if (!inventory) return null;
  const index = indexInventory(inventory);
  const wanted = item.upgrades
    .map((u) => u.type ?? "?")
    .sort()
    .join(",");
  const fits = ownedCopies(inventory, item.kind, item.type).filter(
    (raw) =>
      modularIdentity(raw).parts &&
      array(raw.Configs).some((_, n) => {
        const config = readItem(index, item.kind, raw, n);
        return (
          config?.upgrades
            .map((u) => u.type ?? "?")
            .sort()
            .join(",") === wanted
        );
      }),
  );
  return fits.length === 1 ? modularIdentity(fits[0]) : null;
}

/** Every mod config (A, B, C...) of an owned item, as the build editor offers them.
 * With several copies of one item, the copy carrying the most mods wins. Empty when
 * the item is not owned. */
export function snapshotItemConfigs(
  payload: unknown,
  kind: LevelCapSlotKind,
  type: string,
  parts?: readonly string[],
): LevelCapItem[] {
  const inventory = inventoryRecord(payload);
  if (!inventory) return [];
  const index = indexInventory(inventory);
  const all = ownedCopies(inventory, kind, type);
  // A zaw's configs must come from that zaw, not whichever build has the most mods.
  const matched = all.filter((raw) => sameParts(modularIdentity(raw).parts, parts));
  const copies = matched.length ? matched : all;
  const configsOf = (raw: Json) =>
    array(raw.Configs).flatMap((_, config) => readItem(index, kind, raw, config) ?? []);
  const slotted = (items: LevelCapItem[]) =>
    items.reduce((sum, item) => sum + item.upgrades.length, 0);
  return copies
    .map(configsOf)
    .reduce<LevelCapItem[]>((best, next) => (slotted(next) > slotted(best) ? next : best), []);
}
