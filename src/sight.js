import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { TILE, N, HALF } from './arena.js';

// Line of sight: what walls, trees and crates hide from you is dimmed and greyed out.
//
// Each frame a fan of rays is walked through the tile grid (DDA) from the viewer; the polygon
// they trace is filled into a small top-down mask. Rays run a little way into the tile that
// stops them so the wall face and top stay lit. A screen pass then projects every pixel onto a
// mid-height plane (same trick as visionfog.js) and looks the mask up there, blurred for a soft edge.
const RAYS = 900;
const SIZE = 256;          // mask resolution over the whole arena (~0.2 m per texel)
const INTO_WALL = 1.4;     // metres a ray keeps going inside the occluder, so its face stays lit
const MAX_T = N * 1.5;     // tiles: longer than any diagonal

const SightShader = {
  uniforms: {
    tDiffuse: { value: null },
    tVis: { value: null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uHalf: { value: HALF },
    uAmount: { value: 0 },
    uCenter: { value: new THREE.Vector2() },
    uDust: { value: new THREE.Color() },
    uDustAmt: { value: 0 },  // sandstorm: hidden ground drowns in dust instead of going dark
    uClearR: { value: 0 },   // how far you see (m); past it the view dims like a hidden area
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tVis;
    uniform mat4 uInvViewProj;
    uniform vec3 uCamPos;
    uniform float uHalf;
    uniform float uAmount;
    uniform vec2 uCenter;
    uniform vec3 uDust;
    uniform float uDustAmt;
    uniform float uClearR;
    varying vec2 vUv;
    float vis( vec2 uv ) {
      return ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) ? 0.0 : texture2D( tVis, uv ).r;
    }
    void main() {
      vec4 col = texture2D( tDiffuse, vUv );
      vec4 wp = uInvViewProj * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
      vec3 dir = normalize( wp.xyz / wp.w - uCamPos );
      vec2 hit = uCamPos.xz + dir.xz * ( ( 0.6 - uCamPos.y ) / min( dir.y, -1e-3 ) );
      vec2 uv = ( hit + uHalf ) / ( 2.0 * uHalf );
      float r = 2.5 / ${SIZE.toFixed(1)};
      float v = vis( uv ) * 0.28
              + ( vis( uv + vec2( r, 0.0 ) ) + vis( uv - vec2( r, 0.0 ) ) + vis( uv + vec2( 0.0, r ) ) + vis( uv - vec2( 0.0, r ) ) ) * 0.12
              + ( vis( uv + vec2( r, r ) ) + vis( uv - vec2( r, r ) ) + vis( uv + vec2( r, -r ) ) + vis( uv - vec2( r, -r ) ) ) * 0.06;
      float hide = 1.0 - v;
      if ( uClearR > 0.0 ) hide = max( hide, smoothstep( uClearR * 0.85, uClearR * 1.1, distance( hit, uCenter ) ) );
      hide *= uAmount;
      float l = dot( col.rgb, vec3( 0.299, 0.587, 0.114 ) );
      vec3 shade = mix( col.rgb, vec3( l ), 0.5 ) * vec3( 0.58, 0.61, 0.7 );
      shade = mix( shade, uDust * ( 0.85 + 0.3 * l ), uDustAmt );
      col.rgb = mix( col.rgb, shade, hide );
      gl_FragColor = col;
    }`,
};

export class Sight {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.flipY = false;
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.pass = new ShaderPass(SightShader);
    this.pass.enabled = false;
    this.u = this.pass.uniforms;
    this.u.tVis.value = this.tex;
    this.amount = 0;
    this.pts = new Float32Array(RAYS * 2);
    this.key = '';
  }

  // viewer: the brawler whose eyes the screen shows, or null (menus, spectating) for no mask.
  // dust: the storm colour on sandstorm maps (hidden = dusty), else null.
  // range: sight distance in metres (0 = unlimited).
  update(dt, camera, arena, viewer, dust = null, range = 0) {
    const want = viewer && arena ? 1 : 0;
    this.amount += (want - this.amount) * (1 - Math.exp(-4 * dt));
    this.pass.enabled = this.amount > 0.005;
    if (!this.pass.enabled) return;
    this.u.uAmount.value = this.amount;
    this.u.uInvViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    this.u.uCamPos.value.copy(camera.position);
    const d = dust ? 1 : 0;
    this.u.uDustAmt.value += (d * 0.92 - this.u.uDustAmt.value) * (1 - Math.exp(-2 * dt));
    if (dust) this.u.uDust.value.copy(dust);
    this.u.uClearR.value = range;
    if (viewer) this.u.uCenter.value.set(viewer.pos.x, viewer.pos.z);
    if (viewer && arena) this.trace(arena, viewer.pos.x, viewer.pos.z);
  }

  trace(A, x, z) {
    const key = `${x.toFixed(2)},${z.toFixed(2)},${A.crates.size}`;
    if (key === this.key) return; // nothing moved, nothing broke: the mask still holds
    this.key = key;
    const ux = x / TILE + N / 2, uz = z / TILE + N / 2, into = INTO_WALL / TILE, pts = this.pts;
    for (let k = 0; k < RAYS; k++) {
      const a = (k / RAYS) * Math.PI * 2;
      let dx = Math.cos(a), dz = Math.sin(a);
      if (Math.abs(dx) < 1e-6) dx = 1e-6;
      if (Math.abs(dz) < 1e-6) dz = 1e-6;
      const t = castRay(A, ux, uz, dx, dz, into);
      pts[k * 2] = ux + dx * t;
      pts[k * 2 + 1] = uz + dz * t;
    }
    const c = this.ctx, s = SIZE / N;
    c.fillStyle = '#000';
    c.fillRect(0, 0, SIZE, SIZE);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(pts[0] * s, pts[1] * s);
    for (let k = 1; k < RAYS; k++) c.lineTo(pts[k * 2] * s, pts[k * 2 + 1] * s);
    c.closePath();
    c.fill();
    this.tex.needsUpdate = true;
  }
}

// Grid DDA in tile units: distance to where the ray enters the first sight-blocking tile, plus up
// to `into` further while it stays inside that occluder.
function castRay(A, ux, uz, dx, dz, into) {
  let i = Math.floor(ux), j = Math.floor(uz);
  const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx), tdz = Math.abs(1 / dz);
  let tx = (dx > 0 ? i + 1 - ux : ux - i) * tdx;
  let tz = (dz > 0 ? j + 1 - uz : uz - j) * tdz;
  let t = 0, hit = -1;
  while (t < MAX_T) {
    if (tx < tz) { t = tx; tx += tdx; i += si; } else { t = tz; tz += tdz; j += sj; }
    const blocked = A.blocksSight(i, j);
    if (hit < 0) {
      if (blocked) hit = t;
    } else if (!blocked || t - hit >= into) {
      return Math.min(t, hit + into);
    }
  }
  return hit < 0 ? MAX_T : hit + into;
}
