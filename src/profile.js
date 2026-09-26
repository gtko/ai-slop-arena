// Your profile (v0.13 LEVEL UP), kept on this device like the mastery (mastery.js):
//  - account level (P01): ~55 XP a match, level L -> L+1 costs 100 + 20 (L - 1); every level pays
//    Slop Coins and some give a cosmetic, with a ceremony on the result screen;
//  - Slop Coins: earned only by playing (matches, quests, levels, the Trophy Road), spent in the shop;
//  - Bot League (P04): trophies per brawler from matches against bots, and the Trophy Road they
//    climb; the bots of your next solo match follow them a little;
//  - cosmetics you own and the ones you wear (cosmetics.js).

import { FREE, GOLD_AT, cosString, SKINS, STARTERS } from './cosmetics.js';

const KEY = 'iaslop-profile';
const blank = () => ({ v: 2, xp: 0, coins: 0, gems: 0, owned: [...FREE, ...STARTERS.map(k => 'brawler:' + k)], trophies: {}, road: 0,
  wear: { skins: {}, trail: 0, ko: 0, frame: 0, title: 1, icon: 0 }, seen: [] });
let P = blank();
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (raw && typeof raw === 'object') P = { ...P, ...raw, wear: { ...P.wear, ...raw.wear } };
  // v0.13.1: brawlers are owned. Anyone who played before keeps all five (nothing is taken away).
  // a veteran: a profile from before v0.13.1, or no profile yet but mastery points (v0.12 and older)
  const veteran = raw ? !raw.v : (() => { try { return Object.keys(JSON.parse(localStorage.getItem('iaslop-mastery') || '{}')).length > 0; } catch { return false; } })();
  if (veteran) {
    for (const k of ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt']) if (!P.owned.includes('brawler:' + k)) P.owned.push('brawler:' + k); // the five of before
    P.v = 2;
    P.gems ??= 0;
  }
} catch { /* private mode */ }
for (const id of FREE) if (!P.owned.includes(id)) P.owned.push(id); // items made free later
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* private mode */ } };

/* ------------------------------ account level ------------------------------ */

export const xpFor = L => 100 + 20 * (L - 1); // XP from level L to L + 1
export function levelInfo(xp = P.xp) {
  let L = 1, rest = xp;
  while (rest >= xpFor(L)) { rest -= xpFor(L); L++; }
  return { level: L, into: rest, need: xpFor(L), frac: rest / xpFor(L) };
}
export const level = () => levelInfo().level;
export const coins = () => P.coins;
export const gems = () => P.gems || 0;

// Levels pay Slop Coins (for brawlers); a few milestones also give a prestige look that is never
// sold (cosmetics are otherwise Gems only).
export const LEVEL_REWARDS = { 10: 'frame:3', 20: 'title:13', 25: 'frame:10', 30: 'title:14' };
export const levelCoins = L => 50 + 10 * Math.min(L, 20);

/* ------------------------------ Bot League ------------------------------ */

// Trophies from a match against bots, by placement (1st .. 8th). Losses are gentle while you are low.
const TROPHY_DELTA = [10, 7, 5, 3, 1, -1, -3, -5];
export const trophies = key => P.trophies[key] || 0;
export const totalTrophies = () => Object.values(P.trophies).reduce((s, n) => s + n, 0);
export function trophyDelta(key, rank) {
  const d = TROPHY_DELTA[Math.min(8, Math.max(1, rank)) - 1], n = trophies(key);
  return d >= 0 ? d : n < 50 ? 0 : n < 150 ? Math.ceil(d / 2) : d;
}

// Trophy Road: rewards along your total trophies (every brawler counts).
export const ROAD = [
  [10, 'coins:100'], [25, 'coins:150'], [40, 'coins:150'], [60, 'icon:28'], [80, 'coins:200'], [100, 'coins:250'],
  [130, 'coins:250'], [160, 'coins:300'], [200, 'coins:300'], [240, 'coins:350'], [280, 'coins:350'], [330, 'coins:400'],
  [380, 'coins:400'], [440, 'coins:450'], [500, 'title:12'], [570, 'coins:500'], [650, 'coins:550'], [740, 'icon:29'],
  [850, 'coins:700'], [1000, 'title:14'],
];
// How far along the road you are: the next milestone and the share of the way to it.
export const roadClaimed = () => P.road; // milestones already paid
export function roadProgress(total = totalTrophies()) {
  const i = ROAD.findIndex(([at]) => total < at);
  if (i < 0) return { next: null, frac: 1, reached: ROAD.length };
  const from = i ? ROAD[i - 1][0] : 0;
  return { next: ROAD[i], frac: (total - from) / (ROAD[i][0] - from), reached: i };
}

// The bots of your next solo match: the hidden level (skill.js), nudged by this brawler's trophies,
// so a climbing brawler meets sharper bots (Bot League), and a new one starts on the gentle side.
export function leagueBotLevel(key, hidden) {
  const t = Math.min(1, trophies(key) / 500);
  return Math.min(1, Math.max(0.05, hidden * 0.75 + t * 0.25));
}

