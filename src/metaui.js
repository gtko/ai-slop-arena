// Menus of the progression (v0.13 LEVEL UP): the profile button, the quest board, the Trophy Road,
// the shop, the collection, and what the result screen shows after a match (XP, coins, trophies,
// quests, the level-up ceremony).

import { t, lang } from './i18n/index.js';
import { sfx } from './audio.js';
import { track } from './telemetry.js';
import * as Pr from './profile.js';
import { board, reroll, resetIn, QUEST_ICONS } from './quests.js';
import { SKINS, RECOLOURS, TRAILS, TRAIL_ICONS, KOFX, KOFX_ICONS, EMOTES, EMOTE_ICONS, FRAMES, TITLES, ICONS, GOLD_AT,
  shopPool, priceOf, kindOf, BRAWLER_PRICE, GEM_PACKS } from './cosmetics.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const num = n => Number(n).toLocaleString(lang); // numbers in the game's language, not the browser's
export const coin = n => `<span class="coin-n"><i class="coin"></i>${typeof n === 'number' ? num(n) : n}</span>`;
export const gem = n => `<span class="gem-n"><i class="gem"></i>${typeof n === 'number' ? num(n) : n}</span>`;
const unit = (u, v) => { try { return new Intl.NumberFormat(lang, { style: 'unit', unit: u, unitDisplay: 'narrow' }).format(v); } catch { return v + u[0]; } };
const clock = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? t('meta.days', { n: Math.floor(m / 1440) }) : `${unit('hour', Math.floor(m / 60))} ${unit('minute', m % 60)}`; };
const cap = s => s[0].toUpperCase() + s.slice(1);
const questText = q => t('quest.' + q.kind, { n: num(q.target), brawler: q.brawler ? cap(q.brawler) : '' });

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
// Frames are shown around your own icon, titles as the chip they are on the podium.
export function itemView(id, portrait) {
  const [kind, a, b] = id.split(':'), W = Pr.wearing();
  switch (kind) {
    case 'skin': return { icon: `<img src="${portrait(a)}" alt="" style="filter:${skinFilter(a, +b)}">`, name: t('cos.skin.' + SKINS[b]), sub: t('cos.kind.skin', { name: cap(a) }) };
    case 'trail': return { icon: `<span class="emo">${TRAIL_ICONS[a]}</span>`, name: t('cos.trail.' + TRAILS[a]), sub: t('cos.kind.trail') };
    case 'ko': return { icon: `<span class="emo">${KOFX_ICONS[a]}</span>`, name: t('cos.ko.' + KOFX[a]), sub: t('cos.kind.ko') };
    case 'emote': return { icon: `<span class="emo">${EMOTE_ICONS[EMOTES.indexOf(a)]}</span>`, name: t('cos.emote.' + a), sub: t('cos.kind.emote') };
    case 'frame': return { icon: framed(+a, iconHtml(W.icon, portrait)), name: t('cos.frame.' + FRAMES[a]), sub: t('cos.kind.frame') };
    case 'title': return { icon: `<span class="title-chip">${esc(t('cos.title.' + TITLES[a]))}</span>`, name: '', sub: t('cos.kind.title') }; // the chip is the name
    case 'icon': return { icon: iconHtml(+a, portrait), name: '', sub: t('cos.kind.icon') };
    default: return { icon: '', name: id, sub: '' };
  }
}

// A seeded random for the shop of the day: every player sees the same shop.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6d2b79f5; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
// Items that levels or the Trophy Road give: never sold (buying one would be wasted later).
const EARNED_HERE = new Set([...Object.values(Pr.LEVEL_REWARDS), ...Pr.ROAD.map(([, id]) => id)]);
const WEARABLE = new Set(['skin', 'trail', 'ko', 'frame', 'title', 'icon']);

