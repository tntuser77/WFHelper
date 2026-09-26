import path from "node:path";
import { dialog, nativeImage, shell } from "electron";

import { assertMainRendererSender, handleAuthorized } from "./ipcSecurity";
import ctx from "./context";
import { broadcastToRenderers } from "./popoutIpc";
import { registerTransientHotkey, unregisterTransientHotkey } from "./hotkeyRegistry";
import { asRunId } from "./runTrackerIpc";
import * as itemDb from "../services/itemDatabase";
import * as store from "../services/levelCapStore";
import * as tracker from "../services/levelCapTracker";
import { levelCapCatalog } from "../services/levelCapCatalog";
import {
  ownedSuitTypes,
  snapshotBuildForFrame,
  snapshotEquippedBuild,
} from "../services/levelCapBuild";
import { captureScreenFast } from "../services/screenCapture";
import { withScope } from "../services/logger";
import { loadRegionTranslation } from "../services/regionNames";
import { fallbackNameFromUniqueName } from "../config/shared/displayName";
import {
  LEVEL_CAP_ASSIGN_BUILD,
  LEVEL_CAP_CATALOG,
  LEVEL_CAP_CREATE_BUILD,
  LEVEL_CAP_DELETE_BUILD,
  LEVEL_CAP_DELETE_RUN,
  LEVEL_CAP_GET,
  LEVEL_CAP_HOTKEY,
  LEVEL_CAP_IMPORT_FOLDERS,
  LEVEL_CAP_OPEN_SCREENSHOT,
  LEVEL_CAP_PICK_FOLDER,
  LEVEL_CAP_SET_ARCHGUN,
  LEVEL_CAP_SET_NOTES,
  LEVEL_CAP_THUMBNAIL,
  LEVEL_CAP_UPDATE_BUILD,
  LEVEL_CAP_UPDATED,
  LEVEL_CAP_UPDATE_SETTINGS,
} from "../config/shared/ipcChannels";
import type {
  LevelCapBuild,
  LevelCapBuildPatch,
  LevelCapPayload,
  LevelCapSettings,
} from "../config/shared/levelCapTypes";

const log = withScope("levelCapIpc");
const THUMBNAIL_WIDTH = 960;

let _boundHotkey = "";

function frameName(type: string): string {
  return itemDb.lookupItem(type)?.name || fallbackNameFromUniqueName(type);
}

let _abilityNames: Map<string, string> | null = null;

/** Ability path -> English name. English because Underframe matches on it. */
function abilityNameMap(): Map<string, string> {
  if (_abilityNames) return _abilityNames;
  const names = new Map<string, string>();
  try {
    const pep = require("warframe-public-export-plus") as {
      ExportAbilities?: Record<string, { name?: string }>;
      ExportWarframes?: Record<
        string,
        { abilities?: Array<{ uniqueName?: string; name?: string }> }
      >;
    };
    const dict = loadRegionTranslation().dict;
    const add = (type: string | undefined, key: string | undefined) => {
      const name = key ? dict[key] : undefined;
      if (type && name && !names.has(type)) names.set(type, name);
    };
    for (const [type, ability] of Object.entries(pep.ExportAbilities ?? {}))
      add(type, ability.name);
    for (const frame of Object.values(pep.ExportWarframes ?? {})) {
      for (const ability of frame.abilities ?? []) add(ability.uniqueName, ability.name);
    }
  } catch (err) {
    log.warn("[LevelCap] ability names unavailable:", String(err));
  }
  _abilityNames = names;
  return names;
}

function payload(): LevelCapPayload {
  const runs = store.getRuns();
  const builds = store.getBuilds();
  const abilityNames: Record<string, string> = {};
  for (const build of [...runs.map((r) => r.build), ...builds.map((b) => b.build)]) {
    const ability = build?.suit?.helminth?.ability;
    const name = ability && abilityNameMap().get(ability);
    if (ability && name) abilityNames[ability] = name;
  }
  return {
    runs,
    builds,
    settings: store.getSettings(),
    status: tracker.getStatus(),
    abilityNames,
  };
}

function asBuildId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
}

