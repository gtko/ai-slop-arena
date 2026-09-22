import * as THREE from 'three';
import { radialTexture, shared, mulberry } from './materials.js';
import { sfx, setWeatherBed } from './audio.js';

// Weather = particles that follow the camera + a modifier that bends the time-of-day
// lighting (sun, sky, fog, shadow softness, exposure) every frame. One instance per match.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);
const BOX_X = 24, BOX_Z = 20, BOX_Y = 14; // particle volume around the camera focus (half extents / height)
const wrap = (v, h) => ((((v + h) % (2 * h)) + 2 * h) % (2 * h)) - h;

const BEDS = { rain: 'amb_rain', sandstorm: 'amb_storm', snow: 'amb_snow', fog: 'amb_marsh' };
const WIND = { clear: 1, rain: 1.8, snow: 1.3, sandstorm: 3.2, fog: 0.7 };

// Blend a lighting colour toward a weather tint. Sky and fog tints are dimmed at night so a
// foggy or rainy night stays dark instead of turning into a grey wash.
function mix(S, key, r, g, b, t) {
  const k = key === 'fog' || key === 'sky' ? 1 - 0.85 * S.night : 1;
  S[key].lerp(_c.setRGB(r * k, g * k, b * k), t);
}

/* A cloud of instanced particles living in a box that follows the focus. */
class Field {
  constructor(parent, geo, mat, count, init) {
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.n = count;
    this.p = new Float32Array(count * 3);   // position relative to focus
    this.v = new Float32Array(count * 4);   // per-particle params
    for (let i = 0; i < count; i++) init(i, this.p, this.v);
  }
}

export class Weather {
  constructor(game, kind) {
    this.g = game;
    this.kind = kind;
    this.t = 0;
    this.group = new THREE.Group();
    game.fx.add(this.group);
    this.flash = 0;
    this.gust = 0;
    this.overlay = document.getElementById('flash');
    shared.wind.value = WIND[kind] ?? 1;
    setWeatherBed(BEDS[kind] || null);
    if (kind === 'rain') this.buildRain();
    if (kind === 'snow') this.buildSnow();
    if (kind === 'sandstorm') this.buildStorm();
    if (kind === 'fog') this.buildFog();
  }

  /* ------------------------------ builders ------------------------------ */

