import * as THREE from 'three';
import { N, TILE } from './arena.js';
import { sfx } from './audio.js';
import { t } from './i18n/index.js';
import { hasProp, propGeometry, propMaterial } from './props.js';

// Interactive arena kit (v0.15 WILD ISLES, docs/brainstorm/iter3_kenji.md §2c). Tiles of maps.js:
//   V  void: nothing to stand on. Walking stops at the edge, but a brawler knocked onto it falls: a
//      ring-out K.O., credited to whoever pushed it in the last 3 s.
//   =  wooden bridge: walkable, 1200 HP against explosions, then it falls and becomes void.
//   J  jump pad: launches you to the next ground toward the middle (7 m or more), 0.8 s in the air
//      (no attacks up there); the landing hits enemies around for 150.
//   E  explosive barrel: 600 HP, then 900 in 2.5 m with a big push, and the next barrels go too.
//   H  healing mushroom: +1200 health over 2 s, grows back in 20 s.
//   M  the windmill (a square landmark, 3 x 3 in the middle of Windmill Isles): blocks feet, bullets and sight.
// Maps with `crumble` (Windmill Isles) have no gas: the outer islands break off one after the
// other, then the middle island shrinks, each time after a 5 s telegraph.
// Rules run on the authority (solo, host, server); clients get 'kit' events and draw the same.

const PUSH_CREDIT = 3;        // s: a fall counts as the last pusher's K.O.
const PAD_MIN = 7, PAD_MAX = 14, PAD_AIR = 0.8, PAD_HIT = 150;
const BARREL_R = 2.5, BARREL_DMG = 900, BARREL_KNOCK = 9;
const SHROOM_HEAL = 1200, SHROOM_TIME = 2, SHROOM_REGROW = 20;
const BRIDGE_HP = 1200;
const DOOM_WARN = 5;
// the sculpted windmill: footprint share of its 'M' square, sails span (x the tower's width), the
// hub's height (x the tower's height) and how far out front (x the tower's half depth)
const WINDMILL = { width: 0.82, sails: 1.4, hubY: 0.68, hubZ: 0.95 };
const r2 = v => Math.round(v * 100) / 100;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _r = new THREE.Matrix4(), _w = new THREE.Matrix4();

