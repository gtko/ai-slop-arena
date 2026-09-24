// The game code builds a few textures on <canvas> and looks up DOM nodes (weather flash). On the
// server (Cloudflare Workers, no DOM) those become inert stand-ins: nothing is ever drawn there.
const noop = () => {};
const ctx2d = new Proxy({}, {
  get: (_, k) => (k === 'canvas' ? undefined : k === 'measureText' ? () => ({ width: 0 })
    : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop: noop })
    : k === 'getImageData' || k === 'createImageData' ? (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h })
    : noop),
  set: () => true,
});
const element = () => ({
  width: 1, height: 1, style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  getContext: () => ctx2d, addEventListener: noop, removeEventListener: noop, appendChild: noop, remove: noop,
  setAttribute: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
});
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: element, createElementNS: element, getElementById: element, querySelector: element,
    querySelectorAll: () => [], body: element(), documentElement: element(), addEventListener: noop,
  };
}
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.matchMedia === 'undefined') globalThis.matchMedia = () => ({ matches: false, addEventListener: noop });
if (typeof globalThis.addEventListener === 'undefined') globalThis.addEventListener = noop;
