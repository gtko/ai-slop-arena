import * as THREE from 'three';
import { radialTexture } from './materials.js';

// Shared geometry + materials for every lantern in an arena.
export function lanternKit() {
  const cyl = (rt, rb, h, s, y) => new THREE.CylinderGeometry(rt, rb, h, s).translate(0, y, 0);
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const roof = new THREE.ConeGeometry(0.46, 0.34, 4).rotateY(Math.PI / 4).translate(0, 0.83, 0);
  const posts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.push(box(0.07, 0.6, 0.07, sx * 0.25, 0.36, sz * 0.25));
  const frame = [
    box(0.62, 0.07, 0.62, 0, 0.04, 0),   // bottom plate
    box(0.62, 0.06, 0.62, 0, 0.66, 0),   // top rim
    ...posts,
    cyl(0.05, 0.05, 0.12, 8, 1.03),      // finial neck
  ];
  const flame = new THREE.ConeGeometry(0.1, 0.3, 8).translate(0, 0.15, 0);
  return {
    geo: {
      plinth: cyl(0.62, 0.72, 0.26, 8, 0.13),
      column: cyl(0.26, 0.33, 1.0, 8, 0.76),
      capital: cyl(0.44, 0.36, 0.15, 8, 1.33),
      post: cyl(0.06, 0.08, 0.55, 8, 0.27),
      frame: mergeSimple(frame),
      roof,
      knob: new THREE.SphereGeometry(0.075, 10, 8).translate(0, 1.13, 0),
      glass: box(0.46, 0.56, 0.46, 0, 0.36, 0),
      candle: cyl(0.07, 0.08, 0.16, 10, 0.16),
      flame,
      core: new THREE.ConeGeometry(0.05, 0.16, 8).translate(0, 0.08, 0),
    },
    mat: {
      stone: new THREE.MeshStandardMaterial({ color: 0x8a8494, roughness: 0.85 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2c2a33, roughness: 0.35, metalness: 0.75 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xc89b45, roughness: 0.3, metalness: 0.9 }),
      // Warm frosted glass that glows from the inside; its emissive level follows the time of day.
      glass: new THREE.MeshStandardMaterial({
        color: 0xffd9a0, emissive: 0xff9a3a, emissiveIntensity: 1, roughness: 0.15,
        transparent: true, opacity: 0.55, depthWrite: false,
      }),
      wax: new THREE.MeshStandardMaterial({ color: 0xfff1d6, roughness: 0.6, emissive: 0xffb060, emissiveIntensity: 0.4 }),
      fire: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.3, 0.3) }),
      core: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 3.0, 1.4) }),
    },
    haloTex: radialTexture('rgba(255,190,110,0.85)', 'rgba(255,140,50,0)', 128),
  };
}

function mergeSimple(geos) {
  // All boxes/cylinders are indexed with the same attributes, so a plain concat works.
  const pos = [], nor = [], uv = [], idx = [];
  for (const g of geos) {
    const o = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(i + o);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Sculpted lantern (props.js): one textured mesh; its painted windows light up at night through
// `glow` (0..1+, driven by arena.js). The flame meshes stay inside the lamp box so arena.js can keep
// animating them, the halo and the point light sit at the box.
export function sculptedLanternMaterial(base, glow) {
  const m = base.clone();
  m.onBeforeCompile = (sh, r) => {
    base.onBeforeCompile(sh, r);
    sh.uniforms.uGlow = glow;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // warm, bright texels = the lit windows
  float lit = smoothstep( 0.5, 0.8, diffuseColor.r ) * smoothstep( 0.12, 0.35, diffuseColor.r - diffuseColor.b );
  totalEmissiveRadiance += diffuseColor.rgb * lit * uGlow;
}`);
  };
  m.customProgramCacheKey = () => 'lantern-glow';
  return m;
}

export function makeSculptedLantern(kit, geometry, material, height) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geometry, material);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const y = height * 0.72; // centre of the lamp box
  const flame = new THREE.Mesh(kit.geo.flame, kit.mat.fire); flame.position.y = y - 0.12; flame.visible = false;
  const core = new THREE.Mesh(kit.geo.core, kit.mat.core); core.position.y = y - 0.12; core.visible = false;
  g.add(flame, core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: kit.haloTex, color: 0xffb070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  halo.position.y = y;
  halo.scale.setScalar(2.2);
  return { group: g, flame, core, halo, lightY: y };
}

// pedestal: free-standing stone lamp post (on 'T' tiles); otherwise a short iron post for wall tops.
export function makeLantern(kit, pedestal) {
  const { geo, mat } = kit;
  const g = new THREE.Group();
  const add = (geometry, material, shadow = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  let base = 0;
  if (pedestal) {
    add(geo.plinth, mat.stone); add(geo.column, mat.stone); add(geo.capital, mat.stone);
    base = 1.4;
  } else {
    add(geo.post, mat.iron);
    base = 0.52;
  }
  const lamp = new THREE.Group();
  lamp.position.y = base;
  g.add(lamp);
  for (const [geometry, material, shadow] of [
    [geo.frame, mat.iron, true], [geo.roof, mat.iron, true], [geo.knob, mat.brass, true],
    [geo.candle, mat.wax, false], [geo.glass, mat.glass, false],
  ]) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow; m.receiveShadow = true;
    lamp.add(m);
  }
  const flame = new THREE.Mesh(geo.flame, mat.fire); flame.position.y = 0.24; lamp.add(flame);
  const core = new THREE.Mesh(geo.core, mat.core); core.position.y = 0.24; lamp.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: kit.haloTex, color: 0xffb070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  halo.position.y = base + 0.38;
  halo.scale.setScalar(2.2);
  return { group: g, flame, core, halo, lightY: base + 0.4 };
}
