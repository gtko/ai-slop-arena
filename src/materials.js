import * as THREE from 'three';

// Uniforms shared by every patched material. Updating one value updates every shader.
export const shared = {
  time: { value: 0 },
  rimColor: { value: new THREE.Color(0xffffff) },
  rimStrength: { value: 0.3 },
  // xy = world xz of a brawler, z = push strength. Bushes bend away from these.
  push: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, 0, 0)) },
  // xy = world xz of the local player, z = radius. Bushes near it dissolve (dither).
  reveal: { value: new THREE.Vector3(0, 0, 3.4) },
  revealAmt: { value: 0 },
  // Direction TO the sun in view space and its colour * intensity (set every frame in main.js).
  sunDirView: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(1, 1, 1) },
  wind: { value: 1 }, // sway multiplier, raised by storms
};

/* ------------------------------------------------------------------ */
/* Character material: standard PBR + fresnel rim light                */
/* ------------------------------------------------------------------ */

function rimPatch(shader) {
  shader.uniforms.uRimColor = shared.rimColor;
  shader.uniforms.uRimStrength = shared.rimStrength;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;`)
    .replace('#include <opaque_fragment>', `
{
  float rimF = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );
  rimF = smoothstep( 0.5, 1.0, rimF );
  outgoingLight += uRimColor * rimF * uRimStrength;
}
#include <opaque_fragment>`);
}

export function charMat(color, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...extra });
  m.onBeforeCompile = rimPatch;
  return m;
}

/* ------------------------------------------------------------------ */
/* Foliage: wind sway + push-away from brawlers, applied in world      */
/* space in BOTH the colour pass and the shadow depth pass so shadows  */
/* sway with the leaves. The colour pass also dissolves around the     */
/* player with an ordered dither (no transparency sorting issues).     */
/* ------------------------------------------------------------------ */

const FOL_VERT_PARS = /* glsl */`
uniform float uTime;
uniform float uWind;
uniform vec3 uPush[8];
varying vec3 vFolWorld;
varying float vFolH;
`;

const FOL_VERT = /* glsl */`
vec4 folW = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  folW = instanceMatrix * folW;
  vec2 folBase = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz;
#else
  vec2 folBase = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz;
#endif
folW = modelMatrix * folW;
float folH = clamp( transformed.y * 0.6, 0.0, 1.0 );
float folPh = folBase.x * 0.37 + folBase.y * 0.23;
folW.x += ( sin( uTime * 1.7 * sqrt( uWind ) + folPh + folW.z * 0.4 ) * 0.07 + ( uWind - 1.0 ) * 0.03 ) * folH * uWind;
folW.z += cos( uTime * 1.3 * sqrt( uWind ) + folPh + folW.x * 0.3 ) * 0.05 * folH * uWind;
for ( int k = 0; k < 8; k ++ ) {
  vec2 fd = folW.xz - uPush[ k ].xy;
  float fl = length( fd ) + 1e-4;
  float ff = smoothstep( 1.9, 0.3, fl ) * uPush[ k ].z * folH;
  folW.xz += fd / fl * ff * 0.5;
  folW.y -= ff * 0.3;
}
vFolWorld = folW.xyz;
vFolH = folH;
vec4 mvPosition = viewMatrix * folW;
gl_Position = projectionMatrix * mvPosition;
`;

const FOL_FRAG_PARS = /* glsl */`
uniform vec3 uReveal;
uniform float uRevealAmt;
uniform vec3 uSunDirV;
uniform vec3 uSunCol;
varying vec3 vFolWorld;
varying float vFolH;
float folLeaf = 0.0;
vec3 fHash3( vec3 p ) {
  p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) );
  return fract( sin( p ) * 43758.5453 );
}
// 3D cellular field: 1 at the middle of each "leaf", 0 along the gaps between leaves.
float leafField( vec3 p ) {
  vec3 g = floor( p ), f = fract( p );
  float d = 8.0;
  for ( int z = - 1; z <= 1; z ++ ) for ( int y = - 1; y <= 1; y ++ ) for ( int x = - 1; x <= 1; x ++ ) {
    vec3 o = vec3( float( x ), float( y ), float( z ) );
    vec3 r = o + fHash3( g + o ) * 0.85 - f;
    d = min( d, dot( r, r ) );
  }
  return 1.0 - smoothstep( 0.05, 1.0, sqrt( d ) );
}
float bayer4( vec2 p ) {
  ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
  int k = q.x + q.y * 4;
  float m[16] = float[16]( 0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5. );
  return ( m[ k ] + 0.5 ) / 16.0;
}
`;

