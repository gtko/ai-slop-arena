// Stages a short scripted scene for every gadget and star power (the home screen's ability previews,
// godot/scripts/ability_preview.gd), with the real rules: the same Game as the server
// (worker/build/sim.js, headless, host role) runs offline here, the brawlers are driven by a script
// instead of players or bots, and everything the host would broadcast ('snap', 'ev') is written down
// for the Godot recorder (tools/record_abilities.gd), which replays it through the match's own nodes
// and films it. Nothing is sent to any server: the numbers on screen are the rules' numbers.
//
//   npx vite build --mode server                 # worker/build/sim.js (npm test does it too)
//   node godot/tools/stage-abilities.mjs [--only=gad_voltB,star_surge]
//
// Output: godot/build/abilities/<clip>.json (not committed; the clips are), one per ability:
//   { v: 1, clip, map, edits: [[i, j, ch]], roster: [{id, type, name}], from, to, cam: [x, z, zoom],
//     snaps: [[t, {t: 'snap', pt, b: rows}]], evs: [[t, [event, ...]]] }
// t in seconds from the start of the staging (the clip is [from, to]); rows are the protocol's
// [id, x, z, facing, hp, maxHp, ammo, super, cubes, flags], with only the brawlers the star can see
// (bushes, like a real player's snapshot).
import { mkdirSync, writeFileSync } from 'node:fs';

const sim = await import(new URL('../../worker/build/sim.js', import.meta.url));
const { ServerMatch } = sim;

const arg = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const only = arg('only', '').split(',').filter(Boolean);
const out = new URL('../build/abilities/', import.meta.url);
mkdirSync(out, { recursive: true });

const STEP = 1 / 60;
const PRE = 0.6;                 // staged before the clip starts (spawn pop, idle settles)
const N = 25, TILE = 2;
const tileOf = v => Math.floor(v / TILE + N / 2);
// The stage: the middle of Oasis, cleared to open sand (tiles 6..18 x 8..16); each scene adds its
// walls, bushes or water there.
const CLEAR = { i0: 6, i1: 18, j0: 8, j1: 16 };

