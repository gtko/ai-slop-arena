import * as THREE from 'three';
import { N, TILE } from '../arena.js';
import { mulberry } from '../materials.js';
import { toy } from './toy.js';

// Ambient life: fauna and small living details, one file per map in ./maps/<mapKey>.js.
//
// Purely cosmetic and client-side: never built on the server (game.headless), nothing here touches
// the rules, the network or the RNG the simulation uses. Everything is instanced (one draw call per
// species) and scaled by the particle density of the quality preset (settings "weather").
//
// Hide and seek: animals only ever react to brawlers the local player can see (game.fxVisible). A
// bird flying off a bush someone hides in would give them away.
//
// A map file exports default function (L) { ... } and builds its life with the helpers below:
//   L.toy(parts)        a chunky vertex-coloured model from primitives (the toy / figurine look)
//   L.spots(test, n)    n random tile centres whose tile char passes test(ch, i, j)
//   L.flock(opts)       flyers circling in loose formations, flapping then gliding
//   L.walkers(opts)     ground critters wandering tile to tile, hopping or waddling, shy of brawlers
//   L.swarm(opts)       tiny drifting things: butterflies, fireflies, seeds, leaves, bubbles
//   L.every(fn)         any custom per-frame update fn(dt, t)
// plus L.THREE, L.group, L.arena, L.map, L.key, L.density, L.rand, L.game.

const MODULES = import.meta.glob('./maps/*.js', { eager: true });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const _r = new THREE.Matrix4(), _w = new THREE.Matrix4(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
export class Ambient {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.name = 'ambient';
    game.arena.group.add(this.group); // disposed with the arena
    this.systems = [];
    const key = game.mapKey, mod = MODULES[`./maps/${key}.js`];
    if (!mod?.default) return;
    const g = game, self = this;
    const L = {
      THREE, group: this.group, arena: game.arena, map: game.arena.map, key, game,
      density: Math.max(0.2, Math.min(1, game.weatherDensity ?? 1)),
      rand: mulberry((Math.random() * 1e9) | 0),
      toy, spots: (test, n) => self.spots(test, n, L.rand),
      flock: o => self.add(new Flock(self, o, L)),
      walkers: o => self.add(new Walkers(self, o, L)),
      swarm: o => self.add(new Swarm(self, o, L)),
      every: fn => self.add({ update: fn }),
      // brawlers the local player can see (alive): the only ones animals may react to
      seen: () => g.brawlers.filter(b => b.alive && g.fxVisible(b)),
    };
    try { mod.default(L); } catch (err) { console.warn('ambient', key, err); }
  }

  add(s) { this.systems.push(s); return s; }

  // n random tile centres (world units, y = 0) whose tile char passes test(ch, i, j)
  spots(test, n, rand) {
    const A = this.g.arena, out = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (test(A.get(i, j), i, j)) out.push([i, j]);
    const res = [];
    for (let k = 0; k < n && out.length; k++) {
      const [i, j] = out[Math.floor(rand() * out.length)];
      res.push(A.center(i, j, new THREE.Vector3()).add(new THREE.Vector3((rand() - 0.5) * TILE * 0.7, 0, (rand() - 0.5) * TILE * 0.7)));
    }
    return res;
  }

  update(dt, t) {
    for (const s of this.systems) s.update(dt, t);
  }
}

const toyMat = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: o.double ? THREE.DoubleSide : THREE.FrontSide, flatShading: !!o.flat, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1 });
const count = (n, L) => Math.max(1, Math.round(n * L.density));

/* ------------------------------ flyers ------------------------------ */

