import * as THREE from 'three';
import { mulberry } from './materials.js';

// Rounded outlines for tile sets (pond shores, frozen ponds, island coasts). The set is blurred into
// a soft field: the exact Gaussian blur of the union of its tile squares, plus a little noise. A
// level of it runs parallel to straight tile edges, rounds the corners off (inwards on convex ones,
// outwards on concave ones) and wobbles a bit, so a blocky pond reads as a natural one while it
// stays on its tiles give or take a few centimetres. Collision stays per tile; this is only drawn.
// The field is remapped so that the chosen outline (`level`) is always f = 0.5.

const RES = 6; // field samples per tile

// Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
function erf(x) {
  const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}
// inverse of the normal CDF (Winitzki's erfinv, good to ~0.2 %): distance from a blurred edge
export function probit(p) {
  const x = Math.min(0.9999, Math.max(-0.9999, 2 * p - 1)), l = Math.log(1 - x * x), a = 0.147, b = 2 / (Math.PI * a) + l / 2;
  return Math.SQRT2 * Math.sign(x) * Math.sqrt(Math.sqrt(b * b - l / a) - b);
}

function hash(i, j, s) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// smooth value noise in [0, 1)
export function noise2(x, z, s = 0) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export class TileField {
  // inside(i, j): is tile (i, j) in the set (also asked just outside the grid)
  // level < 0.5 pushes the outline off the set (its straight edges move out by ~0.25 sigma at 0.4)
  constructor(N, TILE, inside, { sigma = 0.65, level = 0.5, wobble = 0.07, seed = 1 } = {}) {
    const R = RES, S = N * R + 1, h = TILE / R, half = N * TILE / 2, pad = 3, T = N + 2 * pad, k = 1 / (sigma * Math.SQRT2);
    Object.assign(this, { N, TILE, R, S, h, half, sigma, level });
    // the blur is separable: weight of tile column t at sample s, times the same for rows
    const g = new Float32Array(T * S);
    for (let t = 0; t < T; t++) {
      const a = (t - pad) * TILE - half, b = a + TILE;
      for (let s = 0; s < S; s++) { const x = s * h - half; g[t * S + s] = 0.5 * (erf((b - x) * k) - erf((a - x) * k)); }
    }
    const ind = new Uint8Array(T * T);
    for (let tj = 0; tj < T; tj++) for (let ti = 0; ti < T; ti++) ind[tj * T + ti] = inside(ti - pad, tj - pad) ? 1 : 0;
    const f = this.f = new Float32Array(S * S), reach = Math.min(pad, Math.ceil(3 * sigma / TILE)); // farther tiles weigh < 1e-4
    for (let sz = 0; sz < S; sz++) {
      const cj = Math.floor(sz / R) + pad;
      for (let sx = 0; sx < S; sx++) {
        const ci = Math.floor(sx / R) + pad;
        let v = 0;
        for (let tj = cj - reach; tj <= cj + reach; tj++) {
          if (tj < 0 || tj >= T) continue;
          const gz = g[tj * S + sz];
          if (gz < 1e-5) continue;
          for (let ti = ci - reach; ti <= ci + reach; ti++) if (ti >= 0 && ti < T && ind[tj * T + ti]) v += g[ti * S + sx] * gz;
        }
        const x = sx * h - half, z = sz * h - half;
        // two octaves of wobble; it only moves the outline, the flat inside and outside stay 1 and 0
        const n = noise2(x * 0.45, z * 0.45, seed) * 0.7 + noise2(x * 1.1, z * 1.1, seed + 1) * 0.3 - 0.5;
        v = Math.min(1, Math.max(0, v + n * wobble * 2 * Math.max(0, 1 - Math.abs(v - level) * 2)));
        f[sz * S + sx] = v < level ? 0.5 * v / level : 0.5 + 0.5 * (v - level) / (1 - level);
      }
    }
  }

  // signed distance (m) from the outline for a field value, > 0 on the inside: the blur of a
  // straight edge is the normal CDF of the distance to it
  dist(f) {
    const L = this.level, v = f < 0.5 ? 2 * f * L : L + (f - 0.5) * 2 * (1 - L);
    return this.sigma * (probit(v) - probit(L));
  }

  // bilinear sample at a world point
  at(x, z) {
    const { S, h, half, f } = this;
    const u = Math.min(S - 1.001, Math.max(0, (x + half) / h)), v = Math.min(S - 1.001, Math.max(0, (z + half) / h));
    const a = Math.floor(u), b = Math.floor(v), fu = u - a, fv = v - b, o = b * S + a;
    return (f[o] * (1 - fu) + f[o + 1] * fu) * (1 - fv) + (f[o + S] * (1 - fu) + f[o + S + 1] * fu) * fv;
  }

  // The part of the arena where lo <= field < hi, as an indexed triangle list (x, y, z) with the
  // field value per vertex. keep(i, j, x, z): which tile a cell belongs to may be filtered;
  // y(x, z, v): height; whole(min, max): a tile fully inside may be one quad (the height is flat there).
  band(lo, hi, { keep = null, y = () => 0, whole = () => true } = {}) {
    const { N, TILE, R, S, h, half, f } = this, pos = [], val = [], idx = [], seen = new Map();
    const vert = (x, z, v) => {
      const key = (Math.round(x * 1000) + 40000) * 80001 + Math.round(z * 1000) + 40000;
      let k = seen.get(key);
      if (k === undefined) { k = val.length; seen.set(key, k); pos.push(x, y(x, z, v), z); val.push(v); }
      return k;
    };
    const tri = (a, b, c) => { // counter-clockwise seen from above: the normal points up
      const ax = pos[a * 3], az = pos[a * 3 + 2];
      const cr = (pos[b * 3] - ax) * (pos[c * 3 + 2] - az) - (pos[b * 3 + 2] - az) * (pos[c * 3] - ax);
      if (Math.abs(cr) < 1e-7) return;
      if (cr > 0) idx.push(a, c, b); else idx.push(a, b, c);
    };
    const clip = (poly, lvl, above) => {
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        const A = poly[k], B = poly[(k + 1) % poly.length], ia = above ? A[2] >= lvl : A[2] < lvl, ib = above ? B[2] >= lvl : B[2] < lvl;
        if (ia) out.push(A);
        if (ia !== ib) { const t = (lvl - A[2]) / (B[2] - A[2]); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, lvl]); }
      }
      return out;
    };
    const fill = poly => {
      if (lo > -Infinity) poly = clip(poly, lo, true);
      if (poly.length > 2 && hi < Infinity) poly = clip(poly, hi, false);
      if (poly.length < 3) return;
      const ids = poly.map(([x, z, v]) => vert(x, z, v));
      for (let k = 1; k < ids.length - 1; k++) tri(ids[0], ids[k], ids[k + 1]);
    };
    for (let tj = 0; tj < N; tj++) for (let ti = 0; ti < N; ti++) {
      let mn = Infinity, mx = -Infinity;
      for (let b = 0; b <= R; b++) for (let a = 0; a <= R; a++) { const v = f[(tj * R + b) * S + ti * R + a]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mx < lo || mn >= hi) continue;
      const x0 = ti * TILE - half, z0 = tj * TILE - half;
      if (mn >= lo && mx < hi && whole(mn, mx) && (!keep || keep(ti, tj, x0 + TILE / 2, z0 + TILE / 2))) {
        const o = tj * R * S + ti * R;
        const p = [vert(x0, z0, f[o]), vert(x0 + TILE, z0, f[o + R]), vert(x0 + TILE, z0 + TILE, f[o + R * S + R]), vert(x0, z0 + TILE, f[o + R * S])];
        tri(p[0], p[1], p[2]); tri(p[0], p[2], p[3]);
        continue;
      }
      for (let b = 0; b < R; b++) for (let a = 0; a < R; a++) {
        const o = (tj * R + b) * S + ti * R + a, v00 = f[o], v10 = f[o + 1], v01 = f[o + S], v11 = f[o + S + 1];
        const cmn = Math.min(v00, v10, v01, v11), cmx = Math.max(v00, v10, v01, v11);
        if (cmx < lo || cmn >= hi) continue;
        const x = x0 + a * h, z = z0 + b * h;
        if (keep && !keep(ti, tj, x + h / 2, z + h / 2)) continue;
        const p00 = [x, z, v00], p10 = [x + h, z, v10], p01 = [x, z + h, v01], p11 = [x + h, z + h, v11];
        if (cmn >= lo && cmx < hi) { fill([p00, p10, p11, p01]); continue; }
        fill([p00, p10, p11]); fill([p00, p11, p01]);
      }
    }
    return { pos, val, idx };
  }

  // Points where the field crosses `level`, with the outward normal (towards lower values):
  // where to line a shore with pebbles and reeds.
  edge(level) {
    const { S, h, half, f } = this, out = [];
    const push = (x, z) => {
      const gx = this.at(x + 0.1, z) - this.at(x - 0.1, z), gz = this.at(x, z + 0.1) - this.at(x, z - 0.1), l = Math.hypot(gx, gz) || 1;
      out.push([x, z, -gx / l, -gz / l]);
    };
    for (let sz = 0; sz < S; sz++) for (let sx = 0; sx < S; sx++) {
      const o = sz * S + sx, v = f[o] - level, x = sx * h - half, z = sz * h - half;
      if (sx < S - 1 && v * (f[o + 1] - level) < 0) push(x + h * v / (v - f[o + 1] + level), z);
      if (sz < S - 1 && v * (f[o + S] - level) < 0) push(x, z + h * v / (v - f[o + S] + level));
    }
    return out;
  }
}

