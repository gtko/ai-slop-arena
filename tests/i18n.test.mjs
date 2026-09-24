// Every locale has exactly the English keys, the same {placeholders}, and plural objects with 'other'.
import { readFileSync, readdirSync } from 'node:fs';

const en = (await import(new URL('../src/i18n/en.js', import.meta.url))).default;
const dir = new URL('../src/i18n/locales/', import.meta.url);
const ph = v => (JSON.stringify(v).match(/\{\w+\}/g) || []).sort().join();
const problems = [];
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
for (const f of files) {
  const d = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  for (const k of Object.keys(en)) {
    if (!(k in d)) { problems.push(`${f}: missing ${k}`); continue; }
    if (typeof en[k] === 'string' && ph(en[k]) !== ph(d[k])) problems.push(`${f}: placeholders differ in ${k}`);
    if (typeof en[k] === 'object' && !('other' in d[k])) problems.push(`${f}: ${k} has no 'other' form`);
  }
  for (const k of Object.keys(d)) if (!(k in en)) problems.push(`${f}: unknown key ${k}`);
}
if (files.length !== 29) problems.push(`expected 29 locales, found ${files.length}`);
if (problems.length) { console.error(problems.slice(0, 30).join('\n')); console.error(`\n${problems.length} i18n problem(s)`); process.exit(1); }
console.log(`ok   ${files.length} locales x ${Object.keys(en).length} keys`);
