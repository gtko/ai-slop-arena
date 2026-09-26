import * as THREE from 'three';
import { N } from './arena.js';

const SIZE = N * N;
const gScore = new Float32Array(SIZE);
const fScore = new Float32Array(SIZE);
const came = new Int32Array(SIZE);
const state = new Uint8Array(SIZE);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A* over the tile grid (8-way, no corner cutting). Poisoned tiles cost extra.
export function findPath(arena, poison, si, sj, gi, gj) {
  if (!arena.walkable(gi, gj)) [gi, gj] = arena.nearestWalkable(gi, gj);
  if (!arena.walkable(si, sj)) [si, sj] = arena.nearestWalkable(si, sj);
  gScore.fill(Infinity); came.fill(-1); state.fill(0);
  const start = sj * N + si, goal = gj * N + gi;
  const h = id => { const dx = Math.abs(id % N - gi), dy = Math.abs(((id / N) | 0) - gj); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
  const open = [start];
  gScore[start] = 0; fScore[start] = h(start); state[start] = 1;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (fScore[open[k]] < fScore[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) break;
    state[cur] = 2;
    const ci = cur % N, cj = (cur / N) | 0;
    for (const [dx, dy] of DIRS) {
      const ni = ci + dx, nj = cj + dy;
      if (!arena.walkable(ni, nj)) continue;
      if (dx && dy && (!arena.walkable(ci + dx, cj) || !arena.walkable(ci, cj + dy))) continue;
      const nid = nj * N + ni;
      if (state[nid] === 2) continue;
      let cost = dx && dy ? 1.414 : 1;
      if (poison && poison.level > 0 && arena.ring(ni, nj) <= poison.level) cost += 8;
      const tg = gScore[cur] + cost;
      if (tg < gScore[nid]) {
        came[nid] = cur; gScore[nid] = tg; fScore[nid] = tg + h(nid);
        if (state[nid] !== 1) { state[nid] = 1; open.push(nid); }
      }
    }
  }
  if (goal !== start && came[goal] === -1) return [];
  const path = [];
  for (let id = goal; id !== start && id !== -1; id = came[id]) path.push(arena.center(id % N, (id / N) | 0));
  return path.reverse();
}

const _v = new THREE.Vector3();
// Is o inside the cone a spread weapon fired at point p sweeps (up to full range, with a margin)?
function inFan(b, p, o) {
  const half = { blaster: 0.36, frostbite: 0.2 }[b.type.key];
  if (!half) return false;
  const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz);
  if (d > b.type.range + 2.5) return false; // range counts from the muzzle, plus both radii
  const diff = Math.atan2(dx, dz) - Math.atan2(p.x - b.pos.x, p.z - b.pos.z);
  return Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff))) < half + Math.atan2(1.2, Math.max(d, 0.5));
}
// distance from point p to the segment a-b on the ground plane
const segDist = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + dx * k), p.z - (a.z + dz * k));
};
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

// Bot personas (v0.13, B02): every bot is a character with its own habits, an icon on its name
// plate and a few lines in speech bubbles (bark.<persona>.<spot|ko|hurt|win> in the i18n files).
//  sight: extra metres before it notices you   grace: extra calm seconds at the start
//  retreat: health share under which it backs off   loot: how far it goes for cubes (x 24 m)
//  lowHp: how much it prefers wounded targets   camp: waits in a bush and fights close only
//  show: fires its super eagerly and emotes a lot
export const PERSONAS = ['hunter', 'camper', 'looter', 'vulture', 'coward', 'showoff'];
export const PERSONA_ICONS = { hunter: '🎯', camper: '⛺', looter: '💰', vulture: '🦅', coward: '🐔', showoff: '🕺' };
const HABITS = {
  hunter: { sight: 6, retreat: 0.22, loot: 0.6 },
  camper: { sight: -2, camp: true },
  looter: { loot: 1.8, retreat: 0.4 },
  vulture: { lowHp: 10, sight: 2 },
  coward: { retreat: 0.55, grace: 2 },
  showoff: { show: true },
  none: {},
};

