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
    this.skill = 0.45 + Math.random() * 0.4;
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
    for (const o of g.brawlers) {
      if (o === b || !o.alive) continue;
      const d = o.pos.distanceTo(b.pos);
      if (d > 20 || !g.canSee(b, o)) continue;
      const s = d + (o.hp / o.maxHp) * 4 - (o === this.target ? 2 : 0);
      if (s < bestS) { bestS = s; best = o; }
    }
    if (best !== this.target) this.seen = 0;
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
      if (hpF < 0.3 && best.hp > b.hp && d < T.range * 1.3) {
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
      move.set(-tz / d * this.strafeDir * 0.85 + tx / d * radial, 0, tx / d * this.strafeDir * 0.85 + tz / d * radial);
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
      if (d > range || this.seen < 0.9 - this.skill * 0.45) return;
      if (T.key !== 'bomber' && !A.los(b.pos.x, b.pos.z, tgt.pos.x, tgt.pos.z)) return;
      const travel = d / T.projSpeed;
      const lead = 0.25 + this.skill * 0.6;
      const err = (0.26 * (1 - this.skill) + 0.06) * gauss();
      let px = tgt.pos.x + tgt.vel.x * travel * lead, pz = tgt.pos.z + tgt.vel.z * travel * lead;
      let dx = px - b.pos.x, dz = pz - b.pos.z;
      const a = Math.atan2(dx, dz) + err, l = Math.hypot(dx, dz);
      dx = Math.sin(a) * l; dz = Math.cos(a) * l;
      const point = _v.set(b.pos.x + dx, 0, b.pos.z + dz);
      const superRange = T.key === 'frostbite' ? 4.5 : range * 0.9;
      if (b.superCharge >= 1 && d < superRange && Math.random() < 0.5) {
        g.tryAttack(b, dx, dz, point, true);
      } else if (this.fireCd <= 0 && b.ammo >= 1) {
        if (g.tryAttack(b, dx, dz, point, false)) this.fireCd = 0.55 + Math.random() * 1.1 * (1.3 - this.skill);
      }
    } else if (this.crate && this.fireCd <= 0 && b.ammo >= 2) {
      const cp = this.crate.group.position, d = cp.distanceTo(b.pos);
      if (d < T.range * 0.9 && (T.key === 'bomber' || A.los(b.pos.x, b.pos.z, cp.x, cp.z, 1.1))) {
        if (g.tryAttack(b, cp.x - b.pos.x, cp.z - b.pos.z, cp, false)) this.fireCd = 0.5 + Math.random() * 0.5;
      }
    }
  }
}