/* ------------------------------ rewards ------------------------------ */

export const owns = id => P.owned.includes(id);
// Give an item or coins ('coins:150'). Returns what it was worth: { id } or { coins }.
function give(id) {
  if (id.startsWith('coins:')) { const n = +id.slice(6); P.coins += n; return { coins: n }; }
  if (!P.owned.includes(id)) P.owned.push(id);
  else { P.coins += 100; return { id, dup: true, coins: 100 }; } // already owned (bought before): coins instead
  return { id };
}

// After a match. vsBots: a solo match (Bot League). Returns everything the result screen shows.
export function awardMatch({ rank, kos = 0, won = false, key, vsBots = false, mastery = 0 }) {
  const before = levelInfo();
  const xp = 30 + 5 * Math.min(kos, 7) + (rank <= 4 ? 10 : 0) + (won ? 15 : 0);
  const earned = 5 + (rank <= 4 ? 5 : 0) + (won ? 10 : 0) + 2 * Math.min(kos, 7);
  P.xp += xp;
  P.coins += earned;
  const after = levelInfo(), rewards = [];
  for (let L = before.level + 1; L <= after.level; L++) {
    rewards.push({ ...give('coins:' + levelCoins(L)), level: L });
    if (LEVEL_REWARDS[L]) rewards.push({ ...give(LEVEL_REWARDS[L]), level: L });
  }
  // golden figurine at mastery 10
  if (key && mastery >= GOLD_AT && !owns(`skin:${key}:3`)) rewards.push({ ...give(`skin:${key}:3`), mastery: true });
  let league = null;
  if (vsBots && key) {
    P.road = Math.max(P.road || 0, roadProgress().reached); // saves from before the high-water mark
    const d = trophyDelta(key, rank);
    P.trophies[key] = Math.max(0, trophies(key) + d);
    const road = roadProgress();
    // trophies go down too: each milestone pays once (P.road: how many were paid)
    for (let i = P.road; i < road.reached; i++) rewards.push({ ...give(ROAD[i][1]), road: ROAD[i][0] });
    P.road = Math.max(P.road, road.reached);
    league = { delta: d, trophies: trophies(key), total: totalTrophies(), road };
  }
  save();
  return { xp, coins: earned, before, after, rewards, league };
}

// Quest rewards (quests.js).
export function grant({ coins: c = 0, xp = 0 }) {
  const before = levelInfo();
  P.coins += c; P.xp += xp;
  const after = levelInfo(), rewards = [];
  for (let L = before.level + 1; L <= after.level; L++) {
    rewards.push({ ...give('coins:' + levelCoins(L)), level: L });
    if (LEVEL_REWARDS[L]) rewards.push({ ...give(LEVEL_REWARDS[L]), level: L });
  }
  save();
  return { before, after, rewards };
}

// A one-off unlock (the Quester title of the first weekly quest).
export function unlock(id) { const r = give(id); save(); return r; }

/* ------------------------------ shop and wardrobe ------------------------------ */

// Buy with 'gems' (cosmetics, brawlers) or 'coins' (brawlers only).
export function buy(id, price, currency = 'gems') {
  const wallet = currency === 'coins' ? 'coins' : 'gems';
  if (owns(id) || (P[wallet] || 0) < price) return false;
  if (currency === 'coins' && !id.startsWith('brawler:')) return false; // coins never buy looks
  P[wallet] -= price;
  P.owned.push(id);
  save();
  return true;
}
export const ownsBrawler = key => owns('brawler:' + key);
// Gems from a pack (the store's purchase callback; test mode in dev builds only, see metaui.js).
export function addGems(n) { P.gems = (P.gems || 0) + n; save(); }

export const wearing = () => P.wear;
export function wear(kind, n, brawler) {
  if (kind === 'skin') P.wear.skins[brawler] = n;
  else P.wear[kind] = n;
  save();
}
// Can this be worn? Skin 0 and 'none' entries always.
export function canWear(kind, n, brawler) {
  if (n === 0 && kind !== 'title' && kind !== 'icon') return true;
  return owns(kind === 'skin' ? `skin:${brawler}:${n}` : `${kind}:${n}`);
}
// What you show with this brawler, as the network string (cosmetics.js).
export function cosFor(brawler) {
  const W = P.wear, skin = W.skins[brawler] || 0;
  return cosString({ skin: skin < SKINS.length && canWear('skin', skin, brawler) ? skin : 0, trail: W.trail, ko: W.ko,
    frame: W.frame, title: W.title, icon: W.icon });
}

// Items unlocked but not looked at yet (a dot on the collection button).
export const unseen = () => P.owned.filter(id => !P.seen.includes(id) && !FREE.includes(id) && !id.startsWith('brawler:'));
export function markSeen() { P.seen = P.owned.slice(); save(); }

// Dev tools / tests: add coins.
export function addCoins(n) { P.coins += n; save(); }
