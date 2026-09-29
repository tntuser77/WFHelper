import fs from "node:fs";
import path from "node:path";
import { dialog, nativeImage, shell, type NativeImage } from "electron";

import { assertMainRendererSender, handleAuthorized } from "./ipcSecurity";
import ctx from "./context";
import { broadcastToRenderers } from "./popoutIpc";
import { showLevelCapNotification, type LevelCapToastCard } from "./tradeNotificationIpc";
import { registerTransientHotkey, unregisterTransientHotkey } from "./hotkeyRegistry";
import { asRunId } from "./runTrackerIpc";
import { addInventoryListener } from "./inventoryIpc";
import * as itemDb from "../services/itemDatabase";
import * as store from "../services/levelCapStore";
import * as tracker from "../services/levelCapTracker";
import { levelCapCatalog } from "../services/levelCapCatalog";
import { openUnderframeDpsWindow, prewarmUnderframe } from "../services/underframeDps";
import {
  sanitizeUnderframeBuild,
  UNDERFRAME_SHARE_BASE,
  UNDERFRAME_WEAPON_TYPES,
} from "../config/shared/underframe";
import {
  findModularIdentity,
  ownedModularItems,
  ownedSuitTypes,
  rivensByWeapon,
  snapshotBuildForFrame,
  snapshotEquippedBuild,
  snapshotItemConfigs,
} from "../services/levelCapBuild";
import { captureScreenFast } from "../services/screenCapture";
import { readExolizersFromScreenshot } from "../services/levelCapExolizerOcr";
import { readSquadFromScreenshot } from "../services/levelCapSquadOcr";
import { loadSharp } from "../services/sharpRuntime";
import { withScope } from "../services/logger";
import { loadRegionTranslation } from "../services/regionNames";
import { normalizeErrorMessage } from "../config/shared/errors";
import { fallbackNameFromUniqueName } from "../config/shared/displayName";
import {
  LEVEL_CAP_ASSIGN_BUILD,
  LEVEL_CAP_CATALOG,
  LEVEL_CAP_CREATE_BUILD,
  LEVEL_CAP_DELETE_BUILD,
  LEVEL_CAP_DELETE_RUN,
  LEVEL_CAP_FIX_SQUADMATE,
  LEVEL_CAP_GET,
  LEVEL_CAP_LABEL_PORTRAIT,
  LEVEL_CAP_HOTKEY,
  LEVEL_CAP_ITEM_CONFIGS,
  LEVEL_CAP_MODULAR_ITEMS,
  LEVEL_CAP_IMPORT_FOLDERS,
  LEVEL_CAP_OPEN_SCREENSHOT,
  LEVEL_CAP_UNDERFRAME_DPS,
  LEVEL_CAP_UNDERFRAME_PREWARM,
  LEVEL_CAP_PICK_FOLDER,
  LEVEL_CAP_PORTRAIT_THUMB,
  LEVEL_CAP_SET_NOTES,
  LEVEL_CAP_SQUAD_CROP,
  LEVEL_CAP_SCREENSHOT,
  LEVEL_CAP_THUMBNAIL,
  LEVEL_CAP_UPDATE_BUILD,
  LEVEL_CAP_UPDATED,
  LEVEL_CAP_UPDATE_SETTINGS,
} from "../config/shared/ipcChannels";
import {
  LEVEL_CAP_EXOLIZER_TARGET,
  LEVEL_CAP_SQUAD_CROP as SQUAD_CROP,
} from "../config/shared/levelCapTypes";
import type {
  LevelCapBuild,
  LevelCapBuildPatch,
  LevelCapHotkeyOutcome,
  LevelCapPayload,
  LevelCapRiven,
  LevelCapSettings,
  LevelCapSquadFixPatch,
  LevelCapSlotKind,
} from "../config/shared/levelCapTypes";

const log = withScope("levelCapIpc");
const THUMBNAIL_WIDTH = 960;
const SCREENSHOT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

let _boundHotkey = "";
let _readingScreenshots = false;
// Startup has enough to load; the screenshot pass can wait a little.
const SCREENSHOT_READ_DELAY_MS = 15_000;

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
    frameNotes: store.getFrameNotes(),
    hotkey: {
      bound: _boundHotkey !== "",
      canPassThrough: process.platform === "win32",
    },
    abilityNames,
  };
}

