import { writable } from "svelte/store";

import { invoke, on } from "../lib/ipc.js";
import type {
  LevelCapBuildPatch,
  LevelCapBuildSource,
  LevelCapItem,
  LevelCapSlotKind,
} from "../../config/shared/levelCapTypes.js";
import type { LevelCapCatalog, LevelCapPayload, LevelCapSettings } from "../types/ipc.js";

export const levelCap = writable<LevelCapPayload | null>(null);

export async function loadLevelCap(): Promise<void> {
  levelCap.set(await invoke("getLevelCap"));
}

/** Main pushes the whole payload on every change; bound for the view's lifetime. */
export function subscribeLevelCap(): () => void {
  return on("level-cap-updated", (payload) => levelCap.set(payload));
}

export async function setLevelCapNotes(frame: string, notes: string): Promise<void> {
  levelCap.set(await invoke("setLevelCapNotes", frame, notes));
}

/** Resolves to the new build's id, or null when the equipped frame is a different one. */
export async function createLevelCapBuild(
  frame: string,
  source: LevelCapBuildSource,
  name?: string,
): Promise<string | null> {
  const { payload, buildId } = await invoke("createLevelCapBuild", frame, source, name);
  levelCap.set(payload);
  return buildId;
}

/** False when the build is gone or, for `fromEquipped`, another frame is equipped. */
export async function updateLevelCapBuild(
  id: string,
  patch: LevelCapBuildPatch & { fromEquipped?: boolean },
): Promise<boolean> {
  const { payload, ok } = await invoke("updateLevelCapBuild", id, patch);
  levelCap.set(payload);
  return ok;
}

export async function deleteLevelCapBuild(id: string): Promise<void> {
  levelCap.set(await invoke("deleteLevelCapBuild", id));
}

export async function assignLevelCapBuild(runIds: string[], buildId: string): Promise<void> {
  levelCap.set(await invoke("assignLevelCapBuild", runIds, buildId));
}

let _catalog: Promise<LevelCapCatalog> | null = null;

/** Fetched once per session; the shard list only grows when a new shard is socketed. */
export function loadLevelCapCatalog(): Promise<LevelCapCatalog> {
  _catalog ??= invoke("getLevelCapCatalog").catch((err: unknown) => {
    _catalog = null;
    throw err;
  });
  return _catalog;
}

export async function deleteLevelCapRun(id: string): Promise<void> {
  levelCap.set(await invoke("deleteLevelCapRun", id));
}

export async function importLevelCapFolders(): Promise<number> {
  const { result, payload } = await invoke("importLevelCapFolders");
  levelCap.set(payload);
  return result.imported;
}

export async function updateLevelCapSettings(patch: Partial<LevelCapSettings>): Promise<void> {
  levelCap.set(await invoke("updateLevelCapSettings", patch));
}

export async function pickLevelCapFolder(kind: "screenshotDir" | "backupDir"): Promise<void> {
  levelCap.set(await invoke("pickLevelCapFolder", kind));
}

/** The owned item's mod configs (A, B, C...) from the inventory; empty when not owned. */
export function loadLevelCapItemConfigs(
  kind: LevelCapSlotKind,
  type: string,
  parts?: string[],
): Promise<LevelCapItem[]> {
  return invoke("getLevelCapItemConfigs", kind, type, parts);
}

/** Owned zaws, kitguns and MOAs for a slot, under the names the player gave them. */
export function loadLevelCapModularItems(kind: LevelCapSlotKind): Promise<LevelCapItem[]> {
  return invoke("getLevelCapModularItems", kind);
}
