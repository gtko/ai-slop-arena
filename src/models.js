import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { charMat } from './materials.js';

// Hand-sculpted brawler models, modelled after the generated portraits (public/assets/ui).
// Same rig as before (hips > legs, torso > arms / head, weapon on the right hand) so animation
// and gameplay code are unchanged. Static parts are merged per material inside each bone group
// at the end, so a detailed character still costs ~15-25 draw calls.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ------------------------------ geometry helpers ------------------------------ */

const ellipsoid = (rx, ry, rz, w = 18, h = 12) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
const capsule = (r, len, cs = 4, rs = 12) => new THREE.CapsuleGeometry(r, len, cs, rs);
const cyl = (rt, rb, h, s = 18) => new THREE.CylinderGeometry(rt, rb, h, s);
const lathe = (pts, s = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s);
const tube = (pts, r, seg = 24, rs = 8) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, rs, false);
const rbox = (w, h, d, r, s = 2) => new RoundedBoxGeometry(w, h, d, s, r);
const arc = (cx, cy, z, w, h, n = 12) => {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, a = Math.PI * (1 - t); pts.push(V(cx + Math.cos(a) * w, cy - Math.sin(a) * h, z)); }
  return pts;
};

// Parts carry a material *spec*; at bake time all parts sharing a surface type (roughness, clear
// coat, metal, side, glow) merge into one mesh with their colours stored as vertex colours.
function toy(color, { rough = 0.45, coat = 0.35, metal = 0, emissive = 0, ei = 0 } = {}) {
  // quantised into a few surface types so more parts share a material (fewer draw calls)
  rough = rough < 0.3 ? 0.22 : rough < 0.58 ? 0.45 : 0.72;
  coat = coat >= 0.5 ? 0.7 : coat > 0.1 ? 0.3 : 0;
  metal = metal > 0.5 ? 0.85 : 0;
  return { color: new THREE.Color(color), rough, coat, metal, emissive, ei, side: THREE.FrontSide, glow: ei > 0 };
}
const familyKey = sp => (sp.glow ? `g${new THREE.Color(sp.emissive).getHex()}_${sp.ei}_${sp.rough}` : `${sp.rough}_${sp.coat}_${sp.metal}`) + `_${sp.side}`;

// Glossy vinyl-toy look: physical material with a thin clear coat + the shared rim light.
function familyMaterial(sp) {
  const rim = charMat(0xffffff);
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true, color: 0xffffff, roughness: sp.rough, metalness: sp.metal, clearcoat: sp.coat, clearcoatRoughness: 0.35,
    emissive: sp.emissive, emissiveIntensity: sp.ei, side: sp.side,
  });
  m.onBeforeCompile = rim.onBeforeCompile;
  rim.dispose();
  if (sp.glow) m.userData.glow = true;
  return m;
}

// Cartoon outline: inverted hull pushed out along the normals, drawn back-faces only.
let OUTLINE = null;
export const OUTLINES = new Set(); // hidden during the AO pre-pass (see main.js)
function outlineMaterial() {
  if (OUTLINE) return OUTLINE;
  OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1a1024, side: THREE.BackSide });
  OUTLINE.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize( objectNormal ) * 0.032;');
  };
  OUTLINE.userData.outline = true;
  return OUTLINE;
}
const DUMMY = new THREE.MeshBasicMaterial();

