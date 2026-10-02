// Records the menu's attract-mode matches for the Godot client (godot/scripts/attract_replay.gd).
//
// The web build plays a live bot match behind the home screen (src/main.js attract(), game.js
// mode 'attract'): your brawler (the "star", it cannot be knocked out and hunts from the first
// second), 7 bots of other types, gas from 18 s then a ring every 6 s, no supply drop, no arena
// event, a new match 3 s after the last K.O. The Godot client has no game rules, so it replays
// recordings of exactly those matches: the same Game as the server (worker/build/sim.js, headless,
// host role) runs offline here with bots only, and everything it would broadcast ('snap' 15 Hz,
// 'ev') is written down. Nothing is sent to any server.
//
//   npx vite build --mode server          # worker/build/sim.js (npm test does it too)
//   node godot/tools/record-attract.mjs [--maps=oasis,grove] [--brawlers=volt] [--per=1]
//
// Output: godot/data/attract/<map>_<brawler>_<n>.json.gz (gzip, read with decompress_dynamic).
// Format v1 (numbers quantized to ints, positions delta-coded per fighter for gzip):
//   { v, map, star, dur (ms), roster: [{id, name, type, cos, spawn}],
//     snaps: [[dt ms since previous, pt x10, [k, dx, dz, facing x50, (hp, maxHp, cubes, flags: when changed)], ...]],
//     evs: [[t ms, [event, ...]], ...] }
// x / z are in cm, coded as the change since that fighter's previous row (its first row: absolute).
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const sim = await import(new URL('../../worker/build/sim.js', import.meta.url));
const { ServerMatch, makeRoster, BRAWLER_KEYS, MAP_KEYS } = sim;

const arg = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const maps = arg('maps', MAP_KEYS.join(',')).split(',').filter(m => MAP_KEYS.includes(m));
const brawlers = arg('brawlers', BRAWLER_KEYS.join(',')).split(',').filter(b => BRAWLER_KEYS.includes(b));
const per = Math.max(1, +arg('per', 1));
const out = new URL('../data/attract/', import.meta.url);
mkdirSync(out, { recursive: true });

const STEP = 1 / 60;
const MAX_T = 150;      // a match that drags on is cut (the replay then starts the next one)

// main.js showcaseRoster: your brawler first, the 7 bots one of a kind against it (none of your type).
function showcaseRoster(star) {
  const roster = makeRoster([]), others = BRAWLER_KEYS.filter(k => k !== star);
  Object.assign(roster[0], { type: star, lo: 'A1', cos: undefined, per: undefined });
  for (const r of roster.slice(1)) if (String(r.type).split(':')[0] === star) r.type = others[Math.floor(Math.random() * others.length)];
  return roster;
}

function record(map, star) {
  const roster = showcaseRoster(star);
  const msgs = [];
  let g = null;
  // game.js updateVisibility in attract mode: nobody is hidden, except on the fog maps, where the
  // camera's brawler (the star) is the viewer: only what it sees is in the snapshot.
  const send = msg => {
    if (msg.t === 'snap' && g && g.visionRadius) {
      const by = new Map(g.brawlers.map(b => [b.id, b]));
      msg = { ...msg, b: msg.b.filter(r => by.get(r[0]) === g.star || g.canSee(g.star, by.get(r[0]))) };
    }
    msgs.push([g ? g.time : 0, msg]);
  };
  const m = new ServerMatch({ map, roster, send, onEnd: () => {} });
  g = m.game;
  // game.js newMatch in attract mode (no localId, not headless) instead of a real match:
  g.mode = 'attract';
  g.star = g.brawlers[0];
  g.drops = [];
  g.events.reset(g.mapKey, Infinity);
  if (g.poison.dispose) g.poison.dispose();
  g.poison = new g.poison.constructor(g, { startAt: 18, interval: 6 });
  try { g.stageStar(); } catch { stage(g); }
  // checkEnd ends a hosted match with no human at once (nobody left to play for): the star
  // counts as one here, so the match ends with a real winner like the web's backdrop.
  const checkEnd = g.checkEnd.bind(g);
  g.checkEnd = () => { const h = g.star.human; g.star.human = true; try { checkEnd(); } finally { g.star.human = h; } };
  for (let i = 0; i < MAX_T / STEP; i++) {
    m.game.serverStep(STEP);
    if (g.restartT >= 0 && g.restartT < 0.15) break;   // game.js restarts the backdrop at 0
  }
  return { roster, msgs, end: g.time, winner: g.brawlers.find(b => b.alive)?.id };
}

