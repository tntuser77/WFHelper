import { withScope } from "./logger";
import { normalizeErrorMessage } from "../config/shared/errors";
import {
  UNDERFRAME_ORIGIN,
  UNDERFRAME_SHARE_BASE,
  type UnderframeBuild,
} from "../config/shared/underframe";

const log = withScope("underframeDps");

// Underframe only works a frame's or companion's buffs into a weapon when they
// are linked as partner builds. So a hidden window loads the site, links them
// as its partner dialog does, and takes the share link. Any failure falls back
// to the weapon's own link. Nothing is saved on their server.

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
  // rest add to it, or the companion's bond buffs would wipe the frame's. Never
  // ask their server for short partner links when sharing.
  let overwrites = 0;
  window.confirm = (m) => {
    const text = String(m);
    if (text.startsWith("Would you like to include partnered")) return false;
    if (text.startsWith("Overwrite existing external buffs")) return overwrites++ === 0;
    return true;
  };
  window.alert = () => {};
  window.prompt = () => null;

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

  const field = document.getElementById("share-link-text");
  if (!field) throw new Error("missing #share-link-text");
  field.value = "";
  click("share-build-btn");
  await until(() => field.value.startsWith(location.origin + "/share#"), "the share link");
  return { link: field.value, buffs };
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
  const { BrowserWindow } = require("electron") as typeof import("electron");
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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

async function runInHiddenPage(
  frame: UnderframeBuild | null,
  companion: UnderframeBuild | null,
  weapon: UnderframeBuild,
): Promise<{ link: string; buffs: number }> {
  const page = warm && !warm.win.isDestroyed() ? warm : loadPage();
  warm = null;
  clearTimeout(page.idle);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      page.ready.then(() =>
        page.win.webContents.executeJavaScript(
          `${PAGE_SCRIPT}(${[frame, companion, weapon].map((b) => JSON.stringify(b)).join(", ")})`,
          true,
        ) as Promise<{ link: string; buffs: number }>,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    discard(page);
  }
}

let running: Promise<string | null> | null = null;

/** A share link for `weapon` with the buffs of `frame` and `companion` (its bond
 *  mods) worked in, or null when the page could not make one. One run at a time;
 *  a second click joins the first. */
export function underframeDpsLink(
  frame: UnderframeBuild | null,
  companion: UnderframeBuild | null,
  weapon: UnderframeBuild,
): Promise<string | null> {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    try {
      const { link, buffs } = await runInHiddenPage(frame, companion, weapon);
      if (!link.startsWith(UNDERFRAME_SHARE_BASE)) throw new Error("unexpected share link");
      log.info(
        `[Underframe] ${weapon.itemName} linked in ${Date.now() - started}ms, ${buffs} partner buffs`,
      );
      return link;
    } catch (err) {
      log.warn("[Underframe] partner link failed:", normalizeErrorMessage(err));
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}
