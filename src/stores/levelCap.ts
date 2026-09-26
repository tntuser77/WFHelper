import { writable } from "svelte/store";

import { invoke, on } from "../lib/ipc.js";
import type { LevelCapPayload, LevelCapRun, LevelCapSettings } from "../types/ipc.js";

export const levelCap = writable<LevelCapPayload | null>(null);

function patchRun(run: LevelCapRun | null): void {
  if (!run) return;
  levelCap.update((state) =>
    state ? { ...state, runs: state.runs.map((r) => (r.id === run.id ? run : r)) } : state,
  );
}

export async function loadLevelCap(): Promise<void> {
  levelCap.set(await invoke("getLevelCap"));
}

/** Main pushes the whole payload on every change; bound for the view's lifetime. */
export function subscribeLevelCap(): () => void {
  return on("level-cap-updated", (payload) => levelCap.set(payload));
}

export async function setLevelCapTags(id: string, tags: string[]): Promise<void> {
  patchRun(await invoke("setLevelCapTags", id, tags));
}

export async function setLevelCapNotes(id: string, notes: string): Promise<void> {
  patchRun(await invoke("setLevelCapNotes", id, notes));
}

export async function setLevelCapArchgun(id: string, used: boolean): Promise<void> {
  patchRun(await invoke("setLevelCapArchgun", id, used));
}

/** `source` is a run id, or "equipped" for the loadout on right now. */
export async function applyLevelCapBuild(ids: string[], source: string): Promise<void> {
  levelCap.set(await invoke("applyLevelCapBuild", ids, source));
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
