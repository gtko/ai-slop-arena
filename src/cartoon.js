import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// "Cartoon" art style: soft cel shading for every standard/physical material in the game.
//
// Instead of swapping materials, the shared physical lighting chunk is patched once at startup
// (before anything compiles): direct light N·L goes through a soft two-step ramp, so surfaces get
// a lit band, a mid band and a shadow band with smooth edges, like a 3D cartoon. Shadows, point
// lights, lanterns and the time of day keep working because only the falloff shape changes.
// Switching style needs a reload (shader programs are cached by the renderer).

const RAMP = /* glsl */`
float toonRamp( float x ) {
  // shadow side .. soft terminator .. mid tone .. lit plateau
  return smoothstep( 0.0, 0.12, x ) * 0.52 + smoothstep( 0.3, 0.5, x ) * 0.48;
}
`;

let enabled = false;

export function enableCartoonShading() {
  if (enabled) return;
  enabled = true;
  const C = THREE.ShaderChunk;
  C.lights_physical_pars_fragment = RAMP + C.lights_physical_pars_fragment.replace(
    'vec3 irradiance = dotNL * directLight.color;',
    'vec3 irradiance = mix( dotNL, toonRamp( dotNL ), 0.85 ) * directLight.color;',
  );
}

// Final colour pop: a little extra saturation and contrast, applied before tone mapping.
export function cartoonGradePass() {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uSat: { value: 1.18 }, uContrast: { value: 1.06 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float uSat; uniform float uContrast; varying vec2 vUv;
      void main() {
        vec4 c = texture2D( tDiffuse, vUv );
        float l = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        vec3 col = mix( vec3( l ), c.rgb, uSat );
        col = ( col - 0.18 ) * uContrast + 0.18;
        gl_FragColor = vec4( max( col, 0.0 ), c.a );
      }`,
  });
}
