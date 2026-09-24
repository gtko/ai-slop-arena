import { DurableObject } from 'cloudflare:workers';
import { ServerMatch, makeRoster, randomMap, BRAWLER_KEYS, MAP_KEYS } from './build/sim.js';

// AI SLOP ARENA — online server.
//
// The Worker serves the built site/game from static assets and routes:
//   /ws/<ROOM>   one Room Durable Object per room: it RUNS the match (src/server/sim.js, the same
//                game rules as the clients, headless). Players only send their inputs; the room
//                validates them and sends each player only what that player can see.
//   /mm          the Matchmaker (one global object): a cross-platform queue that fills rooms.
//   /api/report  player reports (also used by Steam P2P lobbies, which have no server of ours).
//   /api/bug     bug reports from the in-game form (text, technical info, optional screenshot).
//   /admin/*     moderation API (reports, bans), enabled once the ADMIN_TOKEN secret is set.
// Steam friend lobbies (src/steamnet.js) stay peer-to-peer: a player hosts, with the same checks.

const PROTOCOL = 2;          // clients send ?v=2; older builds are told to update
const MAX_PLAYERS = 8;
const CODE = /^[A-Z0-9]{4,6}$/;
const QUEUE_BOTS_AFTER = 5 * 60 * 1000; // matchmaking: after 5 minutes, bots fill the match
const MATCHED_WAIT = 15 * 1000;         // a matched room starts when everyone is in, or after 15 s
const CHEAT_KICK = 25;                  // refused moves in one match before the player is kicked
const MSG_PER_SEC = 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]+)$/);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const code = m[1].toUpperCase();
      if (!CODE.test(code)) return new Response('Bad room code', { status: 400 });
      return env.ROOMS.getByName(code).fetch(withIdentity(request));
    }
    if (url.pathname === '/mm') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return env.MATCHMAKER.getByName('global').fetch(withIdentity(request));
    }
    // The apps (desktop app://, mobile https://localhost) call these from another origin: CORS.
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (url.pathname === '/api/report' && request.method === 'POST') return cors(await apiReport(request, env));
      if (url.pathname === '/api/bug' && request.method === 'POST') return cors(await apiBug(request, env));
    }
    if (url.pathname.startsWith('/admin/')) return admin(request, env, url);
    // Everything else is a static asset (the Vite build); unknown paths get a 404 from the asset layer.
    return env.ASSETS.fetch(request);
  },
};

/* ------------------------------ identity ------------------------------ */

// Players have no account: a random id the client keeps (cid), the platform, and a hash of the IP
// (never the IP itself) so a ban survives clearing the browser.
async function ipKey(request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('iaslop:' + ip));
  return 'ip:' + [...new Uint8Array(h).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function withIdentity(request) {
  const r = new Request(request);
  r.headers.set('x-iaslop-ip', request.headers.get('CF-Connecting-IP') || '');
  return r;
}
async function identity(request, url) {
  const raw = (url.searchParams.get('cid') || '').replace(/[^\w-]/g, '').slice(0, 40);
  const cid = raw.length >= 8 ? 'cid:' + raw : '';
  const plat = /^(web|steam|epic|android|ios)$/.test(url.searchParams.get('plat')) ? url.searchParams.get('plat') : 'web';
  const fake = new Request('http://x', { headers: { 'CF-Connecting-IP': request.headers.get('x-iaslop-ip') || '' } });
  return { cid, plat, ip: await ipKey(fake) };
}

const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} _\-.!?']/gu, '').slice(0, n).trim();
const BRAWLERS = new Set(BRAWLER_KEYS);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' };
const cors = r => { for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v); return r; };
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json' } });

// Refuse a WebSocket with a message the client shows ({ t: 'error', code, msg }: the client
// translates known codes, older clients show msg).
function refuse(msg, code = '') {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ t: 'error', code, msg }));
  server.close(4003, 'refused');
  return new Response(null, { status: 101, webSocket: client });
}
const OUTDATED = 'This version of the game is out of date: refresh the page or update the app.';

