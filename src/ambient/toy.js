import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Chunky vertex-coloured models from primitives, for the ambient fauna (the toy / figurine look).
// Kept apart from index.js so node scripts can build the models too.
const _r = new THREE.Matrix4(), _e = new THREE.Euler();
const SHAPES = {
  box: ([x = 1, y = 1, z = 1]) => new THREE.BoxGeometry(x, y, z),
  sphere: ([r = 0.5, sx = 1, sy = 1, sz = 1]) => new THREE.IcosahedronGeometry(r, 1).scale(sx, sy, sz),
  cone: ([r = 0.5, h = 1, seg = 6]) => new THREE.ConeGeometry(r, h, seg),
  cyl: ([r1 = 0.5, r2 = 0.5, h = 1, seg = 8]) => new THREE.CylinderGeometry(r1, r2, h, seg),
  tri: ([w = 1, l = 1]) => { // a flat triangle in XZ, tip toward +x (wings, fins, ears)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, l * 0.5, 0, 0, -l * 0.5, w, 0, 0], 3));
    g.computeVertexNormals();
    return g;
  },
};


// Merge primitives into one vertex-coloured geometry. parts: [{ shape, args, pos, rot, color }]
// shape: box [x,y,z] | sphere [r, sx, sy, sz] | cone [r, h, seg] | cyl [r1, r2, h, seg] | tri [w, l]
export function toy(parts) {
  const geos = parts.map(p => {
    let g = SHAPES[p.shape](p.args || []);
    if (g.index) g = g.toNonIndexed();
    if (p.rot) g.applyMatrix4(_r.makeRotationFromEuler(_e.set(...p.rot)));
    if (p.pos) g.translate(...p.pos);
    const c = new THREE.Color(p.color ?? 0xffffff), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const out = mergeGeometries(geos);
  geos.forEach(g => g.dispose());
  out.computeVertexNormals();
  return out;
}
