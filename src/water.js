import * as THREE from 'three';
import { shared, waterNormalTexture } from './materials.js';
import { tex } from './assets.js';
import { bandGeometry } from './shore.js';

// Water sits in a real basin: the ground has holes over 'W' tiles, a sunken bed and banks
// catch shadows and animated caustics, and a transparent lit surface goes on top.
export const WATER_Y = -0.16;
const BED_Y = -0.85;
const MAX_RIPPLES = 8;

/* ------------------------------------------------------------------ */
/* Shared GLSL                                                         */
/* ------------------------------------------------------------------ */

// Animated cellular caustics: bright network where two moving Voronoi layers have thin cell edges.
const CAUSTICS = /* glsl */`
vec2 cHash( vec2 p ) {
  p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
  return fract( sin( p ) * 43758.5453 );
}
float cEdges( vec2 p, float t ) {
  vec2 g = floor( p ), f = fract( p );
  float d1 = 8.0, d2 = 8.0;
  for ( int y = - 1; y <= 1; y ++ ) for ( int x = - 1; x <= 1; x ++ ) {
    vec2 o = vec2( float( x ), float( y ) );
    vec2 h = 0.5 + 0.42 * sin( t + 6.2831 * cHash( g + o ) );
    float d = length( o + h - f );
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
  }
  return d2 - d1;
}
float caustics( vec2 p, float t ) {
  float a = 1.0 - smoothstep( 0.0, 0.14, cEdges( p * 1.25, t * 0.9 ) );
  float b = 1.0 - smoothstep( 0.0, 0.11, cEdges( p * 2.1 + 3.7, t * 1.25 ) );
  return a * a * 0.75 + b * b * 0.55;
}
`;

/* ------------------------------------------------------------------ */
/* Surface material                                                    */
/* ------------------------------------------------------------------ */

function surfaceMaterial(u) {
  // The studio env map is far brighter than a sky, so it only gets a hint; the uSky fresnel term
  // (driven by the time of day) does most of the reflecting.
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.16, metalness: 0, transparent: true, envMapIntensity: 0.25 });
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uHalf;
uniform sampler2D uShore;
uniform sampler2D uWaterN;
uniform vec4 uRip[ ${MAX_RIPPLES} ];
uniform vec3 uSky;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec3 vWPos;
float wFoam = 0.0;
vec2 wRipGrad = vec2( 0.0 );`)
      // colour: depth from the shore-distance field, foam at the banks and on ripple crests
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 suv = ( vWPos.xz + uHalf ) / ( 2.0 * uHalf );
  float sd = texture2D( uShore, suv ).r * 1.5;               // distance to bank, in tiles
  float nz = texture2D( uWaterN, vWPos.xz * 0.35 + uTime * 0.02 ).r;
  float rip = 0.0;
  for ( int k = 0; k < ${MAX_RIPPLES}; k ++ ) {
    vec4 R = uRip[ k ];
    float age = uTime - R.z;
    if ( age < 0.0 || age > 3.0 ) continue;
    vec2 d = vWPos.xz - R.xy;
    float r = length( d ) + 1e-4;
    float front = r - age * 2.6;
    float ring = exp( - front * front * 9.0 ) * exp( - age * 1.4 ) * R.w;
    rip += ring;
    wRipGrad += d / r * ring * sin( front * 14.0 );
  }
  float depth = smoothstep( 0.05, 0.95, sd );
  diffuseColor.rgb = mix( uShallow, uDeep, depth );
  diffuseColor.a = mix( 0.45, 0.8, depth );
  float lap = sin( uTime * 1.8 + sd * 18.0 ) * 0.035;
  wFoam = 1.0 - smoothstep( 0.02, 0.1, sd + ( nz - 0.5 ) * 0.07 + lap * 0.6 );
  wFoam = max( wFoam, smoothstep( 0.45, 1.0, rip ) * 0.6 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.98, 1.0 ), wFoam );
  diffuseColor.a = mix( diffuseColor.a, 0.95, wFoam );
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.85, wFoam );`)
      // normals: two world-space scrolling layers (seamless across tiles) + ripple rings
      .replace('#include <normal_fragment_maps>', `
{
  vec2 w = vWPos.xz;
  vec3 n1 = texture2D( uWaterN, w * 0.21 + vec2( uTime * 0.031, uTime * 0.017 ) ).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D( uWaterN, w * 0.47 + vec2( - uTime * 0.024, uTime * 0.038 ) ).xyz * 2.0 - 1.0;
  vec2 slope = ( n1.xy * 0.6 + n2.xy * 0.4 ) * 0.38 + wRipGrad * 1.2;
  vec3 wn = normalize( vec3( slope.x, 1.0, - slope.y ) );
  wn = normalize( mix( wn, vec3( 0.0, 1.0, 0.0 ), wFoam * 0.7 ) );
  normal = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz );
}`)
      // cheap sky reflection with fresnel, tinted by the current time of day
      .replace('#include <opaque_fragment>', `
{
  float fres = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 4.0 );
  outgoingLight += uSky * ( 0.04 + fres * 0.7 ) * ( 1.0 - wFoam );
}
#include <opaque_fragment>`);
  };
  return m;
}

