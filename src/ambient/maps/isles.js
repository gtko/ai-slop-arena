// Windmill Isles: butterflies over the meadows and dandelion seeds on the wind (the gulls, clouds and
// far islets under the islands are drawn by kit.js).
export default function isles(L) {
  const open = ch => ch === '.' || ch === 'B';
  L.swarm({ count: 14, at: L.spots(open, 6), radius: 2.2, height: [0.6, 1.8], speed: 0.5, colors: [0xffd84a, 0xffffff, 0xff9ad0, 0x9ad8ff] });
  const seed = L.toy([
    { shape: 'sphere', args: [0.07], color: 0xffffff },
    { shape: 'cyl', args: [0.01, 0.01, 0.16, 4], pos: [0, -0.1, 0], color: 0xe8e0c8 },
  ]);
  L.swarm({ geometry: seed, count: 24, at: L.spots(open, 10), radius: 1.2, height: [1.2, 3.5], speed: 0.25, flutter: 0, drift: [0.7, 0.25], scale: [0.8, 1.3] });
}
