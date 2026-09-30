// Exports the game data the Godot client needs from the JS source of truth (src/), so the two
// clients never drift: maps (expanded 25x25 grids) and brawler stats. Run: node godot/tools/export-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { MAPS } from '../../src/maps.js';

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
console.log(`maps: ${Object.keys(out).length}, brawlers: ${Object.keys(types).length}`);
