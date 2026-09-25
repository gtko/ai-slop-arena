import * as THREE from 'three';
import { TILE } from './arena.js';
import { sfx } from './audio.js';
import { particle } from './effects.js';
import { t } from './i18n/index.js';
import { hasStar } from './gadgets.js';

// HDR colours (> 1) so projectiles bloom; the light colour is the normalised hue.
const COL = {
  player: new THREE.Color(0.45, 2.6, 4.2),
  enemy: new THREE.Color(4.2, 0.9, 0.35),
  enemyCb: new THREE.Color(4.2, 2.2, 0.1), // colour-blind option: orange instead of red
  super: new THREE.Color(4.2, 3.1, 0.6),
  ice: new THREE.Color(1.6, 3.4, 4.6),
  volt: new THREE.Color(1.2, 4.2, 4.6),
  seed: new THREE.Color(0.75, 1.9, 0.3), // Blaster: thorny seeds (dimmer: the thorns must read through the bloom)
  ray: new THREE.Color(2.6, 1.5, 4.8), // Gunslinger: ray pistol bolts
};
const ICE_LIGHT = new THREE.Color(0.55, 0.85, 1), BOLT = new THREE.Color(3.2, 4.2, 5.2);
const WALL_SPARK = new THREE.Color(2.5, 2.0, 1.4);
const BULLET_Y = 1.15;

const rnd = (a, b) => a + Math.random() * (b - a);

// Blaster seed: an icosphere whose 12 original corners are pulled out into thorns.
function seedGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3();
  const base = new THREE.IcosahedronGeometry(1, 0).attributes.position, corners = [];
  for (let i = 0; i < base.count; i++) corners.push(new THREE.Vector3().fromBufferAttribute(base, i));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (corners.some(c => c.distanceToSquared(v) < 1e-4)) p.setXYZ(i, v.x * 1.8, v.y * 1.8, v.z * 1.8);
  }
  g.computeVertexNormals();
  return g;
}

// Bomber fireball / meteor: a lumpy faceted rock (the bump is hashed from the position, so the
// duplicated vertices along face seams move together).
function rockGeometry(r, detail, bump) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
    v.multiplyScalar(1 + (h - Math.floor(h) - 0.5) * bump);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Camera kick when you fire (trauma, feel.js); Gunslinger adds 0.03 per bolt of its burst.
const FIRE_KICK = { blaster: 0.14, blasterS: 0.4, gunslinger: 0, gunslingerS: 0, bomber: 0.06, bomberS: 0.1, frostbite: 0.06, frostbiteS: 0.35, volt: 0.07, voltS: 0.1 };

