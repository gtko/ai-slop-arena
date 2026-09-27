// Over-the-air updates of the mobile apps' web bundle (docs/ota-updates.md). Pure logic, shared by the
// app (src/ota.js), the Worker (GET /app/latest.json) and tests/updates.test.mjs: no DOM, no Capacitor.

// Lowest native shell (APK / iOS app version) able to run the current web bundle. Raise it to the
// version being released whenever that release adds, removes or updates a native Capacitor plugin
// (package.json @capacitor/* / @capgo/*, android/, ios/): older shells then keep their bundle until the
// player installs the new app from the store. Every shell that can read the manifest already has the
// updater plugin, so it stays at 0.16.0 until the native side changes.
export const MIN_NATIVE = '0.16.0';

export const REPO = 'gtko/ai-slop-arena';
export const APP_BUNDLE_ASSET = 'AISlopArena-app-bundle.zip';
export const bundleUrl = version => `https://github.com/${REPO}/releases/download/v${version}/${APP_BUNDLE_ASSET}`;

// '1.2.3' or 'v1.2.3' (a '-suffix' / '+build' is ignored) -> [1, 2, 3]; anything else -> null.
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v ?? '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

// -1, 0 or 1 like a sort comparator; null when either side is not a version.
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
const newer = (a, b) => compareVersions(a, b) === 1;

// What the Worker serves at /app/latest.json.
export function manifestFor(version, minNative = MIN_NATIVE) {
  return { version, url: bundleUrl(version), minNative };
}

// Should the app download this manifest's bundle? Only a well-formed https manifest of a version newer
// than the running bundle, that this native shell can run, and that did not already fail to boot here.
export function shouldDownload(manifest, { running, native, failed = [] }) {
  if (!manifest || typeof manifest !== 'object') return false;
  const { version, url, minNative } = manifest;
  if (!parseVersion(version) || typeof url !== 'string' || !url.startsWith('https://')) return false;
  if (!newer(version, running)) return false;
  if (!parseVersion(minNative) || !parseVersion(native) || compareVersions(native, minNative) < 0) return false;
  return !failed.includes(version);
}

// Among the bundles the plugin holds (CapacitorUpdater.list()), the one to switch to at launch: the
// newest downloaded one that is newer than the running bundle and never failed. null when there is none.
const USABLE = new Set(['pending', 'success']);
export function pickDownloaded(bundles, { running, failed = [] }) {
  let best = null;
  for (const b of bundles || []) {
    if (!b || b.id === 'builtin' || !USABLE.has(b.status) || failed.includes(b.version)) continue;
    if (!newer(b.version, running)) continue;
    if (!best || newer(b.version, best.version)) best = b;
  }
  return best;
}

// At launch, after switching to a bundle last time: `tried` is the version the app switched to. If the
// app now runs something else, that bundle never booted (the plugin rolled it back): it goes into
// `failed` so it is not downloaded again. Returns the new failed list (last 5 versions kept).
export function settleAttempt(tried, running, failed = []) {
  if (!tried || tried === running || failed.includes(tried)) return failed;
  return [...failed, tried].slice(-5);
}
