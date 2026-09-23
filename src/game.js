import * as THREE from 'three';
import { Arena, HALF } from './arena.js';
import { Brawler, TYPES } from './brawler.js';
import { Combat } from './combat.js';
import { Poison } from './poison.js';
import { BotBrain } from './ai.js';
import { Effects } from './effects.js';
import { shared } from './materials.js';
import { sfx } from './audio.js';
import { MAPS, MAP_KEYS } from './maps.js';
import { Weather } from './weather.js';

const NAMES = ['Bolt', 'Nova', 'Rex', 'Juno', 'Pix', 'Kai', 'Moxie', 'Zed', 'Luna', 'Taro', 'Fizz', 'Oona', 'Brick', 'Echo'];
const TYPE_KEYS = Object.keys(TYPES);
const GREEN = new THREE.Color(0.6, 4, 1.2);
const WOOD = new THREE.Color(0xa8662f);
const _v = new THREE.Vector3();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Who plays where: humans first, bots fill up to 8. The host builds this and sends it to
// every client so all browsers create the same brawlers on the same spawns.
export function makeRoster(humans = []) {
  const spawns = shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  const names = shuffle(NAMES.slice());
  const roster = humans.slice(0, 8).map((h, k) => ({ id: h.id, name: h.name, type: h.type, human: true, spawn: spawns[k] }));
  for (let k = roster.length; k < 8; k++) {
    roster.push({ id: 'bot' + k, name: names[k], type: TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)], human: false, spawn: spawns[k] });
  }
  return roster;
}
export const randomMap = () => MAP_KEYS[Math.floor(Math.random() * MAP_KEYS.length)];
const r2 = v => Math.round(v * 100) / 100;

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
    this.camOffset = new THREE.Vector3(0, 21.5, 13.5);
    this.shake = 0;
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
  newMatch({ mapKey = 'oasis', roster = null, localId = null, net = null } = {}) {
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
    this.poison = new Poison(this, localId ? {} : { startAt: 18, interval: 6 });
    this.visionRadius = MAPS[this.mapKey].vision || 0;
    roster = roster || makeRoster([]);
    this.player = null;
    for (const r of roster) {
      const isPlayer = r.id === localId;
      const b = new Brawler(this, r.type, { name: isPlayer ? 'YOU' : r.name, isPlayer });
      b.id = r.id;
      b.human = r.human;
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
    this.mode = localId ? 'play' : 'attract';
    this.state = 'playing';
    this.time = 0;
    this.resultT = -1;
    this.restartT = -1;
    this.camTarget = this.player || this.brawlers[0];
    this.camFocus.copy(this.camTarget.pos);
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
    this.shake = Math.min(1, this.shake + k);
    if (this.mode === 'play' && k > 0.08) this.input.rumble(Math.min(1, k * 1.4), Math.min(1, k), 120 + k * 250);
  }

  // Bushes hide brawlers unless you are close, or they recently fired / got hit.
  // On limited-vision maps nobody (players or bots) sees past the fog wall.
  canSee(viewer, target) {
    const d = Math.hypot(viewer.pos.x - target.pos.x, viewer.pos.z - target.pos.z);
    if (this.visionRadius && d > this.visionRadius * 0.92) return false;
    if (!target.inBush || target.revealT > 0) return true;
    return d < 3.6;
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
    b.face(dx, dz);
    b.recoil = 1;
    this.combat.attack(b, dx, dz, point, isSuper);
    this.ev({ e: 'atk', id: b.id, dx: r2(dx), dz: r2(dz), px: r2(point.x), pz: r2(point.z), s: isSuper ? 1 : 0 });
    return true;
  }

  applyKnock(o, x, z) {
    if (!this.authority) return;
    if (o.netDriven) this.ev({ e: 'knock', id: o.id, x: r2(x), z: r2(z) }); // remote players move themselves
    else o.knock.set(x, 0, z);
  }

  damage(target, amount, source, fromSuper = false) {
    if (!target.alive || !this.authority) return;
    amount = Math.round(amount);
    target.hp -= amount;
    target.lastHurt = this.time;
    if (source && source !== target && !fromSuper) {
      const before = source.superCharge;
      source.superCharge = Math.min(1, source.superCharge + amount / source.type.superCost);
      if (source.isPlayer && before < 1 && source.superCharge >= 1) sfx('ready');
    }
    this.ev({ e: 'dmg', id: target.id, a: amount, s: source ? source.id : null });
    this.damageFx(target, amount, source);
    if (target.hp <= 0) this.kill(target, source);
  }

  damageFx(target, amount, source) {
    target.flash = 1;
    target.revealT = Math.max(target.revealT, 0.8);
    if (target.visibleToPlayer) {
      const cls = target.isPlayer ? 'dmg-in' : source && source.isPlayer ? 'dmg-out' : 'dmg-other';
      this.hud.floater(this.camera, target.pos.x, 2.6, target.pos.z, amount, cls);
    }
    if (target.isPlayer) { sfx('hurt'); this.shake = Math.min(1, this.shake + 0.18); this.input.rumble(0.55, 0.35, 140); }
    else if (source && source.isPlayer) sfx('hit');
  }

  kill(b, killer) {
    if (!b.alive) return;
    b.rank = this.brawlers.filter(o => o.alive && o !== b).length + 1;
    const n = Math.max(1, b.cubes), x = b.pos.x, z = b.pos.z;
    this.killFx(b, killer);
    if (!this.authority) return;
    for (let k = 0; k < n; k++) this.dropCube(x, z, k, n);
    this.ev({ e: 'kill', id: b.id, by: killer ? killer.id : null, rank: b.rank });
    this.checkEnd();
  }

  killFx(b, killer) {
    b.alive = false;
    b.hp = 0;
    b.burst.length = 0;
    b.setVisible(false);
    this.effects.poof(b.pos.x, b.pos.z, b.type.palette.main);
    this.shakeAt(b.pos.x, b.pos.z, 0.3);
    sfx('death', this.volumeAt(b.pos.x, b.pos.z));
    if (this.camTarget === b && killer && killer.alive) this.camTarget = killer;
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

  damageCrate(i, j, dmg) {
    if (!this.authority || !this.arena.hitCrate(i, j, dmg)) return;
    this.crateFx(i, j);
    this.dropCube(_v.x, _v.z, 0, 1);
    this.ev({ e: 'crate', i, j });
  }

  crateFx(i, j) {
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
    b.dmgMul = b.baseDmg + 0.1 * b.cubes;
    b.maxHp += 400;
    b.hp += 400;
    this.fx.remove(it.mesh);
    this.items.splice(this.items.indexOf(it), 1);
    this.effects.sparkBurst(it.x, 1, it.z, GREEN, 14, 5, 0.5);
    this.effects.flash(it.x, 1.2, it.z, 0.3, 1, 0.45, 20, 6, 0.3);
    if (b.isPlayer) {
      sfx('pickup');
      this.hud.floater(this.camera, b.pos.x, 3.4, b.pos.z, '+POWER', 'power');
    }
  }

  /* ------------------------------ network ------------------------------ */

  // host <- client input (movement is client-authoritative, everything else is ours)
  onInput(m) {
    const b = this.byId.get(m.from);
    if (!b || !this.authority) return;
    b.remoteIn = m;
    if (b.alive) b.net.set(m.x, m.z);
  }

  // A client left mid-match: its brawler keeps fighting as a bot.
  onLeft(id) {
    const b = this.byId.get(id);
    if (!b || !this.authority) return;
    b.human = false; b.netDriven = false; b.remoteIn = null;
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
        N.send({
          t: 'snap', pt: r2(this.poison.timer),
          b: this.brawlers.filter(b => b.alive).map(b => [b.id, r2(b.pos.x), r2(b.pos.z), r2(b.facing), Math.round(b.hp), b.maxHp,
            r2(b.ammo), r2(b.superCharge), b.cubes, (b.revealT > 0 ? 2 : 0) | (b.slowT > 0 ? 4 : 0) | (b.freezeT > 0 ? 8 : 0)]),
        });
      }
    } else if (this.player && this.player.alive && this.netT <= 0) {
      this.netT = 1 / 20;
      const p = this.player, i = this.localIn || {};
      N.send({ t: 'in', x: r2(p.pos.x), z: r2(p.pos.z), ax: r2(this.aimDir.x), az: r2(this.aimDir.z),
        px: r2(this.aimPoint.x), pz: r2(this.aimPoint.z), f: i.f ? 1 : 0, s: this.superSeq });
    }
  }

  // client <- host state (15 Hz)
  applySnap(m) {
    if (this.authority || this.state === 'idle') return;
    this.poison.timer = m.pt;
    for (const [id, x, z, f, hp, maxHp, ammo, sup, cubes, flags] of m.b) {
      const b = this.byId.get(id);
      if (!b || !b.alive) continue;
      b.hp = hp; b.maxHp = maxHp; b.ammo = ammo; b.superCharge = sup; b.cubes = cubes;
      b.revealT = flags & 2 ? 0.3 : 0;
      // status effects are decided by the host; our own brawler needs them too (we move it locally)
      b.slowT = flags & 4 ? 0.2 : Math.min(b.slowT, 0);
      b.freezeT = flags & 8 ? 0.2 : Math.min(b.freezeT, 0);
      if (b !== this.player) { b.net.set(x, z); b.netFacing = f; }
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
          b.face(e.dx, e.dz); b.recoil = 1; b.revealT = 1.2; b.lastAttack = this.time;
          this.combat.attack(b, e.dx, e.dz, _v.set(e.px, 0, e.pz), !!e.s);
          break;
        case 'dmg':
          if (!b || !b.alive) break;
          b.hp -= e.a; b.lastHurt = this.time;
          this.damageFx(b, e.a, this.byId.get(e.s));
          break;
        case 'kill':
          if (!b) break;
          b.rank = e.rank;
          if (b.alive) this.killFx(b, this.byId.get(e.by));
          break;
        case 'win':
          if (b) { b.rank = 1; if (b === this.player) { this.state = 'over'; this.resultT = 1.2; } }
          break;
        case 'knock': if (b === this.player) b.knock.set(e.x, 0, e.z); break;
        case 'zap': this.effects.arc(e.pts, new THREE.Color(3.2, 4.2, 5.2)); break;
        case 'wall': this.breakWall(e.i, e.j, true); break;
        case 'crate': if (this.arena.hitCrate(e.i, e.j, 1e9)) this.crateFx(e.i, e.j); break;
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

  update(dt) {
    const t = (this.time += dt);
    shared.time.value = t;
    const frozen = this.paused && !this.net;
    if (!frozen && (this.state === 'playing' || this.state === 'over')) this.step(dt, t);
    this.effects.update(frozen ? 0 : dt);
    if (this.arena) this.arena.update(dt, t);
    this.updateCamera(dt);
    this.updateLights(frozen ? 0 : dt);
    this.hud.update(dt, this.camera, this);
    this.input.endFrame();
  }

  step(dt, t) {
    const P = this.player;
    if (P && P.alive) this.controlPlayer();
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
    }
  }

  controlPlayer() {
    const I = this.input, p = this.player;
    I.move(p.moveIntent);

    if (I.usingPad) {
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
    const P = this.player;
    for (const b of this.brawlers) {
      if (!b.alive) { b.visibleToPlayer = false; continue; }
      const viewer = P && P.alive ? P : (this.visionRadius ? this.camTarget : null);
      const v = !viewer || b === viewer || this.canSee(viewer, b);
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
    const desired = _v.set(0, 0, 2);
    if (tgt) {
      desired.copy(tgt.pos);
      if (tgt === this.player && tgt.alive) desired.addScaledVector(this.aimDir, Math.min(this.aimDist, 10) * 0.18);
    }
    if (this.mode === 'attract') desired.x -= 5;
    desired.x = THREE.MathUtils.clamp(desired.x, -(HALF - 9), HALF - 9);
    desired.z = THREE.MathUtils.clamp(desired.z, -(HALF - 11), HALF - 6);
    desired.y = 0;
    const speed = tgt === this.player ? 6 : 2.2;
    this.camFocus.lerp(desired, 1 - Math.exp(-speed * dt));
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shakeEnabled === false ? 0 : this.shake * this.shake * 0.7;
    this.camera.position.copy(this.camFocus).add(this.camOffset);
    if (s > 0) {
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camFocus.x, 0.5, this.camFocus.z);
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
