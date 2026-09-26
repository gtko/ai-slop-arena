import * as THREE from 'three';
import { sfx } from './audio.js';
import { t } from './i18n/index.js';

// Themed arena events (v0.13 LEVEL UP, A02 themed cards + A04): once per match, around a minute
// in (between the two supply drops), the arena itself joins the fight for ~15 s. One per map:
//   oasis  geysers    vents that erupt under your feet (hurt + launch)
//   dunes  meteors    a meteor shower, aimed near brawlers, that also smashes walls and crates
//   grove  lightning  a lightning rod that strikes whoever stands closest
//   peak   blizzard   you see less far and move slower
//   marsh  fogbank    the fog closes in, and healing mushrooms sprout
// Everything that hurts is telegraphed on the ground first. The authority (solo, host, server)
// decides and sends 'arena' events; everyone draws them. Bots step out of the telegraphs (ai.js).

export const EVENT_OF = { oasis: 'geysers', dunes: 'meteors', grove: 'lightning', peak: 'blizzard', marsh: 'fogbank' };
export const EVENT_ICONS = { geysers: '⛲', meteors: '☄️', lightning: '⚡', blizzard: '🌨️', fogbank: '🍄' };
const LENGTH = { geysers: 14, meteors: 12, lightning: 14, blizzard: 14, fogbank: 16 };
// telegraphs: radius, damage, warning time, knock-back
const HITS = {
  geyser: { r: 1.5, dmg: 400, warn: 1.4, knock: 10, col: new THREE.Color(0.6, 1.8, 3.2) },
  meteor: { r: 1.8, dmg: 700, warn: 1.4, knock: 7, col: new THREE.Color(3.2, 1.2, 0.3) },
  bolt: { r: 1.3, dmg: 650, warn: 1.0, knock: 0, col: new THREE.Color(3.2, 3, 0.8) },
};
const SHROOM_HEAL = 1500;
const r2 = v => Math.round(v * 100) / 100;

export class ArenaEvents {
  constructor(g) {
    this.g = g;
    this.warns = [];   // telegraphs on the ground: { id, type, x, z, t, mesh }
    this.props = [];   // meshes that stay while the event runs (vents, rod, mushrooms)
    this.shrooms = [];
    this.columns = []; // geyser water columns
    this.kind = null;
    this.on = false;
  }

  // New match. at: when the event starts (Infinity: never, e.g. dojo, attract, menu).
  reset(mapKey, at = Infinity) {
    this.clear();
    this.kind = EVENT_OF[mapKey] || null;
    this.at = this.kind ? at : Infinity;
    this.on = false;
    this.done = false;
    this.seq = 0;
    this.plan = [];
  }

  clear() {
    for (const w of this.warns) this.g.fx.remove(w.mesh);
    for (const p of this.props) this.g.fx.remove(p);
    for (const c of this.columns) this.g.fx.remove(c.mesh);
    this.warns = []; this.props = []; this.shrooms = []; this.columns = [];
    this.restore();
  }

  get active() { return this.on; }

  /* ------------------------------ authority ------------------------------ */

  update(dt) {
    const g = this.g;
    if (g.authority && !this.on && !this.done && g.time >= this.at && !g.ended) this.start();
    if (this.on) {
      this.t += dt;
      if (g.authority) this.direct();
      if (this.t >= LENGTH[this.kind] && g.authority) this.end();
    }
    this.animate(dt);
  }

  start() {
    const g = this.g, A = g.arena, lvl = g.poison.level, k = this.kind;
    this.plan = [];
    const spots = (n, minRing) => {
      const out = [];
      for (let tries = 0; tries < 200 && out.length < n; tries++) {
        const [i, j] = A.randomOpenTile(minRing);
        if (A.get(i, j) !== '.' || out.some(([a, b]) => Math.hypot(a - i, b - j) < 4)) continue;
        out.push([i, j]);
      }
      return out.map(([i, j]) => A.center(i, j, new THREE.Vector3()));
    };
    let props = [];
    if (k === 'geysers') {
      props = spots(4, lvl + 3).map(c => ({ p: 'vent', x: r2(c.x), z: r2(c.z) }));
      props.forEach((v, n) => { for (const at of [2, 6.5, 11]) this.plan.push({ at: at + n * 0.45, type: 'geyser', x: v.x, z: v.z }); });
    } else if (k === 'meteors') {
      for (let n = 0; n < 10; n++) this.plan.push({ at: 1 + n * 1.05, type: 'meteor', aim: true });
    } else if (k === 'lightning') {
      const [c] = spots(1, Math.max(lvl + 3, 6));
      if (c) { props = [{ p: 'rod', x: r2(c.x), z: r2(c.z) }]; this.rod = c; }
      for (let at = 1.5; at < LENGTH.lightning - 1; at += 2.4) this.plan.push({ at, type: 'bolt', rod: true });
    } else if (k === 'fogbank') {
      props = spots(4, lvl + 3).map((c, n) => ({ p: 'shroom', id: n, x: r2(c.x), z: r2(c.z) }));
    }
    this.plan.sort((a, b) => a.at - b.at);
    g.ev({ e: 'arena', k: 'start', kind: k, props });
    this.begin(k, props);
  }

