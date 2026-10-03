// Writes package.json's version into the Godot client: godot/project.godot (application/config/version)
// and every export preset of godot/export_presets.cfg:
//   Android  version/name = x.y.z, version/code = the Play versionCode below
//   iOS      application/short_version = x.y.z (CFBundleShortVersionString),
//            application/version = the same build number as Android (CFBundleVersion)
//   Windows  application/file_version + product_version = x.y.z.b (the exe's VERSIONINFO)
// Web, Linux and macOS have no version field.
//
// Android versionCode (decision D4 of docs/godot-migration.md): (major*10000 + minor*100 + patch)*100 + b
// with b = 99 for a final release and b = N for x.y.z-beta.N (1..98). So 0.17.1 -> 170199 and
// 0.18.0-beta.3 -> 180003 < 0.18.0 -> 180099. Every code is above the Capacitor app's
// (major*10000 + minor*100 + patch = 1701 for 0.17.1), so Play takes the Godot build as an in-place update
// of the same package, and betas sort before their final release on the test tracks.
//
// Run by the release workflow before exporting; tests/godot-version.test.mjs checks the files are in sync.
// Usage: node scripts/godot-version.mjs          (write)
//        node scripts/godot-version.mjs --check  (exit 1 when a file is out of date)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** "x.y.z" or "x.y.z-beta.N" -> { major, minor, patch, beta } (beta 0 for a final), else null. */
export function parseGodotVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(String(v ?? ''));
  if (!m) return null;
  const [major, minor, patch, beta] = [+m[1], +m[2], +m[3], m[4] === undefined ? 0 : +m[4]];
  if (minor > 99 || patch > 99) return null;
  if (m[4] !== undefined && (beta < 1 || beta > 98)) return null;
  return { major, minor, patch, beta };
}

/** Play versionCode / iOS build number (see the header). null for a version the scheme cannot encode. */
export function godotVersionCode(v) {
  const p = parseGodotVersion(v);
  if (!p) return null;
  const code = (p.major * 10000 + p.minor * 100 + p.patch) * 100 + (p.beta || 99);
  return code <= 2100000000 ? code : null; // Play's maximum versionCode
}

/** Plain x.y.z of a version (betas included), for the fields that only take numbers. */
const baseVersion = p => `${p.major}.${p.minor}.${p.patch}`;

/** The [preset.N.options] values to write, per platform. */
export function presetValues(platform, v) {
  const p = parseGodotVersion(v);
  if (!p) throw new Error(`version ${v} is not x.y.z or x.y.z-beta.N (1..98)`);
  const code = godotVersionCode(v);
  if (platform === 'Android') return { 'version/code': String(code), 'version/name': `"${v}"` };
  if (platform === 'iOS') return { 'application/short_version': `"${baseVersion(p)}"`, 'application/version': `"${code}"` };
  if (platform === 'Windows Desktop') {
    const four = `"${baseVersion(p)}.${p.beta || 99}"`;
    return { 'application/file_version': four, 'application/product_version': four };
  }
  return {};
}

/** Sets key=value in one section of an ini-like Godot file (added at the section's end when missing). */
function setInSection(text, section, values) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'; // autocrlf checkouts on Windows
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim() === `[${section}]`);
  if (start < 0) throw new Error(`section [${section}] not found`);
  let end = lines.findIndex((l, i) => i > start && /^\[.+\]\s*$/.test(l));
  if (end < 0) end = lines.length;
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l, j) => j > start && j < end && l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else {
      let at = end; // after the last non-empty line of the section
      while (at > start + 1 && lines[at - 1].trim() === '') at--;
      lines.splice(at, 0, `${key}=${value}`);
      end++;
    }
  }
  return lines.join(eol);
}

/** export_presets.cfg text with every preset's version fields set to v. */
export function applyPresets(cfg, v) {
  let out = cfg;
  for (const m of cfg.matchAll(/^\[preset\.(\d+)\]\s*$/gm)) {
    const id = m[1];
    const head = out.slice(out.indexOf(`[preset.${id}]`));
    const platform = /^platform="([^"]*)"/m.exec(head)?.[1];
    const values = presetValues(platform, v);
    if (Object.keys(values).length) out = setInSection(out, `preset.${id}.options`, values);
  }
  return out;
}

/** project.godot text with application/config/version = v. */
export function applyProject(project, v) {
  return setInSection(project, 'application', { 'config/version': `"${v}"` });
}

const root = new URL('../', import.meta.url);
export const files = {
  project: new URL('godot/project.godot', root),
  presets: new URL('godot/export_presets.cfg', root),
};

export function packageVersion() {
  return JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const v = packageVersion();
  const code = godotVersionCode(v);
  if (!code) throw new Error(`package.json version ${v} is not x.y.z or x.y.z-beta.N (1..98)`);
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [name, apply] of [['project', applyProject], ['presets', applyPresets]]) {
    const before = readFileSync(files[name], 'utf8');
    const after = apply(before, v);
    if (after === before) continue;
    stale++;
    if (!check) writeFileSync(files[name], after);
  }
  if (check && stale) {
    console.error(`Godot version files are not at ${v}: run npm run godot:version`);
    process.exit(1);
  }
  console.log(`Godot version ${v} (Android versionCode / iOS build ${code})${stale ? (check ? '' : ', written') : ', already set'}`);
}
