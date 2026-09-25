import * as THREE from 'three';
import { t } from './i18n/index.js';
import { sfx } from './audio.js';

const $ = s => document.querySelector(s);
const _v = new THREE.Vector3();
const BASE = import.meta.env?.BASE_URL ?? '/';
const FEED_MAX = 4, FEED_LIFE = 4500;

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
    this.merge = new Map(); // counting damage numbers: 'source>target' -> { el, total, t }
    // kill feed (top right), K.O. stamps and the "3 LEFT" / "FINAL DUEL" banners
    this.feed = document.createElement('div');
    this.feed.id = 'killfeed';
    this.banner = document.createElement('div');
    this.banner.id = 'banner';
    this.lowEl = document.createElement('div');
    this.lowEl.id = 'lowhp';
    this.root.append(this.feed, this.banner, this.lowEl);
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setup(brawlers, player) {
    this.bars.innerHTML = '';
    this.items.clear();
    this.feed.innerHTML = '';
    this.banner.className = '';
    this.merge.clear();
    this.play = !!player;
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
      const regen = b.regen && b.hp < b.maxHp;
      if (regen !== o.regen) { o.el.classList.toggle('regen', regen); o.regen = regen; } // healing: the bar glows
    }

    const alive = game.brawlers.filter(b => b.alive).length;
    if (alive !== this.lastAlive) {
      if (this.play && !game.ended && alive < this.lastAlive) {
        if (alive === 3) { this.showBanner(t('hud.threeLeft'), 'three'); sfx('sting_three'); }
        else if (alive === 2) { this.showBanner(t('hud.finalDuel'), 'duel'); sfx('sting_duel'); }
      }
      this.aliveEl.textContent = alive;
      this.lastAlive = alive;
    }
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
      const low = p.alive && !game.ended && p.hp / p.maxHp < 0.3;
      if (low !== this.low) { this.lowEl.classList.toggle('on', low); this.low = low; }
      if (low) this.lowEl.style.animationDuration = p.hp / p.maxHp < 0.15 ? '0.6s' : '0.85s';
    }
  }

  // key: hits with the same key within 0.32 s add up into one number that counts up and pops again
  floater(camera, x, y, z, text, cls, key = null) {
    _v.set(x, y, z).project(camera);
    if (_v.z > 1) return;
    const now = performance.now(), m = key && this.merge.get(key);
    if (m && now - m.t < 320 && m.el.isConnected) {
      m.total += +text; m.t = now; m.hits++;
      m.el.textContent = m.total;
      m.el.classList.toggle('big', m.hits >= 3);
      m.el.style.animation = 'none';
      void m.el.offsetWidth; // restart the pop
      m.el.style.animation = '';
      return;
    }
    const el = document.createElement('div');
    el.className = 'floater ' + cls;
    el.textContent = text;
    el.style.left = ((_v.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30) + 'px';
    el.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px';
    el.addEventListener('animationend', () => el.remove());
    this.floaters.appendChild(el);
    if (key) this.merge.set(key, { el, total: +text, t: now, hits: 1 });
  }

  // A K.O. stamp where your victim fell.
  koStamp(camera, x, z) {
    _v.set(x, 1.6, z).project(camera);
    if (_v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'ko-stamp';
    el.textContent = t('hud.ko');
    el.style.left = ((_v.x * 0.5 + 0.5) * innerWidth) + 'px';
    el.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px';
    el.addEventListener('animationend', () => el.remove());
    this.floaters.appendChild(el);
  }

  // Who knocked out whom (killer null: the gas).
  killFeed(killer, victim, player, sup) {
    const who = b => b === player ? t('hud.you') : b.name;
    const face = b => `<img src="${BASE}assets/ui/${b.type.key}.png" alt="" />`;
    const row = document.createElement('div');
    row.className = 'kf' + (killer === player ? ' mine' : victim === player ? ' me' : '');
    const name = document.createElement('b'), vname = document.createElement('b');
    name.textContent = killer ? who(killer) : '';
    vname.textContent = who(victim);
    row.innerHTML = `${killer ? face(killer) : '<i class="kf-gas"></i>'}<span class="kf-icon">${sup ? '✦' : '✖'}</span>${face(victim)}`;
    if (killer) row.insertBefore(name, row.firstChild);
    row.append(vname);
    this.feed.prepend(row);
    while (this.feed.children.length > FEED_MAX) this.feed.lastChild.remove();
    setTimeout(() => row.classList.add('out'), FEED_LIFE);
    setTimeout(() => row.remove(), FEED_LIFE + 500);
  }

  showBanner(text, kind) {
    this.banner.textContent = text;
    this.banner.className = '';
    void this.banner.offsetWidth;
    this.banner.className = 'on ' + kind;
  }
}