// stageStar without the camera / colours (in case the headless build lacks them)
function stage(g) {
  const S = g.star, A = g.arena;
  let best = null, bs = -1;
  for (let j = 6; j < 19; j++) for (let i = 6; i < 19; i++) {
    if (A.get(i, j) !== '.') continue;
    let open = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (A.get(i + di, j + dj) === '.') open++;
    if (open > bs) { bs = open; best = [i, j]; }
  }
  if (best) { const p = A.center(best[0], best[1], S.pos.clone()); S.pos.set(p.x, 0, p.z); S.net.set(p.x, p.z); }
}

function encode(map, star, rec) {
  const ids = rec.roster.map(r => r.id), idx = new Map(ids.map((id, k) => [id, k]));
  const last = new Map();
  const snaps = [], evs = [];
  let prevT = 0;
  for (const [t, msg] of rec.msgs) {
    const ms = Math.round(t * 1000);
    if (msg.t === 'snap') {
      const rows = [];
      for (const r of msg.b) {
        const k = idx.get(r[0]);
        const x = Math.round(r[1] * 100), z = Math.round(r[2] * 100), p = last.get(k);
        // facing in 1/50 rad, wrapped; hp / maxHp / cubes / flags only when they change (no HUD in
        // the menu: ammo and super are left out)
        const f = Math.round(Math.atan2(Math.sin(r[3]), Math.cos(r[3])) * 50);
        const row = [k, p ? x - p[0] : x, p ? z - p[1] : z, f];
        const st = [r[4], r[5], r[8], r[9]];
        if (!p || st.some((v, n) => v !== p[2][n])) row.push(...st);
        rows.push(row);
        last.set(k, [x, z, st]);
      }
      snaps.push([ms - prevT, Math.round(msg.pt * 10), rows]);
      prevT = ms;
    } else if (msg.t === 'ev' && msg.list?.length) evs.push([ms, msg.list]);
  }
  return {
    v: 1, map, star, dur: Math.round(rec.end * 1000), winner: rec.winner,
    roster: rec.roster.map(r => ({ id: r.id, name: r.name, type: r.lo ? `${String(r.type).split(':')[0]}:${r.lo}` : r.type, cos: r.cos, spawn: r.spawn })),
    snaps, evs,
  };
}

for (const f of readdirSync(out)) if (f.endsWith('.json.gz') && maps.some(m => f.startsWith(m + '_')) && brawlers.some(b => f.includes(`_${b}_`))) unlinkSync(new URL(f, out));
let total = 0;
for (const map of maps) for (const star of brawlers) for (let n = 0; n < per; n++) {
  // keep matches the star wins before the cut (on the isles it can still fall into the void)
  let rec = record(map, star);
  for (let k = 0; k < 8 && (rec.winner !== rec.roster[0].id || rec.end >= MAX_T - 1); k++) rec = record(map, star);
  const data = encode(map, star, rec);
  const gz = gzipSync(JSON.stringify(data), { level: 9 });
  const name = `${map}_${star}_${n}.json.gz`;
  writeFileSync(new URL(name, out), gz);
  total += gz.length;
  const kos = data.evs.reduce((s, [, l]) => s + l.filter(e => e.e === 'kill').length, 0);
  console.log(`${name}  ${(rec.end).toFixed(1)} s  ${data.snaps.length} snaps  ${kos} K.O.  winner ${rec.winner}  ${(gz.length / 1024).toFixed(1)} KB`);
}
console.log(`total ${(total / 1024).toFixed(0)} KB`);