const FOL_FRAG = /* glsl */`
#include <clipping_planes_fragment>
#ifndef FOL_NO_REVEAL
if ( uRevealAmt > 0.001 ) {
  float rd = distance( vFolWorld.xz, uReveal.xy );
  float ra = uRevealAmt * ( 1.0 - smoothstep( uReveal.z * 0.55, uReveal.z, rd ) );
  if ( bayer4( gl_FragCoord.xy ) < ra * 0.72 ) discard;
}
#endif
`;

function foliageVertex(shader) {
  shader.uniforms.uTime = shared.time;
  shader.uniforms.uWind = shared.wind;
  shader.uniforms.uPush = shared.push;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + FOL_VERT_PARS)
    .replace('#include <project_vertex>', FOL_VERT);
}

// Leaves: albedo + bump from the cellular field (surface-gradient bump mapping on screen-space
// derivatives), and a sun-coloured rim / transmission term so foliage glows where light
// grazes or shines through it: strongest at sunset when the sun is low behind the arena.
const FOL_COLOR = /* glsl */`#include <color_fragment>
#ifdef FOL_NO_LEAF
folLeaf = 0.6;
#else
folLeaf = leafField( vFolWorld * LEAF_SCALE );
#endif
diffuseColor.rgb *= mix( 0.8, 1.08, folLeaf ) * mix( 0.85, 1.1, vFolH );
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.15, 1.2, 0.8 ), folLeaf * vFolH * 0.35 );
`;
const FOL_NORMAL = /* glsl */`#include <normal_fragment_maps>
#ifndef FOL_NO_LEAF
{
  vec3 sx = dFdx( - vViewPosition ), sy = dFdy( - vViewPosition );
  vec3 r1 = cross( sy, normal ), r2 = cross( normal, sx );
  float det = dot( sx, r1 );
  vec3 grad = sign( det ) * ( dFdx( folLeaf ) * r1 + dFdy( folLeaf ) * r2 );
  normal = normalize( abs( det ) * normal - grad * LEAF_BUMP );
}
#endif
#ifdef FOL_UP_NORMAL
// cartoon grass: every blade (front or back face) is lit like one soft volume facing the sky
normal = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
#endif
#ifdef FOL_SNOW
{
  // snow settles on whatever faces up (world-space normal from the view-space one)
  vec3 wN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  float sn = smoothstep( 0.3, 0.75, wN.y ) * ( 0.75 + 0.25 * folLeaf );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.9, 0.94, 1.0 ), sn * 0.85 );
}
#endif
`;
const FOL_LIGHT = /* glsl */`#include <lights_fragment_end>
{
  vec3 V = normalize( vViewPosition );
  float edge = pow( 1.0 - saturate( dot( normal, V ) ), 2.5 );
  float sunSide = saturate( dot( normal, uSunDirV ) * 0.6 + 0.4 );
  float toward = saturate( dot( - V, uSunDirV ) * 0.5 + 0.5 );
  float through = saturate( - dot( normal, uSunDirV ) ) * toward * toward;
  reflectedLight.directDiffuse += uSunCol * diffuseColor.rgb * RECIPROCAL_PI
    * ( edge * sunSide * 0.9 + through * 0.45 ) * ( 0.6 + 0.4 * folLeaf );
}
`;

