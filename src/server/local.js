import { ServerMatch, makeRoster, randomMap, MAP_KEYS, BRAWLER_KEYS, validLoadout, validCos, COS_DEFAULT, weeklyMutator } from './sim.js';

// Local room (`vite build --mode localsim` -> godot/local/sim_local.js): the Cloudflare room
// (worker/index.js RoomObject) for ONE local human and bots, run inside the client itself, so solo
// and the training dojo play offline. Same messages out (welcome, room, start, lprog, go, snap, ev,
// pong) and in (pick, map, mode, chaos, start, lprog, loaded, in, ping) as the room socket, so the
// Godot client swaps NetClient for LocalRoom without touching its message handling.
//
// No timers, no I/O: the host engine drives it. Godot calls, with JSON strings only (the same API
// through JavaScriptBridge on the web and through the embedded QuickJS on native builds):
//   SlopLocal.open(optsJson) -> room id      opts: { name, brawler, lo, cos, level, dojo, plat }
//   SlopLocal.send(id, msgJson)               one client message
//   SlopLocal.poll(id, seconds) -> json       advance real time, return the messages for the client
//   SlopLocal.close(id)

const LOAD_WAIT = 25;   // s, like the room: the loading screen waits at most this long
const COUNTDOWN = 3;    // s of 3-2-1 before the simulation runs
const MAX_MATCH = 12 * 60; // s, safety net
const ME = 'local';

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

class LocalRoom {
  constructor(o = {}) {
    const brawler = BRAWLER_KEYS.includes(String(o.brawler).split(':')[0]) ? String(o.brawler).split(':')[0] : 'blaster';
    this.me = {
      id: ME, name: clean(o.name, 14) || 'Player', brawler, host: true, plat: o.plat || 'steam',
      lo: validLoadout(o.lo) ? o.lo : 'A1', cos: validCos(o.cos) ? o.cos : COS_DEFAULT,
    };
    this.level = Math.min(1, Math.max(0, Number.isFinite(+o.level) ? +o.level : 0.45));
    this.dojo = !!o.dojo;
    this.map = 'random';
    this.gm = 'solo';
    this.chaos = false;
    this.match = null;
    this.clock = 0;      // s since the room opened (the room's own clock: no setTimeout here)
    this.timers = [];    // [at, fn]
    this.out = [];
    this.stepMs = 0;     // cost of the simulation in the last poll (measurement)
    this.push({ t: 'welcome', id: ME, code: 'LOCAL', matchmade: false });
    this.pushRoom();
  }

  push(msg) { this.out.push(msg); }
  roomMsg() {
    const { id, name, brawler, host, plat, cos } = this.me;
    return { t: 'room', players: [{ id, name, brawler, host, plat, cos }], inMatch: !!this.match, map: this.map, chaos: this.chaos, matchmade: false, mode: this.gm, pq: false, local: true, dojo: this.dojo };
  }
  pushRoom() { this.push(this.roomMsg()); }
  later(s, fn) { this.timers.push([this.clock + s, fn]); }

  startMatch() {
    if (this.match) return;
    const map = MAP_KEYS.includes(this.map) ? this.map : randomMap();
    const { id, name, brawler, lo, cos, plat } = this.me;
    const roster = makeRoster([{ id, name, type: brawler, lo, cos, plat }], { level: this.level, duo: !this.dojo && this.gm === 'duo' });
    const mut = this.chaos && !this.dojo ? weeklyMutator() : null;
    this.match = new ServerMatch({
      map, roster, mut, dojo: this.dojo,
      send: msg => this.push(msg),
      sendTo: (to, msg) => { if (to === ME) this.push(msg); },
      onEnd: () => this.endMatch(),
      onCheat: null, // nobody to kick: refused moves only snap the player back
    });
    this.running = false;
    this.loading = true;
    this.started = 0;
    this.push({ t: 'start', map, roster, mut, wait: LOAD_WAIT * 1000, dojo: this.dojo });
    this.pushRoom();
    this.later(LOAD_WAIT, () => this.go());
  }

  go() {
    if (!this.match || !this.loading) return;
    this.loading = false;
    this.push({ t: 'go', in: COUNTDOWN * 1000 });
    const m = this.match;
    this.later(COUNTDOWN, () => { if (this.match === m) { this.running = true; this.started = this.clock; } });
  }

  endMatch() {
    this.match = null;
    this.running = false;
    this.loading = false;
    this.timers = [];
    this.pushRoom();
  }

  send(msg) {
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch { return; } }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'in':
        if (this.match && this.running) this.match.input({ ...msg, from: ME });
        break;
      case 'lprog':
        if (this.loading && Number.isFinite(msg.p)) this.push({ t: 'lprog', id: ME, p: Math.max(0, Math.min(99, Math.round(msg.p))) });
        break;
      case 'loaded':
        if (this.match && this.loading) { this.push({ t: 'lprog', id: ME, p: 100 }); this.go(); }
        break;
      case 'pick':
        if (BRAWLER_KEYS.includes(String(msg.brawler).split(':')[0])) {
          this.me.brawler = String(msg.brawler).split(':')[0];
          if (validLoadout(msg.lo)) this.me.lo = msg.lo;
          if (validCos(msg.cos)) this.me.cos = msg.cos;
          this.pushRoom();
        }
        break;
      case 'map':
        if (msg.map === 'random' || MAP_KEYS.includes(msg.map)) { this.map = msg.map; this.pushRoom(); }
        break;
      case 'mode':
        if (!this.match) { this.gm = msg.mode === 'duo' ? 'duo' : 'solo'; this.pushRoom(); }
        break;
      case 'chaos':
        this.chaos = !!msg.on; this.pushRoom();
        break;
      case 'dojo': // training on / off (the client opens the room in one or the other)
        if (!this.match) { this.dojo = !!msg.on; this.pushRoom(); }
        break;
      case 'start':
        if (!this.match) this.startMatch();
        break;
      case 'ping':
        this.push({ t: 'pong', at: msg.at });
        break;
    }
  }

  // Advance by real elapsed time; the match itself steps at a fixed 1/60 s (ServerMatch.advance).
  poll(seconds) {
    const dt = Math.max(0, Math.min(1, +seconds || 0));
    this.clock += dt;
    for (let k = 0; k < this.timers.length; k++) {
      if (this.clock >= this.timers[k][0]) { const fn = this.timers.splice(k--, 1)[0][1]; fn(); }
    }
    this.stepMs = 0;
    if (this.match && this.running) {
      const t0 = now();
      try { this.match.advance(dt); } catch (e) {
        this.push({ t: 'error', code: 'sim', msg: String(e && e.stack || e) });
        this.endMatch();
      }
      this.stepMs = now() - t0;
      if (this.match && this.clock - this.started > MAX_MATCH) this.endMatch();
    }
    const out = this.out;
    this.out = [];
    return out;
  }
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const rooms = new Map();
let seq = 0;
export const SlopLocal = {
  version: 1,
  open(opts) {
    let o = opts;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = {}; } }
    const id = ++seq;
    rooms.set(id, new LocalRoom(o || {}));
    return id;
  },
  send(id, msg) { const r = rooms.get(+id); if (r) r.send(msg); },
  poll(id, seconds) { const r = rooms.get(+id); return JSON.stringify(r ? r.poll(seconds) : []); },
  stepMs(id) { const r = rooms.get(+id); return r ? r.stepMs : 0; },
  close(id) { rooms.delete(+id); },
  room(id) { return rooms.get(+id) || null; }, // tests / measurements (JS side only)
};
globalThis.SlopLocal = SlopLocal;
