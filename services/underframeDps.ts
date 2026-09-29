import { withScope } from "./logger";
import { normalizeErrorMessage } from "../config/shared/errors";
import { UNDERFRAME_ORIGIN, type UnderframeBuild } from "../config/shared/underframe";

const log = withScope("underframeDps");

// Underframe only works a frame's or companion's buffs into a weapon when they
// are linked as partner builds, and only lets you DPS-test a build it has saved.
// So the build opens in a window of our own, on a throwaway in-memory profile,
// with its partners linked. Nothing lands in the user's browser.

const PARTITION = "underframe-dps";
const TIMEOUT_MS = 45_000;
const IDLE_MS = 3 * 60_000;

const PAGE_SCRIPT = String.raw`
(async (frame, companion, weapon) => {
  const A = window.AppState;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, what, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return;
      await sleep(100);
    }
    throw new Error("timed out waiting for " + what);
  };
  // Import each partner's buffs. The first overwrites what the weapon had; the
  // rest add to it, or the companion's bond buffs would wipe the frame's.
  // The stubs are put back at the end so the user's own dialogs still work.
  let overwrites = 0;
  const dialogs = { confirm: window.confirm, alert: window.alert, prompt: window.prompt };
  window.confirm = (m) => {
    const text = String(m);
    if (text.startsWith("Would you like to include partnered")) return false;
    if (text.startsWith("Overwrite existing external buffs")) return overwrites++ === 0;
    return true;
  };
  window.alert = () => {};
  window.prompt = () => null;
  try {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9.%+]+/g, " ").trim();
  const words = (s) => norm(s).replace(/[0-9.%+]+/g, " ").split(/\s+/).filter(Boolean);
  const numbers = (s) => (String(s).match(/[0-9.]+/g) || []).join(" ");
  // One letter off still counts: WFCD writes "Enery Orbs".
  const near = (a, b) => {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };
  // Our shard text is WFCD's; theirs differs in small ways, so take the effect
  // of that colour and tier sharing the most words, then the same numbers.
  const shardEffect = (shard) => {
    const entry = (A.archon_shards || []).find((s) =>
      String(s["Shard Type"] || "").toLowerCase().startsWith(shard.type));
    const list = (entry && entry[shard.isTaufurged ? "Taufurged Effects" : "Base Effects"]) || [];
    const exact = list.find((e) => norm(e) === norm(shard.effect));
    if (exact) return exact;
    const want = words(shard.effect);
    let best = null, score = 0;
    for (const e of list) {
      const have = words(e);
      const shared = want.filter((w) => have.some((h) => near(w, h))).length /
        Math.max(want.length, have.length, 1);
      const total = shared + (numbers(e) === numbers(shard.effect) ? 0.01 : 0);
      if (total > score) { best = e; score = total; }
    }
    return score >= 0.5 ? best : shard.effect;
  };
  const withDefaults = (b) => ({
    arcanes: [], archon_shards: [], helminth: null, partnerBuilds: [],
    externalBuffs: [], externalWeaponBuffs: [], ...b,
  });
  const partners = [];
  if (frame) {
    frame = withDefaults(frame);
    frame.archon_shards = frame.archon_shards.map((s) => ({ ...s, effect: shardEffect(s) }));
    frame.slug = "wfhelper-frame";
    partners.push(frame);
  }
  if (companion) {
    companion = withDefaults(companion);
    companion.slug = "wfhelper-companion";
    partners.push(companion);
  }
  weapon = withDefaults(weapon);
  weapon.slug = "wfhelper-weapon";
  A.builds = (A.builds || []).filter((b) => !String(b.slug || "").startsWith("wfhelper-"));
  A.builds.push(...partners, weapon);
  A.buildSlugMap = new Map();
  history.pushState({}, "", "/" + weapon.slug);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await until(() => A.currentBuildName === weapon.name, "the weapon build");

  const click = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error("missing #" + id);
    el.click();
  };
  let buffs = 0;
  if (partners.length) {
    click("edit-partners-btn");
    const boxes = () => [...document.querySelectorAll("#partner-build-selection-list input")];
    await until(() => partners.every((p) => boxes().some((i) => i.value === p.name)),
      "the partner list");
    for (const box of boxes()) box.checked = partners.some((p) => p.name === box.value);
    click("save-partner-selection-btn");
    const built = () => A.builds.find((b) => b.name === weapon.name);
    await until(() => partners.every((p) => (built()?.partnerBuilds || []).includes(p.name)),
      "the partner links");
    await sleep(300);
    buffs = (built()?.externalBuffs || []).length;
  }

  return { buffs };
  } finally {
    Object.assign(window, dialogs);
  }
})
`;

