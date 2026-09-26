// Oasis: lizards basking by the rocks, jerboas hopping on the sand, dragonflies over the pond,
// butterflies on the golden grass, vultures soaring high and warm dust motes in the light.
export default function oasis(L) {
  const A = L.arena, P = Math.PI;
  const rock = (i, j) => '#X'.includes(A.get(i, j));
  const nearRock = (i, j) => rock(i + 1, j) || rock(i - 1, j) || rock(i, j + 1) || rock(i, j - 1);

  // lizards: teal with an orange back, 0.6 to 0.75 m nose to tail. Homes are picked next to walls, then they
  // roam any open floor (a broken wall must not make them vanish, the helper hides walkers off-ground)
  let homing = true;
  const lizard = L.toy([
    { shape: 'sphere', args: [0.1, 0.9, 0.55, 2.1], pos: [0, 0.07, 0], color: 0x22c7a0 },
    { shape: 'box', args: [0.11, 0.07, 0.13], pos: [0, 0.07, 0.24], color: 0x1fb08f },
    { shape: 'cone', args: [0.05, 0.08, 4], pos: [0, 0.065, 0.34], rot: [P / 2, P / 4, 0], color: 0x1fb08f },
    { shape: 'box', args: [0.07, 0.03, 0.2], pos: [0, 0.12, -0.02], color: 0xff8a2a }, // back stripe
    { shape: 'cone', args: [0.05, 0.34, 5], pos: [0, 0.05, -0.36], rot: [-P / 2, 0, 0], color: 0x22c7a0 },
    { shape: 'box', args: [0.24, 0.04, 0.05], pos: [0, 0.03, 0.1], rot: [0, 0.35, 0], color: 0x178f74 }, // legs
    { shape: 'box', args: [0.24, 0.04, 0.05], pos: [0, 0.03, -0.1], rot: [0, -0.35, 0], color: 0x178f74 },
  ]);
  L.walkers({
    geometry: lizard, count: 10, on: (ch, i, j) => ch === '.' && (!homing || nearRock(i, j)),
    speed: 1.7, pause: [2, 6], range: 1.5, gait: 'scuttle', shy: 3, scale: [0.65, 0.85],
  });
  homing = false;

  // jerboas: sandy hoppers with big pink ears and a long tufted tail, 0.4 m
  const jerboa = L.toy([
    { shape: 'sphere', args: [0.1, 1, 0.95, 1.2], pos: [0, 0.12, 0], color: 0xf2bf72 },
    { shape: 'sphere', args: [0.075, 1, 0.9, 1.05], pos: [0, 0.2, 0.11], color: 0xf7cf8a },
    { shape: 'tri', args: [0.1, 0.07], pos: [0.03, 0.28, 0.1], rot: [0, 0, 1.1], color: 0xff8fa8 }, // ears
    { shape: 'tri', args: [0.1, 0.07], pos: [-0.03, 0.28, 0.1], rot: [0, P, 1.1], color: 0xff8fa8 },
    { shape: 'cone', args: [0.022, 0.36, 4], pos: [0, 0.1, -0.24], rot: [-P / 2 - 0.24, 0, 0], color: 0xe0a95e },
    { shape: 'box', args: [0.06, 0.06, 0.08], pos: [0, 0.06, -0.41], color: 0x3a2a22 }, // tail tuft
    { shape: 'box', args: [0.05, 0.05, 0.14], pos: [0.05, 0.025, -0.02], color: 0xe0a95e }, // hind feet
    { shape: 'box', args: [0.05, 0.05, 0.14], pos: [-0.05, 0.025, -0.02], color: 0xe0a95e },
  ]);
  L.walkers({ geometry: jerboa, count: 5, speed: 1.4, pause: [1, 3.5], range: 3, gait: 'hop', shy: 4, scale: [0.9, 1.1] });

  // vultures: dark brown, pink head, white ruff and wing band; soaring slowly high above the rim
  const vulture = L.toy([
    { shape: 'sphere', args: [0.2, 0.9, 0.65, 1.8], color: 0x4a2c20 },
    { shape: 'cyl', args: [0.1, 0.12, 0.1, 8], pos: [0, 0.02, 0.3], rot: [P / 2, 0, 0], color: 0xf4efe6 }, // ruff
    { shape: 'cone', args: [0.07, 0.22, 5], pos: [0, 0.03, 0.44], rot: [P / 2, 0, 0], color: 0xff7f8f },
    { shape: 'tri', args: [0.32, 0.3], pos: [0, 0, -0.3], rot: [0, P / 2, 0], color: 0x3a2118 }, // tail
  ]);
  const wing = L.toy([
    { shape: 'box', args: [0.95, 0.03, 0.42], pos: [0.5, 0, 0], color: 0x4a2c20 },
    { shape: 'box', args: [0.85, 0.035, 0.12], pos: [0.52, 0, -0.14], color: 0xefe6d6 }, // light band
    ...[0.12, 0, -0.12].map((z, k) => ({ shape: 'box', args: [0.26, 0.025, 0.07], pos: [1.08, 0, z], rot: [0, (k - 1) * 0.25, 0], color: 0x2c1810 })), // fingers
  ]);
  L.flock({ body: vulture, wing, count: 5, flocks: 2, radius: [15, 24], height: [10, 13], speed: 0.13, flap: 1.1, glide: 0.85, spread: 3.2, scale: [1, 1.2] });

  // dragonflies darting over the pond
  const dragonfly = L.toy([
    { shape: 'cyl', args: [0.025, 0.015, 0.4, 4], rot: [P / 2, 0, 0], pos: [0, 0, -0.05] },
    { shape: 'box', args: [0.07, 0.06, 0.07], pos: [0, 0, 0.17] },
    { shape: 'tri', args: [0.24, 0.07], pos: [0, 0.01, 0.07] }, { shape: 'tri', args: [0.24, 0.07], pos: [0, 0.01, 0.07], rot: [0, P, 0] },
    { shape: 'tri', args: [0.2, 0.06], pos: [0, 0.01, -0.02] }, { shape: 'tri', args: [0.2, 0.06], pos: [0, 0.01, -0.02], rot: [0, P, 0] },
  ]);
  const pond = L.spots(ch => ch === 'W', 4);
  if (pond.length) L.swarm({ geometry: dragonfly, count: 8, at: pond, radius: 1.8, height: [0.5, 1.3], speed: 0.9, flutter: 40, colors: [0x31d8ff, 0xff4fc8, 0x6cff5a, 0x4a7bff] });

  // butterflies on the golden grass
  L.swarm({ count: 8, at: L.spots(ch => ch === 'B', 5), radius: 1.8, height: [0.8, 1.8], speed: 0.45, colors: [0xff8a1c, 0xfff4e0, 0xffd23a] });

  // warm dust motes drifting slowly across the light
  const mote = L.toy([{ shape: 'box', args: [0.06, 0.06, 0.06] }]);
  L.swarm({ geometry: mote, count: 26, at: L.spots(ch => ch === '.', 10), radius: 1.5, height: [0.8, 4], speed: 0.15, flutter: 0, drift: [0.25, 0.1], spin: 0.8, glow: 0.35, colors: [0xfff0c8, 0xffe0a0], scale: [0.7, 1.3] });
}
