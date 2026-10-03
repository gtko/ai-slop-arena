// Exports the Godot client for the web and uploads it to the R2 bucket that worker/godot-web.js serves
// at /godot/. Usage:
//   npm run deploy:godot-web                 export + upload to production R2 (godot/<package.json version>/)
//   npm run deploy:godot-web -- --local      upload to the local R2 of `wrangler dev` instead (testing)
//   options: --skip-export (reuse godot/build/web-deploy), --force (overwrite an uploaded version),
//            --version X.Y.Z (default: package.json)
// Godot: the GODOT env var, else Godot 4.5.2 unzipped in %LOCALAPPDATA%/Godot/4.5.2 (the official
// Godot_v4.5.2-stable_win64.exe.zip; the web export templates must be installed). The worker deploy picks the files of its own version, so upload before `npm run deploy`.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync, constants } from 'node:zlib';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..');
const BUCKET = 'ai-slop-arena-godot-web';
const OUT = join(ROOT, 'godot', 'build', 'web-deploy');
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const local = flag('--local');
const version = opt('--version', JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version || '')) throw new Error(`bad version "${version}" (expected X.Y.Z)`);
const GODOT = process.env.GODOT || join(process.env.LOCALAPPDATA || '', 'Godot', '4.5.2', 'Godot_v4.5.2-stable_win64_console.exe');

const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', wasm: 'application/wasm',
  pck: 'application/octet-stream', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon',
  json: 'application/json', webmanifest: 'application/manifest+json',
};
const COMPRESS = new Set(['html', 'js', 'wasm', 'pck', 'svg', 'json', 'webmanifest']);
const mb = n => n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
// wrangler's own entry point through node: no shell, so arguments with spaces stay whole on Windows.
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const wrangler = (cmdArgs, quiet = false) => spawnSync(process.execPath, [WRANGLER, ...cmdArgs], {
  cwd: ROOT, stdio: quiet ? 'pipe' : ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1 << 30,
});

// 1. Export (import first: a fresh checkout has no .godot/ cache).
if (!flag('--skip-export')) {
  if (!existsSync(GODOT)) throw new Error(`Godot not found at ${GODOT} (set GODOT)`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const godot = a => execFileSync(GODOT, ['--headless', '--path', join(ROOT, 'godot'), ...a], { stdio: 'inherit' });
  console.log('Godot: importing...');
  godot(['--import']);
  console.log('Godot: exporting the Web preset...');
  godot(['--export-release', 'Web', join(OUT, 'index.html')]);
}
const files = readdirSync(OUT).filter(f => statSync(join(OUT, f)).isFile());
for (const need of ['index.html', 'index.js', 'index.wasm', 'index.pck']) {
  if (!files.includes(need)) throw new Error(`${need} missing from ${OUT}: the export failed`);
}

// 2. Never replace a published version: its files are cached for a year by the browsers.
const prefix = `godot/${version}`;
if (!local && !flag('--force')) {
  const probe = wrangler(['r2', 'object', 'get', `${BUCKET}/${prefix}/index.html`, '--remote', '--pipe'], true);
  if (probe.status === 0 && probe.stdout.length > 0) {
    throw new Error(`${prefix}/ is already uploaded; bump the version, or pass --force (players may keep stale cached files)`);
  }
  // fail closed: only a clear "not found" means the version is new (a network or auth error must not
  // let an upload overwrite files that browsers cache as immutable)
  if (probe.status !== 0 && !/not found|does not exist|NoSuchKey|10007/i.test(`${probe.stderr}${probe.stdout}`)) {
    throw new Error(`could not check whether ${prefix}/ exists (wrangler: ${(probe.stderr || '').trim().slice(0, 300)}); retry, or pass --force`);
  }
}

// 3. Compress, then upload (index.html last: the rest is in place when the page appears).
const tmp = join(tmpdir(), `godot-web-${version}-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
let total = 0;
const order = files.filter(f => f !== 'index.html').concat('index.html');
for (const f of order) {
  const ext = f.split('.').pop().toLowerCase();
  const raw = readFileSync(join(OUT, f));
  let body = raw, encoding = '';
  if (COMPRESS.has(ext)) {
    const gz = gzipSync(raw, { level: constants.Z_BEST_COMPRESSION });
    if (gz.length < raw.length * 0.95) { body = gz; encoding = 'gzip'; }
  }
  const src = join(tmp, f);
  writeFileSync(src, body);
  total += body.length;
  console.log(`${prefix}/${f}  ${mb(raw.length)}${encoding ? ` -> ${mb(body.length)} gzip` : ''}`);
  const put = ['r2', 'object', 'put', `${BUCKET}/${prefix}/${f}`, '--file', src,
    '--content-type', TYPES[ext] || 'application/octet-stream',
    '--cache-control', 'public, max-age=31536000, immutable',
    local ? '--local' : '--remote'];
  if (encoding) put.push('--content-encoding', encoding);
  const r = wrangler(put);
  if (r.status !== 0) throw new Error(`upload of ${f} failed:\n${r.stdout || ''}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\nUploaded ${files.length} files (${mb(total)} stored) to ${local ? 'LOCAL' : 'production'} R2 ${BUCKET}/${prefix}/`);
console.log(local ? 'Test: npx wrangler dev --port 8788, then open http://localhost:8788/godot/'
  : `Live at /godot/ once the worker of v${version} is deployed (npm run deploy).`);
