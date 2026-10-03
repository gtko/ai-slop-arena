// Exports the strings of the web build (src/i18n: en.js + locales/*.json, 30 languages) to
// godot/data/i18n/<code>.json, plus the Godot-only strings of godot/tools/i18n-extra.json
// (English and French complete; other languages fall back to English for those keys).
// en.json holds every key; another locale only holds its own keys (i18n.gd falls back to en).
// Run: node godot/tools/export-i18n.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import en from '../../src/i18n/en.js';

const out = new URL('../data/i18n/', import.meta.url);
mkdirSync(out, { recursive: true });
const extra = JSON.parse(readFileSync(new URL('./i18n-extra.json', import.meta.url), 'utf8'));
const write = (code, dict) => writeFileSync(new URL(`${code}.json`, out), JSON.stringify(dict));

write('en', { ...en, ...extra.en });
const codes = [];
for (const f of readdirSync(new URL('../../src/i18n/locales/', import.meta.url))) {
  const code = f.replace(/\.json$/, '');
  const dict = JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${f}`, import.meta.url), 'utf8'));
  write(code, { ...dict, ...(extra[code] || {}) });
  codes.push(code);
}
// the language list for the settings screen: src/i18n/langs.json ([code, native name, Steam name])
const langs = JSON.parse(readFileSync(new URL('../../src/i18n/langs.json', import.meta.url), 'utf8')).map(([code, name]) => ({ code, name }));
writeFileSync(new URL('langs.json', out), JSON.stringify(langs));
console.log(`i18n: en + ${codes.length} locales, ${langs.length} languages, ${Object.keys(en).length + Object.keys(extra.en).length} keys`);
