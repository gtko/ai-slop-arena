// Rainy Grove: frogs by the ponds, ducks on them, snails, hedgehogs and squirrels out in the rain, robins
// hunched on the outer walls, and wet leaves shaken off the trees around the arena.
export default function grove(L) {
  const { THREE, arena: A, rand: R } = L;
  const N = 25, HALF = 25, WALL = 24, WALL_H = 2.7; // arena.js: N, HALF, boundary tile centre, BOUND_H
  const open = ch => ch === '.';
  const nearWater = (ch, i, j) => {
    if (!open(ch)) return false;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (A.get(i + di, j + dj) === 'W') return true;
    return false;
  };

  // frogs: squat, bright green, big eyes, hopping around the pond banks
  const frog = L.toy([
    { shape: 'sphere', args: [0.16, 1.05, 0.62, 1.2], pos: [0, 0.11, 0], color: 0x3fc94a },
    { shape: 'cyl', args: [0.055, 0.055, 0.07, 6], pos: [0.08, 0.2, 0.1], color: 0xfff07a },
    { shape: 'cyl', args: [0.055, 0.055, 0.07, 6], pos: [-0.08, 0.2, 0.1], color: 0xfff07a },
    { shape: 'box', args: [0.035, 0.03, 0.03], pos: [0.1, 0.24, 0.13], color: 0x151515 },
    { shape: 'box', args: [0.035, 0.03, 0.03], pos: [-0.1, 0.24, 0.13], color: 0x151515 },
    { shape: 'box', args: [0.09, 0.07, 0.2], pos: [0.14, 0.04, -0.07], rot: [0, 0.35, 0], color: 0x2a9a3a },
    { shape: 'box', args: [0.09, 0.07, 0.2], pos: [-0.14, 0.04, -0.07], rot: [0, -0.35, 0], color: 0x2a9a3a },
    { shape: 'box', args: [0.05, 0.05, 0.08], pos: [0.1, 0.03, 0.15], color: 0x2a9a3a },
    { shape: 'box', args: [0.05, 0.05, 0.08], pos: [-0.1, 0.03, 0.15], color: 0x2a9a3a },
  ]);
  L.critters({ key: 'frog', toy: frog, count: 7, on: nearWater, gait: 'hop', speed: 1.2, run: 2.2, pause: [1.5, 5], range: 1, shy: 3, scale: [1.1, 1.4], rigScale: 0.8 });

  // snails: orange shell, slow, never flee (a snail is not going anywhere fast)
  const snail = L.toy([
    { shape: 'box', args: [0.12, 0.06, 0.38], pos: [0, 0.03, 0.02], color: 0xe6d49a },
    { shape: 'box', args: [0.1, 0.1, 0.08], pos: [0, 0.08, 0.17], color: 0xe6d49a },
    { shape: 'cyl', args: [0.012, 0.012, 0.1, 4], pos: [0.035, 0.16, 0.19], rot: [0.35, 0, -0.3], color: 0xe6d49a },
    { shape: 'cyl', args: [0.012, 0.012, 0.1, 4], pos: [-0.035, 0.16, 0.19], rot: [0.35, 0, 0.3], color: 0xe6d49a },
    { shape: 'box', args: [0.03, 0.03, 0.03], pos: [0.05, 0.21, 0.2], color: 0x2a2020 },
    { shape: 'box', args: [0.03, 0.03, 0.03], pos: [-0.05, 0.21, 0.2], color: 0x2a2020 },
    { shape: 'sphere', args: [0.14, 0.75, 1, 1], pos: [0, 0.17, -0.04], color: 0xe0782a },
    { shape: 'cyl', args: [0.065, 0.065, 0.23, 8], pos: [0, 0.18, -0.04], rot: [0, 0, Math.PI / 2], color: 0xffcf8a },
  ]);
  L.walkers({ geometry: snail, count: 6, gait: 'none', speed: 0.07, pause: [4, 10], range: 1, shy: 0, scale: [1.1, 1.4] });

  // hedgehogs: a spiky brown dome with a pointy tan face, waddling between the bushes
  const spikes = [[0, 0.3, -0.05, -0.3, 0], [0.12, 0.25, 0, -0.2, -0.7], [-0.12, 0.25, 0, -0.2, 0.7], [0.08, 0.24, -0.16, -0.9, -0.4], [-0.08, 0.24, -0.16, -0.9, 0.4], [0, 0.26, 0.08, 0.3, 0]];
  const hedgehog = L.toy([
    { shape: 'sphere', args: [0.2, 0.95, 0.72, 1.15], pos: [0, 0.15, -0.02], color: 0x6a4630 },
    ...spikes.map(([x, y, z, rx, rz]) => ({ shape: 'cone', args: [0.06, 0.16, 4], pos: [x, y, z], rot: [rx, 0, rz], color: 0x4a2f20 })),
    { shape: 'cone', args: [0.09, 0.2, 6], pos: [0, 0.12, 0.24], rot: [Math.PI / 2, 0, 0], color: 0xe6c49a },
    { shape: 'box', args: [0.05, 0.05, 0.05], pos: [0, 0.12, 0.34], color: 0x151010 },
    { shape: 'box', args: [0.03, 0.03, 0.03], pos: [0.06, 0.18, 0.22], color: 0x151010 },
    { shape: 'box', args: [0.03, 0.03, 0.03], pos: [-0.06, 0.18, 0.22], color: 0x151010 },
  ]);
  L.critters({ key: 'hedgehog', toy: hedgehog, count: 3, gait: 'waddle', speed: 0.45, run: 1.1, pause: [2, 6], range: 3, shy: 3, scale: [1, 1.2], rigScale: 1.2 });

  // squirrels on the grass next to the bushes, quick hops and long looks around
  const byBush = (ch, i, j) => ch === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => A.get(i + a, j + b) === 'B');
  const squirrel = L.toy([
    { shape: 'sphere', args: [0.09, 0.9, 1, 1.3], pos: [0, 0.13, 0], color: 0xc0602a },
    { shape: 'sphere', args: [0.1, 0.8, 1.5, 0.9], rot: [0.4, 0, 0], pos: [0, 0.26, -0.16], color: 0xe07a3a }, // bushy tail
    { shape: 'cone', args: [0.07, 0.15, 6], rot: [Math.PI / 2, 0, 0], pos: [0, 0.18, 0.15], color: 0xc0602a },
  ]);
  L.critters({ key: 'squirrel', toy: squirrel, count: 3, on: byBush, gait: 'hop', speed: 1.6, run: 3, pause: [0.8, 3], range: 2, shy: 3.5, scale: [1.1, 1.3] });

  // ducks paddling on the pond, waddling up the banks now and then
  const duck = L.toy([
    { shape: 'sphere', args: [0.15, 0.95, 0.7, 1.35], pos: [0, 0.16, 0], color: 0x8a6a4a },
    { shape: 'sphere', args: [0.08], pos: [0, 0.3, 0.15], color: 0x2f8a4a },
    { shape: 'box', args: [0.06, 0.025, 0.08], pos: [0, 0.29, 0.25], color: 0xffc21a },
    { shape: 'box', args: [0.09, 0.05, 0.08], rot: [-0.5, 0, 0], pos: [0, 0.22, -0.2], color: 0x5a4430 },
  ]);
  L.critters({ key: 'duck', toy: duck, count: 3, on: (ch, i, j) => ch === 'W' || nearWater(ch, i, j), home: ch => ch === 'W',
    swim: ch => ch === 'W', gait: 'waddle', speed: 0.4, run: 1.2, pause: [2, 6], range: 2, shy: 3.5, scale: [1, 1.15], rigScale: 1.1 });

  const dens = n => Math.max(1, Math.round(n * L.density));
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const mat = o => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: o ? THREE.DoubleSide : THREE.FrontSide });
  const inst = (geo, n, material) => {
    const m = new THREE.InstancedMesh(geo, material, n);
    m.frustumCulled = false;
    L.group.add(m);
    return m;
  };

  /* robins hunched on the outer walls, out of the play area; hop along the cap, flutter off from brawlers */
  const robin = L.toy([
    { shape: 'sphere', args: [0.11, 0.9, 0.85, 1.1], pos: [0, 0.12, 0], color: 0x7a4b2c },
    { shape: 'box', args: [0.13, 0.11, 0.06], pos: [0, 0.11, 0.08], color: 0xff5a24 },
    { shape: 'box', args: [0.1, 0.1, 0.1], pos: [0, 0.22, 0.07], color: 0x7a4b2c },
    { shape: 'cone', args: [0.025, 0.07, 4], pos: [0, 0.21, 0.15], rot: [Math.PI / 2, 0, 0], color: 0xffc53a },
    { shape: 'box', args: [0.07, 0.02, 0.12], pos: [0, 0.14, -0.14], rot: [-0.4, 0, 0], color: 0x5a341e },
    { shape: 'box', args: [0.02, 0.06, 0.02], pos: [0.04, 0.02, 0], color: 0x3a2a20 },
    { shape: 'box', args: [0.02, 0.06, 0.02], pos: [-0.04, 0.02, 0], color: 0x3a2a20 },
  ]);
  const wings = L.toy([
    { shape: 'tri', args: [0.2, 0.12], pos: [0.04, 0.15, 0], color: 0x6a3f24 },
    { shape: 'tri', args: [0.2, 0.12], pos: [-0.04, 0.15, 0], rot: [0, Math.PI, 0], color: 0x6a3f24 },
  ]);
  const lamp = u => [-12, 0, 12].some(l => Math.abs(u - l) < 1.4); // the lanterns on the wall caps
  const cap = (side, u, w = 0) => side < 2 ? [u, (side ? WALL : -WALL) + w] : [(side === 2 ? -WALL : WALL) + w, u];
  const perch = (side, u) => A.charAt(...cap(side, u)) === 'X' && !lamp(u) && Math.abs(u) < WALL + 0.6; // a free spot on the cap
  const birds = [];
  for (let k = 0, tries = 0; k < dens(6) && tries < 60; tries++) {
    const side = Math.floor(R() * 4), u = (R() - 0.5) * 2 * (WALL - 1);
    if (!perch(side, u)) continue;
    birds.push({ side, u, u0: u, u1: u, w: (R() - 0.5) * 0.6, yaw: R() * 6.3, t: 0, T: 0, fly: 0, wait: R() * 3, ph: R() * 6.3, s: 1 + R() * 0.3 });
    k++;
  }
  const bodies = inst(robin, Math.max(1, birds.length), mat(false)), wingM = inst(wings, Math.max(1, birds.length), mat(true));
  bodies.count = wingM.count = birds.length;
  bodies.castShadow = true;
  const go = (b, du, fly) => { // start a hop (fly 0) or a flutter (fly > 0) along the cap
    let u = b.u + du;
    for (let k = 0; k < 4 && !perch(b.side, u); k++) u = b.u + (u - b.u) * 0.5;
    if (!perch(b.side, u)) return;
    b.u0 = b.u; b.u1 = u; b.t = 0; b.T = fly ? 0.5 + Math.abs(u - b.u) * 0.12 : 0.22; b.fly = fly;
    const along = Math.sign(u - b.u) || 1;
    b.yaw = b.side < 2 ? Math.atan2(along, 0) : Math.atan2(0, along);
  };
  L.every((dt, t) => {
    const seen = L.seen();
    birds.forEach((b, k) => {
      const [bx, bz] = cap(b.side, b.u);
      if (!b.T) {
        // a visible brawler right under the wall: flutter off along it (never from a hidden one)
        const near = seen.find(p => Math.hypot(p.pos.x - bx, p.pos.z - bz) < 3.5);
        if (near) go(b, Math.sign((b.side < 2 ? bx - near.pos.x : bz - near.pos.z) || 1) * (4 + R() * 4), 1.2);
        else if ((b.wait -= dt) <= 0) {
          if (R() < 0.15) go(b, (R() - 0.5) * 12, 0.9);
          else if (R() < 0.6) go(b, (R() - 0.5) * 1.4, 0);
          else b.yaw += (R() - 0.5) * 2.5; // look around
          b.wait = 0.8 + R() * 3;
        }
      }
      let y = WALL_H, pitch = 0, flap = 0;
      if (b.T) {
        b.t = Math.min(b.T, b.t + dt);
        const f = b.t / b.T;
        b.u = b.u0 + (b.u1 - b.u0) * f;
        y += Math.sin(f * Math.PI) * (b.fly || 0.12);
        if (b.fly) { flap = 1; pitch = -0.25; }
        if (f >= 1) b.T = 0;
      } else pitch = Math.max(0, Math.sin(t * 2.3 + b.ph)) ** 8 * 0.6; // an odd peck at the moss
      const [x, z] = cap(b.side, b.u, b.w);
      // fluffed up against the rain: a slow shiver of the whole body
      const sh = b.T ? 1 : 1 + Math.max(0, Math.sin(t * 0.7 + b.ph * 2)) ** 20 * 0.12;
      _q.setFromEuler(_e.set(pitch, b.yaw, 0, 'YXZ'));
      _m.compose(_v.set(x, y, z), _q, _s.set(b.s * sh, b.s, b.s * sh));
      bodies.setMatrixAt(k, _m);
      const w = flap ? Math.max(0.2, Math.abs(Math.cos(t * 30 + b.ph))) : 0;
      _m.compose(_v, _q, _s.set(b.s * w, b.s, b.s * (w ? 1 : 0)));
      wingM.setMatrixAt(k, _m);
    });
    bodies.instanceMatrix.needsUpdate = wingM.instanceMatrix.needsUpdate = true;
  });

  /* wet leaves shaken off the trees around the arena, tumbling in the wind and settling on the ground */
  const leafGeo = L.toy([
    { shape: 'tri', args: [0.14, 0.13], color: 0xffffff },
    { shape: 'tri', args: [0.14, 0.13], rot: [0, Math.PI, 0], color: 0xffffff },
  ]);
  const leafColors = [0x5fb83a, 0x8cc63f, 0xe0a42a, 0xd0662a, 0x4a9a36];
  const leaves = Array.from({ length: dens(18) }, () => ({ x: 0, y: -1, z: 0, vx: 0, vz: 0, fall: 0, ph: R() * 6.3, rest: 0, s: 0.9 + R() * 0.5 }));
  const leafM = inst(leafGeo, leaves.length, new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide }));
  leaves.forEach((p, k) => leafM.setColorAt(k, new THREE.Color(leafColors[k % leafColors.length])));
  const wind = [0.35, 0.2];
  const spawn = (p, first) => { // from a crown in the tree ring, drifting a few metres into the arena
    const side = Math.floor(R() * 4), u = (R() - 0.5) * 2 * (HALF + 1), d = HALF + 1 + R() * 2.5;
    const [ox, oz] = [[0, -1], [0, 1], [-1, 0], [1, 0]][side];
    p.x = ox ? ox * d : u; p.z = oz ? oz * d : u;
    p.y = first ? 0.5 + R() * 4 : 3.8 + R() * 1.5;
    const inward = 0.4 + R() * 0.6;
    p.vx = -ox * inward + wind[0]; p.vz = -oz * inward + wind[1];
    p.fall = 0.45 + R() * 0.35; p.rest = 0;
  };
  leaves.forEach(p => spawn(p, true));
  const solid = ch => ch !== '.' && ch !== 'B' && ch !== 'W';
  L.every((dt, t) => {
    leaves.forEach((p, k) => {
      let s = p.s, flat = false;
      if (p.rest > 0) { // settled: lie there, then shrink away
        p.rest -= dt;
        if (p.water) { p.x += wind[0] * 0.15 * dt; p.z += wind[1] * 0.15 * dt; }
        s *= Math.min(1, p.rest / 0.6);
        flat = true;
        if (p.rest <= 0) spawn(p);
      } else {
        const sway = Math.sin(t * 2.2 + p.ph);
        p.x += (p.vx + Math.cos(p.ph) * sway * 0.6) * dt; p.z += (p.vz + Math.sin(p.ph) * sway * 0.6) * dt;
        p.y -= p.fall * (0.7 + 0.3 * Math.abs(sway)) * dt;
        const inside = Math.abs(p.x) < HALF && Math.abs(p.z) < HALF, ch = inside ? A.charAt(p.x, p.z) : '.';
        if (inside && solid(ch) && p.y < WALL_H + 0.1) { p.rest = 0.3; p.water = false; } // hit a wall: fade out
        else if (p.y <= (ch === 'W' ? -0.13 : 0.02)) {
          p.water = ch === 'W';
          p.y = p.water ? -0.13 : 0.02;
          p.rest = 2 + R() * 3;
          if (p.water) A.water?.ripple?.(p.x, p.z, 0.15); // a leaf landing on a pond
        }
      }
      _q.setFromEuler(flat ? _e.set(0, p.ph, 0) : _e.set(Math.sin(t * 3 + p.ph) * 1.1, t * 1.5 + p.ph, Math.cos(t * 2.4 + p.ph) * 0.9, 'YXZ'));
      _m.compose(_v.set(p.x, p.y, p.z), _q, _s.setScalar(Math.max(0, s)));
      leafM.setMatrixAt(k, _m);
    });
    leafM.instanceMatrix.needsUpdate = true;
  });
}
