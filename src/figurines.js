import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ASSET_BASE } from './assets.js';
import { charMat, shared } from './materials.js';
import { outlineMaterial, OUTLINES } from './models.js';
import { Animator } from './animator.js';

// Image-to-3D figurines: the chibi art turned into textured meshes (art-src/ai3d), then rigged and
// animated in Blender (art-src/rig): every GLB carries a standard humanoid skeleton (Mixamo bone
// names) and its clips (idle, run, sneak, bush, aim, shoot, super, hit, death, victory, emotes...).
// A brawler whose GLB exists uses it instead of the hand-built rig in models.js; animator.js plays
// the clips.

const HEIGHT = 2.5; // same size as the procedural rigs
const H = HEIGHT;

// Which hand holds the weapon (R = the character's right = -x, models face +z) and how it attacks
// (the clips already bake both in: see art-src/rig/export_rig.mjs). `flames`: the flame-coloured
// part of the head is animated.
export const RIGS = {
  blaster: { weapon: 'R', style: 'gun' },
  gunslinger: { weapon: 'both', style: 'gun' },
  bomber: { weapon: 'L', style: 'throw', flames: true },
  frostbite: { weapon: 'R', style: 'staff' },
  volt: { weapon: 'both', style: 'cast' },
};

const templates = new Map(); // type key -> { scene, clips, map, gain, flames }
let loading = null;

export function preloadFigurines(keys, renderer, onItem = () => {}) {
  if (loading) return loading;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  loading = Promise.all(keys.map(key => loader.loadAsync(`${ASSET_BASE}models/${key}.glb`)
    .then(gltf => templates.set(key, prepare(key, gltf, aniso)))
    .catch(e => { if (!/404|Not Found|Unexpected token/.test(String(e))) console.warn('figurine', key, e); })
    .finally(onItem)));
  return loading;
}

export const hasFigurine = key => templates.has(key);
export const figurineInfo = key => templates.get(key);

function prepare(key, gltf, aniso) {
  const scene = gltf.scene;
  let mesh = null;
  scene.updateMatrixWorld(true);
  scene.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  const map = mesh.material.map;
  map.anisotropy = aniso;
  let flames = false;
  if (RIGS[key]?.flames) {
    // rest positions in model units: skin the (quantised) bind-space vertices with the rest pose
    const n = mesh.geometry.attributes.position.count, rest = new Float32Array(n * 3), v = new THREE.Vector3();
    mesh.skeleton.pose();
    scene.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(mesh.geometry.attributes.position, i);
      mesh.applyBoneTransform(i, v).applyMatrix4(mesh.matrixWorld).toArray(rest, i * 3);
    }
    const neck = new THREE.Vector3();
    scene.getObjectByName('Head').getWorldPosition(neck);
    flames = flameWeights(mesh.geometry, new THREE.BufferAttribute(rest, 3), map, { neck: neck.y });
  }
  // soft parts painted by the rig pipeline (landmarks "sway"): leaves, gills, flames, capes, hair
  const soft = mesh.geometry.getAttribute('_sway');
  if (soft) mesh.geometry.setAttribute('aSway', soft);
  // painted eyes (landmarks "eyes"): height inside each eye, and the eyelid colour (glTF extras)
  const eye = mesh.geometry.getAttribute('_eye'), lidRGB = mesh.userData.lid || mesh.geometry.userData?.lid;
  if (eye) mesh.geometry.setAttribute('aEye', eye);
  const lid = eye && lidRGB ? new THREE.Color().setRGB(lidRGB[0], lidRGB[1], lidRGB[2], THREE.SRGBColorSpace) : null;
  return { scene, mesh, clips: gltf.animations, map, gain: textureGain(map), flames, sway: !!soft, lid, name: mesh.name };
}

