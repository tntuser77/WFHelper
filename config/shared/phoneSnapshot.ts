// What the phone app receives, through the mailbox Worker in the
// WFHelper-mobile repo. The phone keeps a copy of these types; bump `v` when a
// field changes meaning so an older phone can say it needs an update.

import { ARCHON_SHARD_EFFECTS } from "./archonShardCatalog";
import type { LevelCapBuild, LevelCapItem, LevelCapNamedBuild, LevelCapRun } from "./levelCapTypes";

const PHONE_SNAPSHOT_VERSION = 1;

export type PhoneSnapshotKind = "relics" | "levelcap";

interface PhoneRelicReward {
  name: string;
  rarity: string;
  /** Median platinum, null when no price is known. */
  price: number | null;
  ducats: number | null;
}

interface PhoneRelic {
  /** "Axi H5" */
  name: string;
  tier: string;
  vaulted: boolean;
  /** Owned counts as [intact, exceptional, flawless, radiant]; null when none are owned. */
  owned: [number, number, number, number] | null;
  /** Name of the gold (rare) reward, one of `rewards`. */
  gold: string | null;
  rewards: PhoneRelicReward[];
}

interface PhoneRelicSnapshot {
  v: number;
  kind: "relics";
  generatedAt: number;
  /** When WFHelper last refreshed market prices; null when it never has. */
  pricesAt: number | null;
  relics: PhoneRelic[];
}

interface PhoneBuildSlot {
  slot: LevelCapItem["kind"];
  name: string;
  mods: string[];
  /** Suits only: the ability the Helminth grafted in. */
  helminth?: string;
  /** Suits only: archon shards as "Tauforged Amber: +37.5% Casting Speed". */
  shards?: string[];
}

interface PhoneBuild {
  focus: string | null;
  slots: PhoneBuildSlot[];
}

interface PhoneLevelCapRun {
  id: string;
  completedAt: number;
  frame: string;
  exolizers: number | null;
  rounds: number | null;
  durationSec: number | null;
  squadSize: number | null;
  /** Names the run recorded, as the desktop search matches them. */
  players: string[];
  /** Squad rows read off the screenshot, with the frame each played once labelled. */
  squad: Array<{ name: string | null; frame: string | null }>;
  tags: string[];
  buildName: string | null;
  build: PhoneBuild | null;
  archgunUsed: boolean;
}

interface PhoneLevelCapSnapshot {
  v: number;
  kind: "levelcap";
  generatedAt: number;
  /** Frame group -> the note written on its card. */
  frameNotes: Record<string, string>;
  runs: PhoneLevelCapRun[];
}

export type PhoneSnapshot = PhoneRelicSnapshot | PhoneLevelCapSnapshot;

/** What Settings shows about the phone link; the write key itself stays in main. */
export interface PhoneSyncState {
  url: string;
  keySet: boolean;
  /** False when safeStorage is unavailable: the key lasts until the app closes. */
  keyPersisted: boolean;
  pairedAt: number | null;
  lastSent: Record<PhoneSnapshotKind, number | null>;
  lastError: string | null;
  syncing: boolean;
}

export type PhoneSyncResult<T = PhoneSyncState> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface PhonePairing {
  /** PNG data URL of the QR code the phone scans. */
  qr: string;
  /** The same pairing as text, for pasting when the camera is not an option. */
  code: string;
  state: PhoneSyncState;
}

type OwnedRow = { intact: number; exceptional: number; flawless: number; radiant: number };

interface SnapshotRelicGroup {
  name: string;
  tier: string;
  vaulted: boolean;
  qualities: Record<
    string,
    {
      rewards?: Array<{ name: string; rarity?: string; urlName?: string | null; ducats?: unknown }>;
    }
  >;
}

interface RelicSnapshotInput {
  groups: Record<string, SnapshotRelicGroup>;
  owned: Record<string, OwnedRow>;
  /** Price by reward `urlName`; null when unknown. */
  price: (urlName: string | null | undefined) => number | null;
  ducats: (reward: { urlName?: string | null; ducats?: unknown }) => number | null;
  /** Picks the gold reward, the same way the planner does. */
  goldReward: <R extends { rarity?: string }>(rewards: R[]) => R | null;
  pricesAt: number | null;
  now: number;
}

const RELIC_SUFFIX = / Relic$/i;

