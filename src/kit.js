import * as THREE from 'three';
import { N, TILE } from './arena.js';
import { sfx } from './audio.js';
import { t } from './i18n/index.js';

// Interactive arena kit (v0.15 WILD ISLES, docs/brainstorm/iter3_kenji.md §2c). Tiles of maps.js:
//   V  void: nothing to stand on. Walking stops at the edge, but a brawler knocked onto it falls: a
//      ring-out K.O., credited to whoever pushed it in the last 3 s.
//   =  wooden bridge: walkable, 1200 HP against explosions, then it falls and becomes void.
//   J  jump pad: launches you to the next ground toward the middle (7 m or more), 0.8 s in the air
//      (no attacks up there); the landing hits enemies around for 150.
//   E  explosive barrel: 600 HP, then 900 in 2.5 m with a big push, and the next barrels go too.
//   H  healing mushroom: +1200 health over 2 s, grows back in 20 s.
//   M  the windmill (a 2 x 2 landmark): blocks feet, bullets and sight.
// Maps with `crumble` (Windmill Isles) have no gas: the outer islands break off one after the
// other, then the middle island shrinks, each time after a 5 s telegraph.
// Rules run on the authority (solo, host, server); clients get 'kit' events and draw the same.

const PUSH_CREDIT = 3;        // s: a fall counts as the last pusher's K.O.
const PAD_MIN = 7, PAD_MAX = 14, PAD_AIR = 0.8, PAD_HIT = 150;
const BARREL_R = 2.5, BARREL_DMG = 900, BARREL_KNOCK = 9;
const SHROOM_HEAL = 1200, SHROOM_TIME = 2, SHROOM_REGROW = 20;
const BRIDGE_HP = 1200;
const DOOM_WARN = 5;
const r2 = v => Math.round(v * 100) / 100;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class MapKit {
  constructor(game) {
    this.g = game;
    const A = this.A = game.arena;
    this.map = A.map;
    this.group = new THREE.Group();
    A.group.add(this.group); // disposed with the arena
    this.pads = []; this.shrooms = []; this.bridges = new Map(); this.falling = []; this.doomed = new Set();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ch = A.get(i, j);
      if (ch === 'J') this.pads.push({ i, j });
      if (ch === 'H') this.shrooms.push({ i, j, ready: true, at: 0 });
      if (ch === '=') this.bridges.set(A.key(i, j), { i, j, hp: BRIDGE_HP });
    }
    for (const p of this.pads) this.aimPad(p);
    this.buildVisuals();
    // crumbling islands: the plan (time, tiles), outer islands first
    this.plan = this.map.crumble ? this.crumblePlan() : [];
    this.step = 0;
  }

  get active() { return this.pads.length || this.shrooms.length || this.bridges.size || this.plan.length || this.map.sky; }
  get crumbles() { return this.plan.length > 0; }
  // seconds before the next island starts to fall (HUD); Infinity once everything planned has fallen
  get nextIn() { const s = this.plan[this.step]; return s ? s.at - this.g.time : Infinity; }

  /* ------------------------------ layout ------------------------------ */

  // A jump pad lands on the first open ground at least 7 m toward the middle of the arena.
  aimPad(p) {
    const A = this.A, c = A.center(p.i, p.j, new THREE.Vector3());
    let dx = -c.x, dz = -c.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const ok = d => { const x = c.x + dx * d, z = c.z + dz * d, ch = A.charAt(x, z); return A.walkable(A.toTile(x), A.toTile(z)) && ch !== 'V' && ch !== 'J'; };
    let dist = 0;
    for (let d = PAD_MIN; d <= PAD_MAX; d += 0.5) if (ok(d)) { dist = d; break; }
    if (!dist) for (let d = PAD_MIN; d >= 2; d -= 0.5) if (ok(d)) { dist = d; break; }
    Object.assign(p, { x: c.x, z: c.z, dx, dz, dist: dist || PAD_MIN });
  }

  // Land tiles grouped into islands (bridges and void apart). The outer islands fall two by two
  // (40 s, 60 s), the bridges at 80 s, then the middle island shrinks a ring every 10 s.
  crumblePlan() {
    const A = this.A, seen = new Set(), islands = [];
    const land = (i, j) => { const ch = A.get(i, j); return ch !== 'V' && ch !== '=' && ch !== 'X'; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (!land(i, j) || seen.has(A.key(i, j))) continue;
      const tiles = [], stack = [[i, j]];
      seen.add(A.key(i, j));
      while (stack.length) {
        const [a, b] = stack.pop();
        tiles.push([a, b]);
        for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const na = a + da, nb = b + db;
          if (land(na, nb) && !seen.has(A.key(na, nb))) { seen.add(A.key(na, nb)); stack.push([na, nb]); }
        }
      }
      const cx = tiles.reduce((s, [a]) => s + a, 0) / tiles.length - (N - 1) / 2, cz = tiles.reduce((s, [, b]) => s + b, 0) / tiles.length - (N - 1) / 2;
      islands.push({ tiles, d: Math.hypot(cx, cz), ang: Math.atan2(cz, cx) });
    }
    islands.sort((a, b) => b.d - a.d);
    const middle = islands.pop(); // the closest to the centre stays
    const outer = islands.filter(s => s.tiles.length > 2).sort((a, b) => a.ang - b.ang);
    const plan = [];
    // opposite islands together: 0+2 then 1+3 (by angle), any extra ones with the second wave
    const waves = [[], []];
    outer.forEach((s, k) => waves[k % 2].push(...s.tiles));
    [40, 60].forEach((at, k) => { if (waves[k].length) plan.push({ at, tiles: waves[k] }); });
    const bridges = [...this.bridges.values()].map(b => [b.i, b.j]);
    if (bridges.length) plan.push({ at: 80, tiles: bridges });
    if (middle) {
      const ci = (N - 1) / 2, far = ([a, b]) => Math.max(Math.abs(a - ci), Math.abs(b - ci));
      const maxR = Math.max(...middle.tiles.map(far));
      for (let r = maxR, at = 95; r > 1.5; r--, at += 10) {
        const ring = middle.tiles.filter(p => far(p) > r - 1 && far(p) <= r);
        if (ring.length) plan.push({ at, tiles: ring });
      }
    }
    return plan;
  }

  /* ------------------------------ visuals ------------------------------ */

  buildVisuals() {
    const A = this.A, G = this.group;
    // jump pads: a round spring pad with a big arrow toward where it sends you
    if (this.pads.length) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.16, 28), new THREE.MeshStandardMaterial({ color: 0x3a3f58, roughness: 0.6 }));
      const top = new THREE.MeshStandardMaterial({ color: 0x4dd0ff, emissive: 0x1a8fcf, emissiveIntensity: 0.8, roughness: 0.35 });
      const arrow = new THREE.Shape().moveTo(0, 0.55).lineTo(0.42, 0.05).lineTo(0.16, 0.05).lineTo(0.16, -0.45).lineTo(-0.16, -0.45).lineTo(-0.16, 0.05).lineTo(-0.42, 0.05).closePath();
      const arrowGeo = new THREE.ShapeGeometry(arrow).rotateX(-Math.PI / 2);
      this.padMat = top;
      for (const p of this.pads) {
        const g = new THREE.Group();
        const b = base.clone(); b.position.y = 0.08; b.receiveShadow = true;
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 28), top); disc.position.y = 0.18;
        const ar = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })); ar.position.y = 0.215;
        ar.rotation.y = Math.atan2(-p.dx, -p.dz); // the arrow's tip (-z after the flat turn) points where the pad sends you
        g.add(b, disc, ar);
        g.position.set(p.x, 0, p.z);
        G.add(g);
        p.disc = disc;
      }
    }
    // healing mushrooms: a fat white stem and a red spotted cap that pops back up
    if (this.shrooms.length) {
      const stem = new THREE.CylinderGeometry(0.22, 0.3, 0.6, 14), cap = new THREE.SphereGeometry(0.55, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const stemMat = new THREE.MeshStandardMaterial({ color: 0xf4ecd8, roughness: 0.7 }), capMat = new THREE.MeshStandardMaterial({ color: 0xe8455a, emissive: 0x5a0a18, emissiveIntensity: 0.5, roughness: 0.5 });
      const dotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), dot = new THREE.SphereGeometry(0.09, 8, 6);
      for (const s of this.shrooms) {
        const g = new THREE.Group(), c = A.center(s.i, s.j, new THREE.Vector3());
        const st = new THREE.Mesh(stem, stemMat); st.position.y = 0.3;
        const cp = new THREE.Mesh(cap, capMat); cp.position.y = 0.55; cp.scale.y = 0.8;
        g.add(st, cp);
        for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, d = new THREE.Mesh(dot, dotMat); d.position.set(Math.cos(a) * 0.36, 0.85, Math.sin(a) * 0.36); g.add(d); }
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        g.position.set(c.x, 0, c.z);
        G.add(g);
        s.mesh = g;
      }
    }
    // bridges: planks over the void, one instance per tile
    if (this.bridges.size) {
      const plank = new THREE.BoxGeometry(1.98, 0.22, 1.9);
      const mat = new THREE.MeshStandardMaterial({ color: 0x9c6a3c, roughness: 0.8, vertexColors: false });
      this.bridgeMesh = new THREE.InstancedMesh(plank, mat, this.bridges.size);
      let k = 0;
      for (const b of this.bridges.values()) {
        A.center(b.i, b.j, _v);
        // planks run across the way you walk them (bridges are straight lines of '=')
        const along = A.get(b.i - 1, b.j) === '=' || A.get(b.i + 1, b.j) === '=';
        _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, along ? 0 : Math.PI / 2);
        _m.compose(_v.setY(-0.08), _q, _s.set(1, 1, 1));
        this.bridgeMesh.setMatrixAt(k, _m);
        this.bridgeMesh.setColorAt(k, new THREE.Color().setHSL(0.07, 0.45, 0.38 + Math.random() * 0.08));
        b.idx = k++;
      }
      this.bridgeMesh.castShadow = this.bridgeMesh.receiveShadow = true;
      G.add(this.bridgeMesh);
    }
    // sky maps: rock under every island tile, clouds far below
    if (this.map.sky) {
      const land = [];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const ch = A.get(i, j); if (ch !== 'V' && ch !== '=') land.push([i, j]); }
      const geo = new THREE.CylinderGeometry(1.45, 0.7, 4.2, 6, 1).translate(0, -2.1, 0);
      this.rock = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a6a4e, roughness: 0.95, flatShading: true }), land.length);
      this.rockIdx = new Map();
      land.forEach(([i, j], k) => {
        A.center(i, j, _v);
        _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (i * 7 + j * 13) % 6);
        _m.compose(_v.setY(0), _q, _s.set(1, 0.7 + ((i * 31 + j * 17) % 10) / 16, 1));
        this.rock.setMatrixAt(k, _m);
        this.rockIdx.set(A.key(i, j), k);
      });
      G.add(this.rock);
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const x = c.getContext('2d');
      if (x) {
        x.fillStyle = '#7cc0f4'; x.fillRect(0, 0, 256, 256);
        // soft clouds, drawn 9 times around so the texture tiles without a seam
        for (let k = 0; k < 26; k++) {
          const cx = Math.random() * 256, cy = Math.random() * 256, r = 10 + Math.random() * 24, a = 0.18 + Math.random() * 0.3;
          for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
            const gr = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
            gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = gr; x.beginPath(); x.arc(cx + ox, cy + oy, r, 0, 7); x.fill();
          }
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(4, 4);
      tex.userData.perMatch = true;
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
      sea.position.y = -22;
      G.add(sea);
      this.clouds = tex;
    }
    // the windmill: a 2 x 2 stone tower, a red roof and turning sails, facing south (the camera)
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      if (A.get(i, j) !== 'M' || A.get(i - 1, j) === 'M' || A.get(i, j - 1) === 'M') continue;
      const c = A.center(i, j, new THREE.Vector3()).add(new THREE.Vector3(TILE / 2, 0, TILE / 2)), g = new THREE.Group();
      const stone = new THREE.MeshStandardMaterial({ color: 0xece2cf, roughness: 0.85 }), roofM = new THREE.MeshStandardMaterial({ color: 0xc8453a, roughness: 0.7 });
      const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.8 }), cloth = new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.9, side: THREE.DoubleSide });
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.85, 5.2, 14), stone); tower.position.y = 2.6;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.8, 14), roofM); roof.position.y = 6.1;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.2), wood); door.position.set(0, 0.65, 1.78);
      const hub = new THREE.Group(); hub.position.set(0, 4.6, 1.55);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10).rotateX(Math.PI / 2), wood); hub.add(axle);
      for (let k = 0; k < 4; k++) {
        const arm = new THREE.Group(); arm.rotation.z = k * Math.PI / 2;
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.6, 0.1), wood); spar.position.y = 1.8;
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.8), cloth); sail.position.set(0.5, 2.1, 0.06);
        arm.add(spar, sail); hub.add(arm);
      }
      g.add(tower, roof, door, hub);
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.position.copy(c);
      G.add(g);
      this.sails = hub;
    }
    // doomed tiles: red cracks that blink before they fall
    this.cracks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.4, depthWrite: false }), N * N);
    this.cracks.count = 0;
    this.cracks.renderOrder = 1;
    G.add(this.cracks);
  }

  /* ------------------------------ rules ------------------------------ */

  // Knocked onto the void? (authority) Anyone in the air flies over it; a fall is a K.O.
  checkFalls() {
    const g = this.g, A = this.A;
    for (const b of g.brawlers) {
      if (!b.alive || b.pos.y > 0.05 || (b.dash && b.dash.air)) continue;
      const x = b.netDriven ? b.net.x : b.pos.x, z = b.netDriven ? b.net.y : b.pos.z;
      if (A.charAt(x, z) !== 'V') continue;
      const P = b.pushBy && g.time - b.pushBy.t < PUSH_CREDIT && b.pushBy.by !== b ? b.pushBy.by : null;
      b.fell = true;
      g.kill(b, P && P.alive !== undefined ? P : null);
    }
  }

  // Your own brawler (or the bots, on the authority) steps on a pad: off you go.
  checkPads() {
    const g = this.g;
    for (const p of this.pads) {
      for (const b of g.brawlers) {
        if (!b.alive || b.dash || b.pos.y > 0.05 || b.freezeT > 0 || b.rootT > 0) continue;
        const x = b.netDriven ? b.net.x : b.pos.x, z = b.netDriven ? b.net.y : b.pos.z;
        if (Math.hypot(x - p.x, z - p.z) > 0.75) continue;
        const mine = g.authority ? !b.netDriven : b === g.player; // who moves this brawler
        if (mine) {
          b.dash = { vx: p.dx * p.dist / PAD_AIR, vz: p.dz * p.dist / PAD_AIR, t: PAD_AIR, air: true, T: PAD_AIR, pad: true };
          b.pos.x = p.x; b.pos.z = p.z;
        }
        if (g.authority && !b.padUntil || g.authority && g.time > b.padUntil) {
          b.padUntil = g.time + PAD_AIR + 0.2;
          b.padLand = g.time + PAD_AIR;
          if (b.netDriven && b.guard) { b.guard.knock = Math.max(b.guard.knock, p.dist + 2); b.guard.airUntil = g.time + PAD_AIR + 0.3; }
        }
        if (mine || g.fxVisible(b)) { sfx('jumppad', g.volumeAt(p.x, p.z)); g.effects.ring(p.x, p.z, 1.2, new THREE.Color(0.6, 2.4, 3.4), 0.4); }
      }
    }
    if (!g.authority) return;
    for (const b of g.brawlers) { // the landing
      if (!b.padLand || g.time < b.padLand) continue;
      b.padLand = 0;
      if (!b.alive) continue;
      const x = b.netDriven ? b.net.x : b.pos.x, z = b.netDriven ? b.net.y : b.pos.z;
      for (const o of g.brawlers) if (g.hits(b, o) && Math.hypot(o.pos.x - x, o.pos.z - z) < 2) g.damage(o, PAD_HIT, b);
      g.ev({ e: 'kit', k: 'land', x: r2(x), z: r2(z) });
      this.landFx(x, z);
    }
  }
  landFx(x, z) {
    const g = this.g;
    g.effects.ring(x, z, 2, new THREE.Color(1.6, 1.4, 1), 0.4);
    g.effects.dust(x, z, 10, 0xd8c8a8, 1.4);
    g.shakeAt(x, z, 0.2);
  }

  checkShrooms() {
    const g = this.g, A = this.A;
    for (const s of this.shrooms) {
      if (!s.ready) {
        if (g.authority && g.time >= s.at) { s.ready = true; g.ev({ e: 'kit', k: 'shroom', i: s.i, j: s.j, on: 1 }); this.shroomFx(s, true); }
        continue;
      }
      if (!g.authority) continue;
      const c = A.center(s.i, s.j, _v);
      const b = g.brawlers.find(o => o.alive && o.hp < o.maxHp && Math.hypot(o.pos.x - c.x, o.pos.z - c.z) < 1);
      if (!b) continue;
      s.ready = false; s.at = g.time + SHROOM_REGROW;
      b.shroom = { left: SHROOM_HEAL, rate: SHROOM_HEAL / SHROOM_TIME };
      g.ev({ e: 'kit', k: 'shroom', i: s.i, j: s.j, on: 0 });
      this.shroomFx(s, false);
    }
    if (g.authority) for (const b of g.brawlers) {
      if (!b.shroom) continue;
      if (!b.alive) { b.shroom = null; continue; }
      const a = Math.min(b.shroom.left, b.shroom.rate * this.dt);
      b.shroom.left -= a;
      g.heal(b, a);
      if (b.shroom.left <= 0) b.shroom = null;
    }
  }
  shroomFx(s, on) {
    const g = this.g, c = this.A.center(s.i, s.j, new THREE.Vector3());
    s.ready = on;
    if (s.mesh) s.mesh.visible = on;
    if (!on) { g.effects.sparkBurst(c.x, 1, c.z, new THREE.Color(0.8, 3, 1.4), 16, 4, 0.5); sfx('mushroom', g.volumeAt(c.x, c.z)); }
    else g.effects.ring(c.x, c.z, 0.9, new THREE.Color(0.8, 3, 1.4), 0.4);
  }

  // Explosions and supers crack the bridges around (authority).
  damageArea(x, z, r, dmg) {
    if (!this.bridges.size || !this.g.authority) return;
    const A = this.A;
    for (const b of [...this.bridges.values()]) {
      const c = A.center(b.i, b.j, _v);
      if (Math.hypot(c.x - x, c.z - z) > r + 1) continue;
      b.hp -= dmg;
      if (b.hp <= 0) { this.g.ev({ e: 'kit', k: 'bridge', i: b.i, j: b.j }); this.breakBridge(b.i, b.j); }
    }
  }
  breakBridge(i, j) {
    const A = this.A, b = this.bridges.get(A.key(i, j));
    if (!b) return;
    this.bridges.delete(A.key(i, j));
    this.bridgeMesh.setMatrixAt(b.idx, ZERO);
    this.bridgeMesh.instanceMatrix.needsUpdate = true;
    A.grid[j][i] = 'V';
    A.rev++;
    const c = A.center(i, j, new THREE.Vector3());
    this.chunk(c.x, c.z, 0x9c6a3c, 0.25);
    this.g.effects.debrisBurst(c.x, 0.1, c.z, new THREE.Color(0x9c6a3c), 10, 0.3, 5);
    sfx('break', this.g.volumeAt(c.x, c.z));
  }

  // A barrel went off (game.js damageCrate): hurts everyone around, pushes hard, sets off the next.
  barrelBoom(i, j, by) {
    const g = this.g, A = this.A, c = A.center(i, j, new THREE.Vector3());
    this.barrelFx(c.x, c.z);
    if (!g.authority) return;
    for (const o of g.brawlers) {
      if (!g.hittable(o)) continue;
      const dx = o.pos.x - c.x, dz = o.pos.z - c.z, d = Math.hypot(dx, dz);
      if (d > BARREL_R + o.radius * 0.5) continue;
      g.damage(o, BARREL_DMG, by && by !== o ? by : null);
      if (o.alive) g.applyKnock(o, (dx || 0.5) / (d || 1) * BARREL_KNOCK, dz / (d || 1) * BARREL_KNOCK, by);
    }
    this.damageArea(c.x, c.z, BARREL_R, BARREL_DMG);
    for (const cr of [...A.crates.values()]) {
      const p = cr.group.position;
      if (Math.hypot(p.x - c.x, p.z - c.z) < BARREL_R + 0.6) g.later.push([g.time + (cr.barrel ? 0.15 : 0), () => g.damageCrate(cr.i, cr.j, cr.barrel ? 1e9 : 900, by)]);
    }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (A.get(i + di, j + dj) === '#') g.breakWall(i + di, j + dj);
  }
  barrelFx(x, z) {
    const g = this.g;
    g.effects.explosion(x, z, BARREL_R, true, false);
    g.shakeAt(x, z, 0.7);
    sfx('barrel_boom', g.volumeAt(x, z));
  }

  // Crumbling islands (authority schedules, everyone draws).
  checkCrumble() {
    const g = this.g, S = this.plan[this.step];
    if (!S || !g.authority || g.ended) return;
    if (!S.warned && g.time >= S.at - DOOM_WARN) {
      S.warned = true;
      const tiles = S.tiles.filter(([i, j]) => this.A.get(i, j) !== 'V');
      g.ev({ e: 'kit', k: 'doom', t: tiles });
      this.doom(tiles);
    }
    if (g.time >= S.at) {
      this.step++;
      const tiles = S.tiles.filter(([i, j]) => this.A.get(i, j) !== 'V');
      g.ev({ e: 'kit', k: 'crumble', t: tiles });
      this.crumble(tiles);
    }
  }
  doom(tiles) {
    for (const [i, j] of tiles) this.doomed.add(this.A.key(i, j));
    this.drawCracks();
    const g = this.g;
    if (g.player && tiles.length) {
      sfx('crumble_warn');
      g.hud.showBanner?.(t('hud.islandFalls'), 'three');
    }
  }
  drawCracks() {
    const A = this.A;
    let k = 0;
    for (const key of this.doomed) {
      const i = key % N, j = Math.floor(key / N);
      A.center(i, j, _v);
      _m.makeTranslation(_v.x, 0.06, _v.z);
      this.cracks.setMatrixAt(k++, _m);
    }
    this.cracks.count = k;
    this.cracks.instanceMatrix.needsUpdate = true;
  }
  doomedAt(x, z) { return this.doomed.has(this.A.key(this.A.toTile(x), this.A.toTile(z))); }
  // The closest open tile that is not about to fall (bots running from a crumbling island).
  safeSpot(b) {
    const A = this.A;
    let best = null, bd = Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (!A.walkable(i, j) || this.doomed.has(A.key(i, j))) continue;
      const c = A.center(i, j, _v), d = Math.hypot(c.x - b.pos.x, c.z - b.pos.z) + Math.hypot(c.x, c.z) * 0.3;
      if (d < bd) { bd = d; best = c.clone(); }
    }
    return best;
  }

  crumble(tiles) {
    const A = this.A, g = this.g;
    for (const [i, j] of tiles) {
      const key = A.key(i, j), ch = A.get(i, j);
      this.doomed.delete(key);
      if (ch === 'V') continue;
      if (ch === '=') { this.breakBridge(i, j); continue; }
      if (ch === '#') A.destroyWall(i, j);
      const cr = A.crateAt(i, j);
      if (cr) { A.group.remove(cr.group); A.crates.delete(key); }
      A.hideBush?.(i, j);
      for (const p of this.pads) if (p.i === i && p.j === j && p.disc) p.disc.parent.visible = false;
      for (const s of this.shrooms) if (s.i === i && s.j === j) { s.ready = false; s.at = Infinity; if (s.mesh) s.mesh.visible = false; }
      this.pads = this.pads.filter(p => !(p.i === i && p.j === j));
      A.grid[j][i] = 'V';
      if (this.rock && this.rockIdx.has(key)) { this.rock.setMatrixAt(this.rockIdx.get(key), ZERO); this.rock.instanceMatrix.needsUpdate = true; }
      A.center(i, j, _v);
      if (Math.random() < 0.5) this.chunk(_v.x, _v.z, 0x7fbf5a, 1);
    }
    A.rev++;
    A.rebuildGround?.();
    this.drawCracks();
    if (tiles.length) { g.shakeAt(g.camFocus.x, g.camFocus.z, 0.5); sfx('crumble', 0.9); }
  }

  // A falling slab of ground (cosmetic).
  chunk(x, z, color, h) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, h, 1.9), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.position.set(x, -h / 2, z);
    this.group.add(m);
    this.falling.push({ m, vy: 0, rx: (Math.random() - 0.5) * 2, rz: (Math.random() - 0.5) * 2, t: 2.2 });
  }

  onEvent(e) {
    switch (e.k) {
      case 'land': this.landFx(e.x, e.z); break;
      case 'shroom': { const s = this.shrooms.find(o => o.i === e.i && o.j === e.j); if (s) this.shroomFx(s, !!e.on); break; }
      case 'bridge': this.breakBridge(e.i, e.j); break;
      case 'doom': if (Array.isArray(e.t)) this.doom(e.t); break;
      case 'crumble': if (Array.isArray(e.t)) this.crumble(e.t); break;
    }
  }

  update(dt) {
    const g = this.g;
    this.dt = dt;
    if (g.state === 'playing' || g.state === 'over') {
      this.checkPads();
      this.checkShrooms();
      if (g.authority) { this.checkCrumble(); this.checkFalls(); }
    }
    // cosmetics
    if (this.sails) this.sails.rotation.z += dt * 0.6;
    if (this.padMat) this.padMat.emissiveIntensity = 0.6 + 0.5 * Math.sin(g.time * 5);
    if (this.clouds) this.clouds.offset.x += dt * 0.004;
    if (this.cracks.count) this.cracks.material.opacity = 0.25 + 0.3 * (Math.sin(g.time * 12) > 0 ? 1 : 0);
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const F = this.falling[k];
      F.vy += 18 * dt; F.m.position.y -= F.vy * dt; F.m.rotation.x += F.rx * dt; F.m.rotation.z += F.rz * dt;
      if ((F.t -= dt) <= 0) { this.group.remove(F.m); F.m.geometry.dispose(); F.m.material.dispose(); this.falling.splice(k, 1); }
    }
  }
}