class Rig {
  constructor(P) {
    this.P = P;
    this.root = new THREE.Group();
    this.hips = this.group(this.root, 0, 0.62, 0);
    this.legL = this.group(this.hips, -0.2, 0, 0);
    this.legR = this.group(this.hips, 0.2, 0, 0);
    this.torso = this.group(this.hips, 0, 0, 0);
    this.head = this.group(this.torso, 0, 1.36, 0);
    this.head.scale.setScalar(1.14); // chibi: big head like the portraits
    this.armL = this.group(this.torso, -0.52, 0.8, 0);
    this.armR = this.group(this.torso, 0.52, 0.8, 0);
    this.gun = this.group(this.armR, 0, -0.58, 0.04);
    this.twoHanded = false;
  }
  group(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
  // add(parent, geometry, material, position, rotation(euler xyz), scale)
  add(parent, geo, spec, p = [0, 0, 0], r = null, s = null) {
    const m = new THREE.Mesh(geo, DUMMY);
    m.userData.spec = spec;
    m.position.set(...p);
    if (r) m.rotation.set(...r);
    if (s) typeof s === 'number' ? m.scale.setScalar(s) : m.scale.set(...s);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // Merge the direct mesh children of every group, per material (groups stay animatable).
  bake() {
    const groups = [], materials = new Map();
    this.root.traverse(o => { if (o.isGroup || o === this.root) groups.push(o); });
    for (const g of groups) {
      const byFamily = new Map();
      for (const c of [...g.children]) {
        if (!c.isMesh) continue;
        const sp = c.userData.spec;
        c.updateMatrix();
        const geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        const n = geo.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = sp.color.r; col[i * 3 + 1] = sp.color.g; col[i * 3 + 2] = sp.color.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.applyMatrix4(c.matrix);
        const key = familyKey(sp);
        if (!byFamily.has(key)) byFamily.set(key, { sp, list: [] });
        byFamily.get(key).list.push(geo);
        g.remove(c);
        c.geometry.dispose();
      }
      for (const [key, { sp, list }] of byFamily) {
        if (!materials.has(key)) materials.set(key, familyMaterial(sp));
        const geo = mergeGeometries(list);
        list.forEach(x => x.dispose());
        const merged = new THREE.Mesh(geo, materials.get(key));
        merged.castShadow = merged.receiveShadow = true;
        merged.userData.baked = true;
        g.add(merged);
        if (!sp.glow && g !== this.eyes) {
          const line = new THREE.Mesh(geo, outlineMaterial());
          line.userData.outline = true;
          OUTLINES.add(line);
          g.add(line);
        }
      }
    }
    const mats = new Set(materials.values());
    return {
      root: this.root, hips: this.hips, torso: this.torso, head: this.head, legL: this.legL, legR: this.legR,
      armL: this.armL, armR: this.armR, gun: this.gun, eyes: this.eyes, mats: [...mats], twoHanded: this.twoHanded,
    };
  }
}

/* ------------------------------ shared anatomy ------------------------------ */

// Face on a head of radius ~0.48 looking down +z. Eyes live in their own group so they can blink.
function face(rig, M, { iris = 0x3a6fd8, browColor, angry = false, grin = false, brows = true, lashes = false } = {}) {
  const H = rig.head;
  // both eyes in one group (merged per material, scaled on Y to blink)
  rig.eyes = rig.group(H, 0, 0.03, 0);
  for (const s of [-1, 1]) {
    const x = 0.165 * s, yaw = s * 0.36, c = Math.cos(yaw), sn = Math.sin(yaw);
    const part = (geo, mat, ox, oy, oz) => rig.add(rig.eyes, geo, mat, [x + ox * c + oz * sn, oy, 0.405 - ox * sn + oz * c], [0, yaw, 0]);
    part(ellipsoid(0.125, 0.155, 0.06, 18, 14), M.white, 0, 0, 0);
    part(ellipsoid(0.088, 0.11, 0.03, 16, 12), toyCache(iris, 0.25), 0, -0.012, 0.045);
    part(ellipsoid(0.05, 0.062, 0.02, 12, 10), M.black, 0, -0.012, 0.066);
    part(ellipsoid(0.028, 0.028, 0.012, 10, 8), M.shine, 0.03 * -s, 0.035, 0.08);
    part(ellipsoid(0.013, 0.013, 0.01, 8, 6), M.shine, -0.025 * -s, -0.05, 0.08);
    if (brows) {
      const tilt = angry ? -0.35 * s : 0.12 * s;
      rig.add(H, capsule(0.028, 0.13, 4, 8), toyCache(browColor, 0.7), [x * 1.05, 0.19, 0.43], [0, yaw, Math.PI / 2 + tilt]);
    }
    if (lashes) rig.add(rig.eyes, capsule(0.012, 0.09, 3, 6), M.black, [x + 0.02 * s, 0.12, 0.44], [0, yaw, Math.PI / 2 - 0.3 * s]);
    rig.add(H, ellipsoid(0.06, 0.035, 0.02), M.blush, [0.25 * s, -0.12, 0.38], [0, s * 0.6, 0]); // cheeks
    rig.add(H, ellipsoid(0.07, 0.1, 0.05), M.skin, [0.47 * s, 0.0, 0.0]); // ears
  }
  rig.add(H, ellipsoid(0.055, 0.045, 0.045), M.skinDark, [0, -0.07, 0.47]); // nose
  if (grin) {
    rig.add(H, ellipsoid(0.13, 0.06, 0.03), M.mouth, [0, -0.2, 0.43], [0.25, 0, 0]);
    rig.add(H, ellipsoid(0.115, 0.03, 0.025), M.white, [0, -0.178, 0.445], [0.25, 0, 0]); // teeth
  } else {
    rig.add(H, tube(arc(0, -0.17, 0.455, 0.075, 0.035), 0.013, 16, 6), M.mouth);
  }
}

// Materials are cached per character (hit flashes and frost tints are per brawler).
let matCache = new Map();
function toyCache(color, rough = 0.45, opts = {}) {
  const k = `${color}_${rough}_${JSON.stringify(opts)}`;
  if (!matCache.has(k)) matCache.set(k, toy(color, { rough, ...opts }));
  return matCache.get(k);
}

// Legs, torso shell, neck, belt, arms with sleeves and gloves: shared by the human brawlers.
function body(rig, M, { top, sleeve = top, cuff = null, pants, shoe, glove = M.skin, belly = 0.46 }) {
  for (const L of [rig.legL, rig.legR]) {
    rig.add(L, capsule(0.16, 0.26), pants, [0, -0.25, 0]);
    rig.add(L, ellipsoid(0.17, 0.12, 0.25), shoe, [0, -0.52, 0.06]);
    rig.add(L, ellipsoid(0.18, 0.045, 0.26), M.sole, [0, -0.6, 0.06]);
  }
  const T = rig.torso;
  rig.add(T, lathe([[0, 0], [0.34, 0.02], [belly - 0.03, 0.18], [belly, 0.42], [belly - 0.05, 0.66], [0.33, 0.86], [0.17, 0.95], [0, 0.97]]), top);
  rig.add(T, cyl(0.15, 0.17, 0.2), M.skin, [0, 1.0, 0]); // neck
  for (const [A, s] of [[rig.armL, -1], [rig.armR, 1]]) {
    rig.add(A, ellipsoid(0.17, 0.17, 0.17), sleeve, [0, 0, 0]); // shoulder
    rig.add(A, capsule(0.135, 0.22), sleeve, [0, -0.2, 0]);
    if (cuff) rig.add(A, cyl(0.15, 0.15, 0.1), cuff, [0, -0.38, 0]);
    rig.add(A, capsule(0.11, 0.12), glove, [0, -0.44, 0]);
    rig.add(A, ellipsoid(0.13, 0.12, 0.11), glove, [0, -0.56, 0.01]);
    rig.add(A, ellipsoid(0.05, 0.07, 0.05), glove, [-0.09 * s, -0.53, 0.07], [0.3, 0, 0.3 * s]); // thumb
  }
  rig.armR.rotation.x = -1.35;
}

function palette(P) {
  return {
    skin: toyCache(P.skin, 0.55, { coat: 0.2 }),
    skinDark: toyCache(new THREE.Color(P.skin).multiplyScalar(0.85).getHex(), 0.55),
    blush: toyCache(0xff8a8a, 0.6, { coat: 0 }),
    white: toyCache(0xffffff, 0.2),
    black: toyCache(0x111118, 0.15),
    shine: toy(0xffffff, { emissive: 0xffffff, ei: 1.5, rough: 0.1 }),
    mouth: toyCache(0x7a1e2a, 0.5),
    sole: toyCache(0x2a2320, 0.8),
    metal: toyCache(0x9aa3ad, 0.25, { metal: 0.9, coat: 0.5 }),
    darkMetal: toyCache(0x3a3f4a, 0.3, { metal: 0.8 }),
    gold: toyCache(0xf2b632, 0.25, { metal: 0.9, coat: 0.6 }),
    wood: toyCache(0x8b5a2b, 0.6),
  };
}

/* ------------------------------ the brawlers ------------------------------ */

function blaster(rig, M, P) {
  const jacket = toyCache(P.main, 0.5), pants = toyCache(0x3b3a7a, 0.6), boots = toyCache(0x6b4228, 0.55);
  const hair = toyCache(P.hair, 0.45, { coat: 0.5 }), scarf = toyCache(P.accent, 0.55);
  body(rig, M, { top: jacket, pants, shoe: boots, belly: 0.45 });
  rig.add(rig.torso, cyl(0.03, 0.03, 0.62, 6), M.darkMetal, [0, 0.55, 0.45], [-0.12, 0, 0]); // zipper
  rig.add(rig.torso, cyl(0.46, 0.46, 0.09), M.sole, [0, 0.1, 0]); // belt
  // scarf: fat torus around the neck + a tail over the shoulder
  rig.add(rig.torso, new THREE.TorusGeometry(0.24, 0.1, 10, 24), scarf, [0, 0.95, 0.02], [Math.PI / 2 + 0.15, 0, 0]);
  rig.add(rig.torso, tube([V(0.12, 0.92, 0.2), V(0.26, 0.75, 0.33), V(0.3, 0.52, 0.3)], 0.07, 12, 8), scarf);
  // head + swept spiky hair
  rig.add(rig.head, ellipsoid(0.48, 0.47, 0.45, 26, 18), M.skin);
  face(rig, M, { iris: 0x5a2a8a, browColor: P.hair });
  rig.add(rig.head, ellipsoid(0.5, 0.36, 0.47, 28, 18), hair, [0, 0.16, -0.05]); // hair cap
  const spikes = [[0, 0.5, 0.1, -0.5, 0], [-0.22, 0.46, 0.05, -0.55, 0.45], [0.22, 0.46, 0.05, -0.55, -0.45], [-0.12, 0.52, -0.18, -1.0, 0.25],
    [0.12, 0.52, -0.18, -1.0, -0.25], [0, 0.42, -0.34, -1.5, 0], [-0.34, 0.32, -0.12, -0.9, 0.9], [0.34, 0.32, -0.12, -0.9, -0.9], [0, 0.38, 0.32, 0.35, 0]];
  for (const [x, y, z, rx, rz] of spikes) rig.add(rig.head, new THREE.ConeGeometry(0.13, 0.46, 8), hair, [x, y, z], [rx, 0, rz]);
  rig.add(rig.head, ellipsoid(0.36, 0.12, 0.2), hair, [0, 0.26, 0.3], [0.5, 0, 0]); // fringe
  // double-barrel shotgun
  const G = rig.gun;
  for (const x of [-0.045, 0.045]) rig.add(G, cyl(0.045, 0.045, 0.9, 12), M.darkMetal, [x, -0.38, 0.02]);
  rig.add(G, rbox(0.16, 0.22, 0.16, 0.03), M.darkMetal, [0, 0.03, 0.02]);
  rig.add(G, rbox(0.13, 0.24, 0.12, 0.04), M.wood, [0, -0.3, -0.07]); // pump
  rig.add(G, rbox(0.12, 0.44, 0.2, 0.05), M.wood, [0, 0.3, -0.04], [0.25, 0, 0]); // stock
}

function gunslinger(rig, M, P) {
  const shirt = toyCache(P.main, 0.5), cuffs = toyCache(P.accent, 0.45), pants = toyCache(0x5a3a24, 0.6);
  const boots = toyCache(0x4a2c18, 0.5), hatMat = toyCache(0x7a4a2a, 0.55), hair = toyCache(0x3a2616, 0.6);
  body(rig, M, { top: shirt, cuff: cuffs, pants, shoe: boots, belly: 0.48 });
  rig.add(rig.torso, cyl(0.49, 0.49, 0.12), toyCache(0x4a2c18, 0.5), [0, 0.1, 0]); // belt
  rig.add(rig.torso, cyl(0.1, 0.1, 0.04, 20), M.gold, [0, 0.1, 0.47], [Math.PI / 2, 0, 0]); // buckle
  for (const y of [0.36, 0.56]) rig.add(rig.torso, ellipsoid(0.03, 0.03, 0.02), M.gold, [0, y, 0.475]);
  // neckerchief: collar ring + knot + hanging triangle
  rig.add(rig.torso, new THREE.TorusGeometry(0.22, 0.07, 8, 22), cuffs, [0, 0.93, 0.03], [Math.PI / 2 + 0.25, 0, 0]);
  rig.add(rig.torso, ellipsoid(0.08, 0.07, 0.06), cuffs, [0, 0.84, 0.3]);
  rig.add(rig.torso, new THREE.ConeGeometry(0.14, 0.26, 3), cuffs, [0, 0.7, 0.34], [Math.PI, Math.PI / 6, 0.1]);
  rig.add(rig.head, ellipsoid(0.48, 0.47, 0.46, 26, 18), M.skin);
  rig.add(rig.head, ellipsoid(0.49, 0.25, 0.45, 24, 12), hair, [0, 0.12, -0.08]);
  face(rig, M, { iris: 0x2a78c8, browColor: 0x3a2616, angry: true, grin: true });
  // hat: curled brim (lathe) + pinched crown + gold band
  const brim = lathe([[0, 0], [0.4, 0.0], [0.62, 0.02], [0.8, 0.12], [0.82, 0.16], [0.78, 0.13], [0.6, 0.05], [0.4, 0.04], [0, 0.04]], 36);
  const bp = brim.attributes.position; // lift the sides, dip the front and back
  for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), z = bp.getZ(i), r = Math.hypot(x, z); if (r > 0.45) bp.setY(i, bp.getY(i) + (Math.abs(x) / 0.8) ** 2 * 0.2 - (Math.abs(z) / 0.8) ** 2 * 0.03); }
  brim.computeVertexNormals();
  rig.add(rig.head, brim, hatMat, [0, 0.33, 0]);
  const crown = lathe([[0, 0.5], [0.22, 0.47], [0.32, 0.38], [0.36, 0.15], [0.37, 0]], 28);
  const cp = crown.attributes.position; // center dent on top
  for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); if (y > 0.4) cp.setY(i, y - (0.08 - Math.abs(x) * 0.3) * (y - 0.4) * 8); }
  crown.computeVertexNormals();
  rig.add(rig.head, crown, hatMat, [0, 0.36, 0]);
  rig.add(rig.head, cyl(0.375, 0.375, 0.08, 28), M.gold, [0, 0.42, 0]);
  // twin revolvers
  const revolver = G => {
    rig.add(G, cyl(0.04, 0.04, 0.42, 12), M.metal, [0, -0.35, 0.03]);
    rig.add(G, cyl(0.075, 0.075, 0.12, 8), M.metal, [0, -0.1, 0.03]);
    rig.add(G, rbox(0.08, 0.14, 0.12, 0.02), M.metal, [0, 0.0, 0.03]);
    rig.add(G, rbox(0.08, 0.22, 0.1, 0.035), M.wood, [0, 0.1, -0.06], [0.5, 0, 0]);
  };
  revolver(rig.gun);
  const gun2 = rig.group(rig.armL, 0, -0.58, 0.04);
  revolver(gun2);
  rig.armL.rotation.x = -1.35;
  rig.twoHanded = true;
}

