import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ASSET_BASE } from './assets.js';
import { charMat } from './materials.js';
import { outlineMaterial, OUTLINES } from './models.js';

// Image-to-3D figurines: the chibi art (art-src/chibi) turned into textured meshes by
// art-src/gen_3d.py, then squeezed with gltf-transform (webp texture, meshopt geometry).
// A brawler whose GLB exists uses it instead of the hand-built rig in models.js.
//
// The generated meshes come without a skeleton, so one is fitted at load time: joint heights are
// read off the mesh (crotch = where the gap between the legs closes, neck = where the big chibi
// head narrows, torso width = the gap between body and arms), then every vertex gets smooth skin
// weights for hips / spine / head / legs / arms. brawler.js animates those bones.

const HEIGHT = 2.5; // same size as the procedural rigs
const H = HEIGHT;

// Which hand holds the weapon (R = the character's right = -x, models face +z), how the attack
// is animated (see RAISE in brawler.js), plus per-model joint overrides (fractions of the height)
// when the automatic fit needs help.
export const RIGS = {
  blaster: { weapon: 'R', style: 'gun' },
  gunslinger: { weapon: 'both', style: 'gun' },
  bomber: { weapon: 'L', style: 'throw' },
  frostbite: { weapon: 'R', style: 'staff' },
  volt: { weapon: 'both', style: 'cast' },
};

export const BONES = ['root', 'hips', 'spine', 'head', 'thighL', 'shinL', 'thighR', 'shinR', 'armL', 'foreL', 'armR', 'foreR'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));

const templates = new Map(); // type key -> { geo, map, joints, gain }
let loading = null;

export function preloadFigurines(keys, renderer) {
  if (loading) return loading;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  loading = Promise.all(keys.map(key => loader.loadAsync(`${ASSET_BASE}models/${key}.glb`)
    .then(gltf => templates.set(key, prepare(key, gltf.scene, aniso)))
    .catch(e => { if (!/404|Not Found|Unexpected token/.test(String(e))) console.warn('figurine', key, e); })));
  return loading;
}

export const hasFigurine = key => templates.has(key);
export const figurineInfo = key => templates.get(key);

function prepare(key, scene, aniso) {
  let mesh = null;
  scene.updateMatrixWorld(true);
  scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  // The optimised file stores quantised ints: expand to floats so the geometry can be rescaled.
  const src = mesh.geometry, geo = new THREE.BufferGeometry();
  for (const [name, V] of [['position', THREE.Vector3], ['uv', THREE.Vector2]]) {
    const a = src.attributes[name], n = a.count, s = a.itemSize, out = new Float32Array(n * s), v = new V();
    for (let i = 0; i < n; i++) v.fromBufferAttribute(a, i).toArray(out, i * s);
    geo.setAttribute(name, new THREE.BufferAttribute(out, s));
  }
  geo.setIndex(src.index.clone());
  geo.applyMatrix4(mesh.matrixWorld);

  // Feet on the ground, centred between the feet (not the bounding box: weapons stick out).
  geo.computeBoundingBox();
  const b = geo.boundingBox, pos = geo.attributes.position, k = HEIGHT / (b.max.y - b.min.y);
  let fx = 0, fz = 0, fn = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < b.min.y + (b.max.y - b.min.y) * 0.1) { fx += pos.getX(i); fz += pos.getZ(i); fn++; }
  }
  geo.translate(-fx / fn, -b.min.y, -fz / fn).scale(k, k, k);
  smoothNormals(geo);
  geo.computeBoundingSphere();

  const joints = autoRig(geo, RIGS[key] || {});

  const map = mesh.material.map;
  map.anisotropy = aniso;
  return { geo, map, joints, gain: textureGain(map) };
}