// Quests you finished and have not looked at yet (the red badge on the Quests tab).
const SEEN = 'iaslop-quests-seen';
const doneKey = B => [...B.daily.map((q, i) => q.done ? `${B.day}:${i}:${q.kind}` : ''), B.weekly.done ? `w${B.week}` : ''].filter(Boolean);
function unseenQuests(B) {
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN) || '[]'); } catch { /* private mode */ }
  return doneKey(B).filter(k => !seen.includes(k)).length;
}
function markQuestsSeen(B) { try { localStorage.setItem(SEEN, JSON.stringify(doneKey(B))); } catch { /* private mode */ } }

export class MetaUI {
  // brawlers: keys; portrait(key) -> url; chosen() -> current brawler; onWear(): what you wear changed
  constructor({ brawlers, portrait, chosen, onWear, onBrawler, colorOf, onWallet }) {
    Object.assign(this, { brawlers, portrait, chosen, onWear, onBrawler, colorOf, onWallet });
    this.view = null;
    this.tab = 'skin';
    this.panel = $('#meta');
    this.body = $('#metaBody');
    $('#metaClose').addEventListener('click', () => { sfx('click'); this.close(); });
    this.panel.addEventListener('click', e => { if (e.target === this.panel) this.close(); });
    // the top navigation: PLAY closes the page, the other tabs open theirs; icon-only tabs keep a name
    document.querySelectorAll('#tnTabs [data-page]').forEach(b => {
      const name = b.querySelector('span').textContent;
      b.setAttribute('aria-label', name);
      b.title = name;
      b.addEventListener('click', () => {
        sfx('click');
        if (b.dataset.page === 'play') this.close(); else this.open(b.dataset.page);
      });
    });
    $('#pbMe').addEventListener('click', () => { sfx('click'); this.tab = 'icon'; this.open('collection'); });
    $('#homeQuests').addEventListener('click', () => { sfx('click'); this.open('quests'); });
    this.renderBar();
  }

  /* ------------------------------ top bar and home widgets ------------------------------ */

  renderBar() {
    const L = Pr.levelInfo(), W = Pr.wearing(), B = board(this.brawlers);
    const me = $('#pbMe');
    me.innerHTML = `<span class="tn-ring" style="--f:${(L.frac * 360).toFixed(0)}deg">${framed(W.frame, iconHtml(W.icon, this.portrait))}<b>${L.level}</b></span>
      <span class="tn-who"><b>${t('meta.level', { n: L.level })}</b><small>${esc(titleText(W.title))}</small></span>`;
    const who = `${t('meta.profile')} · ${t('meta.level', { n: L.level })} · ${num(L.into)} / ${num(L.need)} XP${W.title ? ' · ' + titleText(W.title) : ''}`;
    me.title = who;
    me.setAttribute('aria-label', who);
    // home: the day's quests at a glance
    const row = q => `<li class="${q.done ? 'done' : ''}"><i>${QUEST_ICONS[q.kind]}</i><span>${esc(questText(q))}</span>
      <em><u style="width:${(q.n / q.target * 100).toFixed(0)}%"></u></em><b>${q.done ? '✓' : `${num(q.n)}/${num(q.target)}`}</b></li>`;
    $('#homeQuests').innerHTML = `<h3>${t('meta.quests')}<small>${B.daily.filter(q => q.done).length}/3</small></h3><ul>${B.daily.map(row).join('')}</ul>`;
    $('#pbCoins').innerHTML = coin(Pr.coins());
    $('#pbGems').innerHTML = gem(Pr.gems());
    this.onWallet?.();
    $('#pbTrophies').innerHTML = `🏆 ${num(Pr.totalTrophies())}`;
    // red badges only for something new: a quest just finished, an item just unlocked
    const fresh = unseenQuests(B);
    $('#questsBtn em').textContent = fresh || '';
    $('#questsBtn em').classList.toggle('hidden', !fresh);
    const items = Pr.unseen().length;
    $('#wardBtn em').textContent = items || '';
    $('#wardBtn em').classList.toggle('hidden', !items);
  }

  /* ------------------------------ pages ------------------------------ */

