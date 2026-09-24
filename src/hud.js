import * as THREE from 'three';
import { t } from './i18n/index.js';

const $ = s => document.querySelector(s);
const _v = new THREE.Vector3();

export class Hud {
  constructor() {
    this.root = $('#hud');
    this.bars = $('#bars');
    this.floaters = $('#floaters');
    this.aliveEl = $('#aliveCount');
    this.poisonEl = $('#poisonTime');
    this.poisonPill = $('#poisonPill');
    this.superArc = $('#superArc');
    this.superEl = $('#super');
    this.cubeEl = $('#cubeCount');
    this.vignette = $('#vignette');
    this.items = new Map();
    this.lastAlive = -1;
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setup(brawlers, player) {
    this.bars.innerHTML = '';
    this.items.clear();
    for (const b of brawlers) {
      const el = document.createElement('div');
      el.className = 'ov ' + (b === player ? 'me' : 'foe');
      el.innerHTML = `
        <div class="ov-name">${b === player ? t('hud.you') : b.name}<span class="ov-cubes"></span></div>
        <div class="ov-hp"><div class="ov-lag"></div><div class="ov-fill"></div><span class="ov-num"></span></div>
        ${b === player ? '<div class="ov-ammo"><i><b></b></i><i><b></b></i><i><b></b></i></div>' : ''}`;
      this.bars.appendChild(el);
      this.items.set(b, {
        el, fill: el.querySelector('.ov-fill'), lag: el.querySelector('.ov-lag'), num: el.querySelector('.ov-num'),
        cubes: el.querySelector('.ov-cubes'), ammo: [...el.querySelectorAll('.ov-ammo b')],
        shown: true, lagV: 1, lastHp: -1, lastCubes: -1, lastT: '',
      });
    }
  }

  update(dt, camera, game) {
    const w = innerWidth, h = innerHeight;
    for (const [b, o] of this.items) {
      const vis = b.alive && b.visibleToPlayer;
      if (vis !== o.shown) { o.el.style.display = vis ? '' : 'none'; o.shown = vis; }
      if (!vis) continue;
      _v.set(b.pos.x, 3.05, b.pos.z).project(camera);
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const t = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
      if (t !== o.lastT) { o.el.style.transform = t; o.lastT = t; }
      const f = Math.max(0, b.hp / b.maxHp);
      o.lagV = Math.max(f, o.lagV - dt * 0.6);
      if (o.lagV < f) o.lagV = f;
      const hp = Math.ceil(b.hp);
      if (hp !== o.lastHp) {
        o.fill.style.width = (f * 100).toFixed(1) + '%';
        o.num.textContent = hp;
        o.lastHp = hp;
      }
      o.lag.style.width = (o.lagV * 100).toFixed(1) + '%';
      if (b.cubes !== o.lastCubes) { o.cubes.textContent = b.cubes ? ` ◆${b.cubes}` : ''; o.lastCubes = b.cubes; }
      for (let k = 0; k < o.ammo.length; k++) {
        o.ammo[k].style.width = (Math.min(1, Math.max(0, b.ammo - k)) * 100).toFixed(0) + '%';
      }
      o.el.classList.toggle('hidden-bush', b.inBush);
    }

    const alive = game.brawlers.filter(b => b.alive).length;
    if (alive !== this.lastAlive) { this.aliveEl.textContent = alive; this.lastAlive = alive; }
    const P = game.poison;
    if (P) {
      const n = P.nextIn;
      this.poisonPill.classList.toggle('warn', n < 6 && n > 0);
      this.poisonEl.textContent = n === Infinity ? t('hud.max') : `${Math.floor(Math.max(0, n) / 60)}:${String(Math.ceil(Math.max(0, n)) % 60).padStart(2, '0')}`;
      this.poisonPill.querySelector('small').textContent = P.level === 0 ? t('hud.gasIn') : t('hud.gasGrows');
    }
    const p = game.player;
    if (p) {
      const c = 2 * Math.PI * 44;
      this.superArc.style.strokeDasharray = `${c * p.superCharge} ${c}`;
      this.superEl.classList.toggle('ready', p.superCharge >= 1);
      this.cubeEl.textContent = p.cubes;
      this.vignette.style.opacity = p.alive && p.inPoison ? '1' : '0';
    }
  }

  floater(camera, x, y, z, text, cls) {
    _v.set(x, y, z).project(camera);
    if (_v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'floater ' + cls;
    el.textContent = text;
    el.style.left = ((_v.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30) + 'px';
    el.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px';
    this.floaters.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
}
