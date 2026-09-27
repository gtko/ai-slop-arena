import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { version } from '../package.json';
import { WEB_ORIGIN } from './platform.js';
import { shouldDownload, pickDownloaded, settleAttempt } from './updates.js';

// Android / iOS only (loaded by main.js): over-the-air updates of the web bundle (docs/ota-updates.md).
// 1. notifyAppReady() at once: this bundle booted, the plugin keeps it (a bundle that never gets here is
//    rolled back to the previous one after appReadyTimeout, capacitor.config.json).
// 2. A newer bundle downloaded during an earlier session is switched to now, at launch, while the menu
//    is up: never during a match.
// 3. Otherwise the manifest (GET /app/latest.json on our Worker) is read in the background; a newer bundle
//    this native shell can run is downloaded, and applies at the next launch.
// Every failure (offline, the release still building, a broken zip) is silent: the next launch retries.

const TRIED = 'iaslop-ota-tried';   // version switched to at the last launch (did it boot?)
const FAILED = 'iaslop-ota-failed'; // versions that never booted here: not downloaded again
const NATIVE = 'iaslop-ota-native'; // the native shell's own version (its built-in bundle's version)
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private */ } };
const readFailed = () => { try { const a = JSON.parse(get(FAILED) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

// inMatch(): true while a match runs (nothing reloads then). onReady(version): a bundle is downloaded
// and applies at the next launch.
export async function startUpdates({ inMatch = () => false, onReady } = {}) {
  try {
    await CapacitorUpdater.notifyAppReady();

    let failed = readFailed();
    const tried = get(TRIED);
    if (tried) {
      failed = settleAttempt(tried, version, failed);
      put(FAILED, JSON.stringify(failed));
      put(TRIED, null);
    }

    // The built-in bundle's version is the shell's version (android versionName follows package.json,
    // but the iOS project keeps its own marketing version): remember it while it runs.
    const current = await CapacitorUpdater.current();
    if (current.bundle.id === 'builtin') put(NATIVE, version);
    const native = get(NATIVE) || current.native;

    const { bundles } = await CapacitorUpdater.list();
    const ready = pickDownloaded(bundles, { running: version, failed });
    if (ready && !inMatch()) {
      put(TRIED, ready.version);
      try { await CapacitorUpdater.set({ id: ready.id }); } catch (e) { put(TRIED, null); throw e; }
      return; // the web view reloads into the new bundle
    }
    if (ready) return; // downloaded already: it applies at the next launch

    if (navigator.connection && navigator.connection.saveData) return; // data saver: no big download
    const res = await fetch(`${WEB_ORIGIN}/app/latest.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await res.json();
    if (!shouldDownload(manifest, { running: version, native, failed })) return;
    await CapacitorUpdater.download({ url: manifest.url, version: manifest.version });
    if (onReady) onReady(manifest.version);
  } catch (e) {
    console.warn('[ota]', e && e.message || e);
  }
}