  get isOpen() { return !this.panel.classList.contains('hidden'); }
  open(view) {
    this.view = view;
    this.panel.classList.remove('hidden');
    this.panel.dataset.view = view;
    this.tabs(view);
    this.render();
    if (view === 'quests') { markQuestsSeen(board(this.brawlers)); this.renderBar(); }
  }
  tabs(view) {
    document.querySelectorAll('#tnTabs [data-page]').forEach(b => {
      const on = b.dataset.page === view;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  close() {
    if (!this.isOpen) return false;
    if (this.view === 'collection') Pr.markSeen();
    const was = this.view;
    this.panel.classList.add('hidden');
    this.view = null;
    this.tabs('play');
    this.renderBar();
    // keyboard: back on the tab of the page you left
    if (document.activeElement === document.body || this.panel.contains(document.activeElement)) $(`#tnTabs [data-page="${was}"]`)?.focus({ preventScroll: true });
    return true;
  }
  render() {
    const V = { quests: () => this.quests(), road: () => this.road(), shop: () => this.shop(), collection: () => this.collection() };
    $('#metaTitle').textContent = t('meta.' + this.view);
    $('#metaSub').textContent = '';
    $('#metaCoins').innerHTML = coin(Pr.coins()) + gem(Pr.gems());
    $('#metaCoins').classList.toggle('hidden', this.view !== 'shop'); // the nav already shows your coins
    V[this.view]();
  }

  // Quest board: 3 daily notes and the weekly one, pinned on cork; a stamp on finished ones.
  quests() {
    const B = board(this.brawlers), R = resetIn();
    const note = (q, i, weekly) => `<div class="q-note${weekly ? ' weekly' : ''}${q.done ? ' done' : ''}" style="--r:${[-2.5, 1.8, -1.2, 1][weekly ? 3 : i]}deg">
        <span class="pin"></span><i class="q-ico">${QUEST_ICONS[q.kind]}</i>
        ${weekly ? `<em class="q-week">${t('quest.weekly')}</em>` : ''}
        <p>${esc(questText(q))}</p>
        <div class="q-bar"><u style="width:${(q.n / q.target * 100).toFixed(0)}%"></u><span><bdi dir="ltr">${num(q.n)} / ${num(q.target)}</bdi></span></div>
        <div class="q-rew">${coin(q.coins)} <small>+${weekly ? 150 : 30} XP</small></div>
        ${q.done ? `<b class="stamp">${t('quest.done')}</b>` : !weekly && !B.rerolled ? `<button class="q-reroll" data-i="${i}" title="${t('quest.reroll')}" aria-label="${t('quest.reroll')}">🎲</button>` : ''}
      </div>`;
    $('#metaSub').textContent = `${t('quest.resetDay', { time: clock(R.day) })} · ${t('quest.resetWeek', { time: clock(R.week) })}`;
    this.body.innerHTML = `<div class="cork">
      <div class="notes">${B.daily.map((q, i) => note(q, i, false)).join('')}</div>
      <div class="notes wk">${note(B.weekly, 0, true)}</div>
    </div>
    <p class="meta-foot">${B.rerolled ? t('quest.rerolled', { time: clock(R.day) }) : t('quest.rerollHint')}</p>`;
    this.body.querySelectorAll('.q-reroll').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      if (!reroll(i, this.brawlers)) return;
      sfx('click');
      track('quest_rerolled');
      this.render();
      this.body.querySelectorAll('.q-note')[i]?.classList.add('flip');
    }));
  }