/** The loadout equipped right now, when it is a variant of `frame` (Dante or Dante Prime). */
function equippedBuildFor(frame: string): LevelCapBuild | null {
  const build = snapshotEquippedBuild(ctx.currentInventoryData);
  const type = build?.suit?.type;
  return build && type && tracker.frameGroup(frameName(type)) === frame ? build : null;
}

function isBuildPatch(raw: unknown): raw is LevelCapBuildPatch & { fromEquipped?: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    (value.name === undefined || typeof value.name === "string") &&
    (value.tags === undefined || Array.isArray(value.tags)) &&
    (value.fromEquipped === undefined || typeof value.fromEquipped === "boolean")
  );
}

function pushUpdate(): void {
  broadcastToRenderers(LEVEL_CAP_UPDATED, payload());
}

function bindHotkey(): void {
  const { hotkey, passthrough } = store.getSettings();
  if (_boundHotkey) unregisterTransientHotkey(_boundHotkey);
  _boundHotkey = "";
  if (!hotkey) return;
  if (registerTransientHotkey(hotkey, tracker.onLevelCapHotkey, { passthrough })) {
    _boundHotkey = hotkey;
  } else {
    log.warn("[LevelCap] could not bind finish-run hotkey:", hotkey);
  }
}

function fold(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Matches a screenshot folder ("Cyte", "Mirage") to an owned frame. Several
 * owned copies (Nezha and Nezha Prime) resolve to the one a saved loadout uses. */
function frameForFolder(folder: string): { frame: string; frameType: string | null } {
  const inventory = ctx.currentInventoryData;
  const wanted = fold(folder);
  const candidates = ownedSuitTypes(inventory).filter((type) => {
    const name = fold(tracker.frameGroup(frameName(type)));
    return name === wanted || name.startsWith(wanted);
  });
  const best =
    candidates.find((type) => snapshotBuildForFrame(inventory, type)?.loadoutName) ??
    candidates.find((type) => /Prime$/.test(type)) ??
    candidates[0];
  return best
    ? { frame: tracker.frameGroup(frameName(best)), frameType: best }
    : { frame: folder, frameType: null };
}

function isSettingsPatch(raw: unknown): raw is Partial<LevelCapSettings> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    (value.hotkey === undefined || typeof value.hotkey === "string") &&
    (value.passthrough === undefined || typeof value.passthrough === "boolean") &&
    (value.screenshotDir === undefined || typeof value.screenshotDir === "string") &&
    (value.backupDir === undefined || typeof value.backupDir === "string")
  );
}

