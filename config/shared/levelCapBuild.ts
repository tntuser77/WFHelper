import { asRecord } from "./objectValidation";
import type {
  LevelCapBuild,
  LevelCapFocusSchool,
  LevelCapItem,
  LevelCapRiven,
  LevelCapSlotKind,
  LevelCapUpgrade,
} from "./levelCapTypes";

function itemKey(item: LevelCapItem | null): string {
  if (!item) return "-";
  const upgrades = item.upgrades
    .map((u) => `${u.slot}:${u.type ?? "?"}`)
    .sort()
    .join(",");
  const helminth = item.helminth ? `h${item.helminth.index}:${item.helminth.ability}` : "";
  const weapon = item.weapon ? `+${itemKey(item.weapon)}` : "";
  return `${item.type}[${upgrades}]${helminth}${weapon}`;
}

/** Identity of a build for grouping; ranks and the archgun are left out because
 * they change without the build meaningfully changing. */
export function levelCapBuildKey(build: LevelCapBuild | null): string {
  if (!build) return "";
  return [build.suit, build.primary, build.secondary, build.melee, build.companion]
    .map(itemKey)
    .concat(build.focus ?? "-")
    .join("|");
}

/** "Build A", "Build B", ... the first letter no build of the frame uses yet. */
export function nextLevelCapBuildName(taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  for (let n = 0; ; n++) {
    const letter = n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
    const name = `Build ${letter}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

const FOCUS_SCHOOLS = new Set<LevelCapFocusSchool>([
  "madurai",
  "vazarin",
  "naramon",
  "zenurik",
  "unairu",
]);
const MAX_UPGRADES = 16;
const MAX_SHARDS = 5;

function text(value: unknown, max = 256): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

// An early capture doubled the weapon: "Magistar Magistar Toxicron".
const DOUBLED_WEAPON_RE = /^((?:\S+ ){0,2}\S+) \1 /;

function riven(raw: unknown): LevelCapRiven | null {
  const value = asRecord(raw);
  const name = text(value?.name, 120)?.replace(DOUBLED_WEAPON_RE, "$1 ");
  if (!value || !name || !Array.isArray(value.stats)) return null;
  const stats = value.stats.slice(0, 4).flatMap((entry) => {
    const stat = asRecord(entry);
    const statName = text(stat?.name, 80);
    const amount = stat?.value;
    if (!statName || typeof amount !== "number" || !Number.isFinite(amount)) return [];
    return [
      {
        name: statName,
        value: amount,
        positive: stat?.positive !== false,
        multiplier: stat?.multiplier === true,
      },
    ];
  });
  return { name, stats };
}

function upgrade(raw: unknown): LevelCapUpgrade | null {
  const value = asRecord(raw);
  const slot = int(value?.slot, 0, 31);
  if (!value || slot === null) return null;
  const out: LevelCapUpgrade = { slot, type: text(value.type), rank: int(value.rank, 0, 30) };
  const rolled = riven(value.riven);
  if (rolled) out.riven = rolled;
  return out;
}

/** Riven upgrade paths; the stats live on the owned copy, not the type. */
export function isLevelCapRivenType(type: string | null): boolean {
  return !!type && type.includes("/Mods/Randomized/");
}

function item(raw: unknown, kind: LevelCapSlotKind, depth = 0): LevelCapItem | null {
  const value = asRecord(raw);
  const type = text(value?.type);
  if (!value || !type) return null;
  const seen = new Set<number>();
  const upgrades = (Array.isArray(value.upgrades) ? value.upgrades : [])
    .flatMap((entry) => upgrade(entry) ?? [])
    .filter((entry) => !seen.has(entry.slot) && seen.add(entry.slot))
    .slice(0, MAX_UPGRADES);
  const out: LevelCapItem = { kind, type, config: int(value.config, 0, 9) ?? 0, upgrades };
  const configName = text(value.configName, 64);
  if (configName) out.configName = configName;
  const helminth = asRecord(value.helminth);
  const ability = text(helminth?.ability);
  const index = int(helminth?.index, 0, 3);
  if (kind === "suit" && ability && index !== null) out.helminth = { ability, index };
  if (kind === "suit" && Array.isArray(value.shards)) {
    const shards = value.shards.flatMap((entry) => {
      const shard = asRecord(entry);
      const shardType = text(shard?.type);
      return shardType ? [{ color: text(shard?.color, 64) ?? "", type: shardType }] : [];
    });
    if (shards.length) out.shards = shards.slice(0, MAX_SHARDS);
  }
  if (kind === "companion" && depth === 0) {
    const weapon = item(value.weapon, "companion", 1);
    if (weapon) out.weapon = weapon;
  }
  return out;
}

/** Checks a build coming from the renderer or a hand-edited index; null when it has no shape. */
export function normalizeLevelCapBuild(raw: unknown): LevelCapBuild | null {
  const value = asRecord(raw);
  if (!value) return null;
  const slot = (kind: LevelCapSlotKind) => item(value[kind], kind);
  const focus = value.focus as LevelCapFocusSchool;
  const build: LevelCapBuild = {
    suit: slot("suit"),
    primary: slot("primary"),
    secondary: slot("secondary"),
    melee: slot("melee"),
    archgun: slot("archgun"),
    companion: slot("companion"),
    focus: FOCUS_SCHOOLS.has(focus) ? focus : null,
  };
  const loadoutName = text(value.loadoutName, 64);
  if (loadoutName) build.loadoutName = loadoutName;
  return build;
}