// Band -> BufferGeometry with world-space UVs (uv(x, z) -> [u, v]). Normals: straight up if flat,
// else smoothed from the faces.
export function bandGeometry({ pos, idx }, uv, flat = false, flip = false) {
  const g = new THREE.BufferGeometry(), n = pos.length / 3, uvs = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) { const [u, v] = uv(pos[k * 3], pos[k * 3 + 2]); uvs[k * 2] = u; uvs[k * 2 + 1] = v; }
  if (flip) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  if (flat) g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  else g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Shore dressing: rounded pebbles and reed clumps along a shoreline   */
/* ------------------------------------------------------------------ */

// A clump of thin reeds, a few with a cattail head; vertex colours from root to tip.
function reedGeometry(root, tip, heads) {
  const r = mulberry(11), pos = [], col = [], cr = new THREE.Color(root), ct = new THREE.Color(tip), ch = new THREE.Color(0x5a3a22);
  const quad = (a, b, c, d, ca, cb) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (const c of [ca, ca, cb, ca, cb, cb]) col.push(c.r, c.g, c.b); };
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2, d = r() * 0.16, x = Math.cos(a) * d, z = Math.sin(a) * d, H = 0.45 + r() * 0.45;
    const lean = 0.1 + r() * 0.2, lx = Math.cos(a) * lean, lz = Math.sin(a) * lean, w = 0.035 + r() * 0.02, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const mid = [x + lx * 0.3, H * 0.55, z + lz * 0.3], top = [x + lx, H, z + lz];
    quad([x - px, 0, z - pz], [x + px, 0, z + pz], [mid[0] + px * 0.7, mid[1], mid[2] + pz * 0.7], [mid[0] - px * 0.7, mid[1], mid[2] - pz * 0.7], cr, cr.clone().lerp(ct, 0.55));
    quad([mid[0] - px * 0.7, mid[1], mid[2] - pz * 0.7], [mid[0] + px * 0.7, mid[1], mid[2] + pz * 0.7], top, top, cr.clone().lerp(ct, 0.55), ct);
    if (heads && k % 3 === 0) { // cattail: a brown sausage near the top, as a cross of two quads
      const hy = H * 0.78, hx = x + lx * 0.8, hz = z + lz * 0.8, hw = 0.05;
      quad([hx - hw, hy - 0.1, hz], [hx + hw, hy - 0.1, hz], [hx + hw, hy + 0.1, hz], [hx - hw, hy + 0.1, hz], ch, ch);
      quad([hx, hy - 0.1, hz - hw], [hx, hy - 0.1, hz + hw], [hx, hy + 0.1, hz + hw], [hx, hy + 0.1, hz - hw], ch, ch);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // thin blades light like the ground below them instead of flickering face by face
  const n = g.attributes.normal;
  for (let k = 0; k < n.count; k++) {
    const x = n.getX(k) * 0.3, z = n.getZ(k) * 0.3, l = Math.hypot(x, 1, z);
    n.setXYZ(k, x / l, 1 / l, z / l);
  }
  return g;
}

