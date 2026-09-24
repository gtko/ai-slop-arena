// Persistent game settings (graphics, gameplay, controls). Audio levels live in audio.js.
// Anything that changes calls the listeners so every UI (options menu, debug panel) stays in sync.

const STORE = 'iaslop-settings-v1';

export const DEFAULT_BINDS = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
  super: 'Space', tod: 'KeyT', mute: 'KeyM', panel: 'Tab', pause: 'Escape',
};

// Quality presets only touch these keys; changing one of them by hand switches to "custom".
export const QUALITY = {
  low: { renderScale: 0.75, msaa: 0, shadows: 1024, shadowFilter: 'basic', softness: 1, ao: false, bloom: false, weather: 0.35 },
  medium: { renderScale: 1, msaa: 2, shadows: 2048, shadowFilter: 'pcf', softness: 2, ao: false, bloom: true, weather: 0.7 },
  high: { renderScale: 1, msaa: 4, shadows: 2048, shadowFilter: 'pcf', softness: 3, ao: true, bloom: true, weather: 1 },
  ultra: { renderScale: 1.25, msaa: 4, shadows: 4096, shadowFilter: 'pcf', softness: 3, ao: true, bloom: true, weather: 1 },
};
const QUALITY_KEYS = new Set(Object.keys(QUALITY.high));

// preset 'auto' (the default): autoquality.js picks the tier from the GPU, then follows the frame rate.
export const TIERS = ['low', 'medium', 'high', 'ultra'];
export const DEFAULTS = {
  preset: 'auto', ...QUALITY.high, autoTier: null, autoMax: null, autoScale: 0, gpu: '',
  fitFrustum: true, texelSnap: true, showFrustum: false, aoView: false, dynLights: true,
  art: 'cartoon', tod: '2', exposure: 1, shake: true, fps: false, debugPanel: false,
  deadzone: 0.18, vibration: true, lang: 'auto',
  binds: { ...DEFAULT_BINDS },
};

function load() {
  const s = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    // Before automatic quality existed, 'high' was just the untouched default: let auto take over.
    if (!saved.autoV && saved.preset === 'high') saved.preset = 'auto';
    saved.autoV = 1;
    Object.assign(s, saved);
    s.binds = { ...DEFAULT_BINDS, ...(saved.binds || {}) };
  } catch { /* private mode or corrupt: defaults */ }
  return s;
}

export const settings = load();
const listeners = new Set();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* ignore */ } };
const notify = key => listeners.forEach(fn => fn(key, settings[key]));

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function set(key, value) {
  if (settings[key] === value) return;
  settings[key] = value;
  // a hand-tuned quality setting leaves the presets (and automatic mode) for "custom"
  if (QUALITY_KEYS.has(key) && settings.preset !== 'custom') { settings.preset = 'custom'; notify('preset'); }
  save();
  notify(key);
}

// name: a tier, or 'auto' (keeps the tier autoquality.js chose). extra: overrides on top (the
// automatic mode lowers renderScale below the low tier).
export function applyQuality(name, extra = null) {
  const auto = name === 'auto';
  const tier = auto ? (settings.autoTier || 'high') : name;
  const q = QUALITY[tier];
  if (!q) return;
  for (const [k, v] of Object.entries({ ...q, ...extra })) if (settings[k] !== v) { settings[k] = v; notify(k); }
  settings.preset = auto ? 'auto' : name;
  save();
  notify('preset');
}
export function setAutoInfo(info) { Object.assign(settings, info); save(); }

export function bind(action, code) {
  // one key per action: steal it from whichever action had it
  for (const [a, c] of Object.entries(settings.binds)) if (c === code && a !== action) settings.binds[a] = settings.binds[action];
  settings.binds[action] = code;
  save();
  notify('binds');
}

export function resetBinds() { settings.binds = { ...DEFAULT_BINDS }; save(); notify('binds'); }

export function resetGroup(keys) {
  for (const k of keys) settings[k] = structuredClone(DEFAULTS[k]);
  save();
  keys.forEach(notify);
}

const NAMES = {
  Space: 'Space', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'Caps',
};
export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
