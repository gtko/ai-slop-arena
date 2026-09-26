import * as THREE from 'three';
import { Arena, HALF } from './arena.js';
import { Brawler, TYPES } from './brawler.js';
import { Combat } from './combat.js';
import { Poison } from './poison.js';
import { BotBrain } from './ai.js';
import { Effects } from './effects.js';
import { shared } from './materials.js';
import { sfx, duckMusic, setDanger } from './audio.js';
import { MAPS, MAP_KEYS } from './maps.js';
import { Weather } from './weather.js';
import { t } from './i18n/index.js';
import { Feel, weapon } from './feel.js';
import { GADGETS, GADGET_CHARGES, GADGET_LOCKOUT, parseLoadout, flareFx } from './gadgets.js';

const NAMES = ['Bolt', 'Nova', 'Rex', 'Juno', 'Pix', 'Kai', 'Moxie', 'Zed', 'Luna', 'Taro', 'Fizz', 'Oona', 'Brick', 'Echo'];
const TYPE_KEYS = Object.keys(TYPES);
const GREEN = new THREE.Color(0.6, 4, 1.2);
const WOOD = new THREE.Color(0xa8662f);
const _v = new THREE.Vector3();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Who plays where: humans first, bots fill up to 8. The host builds this and sends it to
// every client so all browsers create the same brawlers on the same spawns.
// level (0..1, see skill.js): the bots' skill is a mix around it, some weaker, some sharper.
export function makeRoster(humans = [], { level = 0.45 } = {}) {
  const spawns = shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  const names = shuffle(NAMES.slice());
  const roster = humans.slice(0, 8).map((h, k) => ({ id: h.id, name: h.name, type: h.type, human: true, spawn: spawns[k], plat: h.plat }));
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  for (let k = roster.length; k < 8; k++) {
    const skill = Math.round(Math.min(0.97, Math.max(0.05, 0.12 + level * 0.8 + gauss() * 0.2)) * 100) / 100;
    const lo = `:${Math.random() < 0.5 ? 'A' : 'B'}${Math.random() < 0.5 ? 1 : 2}`; // bots pick a random loadout
    roster.push({ id: 'bot' + k, name: names[k], type: TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)] + lo, human: false, spawn: spawns[k], skill });
  }
  return roster;
}
export const randomMap = () => MAP_KEYS[Math.floor(Math.random() * MAP_KEYS.length)];
const r2 = v => Math.round(v * 100) / 100;
// Spawn shield: nobody can hurt anybody during the first seconds of a match (bots also stay calm
// for 7-11 s, see ai.js), so nobody gets jumped at spawn. Crates still break.
export const SPAWN_SHIELD = 5;

// A small gold crown (bounty crown): a band and five points.
function crownMesh(parent) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.8, roughness: 0.3, emissive: 0x6b4a00, emissiveIntensity: 0.6 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.38, 0.22, 16, 1, true), mat);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2, p = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 6), mat);
    p.position.set(Math.cos(a) * 0.4, 0.24, Math.sin(a) * 0.4);
    g.add(p);
  }
  g.visible = false;
  parent.add(g);
  return g;
}

export class Game {
  constructor({ scene, camera, lighting, lights, hud, input }) {
    Object.assign(this, { scene, camera, lighting, lights, hud, input });
    this.fx = new THREE.Group();   // transient / translucent stuff, excluded from the AO pass
    this.fx.name = 'fx';
    scene.add(this.fx);
    this.effects = new Effects(this.fx);
    this.combat = new Combat(this);
    this.arena = null;
    this.poison = null;
    this.brawlers = [];
    this.brains = new Map();
    this.items = [];
    this.player = null;
    this.time = 0;
    this.mode = 'attract';
    this.state = 'idle';
    this.camFocus = new THREE.Vector3(0, 0, 4);
    this.camTarget = null;
    this.camOffset = new THREE.Vector3(0, 27.4, 25); // ~47° pitch (hack'n'slash), 1.44x further than the old 57° view
    lighting.fogShift = Math.max(0, this.camOffset.length() - 22); // keep the air around the player clear
    this.feel = new Feel();   // hit freeze, camera trauma, zoom punches (cosmetic)
    this.bushIdleT = 0;
    this.gadgetSeq = 0;
    this.gadgetDir = new THREE.Vector3(0, 0, 1);
    this.heartT = 0;          // low health: heartbeat timer
    this.aimPoint = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.aimDist = 0;
    this.superAiming = false;
    this.ray = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
    this.resultT = -1;
    this.restartT = -1;
    this.onResult = null;
    this.onMatchEnd = null;
    this.onFeat = null;       // (kind, value): the local player's KOs, super KOs, crates and cubes, for achievements
    this.net = null;          // null = solo, else { role: 'host' | 'client', send(msg) }
    this.outbox = [];
    this.netT = 0;
    this.byId = new Map();
    this.itemSeq = 0;
    this.cubeGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    this.cubeMat = new THREE.MeshStandardMaterial({ color: 0x3dff7a, emissive: 0x22ff66, emissiveIntensity: 2.2, roughness: 0.3 });
    this.buildAim();
  }

  /* ------------------------------ match setup ------------------------------ */

  // opts: { mapKey, roster, localId, net }. No localId = attract mode (bots only, menu backdrop).
  // headless: the authoritative server (worker/ -> src/server/sim.js), a real match with no local player.
  // dojo: training (M05) - no gas, no drops, the bots are dummies in front of you that never fall.
  newMatch({ mapKey = 'oasis', roster = null, localId = null, net = null, headless = false, dojo = false } = {}) {
    for (const b of this.brawlers) b.dispose();
    this.brawlers = [];
    this.brains.clear();
    this.byId.clear();
    for (const it of this.items) this.fx.remove(it.mesh);
    this.items = [];
    this.combat.clear();
    this.effects.clear();
    if (this.poison) this.poison.dispose();
    if (this.weather) this.weather.dispose();
    if (this.arena) this.arena.dispose();

    this.mapKey = MAPS[mapKey] ? mapKey : 'oasis';
    this.net = net;
    this.outbox = [];
    this.ended = false;
    this.endT = -1;
    this.superSeq = 0;
    this.arena = new Arena(this.scene, MAPS[this.mapKey]);
    this.weather = this.lighting.weather = new Weather(this, MAPS[this.mapKey].weather);
    this.weather.setDensity(this.weatherDensity ?? 1);
    const real = !!localId || headless;
    this.dojo = dojo;
    this.dojoLog = [];
    this.poison = new Poison(this, dojo ? { startAt: 1e9 } : real ? {} : { startAt: 18, interval: 6 });
    this.visionRadius = MAPS[this.mapKey].vision || 0;
    // How far anyone sees (fog maps use their fog wall instead); the sandstorm cuts it shorter.
    this.sightRange = this.visionRadius ? 0 : MAPS[this.mapKey].weather === 'sandstorm' ? 11 : 14;
    roster = roster || makeRoster([]);
    this.player = null;
    for (const r of roster) {
      const isPlayer = r.id === localId;
      const L = parseLoadout(r.type); // 'volt:B2' = Volt with gadget B and star power 2
      const b = new Brawler(this, TYPES[L.type] ? L.type : 'blaster', { name: isPlayer ? t('hud.you') : r.name, isPlayer });
      b.id = r.id;
      b.gadget = L.gadget; b.star = L.star;
      b.setHuman(!!r.human);
      if (r.skill !== undefined) b.skill = r.skill;
      b.pos.copy(this.arena.spawns[r.spawn % this.arena.spawns.length]);
      b.net.set(b.pos.x, b.pos.z);
      b.facing = Math.atan2(-b.pos.x, -b.pos.z);
      this.brawlers.push(b);
      this.byId.set(b.id, b);
      if (isPlayer) this.player = b;
      else if (this.authority && !r.human) this.brains.set(b, new BotBrain(this, b));
      // Positions of everything we do not simulate come from the network.
      if (net && !isPlayer && (net.role === 'client' || r.human)) b.netDriven = true;
    }
    this.mode = real ? 'play' : 'attract';
    this.fixSeen = 0;
    this.state = 'playing';
    this.time = 0;
    this.resultT = -1;
    this.restartT = -1;
    this.camTarget = this.player || this.brawlers[0];
    this.camFocus.copy(this.camTarget.pos);
    this.feel.reset();
    // supply drops (authority schedules, everyone sees): ~40-50 s and ~85-95 s into the match
    for (const D of this.dropping || []) this.fx.remove(D.beam, D.ring);
    if (dojo) this.setupDojo();
    this.drops = this.mode === 'play' && !dojo ? [40 + Math.random() * 10, 85 + Math.random() * 10] : [];
    this.dropping = [];
    this.gadgetSeq = 0;
    this.hud.setup(this.brawlers, this.player);
    this.aim.visible = this.aimTarget.visible = !!this.player;
  }