export class BotBrain {
  constructor(game, bot) {
    this.g = game;
    this.b = bot;
    this.path = [];
    this.goal = new THREE.Vector3();
    this.hasGoal = false;
    this.repath = 0;
    this.think = Math.random() * 0.3;
    this.target = null;
    this.mode = 'wander';
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.fireCd = 0.6 + Math.random();
    this.gadgetThink = 1;
    this.seen = 0;
    // 0 (clumsy) .. 1 (sharp): from the roster (makeRoster, set from the players' level), else random.
    this.skill = bot.skill ?? 0.45 + Math.random() * 0.4;
    // Opening grace: for the first seconds of a match bots loot instead of hunting, so nobody gets
    // jumped at spawn. They still fight back if hit. Staggered so they do not all wake up at once.
    this.habits = { sight: 0, grace: 0, retreat: 0.3, loot: 1, lowHp: 0, ...HABITS[bot.persona || 'none'] };
    this.graceUntil = 7 + Math.random() * 4 + this.habits.grace;
    this.crate = null;
    this.stuck = 0;
    this.last = bot.pos.clone();
    this.dodgeT = 0; this.dodgeX = 0; this.dodgeZ = 0; // no sidestep yet
  }

  // A spot within 8 m the threat cannot see, not in the gas, closest first, bushes preferred.
  findCover(threat) {
    const g = this.g, A = g.arena, b = this.b, P = g.poison;
    const ci = A.toTile(b.pos.x), cj = A.toTile(b.pos.z), c = new THREE.Vector3();
    let best = null, bs = Infinity;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const i = ci + di, j = cj + dj;
      if (!A.walkable(i, j) || A.ring(i, j) <= P.level + 1) continue;
      A.center(i, j, c);
      if (A.los(threat.pos.x, threat.pos.z, c.x, c.z)) continue;
      const s = Math.hypot(di, dj) - (A.get(i, j) === 'B' ? 2 : 0) + (Math.hypot(c.x - threat.pos.x, c.z - threat.pos.z) < 4 ? 5 : 0);
      if (s < bs) { bs = s; best = c.clone(); }
    }
    return best;
  }

  coverOk(threat) {
    return this.hasGoal && !this.g.arena.los(threat.pos.x, threat.pos.z, this.goal.x, this.goal.z);
  }

  setGoal(p, force = false) {
    if (!force && this.hasGoal && this.goal.distanceTo(p) < 1.5 && this.repath > 0 && this.path.length) return;
    this.goal.copy(p); this.hasGoal = true; this.repath = 1.0;
    const A = this.g.arena, b = this.b;
    this.path = findPath(A, this.g.poison, A.toTile(b.pos.x), A.toTile(b.pos.z), A.toTile(p.x), A.toTile(p.z));
    if (this.path.length && A.walkable(A.toTile(p.x), A.toTile(p.z))) this.path[this.path.length - 1] = p.clone();
  }

  safePoint() {
    const s = Math.max(this.g.poison.safeHalf - 3, 1.5);
    return _v.set((Math.random() * 2 - 1) * s, 0, (Math.random() * 2 - 1) * s).clone();
  }

  decide() {
    const g = this.g, b = this.b, T = b.type, A = g.arena, P = g.poison;
    let best = null, bestS = Infinity;
    const provoked = b.lastHurt > 0 && g.time - b.lastHurt < 4;
    const calm = g.time < this.graceUntil && !provoked;
    const H = this.habits;
    const sight = 13 + this.skill * 9 + H.sight; // sharper bots notice targets from further away
    for (const o of g.brawlers) {
      if (calm || o === b || !o.alive) continue;
      const d = o.pos.distanceTo(b.pos);
      // A target that just ducked behind a wall is remembered for a moment (not one hiding in a bush).
      const seen = g.canSee(b, o);
      if (seen && o === this.target) this.seenAt = g.time;
      const recall = o === this.target && g.time - (this.seenAt || 0) < 2.5 && !(o.inBush && o.revealT <= 0);
      if (d > sight || !(seen || recall)) continue;
      if (H.camp && !provoked && o !== this.target && d > T.range * 0.8) continue; // campers wait for you to come close
      const s = d + (o.hp / o.maxHp) * (4 + H.lowHp) - (o === this.target ? 2 : 0);
      if (s < bestS) { bestS = s; best = o; }
    }
    if (best !== this.target) { this.seen = 0; this.seenAt = g.time; if (best && best.human && Math.random() < 0.5) g.bark(b, 'spot'); } // memory starts with the new target
    this.target = best;
    this.crate = null;

    const ring = A.ring(A.toTile(b.pos.x), A.toTile(b.pos.z));
    const soon = P.nextIn < 5 ? 1 : 0;
    if ((P.level > 0 || soon) && ring <= P.level + soon + 0.5) {
      this.mode = 'flee-gas';
      if (!this.hasGoal || A.ring(A.toTile(this.goal.x), A.toTile(this.goal.z)) <= P.level + 1) this.setGoal(this.safePoint(), true);
      else this.setGoal(this.goal);
      return;
    }

    if (best) {
      const d = best.pos.distanceTo(b.pos), hpF = b.hp / b.maxHp;
      // Bots 2.0: hurt and outmatched, back off to cover (out of the threat's sight, a bush if
      // possible) and stay there until healed (regen needs 3 s without fighting).
      if (this.healing && hpF > 0.7) this.healing = false;
      if (this.skill > 0.3 && (this.healing || (hpF < H.retreat && best.hp > b.hp && d < T.range * 1.3))) { // clumsy bots never back off
        if (!this.healing) g.bark(b, 'hurt');
        this.healing = true;
        this.mode = 'retreat';
        if (!this.hasGoal || !this.coverOk(best)) {
          const cover = this.findCover(best);
          if (cover) this.setGoal(cover, true);
          else {
            _v.subVectors(b.pos, best.pos).setY(0).normalize().multiplyScalar(9).add(b.pos);
            const s = P.safeHalf - 2;
            _v.x = THREE.MathUtils.clamp(_v.x, -s, s); _v.z = THREE.MathUtils.clamp(_v.z, -s, s);
            this.setGoal(_v.clone());
          }
        }
        return;
      }
      const want = T.key === 'blaster' ? 4.5 : T.range * 0.7;
      const clear = T.key === 'bomber' || A.los(b.pos.x, b.pos.z, best.pos.x, best.pos.z);
      if (d > want + 2 || !clear) { this.mode = 'chase'; this.setGoal(best.pos.clone()); }
      else { this.mode = 'strafe'; this.path.length = 0; this.hasGoal = false; }
      this.want = want;
      return;
    }

    // Loot: nearest power cube, then nearest crate.
    let item = null, id = 24 * H.loot;
    for (const it of g.items) {
      const d = Math.hypot(it.x - b.pos.x, it.z - b.pos.z);
      if (d < id) { id = d; item = it; }
    }
    if (item) { this.mode = 'loot'; this.setGoal(_v.set(item.x, 0, item.z).clone()); return; }

    let crate = null, cd = 30;
    for (const c of A.crates.values()) {
      const d = c.group.position.distanceTo(b.pos);
      if (d < cd) { cd = d; crate = c; }
    }
    if (crate) {
      this.crate = crate;
      this.mode = 'crate';
      const cp = crate.group.position;
      if (cd > T.range * 0.7 || !A.los(b.pos.x, b.pos.z, cp.x, cp.z, 1.1)) this.setGoal(cp.clone());
      else { this.path.length = 0; this.hasGoal = false; }
      return;
    }

    this.mode = 'wander';
    // campers settle in the nearest safe bush and wait there
    if (H.camp && !this.hasGoal) {
      const ci = A.toTile(b.pos.x), cj = A.toTile(b.pos.z);
      let bush = null, bd = 99;
      for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
        const i = ci + di, j = cj + dj;
        if (A.get(i, j) !== 'B' || A.ring(i, j) <= P.level + 2) continue;
        if (Math.hypot(di, dj) < bd) { bd = Math.hypot(di, dj); bush = [i, j]; }
      }
      if (bush && bd > 0.5) { this.setGoal(A.center(bush[0], bush[1]), true); return; }
      if (bush) { this.path.length = 0; return; }
    }
    if (!this.hasGoal || !this.path.length) {
      const [i, j] = A.randomOpenTile(Math.max(2, P.level + 2));
      this.setGoal(A.center(i, j), true);
    }
  }

  update(dt) {
    const g = this.g, b = this.b, A = g.arena;
    if (!b.alive) { b.moveIntent.set(0, 0, 0); return; }
    this.think -= dt; this.fireCd -= dt; this.strafeT -= dt; this.repath -= dt;
    if (this.target && !this.target.alive) this.target = null;
    if (this.think <= 0) { this.think = 0.22 + Math.random() * 0.15; this.decide(); }

    const move = b.moveIntent.set(0, 0, 0);
    if (this.mode === 'strafe' && this.target) {
      const tx = this.target.pos.x - b.pos.x, tz = this.target.pos.z - b.pos.z;
      const d = Math.hypot(tx, tz) + 1e-4;
      if (this.strafeT <= 0) { this.strafeT = 0.5 + Math.random() * 1.3; if (Math.random() < 0.6) this.strafeDir *= -1; }
      const radial = THREE.MathUtils.clamp((d - this.want) / 2.5, -1, 1);
      const side = 0.35 + this.skill * 0.6; // sharp bots dodge sideways, clumsy ones mostly stand and shoot
      move.set(-tz / d * this.strafeDir * side + tx / d * radial, 0, tx / d * this.strafeDir * side + tz / d * radial);
      if (A.blocksMoveAt(b.pos.x + move.x * 1.2, b.pos.z + move.z * 1.2)) { this.strafeDir *= -1; move.x *= -1; move.z *= -1; }
    } else if (this.path.length) {
      while (this.path.length && Math.hypot(this.path[0].x - b.pos.x, this.path[0].z - b.pos.z) < 0.6) this.path.shift();
      while (this.path.length > 1 && A.walkLine(b.pos.x, b.pos.z, this.path[1].x, this.path[1].z, 0.6)) this.path.shift();
      if (this.path.length) move.set(this.path[0].x - b.pos.x, 0, this.path[0].z - b.pos.z);
      else this.hasGoal = false;
    }
    this.dodge(dt, move);
    // separation from other brawlers
    for (const o of g.brawlers) {
      if (o === b || !o.alive) continue;
      const dx = b.pos.x - o.pos.x, dz = b.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 2.5 && d2 > 1e-4) { const d = Math.sqrt(d2); move.x += dx / d * 0.6; move.z += dz / d * 0.6; }
    }
    if (move.lengthSq() > 1e-4) move.normalize();

    // stuck detection -> force repath
    if (move.lengthSq() > 0.5 && b.pos.distanceTo(this.last) < 0.02) {
      this.stuck += dt;
      if (this.stuck > 0.6 && this.hasGoal) { this.stuck = 0; this.setGoal(this.goal, true); }
    } else this.stuck = 0;
    this.last.copy(b.pos);

    this.shoot(dt);
    this.gadget(dt);
  }

  // Bots 2.0: sidestep a bullet about to hit (sharp bots most of the time, clumsy ones rarely),
  // and walk out of lava puddles and zap traps.
  dodge(dt, move) {
    const g = this.g, b = this.b;
    this.dodgeT -= dt;
    if (this.dodgeT > 0) { move.x += this.dodgeX * 1.6; move.z += this.dodgeZ * 1.6; return; }
    for (const B of g.combat.bullets) {
      if (B.owner === b || B.dodgeSeen?.has(b)) continue;
      const rx = b.pos.x - B.x, rz = b.pos.z - B.z, along = rx * B.dx + rz * B.dz;
      if (along < 0 || along > 6) continue;
      const side = rx * -B.dz + rz * B.dx; // signed distance off the bullet's line
      if (Math.abs(side) > b.radius + B.r + 0.4) continue;
      (B.dodgeSeen ||= new Set()).add(b);
      if (Math.random() > this.skill * 0.8) continue;
      const s = side >= 0 ? 1 : -1;
      this.dodgeX = -B.dz * s; this.dodgeZ = B.dx * s; this.dodgeT = 0.25;
      return;
    }
    for (const Z of g.combat.zones) {
      if (Z.owner === b) continue;
      const dx = b.pos.x - Z.x, dz = b.pos.z - Z.z, d = Math.hypot(dx, dz);
      if (d < Z.r + 1 && d > 1e-3) { move.x += dx / d * 1.5; move.z += dz / d * 1.5; }
    }
    // arena events (events.js): step out of a telegraph, the sharper the sooner
    for (const W of g.events.warns) {
      if (W.t > 0.4 + this.skill * 0.9) continue;
      const dx = b.pos.x - W.x, dz = b.pos.z - W.z, d = Math.hypot(dx, dz);
      if (d < 2.4 && d > 1e-3) { move.x += dx / d * 2; move.z += dz / d * 2; }
    }
  }

  // A knock-out of ours: a line, and the show-off emotes.
  onKo() {
    const g = this.g, b = this.b;
    if (Math.random() < 0.6) g.bark(b, 'ko');
    if (this.habits.show || Math.random() < 0.15) g.later.push([g.time + 0.5, () => g.emote(b, [0, 3, 4, 10][Math.floor(Math.random() * 4)])]);
  }

  // Someone emoted where we can see: answer now and then (with a GG, a wave, a laugh...).
  heardEmote(from, i) {
    if (Math.random() > (this.habits.show ? 0.7 : 0.3)) return;
    const reply = [0, 1, 2, 3, 5, 10][Math.floor(Math.random() * 6)];
    this.g.later.push([this.g.time + 0.7 + Math.random() * 0.9, () => { if (this.b.alive && from.alive) this.g.emote(this.b, reply); }]);
  }

  // Super: per brawler, when it pays off (a cluster, a finisher, point-blank...).
  superGood(tgt, d) {
    const g = this.g, T = this.b.type.key, low = tgt.hp < tgt.maxHp * 0.45;
    if (this.habits.show && Math.random() < 0.5) return true;
    const near = (p, r) => g.brawlers.filter(o => o !== this.b && o.alive && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < r).length;
    if (T === 'frostbite') return near(this.b.pos, 4.5) >= 1;
    if (T === 'blaster') return d < 6;
    if (T === 'volt') return near(tgt.pos, 3) >= 2 || low;
    if (T === 'bomber') return low || tgt.inBush || !g.arena.los(this.b.pos.x, this.b.pos.z, tgt.pos.x, tgt.pos.z) || near(tgt.pos, 3.6) >= 2;
    return low || d < this.b.type.range * 0.6; // gunslinger: finisher or a sure hit
  }

  // When to use the gadget (Kit 2.0): mobility to escape when hurt or to close in, utility in a fight.
  gadget(dt) {
    const g = this.g, b = this.b, o = this.target;
    if ((this.gadgetThink -= dt) > 0 || !g.canGadget(b) || !o || !o.alive) return;
    this.gadgetThink = 0.5 + Math.random() * (1.2 - this.skill);
    const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 1, hurt = b.hp < b.maxHp * 0.4;
    const k = b.type.key + b.gadget, ux = dx / d, uz = dz / d;
    let use = null; // [dx, dz]
    if (b.gadget === 'A') {
      if (hurt && d < 7) use = [-ux, -uz];                                                        // get away
      else if (!hurt && (k === 'blasterA' ? d < 5 : d > b.type.range * 0.85 && d < b.type.range + 4)) use = [ux, uz]; // close in
    } else if (k === 'blasterB') { if (d < 6 && b.lastHurt > g.time - 1) use = [ux, uz]; }
    else if (k === 'gunslingerB') { if (o.inBush && o.revealT <= 0 && d < 16) use = [ux, uz]; }
    else if (k === 'bomberB') { if (d < b.type.range && b.ammo >= 1) use = [ux, uz]; }
    else if (k === 'frostbiteB') { if (hurt && d > 3 && d < 9) use = [ux, uz]; }
    else if (k === 'voltB') { if (b.ammo < 1 && d < b.type.range) use = [ux, uz]; }
    if (use && Math.random() < 0.35 + this.skill * 0.5) g.useGadget(b, use[0], use[1], o.pos);
  }

  shoot(dt) {
    const g = this.g, b = this.b, T = b.type, A = g.arena, tgt = this.target;
    if (tgt) {
      this.seen += dt;
      const d = tgt.pos.distanceTo(b.pos);
      const range = T.key === 'blaster' ? 8.6 : T.range * 0.95;
      if (d > range || this.seen < 1.3 - this.skill * 1.0) return; // reaction time: ~1.2 s .. 0.3 s
      if (T.key !== 'bomber' && !A.los(b.pos.x, b.pos.z, tgt.pos.x, tgt.pos.z)) return;
      const travel = d / T.projSpeed;
      const lead = this.skill * this.skill * 1.0;                          // clumsy bots aim where you are
      const err = (0.5 * (1 - this.skill) ** 1.5 + 0.04) * gauss();      // radians: ~0.4 (clumsy) .. 0.05 (sharp)
      let px = tgt.pos.x + tgt.vel.x * travel * lead, pz = tgt.pos.z + tgt.vel.z * travel * lead;
      let dx = px - b.pos.x, dz = pz - b.pos.z;
      const a = Math.atan2(dx, dz) + err, l = Math.hypot(dx, dz);
      dx = Math.sin(a) * l; dz = Math.cos(a) * l;
      const point = _v.set(b.pos.x + dx, 0, b.pos.z + dz);
      const superRange = T.key === 'frostbite' ? 4.5 : range * 0.9;
      if (b.superCharge >= 1 && d < superRange && this.superGood(tgt, d) && Math.random() < 0.35 + this.skill * 0.5) {
        g.tryAttack(b, dx, dz, point, true);
      } else if (this.fireCd <= 0 && b.ammo >= 1) {
        if (g.tryAttack(b, dx, dz, point, false)) this.fireCd = 0.45 + Math.random() * 1.5 * (1.25 - this.skill);
      }
    } else if (this.crate && this.fireCd <= 0 && b.ammo >= 2) {
      const cp = this.crate.group.position, d = cp.distanceTo(b.pos);
      // opening grace: no crate shots that could hit someone standing in the way or next to it; spread
      // weapons (Blaster pellets, Frostbite's side shards) can miss the crate and fly on to full range
      if (g.time < this.graceUntil && g.brawlers.some(o => o !== b && o.alive && (segDist(o.pos, b.pos, cp) < 2.4 || inFan(b, cp, o)))) return;
      if (d < T.range * 0.9 && (T.key === 'bomber' || A.los(b.pos.x, b.pos.z, cp.x, cp.z, 1.1))) {
        if (g.tryAttack(b, cp.x - b.pos.x, cp.z - b.pos.z, cp, false)) this.fireCd = 0.5 + Math.random() * 0.5;
      }
    }
  }
}
