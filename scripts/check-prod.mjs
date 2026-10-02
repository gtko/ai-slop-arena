// After `npm run deploy`: checks the live server. Usage: node scripts/check-prod.mjs [origin]
// - the site and the game page answer and serve the bundle just built (dist/play.html);
// - a room accepts the current protocol and refuses an old one ("outdated");
// - the matchmaking queue answers;
// - the mobile apps' update manifest announces this version (docs/ota-updates.md);
// - /godot/ serves this version's Godot web export from R2 (npm run deploy:godot-web), with the right headers.
import { readFileSync } from 'node:fs';

const ORIGIN = process.argv[2] || 'https://ai-slop-arena.gtux-prog.workers.dev';
const WS = ORIGIN.replace(/^http/, 'ws');
const PROTOCOL = +readFileSync(new URL('../src/net.js', import.meta.url), 'utf8').match(/PROTOCOL = (\d+)/)[1];
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const first = (url, want, ms = 6000) => new Promise(resolve => {
  const ws = new WebSocket(url);
  const done = v => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(v); };
  const timer = setTimeout(() => done(null), ms);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (want.includes(m.t)) done(m); };
  ws.onerror = () => done(null);
});

const home = await fetch(ORIGIN + '/');
check(home.ok, `site ${ORIGIN}/ -> ${home.status}`);
const play = await (await fetch(`${ORIGIN}/play?nocache=${Date.now()}`)).text();
const local = readFileSync(new URL('../dist/play.html', import.meta.url), 'utf8');
const bundle = s => (s.match(/assets\/play-[\w-]+\.js/) || [])[0];
check(bundle(play) && bundle(play) === bundle(local), `game page serves this build (${bundle(play)})`);
const room = 'Z' + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
const id = `v=${PROTOCOL}&cid=prodcheck${Date.now()}&plat=web&name=check&b=volt`;
const welcome = await first(`${WS}/ws/${room}?${id}`, ['welcome', 'error']);
check(welcome && welcome.t === 'welcome', `room accepts protocol v${PROTOCOL}`);
const old = await first(`${WS}/ws/${room}?name=old&b=volt`, ['welcome', 'error']);
check(old && old.t === 'error' && old.code === 'outdated', 'room refuses old clients (outdated)');
const queue = await first(`${WS}/mm?${id}`, ['queue', 'matched', 'error']);
check(queue && queue.t === 'queue', 'matchmaking queue answers');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ota = await fetch(`${ORIGIN}/app/latest.json?nocache=${Date.now()}`).then(r => r.ok ? r.json() : null).catch(() => null);
check(ota && ota.version === version && ota.url.endsWith(`/v${version}/AISlopArena-app-bundle.zip`) && !!ota.minNative,
  `app update manifest announces v${version}${ota ? ` (minNative ${ota.minNative})` : ''}`);
const godot = await fetch(`${ORIGIN}/godot/`, { redirect: 'manual' });
check(godot.status === 302 && godot.headers.get('location') === `/godot/${version}/`, `/godot/ points to the Godot web build v${version}`);
const head = f => fetch(`${ORIGIN}/godot/${version}/${f}`, { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } }).catch(() => null);
const want = { 'index.html': 'text/html', 'index.js': 'text/javascript', 'index.wasm': 'application/wasm', 'index.pck': 'application/octet-stream' };
for (const [f, type] of Object.entries(want)) {
  const r = await head(f);
  const h = k => r?.headers.get(k) || '';
  check(r?.ok && h('content-type').startsWith(type) && h('cache-control').includes('immutable') && (f === 'index.html' || h('content-encoding') === 'gzip'),
    `Godot web ${f}: ${r ? `${r.status} ${h('content-type')}, ${h('content-encoding') || 'identity'}, ${h('cache-control')}` : 'no answer'}`);
}
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nproduction looks good');
