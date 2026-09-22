import * as THREE from 'three';
import { radialTexture } from './materials.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/* ------------------------------------------------------------------ */
/* Dynamic light pool                                                  */
/*                                                                     */
/* Forward renderers pay per light and recompile shaders when the      */
/* light count changes. So we keep a FIXED number of PointLights and   */
/* each frame hand them to the most relevant emitters (projectiles,    */
/* torches, explosions, muzzle flashes...) scored by brightness and    */
/* distance to the camera focus. Distant emitters fade out before they */
/* can lose their slot, so re-assignment never pops on screen.         */
/* ------------------------------------------------------------------ */

export class LightPool {
  constructor(scene, size = 12) {
    this.size = size;
    this.lights = [];
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
    this.list = [];
    this.n = 0;
    this.focus = new THREE.Vector3();
    this.enabled = true;
    this.used = 0;
    this.candidates = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, r, g, b, intensity, range) {
    if (intensity <= 0.01) return;
    let e = this.list[this.n];
    if (!e) e = this.list[this.n] = { x: 0, y: 0, z: 0, r: 1, g: 1, b: 1, i: 0, range: 0, score: 0 };
    e.x = x; e.y = y; e.z = z; e.r = r; e.g = g; e.b = b; e.i = intensity; e.range = range;
    this.n++;
  }
  end() {
    const f = this.focus, n = this.n, L = this.list;
    for (let k = 0; k < n; k++) {
      const e = L[k];
      const d = Math.hypot(e.x - f.x, (e.z - f.z) * 1.2);
      const fade = 1 - THREE.MathUtils.smoothstep(d, 22, 30);
      e.i *= fade;
      e.score = e.i * e.range / (6 + d);
    }
    const active = L.slice(0, n).filter(e => e.i > 0.02).sort((a, b) => b.score - a.score);
    this.candidates = active.length;
    let used = 0;
    for (let k = 0; k < this.size; k++) {
      const l = this.lights[k], e = active[k];
      if (e && this.enabled) {
        l.position.set(e.x, e.y, e.z);
        l.color.setRGB(e.r, e.g, e.b);
        l.intensity = e.i;
        l.distance = e.range;
        used++;
      } else {
        l.intensity = 0;
      }
    }
    this.used = used;
  }
}

/* ------------------------------------------------------------------ */
/* Instanced particle layer                                            */
/* ------------------------------------------------------------------ */

class Layer {
  constructor(parent, geo, mat, max, castShadow = false) {
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    parent.add(mesh);
    this.mesh = mesh;
    this.max = max;
    this.items = [];
  }
  spawn(o) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(o);
  }
  update(dt) {
    const it = this.items;
    let n = 0;
    for (let k = 0; k < it.length; k++) {
      const p = it[k];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav * dt;
      if (p.drag) {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy *= d; p.vz *= d;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.bounce && p.y < p.size * 0.5) {
        p.y = p.size * 0.5;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.55; p.vz *= 0.55; p.spin *= 0.5;
      }
      p.rot += p.spin * dt;
      const a = p.life / p.max;
      let sc = p.size * (1 + (1 - a) * p.grow);
      if (a < p.shrink) sc *= a / p.shrink;
      _e.set(p.rot, p.rot * 0.7, p.rot * 0.3);
      _q.setFromEuler(_e);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(sc, sc * p.sy, sc));
      this.mesh.setMatrixAt(n, _m);
      const f = p.fade ? a : 1;
      this.mesh.setColorAt(n, _c.setRGB(p.r * f, p.g * f, p.b * f));
      it[n++] = p;
    }
    it.length = n;
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

function particle(x, y, z, vx, vy, vz, life, size, r, g, b, o) {
  return Object.assign({
    x, y, z, vx, vy, vz, life, max: life, size, r, g, b,
    grav: 0, drag: 0, rot: Math.random() * 6, spin: 0, bounce: false, grow: 0, shrink: 1, fade: false, sy: 1,
  }, o);
}

