// AI SLOP ARENA — desktop shell (Electron) with Steamworks.
//
// The game itself is the same Vite build as the website: it is served from dist/ through a private
// app:// scheme so its absolute /assets/... paths keep working. Steamworks (steamworks.js, a native
// module) only lives in this main process; the page talks to it through the narrow bridge in
// preload.cjs: achievements + stats, rich presence, the overlay, lobbies and P2P packets.
//
//   npm run desktop        build, then run the desktop app
//   npm run desktop:dev    run against `npm run dev` (hot page reloads, Steam still live)
//
// Without Steam running (or outside Steam), the app still starts: the page falls back to the
// Cloudflare room relay for online play, and achievements are simply not sent anywhere.

const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { Readable } = require('node:stream');

const pkg = require('../package.json');
const APP_ID = Number(process.env.STEAM_APP_ID) || pkg.steam.appId;
// Which store this build is for: 'steam' (default) or 'epic' (npm run dist:epic sets it).
const STORE = pkg.store || 'steam';
// The Epic launcher passes the player's display name and language on the command line.
const argValue = name => { const a = process.argv.find(x => x.toLowerCase().startsWith(`-${name}=`)); return a ? a.slice(name.length + 2) : null; };
const EPIC = STORE === 'epic' ? { name: argValue('epicusername'), locale: argValue('epiclocale') } : null;
const DIST = path.join(__dirname, '..', 'dist');
const devArg = process.argv.find(a => a.startsWith('--dev-server='));
const DEV_URL = devArg ? devArg.slice('--dev-server='.length) : null;
const START_URL = DEV_URL || 'app://game/play.html';

/* ------------------------------ Steam ------------------------------ */

let steamworks = null, steam = null, steamError = null;
if (STORE !== 'steam') steamError = `${STORE} build`;
else try {
  steamworks = require('steamworks.js');
  // A shipped build launched from its folder relaunches itself through Steam (480 = Spacewar test app).
  if (app.isPackaged && APP_ID !== 480 && steamworks.restartAppIfNecessary(APP_ID)) app.exit(0);
  steam = steamworks.init(APP_ID);
} catch (e) {
  steamError = e.message || String(e);
  console.warn('[steam] not available:', steamError);
}
// The overlay (Shift+Tab) needs these GPU switches, so it is set up before the app is ready.
if (steam) steamworks.electronEnableSteamOverlay();

const LobbyType = { Private: 0, FriendsOnly: 1, Public: 2 };
const SendType = { Unreliable: 0, UnreliableNoDelay: 1, Reliable: 2 };
const Dialog = { friends: 0, community: 1, players: 2, settings: 3, group: 4, stats: 5, achievements: 6 };
const GAME_TAG = 'ai-slop-arena';

let win = null;
let lobby = null; // the steamworks Lobby we are in, if any
let pendingLobby = lobbyFromArgs(process.argv); // "Join game" from the friends list before launch

// Steam starts the game with `+connect_lobby <id>` when a friend accepts an invite.
function lobbyFromArgs(argv) {
  const i = argv.indexOf('+connect_lobby');
  return i >= 0 && /^\d+$/.test(argv[i + 1] || '') ? argv[i + 1] : null;
}

const toPage = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
const idOf = p => p.steamId64.toString();
const lobbyInfo = l => ({ id: l.id.toString(), owner: idOf(l.getOwner()), members: l.getMembers().map(idOf), code: l.getData('code') || '' });

if (steam) {
  const on = (name, fn) => steam.callback.register(steamworks.SteamCallback[name], fn);

  // Peers open a P2P session the first time they send to us; only accept people in our lobby.
  on('P2PSessionRequest', ({ remote }) => {
    if (lobby && lobby.getMembers().some(m => m.steamId64 === remote)) steam.networking.acceptP2PSession(remote);
  });
  on('LobbyChatUpdate', ({ lobby: id, user_changed, member_state_change }) => {
    if (!lobby || lobby.id !== id) return;
    toPage('steam:lobby', { user: user_changed.toString(), change: member_state_change, owner: idOf(lobby.getOwner()) });
  });
  // Accepting an invite / "Join game" while the game is already running.
  on('GameLobbyJoinRequested', ({ lobby_steam_id }) => {
    pendingLobby = lobby_steam_id.toString();
    toPage('steam:join-requested', pendingLobby);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  // Drain incoming packets ~250 times a second and hand them to the page in one IPC message.
  setInterval(() => {
    if (!lobby) return;
    const batch = [];
    for (let n = steam.networking.isP2PPacketAvailable(); n > 0; n = steam.networking.isP2PPacketAvailable()) {
      const p = steam.networking.readP2PPacket(n);
      batch.push([idOf(p.steamId), p.data.toString('utf8')]);
    }
    if (batch.length) toPage('steam:packets', batch);
  }, 4);
}

/* ------------------------------ IPC ------------------------------ */

// Only our own page may drive Steam.
const trusted = e => {
  const url = e.senderFrame ? e.senderFrame.url : '';
  return url.startsWith('app://game/') || (DEV_URL && url.startsWith(new URL(DEV_URL).origin));
};
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
  if (!trusted(e)) throw new Error('untrusted sender');
  return fn(...args);
});
const listen = (channel, fn) => ipcMain.on(channel, (e, ...args) => { if (trusted(e)) fn(...args); });
const needSteam = () => { if (!steam) throw new Error('Steam is not running'); return steam; };