/* ------------------------------------------------------------------ */
/* Bed / bank material: sand, darker when wet, caustics on direct light */
/* ------------------------------------------------------------------ */

function bedMaterial(u, params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying vec3 vWPos;
${CAUSTICS}`)
      // Multiplying only the DIRECT diffuse term means caustics follow the sun and torches and
      // disappear inside shadows, like real focused light would.
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float under = smoothstep( ${WATER_Y.toFixed(2)} + 0.02, ${WATER_Y.toFixed(2)} - 0.12, vWPos.y );
  float c = caustics( vWPos.xz * 0.9, uTime );
  reflectedLight.directDiffuse *= 1.0 + c * 1.3 * under;
  reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), vec3( 0.55, 0.78, 0.95 ), under * 0.6 );
}`);
  };
  return m;
}

/* ------------------------------------------------------------------ */

// Bank profile across the land field f (shore.js): a sandy beach from the floor's edge (f = lip,
// on the dry tile) down to the surface exactly at the outline (f = 0.5, the 'W' tile edge on
// straight banks, where collision starts), then a slope down to the bed.
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const bankY = (f, lip) => (f >= 0.5 ? WATER_Y * (1 - smooth((f - 0.5) / (lip - 0.5)))
  : WATER_Y + (BED_Y - WATER_Y) * smooth((0.5 - f) / 0.3));