// opts: { body: geometry (nose toward +z), wing: geometry (right wing, tip toward +x), count, flocks,
//   radius: [min, max] (circle around centre), center: [x, z], height: [min, max], speed: rad/s,
//   scale: [min, max], flap: flaps per second, glide: 0..1 share of time gliding, spread: m between birds }
class Flock {
  constructor(A, o, L) {
    const R = L.rand, n = count(o.count ?? 8, L), fl = Math.max(1, Math.min(n, o.flocks ?? 2));
    this.o = o;
    this.birds = [];
    const mat = toyMat({ double: true, emissive: o.emissive, emissiveIntensity: o.emissiveIntensity });
    const flocks = Array.from({ length: fl }, (_, f) => {
      const r = o.radius || [10, 25], h = o.height || [4, 8];
      return { r: r[0] + R() * (r[1] - r[0]), y: h[0] + R() * (h[1] - h[0]), w: (o.speed ?? 0.25) * (0.7 + R() * 0.6) * (f % 2 ? 1 : -1), a: R() * Math.PI * 2, c: o.center || [0, 0] };
    });
    const sp = o.spread ?? 1.4, sc = o.scale || [1, 1.3];
    for (let k = 0; k < n; k++) {
      const F = flocks[k % fl], m = Math.floor(k / fl), side = m % 2 ? 1 : -1, row = Math.ceil(m / 2);
      this.birds.push({ F, ox: side * row * sp * 0.9, oz: -row * sp * 0.8 + (R() - 0.5) * 0.3, oy: (R() - 0.5) * 0.5, ph: R() * 6.3, s: sc[0] + R() * (sc[1] - sc[0]) });
    }
    this.body = new THREE.InstancedMesh(o.body, mat, n);
    this.wl = new THREE.InstancedMesh(o.wing, mat, n);
    this.wr = new THREE.InstancedMesh(o.wing, mat, n);
    for (const M of [this.body, this.wl, this.wr]) { M.frustumCulled = false; M.castShadow = !!o.shadow; A.group.add(M); }
  }
  update(dt, t) {
    const o = this.o, glide = o.glide ?? 0.4, hz = (o.flap ?? 1.8) * Math.PI * 2;
    this.birds.forEach((b, k) => {
      const F = b.F, a = F.a + F.w * t, dir = Math.sign(F.w);
      const hx = -Math.sin(a) * dir, hz2 = Math.cos(a) * dir, yaw = Math.atan2(hx, hz2);
      const px = F.c[0] + Math.cos(a) * F.r + Math.cos(yaw) * b.ox + hx * b.oz, pz = F.c[1] + Math.sin(a) * F.r - Math.sin(yaw) * b.ox + hz2 * b.oz;
      _q.setFromAxisAngle(UP, yaw);
      _m.compose(_v.set(px, F.y + b.oy + Math.sin(t * 0.8 + b.ph) * 0.3, pz), _q, _s.setScalar(b.s));
      this.body.setMatrixAt(k, _m);
      const cyc = ((t * 0.35 + b.ph) % 2) / 2, flap = cyc > glide ? Math.sin(t * hz + b.ph) * 0.65 : 0.12;
      _r.makeRotationZ(flap);
      this.wr.setMatrixAt(k, _w.multiplyMatrices(_m, _r));
      _r.makeRotationZ(-flap).multiply(_w.makeScale(-1, 1, 1));
      this.wl.setMatrixAt(k, _w.multiplyMatrices(_m, _r));
    });
    this.body.instanceMatrix.needsUpdate = this.wl.instanceMatrix.needsUpdate = this.wr.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------ walkers ------------------------------ */

// opts: { geometry (facing +z, feet at y = 0), count, on: test(ch, i, j) for the tiles they live on
//   (default open floor '.'), speed: m/s, pause: [min, max] s, range: tiles from home, scale: [min, max],
//   gait: 'hop' | 'waddle' | 'scuttle' | 'slither', shy: m (flee visible brawlers closer than this, 0 = never),
//   y: height offset (e.g. on a rock), shadow }
class Walkers {
  constructor(A, o, L) {
    this.A = A; this.o = o; this.L = L;
    const R = L.rand, n = count(o.count ?? 5, L), on = o.on || (ch => ch === '.');
    this.on = on;
    const homes = L.spots(on, n), sc = o.scale || [1, 1];
    this.list = homes.map(p => ({ home: p.clone(), pos: p.clone(), to: p.clone(), yaw: R() * 6.3, wait: R() * 3, ph: R() * 6.3, s: sc[0] + R() * (sc[1] - sc[0]), moving: false, flee: 0 }));
    this.mesh = new THREE.InstancedMesh(o.geometry, toyMat(o), Math.max(1, this.list.length));
    this.mesh.count = this.list.length;
    this.mesh.castShadow = o.shadow ?? true;
    this.mesh.frustumCulled = false;
    A.group.add(this.mesh);
  }
  pick(w) { // a new target near home, on a tile of the right kind
    const L = this.L, R = L.rand, A = L.arena, rg = (this.o.range ?? 2) * TILE;
    for (let k = 0; k < 8; k++) {
      const x = w.home.x + (R() - 0.5) * 2 * rg, z = w.home.z + (R() - 0.5) * 2 * rg, i = A.toTile(x), j = A.toTile(z);
      if (this.on(A.get(i, j), i, j)) { w.to.set(x, 0, z); return; }
    }
    w.to.copy(w.home);
  }
  update(dt, t) {
    const o = this.o, A = this.L.arena, speed = o.speed ?? 0.8, shy = o.shy ?? 2.5, seen = shy ? this.L.seen() : [];
    this.list.forEach((w, k) => {
      // a visible brawler too close: run the other way (never from someone hidden)
      if (shy) for (const b of seen) {
        const dx = w.pos.x - b.pos.x, dz = w.pos.z - b.pos.z, d = Math.hypot(dx, dz);
        if (d < shy && w.flee <= 0) { w.to.set(w.pos.x + dx / (d || 1) * 3, 0, w.pos.z + dz / (d || 1) * 3); w.flee = 1.2; w.moving = true; }
      }
      w.flee -= dt;
      if (!w.moving && (w.wait -= dt) <= 0) { this.pick(w); w.moving = true; }
      if (w.moving) {
        const dx = w.to.x - w.pos.x, dz = w.to.z - w.pos.z, d = Math.hypot(dx, dz), v = speed * (w.flee > 0 ? 2.2 : 1) * dt;
        if (d < 0.05) { w.moving = false; const p = o.pause || [1.5, 4]; w.wait = p[0] + this.L.rand() * (p[1] - p[0]); }
        else {
          const nx = w.pos.x + dx / d * Math.min(v, d), nz = w.pos.z + dz / d * Math.min(v, d), i = A.toTile(nx), j = A.toTile(nz);
          if (this.on(A.get(i, j), i, j)) { w.pos.x = nx; w.pos.z = nz; } else w.moving = false; // the ground changed (a wall, the void)
          const want = Math.atan2(dx, dz);
          w.yaw += Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)) * Math.min(1, dt * 10);
        }
      }
      // gone ground (a crumbled island, a broken tile): hide it
      const here = this.on(A.charAt(w.pos.x, w.pos.z), A.toTile(w.pos.x), A.toTile(w.pos.z));
      let y = o.y ?? 0, roll = 0, pitch = 0;
      const ph = t * (o.gait === 'scuttle' ? 22 : 9) + w.ph;
      if (w.moving) {
        if (o.gait === 'hop') y += Math.abs(Math.sin(ph * 0.7)) * 0.25 * w.s;
        else if (o.gait === 'waddle') roll = Math.sin(ph) * 0.18;
        else if (o.gait === 'scuttle') y += Math.abs(Math.sin(ph)) * 0.02;
        else if (o.gait === 'slither') roll = Math.sin(ph * 0.6) * 0.1;
      } else pitch = Math.sin(t * 1.3 + w.ph) * 0.04; // breathing / looking around
      _q.setFromEuler(_e.set(pitch, w.yaw + (o.gait === 'slither' && w.moving ? Math.sin(ph * 0.6) * 0.3 : 0), roll, 'YXZ'));
      _m.compose(_v.set(w.pos.x, y, w.pos.z), _q, _s.setScalar(here ? w.s : 0));
      this.mesh.setMatrixAt(k, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------ swarms ------------------------------ */

// opts: { geometry (default: a small two-winged butterfly), count, at: [Vector3] anchor points (default:
//   spots on open floor), radius: m around the anchor, height: [min, max], speed, flutter: wing flap
//   speed (0 = rigid), colors: [hex] (per instance), glow: emissive strength (fireflies), pulse: blink speed,
//   drift: [x, z] m/s wind (things carried away, wrapped around the arena), scale: [min, max], spin }
class Swarm {
  constructor(A, o, L) {
    const R = L.rand, n = count(o.count ?? 12, L);
    this.o = o; this.L = L;
    const at = o.at && o.at.length ? o.at : L.spots(ch => ch === '.', 6);
    const h = o.height || [0.5, 2], sc = o.scale || [1, 1];
    this.list = Array.from({ length: n }, () => {
      const a = at[Math.floor(R() * at.length)] || new THREE.Vector3();
      return { a: a.clone(), ph: R() * 6.3, f: 0.6 + R() * 0.8, y: h[0] + R() * (h[1] - h[0]), s: sc[0] + R() * (sc[1] - sc[0]), off: new THREE.Vector3() };
    });
    const geo = o.geometry || toy([
      { shape: 'tri', args: [0.22, 0.2], pos: [0, 0, 0] },
      { shape: 'tri', args: [0.22, 0.2], pos: [0, 0, 0], rot: [0, Math.PI, 0] },
    ]);
    const glow = o.glow ?? 0;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: !o.colors, color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide, emissive: glow ? 0xffffff : 0x000000, emissiveIntensity: glow });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    if (o.colors) this.list.forEach((p, k) => this.mesh.setColorAt(k, new THREE.Color(o.colors[k % o.colors.length])));
    A.group.add(this.mesh);
    this.half = N * TILE / 2;
  }
  update(dt, t) {
    const o = this.o, r = o.radius ?? 2.5, sp = o.speed ?? 0.6, fl = o.flutter ?? 14, H = this.half + 6;
    this.list.forEach((p, k) => {
      const tt = t * sp * p.f + p.ph;
      if (o.drift) { // carried by the wind, wrapped around
        p.off.x += o.drift[0] * dt; p.off.z += o.drift[1] * dt;
        const x = p.a.x + p.off.x; if (x > H) p.off.x -= 2 * H; if (x < -H) p.off.x += 2 * H;
        const z = p.a.z + p.off.z; if (z > H) p.off.z -= 2 * H; if (z < -H) p.off.z += 2 * H;
      }
      const x = p.a.x + p.off.x + Math.sin(tt) * r * Math.cos(tt * 0.37), z = p.a.z + p.off.z + Math.cos(tt * 0.83) * r * Math.sin(tt * 0.29 + 1);
      const y = p.y + Math.sin(tt * 1.7) * 0.35;
      const yaw = Math.atan2(Math.cos(tt) * Math.cos(tt * 0.37), -Math.sin(tt * 0.83));
      const flap = fl ? Math.sin(t * fl + p.ph) * 0.9 : 0;
      _q.setFromEuler(_e.set(o.spin ? t * o.spin + p.ph : 0, yaw, 0, 'YXZ'));
      let s = p.s;
      if (o.pulse) s *= 0.55 + 0.45 * Math.max(0, Math.sin(t * o.pulse + p.ph * 3)); // fireflies blink
      _m.compose(_v.set(x, y, z), _q, _s.set(s * (fl ? Math.max(0.15, Math.abs(Math.cos(flap))) : 1), s, s));
      this.mesh.setMatrixAt(k, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
