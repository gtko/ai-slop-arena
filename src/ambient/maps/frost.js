// Frost Peak: penguins waddling and belly-sliding on the ice, snow hares, an arctic fox, ravens
// circling high and glints of frost in the air.
const INK = 0x1e2638, SNOW = 0xf8fbff, P2 = Math.PI / 2;

// recolour the vertices of a toy model: fn(x, y, z, colour) -> hex or null (patches, tips, bellies
// without extra primitives, which keeps the vertex count down)
function paint(THREE, g, fn) {
  const P = g.attributes.position, C = g.attributes.color, c = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    const h = fn(P.getX(i), P.getY(i), P.getZ(i), c.fromArray(C.array, i * 3).getHex());
    if (h != null) c.set(h).toArray(C.array, i * 3);
  }
  C.needsUpdate = true;
  return g;
}

export default function frost(L) {
  const { THREE } = L, P = Math.PI, ink = new THREE.Color(INK).getHex();

  // penguin, 0.55 m: dark back readable on snow, white belly, yellow cheeks
  const penguin = paint(THREE, L.toy([
    { shape: 'sphere', args: [0.2, 1, 1.35, 0.95], pos: [0, 0.29, 0], color: INK },
    { shape: 'cone', args: [0.045, 0.12, 4], pos: [0, 0.44, 0.2], rot: [P / 2, 0, 0], color: 0xff8a1e },
    { shape: 'box', args: [0.05, 0.05, 0.03], pos: [0.075, 0.48, 0.13], color: 0xffffff },
    { shape: 'box', args: [0.05, 0.05, 0.03], pos: [-0.075, 0.48, 0.13], color: 0xffffff },
    { shape: 'box', args: [0.04, 0.22, 0.1], pos: [0.2, 0.3, 0], rot: [0, 0, 0.35], color: INK },
    { shape: 'box', args: [0.04, 0.22, 0.1], pos: [-0.2, 0.3, 0], rot: [0, 0, -0.35], color: INK },
    { shape: 'box', args: [0.08, 0.03, 0.12], pos: [0.07, 0.015, 0.1], color: 0xff8a1e },
    { shape: 'box', args: [0.08, 0.03, 0.12], pos: [-0.07, 0.015, 0.1], color: 0xff8a1e },
  ]), (x, y, z, c) => c !== ink || Math.abs(x) > 0.19 ? null // body sphere only (not the flippers)
    : z > 0.02 && y > 0.415 && y < 0.45 && Math.abs(x) > 0.15 ? 0xffc21f : z > 0.05 && y < 0.44 && Math.abs(x) < 0.15 ? SNOW : null);
  penguins(L, penguin, Math.max(1, Math.round(6 * L.density)));

  // snow hare, 0.4 m: white, black ear tips and eyes so it still reads against the snow
  const earTip = s => ({ shape: 'box', args: [0.054, 0.06, 0.028], pos: [0.056 * s, 0.473, 0.053], rot: [-0.35, 0, -0.2 * s], color: INK });
  const ear = s => ({ shape: 'box', args: [0.05, 0.2, 0.025], pos: [0.04 * s, 0.4, 0.08], rot: [-0.35, 0, -0.2 * s], color: 0xfbe6ee });
  const hare = L.toy([
    { shape: 'sphere', args: [0.14, 1, 0.9, 1.3], pos: [0, 0.14, -0.02], color: SNOW },
    { shape: 'cyl', args: [0.085, 0.1, 0.16, 8], pos: [0, 0.25, 0.14], rot: [P / 2, 0, 0], color: SNOW },
    { shape: 'box', args: [0.2, 0.035, 0.035], pos: [0, 0.28, 0.17], color: INK },
    { shape: 'box', args: [0.035, 0.03, 0.02], pos: [0, 0.25, 0.225], color: 0xff7fa8 },
    ear(1), ear(-1), earTip(1), earTip(-1),
    { shape: 'box', args: [0.07, 0.07, 0.06], pos: [0, 0.16, -0.2], color: SNOW },
  ]);
  L.walkers({ geometry: hare, count: 6, speed: 1.3, gait: 'hop', pause: [1, 4], range: 3, shy: 3.2, scale: [0.9, 1.15] });

  // arctic fox, 0.7 m nose to tail: rare and roaming wide, dark nose, ear and tail tips
  const fox = paint(THREE, L.toy([
    { shape: 'sphere', args: [0.14, 1, 0.85, 1.9], pos: [0, 0.2, 0], color: SNOW },
    { shape: 'box', args: [0.2, 0.12, 0.06], pos: [0, 0.06, 0.14], color: 0xdfe6f0 },
    { shape: 'box', args: [0.2, 0.12, 0.06], pos: [0, 0.06, -0.14], color: 0xdfe6f0 },
    { shape: 'box', args: [0.16, 0.14, 0.14], pos: [0, 0.34, 0.26], color: SNOW },
    { shape: 'cone', args: [0.06, 0.14, 6], pos: [0, 0.31, 0.39], rot: [P / 2, 0, 0], color: SNOW },
    { shape: 'box', args: [0.04, 0.035, 0.03], pos: [0, 0.31, 0.46], color: INK },
    { shape: 'box', args: [0.18, 0.03, 0.03], pos: [0, 0.37, 0.33], color: INK },
    { shape: 'cone', args: [0.045, 0.1, 4], pos: [0.055, 0.45, 0.24], color: SNOW },
    { shape: 'cone', args: [0.045, 0.1, 4], pos: [-0.055, 0.45, 0.24], color: SNOW },
    { shape: 'cone', args: [0.08, 0.3, 6], pos: [0, 0.26, -0.38], rot: [-1.15, 0, 0], color: SNOW },
  ]), (x, y, z) => y > 0.48 || z < -0.46 ? 0x2a3040 : null);
  L.walkers({ geometry: fox, count: 2, speed: 1, gait: 'scuttle', pause: [2, 6], range: 5, shy: 4, scale: [0.95, 1.05] });

  // ravens circling high over the peak
  const raven = L.toy([
    { shape: 'sphere', args: [0.1, 1, 0.8, 2.2], color: 0x1b1d2a },
    { shape: 'cone', args: [0.03, 0.1, 4], pos: [0, 0.01, 0.26], rot: [P / 2, 0, 0], color: 0x4a5064 },
    { shape: 'tri', args: [0.16, 0.2], pos: [0, 0, -0.36], rot: [0, -P / 2, 0], color: 0x1b1d2a },
  ]);
  const wing = L.toy([{ shape: 'tri', args: [0.55, 0.22], color: 0x262a3e }]);
  L.flock({ body: raven, wing, count: 5, flocks: 2, radius: [12, 22], height: [8, 11], speed: 0.18, flap: 1.4, glide: 0.7, spread: 2, scale: [1.2, 1.5] });

  // frost glints: tiny pale diamonds twinkling in the air, carried by the wind
  const glint = L.toy([
    { shape: 'cone', args: [0.05, 0.09, 4], pos: [0, 0.045, 0] },
    { shape: 'cone', args: [0.05, 0.09, 4], pos: [0, -0.045, 0], rot: [P, 0, 0] },
  ]);
  const air = ch => ch === '.' || ch === 'I';
  L.swarm({ geometry: glint, count: 22, at: L.spots(air, 10), radius: 3, height: [1.2, 3.5], speed: 0.15, flutter: 0, spin: 1.5,
    colors: [0xffffff, 0xcff4ff, 0xaee8ff, 0xfff6c8], glow: 0.9, pulse: 2.5, drift: [0.25, 0.1], scale: [0.7, 1.2] });
}