const SHORE_STYLE = {
  oasis: { pebble: [0xd9a47c, 0xc4876a, 0xe8c29a], reed: [0x6f8f3a, 0xd0c060], heads: false },
  grove: { pebble: [0x8d9088, 0x7a7d76, 0xa3a59c], reed: [0x2f5a2a, 0x86b24e], heads: false },
  marsh: { pebble: [0x6d6a5e, 0x7c7666, 0x5d5a50], reed: [0x4a5528, 0xa8a45a], heads: true },
  ice: { pebble: [0xb4c2d6, 0xa2b1c8, 0xd4def0], reed: null },
};

// Pebbles on the bank and reeds at the waterline of every shore where `field` crosses `level`
// (on the side of the lower values). near(x, z): only shores of this kind of pond.
export function shoreDecor(group, field, { style = 'grove', level = 0.5, near = () => true, bank = 0.3, seed = 5 } = {}) {
  const S = SHORE_STYLE[style] || SHORE_STYLE.grove, rnd = mulberry(seed), pts = field.edge(level).filter(([x, z]) => near(x, z));
  if (!pts.length) return;
  // shuffle, then keep the points far enough from each other
  for (let k = pts.length - 1; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [pts[k], pts[m]] = [pts[m], pts[k]]; }
  const spaced = (min, n) => {
    const out = [];
    for (const p of pts) if (out.length < n && out.every(q => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 > min * min)) out.push(p);
    return out;
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const peb = spaced(0.9, 90);
  if (peb.length) {
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85 }), peb.length);
    peb.forEach(([x, z, nx, nz], k) => {
      const d = bank * (0.2 + rnd() * 0.9), r = 0.1 + rnd() * 0.16;
      _q.setFromAxisAngle(up, rnd() * 6.28);
      _m.compose(_v.set(x - nx * d, 0.01, z - nz * d), _q, _s.set(r * (1 + rnd() * 0.5), r * 0.55, r));
      mesh.setMatrixAt(k, _m);
      mesh.setColorAt(k, _c.setHex(S.pebble[k % S.pebble.length]).multiplyScalar(0.9 + rnd() * 0.2));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  if (!S.reed) return;
  const reeds = spaced(1.6, 40).filter(() => rnd() < 0.7);
  if (!reeds.length) return;
  const mesh = new THREE.InstancedMesh(reedGeometry(S.reed[0], S.reed[1], S.heads),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), reeds.length);
  reeds.forEach(([x, z, nx, nz], k) => {
    const d = (rnd() - 0.35) * 0.5, s = 0.8 + rnd() * 0.5; // mostly in the shallows, some on the bank
    _q.setFromAxisAngle(up, rnd() * 6.28);
    _m.compose(_v.set(x + nx * d, -0.12, z + nz * d), _q, _s.set(s, s, s));
    mesh.setMatrixAt(k, _m);
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}
