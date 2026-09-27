import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ASSET_BASE } from '../assets.js';
import { charMat } from '../materials.js';
import { textureGain } from '../figurines.js';

// Rigged, animated animals for the ambient life: public/assets/models/fauna/<key>.glb, made by the
// art-src/fauna pipeline (art-src/fauna/README.md is the file contract: one skinned mesh facing +z,
// feet at y = 0, real size in metres, clips per body plan, ground speeds in the armature's extras).
//
// Loaded lazily, only the species a map asks for, once per session (the template is kept across
// matches). Until a model is in, or when it is missing, the map's toy stands in. Each creature is a
// SkeletonUtils clone (its own bones and mixer, the species' geometry, material and texture shared)
// under Ambient.rigRoot, which is NOT in arena.group: arena.dispose() would dispose the shared
// geometry and material. Ambient.dispose() only drops the clones' mixers and bone textures.

// ground speed (m/s at scale 1) of a cycle when the model's extras do not say
const SPEED = { Walk: 0.5, Run: 2, Hop: 1, Swim: 0.4, Slide: 2.5 };
const cache = new Map(); // key -> Promise<template | null>
let loader = null;

export function loadFauna(key) {
  if (!cache.has(key)) {
    loader ||= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    cache.set(key, loader.loadAsync(`${ASSET_BASE}models/fauna/${key}.glb`).then(prepare).catch(e => {
      // not made yet (a 404, or the dev server's index.html): the toy stays
      if (!/404|Not Found|Unexpected token|JSON/.test(String(e))) console.warn('fauna', key, e);
      return null;
    }));
  }
  return cache.get(key);
}

function prepare(gltf) {
  const scene = gltf.scene;
  let mesh = null, speed = null;
  scene.traverse(o => {
    if (o.isSkinnedMesh && !mesh) mesh = o;
    if (o.userData?.speed && typeof o.userData.speed === 'object') speed = o.userData.speed;
  });
  if (!mesh) return null;
  const map = mesh.material.map;
  if (map) map.anisotropy = 4;
  const mat = faunaMaterial(map, map ? textureGain(map) : 1);
  scene.traverse(o => {
    if (!o.isMesh) return;
    if (o.material !== mat) o.material.dispose();
    o.material = mat;
    o.castShadow = true;
    o.frustumCulled = false; // bounds of a posed skin go stale: Puppets culls per creature instead
  });
  const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
  const T = { scene, clips, speed: { ...SPEED, ...speed }, mat, hop: null };
  if (clips.Hop) T.hop = airborne(T, clips.Hop);
  return T;
}

// Same look as the figurines and props: the painted texture brought to a common exposure, the rim
// light of charMat, a little self-lighting so they read in wall shadows from the high camera.
function faunaMaterial(map, gain) {
  const rim = charMat(0xffffff);
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0 });
  const uGain = { value: gain };
  m.onBeforeCompile = (sh, r) => {
    rim.onBeforeCompile(sh, r);
    sh.uniforms.uGain = uGain;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGain;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = min( diffuseColor.rgb * uGain, vec3( 0.95 ) );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.22;');
  };
  m.customProgramCacheKey = () => 'fauna';
  rim.dispose();
  return m;
}

// When a hop cycle is off the ground: the bones' mean height over the clip, sampled once. Returns 24
// weights (mean 1) the game multiplies the ground speed by, so a hopper only moves while airborne
// (null: no clear airborne part, move evenly).
function airborne(T, clip, n = 24) {
  const root = cloneSkinned(T.scene), mixer = new THREE.AnimationMixer(root), bones = [], v = new THREE.Vector3();
  root.traverse(o => { if (o.isBone) bones.push(o); });
  if (!bones.length) return null;
  mixer.clipAction(clip).play();
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mixer.setTime(clip.duration * i / n);
    root.updateMatrixWorld(true);
    let y = 0;
    for (const b of bones) y += b.getWorldPosition(v).y;
    ys[i] = y / bones.length;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  let lo = Infinity, hi = -Infinity;
  for (const y of ys) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  if (hi - lo < 0.004) return null;
  const w = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (w[i] = ys[i] > lo + 0.3 * (hi - lo) ? 1 : 0);
  for (let i = 0; i < n; i++) w[i] *= n / sum;
  return w;
}

