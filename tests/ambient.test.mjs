// Ambient life (src/ambient/maps/*.js): every map file builds without throwing, with sane options and
// a small budget, against a stand-in of the helpers of src/ambient/index.js (which needs Vite).
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import * as THREE from 'three';
const { toy } = await import(new URL('../src/ambient/toy.js', import.meta.url));
const { MAPS } = await import(new URL('../src/maps.js', import.meta.url));

const N = 25, TILE = 2;
const dir = new URL('../src/ambient/maps/', import.meta.url);
let failed = 0;
for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const key = file.slice(0, -3);
  try {
    assert.ok(MAPS[key], `${file}: no map "${key}" in maps.js`);
    const M = MAPS[key], rows = M.full || [];
    // the real grid, as arena.js builds it: a full layout, or the top-left quadrant mirrored 4 ways
    const Q = M.layout, grid = (i, j) => {
      if (i < 0 || j < 0 || i >= N || j >= N) return 'X';
      const ch = rows.length ? rows[j]?.[i] || 'V' : Q[Math.min(j, N - 1 - j)]?.[Math.min(i, N - 1 - i)] || '.';
      return ch === 'S' ? '.' : ch;
    };
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const arena = {
      get: grid, map: M, toTile: x => Math.floor(x / TILE + N / 2), charAt(x, z) { return grid(this.toTile(x), this.toTile(z)); },
      center: (i, j, v = new THREE.Vector3()) => v.set((i - N / 2) * TILE + TILE / 2, 0, (j - N / 2) * TILE + TILE / 2),
    };
    const calls = [], geo = (g, what) => assert.ok(g?.isBufferGeometry && g.attributes.position.count > 0, `${file}: ${what} is not a geometry`);
    const L = {
      THREE, group: new THREE.Group(), arena, map: M, key, density: 1, rand, toy, game: { brawlers: [] },
      spots(test, n) {
        const ok = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (test(grid(i, j), i, j)) ok.push(arena.center(i, j));
        return ok.length ? Array.from({ length: n }, () => ok[Math.floor(rand() * ok.length)].clone()) : [];
      },
      seen: () => [],
      flock(o) { geo(o.body, 'flock body'); geo(o.wing, 'flock wing'); calls.push(['flock', o.count ?? 8]); },
      walkers(o) { geo(o.geometry, 'walker geometry'); if (o.on) assert.equal(typeof o.on, 'function'); calls.push(['walkers', o.count ?? 5]); },
      swarm(o) { if (o.geometry) geo(o.geometry, 'swarm geometry'); if (o.at) assert.ok(Array.isArray(o.at)); calls.push(['swarm', o.count ?? 12]); },
      every(fn) { assert.equal(typeof fn, 'function'); fn(0.016, 1); calls.push(['every', 0]); },
    };
    const mod = await import(new URL(file, dir));
    assert.equal(typeof mod.default, 'function', `${file}: no default export`);
    mod.default(L);
    assert.ok(calls.length > 0, `${file}: builds nothing`);
    const total = calls.reduce((s, [, n]) => s + n, 0);
    assert.ok(calls.length <= 8, `${file}: ${calls.length} systems (8 at most: one draw call or three each)`);
    assert.ok(total <= 160, `${file}: ${total} creatures (160 at most)`);
    L.group.traverse(o => { if (o.isMesh) assert.ok(o.geometry, `${file}: a mesh without geometry`); });
    console.log(`ok   ambient ${key}: ${calls.map(([k, n]) => `${k}${n ? ' ' + n : ''}`).join(', ')}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ambient ${key}\n     ${err.message}`);
  }
}
if (failed) { console.log(`\n${failed} ambient map file(s) failed`); process.exit(1); }
console.log('\nall ambient tests passed');
