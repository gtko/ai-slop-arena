// The model textures Godot extracts from the GLBs (godot/assets/models/**/*.webp) must stay VRAM
// compressed with mipmaps and keep the glTF md5 Godot uses to refresh them: an editor run can rewrite
// a .import to lossless (uncompressed RGBA in GPU memory, no mipmaps), and without the md5 Godot never
// fixes it again. Runs in npm test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const tracked = new Set(execFileSync('git', ['ls-files', 'godot/assets/models'], { encoding: 'utf8' }).split(/\r?\n/));
const bad = [];
let n = 0;
const walk = dir => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!f.endsWith('.webp.import')) continue;
    if (!tracked.has(p.split('\\').join('/'))) continue;   // only what ships (tracked files)
    n++;
    const s = readFileSync(p, 'utf8');
    const why = [];
    if (!/^compress\/mode=2$/m.test(s)) why.push('not VRAM compressed (compress/mode=2)');
    if (!/^mipmaps\/generate=true$/m.test(s)) why.push('no mipmaps');
    if (!/"md5"/.test(s)) why.push('no glTF md5 (generator_parameters)');
    if (why.length) bad.push(`${p}: ${why.join(', ')}`);
  }
};
walk('godot/assets/models');
if (bad.length) {
  console.error(`FAIL model textures:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`ok   ${n} model textures VRAM compressed with mipmaps`);