  // Telegraphs that are due, and mushrooms being picked.
  direct() {
    const g = this.g;
    while (this.plan.length && this.t >= this.plan[0].at - HITS[this.plan[0].type].warn) {
      const P = this.plan.shift();
      let x = P.x, z = P.z;
      if (P.aim) [x, z] = this.meteorSpot();
      if (P.rod) [x, z] = this.rodTarget();
      if (x === undefined) continue;
      const id = ++this.seq;
      g.ev({ e: 'arena', k: 'warn', type: P.type, id, x: r2(x), z: r2(z) });
      this.warn(P.type, id, x, z);
    }
    for (const S of this.shrooms) {
      if (S.eaten) continue;
      const b = g.brawlers.find(o => o.alive && o.hp < o.maxHp && Math.hypot(o.pos.x - S.x, o.pos.z - S.z) < 1);
      if (!b) continue;
      b.hp = Math.min(b.maxHp, b.hp + SHROOM_HEAL);
      g.ev({ e: 'arena', k: 'eat', id: S.id, by: b.id });
      this.eat(S.id, b);
    }
  }

  // A meteor lands near a brawler half of the time (never on top of one: 1-4 m off), else anywhere safe.
  meteorSpot() {
    const g = this.g, A = g.arena, lvl = g.poison.level, alive = g.brawlers.filter(b => b.alive);
    for (let tries = 0; tries < 20; tries++) {
      let x, z;
      if (alive.length && Math.random() < 0.55) {
        const b = alive[Math.floor(Math.random() * alive.length)], a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 3;
        x = b.pos.x + Math.cos(a) * d; z = b.pos.z + Math.sin(a) * d;
      } else {
        const c = A.center(...A.randomOpenTile(lvl + 2), new THREE.Vector3());
        x = c.x; z = c.z;
      }
      const i = A.toTile(x), j = A.toTile(z);
      if (A.ring(i, j) > lvl + 1 && A.walkable(i, j)) return [x, z];
    }
    return [undefined, undefined];
  }

  // The lightning rod strikes the closest brawler within 6.5 m (where they stand now), else itself.
  rodTarget() {
    const R = this.rod;
    if (!R) return [undefined, undefined];
    let best = null, bd = 6.5;
    for (const b of this.g.brawlers) {
      const d = Math.hypot(b.pos.x - R.x, b.pos.z - R.z);
      if (b.alive && d < bd) { bd = d; best = b; }
    }
    return best ? [best.pos.x, best.pos.z] : [R.x + 0.8, R.z];
  }

