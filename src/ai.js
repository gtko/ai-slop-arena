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
  if (d > b.type.range + 1.5) return false;
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
    this.seen = 0;
    // 0 (clumsy) .. 1 (sharp): from the roster (makeRoster, set from the players' level), else random.
    this.skill = bot.skill ?? 0.45 + Math.random() * 0.4;
    // Opening grace: for the first seconds of a match bots loot instead of hunting, so nobody gets
    // jumped at spawn. They still fight back if hit. Staggered so they do not all wake up at once.
    this.graceUntil = 7 + Math.random() * 4;
    this.crate = null;
    this.stuck = 0;
    this.last = bot.pos.clone();
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
    const sight = 13 + this.skill * 9; // sharper bots notice targets from further away
    for (const o of g.brawlers) {
      if (calm || o === b || !o.alive) continue;
      const d = o.pos.distanceTo(b.pos);
      // A target that just ducked behind a wall is remembered for a moment (not one hiding in a bush).
      const seen = g.canSee(b, o);
      if (seen && o === this.target) this.seenAt = g.time;
      const recall = o === this.target && g.time - (this.seenAt || 0) < 2.5 && !(o.inBush && o.revealT <= 0);
      if (d > sight || !(seen || recall)) continue;
      const s = d + (o.hp / o.maxHp) * 4 - (o === this.target ? 2 : 0);
      if (s < bestS) { bestS = s; best = o; }
    }
    if (best !== this.target) { this.seen = 0; this.seenAt = g.time; } // memory starts with the new target
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
      if (this.skill > 0.3 && hpF < 0.3 && best.hp > b.hp && d < T.range * 1.3) { // clumsy bots never back off
        this.mode = 'retreat';
        _v.subVectors(b.pos, best.pos).setY(0).normalize().multiplyScalar(9).add(b.pos);
        const s = P.safeHalf - 2;
        _v.x = THREE.MathUtils.clamp(_v.x, -s, s); _v.z = THREE.MathUtils.clamp(_v.z, -s, s);
        this.setGoal(_v.clone());
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
    let item = null, id = 24;
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
      if (b.superCharge >= 1 && d < superRange && Math.random() < 0.2 + this.skill * 0.5) {
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