handle('steam:info', () => {
  if (!steam) return { available: false, error: steamError };
  const me = steam.localplayer.getSteamId();
  return { available: true, appId: steam.utils.getAppId(), id: me.steamId64.toString(), name: steam.localplayer.getName(),
    country: steam.localplayer.getIpCountry(), deck: steam.utils.isSteamRunningOnSteamDeck(), language: steam.apps.currentGameLanguage() };
});
// Consumed once: the lobby we were launched (or asked) to join.
handle('steam:take-pending-lobby', () => { const id = pendingLobby; pendingLobby = null; return id; });

handle('steam:lobby-create', async ({ code, max = 8, friendsOnly = false }) => {
  const s = needSteam();
  leaveLobby();
  lobby = await s.matchmaking.createLobby(friendsOnly ? LobbyType.FriendsOnly : LobbyType.Public, max);
  lobby.mergeFullData({ game: GAME_TAG, code: String(code || ''), version: pkg.version });
  return lobbyInfo(lobby);
});
handle('steam:lobby-join', async id => {
  const s = needSteam();
  leaveLobby();
  lobby = await s.matchmaking.joinLobby(BigInt(id));
  if (lobby.getData('game') !== GAME_TAG) { leaveLobby(); throw new Error('That is not an AI SLOP ARENA room'); }
  return lobbyInfo(lobby);
});
// Room codes still work on Steam: the host writes it in the lobby data, joiners scan the list.
handle('steam:lobby-find', async code => {
  const list = await needSteam().matchmaking.getLobbies();
  const hit = list.find(l => l.getData('game') === GAME_TAG && (l.getData('code') || '').toUpperCase() === String(code).toUpperCase());
  return hit ? hit.id.toString() : null;
});
handle('steam:lobby-state', () => (lobby ? lobbyInfo(lobby) : null));
handle('steam:lobby-leave', () => leaveLobby());
handle('steam:lobby-set', (key, value) => { if (lobby) lobby.setData(String(key), String(value)); });
handle('steam:lobby-joinable', v => { if (lobby) lobby.setJoinable(!!v); });
handle('steam:invite', () => { if (lobby) lobby.openInviteDialog(); else needSteam().overlay.activateDialog(Dialog.friends); });
handle('steam:overlay', name => needSteam().overlay.activateDialog(Dialog[name] ?? Dialog.friends));

function leaveLobby() {
  if (!lobby) return;
  try { lobby.leave(); } catch { /* already gone */ }
  lobby = null;
}

// Hot path: fire-and-forget, one message per packet.
listen('steam:send', (to, text, reliable) => {
  if (!steam || !lobby) return;
  const buf = Buffer.from(text, 'utf8');
  const type = reliable || buf.length > 1150 ? SendType.Reliable : SendType.UnreliableNoDelay;
  steam.networking.sendP2PPacket(BigInt(to), type, buf);
});

handle('steam:achieve', name => (steam ? steam.achievement.activate(String(name)) : false));
handle('steam:achieved', name => (steam ? steam.achievement.isActivated(String(name)) : false));
// Stats must be declared in the Steamworks backend; unknown ones just return null / false.
handle('steam:stats', (values = {}) => {
  if (!steam) return false;
  for (const [k, v] of Object.entries(values)) steam.stats.setInt(k, Math.floor(v));
  return steam.stats.store();
});
handle('steam:store', () => (steam ? steam.stats.store() : false));
handle('steam:presence', (values = {}) => {
  if (!steam) return;
  for (const [k, v] of Object.entries(values)) steam.localplayer.setRichPresence(k, v == null || v === '' ? null : String(v));
});

handle('app:info', () => ({ store: STORE, version: pkg.version, epic: EPIC }));
handle('app:fullscreen', v => { if (win) win.setFullScreen(v == null ? !win.isFullScreen() : !!v); return win && win.isFullScreen(); });
handle('app:quit', () => app.quit());

/* ------------------------------ window ------------------------------ */

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// A second launch (e.g. "Join game" from the friends list) is forwarded to the running copy.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', (_e, argv) => {
  const id = lobbyFromArgs(argv);
  if (id) { pendingLobby = id; toPage('steam:join-requested', id); }
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    show: false, backgroundColor: '#16121f', autoHideMenuBar: true, title: 'AI SLOP ARENA',
    icon: path.join(__dirname, 'icon.png'),
    fullscreen: process.argv.includes('--fullscreen'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, // keep hosting the match while alt-tabbed
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('closed', () => { win = null; });
  // Links (store page, website) open in the real browser; the window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(new URL(START_URL).origin)) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); }
  });
  // F11 / Alt+Enter: fullscreen. F12 opens the dev tools in dev runs only.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  win.loadURL(START_URL);
}

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname === '/' ? '/play.html' : pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    // Byte ranges, so streamed music can seek (net.fetch on file:// ignores them).
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
    if (range && fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      const start = range[1] ? +range[1] : Math.max(0, size - +range[2]);
      const end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
      if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
      return new Response(stream, { status: 206, headers: {
        'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes', 'Content-Type': file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream' } });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});

app.on('before-quit', () => {
  leaveLobby();
  if (steam) steam.localplayer.setRichPresence('status', null);
});
app.on('window-all-closed', () => app.quit());