  // Solo and host run the rules; a client only mirrors what the host tells it.
  get authority() { return !this.net || this.net.role === 'host'; }
  ev(e) { if (this.net && this.net.role === 'host') this.outbox.push(e); }

  /* ------------------------------ helpers ------------------------------ */

  volumeAt(x, z) {
    const d2 = (x - this.camFocus.x) ** 2 + (z - this.camFocus.z) ** 2;
    return (this.mode === 'attract' ? 0.35 : 1) / (1 + d2 / 150);
  }

  shakeAt(x, z, amount) {
    const d = Math.hypot(x - this.camFocus.x, z - this.camFocus.z), k = amount / (1 + d * d / 120);
    this.feel.add(k);
    if (this.mode === 'play' && k > 0.08) this.input.rumble(Math.min(1, k * 1.4), Math.min(1, k), 120 + k * 250);
  }

  // Walls, trees and crates block the line of sight. Bushes hide brawlers unless you are close,
  // or they recently fired / got hit. On limited-vision maps nobody sees past the fog wall.
  canSee(viewer, target) {
    const d = Math.hypot(viewer.pos.x - target.pos.x, viewer.pos.z - target.pos.z);
    if (this.visionRadius && d > this.visionRadius * 0.92) return false;
    if (this.sightRange && d > this.sightRange) return false;
    if (!this.inSight(viewer.pos, target.pos)) return false;
    if (!target.inBush || target.revealT > 0) return true;
    return d < 3.6;
  }

  // Clear line to the target's centre or either shoulder, so a brawler peeking past a corner shows.
  inSight(a, b) {
    const A = this.arena;
    if (A.los(a.x, a.z, b.x, b.z)) return true;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, px = -dz / l * 0.5, pz = dx / l * 0.5;
    return A.los(a.x, a.z, b.x + px, b.z + pz) || A.los(a.x, a.z, b.x - px, b.z - pz);
  }

  // Whose eyes the screen shows: you, or on fog maps whoever the camera follows once you are out.
  get sightViewer() {
    const P = this.player;
    return P && P.alive ? P : (this.visionRadius ? this.camTarget : null);
  }

  // Where the fog wall is centred: you, or whoever the camera follows once you are out.
  get visionCenter() {
    const t = this.player && this.player.alive ? this.player : this.camTarget;
    return t ? t.pos : this.camFocus;
  }

