import { DurableObject } from 'cloudflare:workers';

// AI SLOP ARENA — multiplayer relay.
//
// The Worker serves the built game from static assets and routes /ws/<ROOM> to one Durable
// Object per room. The room is a thin relay: the first player is the host and runs the whole
// simulation in their browser; other players send inputs to the host, the host broadcasts
// snapshots and events. The DO only tracks who is in the room, who hosts, and forwards messages.

const MAX_PLAYERS = 8;
const CODE = /^[A-Z0-9]{4,6}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]+)$/);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const code = m[1].toUpperCase();
      if (!CODE.test(code)) return new Response('Bad room code', { status: 400 });
      return env.ROOMS.getByName(code).fetch(request);
    }
    // Everything else is a static asset (the Vite build); unknown paths get a 404 from the asset layer.
    return env.ASSETS.fetch(request);
  },
};

const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} _\-.!?']/gu, '').slice(0, n).trim();
const BRAWLERS = new Set(['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt']);

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.inMatch = false;
    this.map = 'oasis';
    // Survive hibernation: room-level state is just "match running?" and the host's map pick.
    ctx.blockConcurrencyWhile(async () => {
      this.inMatch = (await ctx.storage.get('inMatch')) || false;
      this.map = (await ctx.storage.get('map')) || 'oasis';
    });
  }

  sockets() { return this.ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN || ws.readyState === 1); }
  info(ws) { return ws.deserializeAttachment() || {}; }
  host() {
    const all = this.sockets();
    return all.find(ws => this.info(ws).host) || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const players = this.sockets();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    if (players.length >= MAX_PLAYERS) {
      server.send(JSON.stringify({ t: 'error', msg: 'Room is full' }));
      server.close(4001, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = crypto.randomUUID().slice(0, 8);
    const brawler = BRAWLERS.has(url.searchParams.get('b')) ? url.searchParams.get('b') : 'blaster';
    const me = {
      id, name: clean(url.searchParams.get('name'), 14) || 'Player',
      brawler, host: !this.host(), joined: Date.now(),
    };
    server.serializeAttachment(me);
    server.send(JSON.stringify({ t: 'welcome', id, code: url.pathname.split('/').pop().toUpperCase() }));
    this.broadcastRoom();
    return new Response(null, { status: 101, webSocket: client });
  }

  roster() {
    return this.sockets().map(ws => this.info(ws)).sort((a, b) => a.joined - b.joined)
      .map(({ id, name, brawler, host }) => ({ id, name, brawler, host }));
  }

  broadcastRoom() {
    const msg = JSON.stringify({ t: 'room', players: this.roster(), inMatch: this.inMatch, map: this.map });
    for (const ws of this.sockets()) ws.send(msg);
  }

  async setMatch(v) {
    this.inMatch = v;
    await this.ctx.storage.put('inMatch', v);
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 64000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = this.info(ws);
    switch (msg.t) {
      case 'pick': // lobby: change brawler
        if (BRAWLERS.has(msg.brawler)) { me.brawler = msg.brawler; ws.serializeAttachment(me); this.broadcastRoom(); }
        break;
      case 'map': // host picks the next map (shown to everyone in the lobby)
        if (me.host && /^[a-z]{2,12}$/.test(msg.map)) {
          this.map = msg.map;
          await this.ctx.storage.put('map', msg.map);
          this.broadcastRoom();
        }
        break;
      case 'in': { // client input -> host only
        const h = this.host();
        if (h && h !== ws) { msg.from = me.id; h.send(JSON.stringify(msg)); }
        break;
      }
      case 'start': // host starts a match: everyone else builds the same roster + map
        if (!me.host) return;
        await this.setMatch(true);
        this.relay(ws, raw);
        this.broadcastRoom();
        break;
      case 'end':
        if (!me.host) return;
        await this.setMatch(false);
        this.broadcastRoom();
        break;
      case 'snap':
      case 'ev': // host -> everyone else
        if (me.host) this.relay(ws, raw);
        break;
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong', at: msg.at }));
        break;
    }
  }

  relay(from, raw) {
    for (const ws of this.sockets()) if (ws !== from) ws.send(raw);
  }

  async webSocketClose(ws, code) {
    const me = this.info(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    const rest = this.sockets().filter(s => s !== ws);
    if (me.host) {
      // promote the longest-connected player; a running match cannot survive losing its host
      const next = rest.map(s => [s, this.info(s)]).sort((a, b) => a[1].joined - b[1].joined)[0];
      if (next) { next[1].host = true; next[0].serializeAttachment(next[1]); }
      if (this.inMatch) {
        await this.setMatch(false);
        for (const s of rest) s.send(JSON.stringify({ t: 'hostLeft' }));
      }
    } else if (this.inMatch) {
      const h = rest.find(s => this.info(s).host);
      if (h) h.send(JSON.stringify({ t: 'left', id: me.id }));
    }
    if (!rest.length) await this.setMatch(false);
    const msg = JSON.stringify({ t: 'room', players: rest.map(s => this.info(s)).sort((a, b) => a.joined - b.joined)
      .map(({ id, name, brawler, host }) => ({ id, name, brawler, host })), inMatch: this.inMatch, map: this.map });
    for (const s of rest) s.send(msg);
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }
}