/** Fills riven stats the saved builds lack from this inventory. A weapon only gets
 * stats when a single owned riven fits it; with two there is no telling which was used. */
function backfillRivens(inventory: unknown): boolean {
  if (!inventory) return false;
  let byWeapon: Map<string, LevelCapRiven[]> | null = null;
  return store.backfillRivens((type, named) => {
    // Decoding every riven is only worth it once a build turns out to need one.
    byWeapon ??= rivensByWeapon(inventory);
    const name = frameName(type).toLowerCase();
    const fits = [...byWeapon].flatMap(([weapon, rivens]) =>
      name === weapon || name.startsWith(`${weapon} `) || name.endsWith(` ${weapon}`) ? rivens : [],
    );
    if (named) return fits.find((riven) => riven.name === named) ?? null;
    return fits.length === 1 ? fits[0] : null;
  });
}

/** Details older builds lack that only the inventory knows; true when any changed. */
function backfillInventory(inventory: unknown): boolean {
  if (!inventory) return false;
  const modular = store.backfillModular((item) => findModularIdentity(inventory, item));
  return backfillRivens(inventory) || modular;
}

const SLOT_KINDS = new Set<LevelCapSlotKind>([
  "suit",
  "primary",
  "secondary",
  "melee",
  "archgun",
  "companion",
]);

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

/** Reads the Exolizer count and the squad off screenshots, one at a time in the background. */
async function readScreenshots(): Promise<void> {
  if (_readingScreenshots) return;
  _readingScreenshots = true;
  let read = 0;
  let squads = 0;
  try {
    for (;;) {
      const pending = store.runsAwaitingExolizerRead();
      if (!pending.length) break;
      for (const { id, screenshot } of pending) {
        const result = await readExolizersFromScreenshot(screenshot);
        store.recordExolizerRead(id, result);
        if (result) read++;
      }
      pushUpdate();
    }
    if (read) log.info(`[LevelCap] read ${read} Exolizer count(s) off screenshots`);
    for (;;) {
      const pending = store.runsAwaitingSquadRead();
      if (!pending.length) break;
      for (const { id, screenshot } of pending) {
        const read = await readSquadFromScreenshot(screenshot);
        store.recordSquadRead(id, read);
        if (read?.names.length) squads++;
      }
      pushUpdate();
    }
    if (squads) log.info(`[LevelCap] read ${squads} squad list(s) off screenshots`);
    // Row positions for runs read before they were kept, for the name review.
    const placing = store.runsAwaitingSquadRows();
    for (const { id, screenshot } of placing) {
      store.recordSquadRows(id, await readSquadFromScreenshot(screenshot));
    }
    if (placing.length) {
      pushUpdate();
      log.info(`[LevelCap] placed squad rows on ${placing.length} screenshot(s)`);
    }
  } finally {
    _readingScreenshots = false;
  }
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

function toastCard(outcome: LevelCapHotkeyOutcome): LevelCapToastCard {
  const card: LevelCapToastCard = {
    status: "failed",
    frame: "",
    thumb: null,
    runNumber: null,
    exolizers: null,
    target: LEVEL_CAP_EXOLIZER_TARGET,
    durationSec: null,
  };
  if (outcome.type === "below-target")
    return { ...card, status: "below", exolizers: outcome.exolizers };
  if (outcome.type === "capture-failed") return card;
  const { run } = outcome;
  return {
    ...card,
    status: outcome.type === "logged" ? "logged" : "replaced",
    frame: run.frame,
    thumb: run.frameType ? (itemDb.lookupItem(run.frameType)?.imageUrl ?? null) : null,
    runNumber: outcome.type === "logged" ? outcome.frameRuns : null,
    exolizers: run.exolizers,
    durationSec: run.durationSec,
  };
}

function isSettingsPatch(raw: unknown): raw is Partial<LevelCapSettings> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    (value.hotkey === undefined || typeof value.hotkey === "string") &&
    (value.passthrough === undefined || typeof value.passthrough === "boolean") &&
    (value.screenshotDir === undefined || typeof value.screenshotDir === "string") &&
    (value.backupDir === undefined || typeof value.backupDir === "string") &&
    (value.knownPlayers === undefined || Array.isArray(value.knownPlayers))
  );
}

