import { settings, applyQuality, setAutoInfo, TIERS } from './settings.js';

// Automatic graphics quality (preset "auto", the default).
//  1. First launch: guess a tier from the GPU the browser reports (WEBGL_debug_renderer_info) and
//     the device (phone / tablet, CPU cores). That tier is also the ceiling ("autoMax").
//  2. While playing: measure the real frame rate in 4 s windows. Too slow -> one tier down (below
//     "low", the render resolution drops to 60% then 50%). Smooth for a while and below the
//     ceiling -> one step back up. The result is saved, so the next launch starts where it ended.

const WINDOW = 4;         // seconds per measure
const SLOW_FPS = 45;      // below this (sustained) we step down
const UP_WINDOWS = 5;     // this many smooth windows in a row before stepping up
const STEPS = [...TIERS.map(t => ({ tier: t })), { tier: 'low', renderScale: 0.6 }, { tier: 'low', renderScale: 0.5 }];
// STEPS, from best to worst: ultra, high, medium, low, low@60%, low@50%
const ORDER = [3, 2, 1, 0, 4, 5];

export function detectGpu(renderer) {
  const gl = renderer.getContext();
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { /* hidden by the browser */ }
  const g = gpu.toLowerCase();
  const mobile = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  let tier;
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) tier = 'low';
  else if (mobile || /adreno|mali|powervr|apple gpu|tegra|videocore/.test(g)) {
    // recent flagship phone GPUs manage medium; everything else starts low
    tier = /adreno \(tm\) (7[3-9]\d|8\d\d)|apple gpu|mali-g7[1-9]|mali-g[6-9]\d\d|immortalis/.test(g) ? 'medium' : 'low';
  } else if (/rtx|rx [5-9]\d{3}|radeon pro w|apple m[2-9]|arc a7/.test(g)) tier = 'ultra';
  else if (/gtx|radeon|rx |apple m1|arc|quadro|nvidia/.test(g)) tier = 'high';
  else if (/intel|iris|uhd|hd graphics|vega \d\b|radeon\(tm\) graphics/.test(g)) tier = 'medium';
  else tier = cores >= 8 ? 'high' : 'medium';
  return { gpu, tier };
}

export class AutoQuality {
  constructor(renderer) {
    this.renderer = renderer;
    this.t = 0; this.frames = 0; this.good = 0; this.cooldown = 3;
    this.last = performance.now();
    this.fps = 0;
    if (!settings.autoTier || !settings.gpu) this.calibrate();
    else if (settings.preset === 'auto') this.apply(this.step, false);
  }

  get enabled() { return settings.preset === 'auto'; }
  // index into ORDER of the current step
  get step() {
    const i = STEPS.findIndex(s => s.tier === settings.autoTier && (s.renderScale || 0) === (settings.autoScale || 0));
    return Math.max(0, ORDER.indexOf(i < 0 ? TIERS.indexOf('high') : i));
  }
  get maxStep() { return Math.max(0, ORDER.indexOf(TIERS.indexOf(settings.autoMax || 'ultra'))); }

  // Fresh guess from the GPU (first launch, or "Detect again" in Options).
  calibrate() {
    const { gpu, tier } = detectGpu(this.renderer);
    setAutoInfo({ gpu, autoMax: tier, autoTier: tier, autoScale: 0 });
    this.good = 0; this.cooldown = 3;
    if (this.enabled) this.apply(this.step, false);
  }

  apply(stepIdx, save = true) {
    const s = STEPS[ORDER[stepIdx]];
    if (save) setAutoInfo({ autoTier: s.tier, autoScale: s.renderScale || 0 });
    applyQuality('auto', s.renderScale ? { renderScale: s.renderScale } : null);
    this.cooldown = 3; // let the new settings settle before measuring again
    this.t = 0; this.frames = 0;
  }

  // Called once per rendered frame. `active`: a match or the menu scene is being drawn and the
  // page is visible (a hidden tab or an open overlay would give meaningless numbers).
  update(active) {
    const now = performance.now(), dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    if (!active) { this.t = 0; this.frames = 0; return; }
    this.t += dt; this.frames++;
    if (this.t < WINDOW) return;
    this.fps = this.frames / this.t;
    this.t = 0; this.frames = 0;
    if (!this.enabled) return;
    if (this.cooldown > 0) { this.cooldown -= WINDOW; return; }
    const step = this.step;
    if (this.fps < SLOW_FPS && step < ORDER.length - 1) { this.good = 0; this.apply(step + 1); return; }
    if (this.fps >= 57 && step > this.maxStep) {
      if (++this.good >= UP_WINDOWS) { this.good = 0; this.apply(step - 1); }
    } else this.good = 0;
  }

  // "High · 60% res" style label for the Options screen and the FPS counter.
  label(tierName) {
    const s = STEPS[ORDER[this.step]];
    return s.renderScale ? `${tierName(s.tier)} · ${Math.round(s.renderScale * 100)}%` : tierName(s.tier);
  }
}