// Level of detail (v0.12, mobile): the same vertices (skinning, eyes, soft parts untouched) with
// fewer triangles, from meshoptimizer; the figurines of a type share their geometry, so swapping
// its index changes every brawler of that type at once, outline included.
// ratio: share of the triangles kept (1 = full model).
let detail = 1;
export async function setFigurineDetail(ratio) {
  detail = ratio;
  if (ratio < 0.99) await MeshoptSimplifier.ready;
  for (const T of templates.values()) T.mesh.geometry.setIndex(lodIndex(T, detail));
}

function lodIndex(T, ratio) {
  const g = T.mesh.geometry;
  T.fullIndex ||= g.index;
  if (ratio >= 0.99) return T.fullIndex;
  T.lod ||= {};
  if (T.lod[ratio]) return T.lod[ratio];
  const pos = g.attributes.position, uv = g.attributes.uv, n = pos.count;
  const P = new Float32Array(n * 3), U = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i);
    if (uv) { U[i * 2] = uv.getX(i); U[i * 2 + 1] = uv.getY(i); }
  }
  const idx = new Uint32Array(T.fullIndex.array), target = Math.floor(idx.length * ratio / 3) * 3;
  // UVs weigh in so the painted texture (faces, eyes) keeps its seams
  const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, P, 3, U, 2, [1, 1], null, target, 0.03);
  return (T.lod[ratio] = new THREE.BufferAttribute(n > 65535 ? out : new Uint16Array(out), 1));
}

// Flame hair: aFlame = (weight, 0 at the flame base -> 1 at the tips) on the head vertices, which
// the material makes lick upward and flicker (see FLAME_VERT). A vertex is flame-coloured when its
// texel is a saturated yellow-orange; the weight is the share of flame-coloured vertices around it,
// so the field is smooth (no lone vertex pulled out of the surface) and the thin lava cracks of the
// horns, with few such neighbours, stay still. Returns false when the texture can't be read.
// `pos`: the rest positions in model units (the file stores quantised bind-space ones).
function flameWeights(geo, pos, map, J) {
  let d, S = 256;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(map.image, 0, 0, S, S);
    d = ctx.getImageData(0, 0, S, S).data;
  } catch { return false; }
  const uv = geo.attributes.uv, n = pos.count;
  const head = [], hot = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (pos.getY(i) < J.neck + 0.02 * H) continue;
    head.push(i);
    // glTF textures are not flipped: uv (0, 0) is the top-left texel
    const px = Math.min(S - 1, Math.max(0, Math.floor(uv.getX(i) * S)));
    const py = Math.min(S - 1, Math.max(0, Math.floor(uv.getY(i) * S)));
    const o = (py * S + px) * 4, r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    const hue = mx === mn ? 0 : mx === r ? 60 * (((g - b) / (mx - mn)) % 6) : mx === g ? 60 * ((b - r) / (mx - mn) + 2) : 60 * ((r - g) / (mx - mn) + 4);
    hot[i] = hue > 5 && hue < 60 && sat > 0.4 && mx > 0.45 ? 1 : 0;
  }
  // neighbours within R through a uniform grid of R-sized cells
  const R = 0.06 * H, cell = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  const c3 = i => [Math.floor(pos.getX(i) / R), Math.floor(pos.getY(i) / R), Math.floor(pos.getZ(i) / R)];
  for (const i of head) { const k = key(...c3(i)); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(i); }
  const w = new Float32Array(n), p = new THREE.Vector3(), q = new THREE.Vector3();
  let top = -Infinity, base = Infinity;
  for (const i of head) {
    const [cx, cy, cz] = c3(i);
    p.fromBufferAttribute(pos, i);
    let all = 0, fire = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of cell.get(key(cx + dx, cy + dy, cz + dz)) || []) {
        if (q.fromBufferAttribute(pos, j).distanceToSquared(p) > R * R) continue;
        all++; fire += hot[j];
      }
    }
    w[i] = THREE.MathUtils.clamp((fire / all - 0.2) / 0.3, 0, 1);
    if (w[i] > 0) { top = Math.max(top, p.y); base = Math.min(base, p.y); }
  }
  if (!(top > base)) return false;
  const out = new Float32Array(n * 2);
  for (const i of head) {
    if (!w[i]) continue;
    out[i * 2] = w[i];
    out[i * 2 + 1] = THREE.MathUtils.clamp((pos.getY(i) - base) / (top - base), 0, 1);
  }
  geo.setAttribute('aFlame', new THREE.BufferAttribute(out, 2));
  return true;
}

