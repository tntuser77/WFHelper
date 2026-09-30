/** Settings for the AutoHotkey "Warframe Macros" script. Main writes them to the
 * script's ini files; the script re-reads them every half second. */

interface MacroKeys {
  melee: string;
  swap: string;
  jump: string;
  roll: string;
  block: string;
}

/** Every timing is ms after the melee press. */
interface MexianProfile {
  name: string;
  swap: number;
  unblock: number;
  jump: number;
  roll: number;
}

/** One key tap, then a pause before the next one. The last step's wait is unused. */
export interface ComboStep {
  key: string;
  wait: number;
}

export interface MacroSettings {
  keys: MacroKeys;
  /** How long each Mexian tap is held down. */
  holdMs: number;
  /** Minimum gap between Mexian steps the game has to see separately. */
  frameMs: number;
  mexian: {
    enabled: boolean;
    cooldownMs: number;
    active: string;
    profiles: MexianProfile[];
  };
  wheelCombo: {
    enabled: boolean;
    cooldownMs: number;
    steps: ComboStep[];
  };
}

export interface MacroPaths {
  script: string;
  settingsIni: string;
  mexianIni: string;
}

export interface MacroStatus {
  scriptFound: boolean;
  running: boolean;
  pid: number | null;
}

export interface MacrosPayload {
  settings: MacroSettings;
  paths: MacroPaths;
  status: MacroStatus;
}

export type MacroScriptAction = "start" | "stop" | "folder";

export const MEXIAN_TIMINGS = ["swap", "unblock", "jump", "roll"] as const;
export type MexianTiming = (typeof MEXIAN_TIMINGS)[number];

export const MACRO_KEY_NAMES = ["melee", "swap", "jump", "roll", "block"] as const;

export const MEXIAN_MAX_MS = 1000;
export const COOLDOWN_MAX_MS = 5000;
export const TAP_MAX_MS = 200;
export const COMBO_MAX_STEPS = 12;
export const PROFILE_NAME_MAX = 40;

export const DEFAULT_MEXIAN_PROFILE: Omit<MexianProfile, "name"> = {
  swap: 0,
  unblock: 40,
  jump: 70,
  roll: 170,
};

export function defaultMacroSettings(): MacroSettings {
  return {
    keys: { melee: "e", swap: "f", jump: "Space", roll: "]", block: "RButton" },
    holdMs: 25,
    frameMs: 17,
    mexian: {
      enabled: true,
      cooldownMs: 500,
      active: "Default",
      profiles: [{ name: "Default", ...DEFAULT_MEXIAN_PROFILE }],
    },
    wheelCombo: {
      enabled: true,
      cooldownMs: 300,
      steps: [
        { key: "e", wait: 80 },
        { key: "[", wait: 50 },
        { key: "[", wait: 0 },
      ],
    },
  };
}

/** AutoHotkey key names (e, Space, RButton, ], F1...). Whitespace, braces and the
 * step separator would break the Send string or the ini line, so they are out. */
function isMacroKey(value: unknown): value is string {
  return typeof value === "string" && /^[^\s{}|]{1,24}$/.test(value);
}

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function keyOr(value: unknown, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : value;
  return isMacroKey(trimmed) ? trimmed : fallback;
}

/** Section names in an ini file: no brackets or line breaks. "Settings" is taken
 * by the active-profile line, and the Windows ini reader ignores case. */
export function cleanProfileName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const name = raw
    .replace(/[[\]\p{Cc}]/gu, "")
    .trim()
    .slice(0, PROFILE_NAME_MAX)
    .trim();
  return name.toLowerCase() === "settings" ? "" : name;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeProfiles(raw: unknown): MexianProfile[] {
  const seen = new Set<string>();
  const out: MexianProfile[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const rec = asRecord(entry);
    const name = cleanProfileName(rec.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const profile = { name, ...DEFAULT_MEXIAN_PROFILE };
    for (const field of MEXIAN_TIMINGS) {
      profile[field] = clampInt(rec[field], 0, MEXIAN_MAX_MS, DEFAULT_MEXIAN_PROFILE[field]);
    }
    out.push(profile);
  }
  return out.length ? out : [{ name: "Default", ...DEFAULT_MEXIAN_PROFILE }];
}

function normalizeSteps(raw: unknown, fallback: ComboStep[]): ComboStep[] {
  if (!Array.isArray(raw)) return fallback;
  const steps: ComboStep[] = [];
  for (const entry of raw.slice(0, COMBO_MAX_STEPS)) {
    const rec = asRecord(entry);
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    if (!isMacroKey(key)) continue;
    steps.push({ key, wait: clampInt(rec.wait, 0, MEXIAN_MAX_MS, 0) });
  }
  return steps.length ? steps : fallback;
}

/** Coerces anything (renderer input, a hand-edited ini) into valid settings,
 * falling back field by field to the defaults. */
export function normalizeMacroSettings(raw: unknown): MacroSettings {
  const def = defaultMacroSettings();
  const rec = asRecord(raw);
  const keys = asRecord(rec.keys);
  const mexian = asRecord(rec.mexian);
  const combo = asRecord(rec.wheelCombo);

  const profiles = normalizeProfiles(mexian.profiles);
  const activeName = typeof mexian.active === "string" ? mexian.active.toLowerCase() : "";
  const active = profiles.find((p) => p.name.toLowerCase() === activeName) ?? profiles[0];

  return {
    keys: {
      melee: keyOr(keys.melee, def.keys.melee),
      swap: keyOr(keys.swap, def.keys.swap),
      jump: keyOr(keys.jump, def.keys.jump),
      roll: keyOr(keys.roll, def.keys.roll),
      block: keyOr(keys.block, def.keys.block),
    },
    holdMs: clampInt(rec.holdMs, 1, TAP_MAX_MS, def.holdMs),
    frameMs: clampInt(rec.frameMs, 1, TAP_MAX_MS, def.frameMs),
    mexian: {
      enabled: typeof mexian.enabled === "boolean" ? mexian.enabled : def.mexian.enabled,
      cooldownMs: clampInt(mexian.cooldownMs, 0, COOLDOWN_MAX_MS, def.mexian.cooldownMs),
      active: active.name,
      profiles,
    },
    wheelCombo: {
      enabled: typeof combo.enabled === "boolean" ? combo.enabled : def.wheelCombo.enabled,
      cooldownMs: clampInt(combo.cooldownMs, 0, COOLDOWN_MAX_MS, def.wheelCombo.cooldownMs),
      steps: normalizeSteps(combo.steps, def.wheelCombo.steps),
    },
  };
}

/** The order the script actually fires the Mexian in, with its minimum gaps
 * applied, so the editor can show what a profile really does. */
export function effectiveMexianTimes(
  profile: Omit<MexianProfile, "name">,
  frameMs: number,
): Record<MexianTiming, number> {
  const unblock = Math.max(frameMs, profile.unblock);
  const jump = Math.max(unblock + frameMs, profile.jump);
  const roll = Math.max(jump + frameMs, profile.roll);
  return { swap: profile.swap, unblock, jump, roll };
}
