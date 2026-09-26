import * as THREE from 'three';
import { N, TILE, HALF, BOUND_H } from './arena.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _e = new THREE.Euler(), _sc = new THREE.Vector3();

// Showdown gas: every `interval` seconds another ring of tiles fills with glowing cloud.
export class Poison {
  constructor(game, { startAt = 28, interval = 7, maxLevel = 9 } = {}) {
    this.g = game;
    this.startAt = startAt;
    this.interval = interval;
    this.maxLevel = maxLevel;
    this.timer = 0;
    this.level = 0; // rings 0..level are poisoned (level 0 = none)
    this.tileT = new Float32Array(N * N).fill(-1);
    this.active = [];
    this.lanes = []; // Tidal Wave: strips of ground the gas leaves alone for a moment
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x58d46a, emissive: 0x1fc04a, emissiveIntensity: 0.9, roughness: 1, flatShading: true,
      transparent: true, opacity: 0.6, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, N * N * 2);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    game.fx.add(this.mesh);
    // the next ring, drawn on the floor for the last 6 s before it fills: a square frame, blinking
    this.warn = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.5, 2.4, 0.8), transparent: true, opacity: 0, depthWrite: false }));
    this.warn.renderOrder = 1;
    this.warn.visible = false;
    this.warnHalf = -1;
    game.fx.add(this.warn);
  }

  // Square frame on the floor: outer half-size h, 0.35 m wide.
  frame(h) {
    const w = 0.35, o = h, i = h - w, y = 0.07;
    const v = [];
    const quad = (x0, z0, x1, z1) => v.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    quad(-o, -o, o, -i); quad(-o, i, o, o); quad(-o, -i, -i, i); quad(i, -i, o, i);
    this.warn.geometry.dispose();
    this.warn.geometry = new THREE.BufferGeometry();
    this.warn.geometry.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    this.warnHalf = h;
  }

  get safeHalf() { return this.level > 0 ? HALF - (this.level + 1) * TILE : HALF; }
  get nextIn() {
    if (this.level >= this.maxLevel) return Infinity;
    return this.level === 0 ? this.startAt - this.timer : this.startAt + this.level * this.interval - this.timer;
  }

  update(dt, t) {
    this.timer += dt;
    const target = this.timer < this.startAt ? 0
      : Math.min(this.maxLevel, 1 + Math.floor((this.timer - this.startAt) / this.interval));
    while (this.level < target) {
      this.level++;
      const A = this.g.arena;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const r = A.ring(i, j);
        if (r > this.level || this.tileT[j * N + i] >= 0) continue;
        this.tileT[j * N + i] = this.timer;
        this.active.push({ i, j, t0: this.timer, ph: Math.random() * 10, y0: r === 0 ? BOUND_H : 0 });
      }
    }
    const A = this.g.arena, c = _p;
    let n = 0;
    for (const a of this.active) {
      const age = this.timer - a.t0;
      const grow = THREE.MathUtils.smoothstep(age, 0, 1.8);
      A.center(a.i, a.j, c);
      for (let p = 0; p < 2; p++) {
        const ph = a.ph + p * 2.3;
        const x = c.x + Math.sin(ph * 3.1) * 0.5, z = c.z + Math.cos(ph * 2.7) * 0.5;
        const y = a.y0 + 0.7 + p * 0.9 + Math.sin(t * 1.1 + ph) * 0.25;
        const sc = (p ? 0.95 : 1.3) * (1 + 0.15 * Math.sin(t * 0.9 + ph * 3)) * grow;
        _e.set(ph, t * 0.2 + ph, 0);
        _q.setFromEuler(_e);
        _m.compose(_s.set(x, y, z), _q, _sc.set(sc, sc * 0.8, sc));
        this.mesh.setMatrixAt(n++, _m);
      }
    }
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;

    const soon = this.nextIn, next = HALF - (this.level + 2) * TILE;
    this.warn.visible = soon < 6 && soon > 0 && next > 0;
    if (this.warn.visible) {
      if (next !== this.warnHalf) this.frame(next);
      this.warn.material.opacity = (0.35 + 0.35 * Math.sin(t * (soon < 2 ? 14 : 7))) * Math.min(1, (6 - soon) / 1.5);
    }
  }

  // A strip `len` long and 2*half wide from (x, z) along (dx, dz), free of gas for `time` seconds.
  clearLane(x, z, dx, dz, len, half, time) { this.lanes.push({ x, z, dx, dz, len, half, until: this.timer + time }); }
  inLane(x, z) {
    this.lanes = this.lanes.filter(L => L.until > this.timer);
    return this.lanes.some(L => {
      const rx = x - L.x, rz = z - L.z, along = rx * L.dx + rz * L.dz;
      return along >= 0 && along <= L.len && Math.abs(rx * -L.dz + rz * L.dx) <= L.half;
    });
  }

  isPoisonedAt(x, z) {
    const A = this.g.arena, i = A.toTile(x), j = A.toTile(z);
    if (i < 0 || j < 0 || i >= N || j >= N) return true;
    if (this.lanes.length && this.inLane(x, z)) return false;
    const t = this.tileT[j * N + i];
    return t >= 0 && this.timer - t > 0.6;
  }

  // Green glow spilling out of the gas wall nearest to the camera.
  emit(pool, focus) {
    if (this.level === 0) return;
    const s = this.safeHalf;
    const cand = [
      [Math.abs(s - focus.x), s + 1, THREE.MathUtils.clamp(focus.z, -s, s)],
      [Math.abs(-s - focus.x), -s - 1, THREE.MathUtils.clamp(focus.z, -s, s)],
      [Math.abs(s - focus.z), THREE.MathUtils.clamp(focus.x, -s, s), s + 1],
      [Math.abs(-s - focus.z), THREE.MathUtils.clamp(focus.x, -s, s), -s - 1],
    ].sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < 2; k++) pool.add(cand[k][1], 1.6, cand[k][2], 0.35, 1.0, 0.4, 14, 11);
  }

  dispose() {
    this.g.fx.remove(this.mesh, this.warn);
    this.warn.geometry.dispose();
    this.warn.material.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
