import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry } from './materials.js';

// Smooth, position-based pseudo noise: shared vertices of the non-indexed icospheres get the
// same displacement, so clumps stay watertight.
const n3 = (x, y, z) => Math.sin(x * 1.7 + y * 2.3) * Math.sin(y * 1.9 + z * 2.9) * Math.sin(z * 2.1 + x * 1.3);
const _v = new THREE.Vector3(), _n = new THREE.Vector3();

// One leaf clump: a lumpy icosphere with analytic sphere normals (soft shading) and baked
// vertex colours that darken toward the ground and the underside (cheap occlusion).
function clump(rad, cx, cy, cz, color, { bump = 0.13, bottom = 0, top = 2 } = {}) {
  const g = new THREE.IcosahedronGeometry(rad, 1);
  const p = g.attributes.position, nor = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    _n.fromBufferAttribute(p, i).normalize();
    const d = 1 + n3(_n.x * 3 + cx, _n.y * 3 + cy, _n.z * 3 + cz) * bump;
    _v.copy(_n).multiplyScalar(rad * d);
    p.setXYZ(i, _v.x + cx, _v.y + cy, _v.z + cz);
    nor.setXYZ(i, _n.x, _n.y, _n.z);
    const h = THREE.MathUtils.clamp((_v.y + cy - bottom) / (top - bottom), 0, 1);
    const f = (0.5 + 0.55 * h) * (0.78 + 0.22 * (_n.y * 0.5 + 0.5));
    col[i * 3] = color.r * f; col[i * 3 + 1] = color.g * f; col[i * 3 + 2] = color.b * f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function gradient(g, bottom, top, lo = 0.55) {
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const f = lo + (1 - lo) * THREE.MathUtils.clamp((p.getY(i) - bottom) / (top - bottom), 0, 1);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const GREENS = [0x3e9a38, 0x4caf42, 0x2f8a33, 0x58bd4a].map(h => new THREE.Color(h));

// Bush for one 2x2 tile: a low ring of clumps plus a crown, overlapping its neighbours.
export function bushGeometry(seed = 7) {
  const r = mulberry(seed), parts = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + r() * 0.4, d = 0.55 + r() * 0.25;
    parts.push(clump(0.47 + r() * 0.17, Math.cos(a) * d, 0.46 + r() * 0.15, Math.sin(a) * d, GREENS[k % 4], { top: 1.7 }));
  }
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + r(), d = k === 0 ? 0 : 0.28 + r() * 0.15;
    parts.push(clump(0.48 + r() * 0.15, Math.cos(a) * d, 0.92 + r() * 0.3, Math.sin(a) * d, GREENS[(k + 1) % 4], { top: 1.7 }));
  }
  return mergeGeometries(parts);
}

// Broadleaf tree: tapered trunk with two branches, crown of big clumps.
export function roundTree(seed = 3) {
  const r = mulberry(seed);
  const trunk = [
    new THREE.CylinderGeometry(0.17, 0.3, 2.3, 9).translate(0, 1.15, 0),
    new THREE.CylinderGeometry(0.36, 0.48, 0.28, 9).translate(0, 0.14, 0),
  ];
  for (const s of [-1, 1]) {
    const b = new THREE.CylinderGeometry(0.06, 0.11, 1.0, 6);
    b.translate(0, 0.5, 0).rotateZ(s * 0.75).translate(s * 0.08, 1.6, 0);
    trunk.push(b);
  }
  const crown = [clump(1.05, 0, 2.75, 0, GREENS[1], { bottom: 1.6, top: 4 })];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + r() * 0.5, d = 0.75 + r() * 0.2;
    crown.push(clump(0.68 + r() * 0.2, Math.cos(a) * d, 2.35 + r() * 0.35, Math.sin(a) * d, GREENS[k % 4], { bottom: 1.6, top: 4 }));
  }
  crown.push(clump(0.72, 0.2, 3.4, -0.15, GREENS[3], { bottom: 1.6, top: 4 }));
  return {
    trunk: gradient(mergeGeometries(trunk.map(g => g.toNonIndexed())), 0, 2.3),
    crown: mergeGeometries(crown),
  };
}

