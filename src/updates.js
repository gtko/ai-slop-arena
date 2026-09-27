// Over-the-air updates of the mobile apps' web bundle (docs/ota-updates.md). Pure logic, shared by the
// app (src/ota.js), the Worker (GET /app/latest.json) and tests/updates.test.mjs: no DOM, no Capacitor.

// Lowest native shell (APK / iOS app version) able to run the current web bundle. Raise it to the
// version being released whenever that release adds, removes or updates a native Capacitor plugin
// (package.json @capacitor/* / @capgo/*, android/, ios/): older shells then keep their bundle until the
// player installs the new app from the store. 0.16.1: the first shell with @capacitor/network (src/ota.js
// needs it; the 0.16.0 shell never had the updater, so none of them reads this anyway).
export const MIN_NATIVE = '0.16.1';

export const REPO = 'gtko/ai-slop-arena';
export const APP_BUNDLE_ASSET = 'AISlopArena-app-bundle.zip';
export const bundleUrl = version => `https://github.com/${REPO}/releases/download/v${version}/${APP_BUNDLE_ASSET}`;

export const MAX_DOWNLOADS = 2; // download starts of one version that never completed, then it is skipped
export const MAX_BOOTS = 2;     // switches to one version that never booted, then it is skipped

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

// Build number of a version, the same on both platforms: Android versionCode (android/app/build.gradle)
// and iOS CFBundleVersion (scripts/native-version.mjs). '0.16.1' -> 1601.
export function buildNumber(v) {
  const p = parseVersion(v);
  return p ? p[0] * 10000 + p[1] * 100 + p[2] : null;
}

// The native shell's version: what the OS reports (Android versionName, iOS CFBundleShortVersionString)
// when it is a real x.y.z, otherwise what the app recorded while running its built-in bundle (an iOS
// build made straight from Xcode may still say "1.0").
export function nativeVersion(reported, stored) {
  if (parseVersion(reported)) return reported;
  return parseVersion(stored) ? stored : null;
}

// What the Worker serves at /app/latest.json.
export function manifestFor(version, minNative = MIN_NATIVE) {
  return { version, url: bundleUrl(version), minNative };
}

// Per-device memory (localStorage 'iaslop-ota'): versions given up on, and attempts per version.
export function loadState(raw) {
  let s = null;
  try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { s = null; }
  const obj = o => (o && typeof o === 'object' && !Array.isArray(o) ? { ...o } : {});
  return {
    failed: Array.isArray(s && s.failed) ? s.failed.filter(v => typeof v === 'string').slice(-5) : [],
    boots: obj(s && s.boots),
    downloads: obj(s && s.downloads),
  };
}
const giveUp = (s, v) => (s.failed.includes(v) ? s.failed : [...s.failed, v].slice(-5));

// Should the app download this manifest's bundle? Only a well-formed https manifest of a version newer
// than the running bundle, that this native shell can run, not given up on, and not already started
// MAX_DOWNLOADS times without finishing (unzip error, full storage, app killed mid-transfer).
export function shouldDownload(manifest, { running, native, state = loadState(null) }) {
  if (!manifest || typeof manifest !== 'object') return false;
  const { version, url, minNative } = manifest;
  if (!parseVersion(version) || typeof url !== 'string' || !url.startsWith('https://')) return false;
  if (!newer(version, running)) return false;
  if (!parseVersion(minNative) || !parseVersion(native) || compareVersions(native, minNative) < 0) return false;
  if (state.failed.includes(version)) return false;
  return (state.downloads[version] || 0) < MAX_DOWNLOADS;
}

// A download of `v` starts / completes. Only the newest version is tracked: a newer release starts afresh.
export function downloadStarted(state, v) {
  return { ...state, downloads: { [v]: (state.downloads[v] || 0) + 1 } };
}
export function downloadDone(state, v) {
  const downloads = { ...state.downloads };
  delete downloads[v];
  return { ...state, downloads };
}

// After switching to `v` (CapacitorUpdater.set), the app came back on another version: `v` never
// booted (the plugin rolled it back, or the app was backgrounded mid-reload). The first time it may be
// downloaded and tried again; after MAX_BOOTS it is given up on.
export function bootFailed(state, v) {
  const n = (state.boots[v] || 0) + 1;
  const boots = { ...state.boots, [v]: n };
  return { ...state, boots, failed: n >= MAX_BOOTS ? giveUp(state, v) : state.failed };
}
// `v` booted and called notifyAppReady: its counters are cleared.
export function bootOk(state, v) {
  const boots = { ...state.boots };
  delete boots[v];
  return downloadDone({ ...state, boots }, v);
}

// Among the bundles the plugin holds (CapacitorUpdater.list()), the one to switch to at launch: the
// newest downloaded one that is newer than the running bundle and not given up on. null when none.
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
