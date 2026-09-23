import * as THREE from 'three';
import { radialTexture } from './materials.js';
import { buildModel as buildSculpted, OUTLINES } from './models.js';
import { hasFigurine, buildFigurine } from './figurines.js';

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


// Weapon arm angle (rotation about x, negative = forward/up) while aiming, from the recoil (1 right
// after a shot, fading to 0): guns kick up, bombs are cocked overhead then flung forward, the staff
// thrusts, Volt pushes both palms out.
const RAISE = {
  gun: r => -1.25 + r * 0.55,
  throw: r => -2.6 + r * 1.8,
  staff: r => -0.55 - r * 0.6,
  cast: r => -1.35 + r * 0.35,
};

const AXIS_X = new THREE.Vector3(1, 0, 0);
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

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
    this.model = hasFigurine(typeKey) ? buildFigurine(typeKey) : buildSculpted(this.type);
    this.blinkT = 1 + Math.random() * 3;
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
    this.walkPhase += dt * 11 * Math.max(speedFrac, 0.2);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (m.figurine) this.poseFigurine(t);
    else this.poseRig(dt, t);

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

  // Figurine on its fitted skeleton (figurines.js). Walk cycle, phase ph:
  //   thighs swing (left forward when sin > 0), the knee folds while its leg travels forward and is
  //   straight on contact; the pelvis is highest at mid-stance, twists with the forward leg and dips
  //   on the swing side; the chest counter-twists, arms swing against the legs with soft elbows.
  // Aiming lifts the weapon arm(s) (RAISE), each shot kicks it back. Idle: breathing, weight shift,
  // looking around.
  poseFigurine(t) {
    const m = this.model, k = m.bones, a = this.walkAmp, idle = 1 - a, ph = this.walkPhase;
    const s = Math.sin(ph), c = Math.cos(ph), bob = 0.5 + 0.5 * Math.cos(2 * ph);
    const breath = Math.sin(t * 2.4), shift = Math.sin(t * 0.9);
    k.thighL.rotation.set(-s * 0.5 * a, 0, 0.03);
    k.thighR.rotation.set(s * 0.5 * a, 0, -0.03);
    k.shinL.rotation.x = Math.max(0, c) * 0.75 * a;
    k.shinR.rotation.x = Math.max(0, -c) * 0.75 * a;
    k.hips.position.y = k.hips.userData.rest.y + (bob - 0.6) * 0.07 * a;
    k.hips.position.x = k.hips.userData.rest.x + shift * 0.015 * idle;
    k.hips.rotation.set(0.04 * a, -s * 0.16 * a, -c * 0.07 * a + shift * 0.02 * idle);
    k.spine.rotation.set(0.1 * a - this.recoil * 0.12, s * 0.24 * a, c * 0.05 * a);
    k.spine.scale.set(1 + breath * 0.012 * idle, 1 + breath * 0.022 * idle, 1);
    k.head.rotation.set(-0.08 * a + Math.cos(2 * ph) * 0.035 * a, -s * 0.12 * a + idle * Math.sin(t * 0.8) * 0.22, -c * 0.04 * a);
    const aim = Math.min(1, Math.max(0, this.aimHold * 3) + this.recoil);
    const aimL = m.weapon !== 'R' ? aim : 0, aimR = m.weapon !== 'L' ? aim : 0;
    const raised = (RAISE[m.style] || RAISE.gun)(this.recoil);
    const L = THREE.MathUtils.lerp;
    // Arms blend between the rig's hang and aim orientations (figurines.js armPoses): the swing is
    // applied on top, about the shoulder's side axis. Guns swing less (carried low and ready), the
    // left arm goes back while the left leg is forward, elbows straighten to aim.
    for (const [side, sign, amt] of [['L', 1, aimL], ['R', -1, aimR]]) {
      const P = m.arm[side], bone = k['arm' + side];
      const armed = amt > 0 || (m.weapon === 'both' || m.weapon === side);
      const swing = sign * s * a * (armed && m.style === 'gun' ? 0.18 : 0.42) + breath * 0.02 * idle;
      _qa.setFromAxisAngle(AXIS_X, swing).multiply(P.hang);
      if (amt > 0) {
        // guns and fists: weapon axis straight ahead, kicked up by the recoil; bombs and staff:
        // the old raise about the shoulder axis on top of the hang
        if (P.aim) _qb.setFromAxisAngle(AXIS_X, -this.recoil * 0.45).multiply(P.aim);
        else _qb.setFromAxisAngle(AXIS_X, raised).multiply(P.hang);
        _qa.slerp(_qb, amt);
      }
      bone.quaternion.copy(_qa);
      k['fore' + side].rotation.x = L(-0.12 - (0.15 + Math.max(0, -sign * s) * 0.35) * a, 0, amt);
    }
    const st = (bob - 0.5) * 0.04 * a + this.recoil * 0.03;
    m.body.scale.set(1 - st * 0.5, 1 + st, 1 - st * 0.5);
  }

  poseRig(dt, t) {
    const m = this.model;
    const s = Math.sin(this.walkPhase), a = this.walkAmp;
    m.legL.rotation.x = s * 0.8 * a;
    m.legR.rotation.x = -s * 0.8 * a;
    if (!m.twoHanded) m.armL.rotation.x = -s * 0.6 * a;
    m.hips.position.y = 0.62 + Math.abs(Math.cos(this.walkPhase)) * 0.08 * a + Math.sin(t * 2.2) * 0.012;
    m.torso.rotation.z = s * 0.05 * a;
    m.torso.rotation.x = 0.08 * a;
    m.torso.scale.set(1 + Math.sin(t * 2.2) * 0.012, 1 + Math.sin(t * 2.2 + 1) * 0.015, 1); // breathing
    // blink every few seconds
    if (m.eyes) {
      this.blinkT -= dt;
      if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3.5;
      m.eyes.scale.y = this.blinkT < 0.12 ? 0.12 : 1;
    }
    m.armR.rotation.x = -1.35 + this.recoil * 0.55;
    if (m.twoHanded) m.armL.rotation.x = -1.35 + this.recoil * 0.4;
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
    if (this.model.skeleton) this.model.skeleton.dispose(); // bone texture
    this.model.root.traverse(o => { if (o.isMesh && o.userData.baked) o.geometry.dispose(); if (o.userData.outline) OUTLINES.delete(o); }); // outlines share the geometry
    this.ring.material.dispose();
  }
}
