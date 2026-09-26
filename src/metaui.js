// Menus of the progression (v0.13 LEVEL UP): the profile bar, the quest board, the Trophy Road,
// the shop, the collection, and what the result screen shows after a match (XP, coins, trophies,
// quests, the level-up ceremony).

import { t } from './i18n/index.js';
import { sfx } from './audio.js';
import * as Pr from './profile.js';
import { board, reroll, resetIn, QUEST_ICONS } from './quests.js';
import { SKINS, RECOLOURS, TRAILS, TRAIL_ICONS, KOFX, KOFX_ICONS, EMOTES, EMOTE_ICONS, FRAMES, TITLES, ICONS, GOLD_AT,
  shopPool, priceOf, kindOf } from './cosmetics.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const coin = n => `<span class="coin-n"><i class="coin"></i>${n}</span>`;
const clock = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? t('meta.days', { n: Math.floor(m / 1440) }) : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };

// CSS filter that previews a recolour on a portrait (the figurine itself gets the real shader).
export function skinFilter(key, n) {
  if (SKINS[n] === 'gold') return 'sepia(1) saturate(3.2) hue-rotate(-12deg) brightness(1.08) contrast(1.1)';
  const R = RECOLOURS[key]?.[SKINS[n]];
  return R ? `hue-rotate(${R[0]}rad) saturate(${R[1]}) brightness(${R[2]})` : '';
}
// The picture of a profile icon: a brawler portrait or a sticker.
export function iconHtml(n, portrait) {
  const I = ICONS[n] || ICONS[0];
  return I.startsWith('p:') ? `<img src="${portrait(I.slice(2))}" alt="">` : `<span class="emo">${I}</span>`;
}
// Your portrait in its frame: <span class="pf fr-gold">...</span>
export const framed = (frame, inner, cls = '') => `<span class="pf fr-${FRAMES[frame] || 'none'} ${cls}">${inner}</span>`;
export const titleText = n => (n ? t('cos.title.' + TITLES[n]) : '');

// What an item id ('trail:3', 'skin:volt:1', 'emote:cool'...) looks like and is called.
export function itemView(id, portrait) {
  const [kind, a, b] = id.split(':');
  switch (kind) {
    case 'skin': return { icon: `<img src="${portrait(a)}" alt="" style="filter:${skinFilter(a, +b)}">`, name: `${t('cos.skin.' + SKINS[b])}`, sub: t('cos.kind.skin', { name: a[0].toUpperCase() + a.slice(1) }) };
    case 'trail': return { icon: `<span class="emo">${TRAIL_ICONS[a]}</span>`, name: t('cos.trail.' + TRAILS[a]), sub: t('cos.kind.trail') };
    case 'ko': return { icon: `<span class="emo">${KOFX_ICONS[a]}</span>`, name: t('cos.ko.' + KOFX[a]), sub: t('cos.kind.ko') };
    case 'emote': return { icon: `<span class="emo">${EMOTE_ICONS[EMOTES.indexOf(a)]}</span>`, name: t('cos.emote.' + a), sub: t('cos.kind.emote') };
    case 'frame': return { icon: framed(+a, '<span class="emo">🙂</span>'), name: t('cos.frame.' + FRAMES[a]), sub: t('cos.kind.frame') };
    case 'title': return { icon: '<span class="emo">🏷️</span>', name: t('cos.title.' + TITLES[a]), sub: t('cos.kind.title') };
    case 'icon': return { icon: iconHtml(+a, portrait), name: t('cos.kind.icon'), sub: '' };
    default: return { icon: '', name: id, sub: '' };
  }
}

// A seeded random for the shop of the day: every player sees the same shop.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6d2b79f5; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

export class MetaUI {
  // brawlers: keys; portrait(key) -> url; chosen() -> current brawler; mastery(key) -> level;
  // onWear(): what you wear changed (loadout, online room); onEmoteChange()
  constructor({ brawlers, portrait, chosen, mastery, onWear }) {
    Object.assign(this, { brawlers, portrait, chosen, mastery, onWear });
    this.view = null;
    this.tab = 'skin';
    this.bar = $('#profileBar');
    this.panel = $('#meta');
    this.body = $('#metaBody');
    $('#metaClose').addEventListener('click', () => { sfx('click'); this.close(); });
    this.panel.addEventListener('click', e => { if (e.target === this.panel) this.close(); });
    for (const [id, view] of [['#questsBtn', 'quests'], ['#roadBtn', 'road'], ['#shopBtn', 'shop'], ['#wardBtn', 'collection'], ['#pbMe', 'collection']]) {
      $(id).addEventListener('click', () => { sfx('click'); this.open(view); });
    }
    this.renderBar();
  }

  /* ------------------------------ profile bar (menu) ------------------------------ */

