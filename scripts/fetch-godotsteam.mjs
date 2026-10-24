// Installs the GodotSteam GDExtension (MIT, https://codeberg.org/godotsteam/godotsteam) into
// godot/addons/godotsteam, where the "Windows (Steam)" / "Linux (Steam)" presets pick it up.
//
//   npm run godot:steam -- --sdk C:\path\to\steamworks_sdk\sdk
//
// The Steamworks redistributables (steam_api64.dll, libsteam_api.so) belong to Valve's SDK licence and the
// repository is public, so neither the plugin nor those files are committed (godot/addons/ is ignored).
// --sdk (or the STEAMWORKS_SDK environment variable) is the `sdk` folder of the Steamworks SDK zip: its
// redistributables replace the ones bundled with the plugin. Without it the plugin's own copies are kept
// (CI: the plugin zip, see .github/actions/godot-steam).
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v4.23.2-gde'; // GodotSteam for Godot 4.4+ (we ship 4.5.x), built against Steamworks SDK 1.65
const ASSET = 'godotsteam-4.23.2-gdextension-plugin-4.4.zip';
const URL_ = `https://codeberg.org/godotsteam/godotsteam/releases/download/${VERSION}/${ASSET}`;
// sha256 of the release zip: it ships in the players' builds, so a replaced asset must stop the script.
// Empty = not pinned yet: the script prints the hash and refuses to go on without --allow-unpinned.
const SHA256 = '';

const root = fileURLToPath(new URL('..', import.meta.url));
const dest = join(root, 'godot', 'addons', 'godotsteam');
const args = process.argv.slice(2);
const flag = n => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const sdk = flag('--sdk') || process.env.STEAMWORKS_SDK;
const zipArg = flag('--zip'); // an already downloaded plugin zip

const work = mkdtempSync(join(tmpdir(), 'godotsteam-'));
try {
  let zip = zipArg && resolve(zipArg);
  if (!zip) {
    console.log(`downloading ${URL_}`);
    const res = await fetch(URL_);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    zip = join(work, ASSET);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const sum = createHash('sha256').update(readFileSync(zip)).digest('hex');
  console.log(`sha256 ${sum}  ${ASSET}`);
  if (SHA256 && sum !== SHA256) throw new Error(`sha256 mismatch (expected ${SHA256}): the release asset changed`);
  if (!SHA256 && !args.includes('--allow-unpinned')) throw new Error('SHA256 is not pinned in this script: check the hash above against the release, set SHA256, or pass --allow-unpinned');

  const out = join(work, 'x');
  mkdirSync(out);
  try { execFileSync('unzip', ['-q', '-o', zip, '-d', out]); } catch { execFileSync('tar', ['-xf', zip, '-C', out]); } // bsdtar reads zips on Windows

  const find = (dir) => { // the folder that holds godotsteam.gdextension, wherever the zip put it
    if (existsSync(join(dir, 'godotsteam.gdextension'))) return dir;
    for (const f of readdirSync(dir)) {
      if (statSync(join(dir, f)).isDirectory()) { const r = find(join(dir, f)); if (r) return r; }
    }
    return null;
  };
  const src = find(out);
  if (!src) throw new Error('godotsteam.gdextension not found in the plugin zip');

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });

  if (sdk) {
    const bin = join(resolve(sdk), 'redistributable_bin');
    for (const [from, to] of [['win64/steam_api64.dll', 'win64/steam_api64.dll'], ['linux64/libsteam_api.so', 'linux64/libsteam_api.so']]) {
      if (!existsSync(join(bin, from))) throw new Error(`${join(bin, from)} not found: --sdk must be the "sdk" folder of the Steamworks SDK`);
      mkdirSync(join(dest, to, '..'), { recursive: true });
      copyFileSync(join(bin, from), join(dest, to));
      console.log(`SDK redistributable -> addons/godotsteam/${to}`);
    }
  }

  const need = ['godotsteam.gdextension', 'win64/steam_api64.dll', 'linux64/libsteam_api.so'];
  const missing = need.filter(f => !existsSync(join(dest, f)));
  if (missing.length) {
    console.error(`missing in godot/addons/godotsteam: ${missing.join(', ')}${sdk ? '' : ' (pass --sdk <Steamworks sdk folder>)'}`);
    process.exitCode = 1;
  } else {
    console.log(`GodotSteam ${VERSION} installed in godot/addons/godotsteam`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