interface WarmPage {
  win: import("electron").BrowserWindow;
  /** Settles once the page has loaded its data; rejects if it never does. */
  ready: Promise<void>;
  idle: ReturnType<typeof setTimeout>;
}

// The page takes seconds to boot, so one is loaded ahead of the click. A run
// dirties the page (its builds, its route), so each is used once and thrown away.
let warm: WarmPage | null = null;

function discard(page: WarmPage): void {
  clearTimeout(page.idle);
  if (!page.win.isDestroyed()) page.win.destroy();
  if (warm === page) warm = null;
}

function loadPage(): WarmPage {
  const { BrowserWindow, shell } = require("electron") as typeof import("electron");
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (!target.startsWith(`${UNDERFRAME_ORIGIN}/`)) e.preventDefault();
  });
  const page: WarmPage = {
    win,
    idle: setTimeout(() => discard(page), IDLE_MS),
    ready: (async () => {
      // Keep the throwaway page's saved builds from piling up between runs.
      await win.webContents.session.clearStorageData({ storages: ["localstorage", "indexdb"] });
      await win.loadURL(`${UNDERFRAME_ORIGIN}/`);
      const started = Date.now();
      while (
        !(await win.webContents.executeJavaScript(
          `!!(window.AppState && (AppState.mods || []).length > 100 &&
             (AppState.warframes || []).length && document.getElementById("share-build-btn"))`,
          true,
        ))
      ) {
        if (win.isDestroyed() || Date.now() - started > TIMEOUT_MS) {
          throw new Error("page never finished loading its data");
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    })(),
  };
  page.ready.catch(() => discard(page));
  return page;
}

/** Starts loading the Underframe page in the background so the next
 *  `underframeDpsLink` finds it ready. Cheap to call again: it does nothing
 *  while a page is already loading or waiting, and the page is dropped when
 *  unused for a few minutes. */
export function prewarmUnderframe(): void {
  if (warm && !warm.win.isDestroyed()) return;
  warm = loadPage();
}

async function openInWindow(
  frame: UnderframeBuild | null,
  companion: UnderframeBuild | null,
  weapon: UnderframeBuild,
): Promise<number> {
  const page = warm && !warm.win.isDestroyed() ? warm : loadPage();
  warm = null;
  clearTimeout(page.idle);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS);
  });
  try {
    const { buffs } = await Promise.race([
      page.ready.then(() =>
        page.win.webContents.executeJavaScript(
          `${PAGE_SCRIPT}(${[frame, companion, weapon].map((b) => JSON.stringify(b)).join(", ")})`,
          true,
        ) as Promise<{ buffs: number }>,
      ),
      timeout,
    ]);
    page.win.setTitle(`Underframe - ${weapon.itemName}`);
    page.win.show();
    return buffs;
  } catch (err) {
    discard(page);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

let running: Promise<boolean> | null = null;

/** Opens `weapon` in a window of its own with the buffs of `frame` and
 *  `companion` (its bond mods) worked in, ready to DPS-test. False when the page
 *  could not be set up. One run at a time; a second click joins the first. */
export function openUnderframeDpsWindow(
  frame: UnderframeBuild | null,
  companion: UnderframeBuild | null,
  weapon: UnderframeBuild,
): Promise<boolean> {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    try {
      const buffs = await openInWindow(frame, companion, weapon);
      log.info(
        `[Underframe] ${weapon.itemName} opened in ${Date.now() - started}ms, ${buffs} partner buffs`,
      );
      return true;
    } catch (err) {
      log.warn("[Underframe] partner window failed:", normalizeErrorMessage(err));
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}