// ------------------------------------------------------------------ script helpers
// S.star, S.d[k]: the brawlers. Directions are toward a brawler or a point [x, z].
const at = (S, w) => Array.isArray(w) ? { x: w[0], z: w[1] } : { x: w.pos.x, z: w.pos.z };
const dirTo = (b, p) => { const dx = p.x - b.pos.x, dz = p.z - b.pos.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
const atk = (who, w) => S => { const b = who(S), p = at(S, w(S)), [dx, dz] = dirTo(b, p); S.g.tryAttack(b, dx, dz, { x: p.x, y: 0, z: p.z }, false); };
const sup = (who, w) => S => { const b = who(S), p = at(S, w(S)), [dx, dz] = dirTo(b, p); b.superCharge = 1; S.g.tryAttack(b, dx, dz, { x: p.x, y: 0, z: p.z }, true); };
const gad = (who, w) => S => { const b = who(S), p = at(S, w(S)), [dx, dz] = dirTo(b, p); S.g.useGadget(b, dx, dz, { x: p.x, y: 0, z: p.z }); };
const walk = (who, dx, dz) => S => { const b = who(S), l = Math.hypot(dx, dz) || 1; b.moveIntent.set(dx / l, 0, dz / l); };
const stop = who => S => { who(S).moveIntent.set(0, 0, 0); };
const star = S => S.star, d = k => S => S.d[k];
const P = (x, z) => () => [x, z];

// Every scene: who stands where, the star's loadout, the map edits, the script [[t, fn]] (t from the
// clip start), the clip length, the camera focus [x, z] and zoom (game camera offset x zoom).
const SCENES = {
  // ---------------------------------------------------------------- gadgets
  gad_blasterA: { star: 'blaster', lo: 'A2', at: [-4, 0.5], foes: [['blaster', 1.2, 0.5]], dur: 3.2,
    script: [[0.4, gad(star, d(0))], [1.2, atk(star, d(0))], [2.1, atk(star, d(0))]] },
  gad_blasterB: { star: 'blaster', lo: 'B2', at: [-3.5, 0.5], foes: [['volt', 4.5, 0.5]], dur: 3.6,
    script: [[0.15, atk(d(0), star)], [1.0, gad(star, d(0))], [1.45, atk(d(0), star)], [2.3, atk(d(0), star)]] },
  gad_gunslingerA: { star: 'gunslinger', lo: 'A2', at: [-4, -0.5], foes: [['volt', 5, -0.5]], dur: 3.2,
    script: [[0.3, atk(d(0), star)], [0.52, gad(star, P(-4, 3))], [1.2, atk(star, d(0))], [2.1, atk(star, d(0))]] },
  gad_gunslingerB: { star: 'gunslinger', lo: 'B2', at: [-4.5, 0.5], foes: [['frostbite', 4.6, 0.5]], dur: 3.6,
    bush: [[13, 11], [14, 11], [15, 11], [13, 12], [14, 12], [15, 12], [13, 13], [14, 13], [15, 13]],
    script: [[0.5, gad(star, P(4.6, 0.5))], [1.4, atk(star, d(0))], [2.4, atk(star, d(0))]] },
  gad_bomberA: { star: 'bomber', lo: 'A2', at: [-3.2, 0.5], foes: [['blaster', 3.6, 0.5]], dur: 3.4,
    wall: [[12, 11], [12, 12], [12, 13]],
    script: [[0.4, gad(star, P(3, 0.5))], [1.5, atk(star, d(0))]] },
  gad_bomberB: { star: 'bomber', lo: 'B2', at: [-4.5, 0.5], foes: [['blaster', 4, -2], ['blaster', 4, 3]], dur: 3.8, cam: [0, 0.5],
    script: [[0.2, atk(star, d(0))], [1.4, gad(star, d(1))], [1.8, atk(star, d(1))]] },
  gad_frostbiteA: { star: 'frostbite', lo: 'A2', at: [-5.5, 0.5], foes: [['blaster', 4.5, 0.5]], dur: 3.0,
    script: [[0.4, gad(star, d(0))], [1.0, atk(star, d(0))], [1.8, atk(star, d(0))]] },
  gad_frostbiteB: { star: 'frostbite', lo: 'B2', at: [-4, 0.5], foes: [['volt', 5, 0.5]], dur: 3.6, seeAll: true,
    script: [[0.3, gad(star, d(0))], [0.75, atk(d(0), star)], [1.6, atk(d(0), star)], [2.4, atk(d(0), star)]] },
  gad_voltA: { star: 'volt', lo: 'A2', at: [-2, 0.5], foes: [['mochi', -6.5, 0.5]], dur: 3.4,
    script: [[0.05, walk(d(0), 1, 0)], [0.35, gad(star, P(4, 0.5))], [1.15, stop(d(0))], [1.7, atk(star, d(0))], [2.4, atk(star, d(0))]] },
  gad_voltB: { star: 'volt', lo: 'B2', at: [-4, 0.5], foes: [['blaster', 4, 0.5]], dur: 3.6,
    script: [[0.1, atk(star, d(0))], [0.55, atk(star, d(0))], [1.0, atk(star, d(0))], [1.5, gad(star, d(0))],
      [1.75, atk(star, d(0))], [2.2, atk(star, d(0))], [2.65, atk(star, d(0))]] },
  gad_kappaA: { star: 'kappa', lo: 'A2', at: [-4.5, 0.5], foes: [['volt', 5, 0.5]], dur: 3.2,
    script: [[0.25, atk(d(0), star)], [0.45, gad(star, P(0.5, 0.5))], [1.3, atk(star, d(0))]] },
  gad_kappaB: { star: 'kappa', lo: 'B2', at: [-1.5, 0.5], hp: 0.4, foes: [['volt', 5, 0.5]], dur: 3.8,
    script: [[0.1, atk(d(0), star)], [0.8, gad(star, P(0, 0.5))]] },
  gad_pipchompA: { star: 'pipchomp', lo: 'A1', at: [-3.8, 0.5], hp: 0.45, foes: [['blaster', 2.6, 0.5]], dur: 3.2,
    script: [[0.4, gad(star, d(0))], [1.4, atk(star, d(0))]] },
  gad_pipchompB: { star: 'pipchomp', lo: 'B1', at: [-1.5, 0.5], foes: [['volt', 5, 0.5]], dur: 3.8,
    script: [[0.1, atk(d(0), star)], [0.7, gad(star, d(0))], [0.95, walk(star, 0, 1)], [1.25, walk(star, -1, -0.4)], [1.6, stop(star)],
      [1.9, S => S.g.canSee(S.d[0], S.star) && atk(d(0), star)(S)], [2.8, S => S.g.canSee(S.d[0], S.star) && atk(d(0), star)(S)]] },
  gad_mochiA: { star: 'mochi', lo: 'A1', at: [-4, 0.5], foes: [['blaster', -1.3, 0.1], ['volt', 0.8, 0.9]], dur: 3.2,
    script: [[0.4, gad(star, P(2, 0.5))], [1.6, atk(star, d(1))]] },
  gad_mochiB: { star: 'mochi', lo: 'B1', at: [-3, 0.5], foes: [['volt', 4.5, 0.5]], dur: 3.6,
    script: [[0.1, atk(d(0), star)], [0.85, gad(star, d(0))], [1.25, atk(d(0), star)], [2.1, atk(d(0), star)]] },

  // ---------------------------------------------------------------- star powers
  star_sapRegen: { star: 'blaster', lo: 'A1', at: [-3.5, 0.5], hp: 0.55, foes: [['volt', 4.5, 0.5]], dur: 3.8, regen: true,
    script: [[0.1, atk(d(0), star)]] },
  star_splinters: { star: 'blaster', lo: 'A2', at: [-4.5, 0.5], foes: [['volt', -0.3, -1.5], ['volt', -0.3, 2.5]], dur: 3.2,
    wall: [[13, 9], [13, 10], [13, 11], [13, 12], [13, 13], [13, 14], [13, 15]],
    script: [[0.3, atk(star, P(3, 0.5))], [1.3, atk(star, P(3, 0.5))], [2.3, atk(star, P(3, 0.5))]] },
  star_steadyAim: { star: 'gunslinger', lo: 'A1', at: [-6, 0.5], foes: [['blaster', 6, 0.5]], dur: 3.2, cam: [0, 0.5],
    script: [[0.3, atk(star, d(0))], [1.4, atk(star, d(0))]] },
  star_axoRegen: { star: 'gunslinger', lo: 'A2', at: [-3.5, 0.5], hp: 0.3, regenAt: 0.4, foes: [['volt', 4.5, 0.5]], dur: 3.2, regen: true,
    script: [] },
  star_magmaPuddle: { star: 'bomber', lo: 'A1', at: [-4, 0.5], foes: [['blaster', 3, 0.5]], dur: 3.6,
    script: [[0.2, atk(star, d(0))], [1.9, atk(star, P(3, -1.5))]] },
  star_bigBang: { star: 'bomber', lo: 'A2', at: [-4, 0.5], foes: [['blaster', 3.2, -1.65], ['blaster', 3.2, 2.65]], dur: 3.2,
    script: [[0.3, atk(star, P(3.2, 0.5))], [1.6, atk(star, P(3.2, 0.5))]] },
  star_deepFreeze: { star: 'frostbite', lo: 'A1', at: [-5.5, 0.5], foes: [['mochi', 6.5, 0.5]], dur: 3.4,
    tick: S => { if (S.d[0].pos.x < -2.8) S.d[0].moveIntent.set(0, 0, 0); },
    script: [[0.0, walk(d(0), -1, 0)], [0.2, atk(star, d(0))]] },
  star_permafrost: { star: 'frostbite', lo: 'A2', at: [0, 0.5], foes: [['blaster', 5.8, 0.5], ['volt', -5.8, 0.5], ['mochi', 0, -5.3], ['bomber', 3.6, 4.8]], dur: 3.2,
    zoom: 0.62, script: [[0.4, sup(star, d(0))]] },
  star_conductor: { star: 'volt', lo: 'A1', at: [-4, 0.5], foes: [['blaster', 0.5, 0.5], ['mochi', 3.5, -1.8], ['bomber', 3.8, 2.8], ['frostbite', 6.5, 0.5]], dur: 3.2,
    script: [[0.3, atk(star, d(0))], [1.5, atk(star, d(0))]] },
  star_surge: { star: 'volt', lo: 'A2', at: [-4.5, 0.5], foes: [['blaster', 3, 0.5], ['mochi', 4.5, -1.2], ['bomber', 4.3, 2.2]], dur: 3.4,
    script: [[0.3, sup(star, P(3.8, 0.5))]] },
  star_hydrotherapy: { star: 'kappa', lo: 'A1', at: [-3.5, 0.5], hp: 0.35, regenAt: 99, foes: [['blaster', 3.5, 0.5]], dur: 3.4,
    script: [[0.2, atk(star, d(0))], [1.2, atk(star, d(0))], [2.2, atk(star, d(0))]] },
  star_undertow: { star: 'kappa', lo: 'A2', at: [-4, 0.5], foes: [['blaster', 2.6, -0.4], ['volt', 4.2, 1.5]], dur: 3.2,
    script: [[0.4, sup(star, P(3, 0.5))]] },
  star_huntersNose: { star: 'pipchomp', lo: 'A1', at: [-3, 0.5], foes: [['volt', 3.6, 0.5, 0.3]], dur: 3.4,
    bush: [[13, 11], [14, 11], [15, 11], [13, 12], [14, 12], [15, 12], [13, 13], [14, 13], [15, 13]],
    script: [[0.5, walk(star, 1, 0)], [1.2, stop(star)], [1.3, atk(star, d(0))]] },
  star_hungry: { star: 'pipchomp', lo: 'A2', at: [-5, 0.5], foes: [['blaster', -2, -1.3], ['blaster', -2, 2.4, 0.36]], dur: 3.2,
    script: [[0.3, atk(star, d(0))], [1.4, atk(star, d(1))]] },
  star_heavyweight: { star: 'mochi', lo: 'A1', at: [-1, -0.7], foes: [['blaster', 3.4, 0.5], ['mochi', -1, 1.7]], dur: 3.2,
    script: [[0.4, sup(d(0), P(-1, 0.5))]] },
  star_secondHelping: { star: 'mochi', lo: 'A2', at: [-3.5, 0.5], hp: 0.5, regenAt: 99, foes: [], dur: 3.2,
    script: [[0.05, S => S.g.dropCube(0.2, 0.5, 0, 1)], [0.6, walk(star, 1, 0)], [1.4, stop(star)]] },
};

function stage(clip, sc) {
  const roster = [{ id: 'star', name: '', type: sc.star, lo: sc.lo, human: false, spawn: 0 },
    ...sc.foes.map((f, k) => ({ id: 'd' + k, name: '', type: f[0], lo: f[4] || 'A2', human: false, spawn: k + 1 }))];
  let g = null, recording = false;
  const msgs = [];
  const send = msg => { if (recording) msgs.push([g.time, msg]); };
  const m = new ServerMatch({ map: 'oasis', roster, send, onEnd: () => {} });
  g = m.game;
  // a stage, not a match: no bots' brains, no gas, drop or arena event, no end, no spawn shield
  g.brains.clear();
  g.checkEnd = () => {};
  g.drops = [];
  g.events.reset(g.mapKey, Infinity);
  g.poison = new g.poison.constructor(g, { startAt: 1e9 });
  g.time = 8;
  const A = g.arena, edits = [];
  const put = (i, j, ch) => { if (A.grid[j][i] !== ch) { A.grid[j][i] = ch; edits.push([i, j, ch]); } };
  for (let j = CLEAR.j0; j <= CLEAR.j1; j++) for (let i = CLEAR.i0; i <= CLEAR.i1; i++) put(i, j, '.');
  for (const [i, j] of sc.wall || []) put(i, j, '#');
  for (const [i, j] of sc.bush || []) put(i, j, 'B');
  for (const [i, j] of sc.water || []) put(i, j, 'W');
  A.rev++;
  const S = { g, star: g.byId.get('star'), d: sc.foes.map((_, k) => g.byId.get('d' + k)) };
  const place = (b, x, z, fx, fz) => { b.pos.set(x, 0, z); b.net.set(x, z); b.facing = Math.atan2(fx, fz); b.knock.set(0, 0, 0); };
  const cx = sc.cam ? sc.cam[0] : 0;
  place(S.star, sc.at[0], sc.at[1], 1, 0);
  sc.foes.forEach((f, k) => {
    const b = S.d[k];
    place(b, f[1], f[2], S.star.pos.x - f[1], S.star.pos.z - f[2]);
    if (f[3]) b.hp = Math.round(b.maxHp * f[3]);
  });
  if (sc.hp) S.star.hp = Math.round(S.star.maxHp * sc.hp);
  // hurt "a while ago": regen would start `regenAt` s into the clip (its rule: 3 s without damage,
  // 2 s with Sap Regen); 99: not in this clip
  const calm = sc.star === 'blaster' && sc.lo[1] === '1' ? 2 : 3;
  S.star.lastHurt = g.time + PRE + (sc.regenAt ?? 0) - (sc.regenAt !== undefined ? calm : 0);
  for (const b of S.d) b.lastHurt = g.time + PRE;   // the dummies don't heal up in the middle of a clip
  const t0 = g.time + PRE;   // the clip's 0
  const script = sc.script.map(([t, fn]) => [t0 + t, fn]).sort((a, b) => a[0] - b[0]);
  // the host's snapshot rows, the star's view (like a player's own snapshot)
  const row = b => [b.id, r2(b.pos.x), r2(b.pos.z), r2(b.facing), Math.round(b.hp), b.maxHp, r2(b.ammo), r2(b.superCharge), b.cubes,
    (b.revealT > 0 ? 2 : 0) | (b.slowT > 0 ? 4 : 0) | (b.freezeT > 0 ? 8 : 0) | (b.rootT > 0 ? 16 : 0) | (b.stunned ? 32 : 0)];
  const snaps = [], evs = [];
  recording = true;
  let regenAcc = 0, regenT = 0, snapT = 0;
  const end = t0 + sc.dur + 0.25;
  let si = 0;
  while (g.time < end) {
    while (si < script.length && script[si][0] <= g.time + 1e-6) script[si++][1](S);
    if (sc.tick) sc.tick(S);
    const hp0 = S.star.hp;
    const before = msgs.length;
    g.serverStep(STEP);
    // the host's own snapshots are left out: these come at 30 Hz, from the star's eyes
    for (let k = msgs.length - 1; k >= before; k--) if (msgs[k][1].t === 'snap') msgs.splice(k, 1);
    // Regen has no event in the protocol (the HP bar just fills): a scene about it shows the rules'
    // regen as heal numbers too, every 0.25 s.
    if (sc.regen && S.star.regen && S.star.hp > hp0) { regenAcc += S.star.hp - hp0; regenT += STEP; }
    if (regenAcc > 0 && regenT >= 0.25) {
      msgs.push([g.time, { t: 'ev', list: [{ e: 'heal', id: 'star', a: Math.round(regenAcc) }] }]);
      regenAcc = 0; regenT = 0;
    }
    snapT -= STEP;
    if (snapT <= 1e-6) {
      snapT += 1 / 30;
      const seen = g.brawlers.filter(b => b.alive && (b === S.star || sc.seeAll || g.canSee(S.star, b)));
      msgs.push([g.time, { t: 'snap', pt: 99, b: seen.map(row) }]);
    }
  }
  const rel = t => Math.round((t - (t0 - PRE)) * 1000) / 1000;
  for (const [t, msg] of msgs) {
    if (msg.t === 'snap') snaps.push([rel(t), msg]);
    else if (msg.t === 'ev' && msg.list?.length) evs.push([rel(t), msg.list]);
  }
  const cam = [cx, (sc.cam ? sc.cam[1] : 0.5) - 1.1, sc.zoom || 0.37];
  const log = evs.flatMap(([t, l]) => l.filter(e => ['dmg', 'heal', 'zap', 'pick', 'kill', 'ice', 'flare', 'miss', 'imm'].includes(e.e))
    .map(e => `${t.toFixed(2)} ${e.e}${e.id ? ' ' + e.id : ''}${e.a !== undefined ? ' ' + e.a : ''}`));
  log.unshift('seen0:' + snaps[0][1].b.map(r => r[0]).join('+'));
  return {
    v: 1, clip, map: 'oasis', edits,
    roster: roster.map(r => ({ id: r.id, name: '', type: `${r.type}:${r.lo}` })),
    from: PRE, to: PRE + sc.dur, cam, snaps, evs, log,
  };
}
const r2 = v => Math.round(v * 100) / 100;

for (const [clip, sc] of Object.entries(SCENES)) {
  if (only.length && !only.includes(clip)) continue;
  const rec = stage(clip, sc);
  const { log, ...data } = rec;
  writeFileSync(new URL(clip + '.json', out), JSON.stringify(data));
  console.log(`${clip}  ${sc.dur}s  ${rec.snaps.length} snaps  ${log.join(' | ')}`);
}
