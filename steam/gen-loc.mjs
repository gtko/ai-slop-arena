// Builds steam/achievements_loc.vdf from the game's own translations (src/i18n), for the
// "Import localization" button on the Steamworks Stats & Achievements page.
//
//   node steam/gen-loc.mjs
//
// Steamworks names achievement tokens after the order they were created in:
// NEW_ACHIEVEMENT_1_0 for the first one, then 1_1, 1_2... Create them in the order of ACHIEVEMENTS
// in src/achievements.js (the same order as steam/README.md), or export the file from Steamworks
// first and adjust ORDER below to match its tokens.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = (await import(pathToFileURL(join(root, 'src/i18n/en.js')))).default;
const src = readFileSync(join(root, 'src/i18n/index.js'), 'utf8');
const LANGS = [...src.matchAll(/\['([\w-]+)', '[^']+', '(\w+)'\]/g)].map(m => [m[1], m[2]]);
const ORDER = ['FIRST_KO', 'FIRST_WIN', 'RAMPAGE', 'POWER_HUNGRY', 'ONLINE_WIN', 'SQUAD_UP', 'WORLD_TOUR', 'JACK_OF_ALL', 'VETERAN', 'CENTURION'];

const locales = Object.fromEntries(readdirSync(join(root, 'src/i18n/locales'))
  .map(f => [f.replace('.json', ''), JSON.parse(readFileSync(join(root, 'src/i18n/locales', f), 'utf8'))]));
const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

let out = '"lang"\n{\n';
for (const [code, steamLang] of LANGS) {
  const d = { ...en, ...(locales[code] || {}) };
  out += `\t"${steamLang}"\n\t{\n\t\t"Tokens"\n\t\t{\n`;
  ORDER.forEach((id, i) => {
    out += `\t\t\t"NEW_ACHIEVEMENT_1_${i}_NAME"\t"${esc(d[`ach.${id}`])}"\n`;
    out += `\t\t\t"NEW_ACHIEVEMENT_1_${i}_DESC"\t"${esc(d[`ach.${id}.desc`])}"\n`;
  });
  out += '\t\t}\n\t}\n';
}
out += '}\n';
writeFileSync(join(root, 'steam/achievements_loc.vdf'), out);
console.log(`steam/achievements_loc.vdf: ${LANGS.length} languages x ${ORDER.length} achievements`);