export class Water {
  constructor(arena, N, TILE, HALF, style = 'water', lip = 0.66) {
    this.arena = arena;
    this.N = N; this.TILE = TILE; this.HALF = HALF; this.lip = lip; this.style = style;
    this.tiles = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (arena.grid[j][i] === 'W') this.tiles.push([i, j]);
    this.group = new THREE.Group();
    arena.group.add(this.group);
    if (!this.tiles.length || arena.headless) return; // the server only needs isWaterAt (arena.js)
    this.field = arena.field;
    // a cell of the shore band belongs to this pond if a 'W' tile is next to it
    this.near = (i, j) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (this.isWater(i + di, j + dj)) return true; return false; };
    this.waterline = 0.5; // where the bank goes under: the outline itself (bankY)

    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
    this.nextRipple = 0;
    this.idleT = 1;
    this.normalTex = waterNormalTexture();
    this.normalTex.wrapS = this.normalTex.wrapT = THREE.RepeatWrapping;
    this.u = {
      uTime: shared.time,
      uHalf: { value: HALF },
      uShore: { value: this.shoreTexture() },
      uWaterN: { value: this.normalTex },
      uRip: { value: this.ripples },
      uSky: { value: new THREE.Color(0x9cc8ff) },
      // swamp: murky olive water instead of clear blue
      uDeep: { value: new THREE.Color(style === 'swamp' ? 0x1e3a22 : 0x0a4c96) },
      uShallow: { value: new THREE.Color(style === 'swamp' ? 0x5a7a3a : 0x1fb8d8) },
    };
    this.buildBasin();
    this.buildSurface();
  }

  isWater(i, j) { return this.arena.get(i, j) === 'W'; }

  // Per-texel distance to the waterline (in tiles), so depth colour and foam follow the rounded
  // shore (exact along straight banks, close enough in the bends).
  shoreTexture() {
    const { N, TILE, HALF, field } = this, R = 16, S = N * R, w = field.dist(this.waterline);
    const data = new Uint8Array(S * S);
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      if (!this.near(Math.floor(px / R), Math.floor(py / R))) continue;
      const x = (px + 0.5) / R * TILE - HALF, z = (py + 0.5) / R * TILE - HALF;
      const d = (w - field.dist(field.at(x, z))) / TILE;
      if (d > 0) data[py * S + px] = Math.min(255, (d / 1.5) * 255);
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RedFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  // One sunken basin per pond, following the rounded shore: a dry lip, a sloping bank, the bed.
  buildBasin() {
    const { TILE, lip } = this, cell = (i, j) => this.near(i, j);
    const b = this.field.band(-Infinity, lip, { keep: cell, y: (x, z, f) => bankY(f, lip), whole: (mn, mx) => mx < 0.1 });
    const g = bandGeometry(b, (x, z) => [x / TILE, -z / TILE]);
    // sun-dried lip, dark wet sand below the waterline
    const P = this.style === 'swamp' ? [0x6e6248, 0x4a4234] : this.arena.map.ground === 'cartoon' ? [0xe6b98c, 0x8a7458] : [0x8a7458, 0x62563f];
    const dry = new THREE.Color(P[0]), wet = new THREE.Color(P[1]), c = new THREE.Color(), col = new Float32Array(b.val.length * 3);
    b.val.forEach((f, k) => c.copy(wet).lerp(dry, smooth((f - this.waterline + 0.02) / 0.12)).toArray(col, k * 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = bedMaterial(this.u, {
      color: 0xffffff, vertexColors: true, roughness: 0.6, map: tex('sand', 0.5, 0.5), normalMap: tex('sand_n', 0.5, 0.5),
      shadowSide: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true; // banks shade the pool when the sun is low
    this.group.add(mesh);
  }

  // the surface fills the shore outline; the bank above the waterline hides its rim
  buildSurface() {
    const b = this.field.band(-Infinity, 0.5, { keep: (i, j) => this.near(i, j), y: () => WATER_Y });
    const g = bandGeometry(b, (x, z) => [x, z], true);
    this.surface = new THREE.Mesh(g, surfaceMaterial(this.u));
    this.surface.receiveShadow = true;
    this.surface.renderOrder = 1;
    this.group.add(this.surface);
  }

  ripple(x, z, amp = 1) {
    if (!this.ripples) return;
    const r = this.ripples[this.nextRipple];
    this.nextRipple = (this.nextRipple + 1) % MAX_RIPPLES;
    r.set(x, z, shared.time.value, amp);
  }

  update(dt, sky) {
    if (!this.ripples) return;
    if (sky) this.u.uSky.value.copy(sky).multiplyScalar(0.25);
    // occasional idle ripples keep the pools alive
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = 0.6 + Math.random() * 1.4;
      const [i, j] = this.tiles[Math.floor(Math.random() * this.tiles.length)];
      const x = (i - this.N / 2 + 0.2 + Math.random() * 0.6) * this.TILE;
      const z = (j - this.N / 2 + 0.2 + Math.random() * 0.6) * this.TILE;
      this.ripple(x, z, 0.25 + Math.random() * 0.2);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ice: walkable frozen ponds ('I' tiles) with procedural cracks        */
/* ------------------------------------------------------------------ */

export class IceField {
  // The ice fills the rounded outline of the 'I' tiles (arena.field); the floor rings it with a
  // snow bank (arena.js groundGeometry). Slipping stays per tile.
  constructor(arena) {
    if (!arena.hasIce || arena.headless) return;
    const ice = (i, j) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (arena.get(i + di, j + dj) === 'I') return true; return false; };
    const g = bandGeometry(arena.field.band(-Infinity, 0.5, { keep: ice, y: () => 0.012 }), (x, z) => [x, z], true);
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, roughness: 0.06, metalness: 0.05, envMapIntensity: 1.2 });
    mat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + CAUSTICS)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  // two scales of cell edges = cracks; frost is whiter where cracks are dense
  float c1 = 1.0 - smoothstep( 0.0, 0.05, cEdges( vWPos.xz * 0.55, 0.0 ) );
  float c2 = 1.0 - smoothstep( 0.0, 0.04, cEdges( vWPos.xz * 1.6 + 7.0, 0.0 ) );
  float frost = cEdges( vWPos.xz * 0.9 + 3.0, 0.0 );
  diffuseColor.rgb = mix( vec3( 0.28, 0.55, 0.78 ), vec3( 0.75, 0.9, 1.0 ), smoothstep( 0.0, 0.6, frost ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.97, 0.99, 1.0 ), max( c1, c2 * 0.6 ) );
}`);
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    arena.group.add(mesh);
  }
}
