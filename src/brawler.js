import * as THREE from 'three';
import { charMat, radialTexture } from './materials.js';

export const TYPES = {
  blaster: {
    key: 'blaster', name: 'Blaster', role: 'Shotgun',
    desc: 'Close-range spread of 5 pellets. Super: a wide blast that knocks enemies back and smashes walls.',
    hp: 4800, speed: 6.0, ammo: 3, reload: 1.7, range: 9.5, superCost: 2600, projSpeed: 25,
    palette: { main: 0x7b4dff, dark: 0x2c2f5a, accent: 0xff4fa3, hair: 0x3a1c7a, skin: 0xffcfa4 },
  },
  gunslinger: {
    key: 'gunslinger', name: 'Gunslinger', role: 'Sharpshooter',
    desc: 'Long-range burst of 6 bullets. Super: a 12-bullet volley that tears straight through walls.',
    hp: 3600, speed: 6.6, ammo: 3, reload: 1.6, range: 16, superCost: 2800, projSpeed: 32,
    palette: { main: 0xe8453c, dark: 0x2d3f73, accent: 0xf5d142, hair: 0x8a5a2e, skin: 0xf4c095 },
  },
  bomber: {
    key: 'bomber', name: 'Bomber', role: 'Thrower',
    desc: 'Lobs bombs over walls that explode in an area. Super: a huge barrel bomb that levels cover.',
    hp: 3400, speed: 6.1, ammo: 3, reload: 1.9, range: 13, superCost: 2400, projSpeed: 18,
    palette: { main: 0xff9a1f, dark: 0x5a4230, accent: 0xffd23f, hair: 0xf2f2f2, skin: 0xffc9a0 },
  },
  frostbite: {
    key: 'frostbite', name: 'Frostbite', role: 'Ice mage',
    desc: 'Fires 3 ice shards that slow enemies down. Super: a frost nova around him that freezes everyone close.',
    hp: 3300, speed: 6.3, ammo: 3, reload: 1.6, range: 12, superCost: 2500, projSpeed: 21,
    palette: { main: 0x9fd4ff, dark: 0x3a5a8c, accent: 0xe8f6ff, hair: 0x5ec8ff, skin: 0xd8ecff },
  },
  volt: {
    key: 'volt', name: 'Volt', role: 'Electric bot',
    desc: 'Shoots an electric orb whose lightning chains to 2 nearby enemies. Super: calls a lightning storm that shatters walls.',
    hp: 3100, speed: 6.8, ammo: 3, reload: 1.35, range: 13, superCost: 2600, projSpeed: 26,
    palette: { main: 0x3ec6e0, dark: 0x2b3a4a, accent: 0xffd23f, hair: 0x9aa7b4, skin: 0x8fa2b5 },
  },
};

let G = null; // shared geometries
function geos() {
  if (G) return G;
  const ring = new THREE.RingGeometry(0.78, 0.98, 48);
  ring.rotateX(-Math.PI / 2);
  const blob = new THREE.PlaneGeometry(2.1, 2.1);
  blob.rotateX(-Math.PI / 2);
  G = {
    leg: new THREE.CapsuleGeometry(0.17, 0.3, 4, 10),
    shoe: new THREE.SphereGeometry(0.2, 12, 8),
    torso: new THREE.CapsuleGeometry(0.44, 0.42, 6, 16),
    belt: new THREE.CylinderGeometry(0.46, 0.46, 0.12, 18),
    head: new THREE.SphereGeometry(0.48, 24, 16),
    eye: new THREE.SphereGeometry(0.11, 12, 8),
    pupil: new THREE.SphereGeometry(0.06, 10, 6),
    arm: new THREE.CapsuleGeometry(0.13, 0.3, 4, 8),
    hand: new THREE.SphereGeometry(0.13, 10, 8),
    spike: new THREE.ConeGeometry(0.16, 0.5, 6),
    barrel: new THREE.CylinderGeometry(0.065, 0.065, 0.95, 10),
    stock: new THREE.BoxGeometry(0.16, 0.4, 0.22),
    brim: new THREE.CylinderGeometry(0.74, 0.74, 0.06, 24),
    crown: new THREE.CylinderGeometry(0.34, 0.4, 0.4, 18),
    band: new THREE.CylinderGeometry(0.41, 0.41, 0.09, 18),
    pistol: new THREE.BoxGeometry(0.12, 0.5, 0.16),
    helmet: new THREE.SphereGeometry(0.53, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    lamp: new THREE.CylinderGeometry(0.12, 0.14, 0.12, 12),
    beard: new THREE.SphereGeometry(0.34, 14, 10),
    bomb: new THREE.SphereGeometry(0.22, 14, 10),
    hood: new THREE.ConeGeometry(0.62, 0.95, 16, 1, true),
    crystal: new THREE.OctahedronGeometry(0.2, 0),
    staff: new THREE.CylinderGeometry(0.04, 0.05, 1.5, 8),
    botHead: new THREE.BoxGeometry(0.86, 0.72, 0.8),
    visor: new THREE.BoxGeometry(0.66, 0.34, 0.06),
    antenna: new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6),
    bulb: new THREE.SphereGeometry(0.1, 12, 8),
    iceBlock: new THREE.BoxGeometry(1.5, 2.6, 1.5),
    ring,
    blob,
  };
  return G;
}