  // Trophy Road: your trophies per brawler, then the milestones and their rewards.
  road() {
    const total = Pr.totalTrophies(), R = Pr.roadProgress(total), claimed = Math.max(R.reached, Pr.roadClaimed());
    const per = this.brawlers.map(k => `<span class="rd-b" title="${cap(k)}"><img src="${this.portrait(k)}" alt="${cap(k)}"><b>🏆 ${num(Pr.trophies(k))}</b></span>`).join('');
    const reward = id => {
      if (id.startsWith('coins:')) return { icon: '<i class="coin coin-lg"></i>', name: coin(+id.slice(6)) };
      const v = itemView(id, this.portrait);
      return { icon: v.icon, name: esc(v.name || v.sub) };
    };
    const stops = Pr.ROAD.map(([at, id], i) => {
      const r = reward(id), got = i < claimed;
      return `<div class="rd-stop${got ? ' got' : ''}${i === R.reached ? ' next' : ''}"><span class="rd-at">🏆 ${num(at)}</span>
        <span class="rd-ico">${r.icon}</span><small>${r.name}</small>${got ? '<b class="rd-tick">✓</b>' : ''}</div>`;
    }).join('');
    $('#metaSub').textContent = `${t('road.total', { n: num(total) })}${R.next ? ' · ' + t('road.next', { n: num(R.next[0] - total) }) : ''}`;
    const frac = R.next ? Math.min(1, (R.reached + R.frac) / Pr.ROAD.length) : 1;
    this.body.innerHTML = `<p class="meta-lead">${t('road.lead')}</p><div class="rd-per">${per}</div>
      <div class="rd-wrap"><button class="rd-arrow" data-d="-1" aria-label="‹">‹</button>
        <div class="rd-track" style="--p:${(frac * 100).toFixed(1)}%">${stops}</div>
        <button class="rd-arrow" data-d="1" aria-label="›">›</button></div>`;
    const track_ = this.body.querySelector('.rd-track');
    // a vertical mouse wheel scrolls the road sideways; the arrows page through it
    track_.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { track_.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    this.body.querySelectorAll('.rd-arrow').forEach(b => b.addEventListener('click', () => track_.scrollBy({ left: +b.dataset.d * track_.clientWidth * 0.8, behavior: 'smooth' })));
    const next = this.body.querySelector('.rd-stop.next') || this.body.querySelector('.rd-stop:last-child');
    if (next) track_.scrollLeft = next.offsetLeft - (track_.clientWidth - next.offsetWidth) / 2; // only the road scrolls, not the page
  }

  // The shop of the day: 1 featured skin and 4 other items (a trail or K.O. effect, an emote, a
  // frame or title, and one more), the same for everyone, new every day.
  shopItems() {
    const d = new Date(), R = rng(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`), out = [];
    const pool = shopPool(this.brawlers).filter(id => !EARNED_HERE.has(id));
    for (const kinds of [['skin'], ['trail', 'ko'], ['emote'], ['frame', 'title'], ['icon', 'trail', 'ko', 'skin']]) {
      let a = pool.filter(id => kinds.includes(kindOf(id)) && !out.includes(id));
      if (!out.length) a = a.filter(id => !Pr.owns(id)).length ? a.filter(id => !Pr.owns(id)) : a; // the featured skin: one you don't have
      if (a.length) out.push(a[Math.floor(R() * a.length)]);
    }
    return out;
  }
  worn(id) {
    const [kind, a, b] = id.split(':'), W = Pr.wearing();
    return kind === 'skin' ? (W.skins[a] || 0) === +b : W[kind] === +a;
  }
  wearItem(id) {
    const [kind, a, b] = id.split(':');
    if (kind === 'skin') Pr.wear('skin', +b, a); else Pr.wear(kind, +a);
    track('cosmetic_equipped', { kind, item: id });
    this.onWear();
  }
  shop() {
    const R = resetIn(), tab = this.shopTab ||= 'featured';
    const tabs = ['featured', 'brawlers', 'skins', 'effects', 'emotes', 'profile', 'gems'];
    const pool = shopPool(this.brawlers).filter(id => !EARNED_HERE.has(id));
    $('#metaSub').textContent = tab === 'featured' ? t('shop.refresh', { time: clock(R.day) }) : '';
    const gemsHave = Pr.gems(), coinsHave = Pr.coins();
    // one buy button: the price in a currency, what you're missing, or equip / owned
    const buyBtn = (id, price, cur = 'gems') => {
      const have = cur === 'coins' ? coinsHave : gemsHave, money = cur === 'coins' ? coin : gem, short = have < price;
      return `<button class="sh-buy${short ? ' short' : ''}${cur === 'coins' ? ' by-coins' : ''}" data-id="${id}" data-price="${price}" data-cur="${cur}"${short ? ' disabled' : ''}>${money(price)}${short ? `<small>${t('shop.missing', { n: num(price - have) })}</small>` : ''}</button>`;
    };
    const card = (id, { price = priceOf(id), deal = 0, cls = '' } = {}) => {
      const v = itemView(id, this.portrait), own = Pr.owns(id), wear = own && WEARABLE.has(kindOf(id)), cost = Math.round(price * (1 - deal));
      let btn;
      if (!own) btn = buyBtn(id, cost);
      else if (wear && !this.worn(id)) btn = `<button class="sh-buy sh-wear" data-wear="${id}">${t('shop.equip')}</button>`;
      else btn = `<button class="sh-buy" disabled>${wear ? t('col.equipped') : t('shop.owned')}</button>`;
      return `<div class="sh-item ${cls}${own ? ' own' : ''}">${deal && !own ? `<em class="sh-deal">-${Math.round(deal * 100)}%</em>` : ''}
        <span class="sh-ico">${v.icon}</span><b>${esc(v.name || v.sub)}</b><small>${esc(v.name ? v.sub : '')}</small>
        ${deal && !own ? `<s class="sh-was">${num(price)}</s>` : ''}${btn}</div>`;
    };
    let body = '';
    if (tab === 'featured') body = `<div class="shop">${this.shopItems().map((id, i) => card(id, { deal: i === 0 ? 0.2 : 0, cls: i === 0 ? 'featured' : '' })).join('')}</div>`;
    else if (tab === 'brawlers') {
      // every brawler: the starters are free, the others cost Slop Coins or Gems
      body = `<div class="shop sh-brawlers">${this.brawlers.map(k => {
        const own = Pr.ownsBrawler(k), id = 'brawler:' + k;
        return `<div class="sh-item sh-brawler${own ? ' own' : ''}" style="--c:${this.colorOf(k)}"><span class="sh-ico"><img src="${this.portrait(k)}" alt=""></span>
          <b>${cap(k)}</b><small>${esc(t(`brawler.${k}.role`))}</small>
          ${own ? `<button class="sh-buy" disabled>${t('shop.owned')}</button>` : `<div class="sh-two">${buyBtn(id, BRAWLER_PRICE.coins, 'coins')}<span>${t('shop.or')}</span>${buyBtn(id, BRAWLER_PRICE.gems, 'gems')}</div>`}</div>`;
      }).join('')}</div>`;
    } else if (tab === 'skins') {
      const key = this.shopSkinsOf || this.chosen();
      const pick = `<div class="col-brawlers">${this.brawlers.map(k => `<button data-b="${k}" class="${k === key ? 'on' : ''}" title="${cap(k)}" aria-label="${cap(k)}" aria-pressed="${k === key}"><img src="${this.portrait(k)}" alt=""></button>`).join('')}</div>`;
      body = pick + `<div class="shop">${pool.filter(id => id.startsWith(`skin:${key}:`)).map(id => card(id)).join('')}${Pr.owns(`skin:${key}:3`) ? card(`skin:${key}:3`) : card(`skin:${key}:3`, { cls: 'earned' }).replace(/<button class="sh-buy[^"]*"[^>]*>[\s\S]*?<\/button>/, `<button class="sh-buy" disabled>🔒 ${t('col.gold', { n: GOLD_AT })}</button>`)}</div>`;
    } else if (tab === 'effects') body = `<div class="shop">${pool.filter(id => /^(trail|ko):/.test(id)).map(id => card(id)).join('')}</div>`;
    else if (tab === 'emotes') body = `<div class="shop">${pool.filter(id => id.startsWith('emote:')).map(id => card(id)).join('')}</div>`;
    else if (tab === 'profile') body = `<div class="shop">${pool.filter(id => /^(frame|title|icon):/.test(id)).map(id => card(id)).join('')}</div>`;
    else if (tab === 'gems') {
      // real payment comes with the store integration (Steam, Google Play, Apple, Stripe); until then the
      // packs are shown, and only development builds can add test Gems
      const test = import.meta.env.DEV;
      body = `<p class="meta-lead">${t('shop.gemsLead')}</p><div class="shop sh-gems">${GEM_PACKS.map(([n, eur], i) => `<div class="sh-item sh-pack${i === 2 ? ' featured' : ''}">
        <span class="sh-ico"><i class="gem gem-lg" style="--s:${1 + i * 0.18}"></i></span><b>${gem(n)}</b>
        <small>${new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(eur)}</small>
        <button class="sh-buy${test ? '' : ' soon'}" data-pack="${n}"${test ? '' : ' disabled'}>${test ? t('shop.gemsTest', { n: num(n) }) : t('shop.gemsSoon')}</button></div>`).join('')}</div>`;
    }
    this.body.innerHTML = `<div class="col-tabs sh-tabs">${tabs.map(k => `<button class="col-tab${k === tab ? ' on' : ''}" data-stab="${k}">${t('shop.tab.' + k)}</button>`).join('')}</div>
      ${body}<p class="meta-foot">${t('shop.fair')}</p>`;
    this.body.querySelectorAll('[data-stab]').forEach(b => b.addEventListener('click', () => { sfx('click'); this.shopTab = b.dataset.stab; this.render(); }));
    this.body.querySelectorAll('.col-brawlers [data-b]').forEach(b => b.addEventListener('click', () => { sfx('click'); this.shopSkinsOf = b.dataset.b; this.render(); }));
    this.body.querySelectorAll('.sh-buy[data-id]:not([disabled])').forEach(b => b.addEventListener('click', () => {
      const { id, cur } = b.dataset, price = +b.dataset.price;
      if (!Pr.buy(id, price, cur)) return;
      sfx('buy');
      track('shop_purchase', { item: id, price, currency: cur });
      if (id.startsWith('brawler:')) this.onBrawler?.(id.slice(8));
      this.render();
      this.renderBar();
      this.body.querySelector(`[data-wear="${id}"]`)?.focus({ preventScroll: true });
    }));
    this.body.querySelectorAll('[data-wear]').forEach(b => b.addEventListener('click', () => {
      sfx('click');
      this.wearItem(b.dataset.wear);
      this.render();
      this.renderBar();
    }));
    this.body.querySelectorAll('[data-pack]:not([disabled])').forEach(b => b.addEventListener('click', () => {
      Pr.addGems(+b.dataset.pack); // development builds only (see above)
      sfx('buy');
      this.render();
      this.renderBar();
    }));
  }

  // Collection: everything you own or could get, by kind, with a big preview; click to wear.
  collection() {
    const W = Pr.wearing(), key = this.skinOf || this.chosen(), kinds = ['skin', 'trail', 'ko', 'emote', 'frame', 'title', 'icon'];
    const today = new Set(this.shopItems()), unseen = new Set(Pr.unseen());
    const ids = {
      skin: SKINS.map((s, n) => `skin:${key}:${n}`), trail: TRAILS.map((s, n) => 'trail:' + n), ko: KOFX.map((s, n) => 'ko:' + n),
      emote: EMOTES.map(e => 'emote:' + e), frame: FRAMES.map((s, n) => 'frame:' + n), title: TITLES.map((s, n) => 'title:' + n).slice(1), icon: ICONS.map((s, n) => 'icon:' + n),
    };
    const has = id => /^(skin:\w+|trail|ko|frame):0$/.test(id) || Pr.owns(id);
    const count = k => k === 'skin' ? this.brawlers.reduce((s, b) => s + SKINS.filter((x, n) => has(`skin:${b}:${n}`)).length, 0) + '/' + this.brawlers.length * SKINS.length
      : `${ids[k].filter(has).length}/${ids[k].length}`;
    const tabs = kinds.map(k => `<button class="col-tab${k === this.tab ? ' on' : ''}" data-tab="${k}">${t('cos.tab.' + k)}<small>${count(k)}</small></button>`).join('');
    const how = id => {
      const lv = Object.entries(Pr.LEVEL_REWARDS).find(([, v]) => v === id);
      if (lv) return t('col.atLevel', { n: lv[0] });
      const rd = Pr.ROAD.find(([, v]) => v === id);
      if (rd) return t('col.onRoad', { n: num(rd[0]) });
      if (/^skin:\w+:3$/.test(id)) return t('col.gold', { n: GOLD_AT });
      if (id === 'title:11') return t('col.weekly');
      if (id === 'title:10') return t('col.chaos');
      return today.has(id) ? t('shop.today') : t('col.inShop');
    };
    const wearable = this.tab !== 'emote';
    const tile = id => {
      const v = itemView(id, this.portrait), own = has(id), on = wearable && this.worn(id);
      return `<button class="col-item${on ? ' on' : ''}${own ? '' : ' locked'}${own && wearable ? '' : ' static'}${unseen.has(id) ? ' new' : ''}" data-id="${id}"${own ? '' : ' aria-disabled="true"'}>
        ${on ? `<em class="col-flag">${t('col.equipped')}</em>` : unseen.has(id) ? `<em class="col-flag new">${t('col.new')}</em>` : ''}
        <span class="col-ico">${v.icon}</span>${v.name ? `<b>${esc(v.name)}</b>` : ''}${own ? '' : `<small>🔒 ${esc(how(id))}</small>`}</button>`;
    };
    const pick = this.tab === 'skin' ? `<div class="col-brawlers">${this.brawlers.map(k => `<button data-b="${k}" class="${k === key ? 'on' : ''}" title="${cap(k)}" aria-label="${cap(k)}" aria-pressed="${k === key}"><img src="${this.portrait(k)}" alt=""></button>`).join('')}</div>` : '';
    const worn = ids[this.tab].find(id => wearable && this.worn(id)) || ids[this.tab][0];
    this.body.innerHTML = `<div class="col-tabs">${tabs}</div>${pick}
      <div class="col-wrap"><div class="col-grid">${ids[this.tab].map(tile).join('')}</div><aside class="col-preview" aria-live="polite"></aside></div>
      ${this.tab === 'emote' ? `<p class="meta-foot">${t('col.emoteHint')}</p>` : ''}`;
    const preview = id => {
      const v = itemView(id, this.portrait), own = has(id);
      this.body.querySelectorAll('.col-item').forEach(b => b.classList.toggle('sel', b.dataset.id === id));
      this.body.querySelector('.col-preview').innerHTML = `<span class="cp-ico">${v.icon}</span><b>${esc(v.name || v.sub)}</b><small>${esc(v.name ? v.sub : '')}</small>
        <em>${!own ? '🔒 ' + esc(how(id)) : wearable && this.worn(id) ? '✓ ' + t('col.equipped') : ''}</em>
        ${!own && today.has(id) ? `<button class="cp-shop">🛒 ${t('meta.shop')}</button>` : ''}`;
      this.body.querySelector('.cp-shop')?.addEventListener('click', () => { sfx('click'); this.open('shop'); });
    };
    preview(worn);
    this.body.querySelectorAll('.col-tab').forEach(b => b.addEventListener('click', () => { sfx('click'); this.tab = b.dataset.tab; this.render(); }));
    this.body.querySelectorAll('.col-brawlers button').forEach(b => b.addEventListener('click', () => { sfx('click'); this.skinOf = b.dataset.b; this.render(); }));
    this.body.querySelectorAll('.col-item').forEach(b => {
      b.addEventListener('mouseenter', () => preview(b.dataset.id));
      b.addEventListener('focus', () => preview(b.dataset.id));
      b.addEventListener('click', () => {
        const id = b.dataset.id;
        preview(id);
        if (!wearable || !has(id) || this.worn(id)) return;
        sfx('click');
        this.wearItem(id);
        this.render();
        this.renderBar();
        this.body.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true });
      });
    });
  }

