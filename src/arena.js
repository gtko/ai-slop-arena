import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  foliageMaterials, groundTexture, grassTexture, mulberry, strataTexture, cartoonGround,
} from './materials.js';
import { Water, IceField } from './water.js';
import { bushGeometry, roundTree, pineTree, cactusGeometry, deadTree, obstacleGeometry, grassTuftGeometry, cliffGeometry } from './foliage.js';
import { MAPS } from './maps.js';
import { lanternKit, makeLantern, makeSculptedLantern, sculptedLanternMaterial } from './lantern.js';
import { tex, image } from './assets.js';
import { hasProp, propGeometry, propMaterial, propDepth, propMap } from './props.js';

// Sculpted prop (props.js) for each procedural style, when its model exists.
const WALL_PROP = { strata: 'wall_canyon', strataDark: 'wall_canyon', mossbrick: 'wall_moss', stone: 'wall_moss', icestone: 'wall_ice', brick: 'wall_canyon' };
const TREE_PROP = { round: 'tree_round', pine: 'tree_pine', dead: 'tree_dead', cactus: 'cactus', cliff: 'rock_canyon' };
const OBSTACLE_PROP = { cactus: 'cactus', stump: 'stump', boulder: 'boulder', rock: 'boulder' };
const snowy = (name, snow) => (snow && hasProp(name + '_snow') ? name + '_snow' : name);

const groundMaps = new Map(); // composed once per ground texture, reused by every match

export const TILE = 2;
export const N = 25;
export const HALF = (N * TILE) / 2;