// Penguins: live on the ice and around it, waddle about, and on the ice flop on their belly and slide
// until the ice ends. A visible brawler close by sends them sliding (or waddling) away.
function penguins(L, geo, n) {
  const { THREE, arena: A } = L, R = L.rand;
  const ICE = ch => ch === 'I', OK = ch => ch === 'I' || ch === '.';
  let homes = L.spots(ICE, n);
  if (!homes.length) homes = L.spots(OK, n);
  const list = homes.map(p => ({ home: p.clone(), pos: p.clone(), to: p.clone(), vx: 0, vz: 0, yaw: R() * 6.3, wait: R() * 3, ph: R() * 6.3, s: 0.9 + R() * 0.25, mode: 0, lie: 0, flee: 0 }));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  L.group.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const iceAt = (x, z) => ICE(A.charAt(x, z)), okAt = (x, z) => OK(A.charAt(x, z));
  const rest = p => { p.mode = 0; p.vx = p.vz = 0; p.wait = 1.5 + R() * 3.5; };
  const slide = (p, dx, dz, speed) => { // only if there is ice ahead to slide on
    if (!iceAt(p.pos.x + dx * 1.5, p.pos.z + dz * 1.5)) return false;
    p.mode = 2; p.vx = dx * speed; p.vz = dz * speed; p.yaw = Math.atan2(dx, dz);
    return true;
  };
  const pick = p => {
    for (let k = 0; k < 8; k++) {
      const x = p.home.x + (R() - 0.5) * 12, z = p.home.z + (R() - 0.5) * 12;
      if (okAt(x, z)) { p.to.set(x, 0, z); return; }
    }
    p.to.copy(p.home);
  };
  L.every((dt, t) => {
    const seen = L.seen();
    list.forEach((p, k) => {
      p.flee -= dt;
      for (const b of seen) {
        const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
        if (d < 3 && p.flee <= 0 && p.mode !== 2) {
          p.flee = 1.5;
          if (!(iceAt(p.pos.x, p.pos.z) && slide(p, dx / d, dz / d, 4.2))) { p.to.set(p.pos.x + dx / d * 3, 0, p.pos.z + dz / d * 3); p.mode = 1; }
        }
      }
      if (p.mode === 0 && (p.wait -= dt) <= 0) {
        let slid = false;
        if (iceAt(p.pos.x, p.pos.z) && R() < 0.6) for (let a = 0; a < 4 && !slid; a++) { const r = R() * 6.3; slid = slide(p, Math.sin(r), Math.cos(r), 2.4 + R() * 1.4); }
        if (!slid) { pick(p); p.mode = 1; }
      }
      if (p.mode === 1) { // waddle to the target
        const dx = p.to.x - p.pos.x, dz = p.to.z - p.pos.z, d = Math.hypot(dx, dz), st = Math.min(d, (p.flee > 0 ? 1.2 : 0.55) * dt);
        if (d < 0.05) rest(p);
        else {
          const nx = p.pos.x + dx / d * st, nz = p.pos.z + dz / d * st;
          if (okAt(nx, nz)) { p.pos.x = nx; p.pos.z = nz; } else rest(p);
          const want = Math.atan2(dx, dz);
          p.yaw += Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)) * Math.min(1, dt * 8);
        }
      } else if (p.mode === 2) { // belly slide: friction, stops where the ice ends
        const sp = Math.hypot(p.vx, p.vz), nx = p.pos.x + p.vx * dt, nz = p.pos.z + p.vz * dt;
        if (sp < 0.3 || !iceAt(nx, nz)) rest(p);
        else { p.pos.x = nx; p.pos.z = nz; const f = Math.max(0, sp - 0.6 * dt) / sp; p.vx *= f; p.vz *= f; }
      }
      // pose: stand up / flop down, with a little hop between the two
      p.lie += ((p.mode === 2 ? 1 : 0) - p.lie) * Math.min(1, dt * 7);
      const ph = t * 9 + p.ph, walking = p.mode === 1;
      const roll = walking ? Math.sin(ph) * 0.2 : p.mode === 2 ? Math.sin(t * 3 + p.ph) * 0.06 : 0;
      const pitch = p.lie * P2 + (p.mode === 0 ? Math.sin(t * 1.3 + p.ph) * 0.04 : 0);
      const y = (p.lie * 0.2 + Math.sin(p.lie * Math.PI) * 0.15) * p.s;
      q.setFromEuler(e.set(pitch, p.yaw, roll, 'YXZ'));
      m.compose(v.set(p.pos.x, y, p.pos.z), q, sc.setScalar(okAt(p.pos.x, p.pos.z) ? p.s : 0));
      mesh.setMatrixAt(k, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
}
