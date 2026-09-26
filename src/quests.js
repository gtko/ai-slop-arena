// Quests (v0.13 LEVEL UP, P03): 3 daily quests and 1 weekly quest, pinned on a cork board. They
// count from the matches you play (solo and online, not the training dojo); a finished quest gets
// its stamp and pays at once. One reroll a day swaps an unfinished daily quest.

import { grant, owns, unlock } from './profile.js';
import { weekIndex } from './mutators.js'; // the same weeks as the Weekly Chaos

const KEY = 'iaslop-quests';
// kind -> [target range, coins]; {brawler} quests count matches with that brawler.
const DAILY = {
  play: [[3, 4], 40], top4: [[2, 3], 50], win: [[1, 1], 60], kos: [[6, 10], 50], dmg: [[12000, 20000], 50],
  cubes: [[8, 14], 45], gadgets: [[5, 8], 45], supers: [[4, 6], 50], crates: [[6, 10], 40], brawler: [[2, 3], 45], emotes: [[3, 3], 30],
};
const WEEKLY = { win: [4, 6], kos: [35, 50], top4: [10, 14], dmg: [90000, 120000], play: [15, 20] };
const WEEKLY_COINS = 300, WEEKLY_XP = 150, DAILY_XP = 30;
export const QUEST_ICONS = { play: '🎮', top4: '🏅', win: '🏆', kos: '💀', dmg: '💥', cubes: '💎', gadgets: '🧰', supers: '🌟', crates: '📦', brawler: '🎭', emotes: '💬' };

const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
// Time left until the next local midnight / next Monday 00:00 UTC, in ms.
export function resetIn() {
  const now = new Date(), mid = new Date(now); mid.setHours(24, 0, 0, 0);
  return { day: mid - now, week: (weekIndex() + 1) * 7 * 864e5 - 3 * 864e5 - Date.now() };
}

const pick = a => a[Math.floor(Math.random() * a.length)];
const between = ([a, b], step = 1) => Math.round((a + Math.random() * (b - a)) / step) * step;

function makeDaily(kind, brawlers) {
  const [range, coins] = DAILY[kind];
  const q = { kind, n: 0, target: between(range, kind === 'dmg' ? 1000 : 1), coins, done: false };
  if (kind === 'brawler') q.brawler = pick(brawlers);
  return q;
}
function makeWeekly() {
  const kind = pick(Object.keys(WEEKLY));
  return { kind, n: 0, target: between(WEEKLY[kind], kind === 'dmg' ? 5000 : 1), coins: WEEKLY_COINS, done: false };
}

let S = null;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private mode */ } };
// The board, refreshed when a new day / week started. brawlers: the playable keys.
export function board(brawlers) {
  if (!S) try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { S = null; }
  S ||= {};
  if (S.day !== today()) {
    const kinds = Object.keys(DAILY).sort(() => Math.random() - 0.5).slice(0, 3);
    S.day = today(); S.daily = kinds.map(k => makeDaily(k, brawlers)); S.rerolled = false;
  }
  if (S.week !== weekIndex()) { S.week = weekIndex(); S.weekly = makeWeekly(); }
  save();
  return S;
}

// Swap one unfinished daily quest for another kind (once a day).
export function reroll(i, brawlers) {
  const B = board(brawlers), q = B.daily[i];
  if (B.rerolled || !q || q.done) return false;
  const used = new Set(B.daily.map(d => d.kind)), kinds = Object.keys(DAILY).filter(k => !used.has(k));
  B.daily[i] = makeDaily(pick(kinds), brawlers);
  B.rerolled = true;
  save();
  return true;
}

// How much a match counts for one quest kind.
function amount(q, m) {
  switch (q.kind) {
    case 'play': return 1;
    case 'top4': return m.rank <= 4 ? 1 : 0;
    case 'win': return m.won ? 1 : 0;
    case 'brawler': return m.brawler === q.brawler ? 1 : 0;
    default: return m[q.kind] || 0; // kos, dmg, cubes, gadgets, supers, crates, emotes
  }
}

// After a match: m = { rank, won, brawler, kos, dmg, cubes, gadgets, supers, crates, emotes }.
// Returns the quests that moved ({ q, before, done: just finished }) and the rewards paid.
export function recordMatch(m, brawlers) {
  const B = board(brawlers), moved = [];
  let coins = 0, xp = 0;
  for (const [q, weekly] of [...B.daily.map(q => [q, false]), [B.weekly, true]]) {
    if (q.done) continue;
    const add = amount(q, m);
    if (!add) continue;
    const before = q.n;
    q.n = Math.min(q.target, q.n + add);
    const done = q.n >= q.target;
    if (done) { q.done = true; coins += q.coins; xp += weekly ? WEEKLY_XP : DAILY_XP; }
    moved.push({ q, before, done, weekly });
  }
  save();
  const paid = coins || xp ? grant({ coins, xp }) : null;
  // the first weekly quest ever finished gives the "Quester" title
  if (moved.some(x => x.weekly && x.done) && !owns('title:11') && paid) paid.rewards.push(unlock('title:11'));
  return { moved, coins, xp, paid };
}
