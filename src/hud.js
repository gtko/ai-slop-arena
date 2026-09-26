import * as THREE from 'three';
import { t } from './i18n/index.js';
import { sfx } from './audio.js';
import { GADGET_LOCKOUT, GADGET_ICONS } from './gadgets.js';
import { PERSONA_ICONS } from './ai.js';
import { MUT_ICONS } from './mutators.js';

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
    this.gadgetEl = $('#gadget');
    this.gadgetArc = $('#gadgetArc');
    this.gadgetIcon = $('#gadgetIcon');
    this.gadgetPips = [...document.querySelectorAll('#gadget u')];
    this.vignette = $('#vignette');
    const mh = this.myhp = $('#myhp');
    this.mh = { fill: mh.querySelector('.mh-fill'), lag: mh.querySelector('.mh-lag'), num: mh.querySelector('.mh-num'), ammo: [...mh.querySelectorAll('.mh-ammo b')], lagV: 1, hp: -1, cls: '' };
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
    this.hurtEl = document.createElement('div');
    this.hurtEl.id = 'hurt';
    this.dpsEl = document.createElement('div');
    this.dpsEl.id = 'dps';
    // Duo (v0.14): your partner's card (health, knock-out, revive), the revive hearts, an arrow to
    // your partner when off screen, and the pings
    this.team = document.createElement('div');
    this.team.id = 'teamCard';
    this.mateArrow = document.createElement('div');
    this.mateArrow.id = 'mateArrow';
    this.pingsEl = document.createElement('div');
    this.pingsEl.id = 'pings';
    this.ghostEl = document.createElement('div'); // you are knocked out: how long your partner has to revive you
    this.ghostEl.id = 'ghostMsg';
    this.root.append(this.feed, this.banner, this.lowEl, this.hurtEl, this.dpsEl, this.team, this.mateArrow, this.pingsEl, this.ghostEl);
    this.pings = [];
  }

  // A ping marker (game.js pingFx): an icon over the spot for 4 s, kept on screen at the edge.
  ping(x, z, icon, who, kind) {
    if (!this.live) return;
    const el = document.createElement('div');
    el.className = `ping ${who} ${kind}`;
    el.innerHTML = `<b>${icon}</b>`;
    this.pingsEl.appendChild(el);
    this.pings.push({ x, z, el, t: 4 });
    while (this.pings.length > 4) this.pings.shift().el.remove();
  }

  setupTeam(game) {
    const P = game.player, m = game.duo ? game.mateOf(P) : null;
    this.mate = m;
    this.team.classList.toggle('hidden', !m);
    this.mateArrow.className = 'hidden';
    this.pings.forEach(p => p.el.remove());
    this.pings = [];
    if (!m) return;
    this.team.innerHTML = `<img src="${BASE}assets/ui/${m.type.key}.png" alt="" /><div><b class="tc-name"></b><div class="tc-hp"><i></i></div><small class="tc-st"></small></div><span class="tc-hearts"></span>`;
    this.team.querySelector('.tc-name').textContent = m.name;
    this.tc = { hp: this.team.querySelector('.tc-hp i'), st: this.team.querySelector('.tc-st'), hearts: this.team.querySelector('.tc-hearts'), key: '' };
  }

  updateTeam(dt, camera, game) {
    const m = this.mate, P = game.player;
    for (let k = this.pings.length - 1; k >= 0; k--) {
      const p = this.pings[k];
      if ((p.t -= dt) <= 0) { p.el.remove(); this.pings.splice(k, 1); continue; }
      this.edge(camera, p.x, 1.2, p.z, p.el, 40);
      p.el.style.opacity = Math.min(1, p.t / 0.5).toFixed(2);
    }
    const MG = P && !P.alive && game.duo ? game.ghostOf(P) : null;
    const gm = MG ? (MG.p > 0 ? t('hud.beingRevived', { n: Math.round(MG.p / 3 * 100) }) : t('hud.youGhost', { n: Math.ceil(Math.max(0, MG.t)) })) : '';
    if (gm !== this.ghostTxt) { this.ghostTxt = gm; this.ghostEl.textContent = gm; this.ghostEl.classList.toggle('on', !!gm); }
    if (!m || !P) return;
    const G = !m.alive ? game.ghostOf(m) : null;
    const f = m.alive ? Math.max(0, m.hp / m.maxHp) : 0;
    const st = m.alive ? '' : G ? (G.p > 0 ? t('hud.reviving', { n: Math.round(G.p / 3 * 100) }) : t('hud.ghost', { n: Math.ceil(Math.max(0, G.t)) })) : t('hud.mateOut');
    const hearts = game.revives[m.team] ?? 0;
    const key = `${f.toFixed(3)}|${st}|${hearts}`;
    if (key !== this.tc.key) {
      this.tc.key = key;
      this.tc.hp.style.width = (f * 100).toFixed(1) + '%';
      this.tc.hp.className = f < 0.3 ? 'low' : '';
      this.tc.st.textContent = st;
      this.tc.hearts.innerHTML = '<i>♥</i>'.repeat(hearts) + '<i class="off">♥</i>'.repeat(Math.max(0, 2 - hearts));
      this.tc.hearts.title = t('hud.revivesLeft', { n: hearts });
      this.team.classList.toggle('down', !m.alive);
    }
    // off screen: an arrow at the edge toward your partner (or its ghost)
    const tx = m.alive ? m.pos.x : G ? G.x : null, tz = m.alive ? m.pos.z : G ? G.z : null;
    if (tx === null || !P.alive) { this.mateArrow.className = 'hidden'; return; }
    const off = this.edge(camera, tx, 1.6, tz, this.mateArrow, 46, true);
    this.mateArrow.className = off ? (G ? 'ghost' : '') : 'hidden';
  }

  // Place el over a world point, clamped inside the screen edges; arrow: rotate it toward the point.
  // Returns whether the point is off screen.
  edge(camera, x, y, z, el, pad, arrow = false) {
    _v.set(x, y, z).project(camera);
    const w = innerWidth, h = innerHeight, behind = _v.z > 1;
    let sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
    if (behind) { sx = w - sx; sy = h - sy; }
    const off = behind || sx < pad || sx > w - pad || sy < pad || sy > h - pad;
    const cx = Math.min(w - pad, Math.max(pad, sx)), cy = Math.min(h - pad, Math.max(pad, sy));
    const rot = arrow ? ` rotate(${Math.atan2(sy - h / 2, sx - w / 2).toFixed(3)}rad)` : '';
    el.style.transform = `translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px) translate(-50%,-50%)${rot}`;
    el.classList.toggle('edge', off);
    return off;
  }

  show(on) { this.root.classList.toggle('hidden', !on); }
  // "BRAWLERS LEFT" or, in Duo, "TEAMS LEFT"
  setLeftLabel(duo) {
    const el = this.aliveEl.nextElementSibling;
    if (el) el.textContent = t(duo ? 'hud.teamsLeft' : 'hud.left');
    document.body.classList.toggle('duo', !!duo);
  }

  // Weekly Chaos: a pill at the top while it runs, and a title card when the match starts.
  setMutator(m) {
    if (!this.mutPill) {
      this.mutPill = document.createElement('div');
      this.mutPill.className = 'pill mut-pill';
      $('#top').appendChild(this.mutPill);
      this.card = document.createElement('div');
      this.card.id = 'chaosCard';
      this.root.appendChild(this.card);
    }
    this.mutator = m;
    this.mutPill.classList.toggle('hidden', !m);
    this.card.className = '';
    if (m) this.mutPill.innerHTML = `<b>${MUT_ICONS[m]}</b><small>${t('mut.' + m)}</small>`;
  }
  titleCard() {
    const m = this.mutator;
    if (!m || !this.card) return;
    this.card.innerHTML = `<small>🌀 ${t('chaos.name')}</small><i>${MUT_ICONS[m]}</i><b>${t('mut.' + m)}</b><p>${t('mut.' + m + '.desc')}</p>`;
    this.card.className = '';
    void this.card.offsetWidth;
    this.card.className = 'on';
    sfx('chaos');
  }
  get live() { return this.play && !this.root.classList.contains('hidden'); }

  setup(brawlers, player) {
    this.bars.innerHTML = '';
    this.items.clear();
    this.feed.innerHTML = '';
    this.banner.className = '';
    this.merge.clear();
    this.floaters.innerHTML = '';
    Object.assign(this.mh, { lagV: 1, hp: -1, cls: '_' });
    this.play = !!player;
    for (const b of brawlers) {
      const el = document.createElement('div');
      el.className = 'ov ' + (b === player ? 'me' : b.g.ally(b, player) ? 'mate' : 'foe');
      el.innerHTML = `
        <div class="ov-bubble"></div>
        <div class="ov-name">${b === player ? t('hud.you') : (b.persona ? PERSONA_ICONS[b.persona] + ' ' : '') + b.name}<span class="ov-cubes"></span></div>
        <div class="ov-hp"><div class="ov-lag"></div><div class="ov-fill"></div><span class="ov-num"></span></div>
        ${b === player ? '<div class="ov-ammo"><i><b></b></i><i><b></b></i><i><b></b></i></div>' : ''}`;
      this.bars.appendChild(el);
      this.items.set(b, {
        el, fill: el.querySelector('.ov-fill'), lag: el.querySelector('.ov-lag'), num: el.querySelector('.ov-num'),
        cubes: el.querySelector('.ov-cubes'), ammo: [...el.querySelectorAll('.ov-ammo b')], bubble: el.querySelector('.ov-bubble'), bubbleT: 0,
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
      const crown = b === game.crown;
      if (b.cubes !== o.lastCubes || crown !== o.crown) { o.cubes.textContent = (b.cubes ? ` ◆${b.cubes}` : '') + (crown ? ' 👑' : ''); o.lastCubes = b.cubes; o.crown = crown; }
      for (let k = 0; k < o.ammo.length; k++) {
        o.ammo[k].style.width = (Math.min(1, Math.max(0, b.ammo - k)) * 100).toFixed(0) + '%';
      }
      o.el.classList.toggle('hidden-bush', b.inBush);
      if (o.bubbleT > 0 && (o.bubbleT -= dt) <= 0) o.bubble.className = 'ov-bubble';
      const regen = b.regen && b.hp < b.maxHp;
      if (regen !== o.regen) { o.el.classList.toggle('regen', regen); o.regen = regen; } // healing: the bar glows
    }

    this.dpsEl.style.display = game.dojo ? '' : 'none';
    if (game.dojo) { const v = game.dojoDps; if (v !== this.lastDps) { this.dpsEl.innerHTML = `<b>${v}</b><small>${t('hud.dps')}</small><p>${t('hud.dojoHint')}</p>`; this.lastDps = v; } }

    this.updateTeam(dt, camera, game);
    const alive = game.duo ? game.teamsUp() : game.brawlers.filter(b => b.alive).length; // Duo: teams left
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
      this.poisonPill.style.display = game.dojo ? 'none' : '';
      this.poisonPill.classList.toggle('warn', n < 6 && n > 0);
      this.poisonEl.textContent = n === Infinity ? t('hud.max') : `${Math.floor(Math.max(0, n) / 60)}:${String(Math.ceil(Math.max(0, n)) % 60).padStart(2, '0')}`;
      this.poisonPill.querySelector('small').textContent = P.level === 0 ? t('hud.gasIn') : t('hud.gasGrows');
    }
    const p = game.player;
    if (p) {
      const c = 2 * Math.PI * 44;
      this.superArc.style.strokeDasharray = `${c * p.superCharge} ${c}`;
      this.superEl.classList.toggle('ready', p.superCharge >= 1);
      // gadget: its icon, 3 charge pips, the lockout ring filling back up
      const ic = GADGET_ICONS[p.type.key + p.gadget] || '✦';
      if (this.gadgetIcon.textContent !== ic) this.gadgetIcon.textContent = ic;
      const cd = Math.max(0, p.gadgetCd) / (game.gadgetLockout || GADGET_LOCKOUT), c2 = 2 * Math.PI * 44;
      this.gadgetArc.style.strokeDasharray = `${c2 * (1 - cd)} ${c2}`;
      this.gadgetEl.classList.toggle('ready', p.alive && p.gadgetCharges > 0 && cd <= 0);
      this.gadgetEl.classList.toggle('empty', p.gadgetCharges <= 0);
      for (let k = 0; k < 3; k++) this.gadgetPips[k].classList.toggle('on', k < p.gadgetCharges);
      this.cubeEl.textContent = p.cubes;
      this.vignette.style.opacity = p.alive && p.inPoison ? '1' : '0';
      // big health bar, bottom centre
      const M = this.mh, f = Math.max(0, p.hp / p.maxHp), hp = Math.ceil(Math.max(0, p.hp));
      M.lagV = Math.max(f, M.lagV - dt * 0.6);
      if (hp !== M.hp) { M.fill.style.width = (f * 100).toFixed(1) + '%'; M.num.textContent = hp; M.hp = hp; }
      M.lag.style.width = (M.lagV * 100).toFixed(1) + '%';
      const cls = (p.alive ? '' : 'off ') + (f < 0.3 ? 'low' : f < 0.6 ? 'mid' : '') + (p.regen && f < 1 ? ' regen' : '');
      if (cls !== M.cls) { this.myhp.className = cls; M.cls = cls; }
      for (let k = 0; k < M.ammo.length; k++) M.ammo[k].style.width = (Math.min(1, Math.max(0, p.ammo - k)) * 100).toFixed(0) + '%';
      const low = p.alive && !game.ended && p.hp / p.maxHp < 0.3;
      if (low !== this.low) { this.lowEl.classList.toggle('on', low); this.low = low; }
      if (low) this.lowEl.style.animationDuration = p.hp / p.maxHp < 0.15 ? '0.6s' : '0.85s';
    }
  }

  // A speech bubble (bot barks) or an emote sticker over a brawler's name plate, for `time` seconds.
  say(b, text, kind, time) {
    const o = this.items.get(b);
    if (!o || !this.live) return;
    o.bubble.textContent = text;
    o.bubble.className = 'ov-bubble on ' + kind;
    o.bubbleT = time;
  }

  // key: hits with the same key within 0.32 s add up into one number that counts up and pops again
  floater(camera, x, y, z, text, cls, key = null) {
    if (!this.live) return;
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
    setTimeout(() => el.remove(), 3000); // in case the animation never runs
    this.floaters.appendChild(el);
    if (key) this.merge.set(key, { el, total: +text, t: now, hits: 1 });
  }

  // A K.O. stamp where your victim fell.
  koStamp(camera, x, z) {
    if (!this.live) return;
    _v.set(x, 1.6, z).project(camera);
    if (_v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'ko-stamp';
    el.textContent = t('hud.ko');
    el.style.left = ((_v.x * 0.5 + 0.5) * innerWidth) + 'px';
    el.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px';
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 3000);
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

  // Your super: your portrait slashes across the screen for half a second.
  superCutIn(key) {
    const el = document.createElement('div');
    el.className = 'cutin';
    el.innerHTML = `<i></i><img src="${BASE}assets/ui/${key}.png" alt="" />`;
    el.addEventListener('animationend', e => { if (e.target === el) el.remove(); });
    setTimeout(() => el.remove(), 1500);
    this.root.appendChild(el);
  }

  gadgetUsed() {
    this.gadgetEl.classList.remove('bump');
    void this.gadgetEl.offsetWidth;
    this.gadgetEl.classList.add('bump');
  }

  // Red edges for a blink when you take a hit, stronger for heavier hits.
  hurtFlash(strength) {
    const el = this.hurtEl;
    el.style.transition = 'none';
    el.style.opacity = Math.min(1, 0.35 + strength * 1.6).toFixed(2);
    void el.offsetWidth;
    el.style.transition = 'opacity 0.35s ease-out';
    el.style.opacity = '0';
  }

  showBanner(text, kind) {
    this.banner.textContent = text;
    this.banner.className = '';
    void this.banner.offsetWidth;
    this.banner.className = 'on ' + kind;
  }
}