  buildRain() {
    const geo = new THREE.BoxGeometry(0.022, 0.75, 0.022);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.72, 0.95), transparent: true, opacity: 0.45, depthWrite: false });
    this.drops = new Field(this.group, geo, mat, 1700, (i, p, v) => {
      p[i * 3] = rnd(-BOX_X, BOX_X); p[i * 3 + 1] = rnd(0, BOX_Y); p[i * 3 + 2] = rnd(-BOX_Z, BOX_Z);
      v[i * 4] = rnd(22, 28);
    });
    this.tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.16);
    // ground splashes: tiny expanding rings
    const ring = new THREE.RingGeometry(0.6, 1, 12); ring.rotateX(-Math.PI / 2);
    this.splashes = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.8, 0.88, 1), transparent: true, opacity: 0.5, depthWrite: false,
    }), 160);
    this.splashes.frustumCulled = false;
    this.splashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashList = [];
    this.group.add(this.splashes);
    this.nextBolt = rnd(4, 9);
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 7), transparent: true, depthWrite: false });
  }

  buildSnow() {
    const geo = new THREE.OctahedronGeometry(0.075, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.3, 1.4), transparent: true, opacity: 0.9, depthWrite: false });
    this.flakes = new Field(this.group, geo, mat, 1900, (i, p, v) => {
      p[i * 3] = rnd(-BOX_X, BOX_X); p[i * 3 + 1] = rnd(0, BOX_Y); p[i * 3 + 2] = rnd(-BOX_Z, BOX_Z);
      v[i * 4] = rnd(1.2, 2.2); v[i * 4 + 1] = rnd(0, 6.28); v[i * 4 + 2] = rnd(0.6, 1.4);
    });
  }

  buildStorm() {
    const geo = new THREE.BoxGeometry(0.7, 0.02, 0.02);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.85, 0.5), transparent: true, opacity: 0.5, depthWrite: false });
    this.grains = new Field(this.group, geo, mat, 1500, (i, p, v) => {
      p[i * 3] = rnd(-BOX_X, BOX_X); p[i * 3 + 1] = rnd(0.1, 5); p[i * 3 + 2] = rnd(-BOX_Z, BOX_Z);
      v[i * 4] = rnd(18, 32); v[i * 4 + 1] = rnd(-2, 2); v[i * 4 + 2] = rnd(0, 6.28);
    });
    // billowing dust clouds: big soft sprites drifting with the wind
    const tex = radialTexture('rgba(235,160,95,0.55)', 'rgba(235,160,95,0)', 128, 40);
    this.clouds = [];
    for (let k = 0; k < 42; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: rnd(0.25, 0.5) }));
      sp.userData = { x: rnd(-BOX_X, BOX_X), y: rnd(0.8, 4.5), z: rnd(-BOX_Z, BOX_Z), v: rnd(5, 10), s: rnd(7, 14), o: sp.material.opacity };
      sp.scale.setScalar(sp.userData.s);
      this.group.add(sp);
      this.clouds.push(sp);
    }
  }

  buildFog() {
    // low mist sheets with a tileable noise alpha, scrolling at different speeds
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d'), r = mulberry(21);
    for (let k = 0; k < 90; k++) {
      const px = r() * S, py = r() * S, rad = 20 + r() * 60, a = 0.05 + r() * 0.12;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(px + ox - rad, py + oy - rad, rad * 2, rad * 2);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.mist = [0.3, 0.8, 1.35].map((y, k) => {
      const t = tex.clone(); t.repeat.set(3 + k, 3 + k);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(80, 70).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: t, color: 0xffffff, transparent: true, opacity: [0.38, 0.26, 0.17][k], depthWrite: false }));
      m.position.y = y;
      m.renderOrder = 3;
      this.group.add(m);
      return { m, t, sx: (k % 2 ? -1 : 1) * (0.006 + k * 0.004), sz: 0.004 + k * 0.002 };
    });
    // fireflies wander around bushes and water, blinking; the brightest borrow pool lights
    const A = this.g.arena, spots = [];
    for (let j = 1; j < 24; j++) for (let i = 1; i < 24; i++) {
      const ch = A.get(i, j);
      if (ch === 'B' || ch === 'W' || (ch === '.' && Math.random() < 0.08)) spots.push(A.center(i, j));
    }
    this.flies = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff }), 80);
    this.flies.frustumCulled = false;
    this.flies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fly = [];
    for (let k = 0; k < 80; k++) {
      const s = spots[Math.floor(Math.random() * spots.length)] || new THREE.Vector3();
      this.fly.push({ x: s.x + rnd(-1, 1), z: s.z + rnd(-1, 1), y: rnd(0.5, 2.4), ph: rnd(0, 20), sp: rnd(0.6, 1.4), b: 0 });
      this.flies.setColorAt(k, _c.setRGB(2.4, 3.6, 0.8));
    }
    this.group.add(this.flies);
  }

  // Graphics option: fraction of particles drawn (fields are sized for the maximum).
  setDensity(k) {
    this.density = k;
    for (const F of [this.drops, this.flakes, this.grains]) if (F) F.mesh.count = Math.max(1, Math.floor(F.n * k));
    if (this.clouds) this.clouds.forEach((c, i) => { c.visible = i < this.clouds.length * k; });
    if (this.mist) this.mist.forEach((L, i) => { L.m.visible = i === 0 || k > 0.5; });
  }

  /* ------------------------------ lighting ------------------------------ */

  modify(S) {
    const f = this.flash;
    switch (this.kind) {
      case 'rain':
        S.sunI *= 0.32; S.shadowI *= 0.55; S.hemiI *= 0.95 + f * 5;
        mix(S, 'sun', 0.7, 0.75, 0.85, 0.5); mix(S, 'sky', 0.45, 0.5, 0.6, 0.6); mix(S, 'fog', 0.3, 0.34, 0.42, 0.75);
        S.fogNear = 26; S.fogFar = 62; S.exposure *= 1.05 + f * 0.8; S.bloom += 0.1;
        break;
      case 'snow':
        S.sunI *= 0.75; S.shadowI *= 0.8; S.hemiI *= 1.2;
        mix(S, 'sun', 0.85, 0.92, 1, 0.5); mix(S, 'sky', 0.85, 0.9, 1, 0.5); mix(S, 'fog', 0.8, 0.86, 0.95, 0.7);
        S.fogNear = 26; S.fogFar = 72;
        break;
      case 'sandstorm': {
        const g = this.gust;
        S.sunI *= 0.55 - g * 0.15; S.shadowI *= 0.55 - g * 0.2; S.hemiI *= 1.25;
        mix(S, 'sun', 1, 0.62, 0.32, 0.6); mix(S, 'sky', 0.95, 0.6, 0.32, 0.65); mix(S, 'ground', 0.6, 0.3, 0.12, 0.5);
        mix(S, 'fog', 0.78, 0.46, 0.22, 0.85);
        S.fogNear = 21 - g * 6; S.fogFar = 50 - g * 14; S.bloom *= 0.8;
        break;
      }
      case 'fog':
        S.sunI *= 0.5; S.shadowI *= 0.6; S.hemiI *= 0.9;
        mix(S, 'sky', 0.55, 0.62, 0.6, 0.6); mix(S, 'fog', 0.5, 0.57, 0.54, 0.85);
        // the vision fog wall (visionfog.js) does the heavy lifting; keep the distance fog light
        S.fogNear = 30; S.fogFar = 75;
        break;
    }
  }

  /* ------------------------------ per frame ------------------------------ */

  update(dt, focus, camera, night) {
    this.t += dt;
    const t = this.t;
    if (this.kind === 'rain') this.updateRain(dt, focus);
    if (this.kind === 'snow') this.updateSnow(dt, focus);
    if (this.kind === 'sandstorm') this.updateStorm(dt, focus);
    if (this.kind === 'fog') this.updateFog(dt, focus, night);
    if (this.overlay) this.overlay.style.opacity = (this.flash * 0.55).toFixed(3);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    if (this.boltMesh) {
      this.boltLife -= dt;
      this.boltMat.opacity = Math.max(0, this.boltLife / 0.25);
      if (this.boltLife <= 0) { this.group.remove(this.boltMesh); this.boltMesh.geometry.dispose(); this.boltMesh = null; }
    }
    void t;
  }

  updateRain(dt, focus) {
    const F = this.drops, p = F.p, v = F.v;
    for (let i = 0; i < F.n; i++) {
      p[i * 3 + 1] -= v[i * 4] * dt;
      p[i * 3] += 4 * dt;
      if (p[i * 3 + 1] < 0) {
        if (i % 3 === 0 && this.splashList.length < 160) {
          this.splashList.push({ x: focus.x + wrap(p[i * 3], BOX_X), z: focus.z + wrap(p[i * 3 + 2], BOX_Z), life: 0.28 });
        }
        p[i * 3 + 1] += BOX_Y; p[i * 3] = rnd(-BOX_X, BOX_X); p[i * 3 + 2] = rnd(-BOX_Z, BOX_Z);
      }
      _p.set(focus.x + wrap(p[i * 3], BOX_X), p[i * 3 + 1], focus.z + wrap(p[i * 3 + 2], BOX_Z));
      F.mesh.setMatrixAt(i, _m.compose(_p, this.tilt, _s.set(1, 1, 1)));
    }
    F.mesh.instanceMatrix.needsUpdate = true;
    let n = 0;
    for (const s of this.splashList) {
      s.life -= dt;
      if (s.life <= 0) continue;
      const k = 1 - s.life / 0.28;
      this.splashes.setMatrixAt(n, _m.compose(_p.set(s.x, 0.04, s.z), _q.identity(), _s.setScalar(0.05 + k * 0.3)));
      this.splashList[n++] = s;
    }
    this.splashList.length = n;
    this.splashes.count = n;
    this.splashes.instanceMatrix.needsUpdate = true;
    // lightning
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) this.bolt(focus);
  }

  bolt(focus) {
    this.nextBolt = rnd(7, 16);
    this.flash = 1;
    setTimeout(() => { this.flash = Math.max(this.flash, 0.7); }, 110); // double flicker
    const x = focus.x + rnd(-14, 14), z = focus.z - rnd(4, 16);
    this.boltAt = new THREE.Vector3(x, 12, z);
    // jagged ribbon from the clouds to the ground
    const pts = [];
    let bx = x, bz = z;
    for (let y = 26; y >= 0; y -= 2.2) { pts.push([bx, y, bz]); bx += rnd(-1.2, 1.2); bz += rnd(-0.6, 0.6); }
    const pos = [], w = 0.18;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay, az] = pts[k], [cx, cy, cz] = pts[k + 1];
      pos.push(ax - w, ay, az, ax + w, ay, az, cx + w, cy, cz, ax - w, ay, az, cx + w, cy, cz, cx - w, cy, cz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (this.boltMesh) { this.group.remove(this.boltMesh); this.boltMesh.geometry.dispose(); }
    this.boltMesh = new THREE.Mesh(g, this.boltMat);
    this.boltMat.side = THREE.DoubleSide;
    this.boltLife = 0.25;
    this.group.add(this.boltMesh);
    const d = Math.hypot(x - focus.x, z - focus.z);
    setTimeout(() => sfx(Math.random() < 0.5 ? 'thunder' : 'thunder2', 1), 250 + d * 60);
    this.g.shake = Math.min(1, this.g.shake + 0.15);
  }

  updateSnow(dt, focus) {
    const F = this.flakes, p = F.p, v = F.v, t = this.t;
    for (let i = 0; i < F.n; i++) {
      p[i * 3 + 1] -= v[i * 4] * dt;
      const w = Math.sin(t * v[i * 4 + 2] + v[i * 4 + 1]);
      p[i * 3] += (0.9 + w * 0.8) * dt;
      p[i * 3 + 2] += Math.cos(t * 0.7 + v[i * 4 + 1]) * 0.4 * dt;
      if (p[i * 3 + 1] < 0) p[i * 3 + 1] += BOX_Y;
      _p.set(focus.x + wrap(p[i * 3], BOX_X), p[i * 3 + 1], focus.z + wrap(p[i * 3 + 2], BOX_Z));
      _q.setFromAxisAngle(_s.set(0.3, 1, 0.2).normalize(), t * 2 + v[i * 4 + 1]);
      F.mesh.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(0.7 + 0.3 * v[i * 4 + 2])));
    }
    F.mesh.instanceMatrix.needsUpdate = true;
  }

  updateStorm(dt, focus) {
    const t = this.t;
    this.gust = THREE.MathUtils.clamp(0.5 + 0.5 * Math.sin(t * 0.33) * Math.sin(t * 0.13 + 1.3), 0, 1);
    const F = this.grains, p = F.p, v = F.v, speed = 0.7 + this.gust * 0.8;
    for (let i = 0; i < F.n; i++) {
      p[i * 3] += v[i * 4] * speed * dt;
      p[i * 3 + 2] += v[i * 4 + 1] * dt;
      p[i * 3 + 1] += Math.sin(t * 3 + v[i * 4 + 2]) * 0.5 * dt;
      _p.set(focus.x + wrap(p[i * 3], BOX_X), p[i * 3 + 1], focus.z + wrap(p[i * 3 + 2], BOX_Z));
      F.mesh.setMatrixAt(i, _m.compose(_p, _q.identity(), _s.set(0.6 + v[i * 4] / 40, 1, 1)));
    }
    F.mesh.instanceMatrix.needsUpdate = true;
    for (const sp of this.clouds) {
      const u = sp.userData;
      u.x += u.v * speed * dt;
      sp.position.set(focus.x + wrap(u.x, BOX_X + 6), u.y + Math.sin(t * 0.5 + u.s) * 0.3, focus.z + wrap(u.z, BOX_Z + 4));
      sp.material.opacity = u.o * (0.55 + this.gust * 0.7);
      sp.material.rotation += dt * 0.1;
    }
  }

  updateFog(dt, focus, night) {
    for (const L of this.mist) {
      L.m.position.x = focus.x; L.m.position.z = focus.z - 4;
      L.t.offset.x += L.sx * dt * 6; L.t.offset.y += L.sz * dt * 6;
      // unlit sheets: tint them with the current fog colour so they darken at night
      L.m.material.color.copy(this.g.scene.fog.color).multiplyScalar(1.25);
    }
    const t = this.t, glow = 0.35 + 0.65 * night;
    for (let k = 0; k < this.fly.length; k++) {
      const f = this.fly[k];
      const x = f.x + Math.sin(t * 0.4 * f.sp + f.ph) * 1.2, z = f.z + Math.cos(t * 0.33 * f.sp + f.ph * 1.3) * 1.2;
      const y = f.y + Math.sin(t * 0.9 * f.sp + f.ph) * 0.4;
      f.b = Math.pow(Math.max(0, Math.sin(t * 1.3 * f.sp + f.ph)), 3) * glow;
      f.px = x; f.py = y; f.pz = z;
      this.flies.setMatrixAt(k, _m.compose(_p.set(x, y, z), _q.identity(), _s.setScalar(0.3 + f.b * 0.9)));
    }
    this.flies.instanceMatrix.needsUpdate = true;
  }

  emit(pool, focus) {
    if (this.flash > 0.02 && this.boltAt) pool.add(this.boltAt.x, this.boltAt.y, this.boltAt.z, 0.8, 0.85, 1, 900 * this.flash, 70);
    if (this.fly) {
      // hand the brightest fireflies near the camera a few pool lights
      const near = this.fly.filter(f => f.b > 0.2 && Math.hypot(f.px - focus.x, f.pz - focus.z) < 16)
        .sort((a, b) => b.b - a.b).slice(0, 6);
      for (const f of near) pool.add(f.px, f.py, f.pz, 0.7, 1, 0.3, 3.2 * f.b, 4);
    }
  }

  dispose() {
    this.g.fx.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    if (this.overlay) this.overlay.style.opacity = '0';
    shared.wind.value = 1;
  }
}
