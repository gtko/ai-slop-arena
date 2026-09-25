// Smoke tests of the authoritative server (worker/build/sim.js, built by `vite build --mode server`).
// Run with `npm test`. Plain Node, no framework: exits 1 on the first failure.
import assert from 'node:assert/strict';

const { ServerMatch, makeRoster } = await import(new URL('../worker/build/sim.js', import.meta.url));
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n     ${e.message}`); }
}
function match(map, humans) {
  const out = { all: [], to: {}, ended: false, cheats: [] };
  const m = new ServerMatch({
    map, roster: makeRoster(humans.map(id => ({ id, name: id, type: 'volt' }))),
    send: msg => out.all.push(msg), sendTo: (id, msg) => (out.to[id] ||= []).push(msg),
    onEnd: () => { out.ended = true; }, onCheat: (id, kind, n) => out.cheats.push([id, kind, n]),
  });
  return { m, out, g: m.game };
}

await test('a headless match runs to the end quickly', () => {
  const { m, out } = match('oasis', ['alice']);
  const t0 = performance.now();
  for (let i = 0; i < 20 * 600 && !out.ended; i++) m.advance(0.05);
  assert.ok(out.ended, 'match did not end within 10 minutes of game time');
  assert.ok(performance.now() - t0 < 5000, 'simulation too slow');
  assert.ok(out.all.some(msg => msg.t === 'ev'), 'no events broadcast');
});

await test('legal moves are accepted, teleports refused and snapped back', () => {
  const { m, out, g } = match('grove', ['alice']);
  const a = g.byId.get('alice');
  // walk 5 units in a direction with no wall (spawns are random)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dz] = dirs.find(([u, v]) => [...Array(12)].every((_, k) => !g.arena.blocksMoveAt(a.pos.x + u * k * 0.5, a.pos.z + v * k * 0.5)));
  let x = a.pos.x, z = a.pos.z;
  for (let i = 0; i < 20; i++) { x += dx * 0.25; z += dz * 0.25; m.input({ from: 'alice', x, z, ax: 1, az: 0, px: x + 2, pz: z, f: 0, s: 0 }); m.advance(0.05); }
  assert.equal(out.cheats.length, 0, 'a legal walk was refused');
  assert.ok(Math.hypot(a.net.x - x, a.net.y - z) < 0.01, 'server did not follow the walk');
  m.input({ from: 'alice', x: x + 20, z, ax: 1, az: 0, px: 0, pz: 0, f: 0, s: 0 });
  m.advance(0.1);
  assert.equal(out.cheats.length, 1, 'teleport not refused');
  assert.equal(out.to.alice.at(-1).me[2], 1, 'no snap-back sent');
});

await test('each player only receives what they can see', () => {
  const { m, out } = match('marsh', ['alice', 'bob']); // fog map
  m.advance(0.5);
  const snap = out.to.alice.at(-1);
  assert.ok(snap.b.length < 8, 'fog map snapshot contains everyone');
  assert.ok(snap.b.some(row => row[0] === 'alice'), 'a player must always see themself');
});

await test('inputs are sanitised and rate-limited', () => {
  const { m, g } = match('oasis', ['alice']);
  const a = g.byId.get('alice');
  m.input({ from: 'alice', x: a.pos.x, z: a.pos.z, ax: 1e9, az: NaN, px: 1e9, pz: -1e9, f: 1, s: 'x' });
  const I = a.remoteIn;
  assert.ok(Math.abs(Math.hypot(I.ax, I.az) - 1) < 1e-6, 'aim not normalised');
  assert.ok(Math.hypot(I.px - a.pos.x, I.pz - a.pos.z) <= a.type.range + 2.01, 'aim point not clamped');
  for (let i = 0; i < 100; i++) m.input({ from: 'alice', x: a.pos.x, z: a.pos.z, ax: 1, az: 0, px: 0, pz: 0, f: 0, s: i });
  assert.ok(a.remoteIn.s < 60, 'flood not limited');
});

await test('every human hits at full strength online, bots a bit softer', () => {
  const { g } = match('oasis', ['alice', 'bob']);
  const [a, b] = ['alice', 'bob'].map(id => g.byId.get(id));
  assert.equal(a.dmgMul, 1, 'a human deals less than full damage on the server');
  assert.equal(b.dmgMul, 1, 'humans do not deal the same damage');
  assert.ok(g.brawlers.filter(o => !o.human).every(o => o.dmgMul === 0.85), 'bot damage changed');
  b.cubes = 2; b.refreshDmg();
  g.onLeft('bob');
  assert.ok(Math.abs(b.dmgMul - 1.05) < 1e-9, 'a player who left keeps full damage or loses their cubes');
  g.onRejoin('bob');
  assert.ok(Math.abs(b.dmgMul - 1.2) < 1e-9, 'a player who came back does not get full damage back');
});

await test('a frost nova cannot freeze someone who just thawed', () => {
  const { m, g } = match('frost', ['alice']);
  while (g.time < 6) m.advance(0.05); // past the spawn shield
  g.brains.clear();
  const a = g.byId.get('alice'), f = g.brawlers.find(b => b !== a);
  f.pos.set(a.pos.x + 1, f.pos.y, a.pos.z);
  a.hp = a.maxHp = 1e6;
  g.combat.nova(f);
  assert.ok(a.freezeT > 1, 'the first nova did not freeze');
  while (a.freezeT > 0) m.advance(0.05);
  assert.ok(a.ccImmuneT > 1, 'no immunity after the freeze');
  f.pos.set(a.pos.x + 1, f.pos.y, a.pos.z);
  g.combat.nova(f);
  assert.ok(a.freezeT <= 0, 'frozen again while immune');
});

await test('nobody is hurt during the opening seconds (spawn shield + calm bots)', () => {
  for (const map of ['oasis', 'dunes', 'grove', 'frost', 'marsh']) {
    for (let k = 0; k < 4; k++) {
      const { m, out, g } = match(map, ['alice']);
      while (g.time < 6.5) m.advance(0.05);
      const hits = out.all.filter(msg => msg.t === 'ev').flatMap(msg => msg.list).filter(e => e.e === 'dmg' && e.s && e.s !== e.id);
      const early = hits.filter(e => e.id === 'alice');
      assert.equal(early.length, 0, `alice hit in the first 6.5 s on ${map}`);
    }
  }
});

await test('sharper bots beat clumsy ones (adaptive difficulty has teeth)', () => {
  let sharp = 0;
  for (let i = 0; i < 16; i++) {
    const roster = makeRoster([], { level: 0.5 });
    roster.forEach((r, k) => { r.skill = k < 4 ? 0.15 : 0.9; });
    const { m, g } = (() => { const x = match('oasis', []); return x; })();
    g.newMatch({ mapKey: ['oasis', 'dunes', 'grove', 'frost', 'marsh'][i % 5], roster, localId: null, headless: true, net: null });
    while (g.brawlers.filter(b => b.alive).length > 1 && g.time < 240) m.advance(0.05);
    const w = g.brawlers.find(b => b.alive);
    if (w && w.skill >= 0.9) sharp++;
  }
  assert.ok(sharp >= 10, `sharp bots won only ${sharp}/16`);
});

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall server tests passed');