export function buildRelicSnapshot(input: RelicSnapshotInput): PhoneRelicSnapshot {
  const relics: PhoneRelic[] = [];
  for (const [key, group] of Object.entries(input.groups)) {
    // Every refinement shares the reward list, only the chances differ.
    const rewards =
      group.qualities.intact?.rewards ??
      Object.values(group.qualities).find((q) => q?.rewards?.length)?.rewards ??
      [];
    if (!rewards.length) continue;
    const row = input.owned[key];
    const owned: PhoneRelic["owned"] =
      row && row.intact + row.exceptional + row.flawless + row.radiant > 0
        ? [row.intact, row.exceptional, row.flawless, row.radiant]
        : null;
    relics.push({
      name: group.name.replace(RELIC_SUFFIX, ""),
      tier: group.tier,
      vaulted: group.vaulted,
      owned,
      gold: input.goldReward(rewards)?.name ?? null,
      rewards: rewards.map((reward) => ({
        name: reward.name,
        rarity: reward.rarity ?? "",
        price: input.price(reward.urlName),
        ducats: input.ducats(reward),
      })),
    });
  }
  relics.sort((a, b) => a.name.localeCompare(b.name));
  return {
    v: PHONE_SNAPSHOT_VERSION,
    kind: "relics",
    generatedAt: input.now,
    pricesAt: input.pricesAt,
    relics,
  };
}

interface LevelCapSnapshotInput {
  runs: readonly LevelCapRun[];
  builds: readonly LevelCapNamedBuild[];
  frameNotes: Record<string, string>;
  /** `/Lotus/...` path -> display name; null when the catalogue has no entry. */
  nameOf: (type: string) => string | null;
  now: number;
}

/** The last path segment reads well enough when the catalogue has no name. */
function fallbackName(type: string): string {
  return type.split("/").pop() || type;
}

// The inventory names a shard's hue ACC_<hue>; the _MYTHIC suffix is tauforged.
const SHARD_COLORS: Record<string, string> = {
  ACC_RED: "Crimson",
  ACC_YELLOW: "Amber",
  ACC_BLUE: "Azure",
  ACC_GREEN: "Emerald",
  ACC_ORANGE: "Topaz",
  ACC_PURPLE: "Violet",
};

function shardLabel(shard: { color: string; type: string }): string {
  const tauforged = shard.color.endsWith("_MYTHIC");
  const hue = SHARD_COLORS[shard.color.replace(/_MYTHIC$/, "")] ?? shard.color;
  const name = tauforged ? `Tauforged ${hue}` : hue;
  const effect = ARCHON_SHARD_EFFECTS.find(
    (entry) => entry.color === shard.color && entry.type === shard.type,
  )?.effect;
  return effect ? `${name}: ${effect}` : name;
}

function phoneSlot(item: LevelCapItem, nameOf: (type: string) => string | null): PhoneBuildSlot {
  const slot: PhoneBuildSlot = {
    slot: item.kind,
    name: item.customName || nameOf(item.type) || fallbackName(item.type),
    mods: item.upgrades.flatMap((up) => {
      if (up.riven) return [up.riven.name];
      if (!up.type) return [];
      return [nameOf(up.type) ?? fallbackName(up.type)];
    }),
  };
  if (item.helminth) {
    slot.helminth = nameOf(item.helminth.ability) ?? fallbackName(item.helminth.ability);
  }
  if (item.shards?.length) slot.shards = item.shards.map(shardLabel);
  return slot;
}

function phoneBuild(
  build: LevelCapBuild | null,
  nameOf: (type: string) => string | null,
): PhoneBuild | null {
  if (!build) return null;
  const items = [
    build.suit,
    build.primary,
    build.secondary,
    build.melee,
    build.archgun,
    build.companion,
  ].filter((item): item is LevelCapItem => item !== null);
  if (!items.length && !build.focus) return null;
  return { focus: build.focus, slots: items.map((item) => phoneSlot(item, nameOf)) };
}

export function buildLevelCapSnapshot(input: LevelCapSnapshotInput): PhoneLevelCapSnapshot {
  const buildsById = new Map(input.builds.map((build) => [build.id, build]));
  const runs = input.runs.map((run): PhoneLevelCapRun => {
    const named = run.buildId ? buildsById.get(run.buildId) : undefined;
    return {
      id: run.id,
      completedAt: run.completedAt,
      frame: run.frame,
      exolizers: run.exolizers,
      rounds: run.rounds ?? null,
      durationSec: run.durationSec,
      squadSize: run.squadSize,
      players: run.players ?? [],
      squad: (run.squadmates ?? []).map((mate) => ({ name: mate.name, frame: mate.frame })),
      tags: named?.tags ?? run.tags ?? [],
      buildName: named?.name ?? null,
      build: phoneBuild(named?.build ?? run.build, input.nameOf),
      archgunUsed: run.archgunUsed,
    };
  });
  runs.sort((a, b) => b.completedAt - a.completedAt);
  return {
    v: PHONE_SNAPSHOT_VERSION,
    kind: "levelcap",
    generatedAt: input.now,
    frameNotes: input.frameNotes,
    runs,
  };
}