  renderBar() {
    const L = Pr.levelInfo(), W = Pr.wearing(), B = board(this.brawlers);
    const ready = B.daily.filter(q => !q.done).length + (B.weekly.done ? 0 : 1);
    $('#pbMe').innerHTML = `${framed(W.frame, iconHtml(W.icon, this.portrait))}
      <span class="pb-lv"><b>${t('meta.level', { n: L.level })}</b><i><u style="width:${(L.frac * 100).toFixed(0)}%"></u></i><small>${esc(titleText(W.title))}</small></span>`;
    $('#pbCoins').innerHTML = coin(Pr.coins());
    $('#pbTrophies').innerHTML = `🏆 ${Pr.totalTrophies()}`;
    $('#questsBtn em').textContent = ready || '';
    $('#questsBtn em').classList.toggle('hidden', !ready);
    const fresh = Pr.unseen().length;
    $('#wardBtn em').textContent = fresh || '';
    $('#wardBtn em').classList.toggle('hidden', !fresh);
  }

  /* ------------------------------ panels ------------------------------ */

  get isOpen() { return !this.panel.classList.contains('hidden'); }
  open(view) {
    this.view = view;
    this.panel.classList.remove('hidden');
    this.panel.dataset.view = view;
    this.render();
  }
  close() {
    if (!this.isOpen) return false;
    if (this.view === 'collection') Pr.markSeen();
    this.panel.classList.add('hidden');
    this.view = null;
    this.renderBar();
    return true;
  }
  render() {
    const V = { quests: () => this.quests(), road: () => this.road(), shop: () => this.shop(), collection: () => this.collection() };
    $('#metaTitle').textContent = t('meta.' + this.view);
    $('#metaCoins').innerHTML = coin(Pr.coins());
    V[this.view]();
  }

  // Quest board: 3 daily notes and the weekly one, pinned on cork; a stamp on finished ones.
  quests() {
    const B = board(this.brawlers), R = resetIn();
    const note = (q, i, weekly) => {
      const txt = t('quest.' + q.kind, { n: q.target, brawler: q.brawler ? q.brawler[0].toUpperCase() + q.brawler.slice(1) : '' });
      return `<div class="note${weekly ? ' weekly' : ''}${q.done ? ' done' : ''}" style="--r:${[-2.5, 1.8, -1.2, 1][weekly ? 3 : i]}deg">
        <span class="pin"></span><i class="q-ico">${QUEST_ICONS[q.kind]}</i>
        ${weekly ? `<em class="q-week">${t('quest.weekly')}</em>` : ''}
        <p>${esc(txt)}</p>
        <div class="q-bar"><u style="width:${(q.n / q.target * 100).toFixed(0)}%"></u><span>${q.n.toLocaleString()} / ${q.target.toLocaleString()}</span></div>
        <div class="q-rew">${coin(q.coins)} <small>+${weekly ? 150 : 30} XP</small></div>
        ${q.done ? `<b class="stamp">${t('quest.done')}</b>` : !weekly && !B.rerolled ? `<button class="q-reroll" data-i="${i}" title="${t('quest.reroll')}">🎲</button>` : ''}
      </div>`;
    };
    this.body.innerHTML = `<div class="cork">
      <div class="notes">${B.daily.map((q, i) => note(q, i, false)).join('')}</div>
      <div class="notes wk">${note(B.weekly, 0, true)}</div>
    </div>
    <p class="meta-foot">${t('quest.resetDay', { time: clock(R.day) })} · ${t('quest.resetWeek', { time: clock(R.week) })}${B.rerolled ? '' : ' · ' + t('quest.rerollHint')}</p>`;
    this.body.querySelectorAll('.q-reroll').forEach(b => b.addEventListener('click', () => {
      if (reroll(+b.dataset.i, this.brawlers)) { sfx('click'); this.render(); }
    }));
  }