function foliagePatch(shader) {
  foliageVertex(shader);
  shader.uniforms.uReveal = shared.reveal;
  shader.uniforms.uRevealAmt = shared.revealAmt;
  shader.uniforms.uSunDirV = shared.sunDirView;
  shader.uniforms.uSunCol = shared.sunColor;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FOL_FRAG_PARS)
    .replace('#include <clipping_planes_fragment>', FOL_FRAG)
    .replace('#include <color_fragment>', FOL_COLOR)
    .replace('#include <normal_fragment_maps>', FOL_NORMAL)
    .replace('#include <lights_fragment_end>', FOL_LIGHT);
}

export function foliageMaterials(params, { reveal = true, leafScale = 3.6, leafBump = 0.5, snow = false, leaves = true, upNormal = false } = {}) {
  const mat = new THREE.MeshStandardMaterial(params);
  // extend (don't replace) the defines: MeshStandardMaterial relies on its STANDARD define
  Object.assign(mat.defines, { LEAF_SCALE: leafScale.toFixed(2), LEAF_BUMP: leafBump.toFixed(2) });
  if (!reveal) mat.defines.FOL_NO_REVEAL = '';
  if (snow) mat.defines.FOL_SNOW = '';
  if (!leaves) mat.defines.FOL_NO_LEAF = '';
  if (upNormal) mat.defines.FOL_UP_NORMAL = '';
  mat.onBeforeCompile = foliagePatch;
  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = foliageVertex;
  return { mat, depth };
}

/* ------------------------------------------------------------------ */
/* Procedural textures                                                 */
/* ------------------------------------------------------------------ */

