import { get, writable } from "svelte/store";
import { invoke } from "../lib/ipc.js";
import { readStorage, writeStorage } from "../lib/persistence.js";
import type { MessageKey } from "../lib/i18n.js";
import { VIEW_NAMES, type ViewName } from "../types/views.js";

// The v2 key reruns setup after the 0.2.0 overhaul. Bump only when a future
// overhaul must rerun it again.
export const SETUP_COMPLETED_KEY = "setup-completed-v2";

function getInitialView(): ViewName {
  return readStorage(SETUP_COMPLETED_KEY) === "1" ? "inventory" : "setup";
}

export const currentView = writable<ViewName>(getInitialView());

const LAST_VIEW_KEY = "dev-last-view";

/**
 * Unpackaged builds reopen on the last view, so a dev reload lands back where
 * you were. Returns the unsubscribe for the recorder.
 */
export function rememberLastViewInDev(): () => void {
  const saved = readStorage(LAST_VIEW_KEY);
  invoke("getAppRuntimeInfo")
    .then((info) => {
      if (info.isPackaged || !saved || !(VIEW_NAMES as readonly string[]).includes(saved)) return;
      // Only replace the launch default; setup redirects and early clicks win.
      if (get(currentView) === "inventory") currentView.set(saved as ViewName);
    })
    .catch(() => {});
  return currentView.subscribe((view) => {
    if (view !== "setup") writeStorage(LAST_VIEW_KEY, view);
  });
}

type StatusMessage = {
  key: MessageKey;
  params?: Record<string, string | number>;
};

export const statusText = writable<StatusMessage | null>({ key: "app.noInventoryLoaded" });
