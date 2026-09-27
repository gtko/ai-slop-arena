// Dune Storm: scorpions, ghost crabs and fennecs on the sand, tumbleweeds and dust devils pushed by
// the storm (wind toward +x, as the sand grains in weather.js), a few vultures riding it high up.
export default function dunes(L) {
  const { THREE, arena: A, rand: R } = L;
  const open = ch => ch === '.' || ch === 'B';
  const gust = () => L.game.weather?.gust ?? 0.5;

  // scorpion (~0.55 m): plum shell, tail curled over the back, amber sting
  const scorpion = L.toy([
    { shape: 'sphere', args: [0.12, 0.9, 0.45, 1.4], pos: [0, 0.07, 0.02], color: 0x4a2440 },
    { shape: 'box', args: [0.07, 0.06, 0.09], pos: [0, 0.1, -0.16], rot: [0.5, 0, 0], color: 0x5c2e50 },
    { shape: 'box', args: [0.06, 0.06, 0.08], pos: [0, 0.18, -0.21], rot: [1.3, 0, 0], color: 0x5c2e50 },
    { shape: 'box', args: [0.06, 0.06, 0.08], pos: [0, 0.26, -0.17], rot: [2.2, 0, 0], color: 0x5c2e50 },
    { shape: 'cone', args: [0.035, 0.1, 5], pos: [0, 0.27, -0.09], rot: [1.9, 0, 0], color: 0xffb62e },
    { shape: 'box', args: [0.08, 0.05, 0.18], pos: [0.11, 0.06, 0.25], rot: [0, 0.35, 0], color: 0x6e3660 },
    { shape: 'box', args: [0.08, 0.05, 0.18], pos: [-0.11, 0.06, 0.25], rot: [0, -0.35, 0], color: 0x6e3660 },
    ...[0.08, 0, -0.08].map((z, k) => ({ shape: 'box', args: [0.36, 0.02, 0.025], pos: [0, 0.03, z], rot: [0, (k - 1) * 0.25, 0], color: 0x3a1c32 })),
  ]);
  L.walkers({ geometry: scorpion, count: 6, gait: 'scuttle', speed: 0.7, pause: [2, 6], range: 2, shy: 2.5, scale: [0.9, 1.1] });

  // ghost crab (~0.4 m): walks sideways, so its long axis (and the legs) lie along the travel axis z
  // and it faces +x; cream shell, coral claws, black eye stalks
  const crab = L.toy([
    { shape: 'sphere', args: [0.12, 1, 0.5, 1.35], pos: [0, 0.07, 0], color: 0xf4dfb4 },
    { shape: 'box', args: [0.1, 0.07, 0.07], pos: [0.13, 0.07, 0.1], rot: [0, -0.4, 0], color: 0xff6a4a },
    { shape: 'box', args: [0.1, 0.07, 0.07], pos: [0.13, 0.07, -0.1], rot: [0, 0.4, 0], color: 0xff6a4a },
    { shape: 'box', args: [0.02, 0.08, 0.02], pos: [0.08, 0.14, 0.04], color: 0x222222 },
    { shape: 'box', args: [0.02, 0.08, 0.02], pos: [0.08, 0.14, -0.04], color: 0x222222 },
    ...[0.05, -0.02, -0.08].map(x => ({ shape: 'box', args: [0.025, 0.02, 0.44], pos: [x, 0.03, 0], color: 0xe8c890 })),
  ]);
  L.walkers({ geometry: crab, count: 6, gait: 'scuttle', speed: 1.3, pause: [0.8, 3], range: 3, shy: 3, scale: [0.85, 1.1] });

  // fennec fox (~0.7 m with the tail): cream coat, oversized ears, black tail tip; trots far and rests long
  const fox = L.toy([
    { shape: 'sphere', args: [0.12, 0.85, 0.8, 1.6], pos: [0, 0.24, 0], color: 0xf2c98a },
    { shape: 'box', args: [0.15, 0.13, 0.14], pos: [0, 0.33, 0.2], color: 0xf2c98a },
    { shape: 'cone', args: [0.05, 0.12, 4], pos: [0, 0.3, 0.32], rot: [Math.PI / 2, 0, 0], color: 0xfff0d8 },
    { shape: 'box', args: [0.03, 0.03, 0.03], pos: [0, 0.3, 0.38], color: 0x2a1a14 },
    { shape: 'cone', args: [0.07, 0.2, 4], pos: [0.07, 0.47, 0.18], rot: [0, 0, -0.45], color: 0xf7b88a },
    { shape: 'cone', args: [0.07, 0.2, 4], pos: [-0.07, 0.47, 0.18], rot: [0, 0, 0.45], color: 0xf7b88a },
    ...[[0.05, 0.1], [-0.05, 0.1], [0.05, -0.1], [-0.05, -0.1]].map(([x, z]) => ({ shape: 'box', args: [0.04, 0.18, 0.04], pos: [x, 0.09, z], color: 0xe0b070 })),
    { shape: 'cone', args: [0.06, 0.22, 5], pos: [0, 0.26, -0.28], rot: [-1.9, 0, 0], color: 0xf2c98a },
    { shape: 'cone', args: [0.04, 0.08, 5], pos: [0, 0.3, -0.41], rot: [-1.9, 0, 0], color: 0x2a1a14 },
  ]);
  L.critters({ key: 'fennec', toy: fox, count: 3, gait: 'scuttle', speed: 0.8, run: 3.2, pause: [4, 10], range: 5, shy: 4, scale: [0.95, 1.05], rigScale: 1.2 });

  // vultures leaning into the storm, high above the play area (the toy kites until the model is in)
  const kite = L.toy([
    { shape: 'cone', args: [0.1, 0.5, 5], rot: [Math.PI / 2, 0, 0], color: 0x5a3a26 },
    { shape: 'box', args: [0.1, 0.09, 0.1], pos: [0, 0.02, 0.27], color: 0x8a6446 },
    { shape: 'cone', args: [0.03, 0.08, 4], pos: [0, 0.01, 0.35], rot: [Math.PI / 2, 0, 0], color: 0xffc23a },
    { shape: 'tri', args: [0.22, 0.28], pos: [0, 0, -0.3], rot: [0, Math.PI / 2, 0], color: 0x3e2618 },
    { shape: 'tri', args: [0.22, 0.28], pos: [0, 0, -0.3], rot: [0, Math.PI / 2, Math.PI], color: 0x3e2618 },
  ]);
  const wing = L.toy([
    { shape: 'tri', args: [0.75, 0.32], pos: [0.04, 0, 0], color: 0x5a3a26 },
    { shape: 'tri', args: [0.3, 0.14], pos: [0.5, 0.005, -0.02], color: 0x2a1a12 },
  ]);
  L.flock({ key: 'vulture', body: kite, wing, count: 4, flocks: 2, radius: [8, 18], height: [10, 13], speed: 0.14, flap: 1.2, glide: 0.7, spread: 1.8, scale: [1, 1.2] });

  /* tumbleweeds: rolling and bouncing with the wind across the open sand, steering round walls */
  const weed = L.toy([
    { shape: 'sphere', args: [0.24], color: 0xc08a48 },
    ...[[0, 0, 0.3], [0, 1.1, 0.9], [1.2, 0.4, 0], [0.7, 2.2, 1.6], [2.4, 0.9, 0.5], [1.6, 1.8, 2.5]].map((r, k) => ({ shape: 'box', args: [0.64, 0.035, 0.035], rot: r, color: k % 2 ? 0x8a5a2c : 0xa87038 })),
  ]);
  const nW = Math.max(1, Math.round(5 * L.density));
  const wMesh = new THREE.InstancedMesh(weed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), nW);
  wMesh.castShadow = true; wMesh.frustumCulled = false;
  L.group.add(wMesh);
  const UP = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3();
  const weeds = Array.from({ length: nW }, () => ({ p: new THREE.Vector3(), rot: new THREE.Quaternion(), k: 0, s: 0, vz: 0, h: 0, grow: 0, out: false, stuck: 0 }));
  const place = (w, anywhere) => { // enter from the upwind side (or anywhere at the start of the match)
    const p = L.spots((ch, i) => open(ch) && (anywhere || i <= 3), 1)[0];
    if (p) w.p.set(p.x, 0, p.z);
    Object.assign(w, { k: 0.8 + R() * 0.4, s: 0.8 + R() * 0.4, vz: (R() - 0.5) * 0.6, grow: 0, out: !p, stuck: 0 });
  };
  weeds.forEach(w => place(w, true));
  L.every((dt, t) => {
    const g = gust();
    weeds.forEach((w, n) => {
      if (w.out) { // shrink away (edge of the arena, or wedged), then come back upwind
        if ((w.grow -= dt * 2.5) <= 0) place(w, false);
      } else {
        w.grow = Math.min(1, w.grow + dt * 2);
        const vx = (1.4 + g * 2.4) * w.k * (0.8 + 0.2 * Math.sin(t * 1.7 + n));
        let dx = vx * dt, dz = w.vz * dt;
        if (!open(A.charAt(w.p.x + dx + 0.3, w.p.z + dz))) { // wall, cactus or crate ahead: slide around it
          w.vz = (w.vz >= 0 ? 1 : -1) * 1.6;
          dx = 0; dz = w.vz * dt;
          if (!open(A.charAt(w.p.x, w.p.z + dz + Math.sign(dz) * 0.3))) { w.vz = -w.vz; dz = 0; }
          if ((w.stuck += dt) > 2.5 || A.charAt(w.p.x + 1, w.p.z) === 'X') w.out = true;
        } else { w.stuck = 0; w.vz += (Math.sin(t * 0.4 + n * 2) * 0.4 - w.vz) * Math.min(1, dt * 0.8); }
        w.p.x += dx; w.p.z += dz;
        const d = Math.hypot(dx, dz);
        if (d > 0) w.rot.premultiply(_q.setFromAxisAngle(_a.set(dz / d, 0, -dx / d), d / (0.3 * w.s)));
        w.h += d * 1.4;
      }
      const s = w.s * Math.max(0, w.grow), y = 0.3 * w.s + Math.abs(Math.sin(w.h)) * (0.15 + g * 0.35);
      wMesh.setMatrixAt(n, _m.compose(_v.set(w.p.x, y * Math.max(0, w.grow), w.p.z), w.rot, _s.setScalar(s)));
    });
    wMesh.instanceMatrix.needsUpdate = true;
  });

  /* dust devils: short-lived, low (1.8 m), very translucent sand funnels with a few specks orbiting */
  const funnel = (r1, r2, h, a) => {
    const geo = new THREE.CylinderGeometry(r1, r2, h, 14, 4, true).translate(0, h / 2, 0), pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 4), c = new THREE.Color(0xf2b27c);
    for (let k = 0; k < pos.count; k++) { // fade out at the foot and the top
      const u = pos.getY(k) / h;
      col.set([c.r, c.g, c.b, a * Math.min(1, u * 5) * Math.pow(1 - u, 0.6)], k * 4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    return geo;
  };
  const dMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const nD = Math.max(1, Math.round(3 * L.density)), SP = 8;
  const outer = new THREE.InstancedMesh(funnel(0.9, 0.14, 1.8, 0.28), dMat, nD);
  const inner = new THREE.InstancedMesh(funnel(0.5, 0.08, 1.5, 0.22), dMat, nD);
  const specks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xb8683a }), nD * SP);
  for (const M of [outer, inner, specks]) { M.frustumCulled = false; M.renderOrder = 2; L.group.add(M); }
  const devils = Array.from({ length: nD }, () => ({ p: new THREE.Vector3(), age: 0, T: 0, wait: R() * 4, k: 1, ph: R() * 6.3 }));
  const spawn = w => {
    const p = L.spots(open, 1)[0];
    if (p) w.p.set(p.x, 0, p.z);
    Object.assign(w, { age: 0, T: 6 + R() * 5, k: 0.8 + R() * 0.4, wait: p ? 0 : 3 });
  };
  L.every((dt, t) => {
    const g = gust();
    devils.forEach((w, n) => {
      let e = 0;
      if (w.wait > 0) { if ((w.wait -= dt) <= 0) spawn(w); }
      else {
        w.age += dt;
        w.p.x += (0.6 + g * 1.2) * dt;
        w.p.z += Math.sin(t * 0.7 + w.ph) * 0.7 * dt;
        if (!open(A.charAt(w.p.x, w.p.z))) w.age = Math.max(w.age, w.T - 0.8); // blown into a wall: die down
        e = Math.min(1, w.age / 1.2, Math.max(0, (w.T - w.age) / 0.8));
        if (w.age >= w.T) w.wait = 1 + R() * 5;
      }
      const s = e * w.k;
      _s.set(s, Math.max(e, 0.01), s);
      outer.setMatrixAt(n, _m.compose(w.p, _q.setFromAxisAngle(UP, t * 5 + w.ph), _s));
      inner.setMatrixAt(n, _m.compose(w.p, _q.setFromAxisAngle(UP, -t * 7 - w.ph), _s));
      for (let m = 0; m < SP; m++) {
        const u = (m + 0.5) / SP, y = (0.15 + u * 1.4) * e, a = t * (6 - u * 2) + m * 2.4 + w.ph, r = (0.15 + u * 0.6) * s;
        specks.setMatrixAt(n * SP + m, _m.compose(_v.set(w.p.x + Math.cos(a) * r, y, w.p.z + Math.sin(a) * r), _q.identity(), _a.setScalar(e)));
      }
    });
    outer.instanceMatrix.needsUpdate = inner.instanceMatrix.needsUpdate = specks.instanceMatrix.needsUpdate = true;
  });
}
