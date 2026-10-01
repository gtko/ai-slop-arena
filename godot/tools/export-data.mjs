// Exports the game data the Godot client needs from the JS source of truth (src/), so the two
// clients never drift: maps (expanded 25x25 grids), brawler stats and cosmetics. Run: node godot/tools/export-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { MAPS } from '../../src/maps.js';
import * as COS from '../../src/cosmetics.js';
import * as PR from '../../src/profile.js'; // its localStorage reads are wrapped in try: fine under node

const N = 25;
const out = {};
for (const [key, m] of Object.entries(MAPS)) {
  const grid = [];
  for (let j = 0; j < N; j++) {
    let row = '';
    for (let i = 0; i < N; i++) {
      const q = m.layout && m.layout[Math.min(j, N - 1 - j)];
      row += m.full ? (m.full[j] && m.full[j][i]) || 'V' : (q && q[Math.min(i, N - 1 - i)]) || '.';
    }
    grid.push(row);
  }
  const { layout, full, ...rest } = m; // every other field (theme, weather, kit options...) goes through untouched
  out[key] = { key, ...rest, vision: m.vision || 0, grid };
}
writeFileSync(new URL('../data/maps.json', import.meta.url), JSON.stringify(out, null, 1));

// brawler.js imports three: read the TYPES literal as text instead of loading the module
const src = readFileSync(new URL('../../src/brawler.js', import.meta.url), 'utf8');
const start = src.indexOf('export const TYPES = {');
const end = src.indexOf('\n};', start);
const types = new Function(`return ${src.slice(start + 'export const TYPES = '.length, end + 3)}`)();
for (const t of Object.values(types)) delete t.desc;
writeFileSync(new URL('../data/brawlers.json', import.meta.url), JSON.stringify(types, null, 1));

// Cosmetics: src/cosmetics.js is pure data (skins with their recolours, trails, K.O. effects, the `cos`
// string format). TRAIL_FX (particle colours, HDR) lives in effects.js, which imports three: read its
// literal as text, like TYPES above.
const fx = readFileSync(new URL('../../src/effects.js', import.meta.url), 'utf8');
const fxStart = fx.indexOf('const TRAIL_FX = {');
const fxEnd = fx.indexOf('\n};', fxStart);
const trailFx = new Function(`return ${fx.slice(fxStart + 'const TRAIL_FX = '.length, fxEnd + 3)}`)();
writeFileSync(new URL('../data/cosmetics.json', import.meta.url), JSON.stringify({
  skins: COS.SKINS, recolours: COS.RECOLOURS, goldAt: COS.GOLD_AT, trails: COS.TRAILS, trailFx, kofx: COS.KOFX, cosDefault: COS.COS_DEFAULT,
  // the shop and the collection (metaui.js) and the profile's economy (profile.js)
  trailIcons: COS.TRAIL_ICONS, kofxIcons: COS.KOFX_ICONS, emotes: COS.EMOTES, emoteIcons: COS.EMOTE_ICONS, emoteFree: COS.EMOTE_FREE,
  frames: COS.FRAMES, titles: COS.TITLES, icons: COS.ICONS, free: COS.FREE, price: COS.PRICE, starters: COS.STARTERS,
  brawlerPrice: COS.BRAWLER_PRICE, skinCoins: COS.SKIN_COINS, gemPacks: COS.GEM_PACKS, earned: [...COS.EARNED],
  levelRewards: PR.LEVEL_REWARDS, road: PR.ROAD,
}, null, 1));
console.log(`maps: ${Object.keys(out).length}, brawlers: ${Object.keys(types).length}, cosmetics: ok`);
