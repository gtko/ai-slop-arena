// After `npm run deploy`: checks the live server. Usage: node scripts/check-prod.mjs [origin]
// - the site answers and serves the bundle just built (dist/index.html);
// - /play (the game's URL, invite links ?room=CODE) redirects to the Godot web client, query kept;
// - a room accepts the current protocol and refuses an old one ("outdated");
// - the matchmaking queue answers;
// - the old Capacitor apps' update manifest stays frozen on their last bundle (docs/ota-updates.md);
// - /godot/ serves this version's Godot web export from R2 (npm run deploy:godot-web), with the right headers.
import { readFileSync } from 'node:fs';

const ORIGIN = process.argv[2] || 'https://ai-slop-arena.gtux-prog.workers.dev';
const WS = ORIGIN.replace(/^http/, 'ws');
const PROTOCOL = +readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8').match(/PROTOCOL = (\d+)/)[1];
const { FROZEN_APP_BUNDLE } = await import(new URL('../src/updates.js', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const first = (url, want, ms = 6000) => new Promise(resolve => {
  const ws = new WebSocket(url);
  const done = v => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(v); };
  const timer = setTimeout(() => done(null), ms);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (want.includes(m.t)) done(m); };
  ws.onerror = () => done(null);
});

const home = await fetch(`${ORIGIN}/?nocache=${Date.now()}`).catch(() => null);
check(home?.ok, `site ${ORIGIN}/ -> ${home?.status}`);
const page = home?.ok ? await home.text() : '';
const local = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const bundle = s => (s.match(/assets\/site-[\w-]+\.js/) || [])[0];
check(bundle(page) && bundle(page) === bundle(local), `site serves this build (${bundle(page)})`);
for (const path of ['/play?room=ABCD', '/play.html', '/play/']) {
  const r = await fetch(ORIGIN + path, { redirect: 'manual' }).catch(() => null);
  const want = `/godot/${version}/${path.includes('?') ? path.slice(path.indexOf('?')) : ''}`;
  check(r?.status === 302 && r.headers.get('location') === want, `${path} -> Godot web client (${r?.status} ${r?.headers.get('location')})`);
}
const room = 'Z' + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
const id = `v=${PROTOCOL}&cid=prodcheck${Date.now()}&plat=web&name=check&b=volt`;
const welcome = await first(`${WS}/ws/${room}?${id}`, ['welcome', 'error']);
check(welcome && welcome.t === 'welcome', `room accepts protocol v${PROTOCOL}`);
const old = await first(`${WS}/ws/${room}?name=old&b=volt`, ['welcome', 'error']);
check(old && old.t === 'error' && old.code === 'outdated', 'room refuses old clients (outdated)');
const queue = await first(`${WS}/mm?${id}`, ['queue', 'matched', 'error']);
check(queue && queue.t === 'queue', 'matchmaking queue answers');
const ota = await fetch(`${ORIGIN}/app/latest.json?nocache=${Date.now()}`).then(r => r.ok ? r.json() : null).catch(() => null);
check(ota && ota.version === FROZEN_APP_BUNDLE && ota.url.endsWith(`/v${FROZEN_APP_BUNDLE}/AISlopArena-app-bundle.zip`) && !!ota.minNative,
  `old apps' update manifest frozen on v${FROZEN_APP_BUNDLE}${ota ? ` (got v${ota.version}, minNative ${ota.minNative})` : ''}`);
const godot = await fetch(`${ORIGIN}/godot/`, { redirect: 'manual' }).catch(() => null);
check(godot?.status === 302 && godot.headers.get('location') === `/godot/${version}/`, `/godot/ points to the Godot web build v${version}`);
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
