import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { shared } from './materials.js';

const C = h => new THREE.Color(h);

// Key-frames of the day. Values are interpolated in linear colour space.
// Azimuth: 0 = sun behind the camera, -90 = from the left, -180 = far side.
// The sun arcs across the FAR side of the arena (left -> right) so shadows fall
// toward the camera where the player can actually see them.
export const PRESETS = [
  {
    name: 'Morning', sun: C(0xffcf9e), sunI: 4.8, el: 28, az: -105,
    sky: C(0xb3d1ff), ground: C(0x7d6446), hemiI: 0.7, env: 0.15, fog: C(0xb6d2ef),
    fogNear: 55, fogFar: 140, exposure: 1.0, bloom: 0.35, night: 0, rim: 0.3, rimC: C(0xffe0bc), shadowI: 0.95,
  },
  {
    name: 'Noon', sun: C(0xfff3de), sunI: 4.8, el: 52, az: -150,
    sky: C(0xc6e1ff), ground: C(0x8c7552), hemiI: 0.75, env: 0.18, fog: C(0xa9cff3),
    fogNear: 55, fogFar: 140, exposure: 0.92, bloom: 0.3, night: 0, rim: 0.25, rimC: C(0xffffff), shadowI: 0.95,
  },
  {
    name: 'Sunset', sun: C(0xff7a2e), sunI: 6.2, el: 19, az: -245,
    sky: C(0x7a70c4), ground: C(0x51301f), hemiI: 0.55, env: 0.12, fog: C(0xe0876a),
    fogNear: 55, fogFar: 140, exposure: 1.08, bloom: 0.55, night: 0.35, rim: 0.6, rimC: C(0xffa066), shadowI: 0.96,
  },
  {
    name: 'Night', sun: C(0x7f9dff), sunI: 0.75, el: 50, az: -200,
    sky: C(0x2a3c78), ground: C(0x0b0b14), hemiI: 0.45, env: 0.05, fog: C(0x0a1122),
    fogNear: 55, fogFar: 140, exposure: 1.0, bloom: 0.85, night: 1, rim: 0.55, rimC: C(0x8fb0ff), shadowI: 0.9,
  },
];

const KEYS = Object.keys(PRESETS[0]).filter(k => k !== 'name');
const UP = new THREE.Vector3(0, 1, 0);
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3();

export class Lighting {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;

    // --- Sun / moon: the only shadow-casting light for the world.
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 3;
    sun.shadow.blurSamples = 16;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 170;
    scene.add(sun, sun.target);

    // --- Sky/ground ambient.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    scene.add(this.hemi);

    // --- Image based light (spec + a bit of diffuse) from a prefiltered room env.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    scene.fog = new THREE.Fog(0xffffff, 55, 140);
    scene.background = new THREE.Color();

    // --- Player lantern: shadow-casting spot that follows the aim. Fades in at night.
    const lamp = this.lamp = new THREE.SpotLight(0xffd7a0, 0, 26, 0.62, 0.65, 1.4);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.bias = -0.0006;
    lamp.shadow.normalBias = 0.04;
    lamp.shadow.radius = 4;
    lamp.shadow.camera.near = 0.4;
    lamp.shadow.camera.far = 26;
    scene.add(lamp, lamp.target);

