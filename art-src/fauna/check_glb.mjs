// Loads packed fauna GLBs with three.js' GLTFLoader + meshopt, as the game does, and plays every
// clip on a mixer: bounds at rest, clip names / durations, the armature extras.
// Usage: node art-src/fauna/check_glb.mjs [keys...]   (three from node_modules, or NODE_PATH)
import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// no DOM here: textures resolve to a 1x1 bitmap (only the geometry and clips are checked)
globalThis.self ??= globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['duck', 'hen', 'penguin', 'sparrow'];
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
for (const key of keys) {
  const buf = fs.readFileSync(`public/assets/models/fauna/${key}.glb`);
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const scene = gltf.scene;
  let mesh = null, rig = null;
  scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; if (o.userData?.speed) rig = o; });
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh, true);
  const mixer = new THREE.AnimationMixer(scene);
  const clips = gltf.animations.map(c => {
    mixer.stopAllAction();
    mixer.clipAction(c).play();
    mixer.setTime(c.duration / 2);
    scene.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh, true);
    return `${c.name} ${c.duration.toFixed(2)}s (mid-clip y ${b.min.y.toFixed(3)}..${b.max.y.toFixed(3)})`;
  });
  console.log(key, `${(buf.length / 1024).toFixed(0)} KB, ${mesh.geometry.index.count / 3} tris, ${mesh.skeleton.bones.length} bones`,
    `rest ${box.min.toArray().map(v => v.toFixed(3))} .. ${box.max.toArray().map(v => v.toFixed(3))}`,
    'speed', JSON.stringify(rig?.userData.speed));
  for (const c of clips) console.log('  ', c);
}
