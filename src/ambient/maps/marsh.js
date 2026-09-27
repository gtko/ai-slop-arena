// Misty Marsh: blinking fireflies, dragonflies darting over the pools, frogs hopping between the banks
// and lily pads, ducks paddling, bubbles popping on the water. Hide and seek in the fog: nothing here reacts to brawlers.
const N = 25, TILE = 2, WATER_Y = -0.16; // arena.js / water.js (not imported: they need Vite)

export default function marsh(L) {
  const { THREE, arena: A, rand: R } = L;
  const root = new THREE.Group();
  L.group.add(root);
  const n = k => Math.max(1, Math.round(k * L.density));
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _e = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);
  const inst = (geo, mat, k) => {
    const M = new THREE.InstancedMesh(geo, mat, Math.max(1, k));
    M.count = k; M.frustumCulled = false; root.add(M);
    return M;
  };
  const pick = a => a[Math.floor(R() * a.length)];
  const isW = (i, j) => A.get(i, j) === 'W';

  // water tiles, and bank spots: the edge of a floor tile that touches a pool, facing the water
  const water = [], banks = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ch = A.get(i, j);
    if (ch === 'W') water.push([i, j]);
    else if (ch === '.') for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isW(i + di, j + dj)) {
      const c = A.center(i, j, new THREE.Vector3()), side = (R() - 0.5) * TILE * 0.6;
      banks.push({ p: c.add(new THREE.Vector3(di * 0.7 + dj * side, 0, dj * 0.7 + di * side)), yaw: Math.atan2(di, dj) });
    }
  }
  const inWater = () => { const [i, j] = pick(water); return A.center(i, j, new THREE.Vector3()).add(new THREE.Vector3((R() - 0.5) * 1.3, WATER_Y, (R() - 0.5) * 1.3)); };

  /* ---------- fireflies: tiny lamps that blink in and out, drifting low over bushes and pools ---------- */
  // Unlit lamps (no real light, so they never light up a hidden brawler) plus a faint additive halo.
  let flyAt = L.spots(ch => ch === 'B' || ch === 'W', 12);
  if (!flyAt.length) flyAt = L.spots(ch => ch === '.', 8);
  const nf = n(36), flies = Array.from({ length: nf }, () => ({
    a: pick(flyAt).clone(), ph: R() * 6.3, f: 0.5 + R() * 0.6, y: 0.5 + R() * 1.8, r: 0.8 + R() * 1.6,
    per: 2.5 + R() * 3.5, on: 0.3 + R() * 0.25, // blink period (s) and lit share of it
  }));
  const lamp = inst(new THREE.IcosahedronGeometry(0.075, 0), new THREE.MeshBasicMaterial({ color: 0xd9ff5c }), nf);
  const halo = inst(new THREE.IcosahedronGeometry(0.28, 1), new THREE.MeshBasicMaterial({ color: 0xb4ff3c, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }), nf);
  L.every((dt, t) => {
    flies.forEach((p, k) => {
      const tt = t * 0.35 * p.f + p.ph;
      _v.set(p.a.x + Math.sin(tt) * p.r * Math.cos(tt * 0.41), p.y + Math.sin(tt * 1.3) * 0.3, p.a.z + Math.cos(tt * 0.77) * p.r * Math.sin(tt * 0.33 + 1));
      // a soft on/off blink rather than a steady glow, so they never read as a pickup or a shot
      const c = ((t + p.ph * p.per) % p.per) / p.per, b = c < p.on ? Math.sin(c / p.on * Math.PI) : 0;
      _m.compose(_v, _q.identity(), _s.setScalar(0.35 + 0.65 * b));
      lamp.setMatrixAt(k, _m);
      _m.compose(_v, _q, _s.setScalar(b));
      halo.setMatrixAt(k, _m);
    });
    lamp.instanceMatrix.needsUpdate = halo.instanceMatrix.needsUpdate = true;
  });

  /* ---------- dragonflies: hover, then dart to a new point over the water ---------- */
  const dragon = L.toy([
    { shape: 'cyl', args: [0.035, 0.02, 0.5, 6], rot: [Math.PI / 2, 0, 0], pos: [0, 0, -0.08], color: 0x2fc8ff },
    { shape: 'box', args: [0.11, 0.08, 0.1], pos: [0, 0, 0.2], color: 0x1b5f9a },
    { shape: 'tri', args: [0.3, 0.09], pos: [0.02, 0.01, 0.1], color: 0xe4f7ff },
    { shape: 'tri', args: [0.3, 0.09], pos: [-0.02, 0.01, 0.1], rot: [0, Math.PI, 0], color: 0xe4f7ff },
    { shape: 'tri', args: [0.26, 0.08], pos: [0.02, 0.01, 0.0], color: 0xe4f7ff },
    { shape: 'tri', args: [0.26, 0.08], pos: [-0.02, 0.01, 0.0], rot: [0, Math.PI, 0], color: 0xe4f7ff },
  ]);
  const dAt = water.length ? Array.from({ length: 5 }, inWater) : L.spots(ch => ch === '.', 4);
  const nd = n(8), drag = Array.from({ length: nd }, () => {
    const a = pick(dAt) || new THREE.Vector3();
    return { a, pos: new THREE.Vector3(a.x, 1.2, a.z), to: new THREE.Vector3(a.x, 1.2, a.z), yaw: R() * 6.3, wait: R() * 2, dart: 0, ph: R() * 6.3, y: 0.9 + R() * 0.6, s: 0.9 + R() * 0.3 };
  });
  const dMesh = inst(dragon, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide }), nd);
  L.every((dt, t) => {
    drag.forEach((d, k) => {
      if (d.dart > 0) { d.dart -= dt; d.pos.lerp(d.to, Math.min(1, dt * 9)); }
      else if ((d.wait -= dt) <= 0) { // pick a point over the water nearby and zip there
        for (let tries = 0; tries < 6; tries++) {
          const x = d.a.x + (R() - 0.5) * 5, z = d.a.z + (R() - 0.5) * 5;
          d.to.set(x, d.y + (R() - 0.5) * 0.3, z);
          if (!water.length || A.charAt(x, z) === 'W') break;
        }
        d.yaw = Math.atan2(d.to.x - d.pos.x, d.to.z - d.pos.z);
        d.dart = 0.5; d.wait = 0.8 + R() * 2.2;
      }
      const hov = d.dart > 0 ? 0 : 1;
      _v.set(d.pos.x + Math.sin(t * 3 + d.ph) * 0.04 * hov, d.pos.y + Math.sin(t * 2.3 + d.ph) * 0.06, d.pos.z + Math.cos(t * 2.7 + d.ph) * 0.04 * hov);
      _q.setFromEuler(_e.set(0, d.yaw + Math.sin(t * 1.7 + d.ph) * 0.15 * hov, 0));
      _m.compose(_v, _q, _s.set(d.s * (0.35 + 0.65 * Math.abs(Math.cos(t * 45 + d.ph))), d.s, d.s)); // wing blur
      dMesh.setMatrixAt(k, _m);
    });
    dMesh.instanceMatrix.needsUpdate = true;
  });

  /* ---------- lily pads (a few with a flower) and frogs hopping between them and the banks ---------- */
  const padGeo = new THREE.CylinderGeometry(1, 1, 0.04, 14, 1, false, 0.35, Math.PI * 2 - 0.7); // notched disc
  const flower = L.toy([
    { shape: 'cone', args: [0.13, 0.1, 6], pos: [0, 0.05, 0], color: 0xff8fc8 },
    { shape: 'sphere', args: [0.045], pos: [0, 0.1, 0], color: 0xffe14a },
  ]);
  const padSpots = water.filter(([i, j]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !isW(i + a, j + b))); // near the banks
  const np = water.length ? n(14) : 0;
  const pads = Array.from({ length: np }, () => {
    const [i, j] = pick(padSpots.length ? padSpots : water), p = A.center(i, j, new THREE.Vector3()).add(new THREE.Vector3((R() - 0.5) * 1.2, 0, (R() - 0.5) * 1.2));
    return { p, r: 0.3 + R() * 0.18, yaw: R() * 6.3, ph: R() * 6.3, y: WATER_Y + 0.02, flower: R() < 0.3 };
  });
  const padMesh = inst(padGeo, new THREE.MeshStandardMaterial({ color: 0x4f9d38, roughness: 0.7 }), np);
  const fl = pads.filter(p => p.flower), flMesh = inst(flower, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), fl.length);

  const frogGeo = L.toy([
    { shape: 'sphere', args: [0.16, 1.1, 0.72, 1.25], pos: [0, 0.12, 0], color: 0x5fcf3a },
    { shape: 'box', args: [0.2, 0.05, 0.14], pos: [0, 0.05, 0.12], color: 0xe6f08a }, // chin / belly
    { shape: 'cyl', args: [0.055, 0.06, 0.09, 6], pos: [0.085, 0.22, 0.09], color: 0xf6f6d8 },
    { shape: 'cyl', args: [0.055, 0.06, 0.09, 6], pos: [-0.085, 0.22, 0.09], color: 0xf6f6d8 },
    { shape: 'box', args: [0.05, 0.02, 0.05], pos: [0.09, 0.27, 0.11], color: 0x111111 },
    { shape: 'box', args: [0.05, 0.02, 0.05], pos: [-0.09, 0.27, 0.11], color: 0x111111 },
    { shape: 'box', args: [0.09, 0.08, 0.22], pos: [0.15, 0.05, -0.05], rot: [0, 0.3, 0], color: 0x3f9a2a },
    { shape: 'box', args: [0.09, 0.08, 0.22], pos: [-0.15, 0.05, -0.05], rot: [0, -0.3, 0], color: 0x3f9a2a },
  ]);
  const padTop = (P, t) => P.y + Math.sin(t * 0.9 + P.ph) * 0.012;
  const nfr = banks.length ? n(6) : 0;
  const frogs = Array.from({ length: nfr }, () => {
    const b = pick(banks), home = { p: b.p, pad: null, yaw: b.yaw };
    // perches: its bank spot, a second spot along the same shore, and the pads within reach
    const near = banks.filter(o => o !== b && o.p.distanceTo(b.p) < 3.5), perches = [home];
    if (near.length) { const o = pick(near); perches.push({ p: o.p, pad: null, yaw: o.yaw }); }
    for (const P of pads) if (P.p.distanceTo(b.p) < 3.2) perches.push({ p: P.p, pad: P, yaw: null });
    return { perches, at: home, from: new THREE.Vector3().copy(b.p), to: new THREE.Vector3(), pos: b.p.clone(), yaw: b.yaw, st: 'sit', tm: R() * 4, hop: 0, ph: R() * 6.3, s: 0.85 + R() * 0.35 };
  });
  const frogMesh = inst(frogGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), nfr);
  frogMesh.castShadow = true;
  // the rigged frog (fauna.js) takes over from the toy once loaded: Idle on a perch with a Croak now
  // and then, one Hop cycle per leap
  const FR = L.rig('frog', nfr), HOP_T = 0.45;
  const perchY = (c, t) => (c.pad ? padTop(c.pad, t) + 0.02 : 0);
  const hopTo = (f, dst) => {
    f.from.copy(f.pos); f.to.copy(dst); f.hop = 0; f.st = 'hop';
    f.yaw = Math.atan2(dst.x - f.pos.x, dst.z - f.pos.z);
  };

  L.every((dt, t) => {
    pads.forEach((P, k) => {
      _q.setFromAxisAngle(UP, P.yaw + Math.sin(t * 0.2 + P.ph) * 0.15);
      _m.compose(_v.set(P.p.x, padTop(P, t), P.p.z), _q, _s.set(P.r, 1, P.r));
      padMesh.setMatrixAt(k, _m);
    });
    fl.forEach((P, k) => {
      _m.compose(_v.set(P.p.x + P.r * 0.3, padTop(P, t) + 0.02, P.p.z - P.r * 0.2), _q.setFromAxisAngle(UP, P.ph), _s.setScalar(1));
      flMesh.setMatrixAt(k, _m);
    });
    frogs.forEach((f, k) => {
      let y = 0, sy = 1, sc = f.s, pitch = 0;
      if (f.st === 'sit') {
        if (f.at.pad) f.pos.set(f.at.p.x, 0, f.at.p.z);
        y = perchY(f.at, t);
        sy = 1 + Math.max(0, Math.sin(t * 5 + f.ph)) * 0.05; // throat pumping
        f.croak = (f.croak ?? R() * 6) - dt;
        if ((f.tm -= dt) <= 0) {
          // mostly hop to another perch; now and then plop into the water and come up somewhere else
          let dive = null;
          if (R() < 0.25) for (let tries = 0; tries < 5 && !dive; tries++) {
            const a = tries ? R() * 6.3 : f.yaw; // straight ahead first (a bank frog faces the pool)
            _v.set(f.pos.x + Math.sin(a) * 1.1, 0, f.pos.z + Math.cos(a) * 1.1);
            if (A.charAt(_v.x, _v.z) === 'W') dive = _v.clone();
          }
          const others = f.perches.filter(c => c !== f.at);
          if (dive) { f.next = null; hopTo(f, dive); }
          else if (others.length) { f.next = pick(others); hopTo(f, f.next.p); }
          else f.tm = 2 + R() * 3;
        }
      } else if (f.st === 'hop') {
        f.hop = Math.min(1, f.hop + dt / HOP_T);
        const endY = f.next ? perchY(f.next, t) : WATER_Y;
        f.pos.lerpVectors(f.from, f.to, f.hop);
        const startY = f.at ? perchY(f.at, t) : WATER_Y;
        y = startY + (endY - startY) * f.hop + Math.sin(f.hop * Math.PI) * 0.45;
        pitch = (f.hop - 0.5) * 0.8; sy = 1.1; // nose up on take-off, down on landing
        if (f.hop >= 1) {
          if (f.next) { f.at = f.next; f.st = 'sit'; f.tm = 2.5 + R() * 5; if (f.at.yaw != null) f.yaw = f.at.yaw; }
          else { f.st = 'under'; f.tm = 2 + R() * 3; f.at = null; }
        }
      } else if (f.st === 'under') { // sinks out of sight, then pops up and hops back to a perch
        f.tm -= dt;
        y = WATER_Y - 0.1; sc = f.tm > 0 ? 0 : f.s;
        if (f.tm <= 0) { f.next = pick(f.perches); hopTo(f, f.next.p); }
      }
      if (FR.ready) {
        if (f.st === 'hop') { if (f.hop < 0.1) FR.play(k, 'Hop', FR.T.clips.Hop ? FR.T.clips.Hop.duration / HOP_T : 1, 0.08, true); }
        else if (f.st === 'sit' && f.croak <= 0 && FR.play(k, 'Croak', 1, 0.2, true)) f.croak = 4 + R() * 8;
        else if (FR.done(k) || FR.current(k) === 'Hop') FR.play(k, 'Idle', 1, 0.25);
        FR.pose(k, f.pos.x, y, f.pos.z, f.yaw, pitch * 0.6, 0, sc * 0.8);
        return;
      }
      _q.setFromEuler(_e.set(pitch, f.yaw, 0, 'YXZ'));
      _m.compose(_v.set(f.pos.x, y, f.pos.z), _q, _s.set(sc, sc * sy, sc));
      frogMesh.setMatrixAt(k, _m);
    });
    if (FR.ready) frogMesh.visible = false;
    padMesh.instanceMatrix.needsUpdate = flMesh.instanceMatrix.needsUpdate = frogMesh.instanceMatrix.needsUpdate = true;
  });

  /* ---------- ducks paddling on the pools, now and then up a bank (they ignore brawlers too) ---------- */
  const nearPool = (ch, i, j) => ch === 'W' || (ch === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => isW(i + a, j + b)));
  const duck = L.toy([
    { shape: 'sphere', args: [0.15, 0.95, 0.7, 1.35], pos: [0, 0.16, 0], color: 0x8a6a4a },
    { shape: 'sphere', args: [0.08], pos: [0, 0.3, 0.15], color: 0x2f8a4a },
    { shape: 'box', args: [0.06, 0.025, 0.08], pos: [0, 0.29, 0.25], color: 0xffc21a },
    { shape: 'box', args: [0.09, 0.05, 0.08], rot: [-0.5, 0, 0], pos: [0, 0.22, -0.2], color: 0x5a4430 },
  ]);
  if (water.length) L.critters({ key: 'duck', toy: duck, count: 3, on: nearPool, home: ch => ch === 'W', swim: ch => ch === 'W',
    gait: 'waddle', speed: 0.35, pause: [2, 7], range: 2, shy: 0, scale: [1, 1.15], rigScale: 1.1 });

  /* ---------- bubbles: a dome swells on the murky surface, then pops ---------- */
  const nb = water.length ? n(12) : 0;
  const bubs = Array.from({ length: nb }, () => ({ p: inWater(), c: -R() * 4, grow: 0.8 + R() * 1.2, s: 0.7 + R() * 0.6 }));
  const bMesh = inst(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshStandardMaterial({ color: 0xcfe6b0, roughness: 0.08, transparent: true, opacity: 0.8 }), nb);
  L.every(dt => {
    bubs.forEach((b, k) => {
      b.c += dt;
      let s = 0;
      if (b.c > b.grow + 0.12) { b.c = -(1 + R() * 4); b.p = inWater(); b.grow = 0.8 + R() * 1.2; } // popped: wait, somewhere else
      else if (b.c > b.grow) s = 1.35 * (1 - (b.c - b.grow) / 0.12); // pop
      else if (b.c > 0) s = b.c / b.grow;
      _m.compose(b.p, _q.identity(), _s.set(s * b.s, s * b.s * 0.7, s * b.s));
      bMesh.setMatrixAt(k, _m);
    });
    bMesh.instanceMatrix.needsUpdate = true;
  });
}
