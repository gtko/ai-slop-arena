// Smoke tests of the authoritative server (worker/build/sim.js, built by `vite build --mode server`).
// Run with `npm test`. Plain Node, no framework: exits 1 on the first failure.
import assert from 'node:assert/strict';

const { ServerMatch, makeRoster, validBrawler, validLoadout, validCos, EVENT_OF, PERSONAS, MUTATORS } = await import(new URL('../worker/build/sim.js', import.meta.url));
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n     ${e.message}`); }
}
function match(map, humans, mut = null) {
  const out = { all: [], to: {}, ended: false, cheats: [] };
  const m = new ServerMatch({
    map, mut, roster: makeRoster(humans.map(id => ({ id, name: id, type: 'volt' }))),
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
  f.star = 1; // no Permafrost
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

await test('brawler names and loadouts from the network are checked', () => {
  for (const bad of ['constructor', 'constructor:B2', '__proto__', 'toString', 'volt:C3', 'Volt', '', null, 42]) assert.ok(!validBrawler(bad), `accepted ${bad}`);
  for (const ok of ['volt', 'volt:B2', 'blaster:A1']) assert.ok(validBrawler(ok), `refused ${ok}`);
  assert.ok(validLoadout('B2') && !validLoadout('C1') && !validLoadout('b2') && !validLoadout(undefined));
  const m = new ServerMatch({ map: 'oasis', roster: makeRoster([{ id: 'alice', name: 'a', type: 'constructor', lo: 'B2' }, { id: 'bob', name: 'b', type: 'frostbite', lo: 'B2' }]), send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
  assert.equal(m.game.byId.get('alice').type.key, 'blaster', 'an unknown brawler did not fall back to Blaster');
  const bob = m.game.byId.get('bob');
  assert.ok(bob.gadget === 'B' && bob.star === 2, 'the separate loadout field was not applied');
});

await test('every gadget works, with 3 charges and a 5 s lockout', () => {
  for (const type of ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt']) for (const gad of ['A', 'B']) {
    const m = new ServerMatch({ map: 'oasis', roster: makeRoster([{ id: 'alice', name: 'a', type: `${type}:${gad}1` }]), send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
    const g = m.game;
    while (g.time < 6) m.advance(0.05);
    g.brains.clear();
    const a = g.byId.get('alice');
    a.netDriven = false; // the host plays it here, like a bot
    assert.equal(a.gadget, gad, `${type}: loadout not parsed`);
    assert.ok(g.useGadget(a, 1, 0, a.pos), `${type}${gad}: could not use the gadget`);
    assert.ok(!g.useGadget(a, 1, 0, a.pos), `${type}${gad}: no lockout`);
    for (let k = 0; k < 2; k++) { for (let s = 0; s < 14; s++) m.advance(0.05); a.gadgetCd = 0; assert.ok(g.useGadget(a, 0, 1, a.pos), `${type}${gad}: charge ${k + 2}`); m.advance(0.5); }
    a.gadgetCd = 0;
    assert.ok(!g.useGadget(a, 1, 0, a.pos), `${type}${gad}: a 4th charge`);
    m.advance(3);
  }
});

await test('Bark Skin takes less damage, Root Charge roots', () => {
  const m = new ServerMatch({ map: 'oasis', roster: makeRoster([{ id: 'alice', name: 'a', type: 'blaster:B1' }]), send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
  const g = m.game;
  while (g.time < 6) m.advance(0.05);
  g.brains.clear();
  const a = g.byId.get('alice'), o = g.brawlers.find(b => b !== a);
  a.netDriven = false;
  const hp = a.hp; g.damage(a, 1000, o);
  const plain = hp - a.hp;
  g.useGadget(a, 1, 0, a.pos);
  const hp2 = a.hp; g.damage(a, 1000, o);
  assert.ok(hp2 - a.hp < plain * 0.7, 'Bark Skin did not reduce the damage');
  a.gadget = 'A'; a.gadgetCd = 0; o.ccImmuneT = 0;
  o.pos.set(a.pos.x + 1.6, 0, a.pos.z);
  g.useGadget(a, 1, 0, a.pos);
  for (let k = 0; k < 6; k++) m.advance(0.05);
  assert.ok(o.rootT > 0 || o.hp < o.maxHp, 'Root Charge missed a brawler right in front');
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

// Seeded Math.random for statistical tests: the same matches every run, so a failure means the
// rules changed, not bad luck.
function seeded(seed, fn) {
  const random = Math.random;
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = random; }
}

await test('sharper bots beat clumsy ones (adaptive difficulty has teeth)', () => seeded(20260926, () => {
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
}));

/* ------------------------------ v0.13 LEVEL UP ------------------------------ */

const events = out => out.all.filter(msg => msg.t === 'ev').flatMap(msg => msg.list);

await test('every map runs its arena event, and every hit is telegraphed first', () => {
  for (const map of ['oasis', 'dunes', 'grove', 'frost', 'marsh']) {
    const { m, out, g } = match(map, ['alice']);
    g.events.at = 8;
    const sight = g.sightRange;
    let during = null;
    while (g.time < 30) { m.advance(0.05); if (g.events.on && during === null) during = g.sightRange; }
    const E = events(out).filter(e => e.e === 'arena');
    const start = E.find(e => e.k === 'start');
    assert.ok(start, `no event on ${map}`);
    assert.equal(start.kind, EVENT_OF[map]);
    assert.ok(E.some(e => e.k === 'end'), `the ${map} event never ended`);
    const warned = new Set(E.filter(e => e.k === 'warn').map(e => e.id));
    const hits = E.filter(e => e.k === 'hit');
    for (const h of hits) assert.ok(warned.has(h.id), `a hit on ${map} came without a telegraph`);
    if (['oasis', 'dunes', 'grove'].includes(map)) assert.ok(hits.length >= 3, `only ${hits.length} hits on ${map}`);
    if (map === 'frost') { assert.equal(during, 7, 'the blizzard does not cut sight'); assert.equal(g.sightRange, sight, 'sight not given back'); }
    if (map === 'marsh') assert.equal(start.props.filter(p => p.p === 'shroom').length, 4, 'no mushrooms');
  }
});

await test('the arena event never starts in the training dojo', () => {
  const { g } = match('oasis', ['alice']);
  assert.ok(g.events.at < 70, 'a real match has its event');
  g.newMatch({ mapKey: 'oasis', roster: makeRoster([{ id: 'alice', name: 'a', type: 'volt' }]), localId: 'alice', headless: true, dojo: true });
  assert.equal(g.events.at, Infinity);
});

await test('emotes: sent with the input, one every 2.5 s, and they reveal you', () => {
  const { m, out, g } = match('oasis', ['alice']);
  const a = g.byId.get('alice');
  a.maxHp = a.hp = 1e7; // the bots wake up meanwhile: alice must still be standing
  while (g.time < 6) m.advance(0.05);
  const at = { from: 'alice', x: a.net.x, z: a.net.y, ax: 1, az: 0, px: a.pos.x, pz: a.pos.z, f: 0, s: 0, g: 0 };
  m.input({ ...at, em: 1, ei: 3 });
  m.advance(0.05);
  assert.ok(a.revealT > 1.3, 'an emote must reveal its sender');
  m.input({ ...at, em: 2, ei: 4 }); // too soon
  m.advance(0.05);
  m.input({ ...at, em: 3, ei: 99 }); // not an emote
  for (let k = 0; k < 60; k++) m.advance(0.05);
  const emo = events(out).filter(e => e.e === 'emo' && e.id === 'alice');
  assert.deepEqual(emo.map(e => e.i), [3]);
  m.input({ ...at, em: 4, ei: 0 });
  m.advance(0.05);
  assert.equal(events(out).filter(e => e.e === 'emo' && e.id === 'alice').length, 2);
});

await test('looks and personas from the network are checked', () => {
  assert.ok(validCos('1.2.3.4.5.6'));
  for (const bad of ['', 'x', '1.2.3', '100.0.0.0.0.0', '1.2.3.4.5.6.7', null, 5]) assert.equal(validCos(bad), false, String(bad));
  const r = makeRoster([{ id: 'a', name: 'a', type: 'volt', cos: '<b>' }, { id: 'b', name: 'b', type: 'volt', cos: '2.1.0.3.4.7' }]);
  assert.equal(r[0].cos, undefined);
  assert.equal(r[1].cos, '2.1.0.3.4.7');
  for (const bot of r.filter(x => !x.human)) { assert.ok(PERSONAS.includes(bot.per)); assert.ok(validCos(bot.cos)); }
  const { g } = match('oasis', ['alice']);
  assert.equal(g.byId.get('alice').persona, undefined, 'a human has no persona');
});

await test('Weekly Chaos mutators change the rules on the server', () => {
  const run = (mut, secs) => {
    const x = match('oasis', ['alice'], mut), a = x.g.byId.get('alice');
    a.maxHp = a.hp = 1e7; // an online match ends once no human is standing
    while (x.g.time < secs) x.m.advance(0.05);
    return x;
  };
  assert.equal(run('x', 0).g.mutator, null, 'unknown mutator accepted');
  assert.ok(run('gadgetFrenzy', 0).g.brawlers.every(b => b.gadgetCharges === 6));
  assert.equal(run('gadgetFrenzy', 0).g.gadgetLockout, 2);
  assert.equal(run('gasBreath', 0).g.poison.interval, 4.5);
  assert.equal(run('nightHunt', 0).g.sightRange, 9);
  const rain = run('cubeRain', 13), dry = run(null, 13);
  assert.ok(rain.g.rainT > 17, 'the first cubes did not fall at 12 s');
  for (const x of [rain, dry]) { const n = x.g.items.length; x.g.rainT = 0; x.g.cubeRain(); x.n = x.g.items.length - n; }
  assert.equal(rain.n, 2, 'no cube rain');
  assert.equal(dry.n, 0, 'cube rain without the mutator');
  const { g } = run('superRush', 6), b = g.brawlers[1], o = g.brawlers[2];
  b.superCharge = 0; g.damage(o, 100, b);
  assert.ok(Math.abs(b.superCharge - 200 / b.type.superCost) < 1e-9, 'supers do not charge twice as fast');
  assert.equal(MUTATORS.length, 5);
});

/* ------------------------------ Duo Showdown (v0.14) ------------------------------ */

function duoMatch(map, humans) {
  const out = { all: [], to: {}, ended: false };
  const m = new ServerMatch({
    map, roster: makeRoster(humans.map(h => (typeof h === 'string' ? { id: h, name: h, type: 'volt' } : { name: h.id, type: 'volt', ...h })), { duo: true }),
    send: msg => out.all.push(msg), sendTo: (id, msg) => (out.to[id] ||= []).push(msg), onEnd: () => { out.ended = true; },
  });
  return { m, out, g: m.game };
}

await test('duo roster: 4 teams of 2, a party shares a team, solo players are paired', () => {
  const r = makeRoster([{ id: 'a', party: 'P1' }, { id: 'b' }, { id: 'c', party: 'P1' }, { id: 'd' }], { duo: true });
  const team = id => r.find(x => x.id === id).team;
  for (let t = 0; t < 4; t++) assert.equal(r.filter(x => x.team === t).length, 2, `team ${t}`);
  assert.equal(team('a'), team('c'), 'the party is split');
  assert.equal(team('b'), team('d'), 'the two solo players are not paired');
  assert.notEqual(team('a'), team('b'));
  assert.ok(r.every(x => x.party === undefined || x.human), 'bots have no party');
  assert.ok(makeRoster([{ id: 'a' }]).every(x => x.team === undefined), 'solo Showdown has teams');
});

await test('duo: partners start together, cannot hurt each other, and the gas waits 35 s', () => {
  const { g } = duoMatch('oasis', ['alice']);
  const a = g.byId.get('alice'), mate = g.mateOf(a), foe = g.brawlers.find(o => !g.ally(o, a) && o !== a);
  assert.ok(g.duo && mate, 'no partner');
  assert.ok(Math.hypot(a.pos.x - mate.pos.x, a.pos.z - mate.pos.z) < 3, 'partners start apart');
  assert.equal(g.poison.startAt, 35);
  assert.equal(g.poison.interval, 8);
  g.time = 10;
  const hp = mate.hp;
  g.damage(mate, 500, a);
  assert.equal(mate.hp, hp, 'friendly fire');
  assert.ok(!g.hits(a, mate) && g.hits(a, foe), 'hits() ignores the teams');
  g.damage(foe, 500, a);
  assert.ok(foe.hp < foe.maxHp, 'enemies must take damage');
});

await test('duo: Buddy Revive brings a partner back at 40% health, twice per team', () => {
  const { m, out, g } = duoMatch('grove', ['alice']);
  const a = g.byId.get('alice'), mate = g.mateOf(a);
  a.maxHp = a.hp = 1e7; mate.maxHp = mate.hp = 1e7; // nobody else may end it meanwhile
  g.brains.clear(); // bots stand still: the test moves them
  g.time = 10;
  const foes = g.brawlers.filter(o => o !== a && o !== mate);
  // (no brains: the other teams stand at their own corners)
  for (let k = 0; k < 2; k++) {
    a.hp = 100;
    g.damage(a, 500, foes[0]);
    assert.ok(!a.alive && g.ghostOf(a), `revive ${k + 1}: no ghost`);
    assert.equal(a.rank, 0, 'placed while the partner still stands');
    mate.pos.set(a.pos.x, 0, a.pos.z);
    for (let i = 0; i < 70 && !a.alive; i++) m.advance(0.05);
    assert.ok(a.alive, `revive ${k + 1} did not happen`);
    assert.equal(a.cubes, 0);
    assert.equal(a.hp, Math.round(a.type.hp * 0.4));
  }
  assert.equal(g.revives[a.team], 0);
  assert.ok(events(out).filter(e => e.e === 'revive' && e.id === 'alice').length === 2, 'no revive event');
  a.hp = 100;
  g.damage(a, 500, foes[0]);
  assert.ok(!a.alive && !g.ghostOf(a), 'a third ghost');
});

await test('duo: being hit pauses the revive, the gas ends the ghost', () => {
  const { m, out, g } = duoMatch('oasis', ['alice']);
  const a = g.byId.get('alice'), mate = g.mateOf(a);
  mate.maxHp = mate.hp = 1e7;
  g.brains.clear();
  g.time = 10;
  const foe = g.brawlers.find(o => o !== a && o !== mate);
  g.damage(a, 1e6, foe);
  mate.pos.set(a.pos.x + 1, 0, a.pos.z);
  for (let i = 0; i < 40; i++) { g.damage(mate, 10, foe); m.advance(0.05); } // hit all along: no progress
  assert.ok(!a.alive && g.ghostOf(a).p === 0, 'progress while being hit');
  g.poison.timer = 1000; // the gas everywhere
  for (let i = 0; i < 25; i++) m.advance(0.05);
  assert.ok(!g.ghostOf(a), 'the gas did not end the ghost');
  assert.ok(events(out).some(e => e.e === 'gone' && e.id === 'alice'));
});

await test('duo: a match ends with one team standing, placements 1-4 per team', () => {
  const { m, out, g } = duoMatch('dunes', ['alice', 'bob']);
  g.net = null; g.onLeft('alice'); g.onLeft('bob'); // all bots, played to the last team (no 'no human left' stop)
  for (let i = 0; i < 20 * 600 && !g.ended; i++) m.advance(0.05);
  assert.ok(g.ended, 'no end');
  const ranks = new Map();
  for (const b of g.brawlers) {
    assert.ok(b.rank >= 1 && b.rank <= 4, `${b.id} rank ${b.rank}`);
    if (ranks.has(b.team)) assert.equal(ranks.get(b.team), b.rank, 'partners placed differently');
    ranks.set(b.team, b.rank);
  }
});

await test('duo: a bot partner runs to revive you', () => {
  const { m, g } = duoMatch('oasis', ['alice']);
  const a = g.byId.get('alice'), mate = g.mateOf(a);
  for (const [o] of [...g.brains]) if (o !== mate) g.brains.delete(o); // only the partner thinks
  mate.maxHp = mate.hp = 1e7;
  g.time = 10;
  a.pos.x += (Math.sign(-a.pos.x) || 1) * 4; // a few metres from the partner
  g.damage(a, 1e6, g.brawlers.find(o => o !== a && o !== mate));
  for (let i = 0; i < 20 * 12 && !a.alive; i++) m.advance(0.05);
  assert.ok(a.alive, 'the bot partner never revived');
});

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall server tests passed');
