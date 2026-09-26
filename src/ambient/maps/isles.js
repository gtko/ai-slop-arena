// Windmill Isles: butterflies over the meadows, bees around the healing mushrooms, sparrows hopping in
// the grass, hens and a cat by the windmill, squirrels by the trees, dandelion seeds on the wind (the
// gulls, clouds and far islets under the islands are drawn by kit.js). The islands fall away during
// the match: the sparrows and the swarms leave a shaking island, the ground walkers only live on tiles
// that never fall ('.' next to the windmill) or vanish with their island (the squirrels).
export default function isles(L) {
  const { THREE, arena: A, rand: R } = L, PI = Math.PI;
  const open = ch => ch === '.' || ch === 'B';
  const grass = ch => ch === '.'; // never 'V' (the void) or '=' (bridges fall too)
  const count = k => Math.max(1, Math.round(k * L.density));
  const doomed = (x, z) => !!L.game.kit?.doomedAt?.(x, z); // shaking, about to fall (5 s telegraph)
  const tileAt = (x, z) => A.get(A.toTile(x), A.toTile(z));
  const wing = (w, l, x, y, z, a, color) => ({ shape: 'tri', args: [w, l], pos: [x, y, z], rot: [0, a, 0], color });

  // butterflies: a slim body and four wings (fore and hind), white wings tinted per instance
  const butterfly = L.toy([
    { shape: 'cyl', args: [0.02, 0.012, 0.2, 5], rot: [PI / 2, 0, 0], color: 0x3a2a44 },
    wing(0.24, 0.16, 0.01, 0, 0.03, -0.35, 0xffffff), wing(0.24, 0.16, -0.01, 0, 0.03, PI + 0.35, 0xffffff),
    wing(0.17, 0.13, 0.01, 0, -0.05, 0.55, 0xd2d2d2), wing(0.17, 0.13, -0.01, 0, -0.05, PI - 0.55, 0xd2d2d2),
  ]);
  const flies = L.swarm({ geometry: butterfly, count: 14, at: L.spots(open, 6), radius: 2.2, height: [0.6, 1.8], speed: 0.5, scale: [1, 1.25], colors: [0xffd84a, 0xffffff, 0xff9ad0, 0x9ad8ff, 0xff9a3c] });
  if (flies?.mesh) flies.mesh.material.vertexColors = true; // keeps the dark body under the tint

  const seed = L.toy([
    { shape: 'sphere', args: [0.07], color: 0xffffff },
    { shape: 'cyl', args: [0.01, 0.01, 0.16, 4], pos: [0, -0.1, 0], color: 0xe8e0c8 },
  ]);
  L.swarm({ geometry: seed, count: 24, at: L.spots(open, 10), radius: 1.2, height: [1.2, 3.5], speed: 0.25, flutter: 0, drift: [0.7, 0.25], scale: [0.8, 1.3] });

  // bees buzzing round the healing mushrooms (cap top ~1 m): striped body, rigid wings (a flutter
  // would squash the whole body)
  const shrooms = [];
  for (let j = 0; j < 25; j++) for (let i = 0; i < 25; i++) if (A.get(i, j) === 'H') shrooms.push(A.center(i, j, new THREE.Vector3()));
  const bee = L.toy([
    { shape: 'sphere', args: [0.07, 1, 0.95, 1.4], color: 0xffc21a },
    { shape: 'cyl', args: [0.072, 0.072, 0.028, 8], rot: [PI / 2, 0, 0], pos: [0, 0, -0.005], color: 0x2a2020 },
    { shape: 'cyl', args: [0.058, 0.058, 0.024, 8], rot: [PI / 2, 0, 0], pos: [0, 0, -0.058], color: 0x2a2020 },
    { shape: 'box', args: [0.075, 0.07, 0.05], pos: [0, 0, 0.1], color: 0x2a2020 },
    wing(0.12, 0.08, 0.02, 0.06, 0.01, -0.3, 0xf2fbff), wing(0.12, 0.08, -0.02, 0.06, 0.01, PI + 0.3, 0xf2fbff),
  ]);
  const bees = shrooms.length ? L.swarm({ geometry: bee, count: 10, at: shrooms, radius: 0.9, height: [0.85, 1.35], speed: 1.1, flutter: 0, scale: [1.2, 1.5] }) : null;

  // hens and a cat round the windmill (the 3 x 3 'M' in the middle): the ring of tiles within 3.6 of
  // its centre tile never falls (kit.js keeps a ring 2 tiles wide), so they never stand on the void
  const byMill = (ch, i, j) => ch === '.' && Math.hypot(i - 12, j - 12) <= 3.6;
  const hen = L.toy([
    { shape: 'sphere', args: [0.2, 0.95, 0.85, 1.15], pos: [0, 0.27, 0], color: 0xfaf6ee },
    { shape: 'sphere', args: [0.11], pos: [0, 0.46, 0.17], color: 0xfaf6ee },
    { shape: 'box', args: [0.035, 0.08, 0.13], pos: [0, 0.58, 0.16], color: 0xe8263a }, // comb
    { shape: 'cone', args: [0.04, 0.09, 4], rot: [PI / 2, 0, 0], pos: [0, 0.45, 0.3], color: 0xffa21a },
    { shape: 'box', args: [0.16, 0.18, 0.08], rot: [0.5, 0, 0], pos: [0, 0.4, -0.2], color: 0xece2d2 }, // tail
    { shape: 'box', args: [0.04, 0.12, 0.04], pos: [0.07, 0.06, 0], color: 0xffa21a },
    { shape: 'box', args: [0.04, 0.12, 0.04], pos: [-0.07, 0.06, 0], color: 0xffa21a },
  ]);
  L.critters({ key: 'hen', toy: hen, count: 4, on: byMill, gait: 'waddle', speed: 0.6, run: 1.8, pause: [1, 3.5], range: 2, shy: 2.5, extra: 0.8, scale: [0.85, 1.05] });
  const cat = L.toy([
    { shape: 'sphere', args: [0.16, 0.9, 0.85, 1.6], pos: [0, 0.24, -0.03], color: 0xf28c28 },
    { shape: 'sphere', args: [0.13], pos: [0, 0.38, 0.27], color: 0xf28c28 },
    { shape: 'cone', args: [0.05, 0.1, 3], pos: [0.07, 0.5, 0.26], color: 0xd9701a },
    { shape: 'cone', args: [0.05, 0.1, 3], pos: [-0.07, 0.5, 0.26], color: 0xd9701a },
    { shape: 'box', args: [0.1, 0.07, 0.06], pos: [0, 0.34, 0.39], color: 0xfff4e4 }, // muzzle
    { shape: 'cyl', args: [0.035, 0.03, 0.42, 5], rot: [-0.7, 0, 0], pos: [0, 0.4, -0.36], color: 0xd9701a }, // tail up
    { shape: 'box', args: [0.07, 0.14, 0.07], pos: [0.08, 0.07, 0.15], color: 0xfff4e4 },
    { shape: 'box', args: [0.07, 0.14, 0.07], pos: [-0.08, 0.07, 0.15], color: 0xfff4e4 },
    { shape: 'box', args: [0.07, 0.14, 0.07], pos: [0.08, 0.07, -0.2], color: 0xf28c28 },
    { shape: 'box', args: [0.07, 0.14, 0.07], pos: [-0.08, 0.07, -0.2], color: 0xf28c28 },
  ]);
  L.critters({ key: 'cat', toy: cat, count: 1, on: byMill, speed: 0.55, run: 2.6, pause: [5, 12], range: 3, shy: 3, scale: [0.85, 0.85], rigScale: 1.3 });

  // squirrels on the grass next to the round trees: they vanish with their island (walkers hide a
  // critter whose tile is gone)
  const byTree = (ch, i, j) => ch === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => A.get(i + a, j + b) === 'B');
  const squirrel = L.toy([
    { shape: 'sphere', args: [0.09, 0.9, 1, 1.3], pos: [0, 0.13, 0], color: 0xc0602a },
    { shape: 'sphere', args: [0.1, 0.8, 1.5, 0.9], rot: [0.4, 0, 0], pos: [0, 0.26, -0.16], color: 0xe07a3a }, // bushy tail
    { shape: 'cone', args: [0.07, 0.15, 6], rot: [PI / 2, 0, 0], pos: [0, 0.18, 0.15], color: 0xc0602a },
    { shape: 'cone', args: [0.025, 0.07, 3], pos: [0.035, 0.26, 0.12], color: 0x8a3e18 },
    { shape: 'cone', args: [0.025, 0.07, 3], pos: [-0.035, 0.26, 0.12], color: 0x8a3e18 },
  ]);
  L.critters({ key: 'squirrel', toy: squirrel, count: 3, on: byTree, gait: 'hop', speed: 1.8, run: 3, pause: [0.6, 2.5], range: 1.5, shy: 3.5, scale: [1.1, 1.3] });

  /* sparrows: hop and peck in the grass, flit about, fly off from a visible brawler or a shaking
     island to another one, or away off the map (and back later onto what is left) */
  const V3 = THREE.Vector3, _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _r = new THREE.Matrix4(), _f = new THREE.Matrix4();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new V3(), _s = new V3(), _c = new V3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const sparrow = L.toy([
    { shape: 'sphere', args: [0.1, 1, 0.85, 1.35], pos: [0, 0.12, 0], color: 0x9a6438 },
    { shape: 'sphere', args: [0.075, 1, 0.95, 1], pos: [0, 0.2, 0.12], color: 0x7a7a84 }, // grey crown
    { shape: 'cone', args: [0.028, 0.07, 4], rot: [PI / 2, 0, 0], pos: [0, 0.19, 0.21], color: 0xf2b233 },
    { shape: 'box', args: [0.07, 0.02, 0.14], rot: [0.35, 0, 0], pos: [0, 0.15, -0.17], color: 0x5c3a1e }, // tail
    { shape: 'box', args: [0.13, 0.03, 0.13], pos: [0, 0.19, -0.02], color: 0x6b4222 }, // folded wings on the back
  ]);
  const sparrowWing = L.toy([{ shape: 'tri', args: [0.2, 0.13], pos: [0.02, 0, 0], color: 0x7a4c28 }]);
  const mat = side => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side });
  const ns = count(12), body = new THREE.InstancedMesh(sparrow, mat(THREE.FrontSide), ns);
  const wr = new THREE.InstancedMesh(sparrowWing, mat(THREE.DoubleSide), ns), wl = new THREE.InstancedMesh(sparrowWing, mat(THREE.DoubleSide), ns);
  for (const M of [body, wr, wl]) { M.frustumCulled = false; L.group.add(M); }
  body.castShadow = true;
  const landOk = (x, z) => grass(tileAt(x, z)) && !doomed(x, z);
  const land = from => { // somewhere 4 to 14 m away on grass that stays, else anywhere, else null
    const all = [], near = [];
    for (let j = 0; j < 25; j++) for (let i = 0; i < 25; i++) {
      if (!grass(A.get(i, j))) continue;
      const c = A.center(i, j, new V3()).add(_v.set((R() - 0.5) * 1.4, 0, (R() - 0.5) * 1.4));
      if (doomed(c.x, c.z)) continue;
      all.push(c);
      const d = from ? Math.hypot(c.x - from.x, c.z - from.z) : 0;
      if (d > 4 && d < 14) near.push(c);
    }
    const pool = near.length ? near : all;
    return pool.length ? pool[Math.floor(R() * pool.length)] : null;
  };
  const fly = (b, to, h) => {
    b.from.copy(b.p); b.to.copy(to);
    const d = Math.hypot(to.x - b.p.x, to.z - b.p.z);
    b.u = 0; b.dur = Math.max(0.9, d / 6); b.h = h ?? 1.2 + d * 0.12; b.st = 'fly'; b.hu = -1; b.peck = 0;
  };
  const takeOff = b => {
    const to = land(b.p);
    if (to) return fly(b, to);
    const a = Math.atan2(b.p.z, b.p.x) + (R() - 0.5); // nowhere left: off the map, out and up
    fly(b, _v.set(Math.cos(a) * 45, 8, Math.sin(a) * 45), 2);
    b.leaving = true;
  };
  // the rigged sparrow (fauna.js) replaces the toy body and wings once loaded: Idle, Hop, Peck, Fly
  const SP = L.rig('sparrow', ns);
  const birds = L.spots(grass, ns).map(p => ({ p: p.setY(0), from: new V3(), to: new V3(), hop: new V3(), st: 'ground', wait: R() * 3, hu: -1, peck: 0, yaw: R() * 6.3, ph: R() * 6.3, s: 1.2 + R() * 0.25, u: 0, dur: 1, h: 1, leaving: false }));
  body.count = wr.count = wl.count = birds.length;

  // the swarms leave a shaking or fallen island for ground that stays (the bees for another mushroom),
  // or fade away when there is none
  const homes = [[flies, open], [bees, ch => ch === 'H']].filter(([S]) => S?.list);
  let clock = 0;

  L.every((dt, t) => {
    if ((clock -= dt) <= 0) {
      clock = 0.5;
      for (const [S, ok] of homes) for (const p of S.list) {
        if (p.goal || p.lost || (ok(tileAt(p.a.x, p.a.z)) && !doomed(p.a.x, p.a.z))) continue;
        const to = L.spots((ch, i, j) => ok(ch) && !doomed(A.center(i, j, _c).x, _c.z), 1)[0];
        if (to) p.goal = to; else p.lost = true;
      }
    }
    for (const [S] of homes) {
      let dirty = false;
      S.list.forEach((p, k) => {
        if (p.goal) { // drift over to the new home
          const dx = p.goal.x - p.a.x, dz = p.goal.z - p.a.z, d = Math.hypot(dx, dz), v = 1.8 * dt;
          if (d <= v) { p.a.copy(p.goal); p.goal = null; } else { p.a.x += dx / d * v; p.a.z += dz / d * v; }
        }
        if (p.lost) {
          p.fade = Math.max(0, (p.fade ?? 1) - dt * 0.7);
          S.mesh.getMatrixAt(k, _m);
          S.mesh.setMatrixAt(k, _m.multiply(_f.makeScale(p.fade, p.fade, p.fade)));
          dirty = true;
        }
      });
      if (dirty) S.mesh.instanceMatrix.needsUpdate = true;
    }

    const seen = L.seen(); // hide and seek: only brawlers the player can see scare them
    birds.forEach((b, k) => {
      let y = 0, pitch = 0, flap = null;
      if (b.st === 'ground') {
        const scared = seen.some(o => Math.hypot(o.pos.x - b.p.x, o.pos.z - b.p.z) < 3.5);
        if (scared || !landOk(b.p.x, b.p.z)) takeOff(b);
        else if (b.hu >= 0) { // a little hop
          b.hu = Math.min(1, b.hu + dt / 0.2);
          b.p.lerpVectors(b.from, b.hop, b.hu);
          y = Math.sin(PI * b.hu) * 0.1;
          if (b.hu >= 1) { b.hu = -1; b.wait = R() < 0.6 ? 0.1 + R() * 0.3 : 0.8 + R() * 2; }
        } else if (b.peck > 0) { b.peck -= dt; pitch = Math.sin((0.45 - b.peck) / 0.45 * PI * 2) ** 2 * 0.6; }
        else if ((b.wait -= dt) <= 0) {
          const r = R();
          if (r < 0.08) takeOff(b); // a flit to another patch
          else if (r < 0.65) {
            const a = b.yaw + (R() - 0.5) * 2.2, d = 0.3 + R() * 0.4;
            b.hop.set(b.p.x + Math.sin(a) * d, 0, b.p.z + Math.cos(a) * d);
            if (landOk(b.hop.x, b.hop.z)) { b.from.copy(b.p); b.hu = 0; b.yaw = a; } else b.wait = 0.3;
          } else { b.peck = 0.45; b.wait = 0.3 + R() * 1.2; }
        }
      }
      if (b.st === 'fly') {
        b.u = Math.min(1, b.u + dt / b.dur);
        const e = b.u * b.u * (3 - 2 * b.u);
        b.p.set(b.from.x + (b.to.x - b.from.x) * e, 0, b.from.z + (b.to.z - b.from.z) * e);
        y = b.from.y + (b.to.y - b.from.y) * e + Math.sin(PI * b.u) * b.h;
        const want = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
        b.yaw += Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw)) * Math.min(1, dt * 12);
        pitch = -0.15;
        flap = b.u > 0.75 && !b.leaving ? 0.5 : Math.sin(t * 28 + b.ph) * 0.9; // wings spread to land
        if (b.u >= 1) {
          if (b.leaving) { b.st = 'away'; b.leaving = false; b.wait = 6 + R() * 10; }
          else if (landOk(b.p.x, b.p.z)) { b.st = 'ground'; b.p.y = 0; b.wait = 0.5 + R() * 2; }
          else takeOff(b); // the spot went bad on the way
        }
      } else if (b.st === 'away' && (b.wait -= dt) <= 0) { // back from the sky onto what is left
        const to = land(null);
        if (to) { const a = R() * PI * 2; b.p.set(Math.cos(a) * 40, 7, Math.sin(a) * 40); fly(b, to, 1); } else b.wait = 5;
      }
      if (SP.ready) {
        if (b.st === 'away') { SP.pose(k, 0, 0, 0, 0, 0, 0, 0); return; }
        if (b.st === 'fly') SP.play(k, 'Fly', 1, 0.15);
        else if (b.hu >= 0) { if (b.hu < 0.2 && (SP.done(k) || SP.current(k) !== 'Hop')) SP.play(k, 'Hop', SP.T.clips.Hop ? SP.T.clips.Hop.duration / 0.2 : 1, 0.05, true); }
        else if (b.peck > 0) { if (b.peck > 0.4 && !(SP.current(k) === 'Peck' && !SP.done(k))) SP.play(k, 'Peck', 1, 0.08, true); }
        else if (SP.done(k) || SP.current(k) === 'Fly') SP.play(k, 'Idle', 1, 0.2);
        // the clips carry the pecking and flapping: only the flight's nose-up stays
        SP.pose(k, b.p.x, y, b.p.z, b.yaw, b.st === 'fly' ? pitch : 0, 0, b.s * 1.1);
        return;
      }
      if (b.st === 'away') { body.setMatrixAt(k, ZERO); wr.setMatrixAt(k, ZERO); wl.setMatrixAt(k, ZERO); return; }
      _q.setFromEuler(_e.set(pitch, b.yaw, 0, 'YXZ'));
      _m.compose(_v.set(b.p.x, y, b.p.z), _q, _s.setScalar(b.s));
      body.setMatrixAt(k, _m);
      if (flap === null) { wr.setMatrixAt(k, ZERO); wl.setMatrixAt(k, ZERO); return; } // folded (the dark back)
      _w.makeTranslation(0, 0.18, 0).premultiply(_m);
      wr.setMatrixAt(k, _r.multiplyMatrices(_w, _f.makeRotationZ(flap)));
      _f.makeRotationZ(-flap).multiply(_r.makeScale(-1, 1, 1));
      wl.setMatrixAt(k, _r.multiplyMatrices(_w, _f));
    });
    body.instanceMatrix.needsUpdate = wr.instanceMatrix.needsUpdate = wl.instanceMatrix.needsUpdate = true;
    if (SP.ready) body.visible = wr.visible = wl.visible = false;
  });
}