export class Combat {
  constructor(game) {
    this.g = game;
    this.bullets = [];
    this.bombs = [];
    this.strikes = []; // Volt super: scheduled lightning strikes
    this.zones = [];   // ground hazards: lava puddles, zap traps (gadgets, star powers)
    this.windups = []; // area supers announce themselves on the ground before they hit
    this.free = new Map(); // geometry -> spare bullet meshes
    this.bulletGeo = new THREE.SphereGeometry(1, 12, 8);
    this.seedGeo = seedGeometry();
    this.bulletMats = new Map();
    // Bomber: molten rock core (emissive enough to bloom) inside an additive flame shell
    this.fireballGeo = rockGeometry(0.3, 1, 0.3);
    this.meteorGeo = rockGeometry(0.62, 1, 0.35);
    this.flameGeo = new THREE.IcosahedronGeometry(1, 2);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.85, emissive: 0xff5a14, emissiveIntensity: 0.8, flatShading: true });
    this.flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 0.12), transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false });
  }

  fireball(sup) {
    const g = new THREE.Group(), core = new THREE.Mesh(sup ? this.meteorGeo : this.fireballGeo, this.rockMat);
    const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
    core.castShadow = true;
    flame.scale.setScalar(sup ? 0.78 : 0.4);
    g.add(core, flame);
    g.userData.flame = flame;
    return g;
  }

  get enemyCol() { return this.g.colorblind ? COL.enemyCb : COL.enemy; }

  colorFor(b, sup) {
    if (b.type.key === 'blaster' && !sup) return b.isPlayer ? COL.seed : this.enemyCol;
    if (b.type.key === 'gunslinger' && !sup) return b.isPlayer ? COL.ray : this.enemyCol;
    if (b.type.key === 'frostbite' && !sup) return b.isPlayer ? COL.ice : this.enemyCol;
    if (b.type.key === 'volt' && !sup) return b.isPlayer ? COL.volt : this.enemyCol;
    return sup ? COL.super : (b.isPlayer ? COL.player : this.enemyCol);
  }

  meshFor(col, geo) {
    const key = col.getHexString();
    let mat = this.bulletMats.get(key);
    if (!mat) { mat = new THREE.MeshBasicMaterial({ color: col }); this.bulletMats.set(key, mat); }
    let m = this.free.get(geo)?.pop();
    if (!m) {
      m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      this.g.fx.add(m);
    }
    m.material = mat;
    m.visible = true;
    return m;
  }

  release(m) {
    m.visible = false;
    if (!this.free.has(m.geometry)) this.free.set(m.geometry, []);
    this.free.get(m.geometry).push(m);
  }

  attack(b, dx, dz, point, sup) {
    const T = b.type.key, base = Math.atan2(dx, dz), col = this.colorFor(b, sup);
    const mx = b.pos.x + dx * 0.9, mz = b.pos.z + dz * 0.9;
    // what you cannot see you do not hear either (the bullets still fly)
    const vol = this.g.fxVisible(b) ? this.g.volumeAt(b.pos.x, b.pos.z) : 0;
    if (b === this.g.player) this.g.feel.add(FIRE_KICK[T + (sup ? 'S' : '')] ?? 0.05);
    if (sup) { sfx('super', vol); sfx(`bark_${T}_super`, vol * 0.9); }
    if (T === 'blaster') {
      const n = sup ? 9 : 5, spread = sup ? 0.72 : 0.52;
      for (let k = 0; k < n; k++) {
        const a = base + (k / (n - 1) - 0.5) * spread + rnd(-0.03, 0.03);
        this.spawnBullet(b, mx, mz, a, {
          speed: rnd(24, 27), range: sup ? 11 : 9.5, dmg: sup ? 300 : 260, r: sup ? 0.25 : 0.2,
          breakWalls: sup, knock: sup ? 11 : 0, emit: k % 2 === 0, col, shape: 'seed',
        });
      }
      this.g.effects.muzzle(mx, BULLET_Y, mz, dx, dz, col);
      sfx('shotgun', vol);
      if (sup) this.g.shakeAt(b.pos.x, b.pos.z, 0.35);
    } else if (T === 'gunslinger') {
      const n = sup ? 12 : 6;
      for (let k = 0; k < n; k++) b.burst.push({ t: k * (sup ? 0.055 : 0.075), a: base, sup });
    } else if (T === 'frostbite') {
      if (sup) { this.windup(b, 0.2, hasStar(b, 'permafrost') ? 6.25 : 5, COL.ice, () => this.nova(b)); return; } // telegraphed
      for (let k = -1; k <= 1; k++) {
        this.spawnBullet(b, mx, mz, base + k * 0.11, {
          speed: 21, range: 12, dmg: 300, r: 0.21, breakWalls: false, knock: 0, emit: k === 0, col, slow: 1.5,
        });
      }
      this.g.effects.muzzle(mx, BULLET_Y, mz, dx, dz, col);
      sfx('shot_ice', vol);
    } else if (T === 'volt') {
      if (sup) { this.storm(b, point); return; }
      this.spawnBullet(b, mx, mz, base, { speed: 26, range: 13, dmg: 650, r: 0.3, breakWalls: false, knock: 0, emit: true, col, chain: hasStar(b, 'conductor') ? 3 : 2 });
      this.g.effects.muzzle(mx, BULLET_Y, mz, dx, dz, col);
      sfx('shot_zap', vol);
    } else {
      let tx = point.x - b.pos.x, tz = point.z - b.pos.z;
      let d = Math.hypot(tx, tz);
      const R = b.type.range;
      if (d < 1e-3) { tx = dx; tz = dz; d = 1; }
      const cd = THREE.MathUtils.clamp(d, 2, R);
      tx = b.pos.x + tx / d * cd; tz = b.pos.z + tz / d * cd;
      const mesh = this.fireball(sup);
      this.g.fx.add(mesh);
      // the super is a meteor: same target and timing, but it dives from the sky behind the target
      const ux = (tx - b.pos.x) / cd, uz = (tz - b.pos.z) / cd;
      this.bombs.push({
        sx: sup ? tx - ux * 4 : mx, sz: sup ? tz - uz * 4 : mz, sy: sup ? 12 : 1.6,
        tx, tz, t: 0, dur: (0.5 + (cd / R) * 0.35) * (!sup && b.fuseNext ? 0.6 : 1), h: 2.6 + cd * 0.22,
        dmg: sup ? 1800 : hasStar(b, 'bigBang') ? 720 : 800, radius: sup ? 3.6 : hasStar(b, 'bigBang') ? 2.4 : 2.0, owner: b, sup, mesh, spin: rnd(6, 12),
        fx: mx, fy: 1.6, fz: mz,
      });
      sfx('throw', vol);
      if (!sup) b.fuseNext = false;
    }
  }

  spawnBullet(owner, x, z, a, o) {
    const m = this.meshFor(o.col, o.shape === 'seed' ? this.seedGeo : this.bulletGeo);
    if (o.shape === 'seed') m.scale.setScalar(o.r * 1.15);
    else if (o.shape === 'ray') m.scale.set(o.r * 0.9, o.r * 0.9, o.r * 5);
    else m.scale.set(o.r, o.r, o.r * 2.6);
    m.rotation.set(0, a, 0);
    m.position.set(x, BULLET_Y, z);
    const mx = Math.max(o.col.r, o.col.g, o.col.b);
    this.bullets.push({
      ...o, x, z, dx: Math.sin(a), dz: Math.cos(a), travel: 0, owner, mesh: m,
      lr: o.col.r / mx, lg: o.col.g / mx, lb: o.col.b / mx,
    });
  }

  update(dt) {
    const g = this.g;
    // Gunslinger bursts
    for (const b of g.brawlers) {
      if (!b.burst.length) continue;
      if (!b.alive) { b.burst.length = 0; continue; }
      for (const s of b.burst) s.t -= dt;
      while (b.burst.length && b.burst[0].t <= 0) {
        const s = b.burst.shift();
        const still = hasStar(b, 'steadyAim') && Math.hypot(b.vel.x, b.vel.z) < 0.8;
        const a = s.a + rnd(-0.035, 0.035) * (still ? 0.5 : 1);
        const dx = Math.sin(a), dz = Math.cos(a), col = this.colorFor(b, s.sup);
        const mx = b.pos.x + dx * 0.9, mz = b.pos.z + dz * 0.9;
        this.spawnBullet(b, mx, mz, a, {
          speed: 32, range: s.sup ? 20 : 16, dmg: s.sup ? 300 : 250, r: 0.17,
          breakWalls: s.sup, knock: 0, emit: true, col, shape: 'ray',
        });
        this.g.effects.muzzle(mx, BULLET_Y, mz, dx, dz, col);
        if (s.sup) b.recoil = 1; else b.attacked(); // the volley keeps the Super's arms up
        if (b === g.player) g.feel.add(0.03);
        b.aimFacing = s.a; b.aimHold = 0.3;
        sfx('shot_ray', g.fxVisible(b) ? g.volumeAt(b.pos.x, b.pos.z) : 0);
      }
    }
    this.updateBullets(dt);
    this.updateBombs(dt);
    this.updateStrikes(dt);
    this.updateZones(dt);
    this.updateWindups(dt);
  }

  updateBullets(dt) {
    const g = this.g, A = g.arena;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const B = this.bullets[i];
      let remaining = B.speed * dt, dead = false;
      while (remaining > 0 && !dead) {
        const st = Math.min(0.35, remaining);
        remaining -= st;
        B.x += B.dx * st; B.z += B.dz * st; B.travel += st;
        const ti = A.toTile(B.x), tj = A.toTile(B.z), c = A.get(ti, tj);
        if (c === 'X' || c === 'T' || c === 'G') {
          dead = true;
          this.splinter(B);
          g.effects.sparkBurst(B.x - B.dx * 0.3, BULLET_Y, B.z - B.dz * 0.3, WALL_SPARK, 5, 4, 0.25, 0.12);
        } else if (c === '#') {
          if (B.breakWalls) {
            g.breakWall(ti, tj);
            B.travel += 1.2;
          } else {
            dead = true;
            this.splinter(B);
            g.effects.sparkBurst(B.x - B.dx * 0.3, BULLET_Y, B.z - B.dz * 0.3, WALL_SPARK, 5, 4, 0.25, 0.12);
          }
        } else if (c === 'C') {
          dead = true;
          g.damageCrate(ti, tj, B.dmg * B.owner.dmgMul, B.owner);
          g.effects.hit(B.x, BULLET_Y, B.z, B.col);
        }
        if (dead) break;
        for (const o of g.brawlers) {
          if (o === B.owner || !o.alive) continue;
          const dx = o.pos.x - B.x, dz = o.pos.z - B.z, rr = o.radius + B.r;
          if (dx * dx + dz * dz < rr * rr) {
            g.damage(o, B.dmg * B.owner.dmgMul, B.owner, B.breakWalls);
            if (B.slow && g.authority && o.alive) { o.slowT = Math.max(o.slowT, B.slow); o.slowMul = hasStar(B.owner, 'deepFreeze') ? 0.45 : 0.55; }
            if (B.chain && g.authority) this.chainZap(o, B);
            if (B.knock) g.applyKnock(o, B.dx * B.knock, B.dz * B.knock);
            g.effects.hit(B.x, BULLET_Y, B.z, B.col, B.dx, B.dz);
            dead = true;
            break;
          }
        }
        if (!dead && B.travel >= B.range) {
          dead = true;
          if (A.isWaterAt(B.x, B.z)) { // spent bullet plops into the pool
            A.water.ripple(B.x, B.z, 0.55);
            g.effects.splash(B.x, B.z, 0.45);
          } else g.effects.sparkBurst(B.x, BULLET_Y, B.z, B.col, 3, 2, 0.2, 0.1);
        }
      }
      if (dead) {
        this.release(B.mesh);
        this.bullets.splice(i, 1);
      } else {
        B.mesh.position.set(B.x, BULLET_Y, B.z);
        if (B.shape === 'seed') B.mesh.rotateX(dt * 16);
      }
    }
  }

  updateBombs(dt) {
    const g = this.g;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const B = this.bombs[i];
      B.t += dt / B.dur;
      const k = Math.min(B.t, 1);
      let x, y, z;
      if (B.sup) { // meteor: straight dive, accelerating
        const e = k * k;
        x = B.sx + (B.tx - B.sx) * e; z = B.sz + (B.tz - B.sz) * e; y = B.sy + (0.35 - B.sy) * e;
      } else { // fireball: lobbed arc
        x = B.sx + (B.tx - B.sx) * k; z = B.sz + (B.tz - B.sz) * k;
        y = B.sy + (0.35 - B.sy) * k + 4 * B.h * k * (1 - k);
      }
      B.mesh.position.set(x, y, z);
      const core = B.mesh.children[0], size = B.sup ? 0.78 : 0.4;
      core.rotation.x += B.spin * dt;
      core.rotation.z += B.spin * 0.4 * dt;
      B.mesh.userData.flame.scale.setScalar(size * (1 + Math.sin(B.t * 40) * 0.08));
      B.fx = x; B.fy = y + 0.4; B.fz = z;
      if (B.sup) { // the meteor's shadow grows where it will land
        if (!B.shadow) {
          B.shadow = new THREE.Mesh(this.zoneGeo || (this.zoneGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2)),
            new THREE.MeshBasicMaterial({ color: 0x1a0a06, transparent: true, opacity: 0, depthWrite: false }));
          B.shadow.position.set(B.tx, 0.06, B.tz);
          B.shadow.renderOrder = 1;
          g.fx.add(B.shadow);
        }
        B.shadow.scale.setScalar(B.radius * (0.3 + 0.7 * k));
        B.shadow.material.opacity = 0.15 + 0.4 * k;
      }
      // flame trail and a little smoke
      for (let n = B.sup ? 3 : 1; n > 0; n--) {
        const hot = Math.random();
        g.effects.fire.spawn(particle(x + rnd(-0.3, 0.3) * size, y + rnd(-0.3, 0.3) * size, z + rnd(-0.3, 0.3) * size,
          rnd(-0.6, 0.6), rnd(0.4, 1.6), rnd(-0.6, 0.6), rnd(0.15, 0.28), rnd(0.5, 0.8) * size,
          1.6 + hot * 1.2, 0.45 + hot * 0.7, 0.08 + hot * 0.15, { drag: 3, grow: 0.3, shrink: 0.9, fade: true }));
      }
      if (Math.random() < (B.sup ? 0.5 : 0.25)) {
        g.effects.smoke.spawn(particle(x, y + 0.2, z, rnd(-0.4, 0.4), rnd(0.6, 1.4), rnd(-0.4, 0.4), rnd(0.5, 0.8), size * 0.8,
          0.3, 0.28, 0.27, { drag: 2, grow: 1.4, shrink: 0.4 }));
      }
      if (B.t >= 1) {
        this.explode(B);
        g.fx.remove(B.mesh);
        if (B.shadow) { g.fx.remove(B.shadow); B.shadow.material.dispose(); }
        this.bombs.splice(i, 1);
      }
    }
  }

  explode(B) {
    const g = this.g, A = g.arena, { tx: x, tz: z, radius: R } = B;
    for (const o of g.brawlers) {
      if (!o.alive || o === B.owner) continue;
      if (Math.hypot(o.pos.x - x, o.pos.z - z) < R + o.radius * 0.6) {
        g.damage(o, B.dmg * B.owner.dmgMul, B.owner, B.sup);
        const d = Math.hypot(o.pos.x - x, o.pos.z - z) + 0.01;
        g.applyKnock(o, (o.pos.x - x) / d * 4, (o.pos.z - z) / d * 4);
      }
    }
    const ti = A.toTile(x), tj = A.toTile(z), span = Math.ceil(R / TILE) + 1;
    const c = new THREE.Vector3();
    for (let dj = -span; dj <= span; dj++) for (let di = -span; di <= span; di++) {
      const i = ti + di, j = tj + dj, ch = A.get(i, j);
      if (ch !== 'C' && ch !== '#') continue;
      A.center(i, j, c);
      if (Math.hypot(c.x - x, c.z - z) > R + 0.9) continue;
      if (ch === 'C') g.damageCrate(i, j, B.dmg * B.owner.dmgMul, B.owner);
      else if (B.sup) g.breakWall(i, j);
    }
    const wet = A.isWaterAt(x, z);
    g.effects.explosion(x, z, R, B.sup, wet);
    if (!B.sup && !wet && hasStar(B.owner, 'magmaPuddle')) this.zone({ x, z, r: 1.5, dps: 200, t: 2, owner: B.owner, col: new THREE.Color(3.4, 1.2, 0.2) });
    if (wet) A.water.ripple(x, z, B.sup ? 1.6 : 1.2);
    g.shakeAt(x, z, B.sup ? 0.9 : 0.5);
    sfx(B.sup ? 'boom_big' : 'boom', g.volumeAt(x, z));
  }

  // Blaster star power: a seed that hits a wall bursts into 2 shards (110 each, 3 m) bouncing back.
  splinter(B) {
    if (B.shape !== 'seed' || B.shard || !hasStar(B.owner, 'splinters')) return;
    const back = Math.atan2(-B.dx, -B.dz), x = B.x - B.dx * 0.4, z = B.z - B.dz * 0.4;
    for (const s of [-0.5, 0.5]) {
      this.spawnBullet(B.owner, x, z, back + s + rnd(-0.1, 0.1), { speed: 20, range: 3, dmg: 110, r: 0.14, breakWalls: false, knock: 0,
        emit: false, col: B.col, shape: 'seed', shard: true });
    }
  }

  // A ring grows under the caster for `time` seconds (visible if you can see the caster), then fn().
  windup(b, time, r, col, fn) {
    const m = new THREE.Mesh(this.zoneGeo || (this.zoneGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.renderOrder = 1;
    m.visible = this.g.fxVisible(b);
    this.g.fx.add(m);
    this.windups.push({ b, t: time, T: time, r, mesh: m, fn });
  }

  updateWindups(dt) {
    for (let i = this.windups.length - 1; i >= 0; i--) {
      const W = this.windups[i], k = 1 - Math.max(0, W.t) / W.T;
      W.mesh.position.set(W.b.pos.x, 0.08, W.b.pos.z);
      W.mesh.scale.setScalar(W.r * (0.25 + 0.75 * k));
      W.mesh.material.opacity = 0.2 + 0.35 * k;
      if ((W.t -= dt) > 0) continue;
      this.g.fx.remove(W.mesh);
      W.mesh.material.dispose();
      this.windups.splice(i, 1);
      if (W.b.alive) W.fn();
    }
  }

  // Ground hazard: dps (every 0.25 s) or `once` (the first enemy stepping in), for t seconds.
  // broadcast: the authority tells the clients (hazards that only it creates).
  zone(o, broadcast = false) {
    const m = new THREE.Mesh(this.zoneGeo || (this.zoneGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: o.col, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.set(o.x, 0.07, o.z);
    m.scale.setScalar(o.r);
    m.renderOrder = 1;
    this.g.fx.add(m);
    this.zones.push({ ...o, T: o.t, tick: 0, delay: o.delay || 0, mesh: m });
    if (broadcast) this.g.ev({ e: 'zone', z: { x: Math.round(o.x * 100) / 100, z: Math.round(o.z * 100) / 100, r: o.r, dps: o.dps, dmg: o.dmg,
      once: o.once, t: o.t, owner: o.owner && o.owner.id, col: [o.col.r, o.col.g, o.col.b] } });
  }

  updateZones(dt) {
    const g = this.g;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const Z = this.zones[i];
      Z.t -= dt; Z.delay -= dt;
      Z.mesh.material.opacity = 0.45 * Math.min(1, Z.t / 0.4) * (0.75 + 0.25 * Math.sin(g.time * 9));
      let gone = Z.t <= 0;
      if (!gone && g.authority && Z.delay <= 0 && (Z.tick -= dt) <= 0) {
        Z.tick = 0.25;
        for (const o of g.brawlers) {
          if (o === Z.owner || !o.alive || o.pos.y > 0.3 || Math.hypot(o.pos.x - Z.x, o.pos.z - Z.z) > Z.r + o.radius * 0.5) continue;
          if (Z.once) {
            g.damage(o, Z.dmg * (Z.owner ? Z.owner.dmgMul : 1), Z.owner);
            g.effects.sparkBurst(Z.x, 0.4, Z.z, Z.col, 20, 6, 0.4, 0.14);
            g.ev({ e: 'zoneOff', x: Math.round(Z.x * 100) / 100, z: Math.round(Z.z * 100) / 100 });
            gone = true;
            break;
          }
          g.damage(o, Z.dps * 0.25 * (Z.owner ? Z.owner.dmgMul : 1), Z.owner);
        }
      }
      if (gone) { g.fx.remove(Z.mesh); Z.mesh.material.dispose(); this.zones.splice(i, 1); }
    }
  }

  // Frostbite super: ring of frost around him, damages and freezes everyone close.
  nova(b) {
    const g = this.g, perma = hasStar(b, 'permafrost'), R = perma ? 6.25 : 5, x = b.pos.x, z = b.pos.z;
    if (g.authority) {
      for (const o of g.brawlers) {
        if (o === b || !o.alive || Math.hypot(o.pos.x - x, o.pos.z - z) > R) continue;
        g.damage(o, 900 * b.dmgMul, b, true);
        if (!o.alive) continue;
        if (o.ccImmuneT > 0) {
          if (o.visibleToPlayer) g.hud.floater(g.camera, o.pos.x, 3.1, o.pos.z, t('hud.immune'), 'immune');
          g.ev({ e: 'imm', id: o.id });
        }
        else o.freezeT = Math.max(o.freezeT, perma ? 1.0 : 1.4);
      }
    }
    const fx = g.effects;
    fx.ring(x, z, R, new THREE.Color(1.2, 2.6, 3.4), 0.55);
    fx.ring(x, z, R * 0.6, new THREE.Color(2, 3.4, 4), 0.4);
    fx.sparkBurst(x, 1, z, COL.ice, 60, 13, 0.7, 0.2);
    fx.flash(x, 2, z, ICE_LIGHT.r, ICE_LIGHT.g, ICE_LIGHT.b, 220, 18, 0.5);
    g.shakeAt(x, z, 0.45);
    sfx('super', g.volumeAt(x, z));
    sfx('break', g.volumeAt(x, z) * 0.6);
  }

  // Volt main attack: on hit, lightning jumps to up to 2 more enemies (60% then 40% damage).
  chainZap(first, B) {
    const g = this.g, hit = new Set([first, B.owner]), pts = [[B.x, B.z], [first.pos.x, first.pos.z]];
    let from = first, mul = 0.6;
    for (let k = 0; k < B.chain; k++) {
      let best = null, bd = 5.5;
      for (const o of g.brawlers) {
        if (hit.has(o) || !o.alive) continue;
        const d = Math.hypot(o.pos.x - from.pos.x, o.pos.z - from.pos.z);
        if (d < bd && g.arena.los(from.pos.x, from.pos.z, o.pos.x, o.pos.z)) { bd = d; best = o; }
      }
      if (!best) break;
      hit.add(best);
      pts.push([best.pos.x, best.pos.z]);
      g.damage(best, B.dmg * B.owner.dmgMul * mul, B.owner);
      from = best; mul -= 0.2;
    }
    if (pts.length > 2) {
      g.effects.arc(pts, BOLT);
      g.ev({ e: 'zap', pts: pts.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]) });
    }
  }

  // Volt super: 5 bolts on a deterministic spiral around the target point (same on every client).
  storm(b, point) {
    const R = b.type.range;
    let dx = point.x - b.pos.x, dz = point.z - b.pos.z;
    const d = Math.hypot(dx, dz) || 1, cd = Math.min(d, R);
    const cx = b.pos.x + dx / d * cd, cz = b.pos.z + dz / d * cd;
    const n = hasStar(b, 'surge') ? 7 : 5;
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996, r = 2.8 * Math.sqrt((k + 0.5) / n);
      this.strikes.push({ t: 0.18 + k * 0.2 * 5 / n, x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, owner: b, dmg: n === 7 ? 450 : 600 });
    }
    this.g.effects.ring(cx, cz, 3.2, new THREE.Color(1.5, 3, 4), 1.1);
  }

  updateStrikes(dt) {
    const g = this.g, A = g.arena;
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const S = this.strikes[i];
      S.t -= dt;
      if (S.t > 0) continue;
      this.strikes.splice(i, 1);
      if (g.authority) {
        for (const o of g.brawlers) {
          if (o === S.owner || !o.alive || Math.hypot(o.pos.x - S.x, o.pos.z - S.z) > 1.8) continue;
          g.damage(o, S.dmg * S.owner.dmgMul, S.owner, true);
        }
        const ti = A.toTile(S.x), tj = A.toTile(S.z);
        if (A.get(ti, tj) === '#') g.breakWall(ti, tj);
        if (A.get(ti, tj) === 'C') g.damageCrate(ti, tj, 900, S.owner);
      }
      const fx = g.effects;
      fx.bolt(S.x, S.z, BOLT);
      fx.sparkBurst(S.x, 0.3, S.z, BOLT, 26, 9, 0.5, 0.16);
      fx.flash(S.x, 3, S.z, 0.75, 0.9, 1, 320, 16, 0.35);
      fx.ring(S.x, S.z, 1.8, new THREE.Color(2, 3.5, 4.5), 0.35);
      if (A.isWaterAt(S.x, S.z)) { A.water.ripple(S.x, S.z, 1.2); fx.splash(S.x, S.z, 1); } else fx.scorch(S.x, S.z, 1.2);
      g.shakeAt(S.x, S.z, 0.35);
      sfx('boom', g.volumeAt(S.x, S.z) * 0.7);
      sfx('thunder2', g.volumeAt(S.x, S.z) * 0.5);
    }
  }

  emit(pool) {
    for (const B of this.bullets) {
      if (B.emit) pool.add(B.x, BULLET_Y + 0.2, B.z, B.lr, B.lg, B.lb, B.breakWalls ? 12 : 8, 6.5);
    }
    for (const B of this.bombs) pool.add(B.fx, B.fy, B.fz, 1, 0.55, 0.2, B.sup ? 7 : 5, B.sup ? 6 : 5);
  }

  clear() {
    for (const B of this.bullets) this.release(B.mesh);
    this.bullets.length = 0;
    for (const B of this.bombs) this.g.fx.remove(B.mesh);
    this.bombs.length = 0;
    this.strikes.length = 0;
    for (const Z of this.zones) this.g.fx.remove(Z.mesh);
    this.zones.length = 0;
    for (const W of this.windups) this.g.fx.remove(W.mesh);
    this.windups.length = 0;
    for (const B of this.bombs) if (B.shadow) this.g.fx.remove(B.shadow);
  }
}
