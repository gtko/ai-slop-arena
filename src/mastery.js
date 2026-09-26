// Brawler mastery (v0.12, P02 core) and the chosen loadout, both kept on this device.
// Every match with a brawler earns mastery points; level 2 unlocks its gadget B, level 4 its star
// power 2 (short gates: sidegrades, not grind). Levels 5-10 are for show until cosmetics (v0.13).

const KEY = 'iaslop-mastery', LO_KEY = 'iaslop-loadout';
export const LEVELS = [0, 30, 80, 150, 250, 380, 540, 740, 980, 1260]; // points to reach level 1..10
export const GADGET_B_AT = 2, STAR_2_AT = 4;

const read = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const points = key => read(KEY)[key] || 0;
export function levelOf(p) {
  let l = 1;
  for (let i = 1; i < LEVELS.length; i++) if (p >= LEVELS[i]) l = i + 1;
  return l;
}
export const level = key => levelOf(points(key));

// { level, frac } toward the next level (frac 1 at the max level)
export function progress(key) {
  const p = points(key), l = levelOf(p);
  if (l >= LEVELS.length) return { level: l, frac: 1, p };
  return { level: l, frac: (p - LEVELS[l - 1]) / (LEVELS[l] - LEVELS[l - 1]), p };
}

// After a match: 10 for playing, +10 top 4, +15 win, +5 per KO. Returns the before/after levels.
export function award(key, { rank, kos = 0 }) {
  const all = read(KEY), before = levelOf(all[key] || 0);
  const gained = 10 + (rank <= 4 ? 10 : 0) + (rank === 1 ? 15 : 0) + 5 * Math.min(kos, 7);
  all[key] = (all[key] || 0) + gained;
  write(KEY, all);
  return { gained, before, after: levelOf(all[key]), ...progress(key) };
}

// Loadout 'A1' .. 'B2' (gadget A/B, star power 1/2), locked options fall back to A / 1.
export function loadout(key) {
  const lo = read(LO_KEY)[key] || 'A1', l = level(key);
  const g = lo[0] === 'B' && l >= GADGET_B_AT ? 'B' : 'A', s = lo[1] === '2' && l >= STAR_2_AT ? '2' : '1';
  return g + s;
}
export function setLoadout(key, lo) {
  const all = read(LO_KEY);
  all[key] = lo;
  write(LO_KEY, all);
}
export const brawlerString = key => `${key}:${loadout(key)}`;
