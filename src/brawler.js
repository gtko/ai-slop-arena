import * as THREE from 'three';
import { radialTexture, shared } from './materials.js';
import { buildModel as buildSculpted, OUTLINES } from './models.js';
import { hasFigurine, buildFigurine } from './figurines.js';
import { sfx } from './audio.js';
import { GADGET_CHARGES, hasStar } from './gadgets.js';

export const TYPES = {
  blaster: {
    key: 'blaster', name: 'Blaster', role: 'Shotgun',
    desc: 'A tree-stump golem whose hollow-log blunderbuss sprays 5 thorny seeds at close range. Super: a wide seed blast that knocks enemies back and smashes walls.',
    hp: 4800, speed: 6.0, ammo: 3, reload: 1.7, range: 9.5, superCost: 2600, projSpeed: 25,
    palette: { main: 0x5fb83a, dark: 0x6b4428, accent: 0xf28cb1, hair: 0x4f9a2e, skin: 0xe8c99a },
  },
  gunslinger: {
    key: 'gunslinger', name: 'Gunslinger', role: 'Sharpshooter',
    desc: 'An axolotl star-ranger whose twin ray pistols fire a long-range burst of 6 bolts. Super: a 12-bolt volley that tears straight through walls.',
    hp: 3600, speed: 6.6, ammo: 3, reload: 1.6, range: 16, superCost: 2800, projSpeed: 32,
    palette: { main: 0xf27aa8, dark: 0x6a3fb5, accent: 0x3fd8e8, hair: 0xd9366f, skin: 0xf7a8c4 },
  },
  bomber: {
    key: 'bomber', name: 'Bomber', role: 'Thrower',
    desc: 'A magma imp who lobs fireballs over walls that explode in an area. Super: a meteor that crashes down and levels cover.',
    hp: 3400, speed: 6.1, ammo: 3, reload: 1.9, range: 13, superCost: 2400, projSpeed: 18,
    palette: { main: 0xff7a1f, dark: 0x2e2a2c, accent: 0xffc23a, hair: 0xff9a1f, skin: 0x3a3436 },
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


const SWAY_WIND = new THREE.Vector2(1, 0.3).normalize(); // the arena's wind blows toward +x
const _sway = new THREE.Vector3();

const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// Seconds of immunity to crowd control once a freeze ends, so two novas can't chain-lock anyone.
export const CC_IMMUNE = 1.5;
const GROUND = { oasis: 'sand', dunes: 'sand', grove: 'grass', frost: 'snow', marsh: 'mud' };
const RING = { me: new THREE.Color(0.3, 1.6, 2.0), foe: new THREE.Color(1.8, 0.25, 0.2), meCb: new THREE.Color(0.35, 0.9, 2.4), foeCb: new THREE.Color(2.2, 1.0, 0.05) };
const LINE = { me: new THREE.Color(0x19b6ff), foe: new THREE.Color(0x5c0d14), meCb: new THREE.Color(0x3a8dff), foeCb: new THREE.Color(0x8a4400) };
// A per-brawler copy of a shared outline material (same shader, own colour).
function teamOutline(base) {
  const m = base.clone();
  m.onBeforeCompile = base.onBeforeCompile;
  m.customProgramCacheKey = base.customProgramCacheKey;
  m.userData = { outline: true, team: true };
  return m;
}
const IMMUNE_COL = new THREE.Color(2.2, 3, 3.6);

export class Brawler {
  constructor(game, typeKey, { name, isPlayer = false }) {
    this.g = game;
    this.type = TYPES[typeKey];
    this.name = name;
    this.isPlayer = isPlayer;
    this.model = hasFigurine(typeKey) ? buildFigurine(typeKey) : buildSculpted(this.type);
    this.blinkT = 1 + Math.random() * 3;
    this.blinkAge = 9;
    this.lidUp = 0; this.lidLow = 0; this.cheerT = 0; // eye expression (updateBlink)
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
    this.setHuman(isPlayer);
    this.lastHurt = -99;
    this.lastAttack = -99;
    this.alive = true;
    this.revealT = 0;
    this.inBush = false;
    this.inPoison = false;
    this.flash = 0;
    this.hitstopT = 0;  // hit freeze: the pose holds for a few frames (cosmetic, the sim keeps running)
    this.squash = 0;    // hit squash spring: 1 = fully squashed, springs back through 0
    this.squashV = 0;
    this.fireCd = 0;
    this.burst = [];
    this.recoil = 0;
    this.walkPhase = Math.random() * 6;
    this.walkPhase0 = this.walkPhase;       // per-brawler phase of the wind gusts
    this.swayVel = new THREE.Vector3();     // spring of the soft parts
    this.walkAmp = 0;
    this.poisonTick = 0;
    this.slowT = 0;     // Frostbite shards
    this.freezeT = 0;   // Frost nova: can't move or attack
    this.ccImmuneT = 0; // after a freeze: immune to the next one for a moment (no freeze chains)
    // Kit 2.0 (gadgets.js): loadout, charges, and the states gadgets put a brawler in
    this.gadget = 'A'; this.star = 1;
    this.gadgetCharges = GADGET_CHARGES; this.gadgetCd = 0;
    this.rootT = 0;     // rooted: can't move, can still shoot
    this.armorT = 0;    // Bark Skin: -35% damage taken
    this.ghostT = 0;    // Tail Roll: untouchable
    this.slowSelfT = 0; // Bark Skin: -20% speed
    this.overclockT = 0; this.chargeT = 0; this.hopLandT = 0;
    this.dash = null; this.blink = null; this.fuseNext = false;
    this.spawnT = 0;
    this.visibleToPlayer = true;
    this.rank = 0;
    this.won = false;      // last one standing: victory dance
    this.dieT = 0;         // death fall still playing
    this.idleT = 0;        // standing still since
    this.nextFlourish = 4 + Math.random() * 8;
    this.coughT = 0;
    this.greet = Math.random() < 0.35; // some wave hello when they pop in

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
    this.teamColors();
  }

  get radius() { return 0.62; }

  // Humans hit at full strength and bots a bit softer (they aim with lead prediction). It depends on
  // who drives the brawler, never on which machine simulates the match: the Steam host, the online
  // server and solo play all give every human the same damage.
  setHuman(v) {
    this.human = v;
    this.baseDmg = v ? 1 : 0.85;
    this.refreshDmg();
  }

  // each power cube adds 10% damage
  refreshDmg() {
    this.dmgMul = this.baseDmg + 0.1 * this.cubes;
  }

  // One footstep per half walk cycle, on the map's ground (grass in bushes): yours, and the brawlers
  // you can see close by, softer. A footstep never gives away someone hidden.
  footsteps() {
    const ph = Math.floor(this.walkPhase / Math.PI);
    if (ph === this.stepPh) return;
    this.stepPh = ph;
    const g = this.g;
    if (this.walkAmp < 0.5 || g.mode !== 'play' || this.pos.y > 0.05) return;
    const me = this === g.player;
    if (!me && !(this.visibleToPlayer && Math.hypot(this.pos.x - g.camFocus.x, this.pos.z - g.camFocus.z) < 8)) return;
    const ground = this.inBush ? 'grass' : GROUND[g.mapKey] || 'stone';
    sfx('step_' + ground, (me ? 0.35 : 0.2 * g.volumeAt(this.pos.x, this.pos.z)) * (this.inBush ? 0.6 : 1));
  }

  // Readability: your brawler has a bright outline and ring, enemies a dark red one (the colour-blind
  // option makes it blue against orange). Outline materials shared between brawlers get a copy.
  teamColors() {
    const cb = this.g.colorblind, me = this.isPlayer;
    this.ring.material.color.copy(me ? (cb ? RING.meCb : RING.me) : (cb ? RING.foeCb : RING.foe));
    const line = me ? (cb ? LINE.meCb : LINE.me) : (cb ? LINE.foeCb : LINE.foe);
    this.model.root.traverse(o => {
      if (!o.userData.outline || !o.material) return;
      if (o.material.userData.shared) o.material = teamOutline(o.material);
      o.material.color.copy(line);
    });
  }

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
    if (!this.alive) {
      if (this.dieT > 0) {
        const hold = this.hitstopT > 0;
        this.hitstopT -= dt;
        if (!hold) {
          this.dieT -= dt;
          this.model.anim.update(dt);
          const L = this.launch;
          if (L && (L.vy > 0 || this.pos.y > 0)) { // knocked off its feet, lands a little further
            const nx = this.pos.x + L.vx * dt, nz = this.pos.z + L.vz * dt;
            if (!this.g.arena.blocksMoveAt(nx, nz)) { this.pos.x = nx; this.pos.z = nz; } // stops against walls
            L.vy -= 22 * dt;
            this.pos.y = Math.max(0, this.pos.y + L.vy * dt);
            this.blob.position.set(this.pos.x, 0.03, this.pos.z);
          }
          if (this.dieT <= 0) this.vanish();
        }
      }
      return;
    }
    const T = this.type, A = this.g.arena;
    if (this.ammo < T.ammo) this.ammo = Math.min(T.ammo, this.ammo + dt / T.reload * (this.overclockT > 0 ? 1.3 : 1));
    this.gadgetCd -= dt; this.rootT -= dt; this.armorT -= dt; this.ghostT -= dt; this.slowSelfT -= dt; this.overclockT -= dt;
    if (this.chargeT > 0) { this.chargeT -= dt; if (this.g.authority) this.g.chargeContact(this); }
    if (this.hopLandT > 0 && (this.hopLandT -= dt) <= 0 && this.g.authority) this.g.hopLanded(this);
    this.fireCd -= dt;
    this.revealT -= dt;
    this.aimHold -= dt;
    this.slowT -= dt;
    const wasFrozen = this.freezeT > 0;
    this.freezeT -= dt;
    this.ccImmuneT -= dt;
    if (wasFrozen && this.freezeT <= 0) {
      this.ccImmuneT = CC_IMMUNE;
      if (this.visibleToPlayer) { // the ice breaks: immune
        this.g.effects.ring(this.pos.x, this.pos.z, 1.4, IMMUNE_COL, 0.5);
        sfx('immune', this.g.volumeAt(this.pos.x, this.pos.z));
      }
    }
    const statusMul = (this.freezeT > 0 || this.rootT > 0 ? 0 : this.slowT > 0 ? this.slowMul || 0.55 : 1) * (this.slowSelfT > 0 ? 0.8 : 1);

    // Brawl-style regen: 13%/s after 3s without dealing or taking damage.
    const calm = hasStar(this, 'sapRegen') ? 2 : 3; // star power: regen kicks in sooner
    this.regen = t - this.lastHurt > calm && t - this.lastAttack > calm && !this.inPoison;
    if (this.regen && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * (hasStar(this, 'axoRegen') ? 0.18 : 0.13) * dt);
    }

    // On ice the brawler keeps its momentum: low acceleration = sliding.
    this.onIce = A.isIceAt(this.pos.x, this.pos.z);
    if (this.netDriven) {
      // Mirrored from the network: glide toward the last known position, derive velocity for the walk cycle.
      const k = 1 - Math.exp(-14 * dt), nx = this.pos.x + (this.net.x - this.pos.x) * k, nz = this.pos.z + (this.net.y - this.pos.z) * k;
      if (Math.hypot(this.net.x - this.pos.x, this.net.y - this.pos.z) > 6) { this.pos.x = this.net.x; this.pos.z = this.net.y; }
      else { this.vel.set((nx - this.pos.x) / Math.max(dt, 1e-3), 0, (nz - this.pos.z) / Math.max(dt, 1e-3)); this.pos.x = nx; this.pos.z = nz; }
    } else if (this.blink) { // Blink: a short charge, then there
      if ((this.blink.t -= dt) <= 0) { this.pos.x = this.blink.x; this.pos.z = this.blink.z; this.vel.set(0, 0, 0); this.blink = null; }
    } else if (this.dash) { // gadget dash, slide or hop: fixed velocity; on foot walls stop it, in the air it flies over
      const D = this.dash;
      const h = Math.min(dt, D.t);
      this.pos.x += D.vx * h; this.pos.z += D.vz * h;
      this.vel.set(D.vx, 0, D.vz);
      D.t -= dt;
      if (D.air) this.pos.y = Math.max(0, 4 * 1.3 * (1 - D.t / D.T) * (D.t / D.T));
      if (D.t <= 1e-6) { this.dash = null; this.pos.y = 0; }
      if (!D.air || !this.dash) A.collideCircle(this.pos, this.radius);
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
    this.footsteps();
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (m.figurine) this.animateFigurine(dt, speedFrac);
    else this.poseRig(dt, t);

    // spawn pop + hit squash: a spring (k 320, damping 18) that overshoots once, like jelly
    this.spawnT = Math.min(1, this.spawnT + dt * 3);
    const pop = this.spawnT < 1 ? 1 + Math.sin(this.spawnT * Math.PI) * 0.25 : 1;
    for (let rest = Math.min(dt, 0.1); rest > 1e-5; rest -= 1 / 120) {
      const h = Math.min(rest, 1 / 120);
      this.squashV += (-320 * this.squash - 18 * this.squashV) * h;
      this.squash += this.squashV * h;
    }
    const sq = this.squash;
    const grow = 1 + Math.min(0.15, this.cubes * 0.015); // power cubes make you visibly bigger (the hitbox stays)
    m.root.scale.set(grow * pop * (1 + 0.1 * sq), grow * this.spawnT * pop * (1 - 0.14 * sq), grow * pop * (1 + 0.1 * sq));
    this.hitstopT -= dt;

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7);
      const f = this.flash > 0.75 ? 1 : this.flash * 0.9; // white, two frames at full
      for (const mat of m.mats) if (!mat.userData.glow) mat.emissive.setRGB(f, f, f);
      if (this.flash === 0) this.coldShown = -1; // let the frost tint repaint
    }
  }

  // Figurine: pick the clips for what the brawler is doing (animator.js; clips in art-src/rig).
  animateFigurine(dt, speedFrac) {
    const A = this.model.anim, moving = speedFrac > 0.15, aiming = this.aimHold > 0;
    A.mixer.timeScale = this.freezeT > 0 || this.hitstopT > 0 ? 0 : this.slowT > 0 ? 0.6 : 1; // frozen solid mid-pose
    const sliding = this.onIce && !this.netDriven && Math.hypot(this.vel.x, this.vel.z) > 2 && this.moveIntent.lengthSq() < 0.04;
    if (this.won) A.setLoop('Victory');
    else if (sliding) A.setLoop('Slide');
    else if (moving) A.setLoop(this.inBush ? 'Sneak' : 'Run', this.inBush ? Math.max(0.6, speedFrac) : 1.05 * Math.max(0.45, speedFrac));
    else A.setLoop(this.inBush ? 'BushIdle' : 'Idle');

    // idle flourishes: now and then, standing around out of the bushes, a sigh or a personal quirk
    const flourish = A.oneShot === 'Bored' || A.oneShot === 'Fidget' || A.oneShot === 'Wave';
    if (flourish && (moving || aiming || this.inBush)) A.cancel();
    if (!moving && !aiming && !this.inBush && !this.won && !A.oneShot && this.g.state === 'playing') {
      this.idleT += dt;
      if (this.idleT > this.nextFlourish) {
        A.once(Math.random() < 0.5 ? 'Bored' : 'Fidget');
        this.idleT = 0;
        this.nextFlourish = 6 + Math.random() * 8;
      }
    } else this.idleT = 0;
    if (this.greet && this.spawnT >= 1) { this.greet = false; if (!moving) A.once('Wave'); }

    A.aim(aiming ? 1 : 0);
    // in the gas: coughing fits between shots
    this.coughT -= dt;
    if (this.inPoison && !aiming && this.coughT <= 0) { A.fire('Cough'); this.coughT = 2 + Math.random() * 1.5; }
    A.update(dt);
    this.updateSway(dt, speedFrac);
    this.updateBlink(dt);
  }

  // Blinks every 2-5.5 s (sometimes twice in a row); eyes stay shut while knocked out (die()).
  updateBlink(dt) {
    const u = this.model.blink;
    if (!u) return;
    this.blinkT -= dt;
    this.blinkAge += dt;
    if (this.blinkT < 0) {
      this.blinkAge = 0;
      this.blinkTwice = Math.random() < 0.2;
      this.blinkT = 2 + Math.random() * 3.5;
    }
    const one = a => (a >= 0 && a < 0.16 ? Math.sin(Math.PI * a / 0.16) : 0);
    // expression: upper and lower lid rest positions, eased (the blink still closes over them)
    const [up, low] = this.expression();
    const k = 1 - Math.exp(-14 * dt);
    this.lidUp += (up - this.lidUp) * k;
    this.lidLow += (low - this.lidLow) * k;
    u.value = Math.max(one(this.blinkAge), this.blinkTwice ? one(this.blinkAge - 0.24) : 0, this.lidUp);
    if (this.model.lowLid) this.model.lowLid.value = this.lidLow;
  }

  // Eye expression [upper lid, lower lid] from what the brawler is going through.
  expression() {
    const t = this.g.time;
    if (this.won || this.cheerT > t) return [0.12, 0.52];      // happy crescents
    if (t - this.lastHurt < 0.35) return [0.55, 0.3];           // pained squint
    if (this.freezeT > 0) return [0, 0];                        // frozen wide-eyed
    if (t - this.lastAttack < 0.5 || this.aimHold > 0) return [0.3, 0.06]; // determined glare
    if (this.hp < this.maxHp * 0.3) return [0.38, 0.12];        // tired, hurting
    if (this.inBush) return [0.22, 0.14];                        // sneaky
    return [0, 0];
  }

  // Soft parts (leaves, gills, flames, capes, hair, antennas; figurines.js): they lean with the
  // gusty wind and trail behind the motion, through a spring so they overshoot and settle when the
  // brawler starts, stops or turns. Model space: the root is turned by `facing`.
  updateSway(dt) {
    const push = this.model.sway;
    if (!push || this.freezeT > 0) return;
    const t = this.g.time || 0, w = shared.wind.value, seed = this.walkPhase0;
    const gust = w * (0.55 + 0.3 * Math.sin(t * 0.9 + seed) + 0.15 * Math.sin(t * 2.3 + seed * 2));
    const tx = SWAY_WIND.x * 0.05 * gust - this.vel.x * 0.016;
    const tz = SWAY_WIND.y * 0.05 * gust - this.vel.z * 0.016;
    const a = -this.facing, c = Math.cos(a), s = Math.sin(a);
    _sway.set(tx * c + tz * s, -0.012 - 0.004 * Math.hypot(this.vel.x, this.vel.z), -tx * s + tz * c);
    const sv = this.swayVel;
    const k = Math.min(dt, 1 / 30);
    sv.addScaledVector(_sway.sub(push), 70 * k).multiplyScalar(Math.exp(-7 * k));
    push.addScaledVector(sv, k);
  }

  // Game events (game.js, combat.js): each one also plays its clip on a figurine.
  attacked(isSuper = false) {
    this.recoil = 1;
    const A = this.model.anim;
    if (!A) return;
    if (!isSuper) A.fire('Shoot');
    else if (Math.hypot(this.vel.x, this.vel.z) > 1) A.fire('Super'); // arms only, the legs keep running
    else A.once('Super');
  }

  // stop: seconds of hit freeze for this hit (feel.js), 0 for none
  hurt(stop = 0) {
    this.flash = 1;
    this.squash = 1;
    this.squashV = 0;
    this.hitstopT = Math.max(this.hitstopT, stop);
    this.model.anim?.hit();
  }

  cheer() {
    this.cheerT = this.g.time + 1.4;
    if (this.alive) this.model.anim?.fire('Cheer'); // over the aim: it covers the held arms
  }

  win() {
    this.won = true;
  }

  // Knocked out: a figurine in view plays its fall, then vanishes in a puff; otherwise straight away.
  die() {
    const A = this.model.anim;
    this.ring.visible = false;
    if (this.ice) this.ice.visible = false;
    // the body falls with its normal look: no hit flash, squash or frost tint left from the last frame
    this.flash = 0;
    this.squash = 0; this.hitstopT = 0;
    this.model.root.scale.setScalar(1);
    for (const mat of this.model.mats) if (!mat.userData.glow) mat.emissive.setRGB(0, 0, 0);
    if (this.model.blink) this.model.blink.value = 1; // eyes shut
    if (A && A.has('Death') && this.visibleToPlayer) {
      A.mixer.timeScale = 1;
      A.once('Death', { hold: true, fade: 0.08 });
      this.dieT = 1.25;
      return;
    }
    this.vanish();
  }

  vanish() {
    this.setVisible(false);
    this.g.effects.poof(this.pos.x, this.pos.z, this.type.palette.main);
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
    for (const m of this.model.disposables || []) m.dispose();
    if (this.model.skeleton) this.model.skeleton.dispose(); // bone texture
    this.model.root.traverse(o => { if (o.isMesh && o.userData.baked) o.geometry.dispose(); if (o.userData.outline) { OUTLINES.delete(o); if (o.material.userData.team) o.material.dispose(); } }); // outlines share the geometry
    this.ring.material.dispose();
  }
}
