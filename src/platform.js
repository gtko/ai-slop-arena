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

// Desktop build: { store: 'steam' | 'epic', version, epic: { name, locale } | null }.
export const appInfo = desktop ? await desktop.info().catch(() => ({ store: 'steam' })) : { store: 'web' };
export const epic = appInfo.epic || null;

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

// Which platform the player is on, as the server's matchmaking and moderation see it.
export const platformName = isNativeApp ? (window.Capacitor.getPlatform() === 'ios' ? 'ios' : 'android')
  : isDesktop ? (appInfo.store === 'epic' ? 'epic' : 'steam') : 'web';

// A random id kept on this device: players have no account, so bans and reports use it.
export function clientId() {
  const KEY = 'iaslop-cid';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) { id = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem(KEY, id); }
    return id;
  } catch { return ''; }
}

// Base URL of the online server (rooms, matchmaking, reports). Same origin on the website; the
// apps talk to the public site; `npm run dev` pairs Vite (5173) with wrangler (8787).
export function serverOrigin() {
  const { protocol, hostname, port, host } = location;
  if (isPackagedApp) return WEB_ORIGIN;
  if (port === '5173') return `${protocol}//${hostname}:8787`;
  return `${protocol}//${host}`;
}

// Mobile app: full screen, landscape only.
if (isNativeApp) {
  import('./native.js').then(m => m.setupNative()).catch(e => console.warn('[native]', e));
}