export class MapKit {
  constructor(game) {
    this.g = game;
    const A = this.A = game.arena;
    this.map = A.map;
    this.group = new THREE.Group();
    A.group.add(this.group); // disposed with the arena
    this.pads = []; this.shrooms = []; this.bridges = new Map(); this.falling = []; this.doomed = new Set();
    this.lifted = []; // doomed islands lifted out of the floor: they shake, then drop in one piece
    this.traps = []; this.puffs = []; // Pip & Chomp's Venus Traps and spore clouds (v0.15)
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
  // (the poison timer: the match clock the host keeps in sync on every client)
  get nextIn() { const s = this.plan[this.step]; return s ? s.at - this.g.poison.timer : Infinity; }

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

  // Land tiles grouped into islands (bridges and void apart). The outer islands fall in two waves,
  // the small ones first (40 s, 60 s), the bridges at 80 s, then the middle island shrinks a round
  // ring every 10 s down to the ground right around the windmill.
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
    const outer = islands.filter(s => s.tiles.length > 2).sort((a, b) => a.tiles.length - b.tiles.length || a.ang - b.ang);
    const plan = [];
    // the smaller half first, then the bigger half (same-sized islands fall together)
    const waves = [[], []], cut = outer.length ? outer[Math.floor((outer.length - 1) / 2)].tiles.length : 0;
    outer.forEach(s => waves[s.tiles.length <= cut ? 0 : 1].push(...s.tiles));
    if (!waves[1].length) { // all the same size: opposite islands together, by angle
      waves[0] = [];
      [...outer].sort((a, b) => a.ang - b.ang).forEach((s, k) => waves[k % 2].push(...s.tiles));
    }
    [40, 60].forEach((at, k) => { if (waves[k].length) plan.push({ at, tiles: waves[k] }); });
    const bridges = [...this.bridges.values()].map(b => [b.i, b.j]);
    if (bridges.length) plan.push({ at: 80, tiles: bridges });
    if (middle) {
      const ci = (N - 1) / 2, far = ([a, b]) => Math.hypot(a - ci, b - ci);
      const maxR = Math.max(...middle.tiles.map(far));
      for (let r = maxR, at = 95; r > 2.9; r--, at += 10) { // a last ring of ground around a 3 x 3 windmill
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
    // sky maps: rock under every island tile, then clouds, birds and far islets below (buildSky)
    if (this.map.sky) {
      const land = [];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const ch = A.get(i, j); if (ch !== 'V' && ch !== '=') land.push([i, j]); }
      const geo = new THREE.CylinderGeometry(1.3, 0.7, 4.2, 6, 1).translate(0, -2.14, 0); // 1.3: the 1-tile rifts stay open; just under the grass (no z-fighting)
      this.rock = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), land.length);
      this.rockIdx = new Map();
      const col = new THREE.Color();
      land.forEach(([i, j], k) => {
        A.center(i, j, _v);
        _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (i * 7 + j * 13) % 6);
        _m.compose(_v.setY(0), _q, _s.set(1, 0.7 + ((i * 31 + j * 17) % 10) / 16, 1));
        this.rock.setMatrixAt(k, _m);
        this.rock.setColorAt(k, col.setHSL(0.07 + ((i * 5 + j * 3) % 4) * 0.01, 0.3, 0.36 + ((i * 11 + j * 7) % 5) * 0.025));
        this.rockIdx.set(A.key(i, j), k);
      });
      G.add(this.rock);
      this.buildSky();
    }
    // the windmill: a stone tower, a red roof and turning sails, facing south (the camera). The
    // sculpted one (art-src/ai3d: windmill + windmill_sails) fills the square of 'M'; the procedural
    // fallback is built for a 2 x 2 block and scaled to it.
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      if (A.get(i, j) !== 'M' || A.get(i - 1, j) === 'M' || A.get(i, j - 1) === 'M') continue;
      let n = 1;
      while (A.get(i + n, j) === 'M') n++;
      const c = A.center(i, j, new THREE.Vector3()).add(new THREE.Vector3(TILE * (n - 1) / 2, 0, TILE * (n - 1) / 2)), g = new THREE.Group();
      if (hasProp('windmill') && hasProp('windmill_sails')) {
        const W = n * TILE * WINDMILL.width, tg = propGeometry('windmill', { width: W });
        tg.computeBoundingBox();
        const H = tg.boundingBox.max.y, D = tg.boundingBox.max.z;
        const sg = propGeometry('windmill_sails', { width: W * WINDMILL.sails }).center();
        const tower = new THREE.Mesh(tg, propMaterial('windmill')), hub = new THREE.Group(), sails = new THREE.Mesh(sg, propMaterial('windmill_sails'));
        hub.position.set(0, H * WINDMILL.hubY, D * WINDMILL.hubZ);
        hub.add(sails);
        g.add(tower, hub);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.position.copy(c);
        G.add(g);
        this.sails = hub;
        continue;
      }
      g.scale.setScalar(n / 2 * 0.9);
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
  }

  // Below the islands: a sea of clouds far down, puffy clouds drifting at every depth, gull flocks
  // circling and a ring of little far islets bobbing (cosmetic, all kept under the play level).
  buildSky() {
    const G = this.group, R = Math.random, TAU = Math.PI * 2;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    if (x) {
      x.fillStyle = '#86c6f5'; x.fillRect(0, 0, 256, 256);
      // soft clouds, drawn 9 times around so the texture tiles without a seam
      for (let k = 0; k < 34; k++) {
        const cx = R() * 256, cy = R() * 256, r = 10 + R() * 30, a = 0.25 + R() * 0.35;
        for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
          const gr = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
          gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = gr; x.beginPath(); x.arc(cx + ox, cy + oy, r, 0, 7); x.fill();
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(4, 4);
      tex.userData.perMatch = true;
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
      sea.position.y = -30;
      G.add(sea);
      this.clouds = tex;
    }

    // puffy clouds: a few spheres each, one instanced mesh; some deep below, some around the rim
    const puffs = [];
    this.cloudList = [];
    for (let k = 0; k < 22; k++) {
      const rim = k >= 14, a = R() * TAU, d = rim ? 36 + R() * 14 : 6 + R() * 44, sz = rim ? 1.3 + R() * 0.9 : 0.9 + R() * 1.2;
      const C = { x: Math.cos(a) * d, y: rim ? -9 - R() * 5 : -8 - R() * 14, z: Math.sin(a) * d, v: 0.4 + R() * 0.6, p: [] };
      const n = 4 + Math.floor(R() * 4);
      for (let q = 0; q < n; q++) {
        const f = 1 - Math.abs(q - (n - 1) / 2) / n; // the middle puffs are the biggest
        C.p.push([(q - (n - 1) / 2) * 1.5 * sz + (R() - 0.5) * sz, (R() - 0.3) * 0.7 * sz, (R() - 0.5) * 1.6 * sz, (1.1 + R() * 0.8) * sz * (0.55 + f * 0.6), puffs.length]);
        puffs.push(0);
      }
      this.cloudList.push(C);
    }
    this.cloudMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xc4d8f0, emissiveIntensity: 0.55, roughness: 1, flatShading: true }), puffs.length);
    this.cloudMesh.frustumCulled = false; // drifts out of the bounding sphere it had at first
    G.add(this.cloudMesh);
    this.placeClouds(0);

    // gulls: flocks in a loose V circling under the islands, flapping then gliding
    const body = new THREE.ConeGeometry(0.13, 0.62, 5).rotateX(Math.PI / 2);
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.16, 0, 0, -0.14, 0.95, 0, -0.18, 0, 0, 0.16, 0.95, 0, -0.18, 0.62, 0, 0.04], 3));
    wing.computeVertexNormals();
    const gull = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, emissive: 0x8a929c, roughness: 0.8, side: THREE.DoubleSide, flatShading: true }); // lit from below too
    this.birds = [];
    for (let f = 0; f < 4; f++) {
      const F = { r: 14 + R() * 26, y: -3.5 - R() * 6, w: (0.12 + R() * 0.08) * (f % 2 ? 1 : -1), a: R() * TAU };
      const n = 3 + Math.floor(R() * 4);
      for (let k = 0; k < n; k++) {
        const side = k % 2 ? 1 : -1, row = Math.ceil(k / 2) * 1.8;
        this.birds.push({ F, ox: side * row * 0.9, oz: -row * 0.8 + (R() - 0.5) * 0.3, oy: (R() - 0.5) * 0.4, ph: R() * TAU, s: 1.2 + R() * 0.4 });
      }
    }
    const nb = this.birds.length;
    this.birdBody = new THREE.InstancedMesh(body, gull, nb);
    this.birdWingL = new THREE.InstancedMesh(wing, gull, nb);
    this.birdWingR = new THREE.InstancedMesh(wing, gull, nb);
    for (const M of [this.birdBody, this.birdWingL, this.birdWingR]) M.frustumCulled = false; // they fly around
    G.add(this.birdBody, this.birdWingL, this.birdWingR);

    // far islets: a grassy top on an upside-down rock, a round tree or a tiny windmill
    const rock = new THREE.ConeGeometry(1, 1, 7).rotateX(Math.PI).translate(0, -0.5, 0);
    const top = new THREE.CylinderGeometry(1, 0.94, 0.3, 7).translate(0, 0.15, 0);
    const trunk = new THREE.CylinderGeometry(0.12, 0.16, 0.9, 6).translate(0, 0.75, 0), crown = new THREE.IcosahedronGeometry(0.6, 1);
    const mat = {
      rock: new THREE.MeshStandardMaterial({ color: 0x8a6a4e, roughness: 0.95, flatShading: true }),
      grass: new THREE.MeshStandardMaterial({ color: 0x8fcf63, roughness: 0.9, flatShading: true }),
      wood: new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.85 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x5fae4a, roughness: 0.85, flatShading: true }),
      stone: new THREE.MeshStandardMaterial({ color: 0xece2cf, roughness: 0.85 }),
      roof: new THREE.MeshStandardMaterial({ color: 0xc8453a, roughness: 0.7 }),
    };
    this.islets = [];
    const count = 9, a0 = R() * TAU;
    for (let k = 0; k < count; k++) {
      const a = a0 + k / count * TAU + (R() - 0.5) * 0.4, d = 33 + R() * 12, sz = 1.4 + R() * 1.6, g = new THREE.Group();
      const rk = new THREE.Mesh(rock, mat.rock); rk.scale.set(sz, sz * (1.6 + R()), sz);
      const gr = new THREE.Mesh(top, mat.grass); gr.scale.set(sz, 1, sz);
      g.add(rk, gr);
      if (k % 3 === 0) { // a tiny windmill, sails turning
        const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.3, 8).translate(0, 0.95, 0), mat.stone);
        const rf = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.45, 8).translate(0, 1.82, 0), mat.roof);
        const hub = new THREE.Group(); hub.position.set(0, 1.35, 0.4);
        for (let q = 0; q < 4; q++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.03).translate(0, 0.45, 0), mat.stone); sp.rotation.z = q * Math.PI / 2; hub.add(sp); }
        g.add(tw, rf, hub);
        g.userData.hub = hub;
      } else for (let q = 0; q < 1 + (k % 2); q++) {
        const t = new THREE.Group(), cr = new THREE.Mesh(crown, mat.leaf);
        cr.position.y = 1.35; cr.scale.setScalar(0.8 + R() * 0.5);
        t.add(new THREE.Mesh(trunk, mat.wood), cr);
        t.position.set((R() - 0.5) * sz * 0.9, 0, (R() - 0.5) * sz * 0.9);
        g.add(t);
      }
      g.position.set(Math.cos(a) * d, -5 - R() * 7, Math.sin(a) * d);
      g.rotation.y = -a + Math.PI / 2; // the windmills face the middle
      G.add(g);
      this.islets.push({ g, y: g.position.y, ph: R() * TAU });
    }

    // the cracks drawn over a doomed island (world UVs of the floor, 4 x 4 tiles per texture)
    const cc = document.createElement('canvas');
    cc.width = cc.height = 256;
    const y = cc.getContext('2d');
    if (y) {
      y.strokeStyle = 'rgba(62,38,22,1)'; y.lineCap = 'round';
      const crack = (px, py, ang, len, w) => {
        for (let k = 0; k < len; k++) {
          const nx = px + Math.cos(ang) * 7, ny = py + Math.sin(ang) * 7;
          y.lineWidth = w; y.beginPath(); y.moveTo(px, py); y.lineTo(nx, ny); y.stroke();
          px = nx; py = ny; ang += (R() - 0.5) * 0.9; w = Math.max(0.8, w * 0.93);
          if (R() < 0.12 && w > 1.4) crack(px, py, ang + (R() < 0.5 ? 1 : -1) * (0.6 + R() * 0.6), len - k - 2, w * 0.7);
        }
      };
      for (let k = 0; k < 9; k++) crack(R() * 256, R() * 256, R() * TAU, 14 + R() * 16, 3.2);
      const tex = new THREE.CanvasTexture(cc);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(N / 4, N / 4);
      tex.userData.perMatch = true;
      this.crackTex = tex;
    }
    this.pebble = new THREE.DodecahedronGeometry(0.28);
    this.pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4e, roughness: 0.95, flatShading: true });
  }

  placeClouds(dt) {
    const M = this.cloudMesh;
    for (const C of this.cloudList) {
      C.x += C.v * dt;
      if (C.x > 70) C.x -= 140;
      for (const [dx, dy, dz, r, k] of C.p) {
        _m.compose(_v.set(C.x + dx, C.y + dy, C.z + dz), _q.identity(), _s.set(r, r * 0.72, r));
        M.setMatrixAt(k, _m);
      }
    }
    M.instanceMatrix.needsUpdate = true;
  }

  flyBirds(t) {
    const B = this.birds;
    B.forEach((b, k) => {
      const F = b.F, a = F.a + F.w * t, dir = Math.sign(F.w);
      // along the circle: heading is the tangent
      const hx = -Math.sin(a) * dir, hz = Math.cos(a) * dir, yaw = Math.atan2(hx, hz);
      const px = Math.cos(a) * F.r + Math.cos(yaw) * b.ox + hx * b.oz, pz = Math.sin(a) * F.r - Math.sin(yaw) * b.ox + hz * b.oz;
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      _m.compose(_v.set(px, F.y + b.oy + Math.sin(t * 0.8 + b.ph) * 0.3, pz), _q, _s.setScalar(b.s));
      this.birdBody.setMatrixAt(k, _m);
      const cyc = (t * 0.35 + b.ph) % 2, flap = cyc < 1.2 ? Math.sin(t * 11 + b.ph) * 0.65 : 0.12; // flap, then glide
      _r.makeRotationZ(flap);
      this.birdWingR.setMatrixAt(k, _w.multiplyMatrices(_m, _r));
      _r.makeRotationZ(-flap).multiply(_w.makeScale(-1, 1, 1));
      this.birdWingL.setMatrixAt(k, _w.multiplyMatrices(_m, _r));
    });
    this.birdBody.instanceMatrix.needsUpdate = this.birdWingL.instanceMatrix.needsUpdate = this.birdWingR.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------ rules ------------------------------ */

  // Knocked onto the void? (authority) Anyone in the air flies over it; a fall is a K.O.
  checkFalls() {
    const g = this.g, A = this.A;
    for (const b of g.brawlers) {
      if (!b.alive || b.pos.y > 0.05 || (b.dash && b.dash.air)) continue;
      if (b.netDriven && b.guard && g.time < (b.guard.airUntil || 0)) continue; // a remote player in the air (pad, Pound, hop)
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
      g.ev({ e: 'kit', k: 'land', id: b.id, x: r2(x), z: r2(z) });
      if (g.fxVisible(b)) this.landFx(x, z); // a landing in a bush shows nothing
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
      g.ev({ e: 'kit', k: 'shroom', i: s.i, j: s.j, on: 0, id: b.id });
      this.shroomFx(s, false, g.fxVisible(b));
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
  shroomFx(s, on, seen = true) {
    const g = this.g, c = this.A.center(s.i, s.j, new THREE.Vector3());
    s.ready = on;
    if (s.mesh) s.mesh.visible = on;
    if (!on && seen) { g.effects.sparkBurst(c.x, 1, c.z, new THREE.Color(0.8, 3, 1.4), 16, 4, 0.5); sfx('mushroom', g.volumeAt(c.x, c.z)); }
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
      if (this.step >= this.plan.length) { // the last ground left: now the gas closes in, fast (poison.js)
        const P = g.poison;
        P.startAt = P.timer + 6; P.interval = 4; P.maxLevel = 12; // right to the middle: the windmill hides no one forever
        g.ev({ e: 'kit', k: 'gas', at: r2(P.startAt) });
      }
      const tiles = S.tiles.filter(([i, j]) => this.A.get(i, j) !== 'V');
      g.ev({ e: 'kit', k: 'crumble', t: tiles });
      this.crumble(tiles);
    }
  }
  doom(tiles) {
    for (const [i, j] of tiles) this.doomed.add(this.A.key(i, j));
    this.lift(tiles);
    const g = this.g;
    if (g.player && tiles.length) {
      sfx('crumble_warn');
      g.hud.showBanner?.(t('hud.islandFalls'), 'three');
    }
  }
  // A doomed island leaves the floor mesh for its own (ground, rock, cracks): it shakes harder and
  // harder for the 5 s telegraph, sheds pebbles and dust, then drops in one piece (crumble).
  lift(tiles) {
    const A = this.A;
    if (!A.groundMesh || !this.rock) return;
    const left = new Set(tiles.filter(([i, j]) => !'V='.includes(A.get(i, j))).map(([i, j]) => A.key(i, j)));
    while (left.size) { // one piece per connected island, so each one tips around its own middle
      const first = left.values().next().value, keys = new Set([first]), stack = [first];
      left.delete(first);
      while (stack.length) {
        const k = stack.pop(), i = k % N, j = Math.floor(k / N);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = A.key(i + di, j + dj);
          if (left.has(n)) { left.delete(n); keys.add(n); stack.push(n); }
        }
      }
      let cx = 0, cz = 0;
      for (const k of keys) { A.center(k % N, Math.floor(k / N), _v); cx += _v.x / keys.size; cz += _v.z / keys.size; }
      const grp = new THREE.Group(), geo = A.groundGeometry((i, j) => keys.has(A.key(i, j))).translate(-cx, 0, -cz);
      const ground = new THREE.Mesh(geo, A.groundMesh.material);
      ground.receiveShadow = true;
      grp.add(ground);
      let cracks = null;
      if (this.crackTex) {
        cracks = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
        cracks.position.y = 0.01; // world UVs: the cracks stay put on the ground texture
        cracks.renderOrder = 1;
        grp.add(cracks);
      }
      const idx = [...keys].filter(k => this.rockIdx.has(k)).map(k => this.rockIdx.get(k));
      const rock = new THREE.InstancedMesh(this.rock.geometry, this.rock.material, idx.length), off = new THREE.Matrix4().makeTranslation(-cx, 0, -cz), col = new THREE.Color();
      idx.forEach((r, n) => {
        this.rock.getMatrixAt(r, _m); rock.setMatrixAt(n, _m.premultiply(off));
        this.rock.getColorAt(r, col); rock.setColorAt(n, col);
        this.rock.setMatrixAt(r, ZERO);
      });
      this.rock.instanceMatrix.needsUpdate = true;
      grp.add(rock);
      grp.position.set(cx, 0, cz);
      this.group.add(grp);
      this.lifted.push({ grp, keys, rock, cracks, cx, cz, t0: this.g.time, pebble: 0, fall: null });
    }
    this.rebuildFloor();
  }
  rebuildFloor() {
    const A = this.A, out = new Set();
    for (const L of this.lifted) if (!L.fall) for (const k of L.keys) out.add(k);
    A.rebuildGround(out.size ? (i, j) => !out.has(A.key(i, j)) : null);
  }
  updateLifted(dt) {
    const g = this.g;
    for (let n = this.lifted.length - 1; n >= 0; n--) {
      const L = this.lifted[n], G = L.grp;
      if (L.fall) { // dropping away, tipping over
        L.fall.vy += 16 * dt;
        G.position.y -= L.fall.vy * dt;
        G.rotation.x += L.fall.rx * dt; G.rotation.z += L.fall.rz * dt;
        if ((L.fall.t -= dt) <= 0) {
          this.group.remove(G);
          G.children[0].geometry.dispose();
          L.cracks?.material.dispose();
          L.rock.dispose();
          this.lifted.splice(n, 1);
        }
        continue;
      }
      if (g.ended || g.headless) continue; // the match is over / the server: nobody watches it shake
      const p = Math.min(1, (g.time - L.t0) / DOOM_WARN), amp = 0.02 + 0.13 * p * p;
      G.position.set(L.cx + (Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 0.6, L.cz + (Math.random() - 0.5) * amp * 2);
      G.rotation.set(Math.sin(g.time * 23) * amp * 0.05, 0, Math.cos(g.time * 19) * amp * 0.05);
      if (L.cracks) L.cracks.material.opacity = Math.min(0.85, 0.15 + p * 0.9);
      // pebbles off the underside, dust on top, more and more of them
      if ((L.pebble -= dt) <= 0) {
        L.pebble = 0.35 - p * 0.25;
        const keys = [...L.keys], k = keys[Math.floor(Math.random() * keys.length)];
        this.A.center(k % N, Math.floor(k / N), _v);
        const m = new THREE.Mesh(this.pebble, this.pebbleMat);
        m.position.set(_v.x + (Math.random() - 0.5) * 1.6, -0.6 - Math.random() * 2, _v.z + (Math.random() - 0.5) * 1.6);
        m.scale.setScalar(0.6 + Math.random() * 0.9);
        this.group.add(m);
        this.falling.push({ m, vy: 0, rx: (Math.random() - 0.5) * 6, rz: (Math.random() - 0.5) * 6, t: 1.6, shared: true });
        if (Math.random() < 0.5) g.effects.dust(_v.x, _v.z, 2 + Math.round(p * 3), 0xb89a74, 0.8);
      }
    }
    // standing on it: the ground rumbles under your feet
    const P = g.player;
    if (P && P.alive && this.doomedAt(P.pos.x, P.pos.z) && (this.rumble = (this.rumble || 0) - dt) <= 0) { this.rumble = 0.45; g.shakeAt(P.pos.x, P.pos.z, 0.1); }
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
      if (cr) { A.group.remove(cr.group); A.crates.delete(key); A.disposeCrate?.(cr); }
      A.hideBush?.(i, j);
      for (const T of this.traps.filter(T => T.i === i && T.j === j)) this.removeTrap(T);
      for (const p of this.pads) if (p.i === i && p.j === j && p.disc) p.disc.parent.visible = false;
      for (const s of this.shrooms) if (s.i === i && s.j === j) { s.ready = false; s.at = Infinity; if (s.mesh) s.mesh.visible = false; }
      this.pads = this.pads.filter(p => !(p.i === i && p.j === j));
      A.grid[j][i] = 'V';
      if (this.rock && this.rockIdx.has(key)) { this.rock.setMatrixAt(this.rockIdx.get(key), ZERO); this.rock.instanceMatrix.needsUpdate = true; }
      A.center(i, j, _v);
      if (!this.lifted.some(L => L.keys.has(key)) && Math.random() < 0.5) this.chunk(_v.x, _v.z, 0x7fbf5a, 1);
    }
    for (const L of this.lifted) if (!L.fall && tiles.some(([i, j]) => L.keys.has(A.key(i, j)))) {
      L.fall = { vy: 0, rx: (Math.random() - 0.5) * 0.5, rz: (Math.random() - 0.5) * 0.5, t: 3.2 };
      L.grp.rotation.set(0, 0, 0);
      L.grp.position.set(L.cx, 0, L.cz);
      if (L.cracks) L.cracks.material.opacity = 0.85;
      this.g.effects.dust(L.cx, L.cz, 14, 0xb89a74, Math.sqrt(L.keys.size) * 1.2);
    }
    A.rev++;
    this.rebuildFloor();
    for (let k = g.items.length - 1; k >= 0; k--) { // cubes on the fallen ground fall with it
      const it = g.items[k];
      if (A.charAt(it.tx, it.tz) === 'V') { g.fx.remove(it.mesh); g.items.splice(k, 1); }
    }
    if (tiles.length) { g.shakeAt(g.camFocus.x, g.camFocus.z, 0.5); sfx('crumble', 0.9); }
  }

  // A falling slab of ground (cosmetic).
  chunk(x, z, color, h) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, h, 1.9), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.position.set(x, -h / 2, z);
    this.group.add(m);
    this.falling.push({ m, vy: 0, rx: (Math.random() - 0.5) * 2, rz: (Math.random() - 0.5) * 2, t: 2.2 });
  }

  /* ---- Pip & Chomp ---- */

  // Venus Trap (authority): a bush on an open tile near the aim point (8 m at most), one per Pip,
  // for 30 s. It hides like any bush; the first enemy stepping in takes 800, is rooted 1 s and
  // shows for 3 s.
  plantTrap(b, point) {
    const g = this.g, A = this.A;
    let x = point.x, z = point.z;
    const d = Math.hypot(x - b.pos.x, z - b.pos.z);
    if (d > 8) { x = b.pos.x + (x - b.pos.x) / d * 8; z = b.pos.z + (z - b.pos.z) / d * 8; }
    let i = A.toTile(x), j = A.toTile(z);
    if (A.get(i, j) !== '.') {
      let best = null, bd = 9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (A.get(i + di, j + dj) === '.' && Math.abs(di) + Math.abs(dj) < bd) { bd = Math.abs(di) + Math.abs(dj); best = [i + di, j + dj]; }
      if (!best) return;
      [i, j] = best;
    }
    for (const T of this.traps.filter(T => T.owner === b)) this.removeTrap(T); // one each
    this.addTrap(b, i, j);
    g.ev({ e: 'kit', k: 'trap', id: b.id, i, j });
  }
  addTrap(b, i, j) {
    const A = this.A, c = A.center(i, j, new THREE.Vector3()), grp = new THREE.Group();
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3f9e44, roughness: 0.7 }), mouth = new THREE.MeshStandardMaterial({ color: 0xd6336c, roughness: 0.5 });
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2, m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), leaf);
      m.position.set(Math.cos(a) * 0.45, 0.45 + (k % 2) * 0.15, Math.sin(a) * 0.45); m.scale.set(1, 0.8, 1); grp.add(m);
    }
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mouth); jaw.position.y = 0.75; grp.add(jaw);
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    grp.position.copy(c); grp.scale.setScalar(0.01);
    this.group.add(grp);
    const was = A.grid[j][i];
    A.grid[j][i] = 'B'; // a bush: it hides whoever stands in it
    A.rev++;
    this.traps.push({ owner: b, i, j, x: c.x, z: c.z, until: this.g.time + 30, grp, was, grow: 0 });
    this.g.effects.dust(c.x, c.z, 8, 0x6a9a4a, 1);
  }
  removeTrap(T, snapped = false) {
    const A = this.A;
    this.traps.splice(this.traps.indexOf(T), 1);
    this.group.remove(T.grp);
    T.grp.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    if (A.grid[T.j][T.i] === 'B') { A.grid[T.j][T.i] = T.was === 'B' ? '.' : T.was; A.rev++; }
    for (const w of A.iceWalls || []) if (w.i === T.i && w.j === T.j && w.was === 'B') w.was = T.was === 'B' ? '.' : T.was; // iced over meanwhile
    if (snapped) {
      this.g.effects.ring(T.x, T.z, 1.2, new THREE.Color(3.2, 0.8, 1.6), 0.5);
      this.g.effects.sparkBurst(T.x, 1, T.z, new THREE.Color(0.6, 2.6, 0.6), 18, 5, 0.5, 0.14);
      sfx('trap_snap', this.g.volumeAt(T.x, T.z));
    }
  }
  checkTraps() {
    const g = this.g;
    for (const T of [...this.traps]) {
      T.grow = Math.min(1, T.grow + this.dt / 0.4);
      T.grp.scale.setScalar(Math.max(0.01, T.grow < 1 ? T.grow * 1.15 : 1));
      if (!g.authority) continue;
      if (g.time > T.until || !T.owner.alive && !g.duo) { g.ev({ e: 'kit', k: 'trapGo', i: T.i, j: T.j }); this.removeTrap(T); continue; }
      const o = g.brawlers.find(v => g.hits(T.owner, v) && v.pos.y < 0.3 && Math.hypot(v.pos.x - T.x, v.pos.z - T.z) < 0.95);
      if (!o) continue;
      g.damage(o, 800 * T.owner.dmgMul, T.owner);
      if (o.alive) {
        o.revealT = Math.max(o.revealT, 3);
        if (o.ccImmuneT > 0) g.ev({ e: 'imm', id: o.id }); else o.rootT = Math.max(o.rootT, 1);
      }
      g.ev({ e: 'kit', k: 'trapGo', i: T.i, j: T.j, snap: 1 });
      this.removeTrap(T, true);
    }
  }

  // Spore Puff: a 3 m cloud for 3 s that hides everyone inside like a bush (drawn everywhere from the
  // gadget's look event, so every machine agrees closely enough; the server's view is the one that counts).
  puff(x, z) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(3, 18, 12), new THREE.MeshStandardMaterial({ color: 0xb8a6d8, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false }));
    m.position.set(x, 0.4, z); m.scale.set(1, 0.45, 1);
    this.group.add(m);
    this.puffs.push({ x, z, r: 3, t: 3, m });
  }
  inPuff(x, z) { return this.puffs.length > 0 && this.puffs.some(P => Math.hypot(P.x - x, P.z - z) < P.r); }

  // Made here but only reachable while an island is doomed: the arena walk would miss them.
  dispose() {
    this.crackTex?.dispose();
    this.pebble?.dispose();
    this.pebbleMat?.dispose();
  }

  onEvent(e) {
    switch (e.k) {
      case 'trap': { const b = this.g.byId.get(e.id); if (b) { for (const T of this.traps.filter(T => T.owner === b)) this.removeTrap(T); this.addTrap(b, e.i, e.j); } break; }
      case 'trapGo': { const T = this.traps.find(T => T.i === e.i && T.j === e.j); if (T) this.removeTrap(T, !!e.snap); break; }
      case 'land': { const b = this.g.byId.get(e.id); if (!b || this.g.fxVisible(b)) this.landFx(e.x, e.z); break; }
      case 'shroom': { const s = this.shrooms.find(o => o.i === e.i && o.j === e.j), b = this.g.byId.get(e.id); if (s) this.shroomFx(s, !!e.on, !b || this.g.fxVisible(b)); break; }
      case 'bridge': this.breakBridge(e.i, e.j); break;
      case 'doom': if (Array.isArray(e.t)) this.doom(e.t); break;
      case 'crumble': if (Array.isArray(e.t)) { this.step++; this.crumble(e.t); } break;
      case 'gas': if (Number.isFinite(e.at)) { this.step = this.plan.length; Object.assign(this.g.poison, { startAt: e.at, interval: 4, maxLevel: 12 }); } break;
    }
  }

  update(dt) {
    const g = this.g;
    this.dt = dt;
    for (let k = this.puffs.length - 1; k >= 0; k--) {
      const P = this.puffs[k];
      P.t -= dt;
      P.m.material.opacity = 0.5 * Math.min(1, P.t / 0.5);
      if (P.t <= 0) { this.group.remove(P.m); P.m.geometry.dispose(); P.m.material.dispose(); this.puffs.splice(k, 1); }
    }
    if (g.state === 'playing' || g.state === 'over') {
      this.checkTraps();
      this.checkPads();
      this.checkShrooms();
      if (g.authority) { this.checkCrumble(); this.checkFalls(); }
    }
    // cosmetics
    if (this.sails) this.sails.rotation.z += dt * 0.6;
    if (this.padMat) this.padMat.emissiveIntensity = 0.6 + 0.5 * Math.sin(g.time * 5);
    if (this.clouds) this.clouds.offset.x += dt * 0.004;
    if (this.cloudMesh && !g.headless) this.placeClouds(dt);
    if (this.birds && !g.headless) this.flyBirds(performance.now() / 1000);
    if (this.islets && !g.headless) for (const I of this.islets) {
      I.g.position.y = I.y + Math.sin(g.time * 0.5 + I.ph) * 0.35;
      if (I.g.userData.hub) I.g.userData.hub.rotation.z += dt * 0.9;
    }
    this.updateLifted(dt);
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const F = this.falling[k];
      F.vy += 18 * dt; F.m.position.y -= F.vy * dt; F.m.rotation.x += F.rx * dt; F.m.rotation.z += F.rz * dt;
      if ((F.t -= dt) <= 0) { this.group.remove(F.m); if (!F.shared) { F.m.geometry.dispose(); F.m.material.dispose(); } this.falling.splice(k, 1); }
    }
  }
}
