// Where the game runs: a browser tab, or the desktop app (electron/, with or without Steam).
// window.desktop comes from electron/preload.cjs; everything here is a no-op in the browser.

export const desktop = window.desktop || null;
export const isDesktop = !!desktop;
// Android / iOS app (Capacitor injects window.Capacitor into its web view).
export const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// Not served by our own site: online rooms and invite links go through the public site.
export const isPackagedApp = isDesktop || isNativeApp;

// Public site: the desktop app uses it for the Cloudflare rooms when Steam is not running.
export const WEB_ORIGIN = 'https://ai-slop-arena.gtux-prog.workers.dev';

// { available, id, name, appId, ... } once Steam answered, otherwise { available: false }.
export const steamInfo = desktop
  ? await desktop.steam.info().catch(e => ({ available: false, error: e.message }))
  : { available: false };
export const steam = steamInfo.available ? desktop.steam : null;

// Rich presence: shown to friends in their Steam friends list.
export function presence(status, group = null, size = 0) {
  if (!steam) return;
  steam.presence({ status, steam_player_group: group, steam_player_group_size: group ? size : null });
}

// Mobile app: full screen, landscape only.
if (isNativeApp) {
  import('./native.js').then(m => m.setupNative()).catch(e => console.warn('[native]', e));
}