const _pm = new THREE.Matrix4(), _fr = new THREE.Frustum(), _sph = new THREE.Sphere();
// The models are real size, but the arena is not: the brawlers stand 2.5 m tall. Ground animals are
// scaled to their world (a cat reaches a brawler's knee); the flyers stay real size, high up.
const FLYERS = new Set(['vulture', 'raven']), WORLD = 1.9;
// the camera's frustum, once a frame, for Puppets.update
export function frustumOf(camera) {
  if (!camera) return null;
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return _fr.setFromProjectionMatrix(_pm);
}

// n rigged creatures of one species, driven by a map's helper (critters, flock) or its own code:
//   P.ready        the model is in (until then, and forever if it is missing, draw the toy)
//   P.pose(k, x, y, z, yaw, pitch, roll, scale)   (scale 0 hides it)
//   P.play(k, clip, rate, fade, once)  crossfade to a clip (false: the model has no such clip)
//   P.done(k)      the one-shot clip it plays has ended
//   P.has(clip), P.speed(clip) (ground speed m/s at scale 1), P.phase(k) (0..1 in the current clip),
//   P.current(k) (its clip name), P.shown(k) (on screen: off screen the clips are not advanced)
export class Puppets {
  constructor(amb, key, n, o = {}) {
    this.key = key; this.n = n; this.list = null; this.T = null;
    this.world = FLYERS.has(key) ? 1 : WORLD;
    this.radius = o.radius ?? 1; // culling sphere (m at scale 1): wide for flyers
    if (n > 0) loadFauna(key).then(T => { if (T && !amb.dead) { this.build(T, amb.rigRoot); amb.setDetail(amb.detail); } });
  }
  build(T, parent) {
    this.T = T;
    this.list = Array.from({ length: this.n }, () => {
      const root = cloneSkinned(T.scene);
      let skel = null;
      root.traverse(o => { if (o.isSkinnedMesh) skel = o.skeleton; });
      root.visible = false; // until its system poses it
      root.rotation.order = 'YXZ';
      parent.add(root);
      return { root, skel, mixer: new THREE.AnimationMixer(root), acts: {}, cur: null, once: false, acc: 0, s: 1 };
    });
  }
  get ready() { return !!this.list; }
  has(name) { return !!this.T?.clips[name]; }
  speed(name) { return (this.T?.speed[name] || 1) * this.world; } // a bigger animal strides further
  pose(k, x, y, z, yaw, pitch = 0, roll = 0, s = 1) {
    const p = this.list[k], R = p.root;
    R.visible = s > 0;
    if (!R.visible) return;
    R.position.set(x, y, z);
    R.rotation.set(pitch, yaw, roll);
    R.scale.setScalar(s * this.world);
    p.s = s * this.world;
  }
  play(k, name, rate = 1, fade = 0.25, once = false) {
    const p = this.list[k], clip = this.T.clips[name];
    if (!clip) return false;
    const a = p.acts[name] ||= p.mixer.clipAction(clip);
    a.timeScale = rate;
    if (p.cur === a && !(once && this.done(k))) return true;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.play();
    if (p.cur && p.cur !== a) a.crossFadeFrom(p.cur, fade, false);
    p.cur = a; p.once = once;
    return true;
  }
  done(k) { const p = this.list[k]; return !p.cur || (p.once && (p.cur.paused || !p.cur.enabled)); }
  phase(k) { const a = this.list[k].cur; return a ? (a.time / a.getClip().duration) % 1 : 0; }
  current(k) { return this.list[k].cur?.getClip().name; }
  shown(k) { return this.list[k].root.visible; } // on screen at the last update (animated)
  // after the systems posed them: animate the ones on screen, hold the others (their time is kept
  // and caught up when they come back into view)
  update(dt, fr) {
    if (!this.list) return;
    for (const p of this.list) {
      const R = p.root;
      if (!R.visible) { p.acc += dt; continue; }
      if (fr && !fr.intersectsSphere(_sph.set(R.position, (this.radius + 1) * p.s + 1))) { R.visible = false; p.acc += dt; continue; }
      p.mixer.update(Math.min(p.acc + dt, 5));
      p.acc = 0;
    }
  }
  dispose() {
    for (const p of this.list || []) {
      p.mixer.stopAllAction();
      p.mixer.uncacheRoot(p.root);
      p.skel?.dispose(); // its bone texture; geometry, material and texture belong to the species
      p.root.removeFromParent();
    }
    this.list = null;
  }
}