// The file has no normals, and its UV seams split vertices: average face normals per *position*
// so shading (and the outline hull) stays continuous across the seams.
function smoothNormals(geo) {
  const pos = geo.attributes.position, idx = geo.index.array, n = pos.count;
  const ids = new Uint32Array(n), keys = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let id = keys.get(key);
    if (id === undefined) { id = keys.size; keys.set(key, id); }
    ids[i] = id;
  }
  const acc = new Float32Array(keys.size * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < idx.length; f += 3) {
    a.fromBufferAttribute(pos, idx[f]);
    b.fromBufferAttribute(pos, idx[f + 1]).sub(a);
    c.fromBufferAttribute(pos, idx[f + 2]).sub(a);
    b.cross(c); // area weighted
    for (let j = 0; j < 3; j++) {
      const o = ids[idx[f + j]] * 3;
      acc[o] += b.x; acc[o + 1] += b.y; acc[o + 2] += b.z;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a.fromArray(acc, ids[i] * 3).normalize().toArray(out, i * 3);
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

/* ------------------------------ auto rig ------------------------------ */
//
// 1. fitJoints: joint heights + a per-height profile of where the body ends on each side (the gap
//    between torso/legs and the hanging arms, measured separately left and right because weapons
//    make the model asymmetric).
// 2. labels: one bone per vertex (head, spine, hips, thighs, shins, upper arms, forearms+weapon).
// 3. cut: the generator fuses hands and weapons to hips and legs; every face that glues an arm to
//    anything but the torso at shoulder height is dropped, so arms swing free.
// 4. diffuse: weights are blurred along the (cut) surface, never across it, for soft joints.

const ARM = { L: [B.armL, B.foreL], R: [B.armR, B.foreR] };
const armSide = l => (ARM.L.includes(l) ? 'L' : ARM.R.includes(l) ? 'R' : null);
const BINS = 100;
const binOf = y => Math.min(BINS - 1, Math.max(0, Math.floor(y / H * BINS)));

function fitJoints(geo, over) {
  const pos = geo.attributes.position, n = pos.count;

  // Crotch: lowest height where the body closes between the legs (a vertex near x = 0).
  const minAbsX = new Float32Array(BINS).fill(Infinity);
  // Neck: depth (z extent) of the central column; the big head is much deeper than the body.
  const zMin = new Float32Array(BINS).fill(Infinity), zMax = new Float32Array(BINS).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), b = binOf(y);
    minAbsX[b] = Math.min(minAbsX[b], Math.abs(x));
    if (Math.abs(x) < 0.05 * H) { zMin[b] = Math.min(zMin[b], z); zMax[b] = Math.max(zMax[b], z); }
  }
  let crotch = 0;
  for (let b = 4; b < 48; b++) if (minAbsX[b] < 0.012 * H) { crotch = b / BINS * H; break; }
  if (crotch < 0.12 * H) crotch = 0.28 * H;
  // thighs pressed together close the gap early: keep the crotch within chibi proportions
  // (the leg-to-leg cut below then separates the touching thighs)
  crotch = Math.min(0.36 * H, Math.max(0.22 * H, crotch));
  const depth = b => (zMax[b] > zMin[b] ? zMax[b] - zMin[b] : 0);
  let top = 60;
  for (let b = 60; b < 95; b++) if (depth(b) > depth(top)) top = b;
  let neck = 0.56 * H;
  for (let b = top; b > 40; b--) if (depth(b) < depth(top) * 0.72) { neck = (b + 1) / BINS * H; break; }
  // hat brims, beards and screen heads skew the depth test upwards: chibi necks sit at 50-62%
  neck = Math.min(0.62 * H, Math.max(0.5 * H, neck));
  if (over.crotch) crotch = over.crotch * H;
  if (over.neck) neck = over.neck * H;
  const shoulderY = neck - 0.05 * H;

  // Body edge per height and side: walking out from the centre, the first clear gap in x.
  // Where an arm or weapon is fused to the body there is no gap: interpolate from the neighbours.
  // Coverage is measured with triangle x-intervals, not vertices: flat areas have big triangles and
  // sparse vertices would fake gaps in the middle of a leg.
  const edge = { L: new Float32Array(BINS).fill(NaN), R: new Float32Array(BINS).fill(NaN) };
  const rows = Array.from({ length: BINS }, () => ({ L: [], R: [] }));
  const idx = geo.index.array;
  for (let f = 0; f < idx.length; f += 3) {
    const xs = [pos.getX(idx[f]), pos.getX(idx[f + 1]), pos.getX(idx[f + 2])];
    const ys = [pos.getY(idx[f]), pos.getY(idx[f + 1]), pos.getY(idx[f + 2])];
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const b0 = binOf(Math.min(...ys) - 0.01 * H), b1 = binOf(Math.max(...ys) + 0.01 * H);
    for (let b = b0; b <= b1; b++) {
      if (x1 > 0) rows[b].L.push([Math.max(0, x0), x1]);
      if (x0 < 0) rows[b].R.push([Math.max(0, -x1), -x0]);
    }
  }
  const hiBin = binOf(shoulderY - 0.04 * H);
  for (const side of ['L', 'R']) {
    const e = edge[side];
    for (let b = 1; b <= hiBin; b++) {
      const iv = rows[b][side].sort((p, q) => p[0] - q[0]);
      let end = -1;
      for (const [a, c] of iv) {
        if (end >= 0 && a - end > 0.01 * H && end > 0.04 * H) { e[b] = end; break; }
        end = Math.max(end, c);
      }
    }
    for (let b = 0; b < BINS; b++) if (e[b] > 0.2 * H) e[b] = NaN; // wider than a body: not an edge
    fillProfile(e);
  }
  if (over.torso) for (let b = 0; b < BINS; b++) edge.L[b] = edge.R[b] = Math.min(edge.L[b], over.torso * H);

  return {
    crotch, neck, shoulderY, edge,
    knee: crotch * 0.5,
    elbow: shoulderY - (shoulderY - crotch) * 0.42,
    weapon: over.weapon || 'R',
    style: over.style || 'gun',
  };
}