/* ------------------------------ Room ------------------------------ */

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.match = null;      // ServerMatch while a match runs (in memory: the loop keeps us awake)
    this.map = 'random';
    this.kicked = new Set(); // identities kicked from this room
    this.rate = new Map();   // socket -> { t, n } message counter
    ctx.blockConcurrencyWhile(async () => {
      this.map = (await ctx.storage.get('map')) || 'random';
      this.preset = (await ctx.storage.get('preset')) || null; // matchmade room: { expect, map, deadline }
      this.kicked = new Set((await ctx.storage.get('kicked')) || []);
    });
  }

  get inMatch() { return !!this.match; }
  sockets() { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1); }
  info(ws) { return ws.deserializeAttachment() || {}; }
  byId(id) { return this.sockets().find(ws => this.info(ws).id === id) || null; }
  code() { return this.roomCode || ''; }

  // Called by the Matchmaker before sending players here.
  async prepare({ expect, map }) {
    this.preset = { expect, map: MAP_KEYS.includes(map) ? map : randomMap(), deadline: Date.now() + MATCHED_WAIT };
    await this.ctx.storage.put('preset', this.preset);
    await this.ctx.storage.setAlarm(this.preset.deadline);
  }

  async alarm() {
    if (this.preset && !this.inMatch && this.sockets().length) this.startMatch(this.preset.map);
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.roomCode = url.pathname.split('/').pop().toUpperCase();
    if (+url.searchParams.get('v') !== PROTOCOL) return refuse(OUTDATED, 'outdated');
    const who = await identity(request, url);
    const ban = await this.env.MOD.getByName('global').isBanned([who.cid, who.ip]);
    if (ban) return refuse(ban, 'banned');
    if (this.kicked.has(who.cid) || this.kicked.has(who.ip)) return refuse('You were removed from this room.', 'kicked');
    if (this.sockets().length >= MAX_PLAYERS) return refuse('Room is full', 'full');

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const brawler = BRAWLERS.has(url.searchParams.get('b')) ? url.searchParams.get('b') : 'blaster';
    const me = {
      id: crypto.randomUUID().slice(0, 8), name: clean(url.searchParams.get('name'), 14) || 'Player', brawler,
      // matchmade rooms have no leader (nobody may kick or change the map)
      host: !this.preset && !this.sockets().some(ws => ws !== server && this.info(ws).host),
      joined: Date.now(), ...who,
      lvl: Math.min(1, Math.max(0, parseFloat(url.searchParams.get('lvl')) || 0.45)), // bot tuning
    };
    server.serializeAttachment(me);
    server.send(JSON.stringify({ t: 'welcome', id: me.id, code: this.code(), matchmade: !!this.preset }));
    this.broadcastRoom();
    if (this.preset && !this.inMatch && this.sockets().length >= this.preset.expect) this.startMatch(this.preset.map);
    return new Response(null, { status: 101, webSocket: client });
  }

  roster() {
    return this.sockets().map(ws => this.info(ws)).sort((a, b) => a.joined - b.joined)
      .map(({ id, name, brawler, host, plat }) => ({ id, name, brawler, host, plat }));
  }
  broadcastRoom() {
    this.broadcast({ t: 'room', players: this.roster(), inMatch: this.inMatch, map: this.map, matchmade: !!this.preset });
  }
  broadcast(msg) {
    const raw = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const ws of this.sockets()) ws.send(raw);
  }

  startMatch(mapPick) {
    if (this.inMatch) return;
    const humans = this.sockets().map(ws => this.info(ws)).sort((a, b) => a.joined - b.joined);
    if (!humans.length) return;
    const map = MAP_KEYS.includes(mapPick) ? mapPick : randomMap();
    // bots are a mix around the players' average level
    const level = humans.reduce((sum, p) => sum + (p.lvl ?? 0.45), 0) / humans.length;
    const roster = makeRoster(humans.map(p => ({ id: p.id, name: p.name, type: p.brawler })), { level });
    this.match = new ServerMatch({
      map, roster,
      send: msg => this.broadcast(msg),
      sendTo: (id, msg) => { const ws = this.byId(id); if (ws) ws.send(JSON.stringify(msg)); },
      onEnd: () => this.endMatch(),
      onCheat: (id, kind, strikes) => {
        if (strikes === CHEAT_KICK) this.kick(this.byId(id), 'cheat', 'auto: ' + kind, 'server');
      },
    });
    this.matchSeq = (this.matchSeq || 0) + 1;
    this.matchId = `${this.code()}#${Date.now().toString(36)}${this.matchSeq}`;
    // every human's match count: report-based bans are a share of the matches played
    this.env.MOD.getByName('global').played(humans.map(p => p.cid || p.ip), this.matchId);
    this.broadcast({ t: 'start', map, roster });
    this.broadcastRoom();
    this.last = Date.now();
    this.started = Date.now();
    this.loop = setInterval(() => this.tick(), 50);
  }

  // The match advances by real time, from the loop and from every input that arrives.
  tick() {
    if (!this.match) return;
    const now = Date.now();
    this.match.advance((now - this.last) / 1000);
    this.last = now;
    if (now - this.started > 12 * 60 * 1000) this.endMatch(); // safety net
  }

  async endMatch() {
    clearInterval(this.loop);
    this.match = null;
    if (this.preset) { // a matchmade room becomes a normal room: the first player can start a rematch
      this.preset = null;
      await this.ctx.storage.delete('preset');
      const first = this.sockets().map(ws => [ws, this.info(ws)]).sort((a, b) => a[1].joined - b[1].joined)[0];
      if (first) { first[1].host = true; first[0].serializeAttachment(first[1]); }
    }
    this.broadcastRoom();
  }

  // code: 'cheat' (the server caught impossible moves) or 'leader' (the room leader removed them)
  // by: 'server' (counts toward the cheating ban) or the leader's id (counts as a report from them)
  async kick(ws, code, why, by) {
    if (!ws) return;
    const me = this.info(ws);
    for (const k of [me.cid, me.ip]) if (k && k.length > 4) this.kicked.add(k);
    await this.ctx.storage.put('kicked', [...this.kicked]);
    await this.env.MOD.getByName('global').report({
      reporter: by, target: me.cid || me.ip, ip: me.ip, name: me.name, plat: me.plat, reason: why, room: this.code(),
      match: this.matchId || '', auto: by === 'server' ? 1 : 0,
    });
    const msg = code === 'cheat' ? 'You were removed: impossible moves (speed or teleport).' : 'The room leader removed you.';
    try { ws.send(JSON.stringify({ t: 'kicked', code, msg })); ws.close(4004, 'kicked'); } catch { /* gone */ }
    await this.webSocketClose(ws, 4004);
  }

  limited(ws) {
    const now = Date.now(), r = this.rate.get(ws) || { t: now, n: 0 };
    if (now - r.t >= 1000) { r.t = now; r.n = 0; }
    r.n++;
    this.rate.set(ws, r);
    return r.n > MSG_PER_SEC;
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 4000 || this.limited(ws)) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = this.info(ws);
    switch (msg.t) {
      case 'in': // input -> the match (the only thing players send while playing)
        if (this.match) { this.match.input({ ...msg, from: me.id }); this.tick(); }
        break;
      case 'pick':
        if (BRAWLERS.has(msg.brawler)) { me.brawler = msg.brawler; ws.serializeAttachment(me); this.broadcastRoom(); }
        break;
      case 'map':
        if (me.host && (msg.map === 'random' || MAP_KEYS.includes(msg.map))) {
          this.map = msg.map;
          await this.ctx.storage.put('map', msg.map);
          this.broadcastRoom();
        }
        break;
      case 'start':
        if (me.host && !this.inMatch) this.startMatch(this.map);
        break;
      case 'kick': { // room leader only, not in matchmade rooms
        const target = this.byId(msg.id);
        if (me.host && !this.preset && target && target !== ws) await this.kick(target, 'leader', 'kicked by leader', me.cid || me.ip);
        break;
      }
      case 'report': {
        const target = this.byId(msg.id);
        if (!target || target === ws) break;
        const t = this.info(target);
        const out = await this.env.MOD.getByName('global').report({
          reporter: me.cid || me.ip, target: t.cid || t.ip, ip: t.ip, name: t.name, plat: t.plat, reason: clean(msg.reason, 40),
          room: this.code(), match: this.matchId || '', auto: 0,
        });
        ws.send(JSON.stringify({ t: 'reported', id: msg.id, ok: out.ok }));
        break;
      }
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong', at: msg.at }));
        break;
    }
  }

  async webSocketClose(ws, code) {
    const me = this.info(ws);
    this.rate.delete(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    const rest = this.sockets().filter(s => s !== ws);
    if (me.host) { // the longest-connected player leads now; the match itself goes on (we run it)
      const next = rest.map(s => [s, this.info(s)]).sort((a, b) => a[1].joined - b[1].joined)[0];
      if (next && !this.preset) { next[1].host = true; next[0].serializeAttachment(next[1]); }
    }
    if (this.match) {
      this.match.left(me.id); // the brawler keeps fighting as a bot
      if (!rest.length) await this.endMatch();
    }
    const players = rest.map(s => this.info(s)).sort((a, b) => a.joined - b.joined)
      .map(({ id, name, brawler, host, plat }) => ({ id, name, brawler, host, plat }));
    const msg = JSON.stringify({ t: 'room', players, inMatch: this.inMatch, map: this.map, matchmade: !!this.preset });
    for (const s of rest) s.send(msg);
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }
}

