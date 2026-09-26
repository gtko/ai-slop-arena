import * as THREE from 'three';
import { N, TILE } from '../arena.js';
import { mulberry } from '../materials.js';
import { toy } from './toy.js';
import { Puppets, frustumOf } from './fauna.js';
import { WATER_Y } from '../water.js';

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
//   L.flock(opts)       flyers circling in loose formations, flapping then gliding (rigged with `key`)
//   L.walkers(opts)     ground critters wandering tile to tile, hopping or waddling, shy of brawlers
//   L.critters(opts)    the same with a rigged, animated model (fauna.js), the toy standing in meanwhile
//   L.rig(key, n)       n rigged creatures a map drives itself (Puppets in fauna.js; none past the budget)
//   L.swarm(opts)       tiny drifting things: butterflies, fireflies, seeds, leaves, bubbles
//   L.every(fn)         any custom per-frame update fn(dt, t)
// plus L.THREE, L.group, L.arena, L.map, L.key, L.density, L.rand, L.game.

const MODULES = import.meta.glob('./maps/*.js', { eager: true });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const _r = new THREE.Matrix4(), _w = new THREE.Matrix4(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
export const RIG_BUDGET = 40; // skinned creatures per map at full density (one draw + one mixer each)
export class Ambient {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.name = 'ambient';
    game.arena.group.add(this.group); // disposed with the arena
    // rigged creatures: outside the arena group, whose dispose would free their shared species assets
    this.rigRoot = new THREE.Group();
    this.rigRoot.name = 'ambient-rigs';
    game.scene.add(this.rigRoot);
    this.puppets = [];
    this.rigs = 0;
    this.dead = false;
    this.systems = [];
    this.seen = [];
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
      critters: o => self.add(new Critters(self, o, L)),
      rig: (key, n, o) => self.rig(key, n, o),
      swarm: o => self.add(new Swarm(self, o, L)),
      every: fn => self.add({ update: fn }),
      // brawlers the local player can see (alive): the only ones animals may react to
      seen: () => self.seen,
    };
    try { mod.default(L); } catch (err) { console.warn('ambient', key, err); }
  }

  add(s) { this.systems.push(s); return s; }

  // n rigged creatures of a species, if the map's budget still has room (else it keeps its toy)
  rig(key, n, o) {
    if (this.rigs + n > RIG_BUDGET) { console.warn('ambient: over the rig budget', key); n = 0; }
    this.rigs += n;
    const P = new Puppets(this, key, n, o);
    this.puppets.push(P);
    return P;
  }

  dispose() {
    this.dead = true; // a model still loading must not build into a finished match
    for (const P of this.puppets) P.dispose();
    this.puppets = [];
    this.rigRoot.removeFromParent();
  }

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
    const g = this.g;
    this.seen = g.brawlers.filter(b => b.alive && g.fxVisible(b)); // once a frame, for every species
    for (const s of this.systems) { // in order: a map's own L.every may adjust what a helper just placed
      if (s.broken) continue;
      try { s.update(dt, t); } catch (err) { // cosmetic: a broken species stops, the match plays on
        console.warn('ambient', g.mapKey, err);
        s.broken = true;
      }
    }
    const fr = frustumOf(g.camera);
    for (const P of this.puppets) P.update(dt, fr); // after the systems posed them
  }
}

const toyMat = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: o.double ? THREE.DoubleSide : THREE.FrontSide, flatShading: !!o.flat, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1 });
const count = (n, L) => Math.max(1, Math.round(n * L.density));

/* ------------------------------ flyers ------------------------------ */