function register(): void {
  tracker.initLevelCapTracker({
    getInventory: () => ctx.currentInventoryData,
    frameName,
    async capture() {
      const shot = await captureScreenFast();
      return shot && !shot.image.isEmpty() ? shot.image.toPNG() : null;
    },
    onChanged: pushUpdate,
    onHotkey: (outcome) => broadcastToRenderers(LEVEL_CAP_HOTKEY, outcome),
  });
  bindHotkey();

  handleAuthorized(LEVEL_CAP_GET, assertMainRendererSender, () => payload());

  handleAuthorized(
    LEVEL_CAP_SET_NOTES,
    assertMainRendererSender,
    (_e, id: unknown, notes: unknown) => {
      const runId = asRunId(id);
      return runId ? store.setRunNotes(runId, notes) : null;
    },
  );

  handleAuthorized(
    LEVEL_CAP_SET_ARCHGUN,
    assertMainRendererSender,
    (_e, id: unknown, used: unknown) => {
      const runId = asRunId(id);
      if (!runId || typeof used !== "boolean") return null;
      return store.updateRun(runId, (run) => (run.archgunUsed = used));
    },
  );

  // Starts from the loadout equipped now or a copy of another build; null when
  // the equipped frame is not this one.
  handleAuthorized(
    LEVEL_CAP_CREATE_BUILD,
    assertMainRendererSender,
    (_e, frame: unknown, source: unknown, name: unknown) => {
      const out = { payload: payload(), buildId: null as string | null };
      if (typeof frame !== "string" || !source || typeof source !== "object") return out;
      const from = source as { kind?: unknown; id?: unknown };
      const build =
        from.kind === "equipped"
          ? equippedBuildFor(frame)
          : (store.getBuilds().find((b) => b.id === asBuildId(from.id))?.build ?? null);
      if (!build) return out;
      const record = store.createBuild(frame, build, typeof name === "string" ? name : undefined);
      return { payload: payload(), buildId: record.id };
    },
  );

  handleAuthorized(
    LEVEL_CAP_UPDATE_BUILD,
    assertMainRendererSender,
    (_e, id: unknown, patch: unknown) => {
      const buildId = asBuildId(id);
      const record = store.getBuilds().find((b) => b.id === buildId);
      if (!record || !isBuildPatch(patch)) return { payload: payload(), ok: false };
      const { fromEquipped, ...rest } = patch;
      const next: LevelCapBuildPatch = { ...rest };
      if (fromEquipped) {
        const equipped = equippedBuildFor(record.frame);
        if (!equipped) return { payload: payload(), ok: false };
        next.build = equipped;
      }
      store.updateBuild(record.id, next);
      return { payload: payload(), ok: true };
    },
  );

  handleAuthorized(LEVEL_CAP_DELETE_BUILD, assertMainRendererSender, (_e, id: unknown) => {
    const buildId = asBuildId(id);
    if (buildId) store.deleteBuild(buildId);
    return payload();
  });

  handleAuthorized(
    LEVEL_CAP_ASSIGN_BUILD,
    assertMainRendererSender,
    (_e, ids: unknown, id: unknown) => {
      const buildId = asBuildId(id);
      if (!Array.isArray(ids) || ids.length > 5000 || !buildId) return payload();
      store.assignBuild(
        ids.flatMap((runId) => asRunId(runId) ?? []),
        buildId,
      );
      return payload();
    },
  );

  handleAuthorized(LEVEL_CAP_CATALOG, assertMainRendererSender, () =>
    levelCapCatalog(ctx.currentInventoryData, store.getBuilds(), store.getRuns()),
  );

  handleAuthorized(LEVEL_CAP_DELETE_RUN, assertMainRendererSender, (_e, id: unknown) => {
    const runId = asRunId(id);
    if (runId) store.deleteRun(runId);
    return payload();
  });

  handleAuthorized(LEVEL_CAP_IMPORT_FOLDERS, assertMainRendererSender, () => {
    const result = store.importScreenshotFolders({
      frameForFolder,
      buildForFrame: (type) => snapshotBuildForFrame(ctx.currentInventoryData, type),
    });
    log.info(`[LevelCap] imported ${result.imported} screenshot(s), ${result.skipped} known`);
    return { result, payload: payload() };
  });

  handleAuthorized(LEVEL_CAP_UPDATE_SETTINGS, assertMainRendererSender, (_e, patch: unknown) => {
    if (!isSettingsPatch(patch)) return payload();
    store.updateSettings(patch);
    if (patch.hotkey !== undefined || patch.passthrough !== undefined) bindHotkey();
    return payload();
  });

  handleAuthorized(LEVEL_CAP_PICK_FOLDER, assertMainRendererSender, async (_e, kind: unknown) => {
    if (!ctx.mainWindow || (kind !== "screenshotDir" && kind !== "backupDir")) return payload();
    const current = store.getSettings()[kind];
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: current || undefined,
    });
    if (!result.canceled && result.filePaths[0])
      store.updateSettings({ [kind]: result.filePaths[0] });
    return payload();
  });

  handleAuthorized(LEVEL_CAP_THUMBNAIL, assertMainRendererSender, (_e, id: unknown) => {
    const runId = asRunId(id);
    const file = store.getRuns().find((run) => run.id === runId)?.screenshot;
    if (!file) return null;
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return null;
    const { width } = image.getSize();
    return (width > THUMBNAIL_WIDTH ? image.resize({ width: THUMBNAIL_WIDTH }) : image).toDataURL();
  });

  handleAuthorized(LEVEL_CAP_OPEN_SCREENSHOT, assertMainRendererSender, (_e, id: unknown) => {
    const runId = asRunId(id);
    const file = store.getRuns().find((run) => run.id === runId)?.screenshot;
    if (!file) return { ok: false };
    void shell.openPath(path.resolve(file));
    return { ok: true };
  });
}

export { register };