function bomber(rig, M, P) {
  const overalls = toyCache(P.main, 0.55), stripe = toyCache(0xd23b3b, 0.5), shirtW = toyCache(0xf4f0e8, 0.55);
  const gloves = toyCache(0xf2c12e, 0.5), boots = toyCache(0x5a3a22, 0.55), helmet = toyCache(P.accent, 0.3, { coat: 0.8 });
  const beard = toyCache(0xf4f4f4, 0.75, { coat: 0 });
  body(rig, M, { top: overalls, sleeve: shirtW, pants: overalls, shoe: boots, glove: gloves, belly: 0.52 });
  for (const [A] of [[rig.armL], [rig.armR]]) for (const y of [-0.08, -0.22]) rig.add(A, cyl(0.142, 0.142, 0.05), stripe, [0, y, 0]); // striped sleeves
  rig.add(rig.torso, rbox(0.4, 0.3, 0.1, 0.04), overalls, [0, 0.55, 0.44]); // bib
  rig.add(rig.torso, rbox(0.2, 0.12, 0.04, 0.02), toyCache(0xd87a12, 0.55), [0, 0.5, 0.5]); // pocket
  for (const s of [-1, 1]) {
    rig.add(rig.torso, tube([V(0.15 * s, 0.68, 0.44), V(0.22 * s, 0.9, 0.2), V(0.2 * s, 0.9, -0.25), V(0.15 * s, 0.6, -0.43)], 0.035, 12, 6), overalls);
    rig.add(rig.torso, ellipsoid(0.035, 0.035, 0.02), M.gold, [0.15 * s, 0.68, 0.46]);
  }
  rig.add(rig.head, ellipsoid(0.48, 0.47, 0.46, 26, 18), M.skin);
  face(rig, M, { iris: 0x5a3a1a, browColor: 0xf4f4f4, brows: true });
  // bushy beard + mustache from clustered blobs
  for (const [x, y, z, r] of [[0, -0.32, 0.25, 0.26], [-0.2, -0.24, 0.26, 0.2], [0.2, -0.24, 0.26, 0.2], [-0.32, -0.08, 0.2, 0.16], [0.32, -0.08, 0.2, 0.16],
    [0, -0.5, 0.2, 0.18], [-0.14, -0.45, 0.28, 0.16], [0.14, -0.45, 0.28, 0.16]]) rig.add(rig.head, ellipsoid(r, r, r * 0.8, 16, 12), beard, [x, y, z]);
  for (const s of [-1, 1]) rig.add(rig.head, ellipsoid(0.13, 0.06, 0.07), beard, [0.08 * s, -0.13, 0.44], [0, 0, 0.3 * s]);
  // helmet dome, brim and headlamp
  rig.add(rig.head, new THREE.SphereGeometry(0.54, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), helmet, [0, 0.1, -0.02]);
  rig.add(rig.head, cyl(0.6, 0.6, 0.05, 30), helmet, [0, 0.1, 0]);
  rig.add(rig.head, cyl(0.035, 0.035, 0.6, 8), toyCache(0xd49a10, 0.4), [0, 0.35, 0.12], [Math.PI / 2 - 0.5, 0, 0]); // ridge
  rig.add(rig.head, cyl(0.12, 0.14, 0.12, 16), M.darkMetal, [0, 0.33, 0.5], [Math.PI / 2 - 0.2, 0, 0]);
  const lamp = toy(0xfff4c0, { emissive: 0xffe28a, ei: 3.5, rough: 0.1 });
  rig.add(rig.head, cyl(0.1, 0.1, 0.03, 16), lamp, [0, 0.34, 0.57], [Math.PI / 2 - 0.2, 0, 0]);
  // bomb with fuse spark
  rig.add(rig.gun, ellipsoid(0.24, 0.24, 0.24), toyCache(0x1a1a22, 0.25, { coat: 0.8 }), [0, -0.12, 0]);
  rig.add(rig.gun, cyl(0.07, 0.07, 0.08, 12), M.darkMetal, [0, -0.12, 0.23], [Math.PI / 2, 0, 0]);
  rig.add(rig.gun, tube([V(0, -0.12, 0.27), V(0.04, -0.12, 0.35), V(0.02, -0.18, 0.42)], 0.015, 8, 5), toyCache(0x8a6a4a, 0.8));
  rig.add(rig.gun, ellipsoid(0.05, 0.05, 0.05), toy(0xffaa33, { emissive: 0xff7722, ei: 5 }), [0.02, -0.19, 0.44]);
}