// Fill NaN holes by linear interpolation (constant past the ends), then a small median filter.
function fillProfile(e) {
  const known = [];
  for (let b = 0; b < e.length; b++) if (!Number.isNaN(e[b])) known.push(b);
  if (!known.length) { e.fill(0.1 * H); return; }
  for (let b = 0; b < e.length; b++) {
    if (!Number.isNaN(e[b])) continue;
    const k = known.findIndex(q => q > b);
    if (k === -1) e[b] = e[known[known.length - 1]];
    else if (k === 0) e[b] = e[known[0]];
    else { const a = known[k - 1], c = known[k]; e[b] = e[a] + (e[c] - e[a]) * (b - a) / (c - a); }
  }
  const src = Float32Array.from(e);
  for (let b = 1; b < e.length - 1; b++) e[b] = [src[b - 1], src[b], src[b + 1]].sort((p, q) => p - q)[1];
}

// Arms: everything beside the body edge below the shoulders, plus parts held far out up to the neck
// (A-pose arms, raised weapons). Upper arm vs forearm is decided later, by distance along the arm.
function labelVertex(J, x, y) {
  const side = x >= 0 ? 'L' : 'R', out = Math.abs(x) - J.edge[side][binOf(y)];
  if (y > J.neck) return B.head;
  if (out > 0.004 * H && (y < J.shoulderY + 0.02 * H || out > 0.08 * H)) return B['arm' + side];
  if (y < J.crotch) return y < J.knee ? B['shin' + side] : B['thigh' + side];
  return y < J.crotch + 0.08 * H ? B.hips : B.spine;
}