  // Authority: a telegraph ran out, it lands.
  land(w) {
    const g = this.g, H = HITS[w.type];
    g.ev({ e: 'arena', k: 'hit', type: w.type, id: w.id, x: r2(w.x), z: r2(w.z) });
    this.hitFx(w.type, w.x, w.z);
    for (const o of g.brawlers) {
      const dx = o.pos.x - w.x, dz = o.pos.z - w.z, d = Math.hypot(dx, dz);
      if (!g.hittable(o) || d > H.r) continue;
      g.damage(o, H.dmg, null);
      if (H.knock) g.applyKnock(o, (dx || 0.5) / (d || 1) * H.knock, dz / (d || 1) * H.knock);
    }
    if (w.type === 'meteor') { // walls and crates in the crater break
      const A = g.arena, ci = A.toTile(w.x), cj = A.toTile(w.z);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj, c = A.center(i, j, new THREE.Vector3());
        if (Math.hypot(c.x - w.x, c.z - w.z) > 1.4) continue;
        if (A.get(i, j) === '#') g.breakWall(i, j);
        else if (A.get(i, j) === 'C') g.damageCrate(i, j, 1e9, null);
      }
    }
  }

  end() {
    this.g.ev({ e: 'arena', k: 'end' });
    this.finish();
  }

  /* ------------------------------ everyone ------------------------------ */

  // Client: the host's events.
  onEvent(e) {
    switch (e.k) {
      case 'start': if (EVENT_OF[this.g.mapKey] === e.kind) this.begin(e.kind, Array.isArray(e.props) ? e.props : []); break;
      case 'warn': if (HITS[e.type]) this.warn(e.type, e.id, e.x, e.z); break;
      case 'hit': if (HITS[e.type]) { this.drop(e.id); this.hitFx(e.type, e.x, e.z); } break;
      case 'eat': this.eat(e.id, this.g.byId.get(e.by)); break;
      case 'end': this.finish(); break;
    }
  }

  begin(kind, props) {
    const g = this.g;
    this.kind = kind; this.on = true; this.t = 0;
    for (const P of props) {
      if (P.p === 'vent') this.props.push(this.ventMesh(P.x, P.z));
      if (P.p === 'rod') { this.rod = { x: P.x, z: P.z }; this.props.push(this.rodMesh(P.x, P.z)); }
      if (P.p === 'shroom') { const m = this.shroomMesh(P.x, P.z); this.props.push(m); this.shrooms.push({ id: P.id, x: P.x, z: P.z, mesh: m, eaten: false }); }
    }
    if (kind === 'blizzard') {
      this.saved = { sight: g.sightRange };
      g.sightRange = 7; g.speedMul = 0.85;
      if (g.weather) g.weather.storm = 1;
      sfx('blizzard');
    }
    if (kind === 'fogbank') {
      this.saved = { vision: g.visionRadius };
      this.fogFrom = g.visionRadius || 14;
    }
    if (g.player) {
      g.hud.showBanner(`${EVENT_ICONS[kind]} ${t('event.' + kind)}`, 'event');
      sfx('chaos', 0.7);
    }
  }

  finish() {
    this.on = false;
    this.done = true;
    for (const w of this.warns) this.g.fx.remove(w.mesh);
    this.warns = [];
    for (const p of this.props) this.g.fx.remove(p);
    this.props = []; this.shrooms = [];
    this.restore();
  }

  // Blizzard and fog bank are temporary: back to the map's normal sight.
  restore() {
    const g = this.g;
    if (this.saved) {
      if (this.saved.sight !== undefined) g.sightRange = this.saved.sight;
      if (this.saved.vision !== undefined) g.visionRadius = this.saved.vision;
      this.saved = null;
    }
    g.speedMul = 1;
    if (g.weather) g.weather.storm = 0;
  }

  warn(type, id, x, z) {
    // drawn over the grass and bushes: a warning must never hide
    const H = HITS[type], mat = new THREE.MeshBasicMaterial({ color: H.col, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const mesh = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(H.r * 0.84, H.r, 40).rotateX(-Math.PI / 2), mat);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(H.r * 0.84, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: type === 'meteor' ? 0x220800 : H.col, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false }));
    ring.renderOrder = fill.renderOrder = 6;
    mesh.add(ring, fill);
    mesh.position.set(x, 0.07, z);
    if (type === 'meteor') { // the rock itself, falling during the telegraph
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: 0x3a2418, emissive: 0xff5a10, emissiveIntensity: 1.6, flatShading: true }));
      rock.position.y = 24;
      mesh.add(rock);
      mesh.userData.rock = rock;
    }
    this.g.fx.add(mesh);
    this.warns.push({ id, type, x, z, t: H.warn, T: H.warn, mesh, fill });
    const v = this.g.volumeAt(x, z);
    if (type === 'geyser') sfx('geyser_warn', v * 0.8);
    if (type === 'bolt') sfx('rod_zap', v * 0.4);
  }

  drop(id) {
    const i = this.warns.findIndex(w => w.id === id);
    if (i >= 0) { this.g.fx.remove(this.warns[i].mesh); this.warns.splice(i, 1); }
  }

  hitFx(type, x, z) {
    const g = this.g, E = g.effects, v = g.volumeAt(x, z);
    if (type === 'geyser') {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 1, 16, 1, true).translate(0, 0.5, 0),
        new THREE.MeshStandardMaterial({ color: 0x9fe4ff, emissive: 0x2a8fd0, emissiveIntensity: 0.8, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      mesh.position.set(x, 0, z);
      g.fx.add(mesh);
      this.columns.push({ mesh, t: 0.9 });
      E.splash(x, z, 1.6);
      E.sparkBurst(x, 2, z, HITS.geyser.col, 22, 7, 0.6, 0.16);
      sfx('geyser', v);
    } else if (type === 'meteor') {
      E.explosion(x, z, 1.8, true);
      E.debrisBurst(x, 0.4, z, new THREE.Color(0x4a2a18), 14, 0.34, 7);
      g.shakeAt(x, z, 0.45);
      sfx('meteor', v);
    } else if (type === 'bolt') {
      E.bolt(x, z, HITS.bolt.col);
      E.ring(x, z, 1.4, HITS.bolt.col, 0.4);
      E.flash(x, 3, z, 1, 1, 0.6, 60, 12, 0.25);
      g.shakeAt(x, z, 0.25);
      sfx('thunder', v * 0.8);
    }
  }

  eat(id, b) {
    const S = this.shrooms.find(s => s.id === id);
    if (!S || S.eaten) return;
    S.eaten = true;
    this.g.fx.remove(S.mesh);
    this.g.effects.sparkBurst(S.x, 1, S.z, new THREE.Color(1, 3.6, 1.4), 20, 5, 0.6, 0.15);
    if (b && this.g.fxVisible(b)) {
      sfx('mushroom', this.g.volumeAt(S.x, S.z));
      if (b.isPlayer) this.g.hud.floater(this.g.camera, b.pos.x, 3.2, b.pos.z, `+${SHROOM_HEAL}`, 'heal');
    }
  }

  // Timers of the telegraphs (the authority lands them), the fog closing in, props bobbing.
  animate(dt) {
    const g = this.g;
    for (let k = this.warns.length - 1; k >= 0; k--) {
      const w = this.warns[k];
      w.t -= dt;
      const f = 1 - Math.max(0, w.t) / w.T;
      w.fill.scale.setScalar(0.2 + f * 0.8);
      w.mesh.children[0].material.opacity = 0.55 + 0.4 * Math.sin(g.time * 18);
      if (w.mesh.userData.rock) {
        const r = w.mesh.userData.rock;
        r.position.y = 24 * (1 - f) * (1 - f) + 0.3;
        r.rotation.x += dt * 5; r.rotation.z += dt * 3;
      }
      if (w.t <= 0) {
        this.warns.splice(k, 1);
        g.fx.remove(w.mesh);
        if (g.authority) this.land(w);
      }
    }
    for (let k = this.columns.length - 1; k >= 0; k--) {
      const c = this.columns[k];
      c.t -= dt;
      const f = Math.max(0, c.t) / 0.9;
      c.mesh.scale.set(0.6 + f * 0.6, 6 * Math.sin(Math.min(1, (1 - f) * 3) * Math.PI / 2) * (0.3 + f * 0.7), 0.6 + f * 0.6);
      c.mesh.material.opacity = 0.8 * f;
      if (c.t <= 0) { g.fx.remove(c.mesh); this.columns.splice(k, 1); }
    }
    for (const S of this.shrooms) if (!S.eaten) { S.mesh.position.y = 0.05 + Math.abs(Math.sin(g.time * 3 + S.id)) * 0.15; S.mesh.rotation.y += dt; }
    if (this.on && this.kind === 'fogbank' && this.fogFrom) {
      const f = Math.min(1, this.t / 3) * Math.min(1, (LENGTH.fogbank - this.t) / 2); // in over 3 s, out over the last 2
      g.visionRadius = this.fogFrom * (1 - 0.45 * Math.max(0, f));
    }
  }

  /* ------------------------------ props ------------------------------ */

  ventMesh(x, z) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.18, 8, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a6470, roughness: 0.9 }));
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5ac8ff, emissive: 0x1a6aa0, emissiveIntensity: 0.6 }));
    water.position.y = 0.04;
    const g = new THREE.Group();
    g.add(m, water);
    g.position.set(x, 0.05, z);
    this.g.fx.add(g);
    return g;
  }

  rodMesh(x, z) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.8, roughness: 0.3 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 3.6, 8).translate(0, 1.8, 0), metal);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 10).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.8 }));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff6a0, emissive: 0xffe040, emissiveIntensity: 3 }));
    tip.position.y = 3.7;
    g.add(pole, base, tip);
    g.position.set(x, 0, z);
    g.traverse(o => { o.castShadow = true; });
    this.g.fx.add(g);
    return g;
  }

  shroomMesh(x, z) {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 10).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ color: 0xf4ead0 }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3ad16a, emissive: 0x1a8a3a, emissiveIntensity: 0.9 }));
    cap.position.y = 0.45;
    g.add(stem, cap);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2, s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      s.position.set(Math.cos(a) * 0.28, 0.72, Math.sin(a) * 0.28);
      g.add(s);
    }
    g.position.set(x, 0.05, z);
    g.traverse(o => { o.castShadow = true; });
    this.g.fx.add(g);
    return g;
  }
}