const rnd = (a, b) => a + Math.random() * (b - a);

/* ------------------------------------------------------------------ */

export class Effects {
  constructor(root) {
    this.root = root;
    this.sparks = new Layer(root, new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial(), 800);
    this.debris = new Layer(root, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 360, true);
    this.smoke = new Layer(root, new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, transparent: true, opacity: 0.55, depthWrite: false }), 320);
    this.fire = new Layer(root, new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 260);
    this.flashes = [];
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.82, 1, 56);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.scorches = [];
    this.scorchTex = radialTexture('rgba(20,12,8,0.9)', 'rgba(20,12,8,0)', 128, 60);
    this.scorchGeo = new THREE.PlaneGeometry(1, 1);
    this.scorchGeo.rotateX(-Math.PI / 2);
  }

  // Jagged lightning ribbon through a list of [x, z] points (chain lightning), at chest height.
  arc(pts, col) {
    const pos = [], w = 0.09, y = 1.2;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az) || 1;
      const px = -(bz - az) / len, pz = (bx - ax) / len, n = Math.max(3, Math.round(len / 0.7));
      let lx = ax, lz = az;
      for (let s = 1; s <= n; s++) {
        const t = s / n, j = s === n ? 0 : (Math.random() - 0.5) * 0.9;
        const nx = ax + (bx - ax) * t + px * j, nz = az + (bz - az) * t + pz * j;
        pos.push(lx - px * w, y, lz - pz * w, lx + px * w, y, lz + pz * w, nx + px * w, y, nz + pz * w,
          lx - px * w, y, lz - pz * w, nx + px * w, y, nz + pz * w, nx - px * w, y, nz - pz * w);
        lx = nx; lz = nz;
      }
      const m = Math.max(col.r, col.g, col.b);
      this.flash(bx, 1.5, bz, col.r / m, col.g / m, col.b / m, 40, 7, 0.2);
    }
    this.ribbon(pos, col, 0.22);
  }

  // Vertical lightning strike from the sky to (x, z).
  bolt(x, z, col) {
    const pos = [], w = 0.2;
    let bx = x + (Math.random() - 0.5) * 2, bz = z;
    for (let y = 22; y > 0; y -= 2) {
      const ny = Math.max(0, y - 2), nx = ny === 0 ? x : bx + (Math.random() - 0.5) * 1.4, nz = ny === 0 ? z : bz + (Math.random() - 0.5) * 0.6;
      pos.push(bx - w, y, bz, bx + w, y, bz, nx + w, ny, nz, bx - w, y, bz, nx + w, ny, nz, nx - w, ny, nz);
      bx = nx; bz = nz;
    }
    this.ribbon(pos, col, 0.28);
  }

  ribbon(pos, col, life) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.root.add(mesh);
    (this.ribbons ||= []).push({ mesh, life, max: life });
  }

  flash(x, y, z, r, g, b, intensity, range, life) {
    this.flashes.push({ x, y, z, r, g, b, intensity, range, life, max: life });
  }

  sparkBurst(x, y, z, col, n = 10, speed = 6, life = 0.35, size = 0.16) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      const s = speed * rnd(0.4, 1);
      this.sparks.spawn(particle(x, y, z,
        Math.cos(a) * s * (1 - u * 0.5), rnd(0.2, 1) * s, Math.sin(a) * s * (1 - u * 0.5),
        life * rnd(0.6, 1.2), size * rnd(0.6, 1.3), col.r, col.g, col.b,
        { grav: 14, drag: 2, spin: rnd(-10, 10) }));
    }
  }

  muzzle(x, y, z, dx, dz, col) {
    for (let k = 0; k < 5; k++) {
      const s = rnd(4, 9);
      this.sparks.spawn(particle(x, y, z, dx * s + rnd(-1.5, 1.5), rnd(-0.5, 1.5), dz * s + rnd(-1.5, 1.5),
        0.12, rnd(0.12, 0.22), col.r, col.g, col.b, { drag: 8 }));
    }
    const m = Math.max(col.r, col.g, col.b);
    this.flash(x, y, z, col.r / m, col.g / m, col.b / m, 16, 7, 0.09);
  }

  hit(x, y, z, col) {
    this.sparkBurst(x, y, z, col, 8, 5, 0.3, 0.14);
    const m = Math.max(col.r, col.g, col.b);
    this.flash(x, y, z, col.r / m, col.g / m, col.b / m, 10, 5, 0.12);
  }

  dust(x, z, n = 6, color = 0xd8bf94, spread = 1) {
    _c.set(color);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(1, 3) * spread;
      this.smoke.spawn(particle(x + Math.cos(a) * 0.4, rnd(0.2, 0.8), z + Math.sin(a) * 0.4,
        Math.cos(a) * s, rnd(0.5, 1.5), Math.sin(a) * s, rnd(0.6, 1.1), rnd(0.5, 0.9),
        _c.r, _c.g, _c.b, { drag: 2.5, grow: 1.2, shrink: 0.5 }));
    }
  }

  debrisBurst(x, y, z, color, n = 12, size = 0.35, power = 7) {
    _c.copy(color);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(0.3, 1) * power;
      const shade = rnd(0.7, 1.15);
      this.debris.spawn(particle(x + rnd(-0.6, 0.6), y + rnd(0, 1.5), z + rnd(-0.6, 0.6),
        Math.cos(a) * s, rnd(3, 9), Math.sin(a) * s, rnd(1.6, 2.6), size * rnd(0.5, 1.2),
        _c.r * shade, _c.g * shade, _c.b * shade,
        { grav: 22, spin: rnd(-12, 12), bounce: true, shrink: 0.35 }));
    }
  }

  ring(x, z, radius, col, life = 0.45) {
    let r = this.rings.find(o => o.life <= 0);
    if (!r) {
      const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.root.add(mesh);
      r = { mesh, life: 0 };
      this.rings.push(r);
    }
    r.mesh.visible = true;
    r.mesh.position.set(x, 0.08, z);
    r.mesh.material.color.copy(col);
    r.radius = radius; r.life = life; r.max = life;
  }

  scorch(x, z, radius) {
    let s = this.scorches.length >= 24 ? this.scorches.shift() : null;
    if (!s) {
      const mesh = new THREE.Mesh(this.scorchGeo, new THREE.MeshBasicMaterial({
        map: this.scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      }));
      this.root.add(mesh);
      s = { mesh };
    }
    s.mesh.position.set(x, 0.025 + this.scorches.length * 0.0004, z);
    s.mesh.rotation.y = Math.random() * 6.28;
    s.mesh.scale.setScalar(radius * 2.2);
    s.life = 9; s.max = 9;
    this.scorches.push(s);
  }

  // Water splash: droplets arcing out and falling back, plus a burst of white spray.
  splash(x, z, size = 1) {
    for (let k = 0; k < Math.round(16 * size); k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(1, 4.5) * size;
      this.smoke.spawn(particle(x + Math.cos(a) * 0.3, 0, z + Math.sin(a) * 0.3, Math.cos(a) * s, rnd(4, 9) * Math.sqrt(size), Math.sin(a) * s,
        rnd(0.5, 0.8), rnd(0.14, 0.28) * size, 0.82, 0.93, 1.0, { grav: 20, shrink: 0.5 }));
    }
    for (let k = 0; k < Math.round(6 * size); k++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(particle(x, 0.1, z, Math.cos(a) * 1.5, rnd(1, 2.5), Math.sin(a) * 1.5,
        rnd(0.4, 0.7), rnd(0.5, 0.9) * size, 0.9, 0.96, 1.0, { drag: 3, grow: 1.4, shrink: 0.6 }));
    }
  }

  explosion(x, z, radius, big = false, onWater = false) {
    const y = 0.6;
    for (let k = 0; k < (big ? 26 : 16); k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(2, 7) * radius * 0.35;
      const hot = Math.random();
      this.fire.spawn(particle(x, y + rnd(0, 0.6), z, Math.cos(a) * s, rnd(1, 5), Math.sin(a) * s,
        rnd(0.25, 0.5), rnd(0.8, 1.5) * radius * 0.45,
        3.2 + hot * 2, 1.1 + hot * 1.6, 0.25 + hot * 0.4,
        { drag: 5, grow: 1.0, shrink: 0.7, fade: true }));
    }
    for (let k = 0; k < (big ? 22 : 12); k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(1, 4) * radius * 0.3;
      const g = rnd(0.42, 0.6);
      this.smoke.spawn(particle(x, y + rnd(0, 1), z, Math.cos(a) * s, rnd(1.5, 3.5), Math.sin(a) * s,
        rnd(0.9, 1.6), rnd(0.8, 1.3) * radius * 0.4, g, g * 0.95, g * 0.9,
        { drag: 2.2, grow: 1.6, shrink: 0.5 }));
    }
    this.sparkBurst(x, y, z, _c.setRGB(5, 2.6, 0.8), big ? 40 : 24, 11 * radius * 0.4, 0.6, 0.15);
    this.flash(x, 1.6, z, 1.0, 0.62, 0.3, big ? 260 : 150, radius * 5.5, big ? 0.55 : 0.4);
    this.ring(x, z, radius * 1.15, _c.setRGB(2.4, 1.3, 0.5), 0.4);
    if (onWater) this.splash(x, z, big ? 1.8 : 1.3);
    else this.scorch(x, z, radius);
  }

  poof(x, z, color) {
    _c.set(color);
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(1.5, 4);
      this.smoke.spawn(particle(x, rnd(0.3, 1.8), z, Math.cos(a) * s, rnd(0.5, 3), Math.sin(a) * s,
        rnd(0.7, 1.2), rnd(0.6, 1), 0.85, 0.85, 0.9, { drag: 3, grow: 1.4, shrink: 0.5 }));
    }
    this.debrisBurst(x, 0.8, z, _c, 10, 0.3, 5);
    this.sparkBurst(x, 1, z, new THREE.Color(4, 4, 4), 14, 7, 0.45);
    this.flash(x, 1.5, z, 1, 1, 1, 40, 8, 0.25);
  }

  update(dt) {
    this.sparks.update(dt);
    this.debris.update(dt);
    this.smoke.update(dt);
    this.fire.update(dt);
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter(f => f.life > 0);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const a = Math.max(r.life / r.max, 0);
      r.mesh.scale.setScalar(r.radius * (0.25 + (1 - a * a) * 0.95));
      r.mesh.material.opacity = a;
      if (r.life <= 0) r.mesh.visible = false;
    }
    if (this.ribbons) {
      for (const r of this.ribbons) {
        r.life -= dt;
        // flicker while fading
        r.mesh.material.opacity = Math.max(0, r.life / r.max) * (0.6 + 0.4 * Math.random());
        if (r.life <= 0) { this.root.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
      }
      this.ribbons = this.ribbons.filter(r => r.life > 0);
    }
    for (const s of this.scorches) {
      s.life -= dt;
      s.mesh.material.opacity = Math.min(1, Math.max(s.life, 0) / 3);
    }
  }

  emit(pool) {
    for (const f of this.flashes) {
      const a = f.life / f.max;
      pool.add(f.x, f.y, f.z, f.r, f.g, f.b, f.intensity * a * a, f.range);
    }
  }

  clear() {
    for (const l of [this.sparks, this.debris, this.smoke, this.fire]) { l.items.length = 0; l.mesh.count = 0; }
    this.flashes.length = 0;
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    for (const s of this.scorches) this.root.remove(s.mesh);
    this.scorches.length = 0;
  }
}