// Split each arm at the elbow (by distance from the shoulder, so hanging arms and A-pose arms both
// work) and measure how far the arm is raised from vertical: the animation lowers it to the side.
function splitArms(J, pos, n, ids, label) {
  for (const [s, sign] of [['L', 1], ['R', -1]]) {
    const arm = B['arm' + s], sx = J.edge[s][binOf(J.shoulderY - 0.05 * H)] * 0.85 * sign;
    const d = [], verts = [];
    for (let i = 0; i < n; i++) {
      if (label[ids[i]] !== arm) continue;
      verts.push(i);
      d.push(Math.hypot(pos.getX(i) - sx, pos.getY(i) - J.shoulderY));
    }
    if (!verts.length) { J[s + 'arm'] = { sx, len: 0.2 * H, angle: 0 }; continue; }
    const len = [...d].sort((a, b) => a - b)[Math.floor(d.length * 0.9)];
    let hx = 0, hy = 0, hn = 0;
    verts.forEach((i, k) => {
      if (d[k] > len * 0.45) {
        label[ids[i]] = B['fore' + s];
        hx += pos.getX(i); hy += pos.getY(i); hn++;
      }
    });
    const dx = hn ? Math.abs(hx / hn - sx) : 0, dy = hn ? J.shoulderY - hy / hn : 1;
    J[s + 'arm'] = { sx, len, angle: Math.atan2(dx, Math.max(dy, 1e-3)) };
  }
}

