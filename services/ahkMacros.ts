import fs from "node:fs";
import path from "node:path";

import { app, shell } from "electron";

import {
  MEXIAN_TIMINGS,
  normalizeMacroSettings,
  type ComboStep,
  type MacroPaths,
  type MacroScriptAction,
  type MacroSettings,
  type MacroStatus,
  type MacrosPayload,
} from "../config/shared/macros";
import { writeFileAtomicSync } from "./atomicFile";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";
import { enumProcessNames, queryCommandLine } from "./win32Process";

const log = withScope("ahkMacros");

/** Written next to the script; the script looks for it in A_ScriptDir. */
const SETTINGS_INI_NAME = "warframe_macros.ini";
const CONFIG_FILE = "macros.json";

interface IniSection {
  name: string;
  values: Map<string, string>;
}

/** Windows ini rules as GetPrivateProfileString reads them: sections and keys
 * ignore case, the first copy of a section wins, whole-line comments only. */
export function parseIni(text: string): IniSection[] {
  const sections: IniSection[] = [];
  let current: IniSection | null = null;
  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const header = /^\[(.*)\]$/.exec(line);
    if (header) {
      const name = header[1].trim();
      current = sections.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;
      if (!current) {
        current = { name, values: new Map() };
        sections.push(current);
      }
      continue;
    }
    const eq = line.indexOf("=");
    if (!current || eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    if (!current.values.has(key)) current.values.set(key, line.slice(eq + 1).trim());
  }
  return sections;
}

function section(sections: IniSection[], name: string): Map<string, string> {
  return sections.find((s) => s.name.toLowerCase() === name.toLowerCase())?.values ?? new Map();
}

function flag(value: string | undefined): boolean | undefined {
  return value === undefined ? undefined : value.trim() !== "0";
}

/** "key:wait|key:wait", split on the last colon so ":" still works as a key. */
function parseSteps(raw: string | undefined): ComboStep[] | undefined {
  if (!raw) return undefined;
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.lastIndexOf(":");
      return colon > 0
        ? { key: part.slice(0, colon).trim(), wait: Number(part.slice(colon + 1)) }
        : { key: part, wait: 0 };
    });
}

export function settingsFromIni(settingsText: string, mexianText: string): MacroSettings {
  const ini = parseIni(settingsText);
  const keys = section(ini, "Keys");
  const timing = section(ini, "Timing");
  const mexian = section(ini, "Mexian");
  const combo = section(ini, "WheelCombo");

  const mex = parseIni(mexianText);
  const profiles = mex
    .filter((s) => s.name.toLowerCase() !== "settings")
    .map((s) => ({
      name: s.name,
      ...Object.fromEntries(MEXIAN_TIMINGS.map((field) => [field, s.values.get(field)])),
    }));

  return normalizeMacroSettings({
    keys: {
      melee: keys.get("melee"),
      swap: keys.get("swap"),
      jump: keys.get("jump"),
      roll: keys.get("roll"),
      block: keys.get("block"),
    },
    holdMs: timing.get("hold"),
    frameMs: timing.get("frame"),
    mexian: {
      enabled: flag(mexian.get("enabled")),
      cooldownMs: mexian.get("cooldown"),
      active: section(mex, "Settings").get("active"),
      profiles,
    },
    wheelCombo: {
      enabled: flag(combo.get("enabled")),
      cooldownMs: combo.get("cooldown"),
      steps: parseSteps(combo.get("steps")),
    },
  });
}

export function settingsIniText(settings: MacroSettings, mexianIni: string): string {
  const { keys, mexian, wheelCombo } = settings;
  return [
    "; Warframe Macros settings, written by WFHelper's Macros tab.",
    "; Warframe Macros.ahk re-reads this file every half second.",
    "",
    "[Files]",
    `Mexian=${mexianIni}`,
    "",
    "[Keys]",
    `Melee=${keys.melee}`,
    `Swap=${keys.swap}`,
    `Jump=${keys.jump}`,
    `Roll=${keys.roll}`,
    `Block=${keys.block}`,
    "",
    "[Timing]",
    `Hold=${settings.holdMs}`,
    `Frame=${settings.frameMs}`,
    "",
    "[Mexian]",
    `Enabled=${mexian.enabled ? 1 : 0}`,
    `Cooldown=${mexian.cooldownMs}`,
    "",
    "[WheelCombo]",
    `Enabled=${wheelCombo.enabled ? 1 : 0}`,
    `Cooldown=${wheelCombo.cooldownMs}`,
    `Steps=${wheelCombo.steps.map((s) => `${s.key}:${s.wait}`).join("|")}`,
    "",
  ].join("\r\n");
}

