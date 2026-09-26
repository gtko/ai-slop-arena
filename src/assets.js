import * as THREE from 'three';

// Generated art lives in /public/assets (see art-src/ for the generation + processing scripts).
export const ASSET_BASE = import.meta.env.BASE_URL + 'assets/';

const TEX_NAMES = ['sand', 'brick', 'stone', 'wood', 'grass', 'snow', 'forest', 'mud', 'clay', 'mossbrick', 'icestone'];
export const TEX_FILES = TEX_NAMES.length * 2; // colour + normal map each
const loaded = {};

function load(url) {
  return new Promise(res => new THREE.TextureLoader().load(url, res, undefined, () => {
    console.warn('Missing texture, using procedural fallback:', url);
    res(null);
  }));
}

// Resolve once every texture is in (or missing). Callers fall back to procedural art on null.
export async function loadTextures(renderer, onItem = () => {}) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const prep = (t, srgb) => {
    if (!t) return t;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  await Promise.all(TEX_NAMES.flatMap(n => [
    load(`${ASSET_BASE}tex/${n}.jpg`).then(t => { loaded[n] = prep(t, true); onItem(); }),
    load(`${ASSET_BASE}tex/${n}_n.png`).then(t => { loaded[n + '_n'] = prep(t, false); onItem(); }),
  ]));
}

export function image(name) { return loaded[name] ? loaded[name].image : null; }

// A clone shares the uploaded GPU image (same Source) but has its own repeat.
export function tex(name, rx = 1, ry = rx) {
  const t = loaded[name];
  if (!t) return null;
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.userData.perMatch = true; // a copy for one arena: freed with it (arena.js / water.js dispose)
  return c;
}
