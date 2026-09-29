import { withScope } from "./logger";
import { normalizeErrorMessage } from "../config/shared/errors";
import {
  UNDERFRAME_ORIGIN,
  UNDERFRAME_SHARE_BASE,
  type UnderframeBuild,
} from "../config/shared/underframe";

const log = withScope("underframeDps");

// Underframe works a frame's buffs into a weapon only when the frame is linked
// to it as a partner build, with its own maths in its own page. So this loads
// the site in a hidden window, adds both builds, links them the way its partner
// dialog does, and takes the link its share button makes. The weapon's link
// then carries the frame's buffs as plain numbers, and the user's browser opens
// it. Nothing is saved on their server: the share link holds the whole build.
//
// This leans on the page's internals (window.AppState, element ids, confirm
// wording), so any failure falls back to the weapon's own link.

const PARTITION = "underframe-dps";
const TIMEOUT_MS = 45_000;

const PAGE_SCRIPT = String.raw`
(async (frame, weapon) => {
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
  // Import the partner's buffs and overwrite, but never ask their server for
  // short partner links when sharing.
  window.confirm = (m) => !String(m).startsWith("Would you like to include partnered");
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
  if (frame) {
    frame = withDefaults(frame);
    frame.archon_shards = frame.archon_shards.map((s) => ({ ...s, effect: shardEffect(s) }));
    frame.slug = "wfhelper-frame";
  }
  weapon = withDefaults(weapon);
  weapon.slug = "wfhelper-weapon";
  A.builds = (A.builds || []).filter((b) => b.slug !== "wfhelper-frame" && b.slug !== "wfhelper-weapon");
  if (frame) A.builds.push(frame);
  A.builds.push(weapon);
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
  if (frame) {
    click("edit-partners-btn");
    let box = null;
    await until(() => (box = [...document.querySelectorAll("#partner-build-selection-list input")]
      .find((i) => i.value === frame.name)), "the partner list");
    box.checked = true;
    click("save-partner-selection-btn");
    const built = () => A.builds.find((b) => b.name === weapon.name);
    await until(() => (built()?.partnerBuilds || []).includes(frame.name), "the partner link");
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

async function runInHiddenPage(
  frame: UnderframeBuild | null,
  weapon: UnderframeBuild,
): Promise<{ link: string; buffs: number }> {
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
  // Keep the throwaway page's saved builds from piling up between runs.
  await win.webContents.session.clearStorageData({ storages: ["localstorage", "indexdb"] });

  const exec = <T>(code: string): Promise<T> =>
    win.webContents.executeJavaScript(code, true) as Promise<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        await win.loadURL(`${UNDERFRAME_ORIGIN}/`);
        const started = Date.now();
        while (
          !(await exec<boolean>(
            `!!(window.AppState && (AppState.mods || []).length > 100 &&
               (AppState.warframes || []).length && document.getElementById("share-build-btn"))`,
          ))
        ) {
          if (win.isDestroyed() || Date.now() - started > TIMEOUT_MS) {
            throw new Error("page never finished loading its data");
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        return exec<{ link: string; buffs: number }>(
          `${PAGE_SCRIPT}(${JSON.stringify(frame)}, ${JSON.stringify(weapon)})`,
        );
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

let running: Promise<string | null> | null = null;

/** A share link for `weapon` with `frame`'s buffs worked in, or null when the
 *  page could not make one. One run at a time; a second click joins the first. */
export function underframeDpsLink(
  frame: UnderframeBuild | null,
  weapon: UnderframeBuild,
): Promise<string | null> {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    try {
      const { link, buffs } = await runInHiddenPage(frame, weapon);
      if (!link.startsWith(UNDERFRAME_SHARE_BASE)) throw new Error("unexpected share link");
      log.info(
        `[Underframe] ${weapon.itemName} linked in ${Date.now() - started}ms, ${buffs} frame buffs`,
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