function isSquadFixPatch(raw: unknown): raw is LevelCapSquadFixPatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    (value.name === undefined || typeof value.name === "string") &&
    (value.frame === undefined || typeof value.frame === "string") &&
    (value.notSquadmate === undefined || value.notSquadmate === true)
  );
}

/** Electron decodes PNG and JPEG only; a WebP or BMP screenshot goes through sharp. */
async function loadScreenshotImage(file: string): Promise<NativeImage | null> {
  const image = nativeImage.createFromPath(file);
  if (!image.isEmpty()) return image;
  try {
    const png = await loadSharp()(file).png().toBuffer();
    const decoded = nativeImage.createFromBuffer(png);
    return decoded.isEmpty() ? null : decoded;
  } catch (err) {
    log.warn("[LevelCap] screenshot unreadable:", normalizeErrorMessage(err));
    return null;
  }
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
    onHotkey: (outcome) => {
      broadcastToRenderers(LEVEL_CAP_HOTKEY, outcome);
      showLevelCapNotification(toastCard(outcome));
      // The new screenshot's squad list: names and what they played.
      if (outcome.type === "logged" || outcome.type === "screenshot-replaced") {
        void readScreenshots();
      }
    },
  });
  bindHotkey();
  setTimeout(() => void readScreenshots(), SCREENSHOT_READ_DELAY_MS).unref?.();

  handleAuthorized(LEVEL_CAP_GET, assertMainRendererSender, () => {
    backfillInventory(ctx.currentInventoryData);
    return payload();
  });
  addInventoryListener((inventory) => {
    if (backfillInventory(inventory)) pushUpdate();
  });

  handleAuthorized(
    LEVEL_CAP_SET_NOTES,
    assertMainRendererSender,
    (_e, frame: unknown, notes: unknown) => {
      if (typeof frame === "string" && frame.trim() && frame.length <= 120) {
        store.setFrameNotes(frame, notes);
      }
      return payload();
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

  handleAuthorized(LEVEL_CAP_CATALOG, assertMainRendererSender, () => levelCapCatalog());

  handleAuthorized(
    LEVEL_CAP_ITEM_CONFIGS,
    assertMainRendererSender,
    (_e, kind: unknown, type: unknown, parts: unknown) => {
      if (typeof kind !== "string" || !SLOT_KINDS.has(kind as LevelCapSlotKind)) return [];
      if (typeof type !== "string" || type.length > 512) return [];
      const fitted = Array.isArray(parts)
        ? parts.filter((p): p is string => typeof p === "string" && p.length <= 512).slice(0, 8)
        : undefined;
      return snapshotItemConfigs(ctx.currentInventoryData, kind as LevelCapSlotKind, type, fitted);
    },
  );

  handleAuthorized(LEVEL_CAP_MODULAR_ITEMS, assertMainRendererSender, (_e, kind: unknown) => {
    if (typeof kind !== "string" || !SLOT_KINDS.has(kind as LevelCapSlotKind)) return [];
    return ownedModularItems(ctx.currentInventoryData, kind as LevelCapSlotKind);
  });

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
    if (result.imported) void readScreenshots();
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

  handleAuthorized(LEVEL_CAP_THUMBNAIL, assertMainRendererSender, async (_e, id: unknown) => {
    const runId = asRunId(id);
    const file = store.getRuns().find((run) => run.id === runId)?.screenshot;
    if (!file) return null;
    const image = await loadScreenshotImage(file);
    if (!image) return null;
    const { width } = image.getSize();
    return (width > THUMBNAIL_WIDTH ? image.resize({ width: THUMBNAIL_WIDTH }) : image).toDataURL();
  });

  // The whole picture for the in-app viewer; the file's own bytes, so nothing is re-encoded.
  handleAuthorized(LEVEL_CAP_SCREENSHOT, assertMainRendererSender, (_e, id: unknown) => {
    const runId = asRunId(id);
    const file = store.getRuns().find((run) => run.id === runId)?.screenshot;
    if (!file) return null;
    const mime = SCREENSHOT_MIME[path.extname(file).toLowerCase()];
    if (!mime) return null;
    try {
      return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
    } catch {
      return null;
    }
  });

  // The squad list's corner, at full size, so a person can read the names off it.
  handleAuthorized(LEVEL_CAP_SQUAD_CROP, assertMainRendererSender, async (_e, id: unknown) => {
    const runId = asRunId(id);
    const file = store.getRuns().find((run) => run.id === runId)?.screenshot;
    if (!file) return null;
    const image = await loadScreenshotImage(file);
    if (!image) return null;
    const { width, height } = image.getSize();
    const scale = height / 1080;
    const x = Math.max(0, Math.round(width - SQUAD_CROP.width * scale));
    const y = Math.round(height * SQUAD_CROP.top);
    return image
      .crop({ x, y, width: width - x, height: Math.round(height * SQUAD_CROP.bottom) - y })
      .toDataURL();
  });

  handleAuthorized(
    LEVEL_CAP_FIX_SQUADMATE,
    assertMainRendererSender,
    (_e, id: unknown, slot: unknown, fix: unknown) => {
      const runId = asRunId(id);
      if (runId && Number.isInteger(slot) && (fix === null || isSquadFixPatch(fix))) {
        store.fixSquadmate(runId, slot as number, fix);
      }
      return payload();
    },
  );

  handleAuthorized(
    LEVEL_CAP_PORTRAIT_THUMB,
    assertMainRendererSender,
    (_e, id: unknown, slot: unknown) => {
      const runId = asRunId(id);
      const png =
        runId && Number.isInteger(slot) ? store.portraitThumb(runId, slot as number) : null;
      return png ? `data:image/png;base64,${png.toString("base64")}` : null;
    },
  );

  handleAuthorized(
    LEVEL_CAP_LABEL_PORTRAIT,
    assertMainRendererSender,
    (_e, portrait: unknown, frame: unknown) => {
      if (typeof portrait === "string" && typeof frame === "string") {
        store.labelPortrait(portrait, frame);
      }
      return payload();
    },
  );

  handleAuthorized(LEVEL_CAP_OPEN_SCREENSHOT, assertMainRendererSender, (_e, id: unknown) => {
    const runId = asRunId(id);
    const file = store.getRuns().find((run) => run.id === runId)?.screenshot;
    if (!file) return { ok: false };
    void shell.openPath(path.resolve(file));
    return { ok: true };
  });

  handleAuthorized(LEVEL_CAP_UNDERFRAME_PREWARM, assertMainRendererSender, () => {
    prewarmUnderframe();
    return { ok: true };
  });

  handleAuthorized(
    LEVEL_CAP_UNDERFRAME_DPS,
    assertMainRendererSender,
    async (_e, frame: unknown, companion: unknown, weapon: unknown, fallbackUrl: unknown) => {
      const weaponBuild = sanitizeUnderframeBuild(weapon);
      const frameBuild = sanitizeUnderframeBuild(frame);
      const companionBuild = sanitizeUnderframeBuild(companion);
      if (
        !weaponBuild ||
        !UNDERFRAME_WEAPON_TYPES.includes(weaponBuild.type) ||
        typeof fallbackUrl !== "string" ||
        !fallbackUrl.startsWith(UNDERFRAME_SHARE_BASE) ||
        fallbackUrl.length > 16_000
      ) {
        return { ok: false, withFrame: false };
      }
      const partnerFrame = frameBuild?.type === "Warframe" ? frameBuild : null;
      const partnerCompanion =
        companionBuild?.type === "Sentinel" || companionBuild?.type === "Beast"
          ? companionBuild
          : null;
      const opened =
        (partnerFrame || partnerCompanion) &&
        (await openUnderframeDpsWindow(partnerFrame, partnerCompanion, weaponBuild));
      if (!opened) void shell.openExternal(fallbackUrl);
      return { ok: true, withFrame: !!opened };
    },
  );
}

export { register };
