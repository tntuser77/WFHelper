import { assertMainRendererSender, handleAuthorized } from "./ipcSecurity";
import {
  MACROS_GET,
  MACROS_SAVE,
  MACROS_SCRIPT,
  MACROS_SET_PATHS,
  MACROS_STATUS,
} from "../config/shared/ipcChannels";
import type { MacroScriptAction } from "../config/shared/macros";
import {
  getMacroStatus,
  getMacros,
  runMacroScriptAction,
  saveMacroSettings,
  setMacroPaths,
} from "../services/ahkMacros";

const SCRIPT_ACTIONS = new Set<MacroScriptAction>(["start", "stop", "folder"]);

export function register(): void {
  if (process.platform !== "win32") return;
  handleAuthorized(MACROS_GET, assertMainRendererSender, () => getMacros());
  handleAuthorized(MACROS_STATUS, assertMainRendererSender, () => getMacroStatus());
  handleAuthorized(MACROS_SAVE, assertMainRendererSender, (_event, raw: unknown) =>
    saveMacroSettings(raw),
  );
  handleAuthorized(MACROS_SET_PATHS, assertMainRendererSender, (_event, raw: unknown) => {
    const patch = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return setMacroPaths({ script: patch.script, mexianIni: patch.mexianIni });
  });
  handleAuthorized(MACROS_SCRIPT, assertMainRendererSender, (_event, action: unknown) => {
    if (!SCRIPT_ACTIONS.has(action as MacroScriptAction)) throw new Error("bad macro action");
    return runMacroScriptAction(action as MacroScriptAction);
  });
}