function autoRig(geo, over) {
  const J = fitJoints(geo, over);
  const pos = geo.attributes.position, n = pos.count;

  // welded ids: UV seams split vertices, but the surface is continuous across them
  const ids = new Uint32Array(n), keys = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let id = keys.get(key);
    if (id === undefined) { id = keys.size; keys.set(key, id); }
    ids[i] = id;
  }
  const m = keys.size, label = new Uint8Array(m);
  for (let i = 0; i < n; i++) label[ids[i]] = labelVertex(J, pos.getX(i), pos.getY(i));
  splitArms(J, pos, n, ids, label);

  // cut: drop faces joining an arm to anything but the torso at the shoulder, or leg to leg low down
  const src = geo.index.array, shoulderZone = J.shoulderY - 0.07 * H;
  const isCut = f => {
    const a = src[f], b = src[f + 1], c = src[f + 2];
    const ls = [label[ids[a]], label[ids[b]], label[ids[c]]];
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const sides = new Set(ls.map(armSide).filter(Boolean));
    const others = ls.filter(l => !armSide(l));
    if (sides.size === 2) return true;
    if (sides.size === 1 && others.length) {
      return !(others.every(l => l === B.spine) && ls.every(l => l !== B.foreL && l !== B.foreR) && cy > shoulderZone);
    }
    const legL = ls.some(l => l === B.thighL || l === B.shinL), legR = ls.some(l => l === B.thighR || l === B.shinR);
    return legL && legR && cy < J.crotch - 0.04 * H;
  };
  // Small islands left by the cut (a bit of boot past the body edge, a strap) go back to the part
  // they were cut from, then the cut is redone with the fixed labels.
  for (let pass = 0; pass < 2; pass++) {
    const nb = Array.from({ length: m }, () => []), across = [];
    for (let f = 0; f < src.length; f += 3) {
      const t = [ids[src[f]], ids[src[f + 1]], ids[src[f + 2]]];
      if (isCut(f)) across.push(t);
      else for (let j = 0; j < 3; j++) nb[t[j]].push(t[(j + 1) % 3], t[(j + 2) % 3]);
    }
    const comp = new Int32Array(m).fill(-1), sizes = [];
    for (let v = 0; v < m; v++) {
      if (comp[v] >= 0) continue;
      const stack = [v], id = sizes.length;
      comp[v] = id;
      let size = 0;
      while (stack.length) {
        const u = stack.pop(); size++;
        for (const q of nb[u]) if (comp[q] < 0) { comp[q] = id; stack.push(q); }
      }
      sizes.push(size);
    }
    const votes = new Map(); // small component -> {label: count} across cut faces
    for (const t of across) for (const u of t) {
      if (sizes[comp[u]] > m * 0.02) continue;
      for (const q of t) if (comp[q] !== comp[u]) {
        const v = votes.get(comp[u]) || new Map();
        v.set(label[q], (v.get(label[q]) || 0) + 1);
        votes.set(comp[u], v);
      }
    }
    if (!votes.size) break;
    const relabel = new Map([...votes].map(([c, v]) => [c, [...v].sort((p, q) => q[1] - p[1])[0][0]]));
    for (let v = 0; v < m; v++) if (relabel.has(comp[v])) label[v] = relabel.get(comp[v]);
  }
  const kept = [];
  for (let f = 0; f < src.length; f += 3) if (!isCut(f)) kept.push(src[f], src[f + 1], src[f + 2]);
  geo.setIndex(kept);
  J.cutFaces = (src.length - kept.length) / 3;

  // diffuse one-hot labels along the remaining surface
  const nb = Array.from({ length: m }, () => new Set());
  for (let f = 0; f < kept.length; f += 3) {
    const a = ids[kept[f]], b = ids[kept[f + 1]], c = ids[kept[f + 2]];
    nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b);
  }
  const NB = BONES.length;
  let w = new Float32Array(m * NB), tmp = new Float32Array(m * NB);
  for (let v = 0; v < m; v++) w[v * NB + label[v]] = 1;
  for (let it = 0; it < 14; it++) {
    for (let v = 0; v < m; v++) {
      const o = v * NB, list = nb[v];
      if (!list.size) { for (let k = 0; k < NB; k++) tmp[o + k] = w[o + k]; continue; }
      for (let k = 0; k < NB; k++) {
        let acc = 0;
        for (const u of list) acc += w[u * NB + k];
        tmp[o + k] = 0.5 * w[o + k] + 0.5 * acc / list.size;
      }
    }
    [w, tmp] = [tmp, w];
  }
  const idx = new Uint16Array(n * 4), wts = new Float32Array(n * 4), order = [...Array(NB).keys()];
  for (let i = 0; i < n; i++) {
    const o = ids[i] * NB;
    order.sort((p, q) => w[o + q] - w[o + p]);
    const sum = w[o + order[0]] + w[o + order[1]] + w[o + order[2]] + w[o + order[3]] || 1;
    for (let j = 0; j < 4; j++) { idx[i * 4 + j] = order[j]; wts[i * 4 + j] = w[o + order[j]] / sum; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));

  // joint positions: centroid of each part's vertices around the joint height
  const around = (bones, y, band = 0.03 * H) => {
    const c = new THREE.Vector3(); let k = 0;
    for (let i = 0; i < n; i++) {
      if (!bones.includes(label[ids[i]]) || Math.abs(pos.getY(i) - y) > band) continue;
      c.x += pos.getX(i); c.z += pos.getZ(i); k++;
    }
    return k ? c.divideScalar(k).setY(y) : null;
  };
  const side = (s, sign) => {
    const thigh = around([B['thigh' + s]], J.crotch - 0.03 * H) || new THREE.Vector3(sign * 0.05 * H, 0, 0);
    const shin = around([B['shin' + s], B['thigh' + s]], J.knee) || thigh.clone();
    // elbow: centre of the arm's cross-section at 45% of its length from the shoulder
    const A = J[s + 'arm'], elbow = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const l = label[ids[i]];
      if (l !== B['arm' + s] && l !== B['fore' + s]) continue;
      const d = Math.hypot(pos.getX(i) - A.sx, pos.getY(i) - J.shoulderY);
      if (Math.abs(d - A.len * 0.45) > 0.025 * H) continue;
      elbow.x += pos.getX(i); elbow.y += pos.getY(i); elbow.z += pos.getZ(i); k++;
    }
    if (k) elbow.divideScalar(k);
    else elbow.set(A.sx * 1.2, J.elbow, 0);
    return {
      thigh: thigh.setY(J.crotch), shin: shin.setY(J.knee),
      arm: new THREE.Vector3(A.sx, J.shoulderY, elbow.z),
      fore: elbow,
      armAngle: A.angle,
    };
  };
  J.L = side('L', 1);
  J.R = side('R', -1);
  J.labels = { ids, label }; // debug view
  return J;
}