/* ------------------------------ Matchmaker ------------------------------ */

// One global queue for every platform (web, Steam, Epic, Android, iOS). 8 players -> a match right
// away; otherwise the oldest player's wait decides: after 5 minutes, whoever is queued plays and
// bots fill the empty slots. "Play now with bots" skips the wait for one player.
export class Matchmaker extends DurableObject {
  sockets() { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1 && !this.info(ws).matched); }
  info(ws) { return ws.deserializeAttachment() || {}; }
  queue() { return this.sockets().sort((a, b) => this.info(a).joined - this.info(b).joined); }

  async fetch(request) {
    const url = new URL(request.url);
    if (+url.searchParams.get('v') !== PROTOCOL) return refuse(OUTDATED, 'outdated');
    const who = await identity(request, url);
    const ban = await this.env.MOD.getByName('global').isBanned([who.cid, who.ip]);
    if (ban) return refuse(ban, 'banned');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ joined: Date.now(), name: clean(url.searchParams.get('name'), 14) || 'Player', ...who });
    this.ensureLoop();
    this.tick();
    return new Response(null, { status: 101, webSocket: client });
  }

  ensureLoop() { if (!this.loop) this.loop = setInterval(() => this.tick(), 1000); }

  async tick() {
    const q = this.queue(), now = Date.now();
    if (!q.length) { clearInterval(this.loop); this.loop = null; return; }
    if (q.length >= MAX_PLAYERS) return this.makeMatch(q.slice(0, MAX_PLAYERS));
    const oldest = now - this.info(q[0]).joined;
    const botsAfter = +this.env.QUEUE_BOTS_AFTER_MS || QUEUE_BOTS_AFTER; // the env var is for tests only
    if (oldest >= botsAfter) return this.makeMatch(q.slice(0, MAX_PLAYERS));
    const plats = {};
    for (const ws of q) plats[this.info(ws).plat] = (plats[this.info(ws).plat] || 0) + 1;
    for (const ws of q) {
      ws.send(JSON.stringify({ t: 'queue', n: q.length, need: MAX_PLAYERS, waited: now - this.info(ws).joined,
        botsIn: Math.max(0, botsAfter - oldest), plats }));
    }
  }

  async makeMatch(group) {
    for (const ws of group) { const i = this.info(ws); i.matched = true; ws.serializeAttachment(i); }
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'Q';
    for (let i = 0; i < 5; i++) code += A[Math.floor(Math.random() * A.length)];
    await this.env.ROOMS.getByName(code).prepare({ expect: group.length, map: randomMap() });
    for (const ws of group) {
      try { ws.send(JSON.stringify({ t: 'matched', code, players: group.length })); ws.close(1000, 'matched'); } catch { /* left */ }
    }
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'bots' && !this.info(ws).matched) await this.makeMatch([ws]); // play now, bots fill up
  }

  async webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch { /* closed */ } this.tick(); }
  async webSocketError(ws) { await this.webSocketClose(ws); }
}