// opts: { body: geometry (nose toward +z), wing: geometry (right wing, tip toward +x), count, flocks,
//   radius: [min, max] (circle around centre), center: [x, z], height: [min, max], speed: rad/s,
//   scale: [min, max], flap: flaps per second, glide: 0..1 share of time gliding, spread: m between birds,
//   key: a rigged flyer (fauna.js: Fly and Glide clips) that replaces the toy body and wings once loaded,
//   rigScale: its size relative to scale (the models are real size) }
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
    this.P = o.key ? A.rig(o.key, n, { radius: 2 }) : null;
  }
  update(dt, t) {
    const o = this.o, glide = o.glide ?? 0.4, hz = (o.flap ?? 1.8) * Math.PI * 2, P = this.P?.ready ? this.P : null;
    if (P && this.body.visible) this.body.visible = this.wl.visible = this.wr.visible = false;
    this.birds.forEach((b, k) => {
      const F = b.F, a = F.a + F.w * t, dir = Math.sign(F.w);
      const hx = -Math.sin(a) * dir, hz2 = Math.cos(a) * dir, yaw = Math.atan2(hx, hz2);
      const px = F.c[0] + Math.cos(a) * F.r + Math.cos(yaw) * b.ox + hx * b.oz, pz = F.c[1] + Math.sin(a) * F.r - Math.sin(yaw) * b.ox + hz2 * b.oz;
      const y = F.y + b.oy + Math.sin(t * 0.8 + b.ph) * 0.3, cyc = ((t * 0.35 + b.ph) % 2) / 2;
      if (P) {
        // bank into the turn (the wing on the circle's inner side dips), more for a tight fast circle;
        // a flap burst now and then, gliding the rest of the time
        const side = Math.cos(a) * Math.cos(yaw) - Math.sin(a) * Math.sin(yaw); // circle centre . the bird's right (-x)
        const bank = Math.min(0.6, Math.atan(F.r * F.w * F.w / 9.8) * 3 + 0.12) * Math.sign(side);
        const flapping = cyc > glide;
        P.pose(k, px, y, pz, yaw, flapping ? -0.08 : 0.04, bank + Math.sin(t * 0.9 + b.ph) * 0.06, b.s * (o.rigScale ?? 1));
        if (!(flapping && P.play(k, 'Fly', 1, 0.5)) && !P.play(k, 'Glide', 1, 0.6)) P.play(k, 'Fly', 0.35, 0.6);
        return;
      }
      _q.setFromAxisAngle(UP, yaw);
      _m.compose(_v.set(px, y, pz), _q, _s.setScalar(b.s));
      this.body.setMatrixAt(k, _m);
      const flap = cyc > glide ? Math.sin(t * hz + b.ph) * 0.65 : 0.12;
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

/* ------------------------------ critters ------------------------------ */

// Ground animals with a rigged model (fauna.js), wandering like walkers and driving its clips: Idle
// while standing, with an extra now and then (Look, Sniff, Sit, Peck...), Walk / Hop / Run while moving
// at a playback rate matching the real speed, Run (or faster hops) away from a visible brawler. The
// toy (opts.toy, drawn like walkers with opts.gait) stands in until the model is in, or for good.
// opts: { key, toy: geometry, gait, count, on: test(ch, i, j) for the ground they walk (default '.'),
//   home: test for the tiles they start on (default on), speed: walk m/s, run: flee m/s, pause: [min, max] s,
//   range: tiles from home, shy: m (flee visible brawlers closer than this, 0 = never), scale: [min, max],
//   rigScale: the model's size relative to scale (models are real size), idles: [extra clips allowed],
//   extra: chance of an extra per pause, hop: move in hops (default: the model has Hop and no Walk),
//   turn: rad/s, y: height offset, shadow,
//   slide: test(ch) for tiles to belly-slide on (penguins: Slide clip), slideSpeed: m/s,
//   swim: test(ch) for water tiles (ducks: Swim clip, the body at the surface), float: m it sits below it }
const EXTRAS = ['Look', 'Sniff', 'Sit', 'Scratch', 'Groom', 'Peck', 'Croak', 'Ears', 'TailFlick', 'Pushup', 'Flap'];
const NONE = [];
class Critters {
  constructor(A, o, L) {
    this.o = o; this.L = L;
    const R = L.rand, n = count(o.count ?? 5, L), on = o.on || (ch => ch === '.');
    this.on = on;
    const homes = L.spots(o.home || on, n), sc = o.scale || [1, 1];
    this.list = homes.map(p => ({ home: p.clone(), pos: p.clone(), to: p.clone(), yaw: R() * 6.3, wait: R() * 3, ph: R() * 6.3,
      s: sc[0] + R() * (sc[1] - sc[0]), mode: 0, flee: 0, vx: 0, vz: 0, y: o.y ?? 0, lie: 0, idle: 0, xAt: -1, x: null }));
    const geo = o.toy || toy([{ shape: 'sphere', args: [0.15, 1, 0.8, 1.3], pos: [0, 0.13, 0], color: 0x9a8570 }]);
    this.mesh = new THREE.InstancedMesh(geo, toyMat(o), Math.max(1, this.list.length));
    this.mesh.count = this.list.length;
    this.mesh.castShadow = o.shadow ?? true;
    this.mesh.frustumCulled = false;
    A.group.add(this.mesh);
    this.P = A.rig(o.key, this.list.length);
    this.extras = NONE; this.hop = false;
  }
  pick(c) { // a new target near home, on ground of the right kind
    const L = this.L, R = L.rand, A = L.arena, rg = (this.o.range ?? 2) * TILE;
    for (let k = 0; k < 8; k++) {
      const x = c.home.x + (R() - 0.5) * 2 * rg, z = c.home.z + (R() - 0.5) * 2 * rg, i = A.toTile(x), j = A.toTile(z);
      if (this.on(A.get(i, j), i, j)) { c.to.set(x, 0, z); return; }
    }
    c.to.copy(c.home);
  }
  rest(c) {
    const o = this.o, R = this.L.rand, p = o.pause || [1.5, 4];
    c.mode = 0; c.vx = c.vz = 0; c.idle = 0;
    c.wait = p[0] + R() * (p[1] - p[0]);
    c.xAt = R() < (o.extra ?? 0.6) ? c.wait * (0.1 + R() * 0.5) : -1; // an extra during this pause
  }
  slides(x, z) { return !!this.o.slide?.(this.L.arena.charAt(x, z)); }
  slide(c, dx, dz, v) { // only with ice ahead to slide on
    if (!this.slides(c.pos.x + dx * 1.5, c.pos.z + dz * 1.5)) return false;
    c.mode = 3; c.vx = dx * v; c.vz = dz * v; c.yaw = Math.atan2(dx, dz); c.x = null;
    return true;
  }
  update(dt, t) {
    const o = this.o, L = this.L, A = L.arena, R = L.rand, P = this.P.ready ? this.P : null;
    const walk = o.speed ?? 0.8, run = o.run ?? walk * 2.5, shy = o.shy ?? 2.5, seen = shy ? L.seen() : NONE, turn = o.turn ?? 6, slideV = o.slideSpeed ?? 3;
    if (P && this.mesh.visible) { // the model just came in
      this.mesh.visible = false;
      this.extras = (o.idles || EXTRAS).filter(x => P.has(x));
      this.hop = o.hop ?? (P.has('Hop') && !P.has('Walk'));
    }
    for (let k = 0; k < this.list.length; k++) {
      const c = this.list[k];
      // a visible brawler too close: run the other way, or slide off on the ice (never from someone hidden)
      c.flee -= dt;
      if (shy && c.flee <= 0 && c.mode !== 3) for (const b of seen) {
        const dx = c.pos.x - b.pos.x, dz = c.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
        if (d >= shy) continue;
        c.flee = 1.4; c.x = null;
        if (!(this.slides(c.pos.x, c.pos.z) && this.slide(c, dx / d, dz / d, slideV * 1.4))) { c.to.set(c.pos.x + dx / d * 3, 0, c.pos.z + dz / d * 3); c.mode = 2; }
        break;
      }
      if (c.mode === 0) {
        c.idle += dt;
        if ((c.wait -= dt) <= 0) {
          let slid = false;
          if (this.slides(c.pos.x, c.pos.z) && R() < 0.6) for (let a = 0; a < 4 && !slid; a++) { const r = R() * 6.3; slid = this.slide(c, Math.sin(r), Math.cos(r), slideV * (0.8 + R() * 0.5)); }
          if (!slid) { this.pick(c); c.mode = 1; c.x = null; }
        }
      }
      let moving = false;
      if (c.mode === 1 || c.mode === 2) {
        const dx = c.to.x - c.pos.x, dz = c.to.z - c.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.08) this.rest(c);
        else {
          moving = true;
          // turn toward the target, slowing down while facing away (no moonwalking)
          const want = Math.atan2(dx, dz), diff = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)), tr = turn * (c.mode === 2 ? 1.6 : 1) * dt;
          c.yaw += Math.max(-tr, Math.min(tr, diff));
          let step = (c.mode === 2 ? run : walk) * Math.max(0.25, Math.cos(diff)) * dt;
          if (P && this.hop && P.T.hop) step *= P.current(k) === 'Hop' ? P.T.hop[Math.floor(P.phase(k) * 24) % 24] : 0; // only while airborne
          step = Math.min(step, d);
          const nx = c.pos.x + dx / d * step, nz = c.pos.z + dz / d * step, i = A.toTile(nx), j = A.toTile(nz);
          if (this.on(A.get(i, j), i, j)) { c.pos.x = nx; c.pos.z = nz; } else this.rest(c); // the ground changed (a wall, the void)
        }
      } else if (c.mode === 3) { // belly slide: friction, stops where the ice ends
        const sp = Math.hypot(c.vx, c.vz), nx = c.pos.x + c.vx * dt, nz = c.pos.z + c.vz * dt;
        if (sp < 0.3 || !this.slides(nx, nz)) this.rest(c);
        else { c.pos.x = nx; c.pos.z = nz; const f = Math.max(0, sp - 0.6 * dt) / sp; c.vx *= f; c.vz *= f; }
      }
      // ground gone (a crumbled island, a broken tile): hide it. Water: float at the surface
      const ch = A.charAt(c.pos.x, c.pos.z), here = this.on(ch, A.toTile(c.pos.x), A.toTile(c.pos.z)), swim = !!o.swim?.(ch);
      const s = here ? c.s : 0, ty = (o.y ?? 0) + (swim ? WATER_Y - (o.float ?? 0.1) * c.s : 0);
      c.y += (ty - c.y) * Math.min(1, dt * 6);
      c.lie += ((c.mode === 3 ? 1 : 0) - c.lie) * Math.min(1, dt * 7);
      if (P) { this.animate(P, k, c, moving, swim, s * (o.rigScale ?? 1), walk, run); continue; }
      // the toy: bobbing by gait (walkers), flopped on its belly when sliding
      let y = c.y, roll = 0, pitch = c.lie * Math.PI / 2;
      const ph = t * (o.gait === 'scuttle' ? 22 : 9) + c.ph;
      if (moving) {
        if (o.gait === 'hop') y += Math.abs(Math.sin(ph * 0.7)) * 0.25 * c.s;
        else if (o.gait === 'waddle') roll = Math.sin(ph) * 0.18;
        else if (o.gait === 'scuttle') y += Math.abs(Math.sin(ph)) * 0.02;
      } else if (c.mode === 0) pitch += Math.sin(t * 1.3 + c.ph) * 0.04;
      y += (c.lie * 0.2 + Math.sin(c.lie * Math.PI) * 0.15) * c.s;
      _q.setFromEuler(_e.set(pitch, c.yaw, roll, 'YXZ'));
      _m.compose(_v.set(c.pos.x, y, c.pos.z), _q, _s.setScalar(s));
      this.mesh.setMatrixAt(k, _m);
    }
    if (!P) this.mesh.instanceMatrix.needsUpdate = true;
  }
  // the model's clip for what the critter does, at a playback rate matching its real ground speed
  animate(P, k, c, moving, swim, s, walk, run) {
    let clip = 'Idle', rate = 1, pitch = 0, y = c.y;
    if (c.mode === 3) {
      if (P.has('Slide')) clip = 'Slide';
      else { pitch = c.lie * Math.PI / 2; y += c.lie * 0.2 * s; } // no belly slide: flop the idle pose
    } else if (moving) {
      clip = swim && P.has('Swim') ? 'Swim' : this.hop ? 'Hop' : c.mode === 2 && P.has('Run') ? 'Run' : P.has('Walk') ? 'Walk' : 'Hop';
      rate = Math.max(0.4, Math.min(2.5, (c.mode === 2 ? run : walk) / (P.speed(clip) * Math.max(0.05, s))));
    } else if (swim && P.has('Swim')) rate = 0.5, clip = 'Swim'; // paddling on the spot
    else if (c.x) clip = P.done(k) ? (c.x = null, 'Idle') : null; // an extra plays to its end
    else if (c.xAt >= 0 && c.idle >= c.xAt && this.extras.length) {
      c.x = this.extras[Math.floor(this.L.rand() * this.extras.length)]; c.xAt = -1; clip = null;
      P.play(k, c.x, 1, 0.3, true);
    }
    if (clip) P.play(k, clip, rate, 0.25);
    P.pose(k, c.pos.x, y, c.pos.z, c.yaw, pitch, 0, s);
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
