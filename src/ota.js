import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Network } from '@capacitor/network';
import { version } from '../package.json';
import { WEB_ORIGIN } from './platform.js';
import { shouldDownload, pickDownloaded, nativeVersion, loadState, downloadStarted, downloadDone, bootFailed, bootOk } from './updates.js';

// Android / iOS only (loaded by main.js): over-the-air updates of the web bundle (docs/ota-updates.md).
// - atLaunch(), as soon as main.js runs: if the last switch to a new bundle did not boot, count it; if a
//   newer bundle was downloaded during an earlier session, switch to it now, before the loader and long
//   before any match (the web view reloads into it).
// - appReady(), once the loader is done and the menu is up: notifyAppReady() (the plugin keeps a bundle
//   that gets here and rolls back one that does not within appReadyTimeout, capacitor.config.json).
//   Then, when the player is on the home screen (not in a match, a room or the queue) and on Wi-Fi,
//   the manifest (GET /app/latest.json on our Worker) is read; a newer bundle this native shell can run
//   is downloaded, and applies at the next launch.
// Every failure (offline, the release still building, a broken zip) is silent; attempts are counted per
// version so a bundle that keeps failing is not downloaded again and again (src/updates.js).

const STATE = 'iaslop-ota';        // { failed, boots, downloads } (src/updates.js loadState)
const TRIED = 'iaslop-ota-tried';  // version switched to at the last launch (did it boot?)
const NATIVE = 'iaslop-ota-native'; // the shell's version, recorded while its built-in bundle runs
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private */ } };
const readState = () => loadState(get(STATE));
const saveState = s => put(STATE, JSON.stringify(s));
const warn = e => console.warn('[ota]', (e && e.message) || e);
const HOME_POLL = 5000;

let switching = null; // atLaunch() is switching bundles: nothing else runs

export function atLaunch() {
  switching = (async () => {
    const tried = get(TRIED);
    if (tried && tried !== version) { saveState(bootFailed(readState(), tried)); put(TRIED, null); }
    const current = await CapacitorUpdater.current();
    // Switch only from a bundle known to work (the built-in one, or one that booted before): it is
    // the one the plugin falls back to if the new bundle does not boot.
    if (current.bundle.id !== 'builtin' && current.bundle.status !== 'success') return false;
    const { bundles } = await CapacitorUpdater.list();
    const ready = pickDownloaded(bundles, { running: version, failed: readState().failed });
    if (!ready) return false;
    put(TRIED, ready.version);
    try { await CapacitorUpdater.set({ id: ready.id }); } catch (e) { put(TRIED, null); throw e; }
    return true; // the web view reloads into the new bundle
  })().catch(e => { warn(e); return false; });
  return switching;
}

// onHome(): true while the home screen is shown with no match, room or queue. onReady(version): a
// bundle is downloaded and applies at the next launch (called while on the home screen).
export async function appReady({ onHome = () => true, onReady } = {}) {
  try {
    if (switching && await switching) return;
    await CapacitorUpdater.notifyAppReady();
    if (get(TRIED) === version) { saveState(bootOk(readState(), version)); put(TRIED, null); }

    const current = await CapacitorUpdater.current();
    if (current.bundle.id === 'builtin') put(NATIVE, version);
    const native = nativeVersion(current.native, get(NATIVE));

    const { bundles } = await CapacitorUpdater.list();
    if (pickDownloaded(bundles, { running: version, failed: readState().failed })) return; // applies next launch

    await until(async () => onHome() && await onWifi());
    const res = await fetch(`${WEB_ORIGIN}/app/latest.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await res.json();
    if (!shouldDownload(manifest, { running: version, native, state: readState() })) return;
    // The plugin cannot pause a download: it only starts from the home screen, on Wi-Fi.
    if (!onHome() || !await onWifi()) return;
    saveState(downloadStarted(readState(), manifest.version));
    await CapacitorUpdater.download({ url: manifest.url, version: manifest.version });
    saveState(downloadDone(readState(), manifest.version));
    if (onReady) { await until(async () => onHome()); onReady(manifest.version); }
  } catch (e) {
    warn(e);
  }
}

// Wi-Fi only: the bundle is ~60 MB. Unknown / missing network plugin: no download.
async function onWifi() {
  try { return (await Network.getStatus()).connectionType === 'wifi'; } catch { return false; }
}

// Resolves once test() is true, checking every few seconds (this session only).
async function until(test) {
  while (!await test()) await new Promise(r => setTimeout(r, HOME_POLL));
}
