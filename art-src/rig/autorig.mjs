import * as THREE from 'three';

// Skin weights for the image-to-3D figurines (art-src/figurines/*.glb), used by export_rig.mjs.
// The generated meshes come without a skeleton: joint heights are read off the mesh (crotch = where
// the gap between the legs closes, neck = where the big chibi head narrows, torso width = the gap
// between body and arms), then every vertex gets smooth weights for hips / spine / head / legs /
// arms. rig_blender.py turns those into a standard humanoid armature.

export const HEIGHT = 2.5; // game units, same size as the procedural rigs in src/models.js
const H = HEIGHT;

// Per-model joint overrides (fractions of the height) when the automatic fit needs help.
export const OVERRIDES = {};

export const BONES = ['root', 'hips', 'spine', 'head', 'thighL', 'shinL', 'thighR', 'shinR', 'armL', 'foreL', 'armR', 'foreR'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));

// Mesh of a loaded figurine scene -> float geometry, feet on the ground, HEIGHT tall, smooth
// normals, skin weights (cut faces removed from the index). Returns { geo, joints }.
export function rigFigurine(scene, over = {}) {
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
  const joints = autoRig(geo, over);
  return { geo, joints };
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
  if (y <= J.neck && out > 0.004 * H && (y < J.shoulderY + 0.02 * H || out > 0.08 * H)) return B['arm' + side];
  return labelBody(J, x, y);
}

// the same without arms: head, legs, pelvis, chest
function labelBody(J, x, y) {
  const side = x >= 0 ? 'L' : 'R';
  if (y > J.neck) return B.head;
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
  const m = keys.size, label = new Uint8Array(m), wx = new Float32Array(m), wy = new Float32Array(m);
  for (let i = 0; i < n; i++) {
    label[ids[i]] = labelVertex(J, pos.getX(i), pos.getY(i));
    wx[ids[i]] = pos.getX(i); wy[ids[i]] = pos.getY(i);
  }
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
    // False arms: an arm is hung from the shoulder, so an arm-labelled piece that never gets near
    // shoulder height is really part of a leg or the torso (a strap or pouch fooled the edge test)
    const armTop = new Float32Array(sizes.length).fill(-Infinity);
    for (let v = 0; v < m; v++) if (armSide(label[v])) armTop[comp[v]] = Math.max(armTop[comp[v]], wy[v]);
    let fixedArms = false;
    for (let v = 0; v < m; v++) {
      if (!armSide(label[v]) || armTop[comp[v]] > J.shoulderY - 0.12 * H) continue;
      label[v] = labelBody(J, wx[v], wy[v]);
      fixedArms = true;
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
    if (!votes.size && !fixedArms) break;
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
    const armAngle = Math.atan2(Math.abs(elbow.x - A.sx), Math.max(J.shoulderY - elbow.y, 1e-3));
    return {
      thigh: thigh.setY(J.crotch), shin: shin.setY(J.knee),
      arm: new THREE.Vector3(A.sx, J.shoulderY, elbow.z),
      fore: elbow,
      armAngle,
    };
  };
  J.L = side('L', 1);
  J.R = side('R', -1);

  // Weapon axis per arm: principal direction of the forearm + hand + weapon, pointing to the far
  // end (the barrel tip is the point furthest from the elbow). The animation aims this axis.
  for (const s of ['L', 'R']) {
    const elbow = J[s].fore, pts = [];
    for (let i = 0; i < n; i++) if (label[ids[i]] === B['fore' + s]) pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    J[s].armAxis = J[s].fore.clone().sub(J[s].arm).normalize();
    J[s].weaponAxis = pts.length > 20 ? principalAxis(pts, elbow) : J[s].armAxis.clone();
  }
  J.labels = { ids, label }; // debug view
  return J;
}

function principalAxis(pts, from) {
  const c = new THREE.Vector3();
  pts.forEach(p => c.add(p));
  c.divideScalar(pts.length);
  // covariance + power iteration
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of pts) {
    const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  const v = new THREE.Vector3(1, -1, 0.5).normalize(), t = new THREE.Vector3();
  for (let k = 0; k < 30; k++) {
    t.set(xx * v.x + xy * v.y + xz * v.z, xy * v.x + yy * v.y + yz * v.z, xz * v.x + yz * v.y + zz * v.z);
    v.copy(t).normalize();
  }
  let far = 0;
  for (const p of pts) { const d = t.subVectors(p, from).dot(v); if (Math.abs(d) > Math.abs(far)) far = d; }
  return far < 0 ? v.negate() : v;
}

