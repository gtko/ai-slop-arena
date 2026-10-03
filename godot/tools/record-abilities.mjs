// The home screen's ability previews (godot/scripts/ability_preview.gd): a short looping clip of
// every gadget and star power, filmed with the game's own renderer. Re-run it when an ability, a
// brawler model or an effect changes:
//
//   npx vite build --mode server                         # worker/build/sim.js (npm test does it too)
//   node godot/tools/record-abilities.mjs [--only=gad_voltB,star_surge] [--keep] [--reuse]
//
// 1. tools/stage-abilities.mjs plays each scene with the real rules (offline) -> godot/build/abilities/*.json
// 2. Godot films it (tools/record_abilities.gd, Movie Maker, 960x600 at 30 fps, a desktop GPU: not headless)
//    into <tmp>/ability-frames/<clip>/ (--keep keeps them, --reuse encodes the kept ones again)
// 3. ffmpeg keeps the clip's frames, scaled to 480x300, and Blender's FFmpeg encodes them to Ogg Theora
//    (no sound) -> godot/assets/abilities/<clip>.ogv (gad_<brawler><A|B>, star_<starId>). Not ffmpeg's
//    libtheora: some builds write inter frames no decoder reads (Godot shows blocky garbage).
// Needs Godot 4.4 (GODOT env var, else `godot`), ffmpeg on the PATH, Blender 4.2+ (BLENDER, else `blender`).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const only = arg('only', '');
const reuse = process.argv.includes('--reuse');
const keep = reuse || process.argv.includes('--keep');
const GODOT = process.env.GODOT || 'godot';
const BLENDER = process.env.BLENDER || 'blender';
const FPS = 30, WARM = 24, W = 480, H = 300, KBPS = 450;
const here = fileURLToPath(new URL('.', import.meta.url));
const godotDir = join(here, '..');
const scenes = join(godotDir, 'build', 'abilities');
const outDir = join(godotDir, 'assets', 'abilities');
mkdirSync(outDir, { recursive: true });

execFileSync(process.execPath, [join(here, 'stage-abilities.mjs'), ...(only ? [`--only=${only}`] : [])], { stdio: 'inherit' });

let total = 0;
for (const f of readdirSync(scenes).filter(f => f.endsWith('.json')).sort()) {
  const clip = f.slice(0, -5);
  if (only && !only.split(',').includes(clip)) continue;
  const scene = JSON.parse(readFileSync(join(scenes, f), 'utf8'));
  const frames = join(tmpdir(), 'ability-frames', clip);
  if (!reuse || !existsSync(join(frames, 'f00000000.png'))) {
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    const r = spawnSync(GODOT, ['--path', godotDir, '--resolution', '960x600', '--fixed-fps', String(FPS),
      '--write-movie', join(frames, 'f.png'), '-s', 'res://tools/record_abilities.gd', '--',
      `--scene=${join(scenes, f)}`, `--warm=${WARM}`], { encoding: 'utf8' });
    const log = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0 || !/ABILITY done/.test(log) || /SCRIPT ERROR|Parse Error/.test(log)) {
      console.error(log.split('\n').filter(l => /ERROR|error|ABILITY/.test(l)).join('\n'));
      throw new Error(`${clip}: Godot failed`);
    }
  }
  // frame file n shows the replay at (n - WARM + 2) / FPS s (the clock starts on frame WARM)
  const start = WARM - 2 + Math.round(scene.from * FPS), count = Math.round((scene.to - scene.from) * FPS);
  const small = join(frames, 'small');
  rmSync(small, { recursive: true, force: true });
  mkdirSync(small);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-start_number', String(start),
    '-i', join(frames, 'f%08d.png'), '-frames:v', String(count), '-vf', `scale=${W}:${H}:flags=lanczos`,
    '-start_number', '0', join(small, 'f%08d.png')], { stdio: 'inherit' });
  const out = join(outDir, clip + '.ogv');
  rmSync(out, { force: true });
  const b = spawnSync(BLENDER, ['--background', '--factory-startup', '--python', join(here, 'encode_theora_blender.py'), '--',
    small, '0', String(count), out, String(W), String(H), String(KBPS), String(FPS)], { encoding: 'utf8' });
  if (b.status !== 0 || !existsSync(out)) {
    console.error((b.stdout || '') + (b.stderr || ''));
    throw new Error(`${clip}: Blender failed`);
  }
  const kb = statSync(out).size / 1024;
  total += kb;
  console.log(`${clip}.ogv  ${(count / FPS).toFixed(1)} s  ${kb.toFixed(0)} KB`);
  rmSync(small, { recursive: true, force: true });
  if (!keep) rmSync(frames, { recursive: true, force: true });
}
console.log(`total ${(total / 1024).toFixed(2)} MB`);
