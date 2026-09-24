import { randomCode } from './net.js';
import { presence, serverOrigin } from './platform.js';
import { t } from './i18n/index.js';

// Steam transport with the same surface as Net (net.js), so main.js and game.js do not care.
//
// A room is a Steam lobby and the lobby owner is the host. On the web, the Cloudflare Durable
// Object (worker/index.js) keeps the roster and relays messages; here the host does that job
// itself and everyone talks to it over Steam P2P (relayed by Steam, no ports to open):
//   client -> host : hello, pick, in, ping
//   host -> all    : room, start, snap, ev, pong
// If the host leaves, Steam hands the lobby to someone else, who rebuilds the roster from the
// last `room` message and carries on as the new host.

const MAX_PLAYERS = 8;
const BRAWLERS = new Set(['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt']);
const LEFT = new Set([1, 2, 3, 4]); // ChatMemberStateChange: Left, Disconnected, Kicked, Banned
const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} _\-.!?']/gu, '').slice(0, n).trim();
// High-rate state that is resent anyway: unreliable, newest wins. Everything else is reliable.
const LOSSY = new Set(['snap', 'in']);
// Errors thrown in the main process arrive as "Error invoking remote method ...: Error: <msg>".
function ipcError(e) {
  const m = String(e && e.message);
  throw new Error(/not an AI SLOP/.test(m) ? t('err.notOurs') : /not running/.test(m) ? t('err.noSteam') : m.replace(/^.*Error: /, ''));
}

export class SteamNet {
  constructor(steam, me) {
    this.steam = steam;
    this.me = me; // { id, name } of the local Steam user
    this.handlers = new Map();
    this.lobby = null;
    this.owner = null;
    this.id = null;
    this.code = null;
    this.players = [];
    this.inMatch = false;
    this.map = 'oasis';
    this.rtt = 0;
    this.roster = new Map(); // host only: id -> { id, name, brawler, host, joined }
    this.seqOut = 0;
    this.seqIn = new Map(); // newest lossy packet seen per sender + type
    this.blocked = new Set(); // players the host removed: their packets are ignored
    this.serverAuthority = false; // a player hosts (peer-to-peer)
    this.matchmade = false;
    steam.onPackets(batch => { for (const [from, text] of batch) this.receive(from, text); });
    steam.onLobby(ev => this.lobbyEvent(ev));
  }