function frostbite(rig, M, P) {
  const cloak = toyCache(P.main, 0.5), fur = toyCache(0xf6fbff, 0.8, { coat: 0 }), boots = toyCache(0xe8f2ff, 0.5);
  const gloves = toyCache(0xdaeaff, 0.55), crystalMat = toyCache(0xd8f4ff, 0.08, { coat: 1 }), hair = toyCache(0x1d2a44, 0.5);
  body(rig, M, { top: cloak, pants: toyCache(0xb8d8f6, 0.6), shoe: boots, glove: gloves, belly: 0.44 });
  // cloak skirt flaring out below the torso + fur trim
  cloak.side = THREE.DoubleSide;
  rig.add(rig.torso, lathe([[0.44, 0.3], [0.5, 0.1], [0.58, -0.15], [0.62, -0.32]], 30), cloak, [0, 0, 0]);
  rig.add(rig.torso, new THREE.TorusGeometry(0.6, 0.06, 8, 30), fur, [0, -0.32, 0], [Math.PI / 2, 0, 0]);
  rig.add(rig.torso, new THREE.TorusGeometry(0.25, 0.1, 10, 24), fur, [0, 0.93, 0.02], [Math.PI / 2 + 0.2, 0, 0]);
  for (const y of [0.35, 0.55]) rig.add(rig.torso, new THREE.OctahedronGeometry(0.045), crystalMat, [0, y, 0.46]);
  rig.add(rig.head, ellipsoid(0.47, 0.46, 0.45, 26, 18), M.skin);
  face(rig, M, { iris: 0x2fb4e8, browColor: 0x1d2a44, lashes: true });
  rig.add(rig.head, ellipsoid(0.42, 0.14, 0.2), hair, [0, 0.24, 0.3], [0.55, 0, 0]); // fringe
  // hood: open lathe shell behind the face + fur rim + ice spikes
  const hood = lathe([[0.0, 0.7], [0.3, 0.62], [0.5, 0.4], [0.58, 0.1], [0.56, -0.15], [0.5, -0.3]], 30);
  const hp = hood.attributes.position; // open the front for the face
  for (let i = 0; i < hp.count; i++) { const z = hp.getZ(i); if (z > 0.2) hp.setZ(i, 0.2 + (z - 0.2) * 0.35); }
  hood.computeVertexNormals();
  rig.add(rig.head, hood, cloak, [0, 0, -0.06]);
  rig.add(rig.head, new THREE.TorusGeometry(0.47, 0.05, 8, 30, Math.PI * 1.2), fur, [0, -0.02, 0.2], [0, 0, -Math.PI * 0.1]);
  for (const [x, y, z, rx, rz, s] of [[0, 0.72, -0.1, -0.3, 0, 1.2], [-0.32, 0.58, -0.05, -0.2, 0.6, 1], [0.32, 0.58, -0.05, -0.2, -0.6, 1], [-0.5, 0.25, -0.1, 0, 1.1, 0.8], [0.5, 0.25, -0.1, 0, -1.1, 0.8], [0, 0.45, -0.45, -1.1, 0, 0.9]]) {
    rig.add(rig.head, new THREE.OctahedronGeometry(0.12), crystalMat, [x, y, z], [rx, 0, rz], [0.7 * s, 1.6 * s, 0.7 * s]);
  }
  // staff with glowing crystal cluster
  rig.add(rig.gun, cyl(0.035, 0.045, 1.5, 10), M.wood, [0, -0.1, 0], [0.18, 0, 0]);
  const glow = toy(0xbff0ff, { emissive: 0x6fdcff, ei: 3, rough: 0.05 });
  rig.add(rig.gun, new THREE.OctahedronGeometry(0.14), glow, [0, -0.92, 0.14], null, [0.9, 1.8, 0.9]);
  rig.add(rig.gun, new THREE.OctahedronGeometry(0.08), glow, [0.08, -0.82, 0.18], [0, 0, 0.6], [0.8, 1.6, 0.8]);
  rig.add(rig.gun, new THREE.OctahedronGeometry(0.08), glow, [-0.08, -0.84, 0.1], [0, 0, -0.6], [0.8, 1.6, 0.8]);
  rig.add(rig.gun, new THREE.TorusGeometry(0.06, 0.02, 6, 14), M.gold, [0, -0.74, 0.12], [Math.PI / 2, 0, 0]);
}