export function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// 2x2 tile checker (one texture repeat = two tiles). With a painted sand image, each
// tile gets one copy of it and every other tile is tinted, keeping the arena's checker read.
export function groundTexture(sand = null, checker = 'rgba(150,92,38,0.14)') {
  if (sand) {
    const S = 1024, [c, x] = canvas(S);
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      x.drawImage(sand, tx * S / 2, ty * S / 2, S / 2, S / 2);
      if ((tx + ty) % 2) { x.fillStyle = checker; x.fillRect(tx * S / 2, ty * S / 2, S / 2, S / 2); }
    }
    x.strokeStyle = 'rgba(140,95,45,0.28)';
    x.lineWidth = 6;
    for (let k = 0; k <= 2; k++) {
      x.beginPath(); x.moveTo(k * S / 2, 0); x.lineTo(k * S / 2, S); x.stroke();
      x.beginPath(); x.moveTo(0, k * S / 2); x.lineTo(S, k * S / 2); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }
  const S = 512, [c, x] = canvas(S), r = mulberry(11);
  const A = '#e4bf83', B = '#d6ae6e';
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    x.fillStyle = (tx + ty) % 2 ? B : A;
    x.fillRect(tx * S / 2, ty * S / 2, S / 2, S / 2);
  }
  for (let k = 0; k < 6000; k++) {
    const dark = r() < 0.55;
    x.fillStyle = dark ? `rgba(130,86,40,${0.05 + r() * 0.1})` : `rgba(255,244,214,${0.05 + r() * 0.12})`;
    const s = 1 + r() * 3;
    x.fillRect(r() * S, r() * S, s, s);
  }
  for (let k = 0; k < 26; k++) { // pebbles
    const px = r() * S, py = r() * S, pr = 3 + r() * 5;
    x.fillStyle = 'rgba(150,110,65,0.35)';
    x.beginPath(); x.ellipse(px, py + 1.5, pr, pr * 0.7, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(250,232,196,0.55)';
    x.beginPath(); x.ellipse(px, py, pr * 0.8, pr * 0.55, 0, 0, Math.PI * 2); x.fill();
  }
  x.strokeStyle = 'rgba(140,95,45,0.22)';
  x.lineWidth = 4;
  for (let k = 0; k <= 2; k++) {
    x.beginPath(); x.moveTo(k * S / 2, 0); x.lineTo(k * S / 2, S); x.stroke();
    x.beginPath(); x.moveTo(0, k * S / 2); x.lineTo(S, k * S / 2); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function grassTexture() {
  const S = 256, [c, x] = canvas(S), r = mulberry(5);
  x.fillStyle = '#5f9d45';
  x.fillRect(0, 0, S, S);
  for (let k = 0; k < 4000; k++) {
    x.fillStyle = r() < 0.5 ? `rgba(40,90,30,${0.1 + r() * 0.2})` : `rgba(150,200,90,${0.08 + r() * 0.15})`;
    x.fillRect(r() * S, r() * S, 1 + r() * 2, 2 + r() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Seamless normal map from a sum of integer-frequency waves.
export function waterNormalTexture() {
  const S = 256, [c, x] = canvas(S);
  const img = x.createImageData(S, S);
  const W = [[1, 2, 0.0], [3, 1, 1.3], [2, -3, 2.1], [5, 4, 0.7], [-4, 5, 1.9], [7, -2, 0.4], [-6, -5, 2.8]];
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = px / S, v = py / S;
    let gx = 0, gy = 0;
    for (const [kx, ky, ph] of W) {
      const amp = 1 / Math.hypot(kx, ky);
      const cs = Math.cos(2 * Math.PI * (kx * u + ky * v) + ph) * amp;
      gx += kx * cs; gy += ky * cs;
    }
    let nx = -gx * 0.35, ny = -gy * 0.35, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (py * S + px) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255;
    img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function radialTexture(inner = 'rgba(0,0,0,0.85)', outer = 'rgba(0,0,0,0)', size = 128, noise = 0) {
  const [c, x] = canvas(size), r = mulberry(3);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, inner.replace(/[\d.]+\)$/, m => (parseFloat(m) * 0.6) + ')'));
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  if (noise) {
    x.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < noise; k++) {
      x.fillStyle = `rgba(0,0,0,${r() * 0.5})`;
      const a = r() * Math.PI * 2, d = r() * size * 0.5;
      x.beginPath();
      x.arc(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, 2 + r() * 8, 0, Math.PI * 2);
      x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Cartoon canyon block sides: warm horizontal rock bands with wavy darker strata lines.
// Two bands per texture repeat; the wall side shows about two repeats vertically.
export function strataTexture(base = '#c95b3c') {
  const S = 256, [c, x] = canvas(S), r = mulberry(17);
  const col = new THREE.Color(base);
  const shade = k => `#${col.clone().multiplyScalar(k).getHexString()}`;
  x.fillStyle = shade(1); x.fillRect(0, 0, S, S);
  x.fillStyle = shade(0.9); x.fillRect(0, S * 0.5, S, S * 0.5);
  x.strokeStyle = shade(0.62); x.lineWidth = 5; x.lineCap = 'round';
  for (const y0 of [S * 0.18, S * 0.5, S * 0.8]) {
    x.beginPath();
    for (let px = 0; px <= S; px += 8) {
      const y = y0 + Math.sin(px / S * Math.PI * 4 + y0) * 4; // integer periods: tiles horizontally
      px === 0 ? x.moveTo(px, y) : x.lineTo(px, y);
    }
    x.stroke();
  }
  for (let k = 0; k < 14; k++) { // little crack ticks
    const px = r() * S, py = r() * S;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + 10 + r() * 10, py + (r() - 0.5) * 6); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Flat cartoon ground: two soft tones per 2x2 tiles, faint speckles, no busy detail.
export function cartoonGround(a = '#f0ad7e', b = '#eba272') {
  const S = 512, [c, x] = canvas(S), r = mulberry(29);
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    x.fillStyle = (tx + ty) % 2 ? b : a;
    x.fillRect(tx * S / 2, ty * S / 2, S / 2, S / 2);
  }
  for (let k = 0; k < 900; k++) {
    x.fillStyle = r() < 0.5 ? 'rgba(170,80,40,0.08)' : 'rgba(255,230,200,0.1)';
    const s = 2 + r() * 4;
    x.beginPath(); x.arc(r() * S, r() * S, s, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