let BLOB_MAT = null;
let ICE_MAT = null;

function mesh(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function buildModel(T) {
  const g = geos(), P = T.palette;
  const M = {
    skin: charMat(P.skin, { roughness: 0.6 }),
    main: charMat(P.main),
    dark: charMat(P.dark, { roughness: 0.7 }),
    accent: charMat(P.accent, { roughness: 0.45 }),
    hair: charMat(P.hair, { roughness: 0.65 }),
    metal: charMat(0x3a3f4a, { roughness: 0.3, metalness: 0.7 }),
    white: charMat(0xffffff, { roughness: 0.25 }),
    black: charMat(0x141414, { roughness: 0.2 }),
  };
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.62; root.add(hips);

  const legL = new THREE.Group(); legL.position.set(-0.21, 0, 0); hips.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.21, 0, 0); hips.add(legR);
  for (const L of [legL, legR]) {
    mesh(g.leg, M.dark, 0, -0.3, 0, L);
    const s = mesh(g.shoe, M.black, 0, -0.55, 0.06, L); s.scale.set(1, 0.6, 1.3);
  }
  const torso = new THREE.Group(); hips.add(torso);
  mesh(g.torso, M.main, 0, 0.45, 0, torso);
  mesh(g.belt, M.dark, 0, 0.12, 0, torso);

  const head = new THREE.Group(); head.position.y = 1.33; torso.add(head);
  mesh(g.head, M.skin, 0, 0, 0, head);
  for (const sx of [-1, 1]) {
    mesh(g.eye, M.white, 0.17 * sx, 0.06, 0.39, head);
    mesh(g.pupil, M.black, 0.17 * sx, 0.06, 0.48, head);
  }

  const armL = new THREE.Group(); armL.position.set(-0.54, 0.78, 0); torso.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.54, 0.78, 0); torso.add(armR);
  for (const A of [armL, armR]) {
    mesh(g.arm, M.main, 0, -0.24, 0, A);
    mesh(g.hand, M.skin, 0, -0.5, 0, A);
  }
  armR.rotation.x = -1.35;
  const gun = new THREE.Group(); gun.position.set(0, -0.52, 0.04); armR.add(gun);
  let twoHanded = false;

  if (T.key === 'blaster') {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const s = mesh(g.spike, M.hair, Math.cos(a) * 0.3, 0.38, Math.sin(a) * 0.3 - 0.08, head);
      s.rotation.set(Math.sin(a) * 0.6 - 0.3, 0, -Math.cos(a) * 0.6);
    }
    mesh(g.spike, M.hair, 0, 0.52, -0.05, head);
    const b1 = mesh(g.barrel, M.metal, -0.05, -0.35, 0, gun);
    const b2 = mesh(g.barrel, M.metal, 0.07, -0.35, 0, gun);
    mesh(g.stock, charMat(0x8b5a2b), 0, 0.12, 0, gun);
    b1.scale.y = b2.scale.y = 1;
    const scarf = mesh(g.belt, M.accent, 0, 0.92, 0, torso); scarf.scale.set(0.8, 1.2, 0.8);
  } else if (T.key === 'gunslinger') {
    mesh(g.brim, M.hair, 0, 0.36, 0, head);
    mesh(g.crown, M.hair, 0, 0.56, 0, head);
    mesh(g.band, M.accent, 0, 0.43, 0, head);
    mesh(g.pistol, M.metal, 0, -0.2, 0, gun);
    const gun2 = new THREE.Group(); gun2.position.set(0, -0.52, 0.04); armL.add(gun2);
    mesh(g.pistol, M.metal, 0, -0.2, 0, gun2);
    armL.rotation.x = -1.35;
    twoHanded = true;
    const kerchief = mesh(g.belt, M.accent, 0, 0.92, 0.05, torso); kerchief.scale.set(0.75, 1.3, 0.75);
  } else if (T.key === 'frostbite') {
    // hooded ice mage with a crystal-topped staff
    const hood = mesh(g.hood, M.main, 0, 0.3, -0.05, head); hood.material.side = THREE.DoubleSide;
    for (const [x, y, z, r] of [[-0.3, 0.45, -0.1, 0.5], [0.3, 0.45, -0.1, -0.5], [0, 0.62, -0.2, 0], [0, 0.35, -0.42, 0]]) {
      const sp = mesh(g.crystal, M.accent, x, y, z, head); sp.scale.set(0.6, 1.3, 0.6); sp.rotation.z = r;
    }
    const glow = charMat(0xbff0ff, { emissive: 0x6fdcff, emissiveIntensity: 3, roughness: 0.1 });
    glow.userData.glow = true;
    const staff = mesh(g.staff, M.dark, 0, -0.1, 0, gun); staff.rotation.x = 0.2;
    const tip = mesh(g.crystal, glow, 0, -0.9, 0.12, gun); tip.scale.set(1.1, 1.8, 1.1);
    const scarf = mesh(g.belt, M.accent, 0, 0.92, 0, torso); scarf.scale.set(0.8, 1.2, 0.8);
  } else if (T.key === 'volt') {
    // boxy little robot: glowing visor, antenna bulb, sparking fists
    const hb = new THREE.Mesh(g.botHead, M.metal); hb.castShadow = hb.receiveShadow = true; head.add(hb);
    head.children[0].visible = false; // hide the round skin head under the box
    for (const e of head.children.slice(1, 5)) e.visible = false; // hide the cartoon eyes
    const screen = charMat(0x0a1a22, { emissive: 0x2fe0ff, emissiveIntensity: 1.6, roughness: 0.2 });
    const bulbMat = charMat(0xfff2a0, { emissive: 0xffd23f, emissiveIntensity: 4 });
    const fist = charMat(0xfff2a0, { emissive: 0x7ff0ff, emissiveIntensity: 2.2 });
    screen.userData.glow = bulbMat.userData.glow = fist.userData.glow = true;
    mesh(g.visor, screen, 0, 0.02, 0.41, head);
    for (const sx of [-1, 1]) mesh(g.pupil, M.black, 0.14 * sx, 0.04, 0.45, head);
    mesh(g.antenna, M.metal, 0.18, 0.55, 0, head);
    mesh(g.bulb, bulbMat, 0.18, 0.78, 0, head);
    for (const A of [armL, armR]) A.children[1].material = fist; // glowing hands
    mesh(g.belt, M.accent, 0, 0.12, 0, torso);
  } else {
    mesh(g.helmet, M.accent, 0, 0.08, 0, head);
    const lampMat = charMat(0xfff2b0, { emissive: 0xffe28a, emissiveIntensity: 3 });
    const fuseMat = charMat(0xffaa33, { emissive: 0xff7722, emissiveIntensity: 4 });
    lampMat.userData.glow = fuseMat.userData.glow = true;
    const lamp = mesh(g.lamp, lampMat, 0, 0.3, 0.47, head);
    lamp.rotation.x = Math.PI / 2;
    const beard = mesh(g.beard, M.hair, 0, -0.28, 0.2, head); beard.scale.set(1.1, 0.8, 0.8);
    mesh(g.bomb, M.black, 0, -0.1, 0, gun);
    const fuse = mesh(g.lamp, fuseMat, 0, -0.1, 0.22, gun);
    fuse.scale.set(0.4, 1, 0.4);
  }

  const mats = Object.values(M);
  root.traverse(o => { if (o.isMesh && !mats.includes(o.material)) mats.push(o.material); });
  return { root, hips, torso, head, legL, legR, armL, armR, gun, mats, twoHanded };
}