/** Same layout Python's configparser writes, so the wfm web app reads it back. */
export function mexianIniText(settings: MacroSettings): string {
  const lines = ["[Settings]", `active = ${settings.mexian.active}`, ""];
  for (const profile of settings.mexian.profiles) {
    lines.push(`[${profile.name}]`);
    for (const field of MEXIAN_TIMINGS) lines.push(`${field} = ${profile[field]}`);
    lines.push("");
  }
  return lines.join("\r\n") + "\r\n";
}

interface MacroConfig {
  script: string;
}

function defaultScriptPath(): string {
  return path.join(app.getPath("documents"), "AutoHotkey", "Warframe Macros.ahk");
}

function defaultMexianIni(): string {
  return path.join(app.getPath("documents"), "wfm", "mexian_timings.ini");
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

function loadConfig(): MacroConfig {
  try {
    const parsed = JSON.parse(readText(userDataPath(CONFIG_FILE))) as Partial<MacroConfig>;
    if (typeof parsed.script === "string" && parsed.script) return { script: parsed.script };
  } catch {
    // no config yet
  }
  return { script: defaultScriptPath() };
}

function resolvePaths(): MacroPaths {
  const script = loadConfig().script;
  const settingsIni = path.join(path.dirname(script), SETTINGS_INI_NAME);
  const fromIni = section(parseIni(readText(settingsIni)), "Files").get("mexian");
  return { script, settingsIni, mexianIni: fromIni || defaultMexianIni() };
}

function isAhkExe(name: string): boolean {
  return /^autohotkey.*\.exe$/i.test(name);
}

function findScriptPid(script: string): number | null {
  if (process.platform !== "win32") return null;
  const needle = path.resolve(script).toLowerCase();
  for (const proc of enumProcessNames() ?? []) {
    if (!isAhkExe(proc.name)) continue;
    const cmd = queryCommandLine(proc.pid);
    if (cmd.status !== "ok") continue;
    if (cmd.commandLine.replace(/\//g, "\\").toLowerCase().includes(needle)) return proc.pid;
  }
  return null;
}

export function getMacroStatus(): MacroStatus {
  const { script } = resolvePaths();
  const pid = findScriptPid(script);
  return { scriptFound: fs.existsSync(script), running: pid !== null, pid };
}

export function getMacros(): MacrosPayload {
  const paths = resolvePaths();
  return {
    settings: settingsFromIni(readText(paths.settingsIni), readText(paths.mexianIni)),
    paths,
    status: getMacroStatus(),
  };
}

function writeIni(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomicSync(file, text);
}

function writeAll(settings: MacroSettings, paths: MacroPaths): void {
  writeIni(paths.settingsIni, settingsIniText(settings, paths.mexianIni));
  writeIni(paths.mexianIni, mexianIniText(settings));
}

export function saveMacroSettings(raw: unknown): MacrosPayload {
  writeAll(normalizeMacroSettings(raw), resolvePaths());
  return getMacros();
}

function validPath(raw: unknown, ext: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^"(.*)"$/, "$1");
  return path.isAbsolute(trimmed) && path.extname(trimmed).toLowerCase() === ext
    ? path.normalize(trimmed)
    : null;
}

/** Points WFHelper at a different script or timings file. The timings path is
 * stored in the script's own ini, so the script follows the change too. */
export function setMacroPaths(patch: { script?: unknown; mexianIni?: unknown }): MacrosPayload {
  if (patch.script !== undefined) {
    const script = validPath(patch.script, ".ahk");
    if (script) writeFileAtomicSync(userDataPath(CONFIG_FILE), JSON.stringify({ script }));
  }
  if (patch.mexianIni !== undefined) {
    const mexianIni = validPath(patch.mexianIni, ".ini");
    if (mexianIni) {
      const { settingsIni } = resolvePaths();
      // Everything but the profiles stays; those come from the new file.
      const next = settingsFromIni(readText(settingsIni), readText(mexianIni));
      writeIni(settingsIni, settingsIniText(next, mexianIni));
      if (!fs.existsSync(mexianIni)) writeIni(mexianIni, mexianIniText(next));
    }
  }
  return getMacros();
}

export async function runMacroScriptAction(action: MacroScriptAction): Promise<MacrosPayload> {
  const { script } = resolvePaths();
  if (action === "folder") {
    shell.showItemInFolder(script);
  } else if (action === "stop") {
    const pid = findScriptPid(script);
    if (pid !== null) {
      try {
        process.kill(pid);
      } catch (err) {
        log.warn(`stop failed: ${String(err)}`);
      }
    }
  } else if (fs.existsSync(script)) {
    // Through the file association, so AutoHotkey's launcher picks the v2
    // interpreter. #SingleInstance Force turns a second start into a restart.
    const error = await shell.openPath(script);
    if (error) log.warn(`start failed: ${error}`);
  }
  return getMacros();
}
