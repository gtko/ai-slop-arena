import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ASSET_BASE } from './assets.js';
import { charMat, shared } from './materials.js';

// Decor props sculpted by the local image -> 3D pipeline (art-src/ai3d: Hunyuan3D-2 shape + paint on
// this machine's GPU), from reference art in the same style as the chibi figurines. Each GLB is one
// textured mesh; it is loaded once, set on the ground and centred on its footprint, then arena.js
// instances it (one draw per prop type). A missing file keeps the procedural geometry.

export const PROPS = [
  'tree_round', 'tree_pine', 'tree_pine_snow', 'tree_dead', 'cactus', 'rock_canyon', 'boulder', 'boulder_snow',
  'stump', 'crate', 'wall_canyon', 'wall_moss', 'wall_ice', 'bush', 'lantern',
];
const SWAY = new Set(['tree_round', 'tree_pine', 'tree_pine_snow', 'tree_dead', 'bush', 'cactus']);
const loaded = new Map(); // name -> { geo, size, mat, depth }

export function preloadProps(renderer) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return Promise.all(PROPS.map(name => loader.loadAsync(`${ASSET_BASE}models/decor/${name}.glb`)
    .then(gltf => loaded.set(name, prepare(name, gltf.scene, aniso)))
    .catch(() => { /* not generated yet: procedural fallback */ })));
}

export const hasProp = name => loaded.has(name);

function prepare(name, scene, aniso) {
  let mesh = null;
  scene.updateMatrixWorld(true);
  scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  // expand quantised attributes to floats, bake the node transform
  const src = mesh.geometry, geo = new THREE.BufferGeometry();
  for (const [attr, V] of [['position', THREE.Vector3], ['normal', THREE.Vector3], ['uv', THREE.Vector2]]) {
    const a = src.attributes[attr];
    if (!a) continue;
    const out = new Float32Array(a.count * a.itemSize), v = new V();
    for (let i = 0; i < a.count; i++) v.fromBufferAttribute(a, i).toArray(out, i * a.itemSize);
    geo.setAttribute(attr, new THREE.BufferAttribute(out, a.itemSize));
  }
  geo.setIndex(src.index.clone());
  geo.applyMatrix4(mesh.matrixWorld);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  const size = b.getSize(new THREE.Vector3());

  const map = mesh.material.map;
  if (map) map.anisotropy = aniso;
  const sway = SWAY.has(name);
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0 });
  const rim = charMat(0xffffff);
  mat.onBeforeCompile = (sh, r) => {
    rim.onBeforeCompile(sh, r);
    if (sway) swayPatch(sh);
  };
  mat.customProgramCacheKey = () => (sway ? 'prop-sway' : 'prop');
  let depth = null;
  if (sway) { // the shadow sways with the leaves
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = swayPatch;
    depth.customProgramCacheKey = () => 'prop-sway-depth';
  }
  return { geo, size, mat, depth };
}

// Gentle wind: the top bends more than the base, each instance on its own phase.
function swayPatch(sh) {
  sh.uniforms.uTime = shared.time;
  sh.uniforms.uWind = shared.wind;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec2 seed = vec2( 0.0 );
  #ifdef USE_INSTANCING
    seed = instanceMatrix[3].xz;
  #endif
  float h = max( position.y, 0.0 );
  float bend = h * h * 0.012 * uWind;
  transformed.x += sin( uTime * 1.3 + seed.x * 0.37 + seed.y * 0.21 ) * bend;
  transformed.z += sin( uTime * 1.1 + seed.y * 0.41 ) * bend * 0.7;
}`);
}

// A resized copy of the prop geometry:
//   { height }        uniform scale to that height
//   { width }         uniform scale so the footprint's longest side has that width
//   { box: [x,y,z] }  stretched to exactly that box (wall blocks fill their tile)
export function propGeometry(name, fit) {
  const P = loaded.get(name);
  if (!P) return null;
  const g = P.geo.clone(), s = P.size;
  if (fit.box) g.scale(fit.box[0] / s.x, fit.box[1] / s.y, fit.box[2] / s.z);
  else {
    const k = fit.height ? fit.height / s.y : fit.width / Math.max(s.x, s.z);
    g.scale(k, k, k);
  }
  return g;
}

export const propMaterial = name => loaded.get(name)?.mat;
export const propDepth = name => loaded.get(name)?.depth;
export const propMap = name => loaded.get(name)?.mat.map;