const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Brawler {
  constructor(game, typeKey, { name, isPlayer = false }) {
    this.g = game;
    this.type = TYPES[typeKey];
    this.name = name;
    this.isPlayer = isPlayer;
    this.model = buildModel(this.type);
    this.root = new THREE.Group();
    this.root.add(this.model.root);
    game.scene.add(this.root);
    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.moveIntent = new THREE.Vector3();
    this.net = new THREE.Vector2();   // network target position (netDriven brawlers)
    this.netDriven = false;
    this.netFacing = null;
    this.knock = new THREE.Vector3();
    this.facing = 0;
    this.aimFacing = 0;
    this.aimHold = 0;
    this.maxHp = this.type.hp;
    this.hp = this.maxHp;
    this.ammo = this.type.ammo;
    this.superCharge = 0;
    this.cubes = 0;
    this.baseDmg = isPlayer ? 1 : 0.85; // bots aim with lead prediction, so hit a bit softer
    this.dmgMul = this.baseDmg;
    this.lastHurt = -99;
    this.lastAttack = -99;
    this.alive = true;
    this.revealT = 0;
    this.inBush = false;
    this.inPoison = false;
    this.flash = 0;
    this.fireCd = 0;
    this.burst = [];
    this.recoil = 0;
    this.walkPhase = Math.random() * 6;
    this.walkAmp = 0;
    this.poisonTick = 0;
    this.slowT = 0;     // Frostbite shards
    this.freezeT = 0;   // Frost nova: can't move or attack
    this.spawnT = 0;
    this.visibleToPlayer = true;
    this.rank = 0;

    const g = geos();
    this.ring = new THREE.Mesh(g.ring, new THREE.MeshBasicMaterial({
      color: isPlayer ? new THREE.Color(0.3, 1.6, 2.0) : new THREE.Color(1.8, 0.25, 0.2),
      transparent: true, opacity: 0.9, depthWrite: false,
    }));
    if (!BLOB_MAT) {
      BLOB_MAT = new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1,
      });
    }
    this.blob = new THREE.Mesh(g.blob, BLOB_MAT);
    game.fx.add(this.ring, this.blob);
  }

  get radius() { return 0.62; }

  setVisible(v) {
    this.root.visible = v;
    this.ring.visible = v;
    this.blob.visible = v;
  }

  face(dx, dz) {
    this.aimFacing = Math.atan2(dx, dz);
    this.aimHold = 0.5;
  }

  update(dt, t) {
    if (!this.alive) return;
    const T = this.type, A = this.g.arena;
    if (this.ammo < T.ammo) this.ammo = Math.min(T.ammo, this.ammo + dt / T.reload);
    this.fireCd -= dt;
    this.revealT -= dt;
    this.aimHold -= dt;
    this.slowT -= dt;
    this.freezeT -= dt;
    const statusMul = this.freezeT > 0 ? 0 : this.slowT > 0 ? 0.55 : 1;

    // Brawl-style regen: 13%/s after 3s without dealing or taking damage.
    if (t - this.lastHurt > 3 && t - this.lastAttack > 3 && !this.inPoison && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.13 * dt);
    }

    // On ice the brawler keeps its momentum: low acceleration = sliding.
    this.onIce = A.isIceAt(this.pos.x, this.pos.z);
    if (this.netDriven) {
      // Mirrored from the network: glide toward the last known position, derive velocity for the walk cycle.
      const k = 1 - Math.exp(-14 * dt), nx = this.pos.x + (this.net.x - this.pos.x) * k, nz = this.pos.z + (this.net.y - this.pos.z) * k;
      if (Math.hypot(this.net.x - this.pos.x, this.net.y - this.pos.z) > 6) { this.pos.x = this.net.x; this.pos.z = this.net.y; }
      else { this.vel.set((nx - this.pos.x) / Math.max(dt, 1e-3), 0, (nz - this.pos.z) / Math.max(dt, 1e-3)); this.pos.x = nx; this.pos.z = nz; }
    } else {
      const k = 1 - Math.exp(-(this.onIce ? 2.4 : 16) * dt);
      this.vel.x += (this.moveIntent.x * T.speed * statusMul - this.vel.x) * k;
      this.vel.z += (this.moveIntent.z * T.speed * statusMul - this.vel.z) * k;
      this.pos.x += (this.vel.x + this.knock.x) * dt;
      this.pos.z += (this.vel.z + this.knock.z) * dt;
      this.knock.multiplyScalar(Math.exp(-7 * dt));
      A.collideCircle(this.pos, this.radius);
    }
    this.inBush = A.isBushAt(this.pos.x, this.pos.z);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = speed > 0.8;
    let want = this.facing;
    if (this.aimHold > 0) want = this.aimFacing;
    else if (moving) want = Math.atan2(this.vel.x, this.vel.z);
    else if (this.netDriven && this.netFacing !== null) want = this.netFacing;
    this.facing = lerpAngle(this.facing, want, 1 - Math.exp(-16 * dt));
    this.root.rotation.y = this.facing;
    this.animate(dt, t, speed / T.speed);
    this.updateStatusFx();

    this.ring.position.set(this.pos.x, 0.045, this.pos.z);
    this.blob.position.set(this.pos.x, 0.03, this.pos.z);
  }

  animate(dt, t, speedFrac) {
    const m = this.model;
    this.walkAmp += ((speedFrac > 0.15 ? 1 : 0) - this.walkAmp) * (1 - Math.exp(-10 * dt));
    this.walkPhase += dt * 12 * Math.max(speedFrac, 0.2);
    const s = Math.sin(this.walkPhase), a = this.walkAmp;
    m.legL.rotation.x = s * 0.8 * a;
    m.legR.rotation.x = -s * 0.8 * a;
    if (!m.twoHanded) m.armL.rotation.x = -s * 0.6 * a;
    m.hips.position.y = 0.62 + Math.abs(Math.cos(this.walkPhase)) * 0.08 * a + Math.sin(t * 2.2) * 0.012;
    m.torso.rotation.z = s * 0.05 * a;
    m.torso.rotation.x = 0.08 * a;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    m.armR.rotation.x = -1.35 + this.recoil * 0.55;
    if (m.twoHanded) m.armL.rotation.x = -1.35 + this.recoil * 0.4;

    // spawn pop + hit squash
    this.spawnT = Math.min(1, this.spawnT + dt * 3);
    const pop = this.spawnT < 1 ? 1 + Math.sin(this.spawnT * Math.PI) * 0.25 : 1;
    const sq = this.flash * 0.08;
    m.root.scale.set(pop * (1 + sq), this.spawnT * pop * (1 - sq), pop * (1 + sq));

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7);
      const f = this.flash * 0.9;
      for (const mat of m.mats) if (!mat.userData.glow) mat.emissive.setRGB(f, f * 0.9, f * 0.9);
      if (this.flash === 0) this.coldShown = -1; // let the frost tint repaint
    }
  }

  // Frozen: an ice block around the brawler. Slowed: a frosty tint.
  updateStatusFx() {
    const frozen = this.freezeT > 0;
    if (frozen && !this.ice) {
      if (!ICE_MAT) ICE_MAT = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, emissive: 0x2a6f9a, emissiveIntensity: 0.6 });
      this.ice = new THREE.Mesh(geos().iceBlock, ICE_MAT);
      this.ice.position.y = 1.3;
      this.ice.castShadow = true;
      this.root.add(this.ice);
    }
    if (this.ice) this.ice.visible = frozen;
    const cold = frozen ? 0.5 : this.slowT > 0 ? 0.28 : 0;
    if (cold !== this.coldShown && this.flash <= 0) {
      this.coldShown = cold;
      for (const mat of this.model.mats) if (!mat.userData.glow) mat.emissive.setRGB(cold * 0.2, cold * 0.55, cold);
    }
  }

  dispose() {
    this.g.scene.remove(this.root);
    this.g.fx.remove(this.ring, this.blob);
    for (const m of this.model.mats) m.dispose();
    this.ring.material.dispose();
  }
}
