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
  for (const type of ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt', 'kappa', 'pipchomp', 'mochi']) for (const gad of ['A', 'B']) {
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

await test('duo: a ping reaches the partner only, once a second', () => {
  const { m, out, g } = duoMatch('oasis', [{ id: 'alice', party: 'P' }, { id: 'bob', party: 'P' }, 'carol']);
  const a = g.byId.get('alice');
  for (const id of ['alice', 'bob', 'carol']) g.byId.get(id).maxHp = g.byId.get(id).hp = 1e7;
  while (g.time < 6) m.advance(0.05);
  const at = { from: 'alice', x: a.net.x, z: a.net.y, ax: 1, az: 0, px: a.pos.x, pz: a.pos.z, f: 0, s: 0, g: 0 };
  m.input({ ...at, pg: 1, qx: a.pos.x + 3, qz: a.pos.z });
  m.advance(0.05);
  m.input({ ...at, pg: 2, qx: a.pos.x + 3, qz: a.pos.z }); // too soon
  m.advance(0.05);
  const pings = id => (out.to[id] || []).filter(x => x.t === 'ev').flatMap(x => x.list).filter(e => e.e === 'ping');
  assert.equal(pings('bob').length, 1, 'the partner did not get the ping');
  assert.equal(pings('carol').length, 0, 'an enemy got the ping');
  assert.ok(!events(out).some(e => e.e === 'ping'), 'the ping was broadcast');
});

/* ------------------------------ Nurse Kappa (v0.14) ------------------------------ */

function kappaMatch(lo = 'A1', duo = false) {
  const roster = makeRoster([{ id: 'k', name: 'k', type: 'kappa', lo }], { duo });
  for (const r of roster) if (!r.human) { r.type = 'volt'; r.lo = 'A1'; } // plain targets: no Heavyweight, no dash
  const m = new ServerMatch({ map: 'oasis', roster, send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
  const g = m.game;
  while (g.time < 6) m.advance(0.05);
  g.brains.clear();
  const k = g.byId.get('k');
  k.netDriven = false;
  return { m, g, k };
}
const place = (o, x, z) => { o.pos.set(x, 0, z); o.net.set(x, z); o.vel.set(0, 0, 0); o.moveIntent.set(0, 0, 0); };
// an open spot: 7 tiles of floor in a row along +x
function openRow(g) {
  const A = g.arena;
  for (let j = 4; j < 21; j++) for (let i = 3; i < 14; i++) if ([...Array(9)].every((_, d) => A.get(i + d, j) === '.')) return A.center(i, j, g.arena.spawns[0].clone());
  throw new Error('no open row');
}

await test('Kappa: a bubble that splashes an enemy hurts it and heals her', () => {
  const { m, g, k } = kappaMatch();
  const foe = g.brawlers.find(o => o !== k && !g.ally(k, o)), c = openRow(g);
  place(k, c.x, c.z); place(foe, c.x + 6, c.z);
  for (const o of g.brawlers) if (o !== k && o !== foe) place(o, -40, -40);
  k.hp = 1000;
  assert.ok(g.tryAttack(k, 1, 0, foe.pos.clone(), false));
  for (let i = 0; i < 30; i++) m.advance(0.05);
  assert.ok(foe.hp <= foe.maxHp - 500, `the bubble did ${foe.maxHp - foe.hp}`);
  assert.ok(k.hp >= 1300, `no heal: ${k.hp}`);
});

await test('Kappa: in Duo the splash heals her partner, Bowl Splash heals over time', () => {
  const { m, g, k } = kappaMatch('B1', true);
  const mate = g.mateOf(k), c = openRow(g);
  place(k, c.x, c.z); place(mate, c.x + 5, c.z);
  mate.hp = 1000;
  g.tryAttack(k, 1, 0, mate.pos.clone(), false);
  for (let i = 0; i < 30; i++) m.advance(0.05);
  mate.lastHurt = g.time; // (no regen in the way)
  assert.ok(mate.hp >= 1000 + 500 * 1.3 - 5, `partner not healed (Hydrotherapy): ${mate.hp}`);
  k.hp = 1000; place(mate, c.x + 1, c.z); mate.hp = 1000;
  assert.ok(g.useGadget(k, 1, 0, k.pos));
  for (let i = 0; i < 40; i++) m.advance(0.05);
  assert.ok(k.hp > 2000 && mate.hp > 2000, `Bowl Splash: ${k.hp} ${mate.hp}`);
  for (let i = 0; i < 30; i++) m.advance(0.05);
  assert.ok(k.slowSelfT > 0, 'the empty bowl does not slow her');
});

await test('Kappa: the Tidal Wave hits, pushes (or pulls) and parts the gas', () => {
  for (const star of [1, 2]) {
    const { m, g, k } = kappaMatch('A' + star);
    const foe = g.brawlers.find(o => o !== k && o.type.key !== 'mochi'), c = openRow(g); // (Heavyweight halves pushes)
    for (const o of g.brawlers) if (o !== k && o !== foe) place(o, -40, -40);
    place(k, c.x, c.z); place(foe, c.x + 4, c.z);
    foe.ccImmuneT = 0;
    k.superCharge = 1;
    const x0 = foe.pos.x, hp = foe.hp;
    assert.ok(g.tryAttack(k, 1, 0, foe.pos.clone(), true));
    assert.ok(!g.poison.isPoisonedAt(c.x + 5, c.z) && g.poison.inLane(c.x + 5, c.z), 'no lane');
    for (let i = 0; i < 20; i++) m.advance(0.05);
    assert.ok(hp - foe.hp >= 900 * k.dmgMul - 1, `the wave did ${hp - foe.hp}`);
    if (star === 1) assert.ok(foe.pos.x > x0 + 1.5, `not pushed: ${foe.pos.x - x0}`);
    else assert.ok(foe.pos.x < x0 - 1, `not pulled: ${foe.pos.x - x0}`);
    for (let i = 0; i < 30; i++) m.advance(0.05);
    assert.ok(!g.poison.inLane(c.x + 5, c.z), 'the lane never closes');
  }
});

/* ------------------------------ Windmill Isles and the map kit (v0.15) ------------------------------ */

function kitMatch(map) {
  const m = new ServerMatch({ map, roster: makeRoster([{ id: 'alice', name: 'a', type: 'volt' }]), send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
  const g = m.game;
  while (g.time < 6) m.advance(0.05);
  g.brains.clear();
  for (const b of g.brawlers) { b.netDriven = false; b.moveIntent.set(0, 0, 0); }
  return { m, g };
}
const tiles = (g, ch) => { const out = []; for (let j = 0; j < 25; j++) for (let i = 0; i < 25; i++) if (g.arena.get(i, j) === ch) out.push([i, j]); return out; };
const stand = (o, x, z) => { o.pos.set(x, 0, z); o.net.set(x, z); o.vel.set(0, 0, 0); o.moveIntent.set(0, 0, 0); o.knock.set(0, 0, 0); };

await test('Windmill Isles: 8 spawns on land, no gas, the islands crumble and the match ends', () => {
  const { m, g } = kitMatch('isles');
  assert.equal(g.arena.spawns.length, 8);
  for (const s of g.arena.spawns) assert.notEqual(g.arena.charAt(s.x, s.z), 'V', 'a spawn over the void');
  // nobody starts on the middle island (the last one standing): every spawn sits on an outer island
  const A = g.arena, mid = new Set(), stack = [[12, 11]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (mid.has(A.key(i, j)) || 'V=X'.includes(A.get(i, j))) continue;
    mid.add(A.key(i, j));
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  assert.ok(mid.size > 30, 'no middle island');
  for (const s of A.spawns) assert.ok(!mid.has(A.key(A.toTile(s.x), A.toTile(s.z))), 'a spawn on the middle island');
  assert.ok(g.kit.crumbles && g.poison.startAt > 1e8, 'gas instead of crumbling');
  g.brains.clear();
  const land = () => tiles(g, '.').length;
  const before = land();
  while (g.time < 62) m.advance(0.05);
  assert.ok(land() < before * 0.7, `the outer islands did not fall (${before} -> ${land()})`);
});

await test('Windmill Isles: a bot match plays to the end', () => {
  const m = new ServerMatch({ map: 'isles', roster: makeRoster([{ id: 'alice', name: 'a', type: 'volt' }]), send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
  const g = m.game;
  g.net = null; g.onLeft('alice');
  let falls = 0;
  for (let i = 0; i < 20 * 400 && !g.ended; i++) { m.advance(0.05); }
  falls = g.brawlers.filter(b => b.fell).length;
  assert.ok(g.ended, `no winner after ${Math.round(g.time)} s (${g.brawlers.filter(b => b.alive).length} left)`);
  console.log(`     (ended at ${Math.round(g.time)} s, ${falls} ring-outs)`);
});

await test('ring-out: pushed onto the void, you fall; the pusher gets the K.O.', () => {
  const { m, g } = kitMatch('isles');
  const [a, b] = g.brawlers;
  // a land tile next to the void, the void to the east
  const A = g.arena;
  let spot = null;
  for (let j = 1; j < 24 && !spot; j++) for (let i = 1; i < 23; i++) if (A.get(i, j) === '.' && A.get(i + 1, j) === 'V' && A.get(i + 2, j) === 'V') { spot = A.center(i, j); break; }
  assert.ok(spot, 'no edge');
  for (const o of g.brawlers) if (o !== a && o !== b) stand(o, 0, 0);
  stand(a, spot.x, spot.z); stand(b, spot.x - 3, spot.z);
  a.maxHp = a.hp = 1e6;
  const kos = b.stats.kos;
  g.applyKnock(a, 16, 0, b);
  for (let i = 0; i < 30 && a.alive; i++) m.advance(0.05);
  assert.ok(!a.alive, 'did not fall');
  assert.equal(b.stats.kos, kos + 1, 'the pusher got no K.O.');
  // walking alone never takes you over the edge
  stand(b, spot.x, spot.z); b.moveIntent.set(1, 0, 0);
  for (let i = 0; i < 40; i++) { b.moveIntent.set(1, 0, 0); m.advance(0.05); }
  assert.ok(b.alive, 'walked off the edge');
});

await test('explosive barrels: 900 around, a push, and the next barrel goes too', () => {
  const { m, g } = kitMatch('isles');
  const A = g.arena, bs = tiles(g, 'E');
  assert.ok(bs.length >= 4);
  const [i, j] = bs[0], c = A.center(i, j), o = g.brawlers[1];
  stand(o, c.x + 1.8, c.z);
  o.maxHp = o.hp = 5000;
  g.damageCrate(i, j, 700, g.brawlers[0]);
  m.advance(0.05);
  assert.equal(A.get(i, j), '.', 'the barrel is still there');
  assert.ok(o.hp <= 5000 - 900, `no blast damage: ${5000 - o.hp}`);
  // chain: two barrels side by side
  const { m: m2, g: g2 } = kitMatch('dunes');
  const d = tiles(g2, 'E');
  assert.ok(d.length >= 1, 'Dunes has no barrel'); // 4 on the map; bots may have shot some in the first seconds
  const A2 = g2.arena;
  A2.grid[d[0][1]][d[0][0] + 1] = 'E'; A2.makeBarrel(d[0][0] + 1, d[0][1]);
  g2.damageCrate(d[0][0], d[0][1], 1e9, null);
  for (let k = 0; k < 10; k++) m2.advance(0.05);
  assert.notEqual(A2.get(d[0][0] + 1, d[0][1]), 'E', 'no chain reaction');
});

await test('jump pads send you to open ground toward the middle; only Windmill Isles has them', () => {
  const { g } = kitMatch('oasis');
  assert.equal(g.kit.pads.length, 0);
  const { m: mi, g: gi } = kitMatch('isles');
  assert.equal(gi.kit.pads.length, 4);
  for (const p of gi.kit.pads) {
    const o = gi.brawlers[1];
    o.alive = true; stand(o, p.x, p.z); o.dash = null;
    for (let k = 0; k < 30; k++) mi.advance(0.05);
    assert.ok(o.alive, 'a pad threw someone into the void');
    const ch = gi.arena.charAt(o.pos.x, o.pos.z);
    assert.ok(ch !== 'V' && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) > 5, `bad landing ${ch}`);
  }
});

await test('bridges break under explosions; mushrooms heal and grow back', () => {
  const { m, g } = kitMatch('isles');
  const [i, j] = tiles(g, '=')[0], c = g.arena.center(i, j);
  g.kit.damageArea(c.x, c.z, 0.5, 700);
  assert.equal(g.arena.get(i, j), '=', 'broke too early');
  g.kit.damageArea(c.x, c.z, 0.5, 700);
  assert.equal(g.arena.get(i, j), 'V', 'the bridge did not break');
  const [si, sj] = tiles(g, 'H')[0], sc = g.arena.center(si, sj), o = g.brawlers[1];
  for (const x of g.brawlers) if (x !== o) stand(x, 0, 0);
  stand(o, sc.x, sc.z); o.hp = 1000; o.lastHurt = g.time;
  for (let k = 0; k < 50; k++) { o.lastHurt = g.time; m.advance(0.05); }
  assert.ok(o.hp >= 2150, `mushroom heal: ${o.hp}`);
  assert.ok(!g.kit.shrooms.find(s => s.i === si && s.j === sj).ready, 'the mushroom is still there');
});

/* ------------------------------ Pip & Chomp, Mochi (v0.15) ------------------------------ */

function duel(type, lo = 'A1') {
  const m = new ServerMatch({ map: 'oasis', roster: makeRoster([{ id: 'me', name: 'me', type, lo }]), send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
  const g = m.game;
  while (g.time < 6) m.advance(0.05);
  g.brains.clear();
  for (const b of g.brawlers) { b.netDriven = false; b.moveIntent.set(0, 0, 0); }
  const me = g.byId.get('me'), foe = g.brawlers.find(o => o !== me && o.type.key !== 'mochi'), c = openRow(g);
  for (const o of g.brawlers) if (o !== me && o !== foe) place(o, -40, -40);
  place(me, c.x, c.z);
  foe.maxHp = foe.hp = 20000; foe.ccImmuneT = 0;
  return { m, g, me, foe, c };
}

await test('Pip & Chomp: the lunge moves you and bites the first enemy (bending up to 15°)', () => {
  const { m, g, me, foe, c } = duel('pipchomp');
  place(foe, c.x + 3.5, c.z + 0.7); // off the aim line, within the magnetism
  const x0 = me.pos.x;
  assert.ok(g.tryAttack(me, 1, 0, foe.pos.clone(), false));
  for (let i = 0; i < 10; i++) m.advance(0.05);
  assert.ok(me.pos.x > x0 + 2, 'the lunge did not move Pip');
  assert.ok(20000 - foe.hp >= 800 * me.dmgMul - 1, `bite: ${20000 - foe.hp}`);
  const miss = duel('pipchomp');
  place(miss.foe, miss.c.x - 6, miss.c.z);
  const hp = miss.foe.hp;
  miss.g.tryAttack(miss.me, 1, 0, miss.me.pos.clone(), false);
  for (let i = 0; i < 10; i++) miss.m.advance(0.05);
  assert.equal(miss.foe.hp, hp, 'a bite behind the back');
});

await test('Venus Trap: a bush that bites, roots and reveals the first enemy, one per Pip', () => {
  const { m, g, me, foe, c } = duel('pipchomp');
  place(foe, c.x - 20, c.z);
  me.superCharge = 1;
  assert.ok(g.tryAttack(me, 1, 0, { x: c.x + 5, z: c.z }, true));
  assert.equal(g.kit.traps.length, 1, 'no trap');
  const T = g.kit.traps[0];
  assert.equal(g.arena.get(T.i, T.j), 'B', 'the trap is not a bush');
  me.superCharge = 1;
  g.tryAttack(me, 1, 0, { x: c.x + 7, z: c.z }, true);
  assert.equal(g.kit.traps.length, 1, 'two traps');
  const T2 = g.kit.traps[0];
  place(foe, T2.x, T2.z);
  m.advance(0.05);
  assert.equal(g.kit.traps.length, 0, 'the trap did not go off');
  assert.ok(foe.rootT > 0.8 && foe.revealT > 2.5, 'no root / reveal');
  assert.ok(20000 - foe.hp >= 790, `trap damage ${20000 - foe.hp}`);
});

await test('Mochi: 3 jelly waves push enemies back; the Pound lands, hurts and stuns', () => {
  const { m, g, me, foe, c } = duel('mochi');
  assert.equal(me.maxHp, 6800);
  place(foe, c.x + 2, c.z);
  assert.ok(g.tryAttack(me, 1, 0, foe.pos.clone(), false));
  for (let i = 0; i < 8; i++) m.advance(0.05);
  assert.ok(20000 - foe.hp >= 420 * 2 * me.dmgMul, `bump: ${20000 - foe.hp}`);
  assert.ok(foe.pos.x > c.x + 2.5, 'not pushed back');
  place(foe, c.x + 6, c.z); foe.ccImmuneT = 0;
  const hp = foe.hp;
  me.superCharge = 1;
  assert.ok(g.tryAttack(me, 1, 0, foe.pos.clone(), true));
  for (let i = 0; i < 24; i++) m.advance(0.05);
  assert.ok(Math.hypot(me.pos.x - foe.pos.x, me.pos.z - foe.pos.z) < 2.5, 'Mochi did not leap');
  assert.ok(hp - foe.hp >= 1000 * me.dmgMul - 1, `pound: ${hp - foe.hp}`);
  assert.ok(foe.stunned || foe.freezeT > 0, 'no stun');
});

await test('Mochi star powers: Heavyweight halves pushes, Second Helping heals on a cube; +250 HP a cube', () => {
  const a = duel('mochi', 'A1'), b = duel('mochi', 'A2');
  a.me.knock.set(0, 0, 0); a.g.applyKnock(a.me, 10, 0, null);
  assert.equal(a.me.knock.x, 5, 'Heavyweight');
  const hp = b.me.maxHp;
  b.me.hp = 1000;
  b.g.dropCube(b.me.pos.x, b.me.pos.z, 0, 1);
  for (let i = 0; i < 20; i++) b.m.advance(0.05);
  assert.equal(b.me.maxHp, hp + 250);
  assert.ok(b.me.hp >= 1000 + 250 + 800 - 1, `Second Helping: ${b.me.hp}`);
});

await test('an online player crossing the void on a jump pad does not fall (the host waits for the landing)', () => {
  const m = new ServerMatch({ map: 'isles', roster: makeRoster([{ id: 'alice', name: 'a', type: 'volt' }]), send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
  const g = m.game;
  while (g.time < 6) m.advance(0.05);
  g.brains.clear();
  const a = g.byId.get('alice'), p = g.kit.pads[0];
  a.maxHp = a.hp = 1e6;
  const send = (x, z) => m.input({ from: 'alice', x, z, ax: 1, az: 0, px: x, pz: z, f: 0, s: 0, g: 0 });
  // walk onto the pad (teleport-free: the host saw us there), then fly the arc the client would
  a.pos.set(p.x, 0, p.z); a.net.set(p.x, p.z);
  send(p.x, p.z); m.advance(0.05);
  for (let k = 1; k <= 16; k++) { const f = k / 16; send(p.x + p.dx * p.dist * f, p.z + p.dz * p.dist * f); m.advance(0.05); }
  for (let k = 0; k < 6; k++) m.advance(0.05);
  assert.ok(a.alive, 'the host killed a player in the air over the void');
  assert.notEqual(g.arena.charAt(a.net.x, a.net.y), 'V', 'landed on the void');
});

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall server tests passed');
