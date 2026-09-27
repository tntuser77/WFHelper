/** Isolate Koffi because hook teardown can crash its host process. */

import koffi from "koffi";

import { isWarframeExePath, queryExePath } from "./win32Process";

interface WatchEntry {
  id: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  win: boolean;
  vk: number;
  passthrough: boolean;
}

const kernel32 = koffi.load("kernel32.dll");
const user32 = koffi.load("user32.dll");
const { parentPort } = process;

// Win32 BOOL is 4 bytes; koffi "bool" is 1 and leaks garbage - always int32.
const GetModuleHandleW = kernel32.func("GetModuleHandleW", "void *", ["void *"]);
const GetLastError = kernel32.func("GetLastError", "uint32", []);

const SetWindowsHookExW = user32.func("SetWindowsHookExW", "void *", [
  "int", // idHook
  "void *", // lpfn  (HOOKPROC pointer from koffi.register)
  "void *", // hmod
  "uint32", // dwThreadId - 0 = all threads (global LL hook)
]);
const UnhookWindowsHookEx = user32.func("UnhookWindowsHookEx", "int32", ["void *"]);
const CallNextHookEx = user32.func("CallNextHookEx", "intptr_t", [
  "void *", // hhk (ignored; may be NULL)
  "int", // nCode
  "uintptr_t", // wParam
  "void *", // lParam
]);
const GetForegroundWindow = user32.func("GetForegroundWindow", "void *", []);
const GetWindowThreadProcessId = user32.func("GetWindowThreadProcessId", "uint32", [
  "void *", // hWnd
  "void *", // lpdwProcessId (out)
]);
const GetAsyncKeyState = user32.func("GetAsyncKeyState", "int16", ["int"]);
const PeekMessageW = user32.func("PeekMessageW", "int32", [
  "void *", // lpMsg
  "void *", // hWnd
  "uint32", // wMsgFilterMin
  "uint32", // wMsgFilterMax
  "uint32", // wRemoveMsg
]);
const KBDLLHOOKSTRUCT = koffi.struct("KBDLLHOOKSTRUCT", {
  vkCode: "uint32",
  scanCode: "uint32",
  flags: "uint32",
  time: "uint32",
  dwExtraInfo: "uintptr_t",
});
const LowLevelKeyboardProc = koffi.proto(
  "intptr_t LowLevelKeyboardProc(int nCode, uintptr_t wParam, void *lParam)",
);

const WH_KEYBOARD_LL = 13;
const HC_ACTION = 0;
const WM_KEYDOWN = 0x0100;
const WM_SYSKEYDOWN = 0x0104;
const PM_REMOVE = 0x0001;
const PUMP_TICK_MS = 10;
const MSG_SIZE = 48; // sizeof(MSG) on x64
const KEY_DOWN_BIT = 0x8000;

const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12; // Alt
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;

const _pidBuf = Buffer.alloc(4);
const _pidIsWarframe = new Map<number, boolean>();
const PID_CACHE_RESET_MS = 5000;

function isWarframePid(pid: number): boolean {
  const cached = _pidIsWarframe.get(pid);
  if (cached !== undefined) return cached;

  const query = queryExePath(pid);
  if (query.status === "unreachable") return false; // process gone; don't cache

  const result = query.status === "ok" && isWarframeExePath(query.path);
  _pidIsWarframe.set(pid, result);
  return result;
}

function foregroundIsWarframe(): boolean {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return false;
  _pidBuf.fill(0);
  GetWindowThreadProcessId(hwnd, _pidBuf);
  const pid = _pidBuf.readUInt32LE(0);
  if (!pid) return false;
  return isWarframePid(pid);
}

let watchList: WatchEntry[] = [];
let watchedVks = new Set(watchList.map((entry) => entry.vk));

function normalizeWatch(value: unknown): WatchEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is WatchEntry => !!v && typeof v.id === "string" && typeof v.vk === "number")
    .map((v) => ({
      id: v.id,
      ctrl: !!v.ctrl,
      alt: !!v.alt,
      shift: !!v.shift,
      win: !!v.win,
      vk: v.vk,
      passthrough: !!v.passthrough,
    }));
}

function setWatch(value: unknown): void {
  watchList = normalizeWatch(value);
  watchedVks = new Set(watchList.map((entry) => entry.vk));
}

function down(vk: number): boolean {
  return (GetAsyncKeyState(vk) & KEY_DOWN_BIT) !== 0;
}

function matchBinding(vk: number): WatchEntry | null {
  if (!watchedVks.has(vk)) return null;
  const ctrl = down(VK_CONTROL);
  const alt = down(VK_MENU);
  const shift = down(VK_SHIFT);
  const win = down(VK_LWIN) || down(VK_RWIN);
  for (const entry of watchList) {
    if (
      entry.vk === vk &&
      entry.ctrl === ctrl &&
      entry.alt === alt &&
      entry.shift === shift &&
      entry.win === win
    ) {
      return entry;
    }
  }
  return null;
}

const hookProc = koffi.register((nCode: number, wParam: number, lParam: unknown): number => {
  try {
    if (nCode === HC_ACTION) {
      const message = Number(wParam);
      if (message === WM_KEYDOWN || message === WM_SYSKEYDOWN) {
        const info = koffi.decode(lParam, KBDLLHOOKSTRUCT) as { vkCode: number };
        const match = matchBinding(info.vkCode);
        if (match && foregroundIsWarframe()) {
          parentPort.postMessage({ type: "hotkey", id: match.id });
          // swallow: the game (and only the game) loses this key, unless the
          // binding asked to share it (e.g. F12 still reaching Steam)
          if (!match.passthrough) return 1;
        }
      }
    }
  } catch {
    // A throwing hook would be silently unhooked by Windows - never let it.
  }
  return CallNextHookEx(null, nCode, wParam as unknown as number, lParam) as number;
}, koffi.pointer(LowLevelKeyboardProc));

const _msgBuf = Buffer.alloc(MSG_SIZE);

parentPort.on("message", (event) => {
  const message = event.data as { type?: string; watch?: unknown };
  if (message?.type === "setWatch") {
    setWatch(message.watch);
    parentPort.postMessage({ type: "watch-updated", count: watchList.length });
  }
});

function run(): void {
  const hHook = SetWindowsHookExW(WH_KEYBOARD_LL, hookProc, GetModuleHandleW(null), 0);
  if (!hHook) {
    parentPort.postMessage({
      type: "error",
      message: `SetWindowsHookExW failed (GLE=${GetLastError()})`,
    });
    koffi.unregister(hookProc);
    return;
  }

  parentPort.postMessage({ type: "ready" });

  let pidCacheResetAt = Date.now() + PID_CACHE_RESET_MS;
  let stopped = false;

  function stop(message?: string): void {
    if (stopped) return;
    stopped = true;
    if (message) parentPort.postMessage({ type: "error", message });
    try {
      UnhookWindowsHookEx(hHook);
    } finally {
      koffi.unregister(hookProc);
    }
  }

  function pump(): void {
    try {
      // LL hooks need frequent message pumping.
      while ((PeekMessageW(_msgBuf, null, 0, 0, PM_REMOVE) as number) !== 0) {
        /* discard */
      }

      const now = Date.now();
      if (now > pidCacheResetAt) {
        pidCacheResetAt = now + PID_CACHE_RESET_MS;
        _pidIsWarframe.clear();
      }
    } catch (err) {
      stop(`keyboard hook pump failed: ${String(err)}`);
      return;
    }

    setTimeout(pump, PUMP_TICK_MS);
  }

  pump();
}

run();