  get isHost() { return !!this.lobby && this.owner === this.id; }
  get connected() { return !!this.lobby; }
  get steamLobby() { return this.lobby; }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, msg) { const h = this.handlers.get(type); if (h) h(msg); }

  /* ------------------------------ joining ------------------------------ */

  async create(name, brawler) {
    this.close();
    const code = randomCode();
    const info = await this.steam.createLobby({ code, max: MAX_PLAYERS }).catch(ipcError);
    this.enter(info);
    this.roster = new Map([[this.id, { id: this.id, name: clean(name, 14) || 'Player', brawler: BRAWLERS.has(brawler) ? brawler : 'blaster', host: true, joined: Date.now() }]]);
    this.inMatch = false;
    this.broadcastRoom();
    return this;
  }

  // Same signature as Net.connect: join by room code.
  async connect(code, name, brawler) {
    const id = await this.steam.findLobby(code);
    if (!id) throw new Error(t('err.notFound', { code }));
    return this.joinLobby(id, name, brawler);
  }

  // Join a lobby by id (invite, "Join game" in the friends list, or a room code lookup).
  async joinLobby(lobbyId, name, brawler) {
    this.close();
    const info = await this.steam.joinLobby(lobbyId).catch(ipcError);
    this.enter(info);
    if (info.members.length > MAX_PLAYERS) { this.close(); throw new Error(t('err.full')); }
    if (this.isHost) { // the lobby was empty: we own it now
      this.roster = new Map([[this.id, { id: this.id, name: clean(name, 14) || 'Player', brawler, host: true, joined: Date.now() }]]);
      this.broadcastRoom();
      return this;
    }
    // Say hello until the host answers with the roster.
    const hello = { t: 'hello', name, brawler };
    await new Promise((resolve, reject) => {
      let tries = 0;
      const again = () => {
        if (!this.lobby) return reject(new Error(t('err.left')));
        if (this.players.some(p => p.id === this.id)) return resolve();
        if (++tries > 8) { this.close(); return reject(new Error(t('err.noAnswer'))); }
        this.toHost(hello);
        this.helloTimer = setTimeout(again, 1000);
      };
      again();
    });
    return this;
  }

  enter(info) {
    this.lobby = info.id;
    this.owner = info.owner;
    this.code = info.code || '----';
    this.id = this.me.id;
    this.players = [];
    this.pingTimer = setInterval(() => { if (!this.isHost) this.toHost({ t: 'ping', at: performance.now() }); }, 2000);
  }

  close() {
    clearInterval(this.pingTimer);
    clearTimeout(this.helloTimer);
    if (this.lobby) this.steam.leaveLobby();
    this.lobby = null;
    this.owner = null;
    this.players = [];
    this.roster.clear();
    this.seqIn.clear();
    this.blocked.clear();
    this.id = null;
    this.inMatch = false;
    presence(t('presence.menu'));
  }

  invite() { this.steam.invite(); }

  // Host only: remove a player from the lobby's game (Steam cannot force them out of the lobby,
  // but the host ignores them from now on and they are told they were removed).
  kick(id) {
    if (!this.isHost || id === this.id) return;
    this.sendTo(id, { t: 'kicked', code: 'leader' });
    this.blocked.add(id);
    if (this.roster.delete(id)) {
      if (this.inMatch) this.emit('left', { id });
      this.broadcastRoom();
    }
  }

  // Reports go to the moderation server over HTTPS (no server of ours sees P2P lobbies).
  report(id, reason) {
    const p = this.players.find(x => x.id === id);
    fetch(`${serverOrigin()}/api/report`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'steam:' + id, name: p ? p.name : '', reason, plat: 'steam' }),
    }).then(r => this.emit('reported', { id, ok: r.ok })).catch(() => this.emit('reported', { id, ok: false }));
  }

  /* ------------------------------ sending ------------------------------ */

  sendTo(id, msg) {
    if (LOSSY.has(msg.t)) msg.q = ++this.seqOut;
    this.steam.send(id, JSON.stringify(msg), !LOSSY.has(msg.t));
  }
  toHost(msg) { if (this.owner && this.owner !== this.id) this.sendTo(this.owner, msg); }
  toOthers(msg) {
    if (LOSSY.has(msg.t)) msg.q = ++this.seqOut;
    const text = JSON.stringify(msg);
    for (const id of this.roster.keys()) if (id !== this.id) this.steam.send(id, text, !LOSSY.has(msg.t));
  }

  // What the local game sends. As host we play the part of the room server (worker/index.js).
  send(msg) {
    if (!this.lobby) return;
    if (!this.isHost) { this.toHost(msg); return; }
    const me = this.roster.get(this.id);
    switch (msg.t) {
      case 'pick':
        if (me && BRAWLERS.has(msg.brawler)) { me.brawler = msg.brawler; this.broadcastRoom(); }
        break;
      case 'map':
        if (/^[a-z]{2,12}$/.test(msg.map)) { this.map = msg.map; this.broadcastRoom(); }
        break;
      case 'start':
        this.inMatch = true;
        this.toOthers(msg);
        this.broadcastRoom();
        break;
      case 'end':
        this.inMatch = false;
        this.broadcastRoom();
        break;
      case 'snap':
      case 'ev':
        this.toOthers(msg);
        break;
    }
  }

  broadcastRoom() {
    const players = [...this.roster.values()].sort((a, b) => a.joined - b.joined)
      .map(({ id, name, brawler, host }) => ({ id, name, brawler, host }));
    const msg = { t: 'room', players, inMatch: this.inMatch, map: this.map };
    this.toOthers(msg);
    this.steam.setLobbyData('map', this.map);
    this.applyRoom(msg);
    this.emit('room', msg);
  }

  applyRoom(m) {
    this.players = m.players;
    this.inMatch = m.inMatch;
    this.map = m.map;
    presence(t(m.inMatch ? 'presence.online' : 'presence.room'), this.lobby, m.players.length);
  }

  /* ------------------------------ receiving ------------------------------ */

  receive(from, text) {
    if (!this.lobby || from === this.id || this.blocked.has(from)) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (typeof msg !== 'object' || !msg || typeof msg.t !== 'string') return;
    if (msg.q) { // drop lossy packets that arrive after a newer one
      const key = from + msg.t;
      if (msg.q <= (this.seqIn.get(key) || 0)) return;
      this.seqIn.set(key, msg.q);
    }
    if (this.isHost) this.fromClient(from, msg);
    else if (from === this.owner) this.fromHost(msg);
  }

  fromClient(from, msg) {
    const p = this.roster.get(from);
    switch (msg.t) {
      case 'hello':
        if (!p && this.roster.size >= MAX_PLAYERS) return;
        if (this.blocked.has(from)) return;
        this.roster.set(from, {
          id: from, name: clean(msg.name, 14) || 'Player', brawler: BRAWLERS.has(msg.brawler) ? msg.brawler : 'blaster',
          host: false, joined: p ? p.joined : Date.now(),
        });
        this.broadcastRoom();
        break;
      case 'pick':
        if (p && BRAWLERS.has(msg.brawler)) { p.brawler = msg.brawler; this.broadcastRoom(); }
        break;
      case 'in':
        if (p) { msg.from = from; this.emit('in', msg); }
        break;
      case 'ping':
        this.sendTo(from, { t: 'pong', at: msg.at });
        break;
    }
  }

  fromHost(msg) {
    if (msg.t === 'room') this.applyRoom(msg);
    if (msg.t === 'pong') this.rtt = performance.now() - msg.at;
    this.emit(msg.t, msg);
  }

  // Someone left the Steam lobby (quit, crashed, lost connection).
  lobbyEvent({ user, change, owner }) {
    if (!this.lobby || !LEFT.has(change) || user === this.id) return;
    const hostLeft = user === this.owner;
    this.owner = owner;
    if (hostLeft) {
      const wasInMatch = this.inMatch;
      this.inMatch = false;
      if (this.isHost) { // promoted: rebuild the roster from what the old host last told us
        const t = Date.now();
        this.roster = new Map(this.players.filter(p => p.id !== user)
          .map((p, i) => [p.id, { ...p, host: p.id === this.id, joined: t + i }]));
        if (!this.roster.has(this.id)) this.roster.set(this.id, { id: this.id, name: this.me.name, brawler: 'blaster', host: true, joined: t - 1 });
        this.roster.get(this.id).joined = t - 1;
      }
      if (wasInMatch) this.emit('hostLeft', {});
      if (this.isHost) this.broadcastRoom();
      else this.players = this.players.filter(p => p.id !== user);
      return;
    }
    if (this.isHost && this.roster.delete(user)) {
      if (this.inMatch) this.emit('left', { id: user });
      this.broadcastRoom();
    }
  }
}
