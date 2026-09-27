import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow } from "electron";

import { normalizePathForCompare } from "../config/shared/pathCompare";
import { withScope } from "./logger";

const log = withScope("devRendererReload");

// vite build --watch writes several files per rebuild; wait for it to settle.
const SETTLE_MS = 400;

function isMainRendererWindow(win: BrowserWindow, entryFile: string): boolean {
  try {
    const url = new URL(win.webContents.getURL());
    if (url.protocol !== "file:") return false;
    return normalizePathForCompare(fileURLToPath(url)) === normalizePathForCompare(entryFile);
  } catch {
    return false;
  }
}

/**
 * Unpackaged builds only: reloads the main window and popouts in place when the
 * renderer bundle is rebuilt, so `pnpm dev` does not restart Electron per save.
 * The watch sits on renderer/ because the build may empty and recreate dist/.
 */
export function watchRendererBuild(entryFile: string): void {
  if (app.isPackaged) return;
  const rendererDir = path.dirname(path.dirname(entryFile));
  let timer: NodeJS.Timeout | null = null;

  const reload = (): void => {
    timer = null;
    if (!fs.existsSync(entryFile)) return;
    const windows = BrowserWindow.getAllWindows().filter(
      (win) => !win.isDestroyed() && isMainRendererWindow(win, entryFile),
    );
    log.info(`[DevReload] renderer rebuilt, reloading ${windows.length} window(s)`);
    for (const win of windows) win.webContents.reloadIgnoringCache();
  };

  try {
    fs.watch(rendererDir, { recursive: true }, (_event, file) => {
      if (!file || !normalizePathForCompare(String(file)).startsWith("dist/")) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, SETTLE_MS);
    });
  } catch (err) {
    log.warn("[DevReload] could not watch the renderer build:", err);
  }
}
