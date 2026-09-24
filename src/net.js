import { serverOrigin, clientId, platformName } from './platform.js';
import { t } from './i18n/index.js';
import { botLevel } from './skill.js';

// WebSocket client for the online server (worker/index.js). The server RUNS every match of a web
// room (it is the host); the leader only picks the map and starts. The Steam build's friend
// lobbies use steamnet.js instead (a player hosts).

export const PROTOCOL = 2; // must match worker/index.js; older clients are told to update

// Server refusals come with a code we translate; bans keep the server's text (it has the date).
export function serverError(msg) {
  if (msg.code === 'full' || msg.msg === 'Room is full') return t('err.full');
  if (msg.code === 'outdated') return t('err.outdated');
  if (msg.code === 'kicked') return t('mod.kicked.leader');
  return msg.msg || t('err.unreachable');
}

export function serverBase() { return serverOrigin().replace(/^http/, 'ws'); }

// Query string every connection carries: protocol version, device id and platform (moderation).
export function identityQuery(name, brawler) {
  return `v=${PROTOCOL}&cid=${encodeURIComponent(clientId())}&plat=${platformName}&name=${encodeURIComponent(name)}&b=${brawler}&lvl=${botLevel().toFixed(2)}`;
}

export function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.id = null;
    this.code = null;
    this.players = [];
    this.inMatch = false;
    this.matchmade = false;
    this.rtt = 0;
    this.serverAuthority = true; // the server runs the match: everyone plays as a client
  }

  get isHost() { return !!this.players.find(p => p.id === this.id && p.host); }
  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, msg) { const h = this.handlers.get(type); if (h) h(msg); }

  connect(code, name, brawler) {
    this.close();
    return new Promise((resolve, reject) => {
      const url = `${serverBase()}/ws/${encodeURIComponent(code)}?${identityQuery(name, brawler)}`;
      const ws = this.ws = new WebSocket(url);
      let welcomed = false;
      ws.onmessage = e => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'welcome') { this.id = msg.id; this.code = msg.code; welcomed = true; resolve(this); }
        if (msg.t === 'room') { this.players = msg.players; this.inMatch = msg.inMatch; this.map = msg.map; this.matchmade = !!msg.matchmade; }
        if (msg.t === 'kicked') this.kickedMsg = msg.msg;
        if (msg.t === 'pong') this.rtt = performance.now() - msg.at;
        if (msg.t === 'error' && !welcomed) reject(new Error(serverError(msg)));
        this.emit(msg.t, msg);
      };
      ws.onclose = () => { if (!welcomed) reject(new Error(t('err.unreachable'))); this.emit('closed', {}); };
      ws.onerror = () => { if (!welcomed) reject(new Error(t('err.unreachable'))); };
      this.pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
    });
  }

  send(msg) { if (this.connected) this.ws.send(JSON.stringify(msg)); }
  kick(id) { this.send({ t: 'kick', id }); }
  report(id, reason) { this.send({ t: 'report', id, reason }); }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.ws = null;
    this.players = [];
    this.id = null;
  }
}
