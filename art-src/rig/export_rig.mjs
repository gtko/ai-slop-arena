// Step 1 of the character rig: static figurine GLB -> mesh + skin weights + joints for Blender.
//   art-src/figurines/<key>.glb -> art-src/rig/work/<key>.json + <key>.webp
// Usage: node art-src/rig/export_rig.mjs [keys...]    (then: blender -b -P art-src/rig/rig_blender.py)
import fs from 'fs';
globalThis.self ??= globalThis; // GLTFLoader looks for self.URL (the texture itself fails to decode: not needed here)
import path from 'path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { rigFigurine, BONES, HEIGHT, OVERRIDES } from './autorig.mjs';

// Which hand holds the weapon (R = the character's right = -x, models face +z) and how it attacks.
export const RIGS = {
  blaster: { weapon: 'R', style: 'gun' },
  gunslinger: { weapon: 'both', style: 'gun' },
  bomber: { weapon: 'L', style: 'throw' },
  frostbite: { weapon: 'R', style: 'staff' },
  volt: { weapon: 'both', style: 'cast' },
};

const SRC = 'art-src/figurines', OUT = 'art-src/rig/work', MARKS = 'art-src/rig/landmarks';
fs.mkdirSync(OUT, { recursive: true });
const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RIGS);

const round = (a, d = 5) => Array.from(a, v => +v.toFixed(d));
const vec = v => round(v.toArray());

// the embedded texture, straight from the GLB's binary chunk
function glbImage(buf) {
  const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const bin = 20 + jsonLen + 8, img = json.images[0], bv = json.bufferViews[img.bufferView];
  return { mime: img.mimeType, data: buf.subarray(bin + (bv.byteOffset || 0), bin + (bv.byteOffset || 0) + bv.byteLength) };
}

for (const key of keys) {
  const buf = fs.readFileSync(path.join(SRC, `${key}.glb`));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  // landmarks/<key>.json "fit": crotch / neck / torso as fractions of the height, for the cut
  const marks = fs.existsSync(path.join(MARKS, `${key}.json`)) ? JSON.parse(fs.readFileSync(path.join(MARKS, `${key}.json`), 'utf8')) : {};
  const { geo, joints: J } = rigFigurine(gltf.scene, { ...RIGS[key], ...OVERRIDES[key], ...marks.fit });
  const side = s => ({
    thigh: vec(J[s].thigh), shin: vec(J[s].shin), arm: vec(J[s].arm), fore: vec(J[s].fore),
    armAxis: vec(J[s].armAxis), weaponAxis: vec(J[s].weaponAxis),
  });
  const a = geo.attributes, img = glbImage(buf);
  const out = {
    key, height: HEIGHT, bones: BONES, weapon: J.weapon, style: J.style,
    joints: { crotch: J.crotch, knee: J.knee, neck: J.neck, shoulderY: J.shoulderY, L: side('L'), R: side('R') },
    position: round(a.position.array), normal: round(a.normal.array, 4), uv: round(a.uv.array),
    index: Array.from(geo.index.array),
    skinIndex: Array.from(a.skinIndex.array), skinWeight: round(a.skinWeight.array, 4),
    // body part of each vertex before the weights are blurred (index into bones): rig_blender.py
    // weights every part along its own chain
    part: Array.from({ length: a.position.count }, (_, i) => J.labels.label[J.labels.ids[i]]),
    texture: `${key}.${img.mime.split('/')[1]}`,
  };
  fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(out));
  fs.writeFileSync(path.join(OUT, out.texture), img.data);
  console.log(key, a.position.count, 'verts', geo.index.count / 3, 'tris', J.cutFaces, 'cut');
}