    this.t = 1;          // continuous time of day, 0..4 (wraps)
    this.target = 1;
    this.cycle = false;
    this.follow = true;  // fit the shadow frustum to the view instead of the whole map
    this.snap = true;    // snap that frustum to shadow-map texels (kills shimmering)
    this.halfSize = 27;
    this.exposureMul = 1;
    this.shadowSize = 2048;
    this.state = {};
    for (const k of KEYS) this.state[k] = PRESETS[1][k] instanceof THREE.Color ? PRESETS[1][k].clone() : PRESETS[1][k];
    this.sunDir = new THREE.Vector3();
    this.helper = null;
    this.evaluate();
    this.apply();
  }

  get presetName() { return PRESETS[Math.round(this.t) % 4].name; }
  get night() { return this.state.night; }
  get bloom() { return this.state.bloom; }

  setPreset(i, instant = false) {
    this.target = ((i % 4) + 4) % 4;
    if (instant) this.t = this.target;
  }
  nextPreset() { this.setPreset(Math.round(this.target) + 1); }

  evaluate() {
    const i0 = Math.floor(this.t) % 4, i1 = (i0 + 1) % 4;
    let f = this.t - Math.floor(this.t);
    f = f * f * (3 - 2 * f);
    const A = PRESETS[i0], B = PRESETS[i1], S = this.state;
    for (const k of KEYS) {
      if (A[k] instanceof THREE.Color) S[k].copy(A[k]).lerp(B[k], f);
      else S[k] = A[k] + (B[k] - A[k]) * f;
    }
  }

  apply() {
    const S = this.state;
    const el = THREE.MathUtils.degToRad(S.el), az = THREE.MathUtils.degToRad(S.az);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    this.sun.color.copy(S.sun);
    const st = this.style || {};
    this.sun.intensity = S.sunI * (st.sun ?? 1);
    this.sun.shadow.intensity = S.shadowI;
    this.hemi.color.copy(S.sky);
    this.hemi.groundColor.copy(S.ground);
    this.hemi.intensity = S.hemiI * (st.hemi ?? 1);
    this.scene.environmentIntensity = S.env * (st.env ?? 1);
    this.scene.fog.color.copy(S.fog);
    this.scene.fog.near = S.fogNear;
    this.scene.fog.far = S.fogFar;
    this.scene.background.copy(S.fog);
    this.renderer.toneMappingExposure = S.exposure * this.exposureMul * (st.exposure ?? 1);
    shared.rimColor.value.copy(S.rimC);
    shared.rimStrength.value = S.rim;
  }

  update(dt, focus) {
    if (this.cycle) {
      this.t = (this.t + dt / 25) % 4;
      this.target = this.t;
    } else {
      const diff = (this.target - this.t + 4) % 4;
      if (diff > 1e-4) this.t = (this.t + Math.min(diff, dt * 0.9)) % 4;
    }
    this.evaluate();
    if (this.weather) this.weather.modify(this.state); // weather bends the time-of-day look
    this.apply();
    this.fitShadow(focus);
    if (this.helper) this.helper.update();
  }

  // Keep the orthographic shadow camera tight around what the player sees.
  // Snapping its origin to whole shadow-map texels (in light space) stops the
  // shadow edges from crawling/shimmering while the camera glides around.
  fitShadow(focus) {
    const half = this.follow ? this.halfSize : 38;
    const cam = this.sun.shadow.camera;
    if (cam.right !== half) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
    const c = _c.set(0, 0, 0);
    if (this.follow) c.set(focus.x, 0, focus.z - 6);
    const d = this.sunDir;
    if (this.follow && this.snap) {
      _r.crossVectors(UP, d).normalize();
      _u.crossVectors(d, _r);
      const texel = (2 * half) / this.sun.shadow.mapSize.x;
      const r = Math.round(c.dot(_r) / texel) * texel;
      const u = Math.round(c.dot(_u) / texel) * texel;
      const f = c.dot(d);
      c.copy(_r).multiplyScalar(r).addScaledVector(_u, u).addScaledVector(d, f);
    }
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(d, 90);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  get texelSize() {
    return (2 * (this.follow ? this.halfSize : 38)) / this.sun.shadow.mapSize.x;
  }

  setShadowSize(size) {
    this.shadowSize = size;
    const on = size > 0;
    this.sun.castShadow = on;
    this.lamp.castShadow = on;
    if (!on) return;
    this.sun.shadow.mapSize.set(size, size);
    this.lamp.shadow.mapSize.set(Math.min(size, 1024), Math.min(size, 1024));
    for (const l of [this.sun, this.lamp]) {
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    }
  }

  setFilter(kind) {
    const T = { pcf: THREE.PCFShadowMap, vsm: THREE.VSMShadowMap, basic: THREE.BasicShadowMap }[kind];
    if (this.renderer.shadowMap.type === T) return;
    this.renderer.shadowMap.type = T;
    // VSM stores moments rather than depth; it needs a different bias.
    this.sun.shadow.bias = kind === 'vsm' ? -0.0008 : -0.0004;
    for (const l of [this.sun, this.lamp]) {
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    }
  }

  setSoftness(r) {
    this.sun.shadow.radius = r;
    this.lamp.shadow.radius = r + 1;
  }

  showFrustum(on) {
    if (on && !this.helper) {
      this.helper = new THREE.CameraHelper(this.sun.shadow.camera);
      this.scene.add(this.helper);
    } else if (!on && this.helper) {
      this.scene.remove(this.helper);
      this.helper.dispose();
      this.helper = null;
    }
  }
}