// In bind space, before skinning, so the flames follow the head: tips sway and stretch upward,
// each tongue on its own phase.
const FLAME_PARS = 'attribute vec2 aFlame;\nuniform float uTime;\nvarying float vFlame;';
const FLAME_VERT = /* glsl */`
vFlame = aFlame.x;
if ( aFlame.x > 0.0 ) {
  float fk = aFlame.x * aFlame.y * aFlame.y;
  float fph = uTime * 6.0 + position.x * 11.0 + position.z * 9.0;
  transformed += vec3( sin( fph ) * 0.045, ( 0.5 + 0.5 * sin( fph * 1.37 + position.y * 13.0 ) ) * 0.09, cos( fph * 0.83 ) * 0.045 ) * fk;
}`;
function flamePatch(sh) {
  sh.uniforms.uTime = shared.time;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${FLAME_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FLAME_VERT}`);
}

// Soft parts (art-src/rig, "sway"): `aSway` is 0 where a leaf / gill / cape / strand is attached and
// 1 at its tip. In bind space, before skinning, those vertices flutter on their own phase and lean
// with uSwayPush: the wind, the drag of running and a springy lag (brawler.js, every frame).
const SWAY_PARS = /* glsl */`
attribute float aSway;
uniform vec3 uSwayPush;
uniform float uSwayTime;
uniform float uSwayWind;`;
const SWAY_VERT = /* glsl */`
if ( aSway > 0.0 ) {
  float sw = aSway * aSway;
  float sph = uSwayTime * 2.6 + position.x * 9.0 + position.y * 6.0 + position.z * 7.0;
  vec3 flutter = vec3( sin( sph ), 0.4 * sin( sph * 1.6 + 1.1 ), cos( sph * 0.8 + 0.4 ) ) * ( 0.012 + 0.012 * uSwayWind );
  transformed += ( flutter + uSwayPush ) * sw;
}`;
function swayPatch(sh, U) {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
${SWAY_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
${SWAY_VERT}`);
}

// Weapons read small from the high game camera (v0.11 readability pass): scaled up around the grip.
const WEAPON_SCALE = { blaster: 1.25, gunslinger: 1.3, bomber: 1.2, frostbite: 1.1 };