// Pine: stacked, slightly twisted cones.
export function pineTree(seed = 5) {
  const r = mulberry(seed), dark = new THREE.Color(0x2c7a48), light = new THREE.Color(0x3f9a55);
  const tiers = [[1.25, 1.5, 1.35], [1.0, 1.3, 2.05], [0.76, 1.1, 2.7], [0.48, 0.9, 3.25]].map(([rad, h, y], k) => {
    const g = new THREE.ConeGeometry(rad, h, 9, 1).toNonIndexed();
    g.rotateY(r() * 3).translate((r() - 0.5) * 0.08, y, (r() - 0.5) * 0.08);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), c = k % 2 ? light : dark;
    for (let i = 0; i < p.count; i++) {
      const f = 0.55 + 0.5 * THREE.MathUtils.clamp((p.getY(i) - (y - h / 2)) / h, 0, 1) * (0.7 + 0.3 * (k / 3));
      col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return {
    trunk: gradient(new THREE.CylinderGeometry(0.13, 0.22, 1.5, 7).translate(0, 0.75, 0).toNonIndexed(), 0, 1.5),
    crown: mergeGeometries(tiers),
  };
}

/* ------------------------------------------------------------------ */
/* Decor for the other biomes                                          */
/* ------------------------------------------------------------------ */

function colorize(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(c, p.getX(i), p.getY(i), p.getZ(i), n.getY(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Ribbed saguaro: capsules with radial ridges, two arms.
export function cactusGeometry(seed = 1, height = 1.9) {
  const r = mulberry(seed), green = new THREE.Color(0x3f8f4a), tip = new THREE.Color(0x7cc35a);
  const rib = (g, rad) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.12 * Math.cos(a * 8);
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const body = rib(new THREE.CapsuleGeometry(0.3, height - 0.6, 4, 16), 0.3).translate(0, height / 2, 0);
  const parts = [body];
  for (const s of [-1, 1]) {
    const h = 0.45 + r() * 0.35, y = height * (0.35 + r() * 0.2);
    const elbow = rib(new THREE.CapsuleGeometry(0.16, 0.34, 3, 12), 0.16).rotateZ(Math.PI / 2).translate(s * 0.4, y, 0);
    const up = rib(new THREE.CapsuleGeometry(0.16, h, 3, 12), 0.16).translate(s * 0.6, y + h / 2 + 0.05, 0);
    parts.push(elbow, up);
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  return colorize(g, (c, x, y) => c.copy(green).lerp(tip, THREE.MathUtils.clamp(y / (height + 0.4), 0, 1) * 0.6).multiplyScalar(0.75 + 0.25 * Math.min(1, y / 0.6)));
}

// Leafless, twisted tree for the marsh / desert edges.
export function deadTree(seed = 2) {
  const r = mulberry(seed), parts = [new THREE.CylinderGeometry(0.14, 0.3, 2.6, 8).translate(0, 1.3, 0)];
  for (let k = 0; k < 5; k++) {
    const len = 0.7 + r() * 0.8, y = 1.2 + r() * 1.3, a = r() * Math.PI * 2;
    const b = new THREE.CylinderGeometry(0.03, 0.08, len, 5).translate(0, len / 2, 0);
    b.rotateZ(0.6 + r() * 0.5).rotateY(a).translate(0, y, 0);
    parts.push(b);
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  const bark = new THREE.Color(0x5e5046);
  return colorize(g, (c, x, y) => c.copy(bark).multiplyScalar(0.55 + 0.45 * Math.min(1, y / 2.6)));
}

// In-arena obstacles ('K' tiles): one indestructible prop per biome.
export function obstacleGeometry(kind) {
  if (kind === 'cactus') return cactusGeometry(9, 1.8);
  if (kind === 'stump') {
    const g = mergeGeometries([
      new THREE.CylinderGeometry(0.62, 0.75, 0.9, 12).translate(0, 0.45, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.8, 0.95, 0.18, 12).translate(0, 0.09, 0).toNonIndexed(),
    ]);
    const bark = new THREE.Color(0x6b4a30), ring = new THREE.Color(0xc9a06a), moss = new THREE.Color(0x5e8a3a);
    return colorize(g, (c, x, y, z, ny) => {
      if (ny > 0.9 && y > 0.85) c.copy(ring).multiplyScalar(0.8 + 0.2 * Math.cos(Math.hypot(x, z) * 25));
      else c.copy(bark).lerp(moss, y < 0.3 ? 0.5 : 0).multiplyScalar(0.7 + 0.3 * y);
    });
  }
  // rock / boulder: lumpy icosphere, snow capped for the boulder
  const g = new THREE.IcosahedronGeometry(0.85, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _n.fromBufferAttribute(p, i).normalize();
    const d = 0.85 * (1 + n3(_n.x * 2.5, _n.y * 2.5, _n.z * 2.5) * 0.18);
    p.setXYZ(i, _n.x * d * 1.1, Math.max(-0.1, _n.y * d * 0.85) + 0.55, _n.z * d);
  }
  g.computeVertexNormals();
  const stone = new THREE.Color(kind === 'boulder' ? 0x8e97a8 : 0x9a8f86), snow = new THREE.Color(0xf4f7ff);
  return colorize(g, (c, x, y, z, ny) => {
    c.copy(stone).multiplyScalar(0.7 + 0.3 * Math.min(1, y / 1.2));
    if (kind === 'boulder' && ny > 0.45) c.copy(snow);
  });
}