  /* ------------------------------ result screen ------------------------------ */

  // After a match: trophies and coins first (big), then the XP bar (quest XP included) and the
  // quest notes; then the level-up ceremony if any.
  showResult(res, q, key) {
    const el = $('#resProgress'), B = res.before, F = q.paid ? q.paid.after : res.after, up = F.level > B.level;
    const lg = res.league;
    if (res.extra) res.rewards.push(...res.extra);
    const quests = q.moved.map(({ q: Q, done, weekly }) => `<span class="rp-q${done ? ' done' : ''}${weekly ? ' wk' : ''}" title="${esc(questText(Q))}">${QUEST_ICONS[Q.kind]} ${num(Q.n)}/${num(Q.target)}${done ? ' ✓' : ''}</span>`).join('');
    el.innerHTML = `<div class="rp-big">
        ${lg ? `<div class="rp-tile rp-tr${lg.delta < 0 ? ' down' : ''}"><small>${t('result.trophies')}</small><b>🏆 ${lg.delta >= 0 ? '+' : ''}${lg.delta}</b><em>${num(lg.trophies)}</em></div>` : ''}
        <div class="rp-tile rp-coins"><small>Slop Coins</small><b>${coin('+' + num(res.coins + q.coins))}</b><em>${num(Pr.coins())}</em></div>
      </div>
      <div class="rp-xp"><b>${t('meta.level', { n: F.level })}</b><i><u style="width:${up ? 0 : (B.frac * 100).toFixed(0)}%"></u></i><small>+${num(res.xp + q.xp)} XP</small></div>
      ${quests ? `<div class="rp-row">${quests}</div>` : ''}`;
    requestAnimationFrame(() => setTimeout(() => { const u = el.querySelector('.rp-xp u'); if (u) u.style.width = `${(F.frac * 100).toFixed(0)}%`; }, 300));
    if (q.moved.some(m => m.done)) setTimeout(() => sfx('stamp'), 700);
    const rewards = [...res.rewards, ...(q.paid ? q.paid.rewards : [])];
    if (up || rewards.some(r => r.mastery || r.road || r.id)) setTimeout(() => this.ceremony(up ? F.level : 0, rewards, key), 1400);
    this.renderBar();
  }