  // Trophy Road: your trophies per brawler, then the milestones and their rewards.
  road() {
    const total = Pr.totalTrophies(), R = Pr.roadProgress(total);
    const per = this.brawlers.map(k => `<span class="rd-b"><img src="${this.portrait(k)}" alt=""><b>🏆 ${Pr.trophies(k)}</b></span>`).join('');
    const reward = id => {
      if (id.startsWith('coins:')) return { icon: '<i class="coin coin-lg"></i>', name: coin(id.slice(6)) };
      const v = itemView(id, this.portrait);
      return { icon: v.icon, name: esc(v.name) };
    };
    const stops = Pr.ROAD.map(([at, id], i) => {
      const r = reward(id), got = i < R.reached;
      return `<div class="rd-stop${got ? ' got' : ''}${i === R.reached ? ' next' : ''}"><span class="rd-at">🏆 ${at}</span>
        <span class="rd-ico">${r.icon}</span><small>${r.name}</small>${got ? '<b class="rd-tick">✓</b>' : ''}</div>`;
    }).join('');
    this.body.innerHTML = `<p class="meta-lead">${t('road.lead')}</p><div class="rd-per">${per}</div>
      <div class="rd-total">${t('road.total', { n: total })}${R.next ? ' · ' + t('road.next', { n: R.next[0] - total }) : ''}</div>
      <div class="rd-track">${stops}</div>`;
    const next = this.body.querySelector('.rd-stop.next') || this.body.querySelector('.rd-stop:last-child');
    if (next) next.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  // The shop of the day: 1 featured skin and 4 other items (a trail or K.O. effect, an emote, a
  // frame or title, and one more), the same for everyone, new every day.
  shopItems() {
    const d = new Date(), R = rng(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`), pool = shopPool(this.brawlers), out = [];
    for (const kinds of [['skin'], ['trail', 'ko'], ['emote'], ['frame', 'title'], ['icon', 'trail', 'ko', 'skin']]) {
      const a = pool.filter(id => kinds.includes(kindOf(id)) && !out.includes(id));
      if (a.length) out.push(a[Math.floor(R() * a.length)]);
    }
    return out;
  }
  shop() {
    const items = this.shopItems(), R = resetIn();
    this.body.innerHTML = `<div class="shop">${items.map((id, i) => {
      const v = itemView(id, this.portrait), own = Pr.owns(id), price = Math.round(priceOf(id) * (i === 0 ? 0.8 : 1));
      return `<div class="sh-item${i === 0 ? ' featured' : ''}${own ? ' own' : ''}">${i === 0 ? `<em class="sh-deal">-20%</em>` : ''}
        <span class="sh-ico">${v.icon}</span><b>${esc(v.name)}</b><small>${esc(v.sub)}</small>
        <button class="sh-buy" data-id="${id}" data-price="${price}"${own || Pr.coins() < price ? ' disabled' : ''}>${own ? t('shop.owned') : coin(price)}</button></div>`;
    }).join('')}</div>
    <p class="meta-foot">${t('shop.refresh', { time: clock(R.day) })} · ${t('shop.fair')}</p>`;
    this.body.querySelectorAll('.sh-buy:not([disabled])').forEach(b => b.addEventListener('click', () => {
      if (!Pr.buy(b.dataset.id, +b.dataset.price)) return;
      sfx('buy');
      this.render();
      this.renderBar();
    }));
  }

  // Collection: everything you own or could get, by kind; click to wear.
  collection() {
    const W = Pr.wearing(), key = this.skinOf || this.chosen(), kinds = ['skin', 'trail', 'ko', 'emote', 'frame', 'title', 'icon'];
    const tabs = kinds.map(k => `<button class="col-tab${k === this.tab ? ' on' : ''}" data-tab="${k}">${t('cos.tab.' + k)}</button>`).join('');
    const how = id => {
      if (Pr.owns(id)) return '';
      const lv = Object.entries(Pr.LEVEL_REWARDS).find(([, v]) => v === id);
      if (lv) return t('col.atLevel', { n: lv[0] });
      const rd = Pr.ROAD.find(([, v]) => v === id);
      if (rd) return t('col.onRoad', { n: rd[0] });
      if (/^skin:\w+:3$/.test(id)) return t('col.gold', { n: GOLD_AT });
      if (id === 'title:11') return t('col.weekly');
      if (id === 'title:10') return t('col.chaos');
      return t('col.inShop');
    };
    let tiles = [];
    const tile = (id, n, on, extra = '') => {
      const v = itemView(id, this.portrait), have = n === 0 || Pr.owns(id);
      return `<button class="col-item${on ? ' on' : ''}${have ? '' : ' locked'}" data-n="${n}"${have ? '' : ' disabled'}>
        <span class="col-ico">${v.icon}</span><b>${esc(v.name)}</b>${have ? extra : `<small>🔒 ${esc(how(id))}</small>`}</button>`;
    };
    switch (this.tab) {
      case 'skin': tiles = SKINS.map((s, n) => tile(`skin:${key}:${n}`, n, (W.skins[key] || 0) === n)); break;
      case 'trail': tiles = TRAILS.map((s, n) => tile('trail:' + n, n, W.trail === n)); break;
      case 'ko': tiles = KOFX.map((s, n) => tile('ko:' + n, n, W.ko === n)); break;
      case 'emote': tiles = EMOTES.map((e, n) => tile('emote:' + e, Pr.owns('emote:' + e) ? n : -1, false)); break;
      case 'frame': tiles = FRAMES.map((s, n) => tile('frame:' + n, n, W.frame === n)); break;
      case 'title': tiles = TITLES.map((s, n) => n ? tile('title:' + n, n, W.title === n) : ''); break;
      case 'icon': tiles = ICONS.map((s, n) => tile('icon:' + n, Pr.owns('icon:' + n) ? n : -1, W.icon === n)); break;
    }
    const pick = this.tab === 'skin' ? `<div class="col-brawlers">${this.brawlers.map(k => `<button data-b="${k}" class="${k === key ? 'on' : ''}"><img src="${this.portrait(k)}" alt=""></button>`).join('')}</div>` : '';
    this.body.innerHTML = `<div class="col-tabs">${tabs}</div>${pick}<div class="col-grid">${tiles.join('')}</div>
      ${this.tab === 'emote' ? `<p class="meta-foot">${t('col.emoteHint')}</p>` : ''}`;
    this.body.querySelectorAll('.col-tab').forEach(b => b.addEventListener('click', () => { sfx('click'); this.tab = b.dataset.tab; this.render(); }));
    this.body.querySelectorAll('.col-brawlers button').forEach(b => b.addEventListener('click', () => { sfx('click'); this.skinOf = b.dataset.b; this.render(); }));
    if (this.tab === 'emote') return; // emotes: all the ones you own are on the wheel
    this.body.querySelectorAll('.col-item:not(.locked)').forEach(b => b.addEventListener('click', () => {
      const n = +b.dataset.n;
      if (n < 0 || !Pr.canWear(this.tab, n, key)) return;
      sfx('click');
      Pr.wear(this.tab, n, key);
      this.render();
      this.renderBar();
      this.onWear();
    }));
  }

  /* ------------------------------ result screen ------------------------------ */

  // After a match: the XP bar, coins, trophies and quest notes; then the level-up ceremony if any.
  showResult(res, q, key) {
    const el = $('#resProgress'), A = res.after, B = res.before, up = A.level > B.level;
    const lg = res.league;
    const quests = q.moved.map(({ q: Q, done, weekly }) => `<span class="rp-q${done ? ' done' : ''}${weekly ? ' wk' : ''}">${QUEST_ICONS[Q.kind]} ${Q.n.toLocaleString()}/${Q.target.toLocaleString()}${done ? ' ✓' : ''}</span>`).join('');
    el.innerHTML = `<div class="rp-xp"><b>${t('meta.level', { n: A.level })}</b><i><u style="width:${up ? 0 : (B.frac * 100).toFixed(0)}%"></u></i><small>+${res.xp} XP</small></div>
      <div class="rp-row">${coin('+' + (res.coins + q.coins))}${lg ? `<span class="rp-tr${lg.delta < 0 ? ' down' : ''}">🏆 ${lg.delta >= 0 ? '+' : ''}${lg.delta} <small>${lg.trophies}</small></span>` : ''}${quests}</div>`;
    requestAnimationFrame(() => setTimeout(() => { el.querySelector('.rp-xp u').style.width = `${(A.frac * 100).toFixed(0)}%`; }, 300));
    if (q.moved.some(m => m.done)) setTimeout(() => sfx('stamp'), 700);
    const rewards = [...res.rewards, ...(q.paid ? q.paid.rewards : [])];
    const levelUp = q.paid && q.paid.after.level > (up ? A.level : B.level) ? q.paid.after.level : A.level;
    if (levelUp > B.level || rewards.some(r => r.mastery || r.road)) setTimeout(() => this.ceremony(levelUp > B.level ? levelUp : 0, rewards, key), 1400);
    this.renderBar();
  }

  // Level up: a big number, a chest that bursts open, and every reward on a card.
  ceremony(lvl, rewards, key) {
    const el = $('#levelUp');
    const cards = rewards.map(r => {
      if (r.id) { const v = itemView(r.id, this.portrait); return `<div class="lu-card"><span>${v.icon}</span><b>${esc(v.name)}</b><small>${esc(r.road ? t('road.reached', { n: r.road }) : r.mastery ? t('col.gold', { n: GOLD_AT }) : v.sub)}</small></div>`; }
      return `<div class="lu-card"><span><i class="coin coin-lg"></i></span><b>${coin(r.coins)}</b><small>${r.road ? t('road.reached', { n: r.road }) : r.level ? t('meta.level', { n: r.level }) : ''}</small></div>`;
    }).join('');
    el.innerHTML = `<div class="lu-box"><img class="lu-fig" src="${this.portrait(key)}" alt="">
      <h2>${lvl ? t('meta.levelUp', { n: lvl }) : t('meta.rewards')}</h2><div class="lu-chest">🎁</div><div class="lu-cards">${cards}</div>
      <button class="big" id="luOk">${t('meta.great')}</button></div>`;
    el.classList.remove('hidden');
    sfx(lvl ? 'levelup' : 'chest');
    setTimeout(() => { el.classList.add('open'); sfx('chest'); }, 900);
    $('#luOk').addEventListener('click', () => { sfx('click'); el.classList.add('hidden'); el.classList.remove('open'); });
  }
}