function volt(rig, M, P) {
  const shell = toyCache(P.main, 0.3, { coat: 0.8 }), trim = toyCache(P.accent, 0.3, { coat: 0.8 }), dark = toyCache(0x26303c, 0.4);
  const spark = toy(0xfff2a0, { emissive: 0x7ff0ff, ei: 2.4 });
  for (const L of [rig.legL, rig.legR]) {
    rig.add(L, capsule(0.15, 0.24), dark, [0, -0.25, 0]);
    rig.add(L, ellipsoid(0.13, 0.1, 0.12), trim, [0, -0.2, 0.08]); // knee pad
    rig.add(L, rbox(0.3, 0.16, 0.4, 0.06), shell, [0, -0.55, 0.05]);
  }
  rig.add(rig.torso, rbox(0.84, 0.82, 0.7, 0.2), shell, [0, 0.45, 0]);
  rig.add(rig.torso, rbox(0.5, 0.38, 0.08, 0.06), trim, [0, 0.46, 0.34]); // chest plate
  rig.add(rig.torso, cyl(0.07, 0.07, 0.05, 16), toy(0xfff2a0, { emissive: 0xffd23f, ei: 3 }), [0, 0.46, 0.39], [Math.PI / 2, 0, 0]);
  rig.add(rig.torso, rbox(0.9, 0.12, 0.76, 0.05), trim, [0, 0.08, 0]); // waist ring
  rig.add(rig.torso, cyl(0.12, 0.14, 0.14, 12), dark, [0, 0.93, 0]); // neck joint
  for (const [A, s] of [[rig.armL, -1], [rig.armR, 1]]) {
    rig.add(A, ellipsoid(0.17, 0.17, 0.17), trim);
    rig.add(A, capsule(0.1, 0.24), dark, [0, -0.22, 0]);
    rig.add(A, ellipsoid(0.16, 0.15, 0.15), spark, [0, -0.52, 0.01]); // glowing fist
  }
  rig.armR.rotation.x = -1.35;
  // TV head: rounded box, dark screen with glowing eyes + smile
  rig.add(rig.head, rbox(0.92, 0.76, 0.8, 0.2), shell, [0, 0.02, 0]);
  rig.add(rig.head, rbox(0.72, 0.5, 0.06, 0.1), toyCache(0x0a1620, 0.15, { coat: 1 }), [0, 0.02, 0.39]);
  const screen = toy(0x7ff6ff, { emissive: 0x3fe8ff, ei: 3 });
  rig.eyes = rig.group(rig.head, 0, 0.06, 0.43);
  for (const s of [-1, 1]) rig.add(rig.eyes, ellipsoid(0.07, 0.1, 0.02), screen, [0.15 * s, 0, 0]);
  rig.add(rig.head, tube(arc(0, -0.08, 0.435, 0.09, 0.05), 0.014, 14, 6), screen);
  for (const s of [-1, 1]) rig.add(rig.head, cyl(0.1, 0.1, 0.08, 16), trim, [0.47 * s, 0, 0], [0, 0, Math.PI / 2]); // ear bolts
  rig.add(rig.head, cyl(0.022, 0.022, 0.42, 6), M.darkMetal, [0.2, 0.58, 0]);
  rig.add(rig.head, ellipsoid(0.1, 0.1, 0.1), toy(0xfff2a0, { emissive: 0xffd23f, ei: 4 }), [0.2, 0.82, 0]);
}

const BUILDERS = { blaster, gunslinger, bomber, frostbite, volt };

export function buildModel(T) {
  matCache = new Map();
  const rig = new Rig(T.palette);
  const M = palette(T.palette);
  (BUILDERS[T.key] || blaster)(rig, M, T.palette);
  return rig.bake();
}
