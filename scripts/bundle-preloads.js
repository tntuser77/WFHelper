// Sandboxed preloads cannot resolve local modules, so bundle their dependencies.
// --watch rebuilds them during development.
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.resolve(__dirname, "..", ".electron-build");
const WATCH = process.argv.includes("--watch");

const PRELOADS = [
  "preload.js",
  "preload-overlay.js",
  "preload-riven.js",
  "preload-trade-notification.js",
  "preload-arbi.js",
];

const WATCH_DEBOUNCE_MS = 100;

function tempPath(entry, suffix) {
  return `${entry}.${process.pid}.${suffix}`;
}

function validateBundle(outfile) {
  const stat = fs.statSync(outfile);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`Bundled preload is empty: ${outfile}`);
  }
}

// Each preload as this script last wrote it. On Windows fs.watch also fires
// when Electron merely reads a preload (last-access update), so without this
// check opening a window rewrote its preload and nodemon restarted the app.
// Content, not a quiet period after writing: a tsc emit landing in that period
// was dropped, left unbundled until a window opened, and restarted the app then.
const bundled = new Map();

function isUnchangedSinceBundle(name) {
  const last = bundled.get(name);
  if (!last) return false;
  try {
    const file = path.join(BUILD_DIR, name);
    if (fs.statSync(file).mtimeMs === last.mtimeMs) return true;
    return fs.readFileSync(file).equals(last.content);
  } catch {
    return false;
  }
}

function bundlePreload(name) {
  const entry = path.join(BUILD_DIR, name);
  const tempEntry = tempPath(entry, "input.js");
  const tempOut = tempPath(entry, "bundled.js");

  try {
    fs.copyFileSync(entry, tempEntry);
    esbuild.buildSync({
      entryPoints: [tempEntry],
      bundle: true,
      platform: "node",
      outfile: tempOut,
      external: ["electron"],
      // Keep readable for debugging preload issues
      minify: false,
      sourcemap: process.env.WFHELPER_SOURCE_MAPS === "1" ? "external" : false,
    });
    validateBundle(tempOut);
    fs.renameSync(tempOut, entry);
    bundled.set(name, { mtimeMs: fs.statSync(entry).mtimeMs, content: fs.readFileSync(entry) });
    if (process.env.WFHELPER_SOURCE_MAPS === "1") fs.renameSync(`${tempOut}.map`, `${entry}.map`);
    else fs.rmSync(`${entry}.map`, { force: true });
  } finally {
    fs.rmSync(tempEntry, { force: true });
    fs.rmSync(tempOut, { force: true });
    fs.rmSync(`${tempOut}.map`, { force: true });
  }
}

async function main() {
  if (!WATCH) {
    for (const name of PRELOADS) {
      bundlePreload(name);
    }
    console.log(`Bundled ${PRELOADS.length} preload scripts.`);
    return;
  }

  for (const name of PRELOADS) {
    bundlePreload(name);
  }

  const timers = new Map();
  const schedule = (name) => {
    if (!PRELOADS.includes(name)) return;

    const existing = timers.get(name);
    if (existing) clearTimeout(existing);

    timers.set(
      name,
      setTimeout(() => {
        timers.delete(name);
        if (isUnchangedSinceBundle(name)) return;
        try {
          bundlePreload(name);
        } catch (err) {
          console.error(`[bundle-preloads] failed to bundle ${name}:`, err);
        }
      }, WATCH_DEBOUNCE_MS),
    );
  };

  fs.watch(BUILD_DIR, (_event, filename) => {
    if (typeof filename === "string") {
      schedule(path.basename(filename));
    }
  });
  console.log(`[bundle-preloads] watching ${PRELOADS.length} preload scripts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
