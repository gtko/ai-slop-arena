// Ranking maths (worker/ranking.js): MMR, visible RP, tiers, matchmaking groups.
import assert from 'node:assert/strict';
import { rate, tierOf, pickGroup, botLevelFor, START_MMR } from '../worker/ranking.js';

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n     ${e.message}`); } };
const fresh = (key, rank, extra = {}) => ({ key, mmr: START_MMR, rp: 0, matches: 0, rank, ...extra });

test('the winner gains, the first out loses (MMR and RP)', () => {
  const [w, l] = rate([fresh('w', 1), fresh('l', 8, { rp: 100 })]);
  assert.ok(w.mmr > START_MMR && w.delta > 0, 'winner did not gain');
  assert.ok(l.mmr < START_MMR && l.delta < 0, 'last did not lose');
});

test('RP never goes below 0', () => {
  const [p] = rate([fresh('a', 8), fresh('b', 1)]);
  assert.equal(p.rp, 0);
});

test('alone with bots: hidden MMR moves, visible RP does not', () => {
  const [p] = rate([fresh('solo', 1)], { visible: false });
  assert.ok(p.mmr > START_MMR);
  assert.equal(p.delta, 0);
  assert.equal(p.rp, 0);
});

test('beating stronger players is worth more MMR than beating weaker ones', () => {
  const up = rate([fresh('a', 1, { mmr: 1000 }), fresh('b', 5, { mmr: 1400 })])[0].mmr - 1000;
  const down = rate([fresh('a', 1, { mmr: 1000 }), fresh('b', 5, { mmr: 600 })])[0].mmr - 1000;
  assert.ok(up > down, `${up} <= ${down}`);
});

test('underrated players climb faster in RP', () => {
  const normal = rate([fresh('a', 1, { mmr: 1000, rp: 300, matches: 30 }), fresh('b', 8)])[0].delta;
  const under = rate([fresh('a', 1, { mmr: 1600, rp: 300, matches: 30 }), fresh('b', 8, { mmr: 1600 })])[0].delta;
  assert.ok(under > normal, `${under} <= ${normal}`);
});

test('tiers', () => {
  assert.equal(tierOf(0), 'bronze');
  assert.equal(tierOf(499), 'silver');
  assert.equal(tierOf(500), 'gold');
  assert.equal(tierOf(2500), 'legend');
});

test('matchmaking groups close MMRs and waits for them', () => {
  const now = 1e6;
  const q = [...Array(8)].map((_, i) => ({ id: i, mmr: 1000 + i * 10, joined: now - 1000 }));
  q.push({ id: 'far', mmr: 2000, joined: now - 500 });
  const g = pickGroup(q, now);
  assert.equal(g.length, 8);
  assert.ok(!g.some(p => p.id === 'far'), 'a far MMR was grouped early');
  assert.equal(pickGroup(q.slice(0, 3), now), null, 'started without enough players');
  assert.equal(pickGroup(q.slice(0, 3), now + 60 * 1000).length, 3, 'did not start after 1 minute');
  const two = [{ id: 'a', mmr: 900, joined: now - 61 * 1000 }, { id: 'b', mmr: 1800, joined: now - 1000 }];
  assert.equal(pickGroup(two, now).length, 2, 'after 1 minute, two far MMRs play together instead of with bots only');
});

test('bot level follows MMR', () => {
  assert.ok(botLevelFor(600) < botLevelFor(1000) && botLevelFor(1000) < botLevelFor(1600));
});

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall ranking tests passed');
