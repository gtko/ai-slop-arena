import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Limited field of view (Misty Marsh): a screen-space fog wall centred on the player.
//
// No depth buffer needed: for a top-down camera, where each pixel's view ray crosses the
// mid-height plane (y = 0.8) is a good stand-in for its world position. Distance from the player
// in that plane drives the fog, with two scrolling noise layers so the edge churns. The pass runs
// in linear HDR before bloom and never goes fully opaque, so lanterns, fireflies and projectiles
// beyond the wall still glow through it.
const VisionFogShader = {
  uniforms: {
    tDiffuse: { value: null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: 11 },
    uColor: { value: new THREE.Color() },
    uAmount: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform mat4 uInvViewProj;
    uniform vec3 uCamPos;
    uniform vec2 uCenter;
    uniform float uRadius;
    uniform vec3 uColor;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
    float vnoise( vec2 p ) {
      vec2 i = floor( p ), f = fract( p );
      f = f * f * ( 3.0 - 2.0 * f );
      return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y );
    }
    void main() {
      vec4 col = texture2D( tDiffuse, vUv );
      vec4 wp = uInvViewProj * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
      vec3 dir = normalize( wp.xyz / wp.w - uCamPos );
      vec2 hit = uCamPos.xz + dir.xz * ( ( 0.8 - uCamPos.y ) / min( dir.y, -1e-3 ) );
      float d = distance( hit, uCenter );
      float n = vnoise( hit * 0.32 + vec2( uTime * 0.16, uTime * 0.05 ) ) * 0.65
              + vnoise( hit * 0.9 - vec2( uTime * 0.11, - uTime * 0.13 ) ) * 0.35;
      float f = smoothstep( uRadius * 0.55, uRadius * 1.05, d + ( n - 0.5 ) * 2.6 );
      // a thin brighter band hugging the wall reads as backlit mist
      float band = smoothstep( uRadius * 0.45, uRadius * 0.75, d ) * ( 1.0 - smoothstep( uRadius * 0.75, uRadius * 1.1, d ) );
      vec3 fogC = uColor * ( 0.85 + 0.3 * n ) + uColor * band * 0.25;
      col.rgb = mix( col.rgb, fogC, min( f, 0.975 ) * uAmount );
      gl_FragColor = col;
    }`,
};

const MOON_MIST = new THREE.Color(0.1, 0.13, 0.13);

export class VisionFog {
  constructor() {
    this.pass = new ShaderPass(VisionFogShader);
    this.pass.enabled = false;
    this.u = this.pass.uniforms;
    this.amount = 0;
  }

  // radius 0 = off. center: world xz of whoever the camera follows.
  update(dt, camera, radius, center, fogColor, time) {
    const want = radius > 0 ? 1 : 0;
    this.amount += (want - this.amount) * (1 - Math.exp(-3 * dt));
    this.pass.enabled = this.amount > 0.005;
    if (!this.pass.enabled) return;
    if (radius > 0) this.u.uRadius.value = radius;
    this.u.uAmount.value = this.amount;
    this.u.uInvViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    this.u.uCamPos.value.copy(camera.position);
    this.u.uCenter.value.set(center.x, center.z);
    // at night the scene fog is near-black; keep a faint moonlit grey-green so it still reads as fog
    const c = this.u.uColor.value.copy(fogColor);
    if (c.r + c.g + c.b < 0.35) c.lerp(MOON_MIST, 0.55);
    this.u.uTime.value = time;
  }
}