/* ------------------------------ Moderation ------------------------------ */

// Reports and bans (SQLite in one global object). Automatic rules:
//   - reports: a share of the matches played, so a handful of sore losers cannot ban anyone.
//     Over the last 7 days: at least 10 matches played on our server, reported in at least 30% of
//     them, by at least 4 different players (a match counts once however many report it) ->
//     that device banned for 24 h, 7 days if it happens again within 30 days.
//   - cheating proven by the server (kicked 3 times for impossible moves within 7 days) -> device
//     and IP banned for 7 days. Only proven cheating bans an IP: IPs are often shared.
// Steam P2P lobby reports are only recorded (we do not see those matches): review them by hand.
const DAY = 24 * 3600 * 1000;
const REPORT_WINDOW = 7 * DAY, MIN_MATCHES = 10, MIN_REPORTERS = 4, REPORTED_SHARE = 0.3;

export class Moderation extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS bans (key TEXT PRIMARY KEY, reason TEXT, until INTEGER, created INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, reporter TEXT,
      target TEXT, ip TEXT, name TEXT, plat TEXT, reason TEXT, room TEXT, auto INTEGER)`);
    try { this.sql.exec('ALTER TABLE reports ADD COLUMN match TEXT'); } catch { /* already there */ }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plays (key TEXT, match TEXT, at INTEGER)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS plays_key ON plays (key, at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ban_log (key TEXT, at INTEGER, days INTEGER, reason TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS bugs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, sender TEXT,
      text TEXT, info TEXT, shot TEXT, status TEXT DEFAULT 'new')`);
  }

  // A match started on our server with these players (device ids).
  played(keys, match) {
    const now = Date.now();
    for (const k of keys) if (k) this.sql.exec('INSERT INTO plays (key, match, at) VALUES (?,?,?)', k, match, now);
    if (Math.random() < 0.02) this.sql.exec('DELETE FROM plays WHERE at < ?', now - 30 * DAY); // keep it small
    // reports can predate the 10th match: check the reported players again as their count grows
    for (const k of keys) {
      if (k && this.sql.exec('SELECT 1 FROM reports WHERE target = ? AND auto = 0 AND at > ? LIMIT 1', k, now - REPORT_WINDOW).toArray().length) this.evaluate(k);
    }
  }

  // The report rule (see above), run after every report and every match of a reported player.
  evaluate(key) {
    const st = this.standing(key);
    if (st.played < MIN_MATCHES || st.reporters < MIN_REPORTERS || st.share < REPORTED_SHARE || this.isBanned([key])) return;
    const before = this.sql.exec('SELECT COUNT(*) AS n FROM ban_log WHERE key = ? AND at > ?', key, Date.now() - 30 * DAY).one().n;
    this.ban(key, `reported in ${Math.round(st.share * 100)}% of ${st.played} matches`, before ? 7 : 1);
  }

  // Matches played, matches with at least one report, distinct reporters (last 7 days).
  standing(key, since = Date.now() - REPORT_WINDOW) {
    const played = this.sql.exec('SELECT COUNT(DISTINCT match) AS n FROM plays WHERE key = ? AND at > ?', key, since).one().n;
    const reported = this.sql.exec(`SELECT COUNT(DISTINCT match) AS n FROM reports WHERE target = ? AND auto = 0 AND at > ?
      AND match IN (SELECT match FROM plays WHERE key = ? AND at > ?)`, key, since, key, since).one().n;
    const reporters = this.sql.exec('SELECT COUNT(DISTINCT reporter) AS n FROM reports WHERE target = ? AND auto = 0 AND at > ?', key, since).one().n;
    return { played, reported, reporters, share: played ? reported / played : 0 };
  }

  isBanned(keys) {
    const now = Date.now();
    for (const k of keys) {
      if (!k || k === 'cid:') continue;
      const row = this.sql.exec('SELECT reason, until FROM bans WHERE key = ?', k).toArray()[0];
      if (row && (!row.until || row.until > now)) {
        const until = row.until ? ` until ${new Date(row.until).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
        return `You are banned${until}${row.reason ? ` (${row.reason})` : ''}.`;
      }
    }
    return null;
  }

  report(r) {
    const now = Date.now();
    if (!r.target) return { ok: false };
    // one report per reporter, target and match
    if (!r.auto && r.match && this.sql.exec('SELECT 1 FROM reports WHERE reporter = ? AND target = ? AND match = ? LIMIT 1',
      r.reporter, r.target, r.match).toArray().length) return { ok: true };
    // a player can file at most 20 reports a day
    const mine = this.sql.exec('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND at > ?', r.reporter, now - DAY).one().n;
    if (!r.auto && mine >= 20) return { ok: false };
    this.sql.exec('INSERT INTO reports (at, reporter, target, ip, name, plat, reason, room, auto, match) VALUES (?,?,?,?,?,?,?,?,?,?)',
      now, r.reporter, r.target, r.ip || '', r.name || '', r.plat || '', r.reason || '', r.room || '', r.auto ? 1 : 0, r.match || '');
    if (r.auto) {
      const kicks = this.sql.exec('SELECT COUNT(*) AS n FROM reports WHERE target = ? AND auto = 1 AND at > ?', r.target, now - 7 * DAY).one().n;
      if (kicks >= 3) this.ban(r.target, 'cheating', 7, r.ip);
    } else if (r.match) this.evaluate(r.target);
    return { ok: true };
  }

  ban(key, reason = '', days = 0, ip = null) {
    const until = days ? Date.now() + days * DAY : 0;
    for (const k of [key, ip]) {
      if (k) this.sql.exec('INSERT OR REPLACE INTO bans (key, reason, until, created) VALUES (?,?,?,?)', k, reason, until, Date.now());
    }
    this.sql.exec('INSERT INTO ban_log (key, at, days, reason) VALUES (?,?,?,?)', key, Date.now(), days, reason);
    return { ok: true, until };
  }

  unban(key) { this.sql.exec('DELETE FROM bans WHERE key = ?', key); return { ok: true }; }

  // Bug reports: at most 10 a day per sender; the screenshot is a small JPEG data URL.
  bug({ sender, text, info, shot }) {
    const n = this.sql.exec('SELECT COUNT(*) AS n FROM bugs WHERE sender = ? AND at > ?', sender, Date.now() - DAY).one().n;
    if (n >= 10) return { ok: false, error: 'limit' };
    this.sql.exec('INSERT INTO bugs (at, sender, text, info, shot) VALUES (?,?,?,?,?)', Date.now(), sender, text, info, shot || '');
    return { ok: true };
  }
  bugs(status) {
    return this.sql.exec(`SELECT id, at, sender, text, info, status, LENGTH(shot) > 0 AS has_shot FROM bugs
      ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 200`, ...(status ? [status] : [])).toArray()
      .map(b => ({ ...b, info: JSON.parse(b.info || '{}') }));
  }
  bugShot(id) { const r = this.sql.exec('SELECT shot FROM bugs WHERE id = ?', id).toArray()[0]; return r ? r.shot : ''; }
  bugStatus(id, status) { this.sql.exec('UPDATE bugs SET status = ? WHERE id = ?', status, id); return { ok: true }; }

  list() {
    const reports = this.sql.exec(`SELECT target, name, plat, COUNT(*) AS reports, SUM(auto) AS auto_kicks, MAX(at) AS last,
      GROUP_CONCAT(DISTINCT reason) AS reasons, MAX(ip) AS ip FROM reports GROUP BY target ORDER BY last DESC LIMIT 200`).toArray();
    for (const r of reports) Object.assign(r, this.standing(r.target)); // matches played / reported, last 7 days
    return { bans: this.sql.exec('SELECT * FROM bans ORDER BY created DESC LIMIT 200').toArray(), reports };
  }
}

// POST /api/report { target, name, reason, plat } — reports from Steam P2P lobbies.
async function apiReport(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  const target = String(body.target || '').replace(/[^\w:-]/g, '').slice(0, 60);
  if (!target) return json({ ok: false }, 400);
  const reporter = (await ipKey(request));
  const out = await env.MOD.getByName('global').report({
    reporter, target, name: clean(body.name, 14), plat: clean(body.plat, 10), reason: clean(body.reason, 40), room: 'steam-p2p', auto: 0,
  });
  return json(out);
}

// POST /api/bug { text, info, shot } — the in-game bug report form (src/bugreport.js).
async function apiBug(request, env) {
  const raw = await request.text();
  if (raw.length > 400_000) return json({ ok: false, error: 'too big' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false }, 400); }
  const text = String(body.text || '').slice(0, 2000).trim();
  if (!text) return json({ ok: false, error: 'empty' }, 400);
  const shot = typeof body.shot === 'string' && body.shot.startsWith('data:image/jpeg;base64,') ? body.shot : '';
  const info = JSON.stringify(body.info && typeof body.info === 'object' ? body.info : {}).slice(0, 8000);
  return json(await env.MOD.getByName('global').bug({ sender: await ipKey(request), text, info, shot }));
}

// Moderation API. Needs the ADMIN_TOKEN secret (npx wrangler secret put ADMIN_TOKEN) and
// "Authorization: Bearer <token>". Without the secret it does not exist.
async function admin(request, env, url) {
  if (!env.ADMIN_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return new Response('Not found', { status: 404 });
  const mod = env.MOD.getByName('global');
  if (url.pathname === '/admin/reports' && request.method === 'GET') return json(await mod.list());
  if (url.pathname === '/admin/bugs' && request.method === 'GET') return json(await mod.bugs(url.searchParams.get('status')));
  const shot = url.pathname.match(/^\/admin\/bugs\/(\d+)\/shot$/);
  if (shot && request.method === 'GET') {
    const data = await mod.bugShot(+shot[1]);
    if (!data) return new Response('No screenshot', { status: 404 });
    return new Response(Uint8Array.from(atob(data.split(',')[1]), c => c.charCodeAt(0)), { headers: { 'content-type': 'image/jpeg' } });
  }
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (url.pathname === '/admin/ban') return json(await mod.ban(String(body.key || ''), clean(body.reason, 60), +body.days || 0, body.ip || null));
  if (url.pathname === '/admin/unban') return json(await mod.unban(String(body.key || '')));
  if (url.pathname === '/admin/bug') return json(await mod.bugStatus(+body.id, String(body.status || 'done').slice(0, 20)));
  return new Response('Not found', { status: 404 });
}
