import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultMacroSettings, effectiveMexianTimes } from "../../config/shared/macros";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-macros-"));

vi.mock("electron", () => ({
  app: { getPath: () => tempDir },
  shell: { openPath: vi.fn(async () => ""), showItemInFolder: vi.fn() },
}));

vi.mock("../../services/win32Process", () => ({
  enumProcessNames: () => [],
  queryCommandLine: () => ({ status: "unreadable" }),
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

type AhkMacros = typeof import("../../services/ahkMacros");

async function load(): Promise<AhkMacros> {
  vi.resetModules();
  return import("../../services/ahkMacros");
}

// The file the wfm web app (Python configparser) writes today.
const WFM_TIMINGS = [
  "[Settings]",
  "active = Obex",
  "",
  "[Ceramic Dagger]",
  "swap = 0",
  "unblock = 40",
  "jump = 70",
  "roll = 170",
  "",
  "[Default]",
  "swap = 0",
  "unblock = 40",
  "jump = 70",
  "roll = 170",
  "",
  "[Obex]",
  "swap = 5",
  "unblock = 45",
  "jump = 90",
  "roll = 210",
  "",
].join("\n");

beforeEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
});

describe("ahk macro ini files", () => {
  it("reads the wfm timings file with no settings file yet", async () => {
    const { settingsFromIni } = await load();
    const settings = settingsFromIni("", WFM_TIMINGS);

    expect(settings.mexian.active).toBe("Obex");
    expect(settings.mexian.profiles.map((p) => p.name)).toEqual([
      "Ceramic Dagger",
      "Default",
      "Obex",
    ]);
    expect(settings.mexian.profiles[2]).toEqual({
      name: "Obex",
      swap: 5,
      unblock: 45,
      jump: 90,
      roll: 210,
    });
    expect(settings.keys).toEqual(defaultMacroSettings().keys);
    expect(settings.wheelCombo).toEqual(defaultMacroSettings().wheelCombo);
  });

  it("round-trips everything through the two files", async () => {
    const { settingsFromIni, settingsIniText, mexianIniText } = await load();
    const settings = defaultMacroSettings();
    settings.keys.roll = "Shift";
    settings.holdMs = 30;
    settings.mexian.enabled = false;
    settings.mexian.cooldownMs = 650;
    settings.mexian.profiles.push({ name: "Obex", swap: 0, unblock: 40, jump: 80, roll: 200 });
    settings.mexian.active = "Obex";
    settings.wheelCombo.steps = [
      { key: ":", wait: 30 },
      { key: "1", wait: 0 },
    ];

    const back = settingsFromIni(settingsIniText(settings, "C:\\x.ini"), mexianIniText(settings));
    expect(back).toEqual(settings);
  });

  it("writes the timings file the way configparser does", async () => {
    const { mexianIniText, settingsFromIni } = await load();
    expect(mexianIniText(settingsFromIni("", WFM_TIMINGS)).replaceAll("\r\n", "\n")).toBe(
      `${WFM_TIMINGS}\n`,
    );
  });

  it("falls back per field on a hand-edited settings file", async () => {
    const { settingsFromIni } = await load();
    const settings = settingsFromIni(
      [
        "[keys]",
        "Melee = q",
        "Jump = {Space}",
        "[Timing]",
        "Hold=abc",
        "Frame=9999",
        "[Mexian]",
        "Enabled=0",
        "[WheelCombo]",
        "Steps=e:80|bad key:10|[:9000",
      ].join("\r\n"),
      "[Settings]\nactive = Missing\n[settings2]\nroll = -5\n",
    );

    expect(settings.keys.melee).toBe("q");
    expect(settings.keys.jump).toBe("Space");
    expect(settings.holdMs).toBe(25);
    expect(settings.frameMs).toBe(200);
    expect(settings.mexian.enabled).toBe(false);
    expect(settings.wheelCombo.enabled).toBe(true);
    expect(settings.wheelCombo.steps).toEqual([
      { key: "e", wait: 80 },
      { key: "[", wait: 1000 },
    ]);
    expect(settings.mexian.active).toBe("settings2");
    expect(settings.mexian.profiles[0].roll).toBe(0);
  });
});

describe("ahk macro saving", () => {
  it("writes both files and reads them back", async () => {
    const macros = await load();
    const settings = defaultMacroSettings();
    settings.wheelCombo.enabled = false;
    settings.mexian.profiles = [
      { name: "  [Obex]  ", swap: 0, unblock: 40, jump: 70, roll: 170 },
      { name: "obex", swap: 1, unblock: 1, jump: 1, roll: 1 },
      { name: "Settings", swap: 1, unblock: 1, jump: 1, roll: 1 },
    ];
    settings.mexian.active = "OBEX";

    const payload = macros.saveMacroSettings(settings);
    expect(payload.settings.mexian.profiles.map((p) => p.name)).toEqual(["Obex"]);
    expect(payload.settings.mexian.active).toBe("Obex");
    expect(payload.settings.wheelCombo.enabled).toBe(false);
    expect(payload.status).toEqual({ scriptFound: false, running: false, pid: null });

    const settingsIni = path.join(tempDir, "AutoHotkey", "warframe_macros.ini");
    expect(payload.paths.settingsIni).toBe(settingsIni);
    expect(fs.readFileSync(settingsIni, "utf-8")).toContain("[WheelCombo]\r\nEnabled=0");
    expect(fs.readFileSync(path.join(tempDir, "wfm", "mexian_timings.ini"), "utf-8")).toContain(
      "active = Obex",
    );
  });

  it("only accepts absolute .ahk and .ini paths", async () => {
    const macros = await load();
    const script = path.join(tempDir, "Other", "Macros.ahk");
    const timings = path.join(tempDir, "timings.ini");

    expect(macros.setMacroPaths({ script: "relative.ahk" }).paths.script).not.toBe("relative.ahk");
    expect(macros.setMacroPaths({ script: path.join(tempDir, "x.exe") }).paths.script).toBe(
      path.join(tempDir, "AutoHotkey", "Warframe Macros.ahk"),
    );

    let payload = macros.setMacroPaths({ script: `"${script}"` });
    expect(payload.paths.script).toBe(script);
    expect(payload.paths.settingsIni).toBe(path.join(tempDir, "Other", "warframe_macros.ini"));

    payload = macros.setMacroPaths({ mexianIni: timings });
    expect(payload.paths.mexianIni).toBe(timings);
    expect(fs.existsSync(timings)).toBe(true);
    expect(fs.readFileSync(payload.paths.settingsIni, "utf-8")).toContain(`Mexian=${timings}`);
  });
});

describe("effectiveMexianTimes", () => {
  it("pushes steps apart by the frame gap like the script does", () => {
    expect(effectiveMexianTimes({ swap: 0, unblock: 0, jump: 5, roll: 10 }, 17)).toEqual({
      swap: 0,
      unblock: 17,
      jump: 34,
      roll: 51,
    });
  });
});