// Layouts live in maps.js. 'K' = indestructible prop, 'I' = walkable ice.
const MOVE_BLOCK = new Set(['X', '#', 'W', 'C', 'T', 'K']);
const SHOT_BLOCK = new Set(['X', '#', 'C', 'T', 'K']);
export const WALL_H = 2.1;
export const BOUND_H = 2.7;

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function tintedBox(w, h, d, r, bottom = 0.62) {
  const g = new RoundedBoxGeometry(w, h, d, 3, r);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Baked vertical gradient (cheap fake bounce/AO at the base) + bright cap.
    let f = bottom + (1 - bottom) * (pos.getY(i) / h);
    if (nor.getY(i) > 0.7) f = 1.15;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Arena {
  constructor(scene, map = MAPS.oasis) {
    this.scene = scene;
    this.map = map;
    const QUARTER = map.layout;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rand = mulberry(1337);
    this.grid = [];
    this.spawns = [];
    for (let j = 0; j < N; j++) {
      const row = [];
      for (let i = 0; i < N; i++) {
        const q = QUARTER[Math.min(j, N - 1 - j)];
        let ch = (q && q[Math.min(i, N - 1 - i)]) || '.';
        if (ch === 'S') { this.spawns.push(this.center(i, j)); ch = '.'; }
        row.push(ch);
      }
      this.grid.push(row);
    }
    this.crates = new Map();
    this.torches = [];
    this.buildGround();
    this.buildWalls();
    this.buildBushes();
    this.water = new Water(this, N, TILE, HALF, map.water === 'swamp' ? 'swamp' : 'water');
    this.ice = new IceField(this, N, TILE);
    this.buildObstacles();
    if (map.wet) this.buildPuddles();
    if (map.stones) this.buildStones();
    this.buildCrates();
    this.buildTorches();
    this.buildDecor();
  }

  /* ------------------------------ queries ------------------------------ */

  center(i, j, out = new THREE.Vector3()) {
    return out.set((i - (N - 1) / 2) * TILE, 0, (j - (N - 1) / 2) * TILE);
  }
  toTile(x) { return Math.floor(x / TILE + N / 2); }
  get(i, j) { return (i < 0 || j < 0 || i >= N || j >= N) ? 'X' : this.grid[j][i]; }
  charAt(x, z) { return this.get(this.toTile(x), this.toTile(z)); }
  key(i, j) { return j * N + i; }
  ring(i, j) { return Math.min(i, j, N - 1 - i, N - 1 - j); }
  walkable(i, j) { return !MOVE_BLOCK.has(this.get(i, j)); }
  blocksMoveAt(x, z) { return MOVE_BLOCK.has(this.charAt(x, z)); }
  blocksShotAt(x, z) { return SHOT_BLOCK.has(this.charAt(x, z)); }
  blocksSight(i, j) { return SHOT_BLOCK.has(this.get(i, j)); } // walls, trees, crates, props: what stops a bullet stops the eye
  isBushAt(x, z) { return this.charAt(x, z) === 'B'; }
  isWaterAt(x, z) { return this.charAt(x, z) === 'W'; }
  isIceAt(x, z) { return this.charAt(x, z) === 'I'; }

  // pad: stop this far short of the target (e.g. when the target is a crate tile)
  los(ax, az, bx, bz, pad = 0) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), n = Math.ceil(d / 0.45);
    const end = d > 1e-4 ? Math.max(0, 1 - pad / d) : 1;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (t > end) break;
      if (SHOT_BLOCK.has(this.charAt(ax + dx * t, az + dz * t))) return false;
    }
    return true;
  }

  // Is a capsule of radius r free to travel a->b?
  walkLine(ax, az, bx, bz, r) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    const px = -dz / d * r, pz = dx / d * r, n = Math.ceil(d / 0.5);
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = ax + dx * t, z = az + dz * t;
      if (this.blocksMoveAt(x, z) || this.blocksMoveAt(x + px, z + pz) || this.blocksMoveAt(x - px, z - pz)) return false;
    }
    return true;
  }

  // Push a circle out of blocked tiles (rounded corners -> smooth sliding).
  collideCircle(p, r) {
    for (let it = 0; it < 2; it++) {
      const ci = this.toTile(p.x), cj = this.toTile(p.z);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if (!MOVE_BLOCK.has(this.get(i, j))) continue;
        const x0 = (i - N / 2) * TILE, z0 = (j - N / 2) * TILE;
        const cx = Math.max(x0, Math.min(p.x, x0 + TILE));
        const cz = Math.max(z0, Math.min(p.z, z0 + TILE));
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), k = (r - d) / d;
          p.x += dx * k; p.z += dz * k;
        } else { // centre inside the tile: leave via the nearest face
          const l = p.x - x0, rr = x0 + TILE - p.x, t = p.z - z0, b = z0 + TILE - p.z;
          const m = Math.min(l, rr, t, b);
          if (m === l) p.x = x0 - r; else if (m === rr) p.x = x0 + TILE + r;
          else if (m === t) p.z = z0 - r; else p.z = z0 + TILE + r;
        }
      }
    }
  }

  nearestWalkable(i, j) {
    for (let rad = 0; rad < 6; rad++) {
      for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        if (this.walkable(i + di, j + dj)) return [i + di, j + dj];
      }
    }
    return [i, j];
  }

  randomOpenTile(minRing = 1, rnd = Math.random) {
    for (let k = 0; k < 200; k++) {
      const i = Math.floor(rnd() * N), j = Math.floor(rnd() * N);
      if (this.ring(i, j) >= minRing && this.walkable(i, j)) return [i, j];
    }
    return [12, 11];
  }

  /* ------------------------------ building ----------------------------- */

  buildGround() {
    const M = this.map, key = M.ground + M.checker;
    const cartoon = M.ground === 'cartoon';
    if (!groundMaps.has(key)) groundMaps.set(key, cartoon ? cartoonGround(...(M.groundTones || [])) : groundTexture(image(M.ground) || image('sand'), M.checker));
    const map = groundMaps.get(key).clone();
    map.repeat.set(N / 2, N / 2);
    const groundN = cartoon ? null : tex(M.ground + '_n', N, N) || tex('sand_n', N, N); // one normal tile per arena tile
    // Wet maps: darker, glossier floor so lanterns, lightning and projectiles smear across it.
    const ground = new THREE.Mesh(
      this.groundGeometry(),
      new THREE.MeshStandardMaterial({
        map, normalMap: groundN, normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: M.wet ? 0.42 : 0.93, color: M.wet ? 0xb4b4b4 : 0xffffff, envMapIntensity: M.wet ? 1.6 : 1,
      }),
    );
    ground.receiveShadow = true;
    this.group.add(ground);

    // Grass ring around the arena (a full plane would cover the sunken water basins).
    // ShapeGeometry UVs are in world units, so the repeat is "tiles per unit".
    const shape = new THREE.Shape().moveTo(-130, -130).lineTo(130, -130).lineTo(130, 130).lineTo(-130, 130).closePath();
    shape.holes.push(new THREE.Path().moveTo(-HALF, -HALF).lineTo(-HALF, HALF).lineTo(HALF, HALF).lineTo(HALF, -HALF).closePath());
    const ringGeo = new THREE.ShapeGeometry(shape);
    ringGeo.rotateX(-Math.PI / 2);
    const k = 50 / 260;
    const oname = tex(M.outer, k, k) ? M.outer : 'grass';
    const gtex = tex(oname, k, k) || grassTexture();
    if (gtex.isCanvasTexture) gtex.repeat.set(60 / 260, 60 / 260);
    const outer = new THREE.Mesh(
      ringGeo,
      new THREE.MeshStandardMaterial({ map: gtex, normalMap: tex(oname + '_n', k, k), roughness: 1, color: M.outer === 'sand' ? 0xe0b98a : 0xffffff }),
    );
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    this.group.add(outer);
  }

  buildWalls() {
    let nw = 0, nb = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (this.grid[j][i] === '#') nw++;
      if (this.grid[j][i] === 'X') nb++;
    }
    // Box face groups: +x, -x, +y (cap), -y, +z, -z. Painted texture on the sides, plain cap on top.
    const sided = (name, rep, capColor) => {
      let map = tex(name, 1, rep), normalMap = tex(name + '_n', 1, rep);
      if (name.startsWith('strata')) { // cartoon canyon blocks: banded sides, bright flat top
        map = strataTexture(name === 'strataDark' ? '#9c4a36' : '#c95b3c');
        map.repeat.set(1, rep);
        normalMap = null;
      }
      const side = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.8, map, normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
      });
      const cap = map ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, color: capColor }) : side;
      return [side, side, cap, side, side, side];
    };
    const M = this.map;
    const pick = (n, fallback) => (n.startsWith('strata') || tex(n) ? n : fallback);
    const wallTex = pick(M.wall, 'brick'), boundTex = pick(M.bound, 'stone');
    this.textured = wallTex.startsWith('strata') || !!tex(wallTex);
    const wallProp = WALL_PROP[M.wall] && hasProp(WALL_PROP[M.wall]) ? WALL_PROP[M.wall] : null;
    const boundProp = WALL_PROP[M.bound] && hasProp(WALL_PROP[M.bound]) ? WALL_PROP[M.bound] : null;
    this.walls = wallProp
      ? new THREE.InstancedMesh(propGeometry(wallProp, { box: [1.98, WALL_H, 1.98] }), propMaterial(wallProp), nw)
      : new THREE.InstancedMesh(tintedBox(1.98, WALL_H, 1.98, 0.18), sided(wallTex, 0.55, M.wallCap), nw);
    this.bounds = boundProp
      ? new THREE.InstancedMesh(propGeometry(boundProp, { box: [1.99, BOUND_H, 1.99] }), propMaterial(boundProp), nb)
      : new THREE.InstancedMesh(tintedBox(1.99, BOUND_H, 1.99, 0.22, 0.5), sided(boundTex, 0.75, M.boundCap), nb);
    const [wh, ws, wl] = M.wallTint, [bh, bs, bl] = M.boundTint;
    this.wallIndex = new Map();
    this.wallColors = [];
    let a = 0, b = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ch = this.grid[j][i];
      if (ch !== '#' && ch !== 'X') continue;
      this.center(i, j, _v);
      _m.makeRotationY(Math.floor(this.rand() * 4) * Math.PI / 2).setPosition(_v.x, 0, _v.z);
      if (ch === '#') {
        if (wallProp) _c.setHSL(0, 0, 0.9 + this.rand() * 0.12);
        else if (this.textured) _c.setHSL(wh, ws, wl + this.rand() * 0.14); // tint the painted bricks lightly
        else _c.setHSL(0.065 + this.rand() * 0.02, 0.58, 0.5 + this.rand() * 0.07);
        this.walls.setMatrixAt(a, _m);
        this.walls.setColorAt(a, _c);
        this.wallColors[a] = this.textured ? new THREE.Color(M.debris) : _c.clone(); // debris colour
        this.wallIndex.set(this.key(i, j), a++);
      } else {
        if (boundProp) _c.setHSL(0, 0, 0.62 + this.rand() * 0.08); // the outer ring reads darker
        else if (this.textured) _c.setHSL(bh, bs, bl + this.rand() * 0.12);
        else _c.setHSL(0.68, 0.14, 0.34 + this.rand() * 0.05);
        this.bounds.setMatrixAt(b++, _m);
        this.bounds.setColorAt(b - 1, _c);
      }
    }
    for (const m of [this.walls, this.bounds]) {
      m.castShadow = m.receiveShadow = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
  }

  buildBushes() {
    const grass = this.map.bushStyle === 'grass';
    const sculpted = !grass && hasProp('bush'); // sculpted leaf ball, still swaying / dissolving like foliage
    const geo = grass ? grassTuftGeometry(3) : sculpted ? propGeometry('bush', { width: 1.95 }) : bushGeometry(7);
    const tiles = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (this.grid[j][i] === 'B') tiles.push([i, j]);
    const { mat, depth } = grass
      ? foliageMaterials({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, { leaves: false, upNormal: true })
      : sculpted
        ? foliageMaterials({ map: propMap('bush'), roughness: 0.75 }, { snow: !!this.map.snow, leaves: false })
        : foliageMaterials({ vertexColors: true, roughness: 0.72 }, { snow: !!this.map.snow });
    const [bh, bs, bl] = this.map.bush;
    const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
    mesh.customDepthMaterial = depth;
    tiles.forEach(([i, j], k) => {
      this.center(i, j, _v);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.rand() * Math.PI * 2);
      const sc = 1 + this.rand() * 0.12;
      _m.compose(_v, _q, _s.set(sc, sc * (0.92 + this.rand() * 0.16), sc));
      mesh.setMatrixAt(k, _m);
      mesh.setColorAt(k, sculpted ? _c.setHSL(0, 0, 0.88 + this.rand() * 0.14) : _c.setHSL(bh + this.rand() * 0.04, bs, bl + this.rand() * 0.2));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.bushes = mesh;
    this.group.add(mesh);
  }

  // Arena floor as one quad per dry tile, leaving holes where the water basins sink in.
  // UVs match the old single plane (v = 1 at -z) so the checker texture lines up.
  groundGeometry() {
    const pos = [], uv = [], idx = [], S = N * TILE;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (this.grid[j][i] === 'W' || this.grid[j][i] === 'I') continue;
      const x0 = (i - N / 2) * TILE, z0 = (j - N / 2) * TILE, o = pos.length / 3;
      for (const [x, z] of [[x0, z0 + TILE], [x0 + TILE, z0 + TILE], [x0 + TILE, z0], [x0, z0]]) {
        pos.push(x, 0, z);
        uv.push((x + HALF) / S, (HALF - z) / S);
      }
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  buildCrates() {
    const sculpted = hasProp('crate') ? propGeometry('crate', { width: 1.75 }) : null;
    const body = new RoundedBoxGeometry(1.7, 1.45, 1.7, 2, 0.12);
    body.translate(0, 0.725, 0);
    const band = new THREE.BoxGeometry(1.76, 0.16, 1.76);
    if (sculpted) sculpted.computeBoundingBox();
    const gem = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x5b3419, roughness: 0.7 });
    const gemMat = new THREE.MeshStandardMaterial({ color: 0x3dff7a, emissive: 0x22ff66, emissiveIntensity: 1.1, roughness: 0.3 });
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (this.grid[j][i] !== 'C') continue;
      const g = new THREE.Group();
      this.center(i, j, g.position);
      const map = tex('wood', 1, 1);
      const mat = sculpted ? propMaterial('crate').clone() : new THREE.MeshStandardMaterial({ // own copy: hit flash
        color: map ? 0xffffff : 0xc27c3e, roughness: 0.75, map, normalMap: tex('wood_n', 1, 1),
      });
      const add = (geo, m, y) => {
        const o = new THREE.Mesh(geo, m);
        o.position.y = y; o.castShadow = o.receiveShadow = true;
        g.add(o); return o;
      };
      if (sculpted) add(sculpted, mat, 0);
      else {
        add(body, mat, 0);
        add(band, bandMat, 0.32);
        add(band, bandMat, 1.12);
      }
      const top = sculpted ? sculpted.boundingBox?.max.y ?? 1.5 : 1.45;
      const gm = add(gem, gemMat, top + 0.1);
      gm.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      g.rotation.y = (this.rand() - 0.5) * 0.3;
      this.group.add(g);
      this.crates.set(this.key(i, j), { i, j, hp: 3200, maxHp: 3200, group: g, mat, gem: gm, shake: 0, flash: 0 });
    }
  }

  buildTorches() {
    const kit = this.lanternKit = lanternKit();
    this.halos = new THREE.Group(); // additive sprites, kept out of the AO pre-pass (see main.js)
    this.group.add(this.halos);
    // sculpted lantern: tall on its own tile, small on top of the outer walls
    const sculpted = hasProp('lantern');
    this.lampGlow = { value: 0 };
    const lampMat = sculpted ? sculptedLanternMaterial(propMaterial('lantern'), this.lampGlow) : null;
    const lampGeo = sculpted ? { tall: propGeometry('lantern', { height: 2.4 }), small: propGeometry('lantern', { height: 1.3 }) } : null;
    const place = (x, baseY, z, pedestal) => {
      const L = sculpted
        ? makeSculptedLantern(kit, pedestal ? lampGeo.tall : lampGeo.small, lampMat, pedestal ? 2.4 : 1.3)
        : makeLantern(kit, pedestal);
      L.group.position.set(x, baseY, z);
      L.group.rotation.y = this.rand() * Math.PI * 2;
      this.group.add(L.group);
      L.halo.position.x = x; L.halo.position.z = z; L.halo.position.y += baseY;
      this.halos.add(L.halo);
      this.torches.push({ x, y: baseY + L.lightY, z, flame: L.flame, core: L.core, halo: L.halo, ph: this.rand() * 10 });
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (this.grid[j][i] === 'T') { this.center(i, j, _v); place(_v.x, 0, _v.z, true); }
    }
    for (const k of [6, 12, 18]) for (const [i, j] of [[0, k], [N - 1, k], [k, 0], [k, N - 1]]) {
      this.center(i, j, _v); place(_v.x, BOUND_H, _v.z, false);
    }
    this.night = 0;
  }

  buildDecor() {
    const M = this.map, kinds = Object.entries(M.trees);
    const pick = () => { let r = this.rand(); for (const [k, w] of kinds) { if ((r -= w) <= 0) return k; } return kinds[0][0]; };
    const byKind = {};
    for (let j = -6; j < N + 6; j++) for (let i = -6; i < N + 6; i++) {
      if (i >= 0 && j >= 0 && i < N && j < N) continue;
      const out = Math.max(-i, -j, i - (N - 1), j - (N - 1));
      if (this.rand() < (out === 1 ? 0.75 : 0.45)) {
        this.center(i, j, _v);
        const kind = pick();
        // the camera looks from the south: tall props on the first southern rows would stand
        // between it and the players, so they are kept low there
        const low = j >= N && j <= N + 1 ? 0.45 : 1;
        (byKind[kind] ||= []).push([_v.x + (this.rand() - 0.5) * 1.4, _v.z + (this.rand() - 0.5) * 1.4, (0.8 + this.rand() * 0.5) * low]);
      }
    }
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x7a4e2e, roughness: 0.9, vertexColors: true });
    const plainMat = new THREE.MeshStandardMaterial({ roughness: 0.7, vertexColors: true });
    // One instanced mesh per 45° sector of the ring: an instanced mesh is culled as a whole, so a
    // single ring-wide mesh would draw every tree around the arena whenever one is on screen.
    const addInstanced = (geo, mat, pts, depth, tint) => {
      const sectors = Array.from({ length: 8 }, () => []);
      for (const p of pts) sectors[Math.floor((Math.atan2(p[1], p[0]) + Math.PI) / (Math.PI * 2) * 8) % 8].push(p);
      for (const sec of sectors) {
        if (!sec.length) continue;
        const mesh = new THREE.InstancedMesh(geo, mat, sec.length);
        if (depth) mesh.customDepthMaterial = depth;
        sec.forEach(([x, z, s, ry, sy], k) => {
          _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry);
          _m.compose(_v.set(x, 0, z), _q, _s.set(s, s * sy, s));
          mesh.setMatrixAt(k, _m);
          if (tint) mesh.setColorAt(k, tint());
        });
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
    };
    const FIT = { round: { height: 4.6 }, pine: { height: 5.4 }, dead: { height: 4.4 }, cactus: { height: 2.8 }, cliff: { height: 3.2 } };
    for (const [kind, raw] of Object.entries(byKind)) {
      const pts = raw.map(([x, z, s]) => [x, z, s, this.rand() * 6.28, 0.9 + this.rand() * 0.25]);
      const name = TREE_PROP[kind] && snowy(TREE_PROP[kind], M.snow);
      if (name && hasProp(name)) {
        const tint = () => _c.setHSL(0, 0, 0.88 + this.rand() * 0.16);
        const big = kind === 'cliff' ? pts.map(([x, z, s, ry]) => [x, z, s * (1.2 + this.rand() * 0.9), ry, 0.8 + this.rand() * 0.5]) : pts;
        addInstanced(propGeometry(name, FIT[kind]), propMaterial(name), big, propDepth(name), tint);
        continue;
      }
      if (kind === 'cactus') { addInstanced(cactusGeometry(4, 2.4), plainMat, pts); continue; }
      if (kind === 'dead') { addInstanced(deadTree(6), plainMat, pts); continue; }
      if (kind === 'cliff') {
        const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
        addInstanced(cliffGeometry(8), rock, pts.map(([x, z, s, ry]) => [x, z, s * (1.4 + this.rand() * 1.2), ry, 0.7 + this.rand() * 0.8]));
        continue;
      }
      const geo = kind === 'pine' ? pineTree(5) : roundTree(3);
      const leaf = kind === 'pine' ? { leafScale: 4.2, leafBump: 0.45 } : { leafScale: 2.8, leafBump: 0.6 };
      const { mat, depth } = foliageMaterials({ vertexColors: true, roughness: 0.75 }, { reveal: false, snow: !!M.snow, ...leaf });
      const [bh, bs, bl] = M.bush;
      addInstanced(geo.trunk, barkMat, pts);
      addInstanced(geo.crown, mat, pts, depth, () => _c.setHSL(bh - 0.02 + this.rand() * 0.07, bs + 0.05, bl + this.rand() * 0.25));
    }
  }

  // 'K' tiles: cactus, boulder, stump or rock depending on the biome.
  buildObstacles() {
    const tiles = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (this.grid[j][i] === 'K') tiles.push([i, j]);
    if (!tiles.length) return;
    const name = OBSTACLE_PROP[this.map.obstacle] && snowy(OBSTACLE_PROP[this.map.obstacle], this.map.snow);
    const sculpted = name && hasProp(name);
    const fit = name === 'cactus' ? { height: 2.3 } : { width: 1.75 };
    const mesh = sculpted
      ? new THREE.InstancedMesh(propGeometry(name, fit), propMaterial(name), tiles.length)
      : new THREE.InstancedMesh(obstacleGeometry(this.map.obstacle),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: this.map.obstacle !== 'cactus' }), tiles.length);
    if (sculpted && propDepth(name)) mesh.customDepthMaterial = propDepth(name);
    tiles.forEach(([i, j], k) => {
      this.center(i, j, _v);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.rand() * 6.28);
      const sc = 1 + this.rand() * 0.2;
      _m.compose(_v, _q, _s.set(sc, sc, sc));
      mesh.setMatrixAt(k, _m);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  // Flat stepping stones scattered on the cartoon ground, each with a darker rim.
  buildStones() {
    const plate = new THREE.CircleGeometry(1, 5); plate.rotateX(-Math.PI / 2);
    const spots = [];
    for (let k = 0; k < 400 && spots.length < 70; k++) {
      const [i, j] = this.randomOpenTile(1, this.rand);
      if (this.grid[j][i] !== '.') continue;
      this.center(i, j, _v);
      spots.push([_v.x + (this.rand() - 0.5) * 1.4, _v.z + (this.rand() - 0.5) * 1.4, 0.28 + this.rand() * 0.3, this.rand() * 6.28]);
    }
    const make = (color, y, grow) => {
      const mesh = new THREE.InstancedMesh(plate, new THREE.MeshStandardMaterial({ color, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }), spots.length);
      spots.forEach(([x, z, r, a], k) => {
        _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a);
        _m.compose(_v.set(x, y, z), _q, _s.set(r * grow, 1, r * grow * 0.85));
        mesh.setMatrixAt(k, _m);
      });
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    make(0xc8704a, 0.008, 1.18); // rim
    make(this.map.stoneColor || 0xf7c48e, 0.014, 1);
  }

  // Glossy dark puddles on wet maps: pure mirrors for lanterns, projectiles and lightning.
  buildPuddles() {
    const geo = new THREE.CircleGeometry(1, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x24303a, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.72, envMapIntensity: 2,
      polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
    });
    const spots = [];
    for (let k = 0; k < 40 && spots.length < 22; k++) {
      const [i, j] = this.randomOpenTile(1, this.rand);
      if (this.grid[j][i] !== '.') continue;
      this.center(i, j, _v);
      spots.push([_v.x + (this.rand() - 0.5), _v.z + (this.rand() - 0.5), 0.5 + this.rand() * 0.6, this.rand() * 6.28]);
    }
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, z, r, a], k) => {
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a);
      _m.compose(_v.set(x, 0.012, z), _q, _s.set(r * 1.4, 1, r));
      mesh.setMatrixAt(k, _m);
    });
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  /* ------------------------------ mutation ----------------------------- */

  destroyWall(i, j) {
    if (this.get(i, j) !== '#') return null;
    const idx = this.wallIndex.get(this.key(i, j));
    this.walls.setMatrixAt(idx, ZERO);
    this.walls.instanceMatrix.needsUpdate = true;
    this.grid[j][i] = '.';
    return this.wallColors[idx];
  }

  crateAt(i, j) { return this.crates.get(this.key(i, j)); }

  // returns true when destroyed
  hitCrate(i, j, dmg) {
    const c = this.crateAt(i, j);
    if (!c) return false;
    c.hp -= dmg; c.shake = 0.25; c.flash = 1;
    if (c.hp > 0) return false;
    this.group.remove(c.group);
    this.crates.delete(this.key(i, j));
    this.grid[j][i] = '.';
    return true;
  }

  /* ------------------------------ per frame ---------------------------- */

  update(dt, t) {
    this.water.update(dt, this.sky);
    for (const c of this.crates.values()) {
      if (c.shake > 0) {
        c.shake -= dt;
        const s = Math.max(c.shake, 0) * 0.5;
        c.group.scale.set(1 + s * 0.3, 1 - s * 0.5, 1 + s * 0.3);
      }
      if (c.flash > 0) {
        c.flash = Math.max(0, c.flash - dt * 6);
        c.mat.emissive.setRGB(c.flash, c.flash * 0.8, c.flash * 0.6);
      }
      c.gem.rotation.y = t * 1.2;
    }
    const glow = 0.25 + 0.75 * this.night;
    for (const f of this.torches) {
      const k = 0.85 + 0.15 * Math.sin(t * 13 + f.ph) * Math.sin(t * 7.3 + f.ph * 2);
      f.flicker = k;
      f.flame.scale.set(1 + (1 - k) * 0.4, k * (0.9 + 0.2 * Math.sin(t * 19 + f.ph)), 1 + (1 - k) * 0.4);
      f.flame.rotation.z = Math.sin(t * 5.1 + f.ph) * 0.08;
      f.core.scale.set(1, k, 1);
      f.halo.material.opacity = glow * (0.7 + 0.3 * k);
      f.halo.scale.setScalar(1.6 + glow * 1.2 * k);
    }
    const lk = this.lanternKit;
    lk.mat.glass.emissiveIntensity = (0.5 + 2.3 * this.night) * (0.9 + 0.1 * Math.sin(t * 11));
    lk.mat.wax.emissiveIntensity = 0.2 + 0.6 * this.night;
    this.lampGlow.value = (0.25 + 2.2 * this.night) * (0.9 + 0.1 * Math.sin(t * 11));
  }

  emit(pool, night) {
    this.night = night;
    const amt = 0.03 + 0.97 * night;
    for (const f of this.torches) {
      pool.add(f.x, f.y, f.z, 1.0, 0.5, 0.18, 22 * amt * (f.flicker || 1), 10);
    }
    for (const c of this.crates.values()) {
      const p = c.group.position;
      pool.add(p.x, 2.6, p.z, 0.3, 1.0, 0.45, 0.8 + 2.5 * night, 5);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach(m => m.dispose());
    });
  }
}