  tryAttack(b, dx, dz, point, isSuper) {
    if (!b.alive || this.state === 'idle' || b.freezeT > 0) return false;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) { dx = Math.sin(b.facing); dz = Math.cos(b.facing); } else { dx /= l; dz /= l; }
    if (isSuper) {
      if (b.superCharge < 1) return false;
      b.superCharge = 0;
    } else {
      if (b.ammo < 1 || b.fireCd > 0 || b.burst.length) return false;
      b.ammo -= 1;
      b.fireCd = b.type.key === 'gunslinger' ? 0.55 : 0.4;
    }
    b.lastAttack = this.time;
    b.revealT = 1.2;
    if (isSuper && b === this.player) { this.feel.punchTo(0.92, 0.3); duckMusic(); this.hud.superCutIn(b.type.key); } // own super: punch-in + portrait
    b.face(dx, dz);
    b.attacked(isSuper);
    this.combat.attack(b, dx, dz, point, isSuper);
    this.ev({ e: 'atk', id: b.id, dx: r2(dx), dz: r2(dz), px: r2(point.x), pz: r2(point.z), s: isSuper ? 1 : 0 });
    return true;
  }

  applyKnock(o, x, z) {
    if (!this.authority || this.shielded) return;
    if (o.netDriven) {
      this.ev({ e: 'knock', id: o.id, x: r2(x), z: r2(z) }); // remote players move themselves
      if (o.guard) o.guard.knock = Math.max(o.guard.knock, Math.hypot(x, z) * 0.6 + 1.5); // allow the push
    }
    else o.knock.set(x, 0, z);
  }

  get shielded() { return this.mode === 'play' && this.time < SPAWN_SHIELD; }

  damage(target, amount, source, fromSuper = false) {
    if (!target.alive || !this.authority) return;
    if (this.shielded && source && source !== target) return;
    if (target.ghostT > 0 && source !== target) return; // Tail Roll
    if (this.dojo) { // dummies never fall: one that would, fills back up
      if (target === this.player) return;
      if (source === this.player) this.dojoLog.push([this.time, Math.round(amount)]);
      if (amount >= target.hp) target.hp += target.maxHp;
    }
    if (target.armorT > 0) amount *= 0.65;               // Bark Skin
    amount = Math.round(amount);
    target.hp -= amount;
    target.lastHurt = this.time;
    if (source && source !== target && !fromSuper) {
      const before = source.superCharge;
      source.superCharge = Math.min(1, source.superCharge + amount / source.type.superCost);
      if (source.isPlayer && before < 1 && source.superCharge >= 1) { sfx('ready'); this.input.rumble(0.5, 0.5, 90); }
    }
    this.ev({ e: 'dmg', id: target.id, a: amount, s: source ? source.id : null, u: fromSuper ? 1 : 0 });
    this.damageFx(target, amount, source, fromSuper);
    if (target.hp <= 0) this.kill(target, source, fromSuper);
  }

  // Confirmed hit (solo / host at once, clients when the host's event arrives): freeze, squash, number,
  // camera trauma and the rising hit-confirm sound. What you cannot see gives you no juice either.
  damageFx(target, amount, source, sup = false) {
    const seen = this.fxVisible(target), [stop, dealt, taken] = weapon(source, sup);
    target.hurt(seen ? stop : 0);
    target.revealT = Math.max(target.revealT, 0.8);
    if (seen) {
      const cls = target.isPlayer ? 'dmg-in' : source && source.isPlayer ? 'dmg-out' : 'dmg-other';
      // pellets and bursts of one attack add up into a single counting number
      this.hud.floater(this.camera, target.pos.x, 2.6, target.pos.z, amount, cls, source ? source.id + '>' + target.id : null);
    }
    if (target.isPlayer) {
      sfx('hurt');
      this.feel.add(taken);
      this.hud.hurtFlash(taken);
      this.input.rumble(0.55, 0.35, 140);
    } else if (source && source.isPlayer) {
      sfx('hit_confirm', 1, 1 + this.feel.nextHit() * 0.07);
      this.feel.add(dealt);
      this.input.rumble(0.15, 0.3, 40, 80);
    }
  }

  // Under 30% health: red pulsing edges (hud.js), a heartbeat (faster under 15%), muffled music.
  lowHealth(dt) {
    const P = this.player, f = P && P.alive && this.mode === 'play' && !this.ended ? P.hp / P.maxHp : 1;
    const low = f < 0.3 ? Math.min(1, (0.3 - f) / 0.2 + 0.4) : 0;
    setDanger(low);
    if (!low) { this.heartT = 0; return; }
    this.heartT -= dt;
    if (this.heartT <= 0) { sfx('heartbeat', 0.8); this.heartT = f < 0.15 ? 0.6 : 0.85; }
  }

  // Effects and sounds of a brawler only play when you can see it (or with no local player).
  fxVisible(b) {
    return !this.player || b === this.player || b.visibleToPlayer;
  }

  kill(b, killer, bySuper = false) {
    if (!b.alive) return;
    b.rank = this.brawlers.filter(o => o.alive && o !== b).length + 1;
    const bounty = b === this.crown && killer && killer !== b; // knocking out the crown pays 2 extra cubes
    const n = Math.max(1, b.cubes) + (bounty ? 2 : 0), x = b.pos.x, z = b.pos.z;
    if (bounty && killer === this.player) this.hud.floater(this.camera, x, 3.4, z, t('hud.bounty'), 'power');
    this.killFx(b, killer, bySuper);
    if (!this.authority) return;
    for (let k = 0; k < n; k++) this.dropCube(x, z, k, n);
    this.ev({ e: 'kill', id: b.id, by: killer ? killer.id : null, rank: b.rank, sup: bySuper ? 1 : 0 });
    this.checkEnd();
  }

  killFx(b, killer, bySuper = false) {
    const seen = this.fxVisible(b);
    b.alive = false;
    b.hp = 0;
    b.burst.length = 0;
    b.die(); // death fall, then a puff
    if (killer && killer !== b) {
      killer.cheer();
      if (this.fxVisible(killer)) sfx(`bark_${killer.type.key}_cheer`, this.volumeAt(killer.pos.x, killer.pos.z) * 0.8);
    }
    if (seen) {
      // KO beat: the body holds for 150 ms, then flies off away from the killer
      b.hitstopT = 0.15;
      const kx = killer && killer !== b ? b.pos.x - killer.pos.x : Math.sin(b.facing), kz = killer && killer !== b ? b.pos.z - killer.pos.z : Math.cos(b.facing);
      const l = Math.hypot(kx, kz) || 1;
      b.launch = { vx: kx / l * 3.2, vz: kz / l * 3.2, vy: 4.2 };
      this.shakeAt(b.pos.x, b.pos.z, 0.3);
      sfx('death', this.volumeAt(b.pos.x, b.pos.z));
    }
    if (killer && killer === this.player && b !== killer) {
      this.feel.add(0.25);
      this.feel.punchTo(0.94, 0.25);
      this.hud.koStamp(this.camera, b.pos.x, b.pos.z);
      duckMusic();
      sfx('ko');
      this.input.rumble(0.9, 0.6, 180);
    }
    if (b === this.player) this.feel.add(0.4);
    if (this.player) this.hud.killFeed(killer && killer !== b ? killer : null, b, this.player, bySuper);
    if (this.camTarget === b && killer && killer.alive) this.camTarget = killer;
    if (killer && killer === this.player && b !== killer && this.onFeat) { this.onFeat('ko'); if (bySuper) this.onFeat('superko'); }
    if (b === this.player) { this.state = 'over'; this.resultT = 1.6; }
  }

  // Last one standing wins. Online, the match also ends once no human is left alive.
  checkEnd() {
    if (this.ended) return;
    const alive = this.brawlers.filter(o => o.alive);
    if (alive.length === 1) {
      this.ended = true;
      const w = alive[0];
      w.rank = 1;
      w.win();
      if (this.mode === 'play') { this.feel.finalKo(!this.net); if (this.player) sfx('sting_finalko'); } // slow motion offline only: online the rules keep real time
      this.ev({ e: 'win', id: w.id });
      if (w === this.player) { this.state = 'over'; this.resultT = 1.2; }
      if (this.net) this.endT = 5;
    } else if (this.net && !alive.some(o => o.human)) {
      this.ended = true;
      this.endT = 3;
    }
  }

  breakWall(i, j, fromNet = false) {
    if (!this.authority && !fromNet) return;
    const col = this.arena.destroyWall(i, j);
    if (!col) return;
    const c = this.arena.center(i, j, _v);
    this.effects.debrisBurst(c.x, 0.2, c.z, col, 14, 0.42, 6);
    this.effects.dust(c.x, c.z, 8, 0xd9b27c, 1.4);
    this.shakeAt(c.x, c.z, 0.12);
    sfx('break', this.volumeAt(c.x, c.z));
    this.ev({ e: 'wall', i, j });
  }

  damageCrate(i, j, dmg, by = null) {
    const supply = this.arena.crateAt(i, j)?.supply;
    if (!this.authority || !this.arena.hitCrate(i, j, dmg)) return;
    this.crateFx(i, j, by);
    const n = supply ? 3 : 1;
    for (let k = 0; k < n; k++) this.dropCube(_v.x, _v.z, k, n);
    this.ev({ e: 'crate', i, j, by: by ? by.id : null });
  }

  crateFx(i, j, by = null) {
    if (by && by === this.player && this.onFeat) this.onFeat('crate');
    const c = this.arena.center(i, j, _v);
    this.effects.debrisBurst(c.x, 0.3, c.z, WOOD, 16, 0.38, 6);
    this.effects.dust(c.x, c.z, 8, 0xc9a070, 1.2);
    this.effects.sparkBurst(c.x, 1.2, c.z, GREEN, 18, 6, 0.6);
    this.effects.flash(c.x, 1.5, c.z, 0.3, 1, 0.45, 40, 8, 0.4);
    sfx('crate', this.volumeAt(c.x, c.z));
  }

  dropCube(x, z, k, n) {
    const a = (k / n) * Math.PI * 2 + Math.random() * 0.6, r = n > 1 ? 1.3 : 0.3;
    let tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
    if (this.arena.blocksMoveAt(tx, tz)) { tx = x; tz = z; }
    const id = ++this.itemSeq;
    this.spawnItem(id, x, z, tx, tz);
    this.ev({ e: 'item', id, x: r2(x), z: r2(z), tx: r2(tx), tz: r2(tz) });
  }

  spawnItem(id, x, z, tx, tz) {
    const mesh = new THREE.Mesh(this.cubeGeo, this.cubeMat);
    mesh.castShadow = true;
    this.fx.add(mesh);
    this.items.push({ id, x, z, sx: x, sz: z, tx, tz, t: 0, mesh, ph: Math.random() * 6 });
  }

  pickItem(it, b) {
    b.cubes++;
    b.refreshDmg();
    b.maxHp += 300; // v0.12: +300 (was +400), the cube leader snowballs less
    b.hp += 300;
    this.fx.remove(it.mesh);
    this.items.splice(this.items.indexOf(it), 1);
    this.effects.sparkBurst(it.x, 1, it.z, GREEN, 14, 5, 0.5);
    this.effects.flash(it.x, 1.2, it.z, 0.3, 1, 0.45, 20, 6, 0.3);
    if (b.isPlayer) {
      sfx('pickup');
      this.hud.floater(this.camera, b.pos.x, 3.4, b.pos.z, t('hud.power'), 'power');
      if (this.onFeat) this.onFeat('cubes', b.cubes);
    }
  }

  // Training dojo: the other brawlers stand in a loose row a few metres ahead, as dummies.
  setupDojo() {
    this.brains.clear();
    const P = this.player, A = this.arena, spot = new THREE.Vector3();
    // the most open spot near the middle for you, the dummies around it
    let best = null, bs = -1;
    for (let j = 7; j < 18; j++) for (let i = 7; i < 18; i++) {
      let open = 0;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (A.walkable(i + di, j + dj) && A.get(i + di, j + dj) !== 'W') open++;
      if (open > bs) { bs = open; best = [i, j]; }
    }
    A.center(best[0], best[1], spot);
    P.pos.set(spot.x, 0, spot.z + 3);
    let k = 0;
    for (const b of this.brawlers) {
      if (b === P) continue;
      const a = (k++ - 3) * 0.45, r = 6.5;
      b.pos.set(spot.x + Math.sin(a) * r, 0, spot.z + 3 - Math.cos(a) * r);
      A.collideCircle(b.pos, b.radius);
      b.face(P.pos.x - b.pos.x, P.pos.z - b.pos.z);
    }
  }

  updateDojo() {
    const P = this.player;
    if (P) { P.gadgetCharges = 3; P.hp = P.maxHp; }
    for (const b of this.brawlers) {
      if (b === P) continue;
      b.moveIntent.set(0, 0, 0);
      if (this.time - b.lastHurt > 2) b.hp = b.maxHp; // dummies heal up after 2 s
    }
    while (this.dojoLog.length && this.time - this.dojoLog[0][0] > 5) this.dojoLog.shift();
  }

  // Your damage per second over the last 5 s (training dojo).
  get dojoDps() { return Math.round(this.dojoLog.reduce((s, [, a]) => s + a, 0) / 5); }

  // Supply drop: 5 s of warning (a beacon and a siren where it will land), then a gold crate falls
  // from the sky with 3 power cubes inside. Whoever stands under it gets bumped.
  updateDrops(dt) {
    if (this.authority && this.drops.length && this.time > this.drops[0] - 5 && !this.ended) {
      this.drops.shift();
      const A = this.arena, lvl = this.poison.level;
      for (let tries = 0; tries < 30; tries++) {
        const [i, j] = A.randomOpenTile(lvl + 3);
        if (A.get(i, j) !== '.' || A.ring(i, j) <= lvl + 2) continue;
        const c = A.center(i, j, new THREE.Vector3());
        if (this.brawlers.some(o => o.alive && Math.hypot(o.pos.x - c.x, o.pos.z - c.z) < 2)) continue;
        this.dropWarn(i, j);
        this.ev({ e: 'dropWarn', i, j });
        break;
      }
    }
    for (let k = this.dropping.length - 1; k >= 0; k--) {
      const D = this.dropping[k];
      D.t -= dt;
      D.beam.material.opacity = 0.25 + 0.2 * Math.sin(this.time * 12);
      D.ring.scale.setScalar(1.6 + 0.3 * Math.sin(this.time * 6));
      if (D.t > 0.7) continue;
      if (!D.crate) { // falling for the last 0.7 s
        this.fx.remove(D.beam, D.ring);
        D.crate = this.arena.makeCrate(D.i, D.j, true);
        this.arena.rev++;
      }
      const k01 = Math.max(0, D.t) / 0.7;
      D.crate.position.y = 16 * k01 * k01;
      if (D.t > 0) continue;
      D.crate.position.y = 0;
      this.dropping.splice(k, 1);
      const c = this.arena.center(D.i, D.j, new THREE.Vector3());
      this.effects.dust(c.x, c.z, 16, 0xc9a070, 2);
      this.effects.ring(c.x, c.z, 2.2, new THREE.Color(3, 2.4, 0.6), 0.5);
      this.shakeAt(c.x, c.z, 0.35);
      sfx('supply_land', this.volumeAt(c.x, c.z));
      if (this.authority) for (const o of this.brawlers) {
        const dx = o.pos.x - c.x, dz = o.pos.z - c.z, d = Math.hypot(dx, dz);
        if (!o.alive || d > 1.6) continue;
        this.damage(o, 300, null);
        this.applyKnock(o, (dx || 1) / (d || 1) * 9, dz / (d || 1) * 9);
      }
    }
  }

  dropWarn(i, j) {
    const c = this.arena.center(i, j, new THREE.Vector3()), col = new THREE.Color(3, 2.4, 0.6);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 30, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.set(c.x, 15, c.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false }));
    ring.position.set(c.x, 0.08, c.z);
    this.fx.add(beam, ring);
    this.dropping.push({ i, j, t: 5, beam, ring, crate: null });
    sfx('supply_siren', Math.max(0.35, this.volumeAt(c.x, c.z)));
  }

  // Bounty crown: whoever carries the most power cubes (5 or more, no tie) wears it. Knocking them
  // out drops 2 extra cubes. It only shows when you can see its wearer: no reveal through walls.
  updateCrown(t) {
    let best = null, n = 4, tie = false;
    for (const b of this.brawlers) {
      if (!b.alive) continue;
      if (b.cubes > n) { best = b; n = b.cubes; tie = false; } else if (b.cubes === n && best) tie = true;
    }
    this.crown = tie ? null : best;
    if (!this.crownMesh) this.crownMesh = crownMesh(this.fx);
    const c = this.crownMesh, W = this.crown;
    c.visible = !!W && this.fxVisible(W) && W.root.visible;
    if (c.visible) { c.position.set(W.pos.x, W.pos.y + 3.55 + Math.sin(t * 3) * 0.06, W.pos.z); c.rotation.y = t * 1.4; }
  }

  /* ------------------------------ network ------------------------------ */

  // host <- client input. Players move themselves (smooth on their screen), but the host checks
  // every step: too fast, through a wall, out of the arena or while frozen is refused, and the
  // player is snapped back (see `me` in the snapshots). Aim and fire are sanitised; attacks go
  // through tryAttack like everyone else's (ammo, cooldown, super charge).
  onInput(m) {
    const b = this.byId.get(m.from);
    if (!b || !this.authority || !b.netDriven) return;
    const now = this.time;
    const g = b.guard || (b.guard = { win: now, n: 0, moveT: now, knock: 0, fix: 0, strikes: 0 });
    if (now - g.win >= 1) { g.win = now; g.n = 0; }
    if (++g.n > 45) return; // flood: clients send 20 per second
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    let ax = num(m.ax, 0), az = num(m.az, 1);
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const reach = b.type.range + 2;
    let px = num(m.px, b.pos.x), pz = num(m.pz, b.pos.z);
    const pd = Math.hypot(px - b.pos.x, pz - b.pos.z);
    if (pd > reach) { px = b.pos.x + (px - b.pos.x) / pd * reach; pz = b.pos.z + (pz - b.pos.z) / pd * reach; }
    const gl = Math.hypot(num(m.gx, 0), num(m.gz, 0)) || 0;
    b.remoteIn = { ax, az, px, pz, f: m.f ? 1 : 0, s: Math.max(0, Math.min(1e6, Math.floor(num(m.s, 0)))),
      g: Math.max(0, Math.min(1e6, Math.floor(num(m.g, 0)))), gx: gl ? m.gx / gl : ax, gz: gl ? m.gz / gl : az };
    if (b.alive) this.checkMove(b, num(m.x, b.net.x), num(m.z, b.net.y), now);
  }

  checkMove(b, x, z, now) {
    const g = b.guard;
    const dt = Math.min(0.6, Math.max(0.03, now - g.moveT));
    g.moveT = now;
    const allowed = b.type.speed * 1.35 * dt + 0.4 + g.knock;
    g.knock = Math.max(0, g.knock - 4 * dt);
    const d = Math.hypot(x - b.net.x, z - b.net.y);
    const ok = d <= allowed && (b.freezeT <= 0 || d < 0.3)
      && Math.abs(x) < HALF && Math.abs(z) < HALF && !this.arena.blocksMoveAt(x, z);
    if (ok) { b.net.set(x, z); return; }
    g.fix++;                    // the next snapshot tells that player to snap back
    g.strikes++;
    if (this.onCheat) this.onCheat(b, 'move', d, allowed);
  }

  // A player who was not ready in time (or reconnected) takes their brawler back from the bot.
  onRejoin(id) {
    const b = this.byId.get(id);
    if (!b || !this.authority || b.human || !b.alive) return;
    b.setHuman(true); b.netDriven = true; b.guard = null; b.remoteIn = null;
    b.net.set(b.pos.x, b.pos.z);
    this.brains.delete(b);
  }

  // A client left mid-match: its brawler keeps fighting as a bot.
  onLeft(id) {
    const b = this.byId.get(id);
    if (!b || !this.authority) return;
    b.setHuman(false); b.netDriven = false; b.remoteIn = null;
    this.brains.set(b, new BotBrain(this, b));
    this.checkEnd();
  }

  netTick(dt) {
    const N = this.net;
    if (!N) return;
    this.netT -= dt;
    if (N.role === 'host') {
      if (this.outbox.length) { N.send({ t: 'ev', list: this.outbox }); this.outbox = []; }
      if (this.netT <= 0) {
        this.netT = 1 / 15;
        const alive = this.brawlers.filter(b => b.alive), pt = r2(this.poison.timer);
        const row = b => [b.id, r2(b.pos.x), r2(b.pos.z), r2(b.facing), Math.round(b.hp), b.maxHp,
          r2(b.ammo), r2(b.superCharge), b.cubes, (b.revealT > 0 ? 2 : 0) | (b.slowT > 0 ? 4 : 0) | (b.freezeT > 0 ? 8 : 0) | (b.rootT > 0 ? 16 : 0)];
        if (N.sendTo) {
          // One snapshot per player with only what that player can see: brawlers hidden in a bush
          // or behind the fog are simply not sent, so no client can reveal them. Knocked-out
          // players spectate and get everything.
          for (const v of this.brawlers) {
            if (!v.human || v === this.player) continue;
            const seen = v.alive ? alive.filter(b => b === v || this.canSee(v, b)) : alive;
            const g = v.guard;
            N.sendTo(v.id, { t: 'snap', pt, b: seen.map(row), me: v.alive ? [r2(v.net.x), r2(v.net.y), g ? g.fix : 0] : undefined });
          }
        } else N.send({ t: 'snap', pt, b: alive.map(row) });
      }
    } else if (this.player && this.player.alive && this.netT <= 0) {
      this.netT = 1 / 20;
      const p = this.player, i = this.localIn || {};
      N.send({ t: 'in', x: r2(p.pos.x), z: r2(p.pos.z), ax: r2(this.aimDir.x), az: r2(this.aimDir.z),
        px: r2(this.aimPoint.x), pz: r2(this.aimPoint.z), f: i.f ? 1 : 0, s: this.superSeq, g: this.gadgetSeq,
        gx: r2(this.gadgetDir.x), gz: r2(this.gadgetDir.z) });
    }
  }

  // client <- host state (15 Hz)
  applySnap(m) {
    if (this.authority || this.state === 'idle') return;
    this.poison.timer = m.pt;
    const seen = new Set();
    for (const [id, x, z, f, hp, maxHp, ammo, sup, cubes, flags] of m.b) {
      const b = this.byId.get(id);
      if (!b || !b.alive) continue;
      seen.add(b);
      b.hp = hp; b.maxHp = maxHp; b.ammo = ammo; b.superCharge = sup; b.cubes = cubes;
      b.revealT = flags & 2 ? 0.3 : 0;
      // status effects are decided by the host; our own brawler needs them too (we move it locally)
      b.slowT = flags & 4 ? 0.2 : Math.min(b.slowT, 0);
      b.freezeT = flags & 8 ? 0.2 : Math.min(b.freezeT, 1e-4); // a tiny rest so update() still sees the thaw (immunity fx)
      b.rootT = flags & 16 ? 0.2 : Math.min(b.rootT, 0);
      if (b !== this.player) {
        b.net.set(x, z); b.netFacing = f;
        if (b.netHidden) { b.pos.x = x; b.pos.z = z; } // back in sight: appear where it is, don't glide there through the wall
      }
    }
    // Brawlers the host left out are hidden from us (bush / wall / range / fog): keep them invisible.
    for (const b of this.brawlers) b.netHidden = b !== this.player && !seen.has(b);
    // The host refused one of our moves (too fast, through a wall...): snap back to where it says.
    const P = this.player;
    if (m.me && P && P.alive && m.me[2] !== this.fixSeen) {
      this.fixSeen = m.me[2];
      P.pos.set(m.me[0], P.pos.y, m.me[1]);
      P.vel.set(0, 0, 0);
    }
  }

  // client <- host events (attacks, hits, deaths, walls, crates, cubes...)
  applyEvents(list) {
    if (this.authority) return;
    for (const e of list) {
      const b = e.id !== undefined ? this.byId.get(e.id) : null;
      switch (e.e) {
        case 'atk':
          if (!b || !b.alive) break;
          b.face(e.dx, e.dz); b.attacked(!!e.s); b.revealT = 1.2; b.lastAttack = this.time;
          if (e.s && b === this.player) { this.feel.punchTo(0.92, 0.3); duckMusic(); this.hud.superCutIn(b.type.key); }
          this.combat.attack(b, e.dx, e.dz, _v.set(e.px, 0, e.pz), !!e.s);
          break;
        case 'dmg':
          if (!b || !b.alive) break;
          b.hp -= e.a; b.lastHurt = this.time;
          this.damageFx(b, e.a, this.byId.get(e.s), !!e.u);
          break;
        case 'kill':
          if (!b) break;
          b.rank = e.rank;
          if (b.alive) this.killFx(b, this.byId.get(e.by), !!e.sup);
          break;
        case 'win':
          this.ended = true;
          if (b) { b.rank = 1; b.win(); if (!this.feel.orbitWant) sfx('sting_finalko'); this.feel.finalKo(false); if (b === this.player) { this.state = 'over'; this.resultT = 1.2; } }
          break;
        case 'knock': if (b === this.player) b.knock.set(e.x, 0, e.z); break;
        case 'imm': if (b && b.visibleToPlayer) this.hud.floater(this.camera, b.pos.x, 3.1, b.pos.z, t('hud.immune'), 'immune'); break;
        case 'gad':
          if (b && b !== this.player && b.alive) GADGETS[b.type.key + b.gadget]?.fx(this, b, e.dx, e.dz);
          break;
        case 'flare': flareFx(this, e.x, e.z); break;
        case 'dropWarn': this.dropWarn(e.i, e.j); break;
        case 'zoneOff': this.combat.zones.filter(Z => Z.once && Math.hypot(Z.x - e.x, Z.z - e.z) < 0.1).forEach(Z => { Z.t = 0; }); break;
        case 'ice': this.arena.iceWall(e.t, 3); break;
        case 'zone': this.combat.zone({ ...e.z, owner: this.byId.get(e.z.owner), col: new THREE.Color(...e.z.col) }); break;
        case 'zap': this.effects.arc(e.pts, new THREE.Color(3.2, 4.2, 5.2)); break;
        case 'wall': this.breakWall(e.i, e.j, true); break;
        case 'crate': if (this.arena.hitCrate(e.i, e.j, 1e9)) this.crateFx(e.i, e.j, this.byId.get(e.by)); break;
        case 'item': this.spawnItem(e.id, e.x, e.z, e.tx, e.tz); break;
        case 'pick': {
          const it = this.items.find(o => o.id === e.item), by = this.byId.get(e.by);
          if (it && by) this.pickItem(it, by);
          break;
        }
      }
    }
  }

  /* ------------------------------ per frame ------------------------------ */

  // Authoritative server: rules only, no camera, lights, effects or HUD.
  serverStep(dt) {
    const t = (this.time += dt);
    if (this.state === 'playing' || this.state === 'over') this.step(dt, t);
  }

  update(dt) {
    dt *= this.feel.timeScale(dt);
    const t = (this.time += dt);
    shared.time.value = t;
    const frozen = this.paused && !this.net;
    if (!frozen && (this.state === 'playing' || this.state === 'over')) this.step(dt, t);
    this.effects.update(frozen ? 0 : dt);
    this.lowHealth(dt);
    if (this.arena) this.arena.update(dt, t);
    this.updateCamera(dt);
    this.updateLights(frozen ? 0 : dt);
    this.hud.update(dt, this.camera, this);
    this.input.endFrame();
  }

  step(dt, t) {
    const P = this.player;
    if (P && P.alive && !this.ended) this.controlPlayer();
    else if (P && P.alive) P.moveIntent.set(0, 0, 0);
    else this.aim.visible = this.aimTarget.visible = false;
    if (this.authority) {
      for (const brain of this.brains.values()) brain.update(dt);
      this.remoteAttacks();
    }
    for (const b of this.brawlers) b.update(dt, t);
    this.separate();
    this.combat.update(dt);
    this.poison.update(dt, t);
    if (this.authority) this.poisonDamage(dt);
    this.updateItems(dt, t);
    this.updateCrown(t);
    this.updateDrops(dt);
    if (this.dojo) this.updateDojo();
    this.updateVisibility();
    this.updateFoliage(dt);
    if (P && P.alive) this.updateAim();

    if (this.resultT > 0) {
      this.resultT -= dt;
      if (this.resultT <= 0 && this.onResult) this.onResult(P.rank, P.rank === 1);
    }
    if (this.endT > 0) {
      this.endT -= dt;
      if (this.endT <= 0 && this.onMatchEnd) this.onMatchEnd();
    }
    this.netTick(dt);
    if (this.mode === 'attract' && this.brawlers.filter(b => b.alive).length <= 1) {
      if (this.restartT < 0) this.restartT = 3;
      this.restartT -= dt;
      if (this.restartT <= 0) this.newMatch({ mapKey: randomMap() });
    }
  }

  // Host: turn the latest input of each remote player into attacks.
  remoteAttacks() {
    for (const b of this.brawlers) {
      const I = b.remoteIn;
      if (!I || !b.alive) continue;
      _v.set(I.px, 0, I.pz);
      if (I.f) this.tryAttack(b, I.ax, I.az, _v, false);
      if (I.s > (b.superSeen || 0)) { b.superSeen = I.s; this.tryAttack(b, I.ax, I.az, _v, true); }
      if (I.g > (b.gadgetSeen || 0)) { b.gadgetSeen = I.g; if (this.spendGadget(b)) this.gadgetEffect(b, I.gx ?? I.ax, I.gz ?? I.az, _v); }
    }
  }

  controlPlayer() {
    const I = this.input, p = this.player;
    I.move(p.moveIntent);

    if (I.usingTouch && I.touch) {
      // touch: the attack / super stick aims while dragged; a tap aims at the nearest enemy
      const T = I.touch;
      if (T.autoAim) {
        T.autoAim = false;
        const foe = this.nearestFoe(p);
        if (foe) {
          const dx = foe.pos.x - p.pos.x, dz = foe.pos.z - p.pos.z, l = Math.hypot(dx, dz) || 1;
          this.aimDir.set(dx / l, 0, dz / l);
          this.aimDist = Math.min(l, p.type.range);
        }
      } else if ((T.aiming || T.superAiming) && T.aim.lengthSq() > 0.02) {
        this.aimDir.set(T.aim.x, 0, T.aim.y).normalize();
        this.aimDist = 2 + Math.min(1, T.aim.length()) * (p.type.range - 2);
      } else if (p.moveIntent.lengthSq() > 0.05 && !I.attackHeld) {
        this.aimDir.copy(p.moveIntent).normalize();
        this.aimDist = p.type.range * 0.7;
      }
      this.aimPoint.set(p.pos.x + this.aimDir.x * this.aimDist, 0.8, p.pos.z + this.aimDir.z * this.aimDist);
    } else if (I.usingPad) {
      // twin-stick: right stick aims, its tilt sets the throw distance for lobbed attacks
      const r = I.stickR;
      if (r.lengthSq() > 0.09) {
        this.aimDir.set(r.x, 0, r.y).normalize();
        this.aimDist = 2 + Math.min(1, r.length()) * (p.type.range - 2);
      } else if (p.moveIntent.lengthSq() > 0.05 && !I.attackHeld) {
        this.aimDir.copy(p.moveIntent).normalize();
        this.aimDist = p.type.range * 0.7;
      }
      this.aimPoint.set(p.pos.x + this.aimDir.x * this.aimDist, 0.8, p.pos.z + this.aimDir.z * this.aimDist);
    } else {
      this.ray.setFromCamera(I.ndc, this.camera);
      if (this.ray.ray.intersectPlane(this.aimPlane, this.aimPoint)) {
        const dx = this.aimPoint.x - p.pos.x, dz = this.aimPoint.z - p.pos.z, l = Math.hypot(dx, dz);
        if (l > 0.05) this.aimDir.set(dx / l, 0, dz / l);
        this.aimDist = l;
      }
    }
    const ready = p.superCharge >= 1;
    const superPressed = ready && I.superFired;
    if (I.gadgetFired) {
      // mobility gadgets go where you walk (if you walk), the others where you aim
      const G = GADGETS[p.type.key + p.gadget], mv = p.moveIntent;
      const d = G && G.dist && mv.lengthSq() > 0.05 ? _v.set(mv.x, 0, mv.z).normalize() : this.aimDir;
      this.useGadget(p, d.x, d.z, this.aimPoint);
    }
    if (!this.authority) {
      // client: the host fires for us and echoes the attack back as an event
      this.localIn = { f: I.attackHeld };
      if (superPressed) this.superSeq++;
    } else {
      if (I.attackHeld) this.tryAttack(p, this.aimDir.x, this.aimDir.z, this.aimPoint, false);
      if (superPressed) this.tryAttack(p, this.aimDir.x, this.aimDir.z, this.aimPoint, true);
    }
    this.superAiming = ready && I.superAimHeld;
  }

  /* ------------------------------ gadgets (gadgets.js) ------------------------------ */

  canGadget(b) {
    return b.alive && this.state !== 'idle' && b.freezeT <= 0 && b.gadgetCharges > 0 && b.gadgetCd <= 0 && !b.dash && !b.blink && !this.shielded;
  }

  spendGadget(b) {
    if (!this.canGadget(b)) return false;
    b.gadgetCharges--;
    b.gadgetCd = GADGET_LOCKOUT;
    b.revealT = Math.max(b.revealT, 1.2); // using a gadget gives you away, like firing
    return true;
  }

  // On the machine that controls b (you; bots on the host): the movement part now, then the rules
  // part here if we are the authority, else the host runs it when our input arrives.
  useGadget(b, dx, dz, point) {
    if (!this.spendGadget(b)) return false;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const G = GADGETS[b.type.key + b.gadget];
    G.move?.(this, b, dx, dz);
    if (this.authority) this.gadgetEffect(b, dx, dz, point);
    else { this.gadgetSeq++; this.gadgetDir.set(dx, 0, dz); G.fx(this, b, dx, dz); }
    if (b === this.player) this.hud.gadgetUsed();
    return true;
  }

  // Authority: what the gadget does to the match, its look for everyone, and room for the dash.
  gadgetEffect(b, dx, dz, point) {
    const G = GADGETS[b.type.key + b.gadget];
    G.effect(this, b, dx, dz, point);
    G.fx(this, b, dx, dz);
    if (b.netDriven && b.guard && G.dist) b.guard.knock = Math.max(b.guard.knock, G.dist + 1.5); // a remote player dashes itself
    this.ev({ e: 'gad', id: b.id, dx: r2(dx), dz: r2(dz) });
    if (this.onGadget) this.onGadget(b);
  }

  // Root Charge: while charging, the first enemy touched takes 400 and is rooted 0.6 s.
  chargeContact(b) {
    if (b.chargeHit) return;
    for (const o of this.brawlers) {
      if (o === b || !o.alive || Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) > b.radius + o.radius + 0.35) continue;
      b.chargeHit = o;
      this.damage(o, 400 * b.dmgMul, b);
      if (o.alive && o.ccImmuneT <= 0) o.rootT = Math.max(o.rootT, 0.6);
      this.effects.ring(o.pos.x, o.pos.z, 1, new THREE.Color(1.6, 1.1, 0.5), 0.5);
      return;
    }
  }

  // Lava Hop: the landing spot burns for 2 s.
  hopLanded(b) {
    this.combat.zone({ x: b.pos.x, z: b.pos.z, r: 2, dps: 300, t: 2, owner: b, col: new THREE.Color(3.4, 1.2, 0.2) }, true);
    this.shakeAt(b.pos.x, b.pos.z, 0.25);
  }

  // Ice Wall tiles (authority picks them, clients copy): never on top of a brawler.
  iceWall(tiles) {
    const A = this.arena, c = new THREE.Vector3();
    return A.iceWall(tiles, 3, (i, j) => { A.center(i, j, c); return !this.brawlers.some(o => o.alive && Math.abs(o.pos.x - c.x) < 1.35 && Math.abs(o.pos.z - c.z) < 1.35); });
  }

  // Closest enemy the player can see (touch auto-aim), preferring ones in range.
  nearestFoe(p) {
    let best = null, bd = Infinity;
    for (const b of this.brawlers) {
      if (b === p || !b.alive || !this.canSee(p, b)) continue;
      const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  separate() {
    const B = this.brawlers;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz, rr = a.radius + b.radius;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2), k = (rr - d) / d * ((a.netDriven || b.netDriven) ? 1 : 0.5);
        if (!a.netDriven) { a.pos.x -= dx * k; a.pos.z -= dz * k; }
        if (!b.netDriven) { b.pos.x += dx * k; b.pos.z += dz * k; }
      }
    }
  }

  poisonDamage(dt) {
    for (const b of this.brawlers) {
      if (!b.alive) continue;
      b.inPoison = this.poison.isPoisonedAt(b.pos.x, b.pos.z);
      if (!b.inPoison) { b.poisonTick = 0.4; continue; }
      b.poisonTick -= dt;
      if (b.poisonTick <= 0) {
        b.poisonTick = 1;
        this.damage(b, 900 + this.poison.level * 60, null);
        if (b.isPlayer) sfx('gas');
      }
    }
  }

  updateItems(dt, t) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / 0.45);
      it.x = it.sx + (it.tx - it.sx) * k;
      it.z = it.sz + (it.tz - it.sz) * k;
      const y = 0.75 + Math.sin(k * Math.PI) * 1.3 + (k >= 1 ? Math.sin(t * 3 + it.ph) * 0.12 : 0);
      it.mesh.position.set(it.x, y, it.z);
      it.mesh.rotation.set(0.6, t * 1.8 + it.ph, 0.6);
      if (it.t < 0.5 || !this.authority) continue; // clients wait for the host's 'pick' event
      for (const b of this.brawlers) {
        if (!b.alive || Math.hypot(b.pos.x - it.x, b.pos.z - it.z) > 1.2) continue;
        this.ev({ e: 'pick', item: it.id, by: b.id });
        this.pickItem(it, b);
        break;
      }
    }
  }

  updateVisibility() {
    const viewer = this.sightViewer;
    for (const b of this.brawlers) {
      if (!b.alive) { b.visibleToPlayer = false; continue; }
      const v = !b.netHidden && (!viewer || b === viewer || this.canSee(viewer, b));
      if (v !== b.visibleToPlayer) b.setVisible(v);
      b.visibleToPlayer = v;
    }
  }

  updateFoliage(dt) {
    const push = shared.push.value;
    for (let k = 0; k < push.length; k++) {
      const b = this.brawlers[k];
      if (b && b.alive) push[k].set(b.pos.x, b.pos.z, 0.55 + 0.45 * b.walkAmp);
      else push[k].set(9999, 9999, 0);
    }
    const P = this.player;
    const want = P && P.alive && P.inBush ? 1 : 0;
    shared.revealAmt.value += (want - shared.revealAmt.value) * (1 - Math.exp(-8 * dt));
    if (P) shared.reveal.value.set(P.pos.x, P.pos.z, 3.4);
  }

  /* ------------------------------ aim indicator ------------------------------ */

  buildAim() {
    this.aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
    this.aim = new THREE.Group();
    const fan = s => { const g = new THREE.CircleGeometry(1, 40, -s / 2, s); g.rotateX(-Math.PI / 2); return g; };
    this.aimFan = new THREE.Mesh(fan(0.56), this.aimMat);
    this.aimFanS = new THREE.Mesh(fan(0.76), this.aimMat);
    const rect = new THREE.PlaneGeometry(1, 1); rect.rotateX(-Math.PI / 2); rect.translate(0.5, 0, 0);
    this.aimRect = new THREE.Mesh(rect, this.aimMat);
    this.aim.add(this.aimFan, this.aimFanS, this.aimRect);
    const disc = new THREE.CircleGeometry(1, 48); disc.rotateX(-Math.PI / 2);
    this.aimTarget = new THREE.Mesh(disc, this.aimMat);
    this.aim.renderOrder = this.aimTarget.renderOrder = 1;
    this.fx.add(this.aim, this.aimTarget);
    this.aim.visible = this.aimTarget.visible = false;
  }

  updateAim() {
    const p = this.player, T = p.type, sup = this.superAiming, dir = this.aimDir;
    this.aim.visible = true;
    this.aim.position.set(p.pos.x, 0.06, p.pos.z);
    this.aim.rotation.y = Math.atan2(-dir.z, dir.x);
    this.aimMat.color.set(sup ? 0xffd23f : 0xffffff);
    this.aimMat.opacity = sup ? 0.32 : p.ammo >= 1 ? 0.16 : 0.07;
    this.aimFan.visible = T.key === 'blaster' && !sup;
    this.aimFanS.visible = T.key === 'blaster' && sup;
    this.aimFan.scale.setScalar(9.5);
    this.aimFanS.scale.setScalar(11);
    this.aimRect.visible = T.key !== 'blaster' && !(T.key === 'frostbite' && sup);
    this.aimTarget.visible = T.key === 'bomber' || (sup && (T.key === 'frostbite' || T.key === 'volt'));
    if (T.key === 'gunslinger') this.aimRect.scale.set(sup ? 20 : 16, 1, sup ? 1.3 : 0.8);
    if (T.key === 'frostbite') {
      this.aimRect.scale.set(12, 1, 0.9);
      if (sup) { this.aimTarget.position.set(p.pos.x, 0.065, p.pos.z); this.aimTarget.scale.setScalar(5); }
    }
    if (T.key === 'volt') {
      const d = THREE.MathUtils.clamp(this.aimDist, 2, T.range);
      this.aimRect.scale.set(sup ? d : 13, 1, sup ? 0.14 : 0.7);
      if (sup) { this.aimTarget.position.set(p.pos.x + dir.x * d, 0.065, p.pos.z + dir.z * d); this.aimTarget.scale.setScalar(3.2); }
    }
    if (T.key === 'bomber') {
      const d = THREE.MathUtils.clamp(this.aimDist, 2, T.range);
      this.aimRect.scale.set(d, 1, 0.14);
      this.aimTarget.position.set(p.pos.x + dir.x * d, 0.065, p.pos.z + dir.z * d);
      this.aimTarget.scale.setScalar(sup ? 3.6 : 2.2);
    }
    // Touch: like Brawl Stars, the aim only shows while a stick is being dragged.
    const I = this.input;
    if (I.usingTouch && I.touch && !I.touch.aiming && !I.touch.superAiming) this.aim.visible = this.aimTarget.visible = false;
  }

  /* ------------------------------ camera + lights ------------------------------ */

  updateCamera(dt) {
    // scripted camera (trailer / screenshots from devtools): replaces the follow camera
    if (this.cinematic) { this.cinematic(this.camera, dt); return; }
    let tgt = this.camTarget;
    if (!tgt || !tgt.alive) {
      if (!this.player || !this.player.alive) {
        tgt = this.brawlers.find(b => b.alive) || tgt;
        if (tgt && tgt.alive) this.camTarget = tgt;
      }
    }
    const desired = _v.set(0, 0, 2), P = this.player, F = this.feel;
    // look-ahead: toward where you aim (mouse, or a stick being dragged), else toward where you walk
    let lx = 0, lz = 0;
    if (tgt === P && P && P.alive) {
      const I = this.input, T = I.touch;
      const aiming = !I.usingTouch && !I.usingPad ? true : I.usingPad ? I.stickR.lengthSq() > 0.09 : !!T && (T.aiming || T.superAiming);
      if (aiming) { const d = Math.min(2.6, 0.18 * P.type.range); lx = this.aimDir.x * d; lz = this.aimDir.z * d; }
      else if (P.moveIntent.lengthSq() > 0.05) { const l = P.moveIntent.length(); lx = P.moveIntent.x / l * 1.2; lz = P.moveIntent.z / l * 1.2; }
    }
    const kl = 1 - Math.exp(-dt / 0.25);
    F.lookX += (lx - F.lookX) * kl; F.lookZ += (lz - F.lookZ) * kl;
    if (tgt) {
      desired.copy(tgt.pos);
      if (tgt === P && tgt.alive) { desired.x += F.lookX; desired.z += F.lookZ; }
    }
    if (this.mode === 'attract') desired.x -= 5;
    desired.x = THREE.MathUtils.clamp(desired.x, -(HALF - 9), HALF - 9);
    desired.z = THREE.MathUtils.clamp(desired.z, -(HALF - 11), HALF - 6);
    desired.y = 0;
    const speed = tgt === this.player ? 6 : 2.2;
    this.camFocus.lerp(desired, 1 - Math.exp(-speed * dt));
    // zoom: out a little for the last 3 (more for the final duel), in when you lurk in a bush
    let zoom = 1;
    if (this.mode === 'play' && !this.ended) {
      const alive = this.brawlers.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
      zoom = alive === 2 ? 1.1 : alive === 3 ? 1.06 : 1;
    }
    this.bushIdleT = P && P.alive && P.inBush && P.moveIntent.lengthSq() < 0.02 ? this.bushIdleT + dt : 0;
    if (this.bushIdleT > 1.5) zoom *= 0.94;
    F.update(dt, zoom);
    const dist = F.zoom * F.punch, ca = Math.cos(F.orbit), sa = Math.sin(F.orbit), o = this.camOffset;
    const sh = F.shake(this.shakeEnabled);
    this.camera.position.set(
      this.camFocus.x + (o.x * ca + o.z * sa) * dist + sh.x,
      this.camFocus.y + o.y * dist + sh.y,
      this.camFocus.z + (o.z * ca - o.x * sa) * dist + sh.z);
    this.lighting.fogShift = Math.max(0, o.length() * dist - 22);
    this.camera.lookAt(this.camFocus.x, 0.5, this.camFocus.z);
    if (sh.roll) this.camera.rotateZ(sh.roll);
  }

  updateLights(dt) {
    const L = this.lights, night = this.lighting.night;
    L.focus.copy(this.camFocus);
    L.begin();
    if (this.arena) { this.arena.emit(L, night); this.arena.sky = this.lighting.state.sky; }
    this.combat.emit(L);
    this.effects.emit(L);
    for (const it of this.items) L.add(it.x, 1.1, it.z, 0.3, 1, 0.45, 3 + 5 * night, 4.5);
    if (this.poison) this.poison.emit(L, this.camFocus);
    if (this.weather) {
      this.weather.update(dt, this.camFocus, this.camera, night);
      this.weather.emit(L, this.camFocus);
    }
    L.end();
    this.lighting.update(dt, this.camFocus);

    // Head-lamp on whoever the camera follows; only noticeable once the sun is down.
    const lamp = this.lighting.lamp, h = this.camTarget;
    if (h && h.alive) {
      const dx = Math.sin(h.facing), dz = Math.cos(h.facing);
      lamp.position.set(h.pos.x + dx * 0.6, 2.05, h.pos.z + dz * 0.6);
      lamp.target.position.set(h.pos.x + dx * 9, 0, h.pos.z + dz * 9);
      lamp.target.updateMatrixWorld();
      lamp.intensity = THREE.MathUtils.smoothstep(night, 0.2, 1) * 70;
    } else lamp.intensity = 0;
    // Skip the lamp's shadow render while it is off (daytime): saves a full scene pass.
    // The map must exist first though: an unallocated sampler2DShadow breaks every lit draw.
    lamp.shadow.autoUpdate = lamp.intensity > 0.01 || !lamp.shadow.map;
  }
}