function makeSkeleton(J) {
  const bones = BONES.map(name => Object.assign(new THREE.Bone(), { name }));
  const k = Object.fromEntries(bones.map(b => [b.name, b]));
  const place = (bone, parent, p) => {
    parent.add(bone);
    parent.updateWorldMatrix(true, false);
    bone.position.copy(parent.worldToLocal(p.clone()));
  };
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  place(k.hips, k.root, V(0, J.crotch + 0.04 * H));
  place(k.spine, k.hips, V(0, J.crotch + 0.1 * H));
  place(k.head, k.spine, V(0, J.neck));
  for (const s of ['L', 'R']) {
    place(k['thigh' + s], k.hips, J[s].thigh);
    place(k['shin' + s], k['thigh' + s], J[s].shin);
    place(k['arm' + s], k.spine, J[s].arm);
    place(k['fore' + s], k['arm' + s], J[s].fore);
  }
  for (const b of bones) b.userData.rest = b.position.clone();
  return new THREE.Skeleton(bones);
}

/* ------------------------------ look ------------------------------ */

// Average brightness of the painted texels (the atlas gaps are black), used to bring every
// figurine to the same exposure: the generated textures come out dark and with baked shading.
function textureGain(map) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(map.image, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0, cnt = 0;
    const lin = v => Math.pow(v / 255, 2.2);
    for (let i = 0; i < d.length; i += 4) {
      if (Math.max(d[i], d[i + 1], d[i + 2]) < 10) continue;
      sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      cnt++;
    }
    return THREE.MathUtils.clamp(0.2 / (sum / Math.max(cnt, 1)), 1, 2.4);
  } catch { return 1.5; }
}

// Painted-vinyl look: the texture carries the colours, a thin clear coat adds the figurine gloss.
// Exposure gain + a little self-lighting keep dark outfits readable from the high game camera and
// inside wall shadows. `emissive` stays free for the hit flash and frost tint in brawler.js.
function figurineMaterial(map, gain) {
  const rim = charMat(0xffffff);
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: 0.6, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.45 });
  const uGain = { value: gain };
  m.onBeforeCompile = (sh, r) => {
    rim.onBeforeCompile(sh, r);
    sh.uniforms.uGain = uGain;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGain;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = min( diffuseColor.rgb * uGain, vec3( 0.95 ) );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.28;');
  };
  m.customProgramCacheKey = () => 'figurine';
  rim.dispose();
  return m;
}

// root (spawn pop / hit squash, set by brawler.js) > body (hop) > skinned mesh + outline
export function buildFigurine(key) {
  const T = templates.get(key);
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const skeleton = makeSkeleton(T.joints);
  const mat = figurineMaterial(T.map, T.gain); // own material: hit flash and frost tint are per brawler
  const mesh = new THREE.SkinnedMesh(T.geo, mat);
  mesh.add(skeleton.bones[0]);
  mesh.bind(skeleton);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false; // bounds move with the pose
  const line = new THREE.SkinnedMesh(T.geo, outlineMaterial(0.02)); // finer than the rigs: lots of small details
  line.bind(skeleton, mesh.bindMatrix);
  line.frustumCulled = false;
  line.userData.outline = true;
  OUTLINES.add(line);
  body.add(mesh, line);
  const bones = Object.fromEntries(skeleton.bones.map(b => [b.name, b]));
  return { figurine: true, root, body, mesh, skeleton, bones, weapon: T.joints.weapon, style: T.joints.style, mats: [mat],
    // how far each arm must come down from its sculpted pose to hang at the side (A-pose models)
    lower: { L: Math.max(0, T.joints.L.armAngle - 0.18), R: Math.max(0, T.joints.R.armAngle - 0.18) } };
}