// The outline hull deforms like the figurine (flames, soft parts): its own material then.
function figurineOutline(width, flames, U) {
  const base = outlineMaterial(width);
  if (!flames && !U) return base;
  const m = base.clone();
  delete m.userData.shared; // already this brawler's own copy
  m.onBeforeCompile = sh => { base.onBeforeCompile(sh); if (flames) flamePatch(sh); if (U) swayPatch(sh, U); };
  m.customProgramCacheKey = () => `outline-${flames ? 'f' : ''}${U ? 's' : ''}${width}`;
  m.userData.outline = true;
  return m;
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
// Blinks: the eyes are painted, so a lid of skin colour slides down over them (aEye: 0 at the bottom
// of an eye .. 1 at its top), with a darker lash line along its edge. uBlink: 0 open .. 1 shut.
// uLow: a lower lid rising from the bottom (0 none .. 1 shut): with the upper one it makes the
// expressions of brawler.js (happy crescents, a pained squint, a determined glare, tired eyes).
const EYE_PARS_V = `
attribute float aEye;
varying float vEye;`;
const EYE_PARS_F = `
varying float vEye;
uniform float uBlink;
uniform float uLow;
uniform vec3 uLid;`;
const EYE_FRAG = /* glsl */`
if ( vEye > 0.0 && uBlink > 0.0 ) {
  float lidEdge = 1.0 - uBlink * 1.08;
  if ( vEye > lidEdge ) diffuseColor.rgb = uLid * ( vEye < lidEdge + 0.07 ? 0.45 : 1.0 );
}
if ( vEye > 0.0 && uLow > 0.0 ) {
  float lowEdge = uLow * 1.08;
  if ( vEye < lowEdge ) diffuseColor.rgb = uLid * ( vEye > lowEdge - 0.07 ? 0.55 : 1.0 );
}`;

function figurineMaterial(map, gain, flames = false, sway = null, eyes = null) {
  const rim = charMat(0xffffff);
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: 0.6, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.45 });
  const uGain = { value: gain };
  m.onBeforeCompile = (sh, r) => {
    rim.onBeforeCompile(sh, r);
    sh.uniforms.uGain = uGain;
    if (sway) swayPatch(sh, sway);
    if (eyes) {
      Object.assign(sh.uniforms, eyes);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>${EYE_PARS_V}`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEye = aEye;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>${EYE_PARS_F}`)
        .replace('#include <map_fragment>', `#include <map_fragment>${EYE_FRAG}`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGain;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = min( diffuseColor.rgb * uGain, vec3( 0.95 ) );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.28;');
    if (!flames) return;
    // flames glow (enough to bloom) and flicker
    flamePatch(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vFlame;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vFlame * ( 0.7 + 0.25 * sin( uTime * 17.0 + vViewPosition.y * 9.0 ) + 0.15 * sin( uTime * 29.0 ) );`);
  };
  m.customProgramCacheKey = () => `figurine${flames ? '-flame' : ''}${sway ? '-sway' : ''}${eyes ? '-eyes' : ''}`;
  rim.dispose();
  return m;
}


// root (spawn pop / hit squash, set by brawler.js) > body > rig (armature + skinned mesh + outline)
export function buildFigurine(key) {
  const T = templates.get(key);
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const rig = cloneSkinned(T.scene);
  body.add(rig);
  let mesh = null;
  rig.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  // per brawler: its own lean of the soft parts
  const sway = T.sway ? { uSwayPush: { value: new THREE.Vector3() }, uSwayWind: shared.wind, uSwayTime: shared.time } : null;
  const eyes = T.lid ? { uBlink: { value: 0 }, uLow: { value: 0 }, uLid: { value: T.lid } } : null;
  const mat = figurineMaterial(T.map, T.gain, T.flames, sway, eyes); // own material: hit flash and frost tint are per brawler
  mesh.material = mat;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false; // bounds move with the pose
  const lineMat = figurineOutline(0.02, T.flames, sway); // finer than the rigs: lots of small details
  const line = new THREE.SkinnedMesh(mesh.geometry, lineMat);
  line.position.copy(mesh.position); line.quaternion.copy(mesh.quaternion); line.scale.copy(mesh.scale);
  mesh.parent.add(line);
  line.bind(mesh.skeleton, mesh.bindMatrix);
  line.frustumCulled = false;
  line.userData.outline = true;
  OUTLINES.add(line);
  // weapons are their own meshes, parented to a hand bone: same look, same hit flash, own outline
  const weapons = [];
  rig.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && !o.userData.outline) weapons.push(o); });
  for (const w of weapons) {
    w.scale.multiplyScalar(WEAPON_SCALE[key] || 1); // bigger weapons read better from the game camera
    w.material = mat;
    w.castShadow = w.receiveShadow = true;
    const hull = new THREE.Mesh(w.geometry, outlineMaterial(0.02));
    hull.userData.outline = true;
    OUTLINES.add(hull);
    w.add(hull);
  }
  const anim = new Animator(rig, T.clips);
  return { figurine: true, root, body, rig, mesh, skeleton: mesh.skeleton, anim, weapon: RIGS[key]?.weapon, style: RIGS[key]?.style, mats: [mat],
    sway: sway && sway.uSwayPush.value, blink: eyes && eyes.uBlink, lowLid: eyes && eyes.uLow, disposables: lineMat === outlineMaterial(0.02) ? [] : [lineMat] };
}