  // Level up: a big number, a chest that bursts open, and every reward on a card.
  ceremony(lvl, rewards, key) {
    const el = $('#levelUp');
    const label = r => (r.road ? t('road.reached', { n: num(r.road) }) : r.mastery ? t('col.gold', { n: GOLD_AT }) : r.level ? t('meta.level', { n: r.level }) : '');
    const order = [...rewards].sort((a, b) => (a.level || 99) - (b.level || 99));
    const cards = order.map(r => {
      if (r.id && !r.dup) { const v = itemView(r.id, this.portrait); return `<div class="lu-card"><span>${v.icon}</span><b>${esc(v.name || v.sub)}</b><small>${esc(label(r) || v.sub)}</small></div>`; }
      return `<div class="lu-card lu-coins"><span><i class="coin coin-lg"></i></span><b>${coin('+' + num(r.coins))}</b><small>${esc(r.dup ? t('meta.dup') : label(r))}</small></div>`;
    }).join('');
    const skin = Pr.wearing().skins[key] || 0;
    el.innerHTML = `<div class="lu-box"><img class="lu-fig" src="${this.portrait(key)}" alt="" style="filter:${skinFilter(key, skin)}">
      <h2>${lvl ? t('meta.levelUp', { n: lvl }) : t('meta.rewards')}</h2><div class="lu-chest">🎁</div><div class="lu-cards">${cards}</div>
      <button class="big" id="luOk">${t('meta.great')}</button></div>`;
    el.classList.remove('hidden');
    sfx(lvl ? 'levelup' : 'chest');
    setTimeout(() => { el.classList.add('open'); sfx('chest'); }, 900);
    $('#luOk').addEventListener('click', () => { sfx('click'); el.classList.add('hidden'); el.classList.remove('open'); });
    $('#luOk').focus({ preventScroll: true });
  }
}
