// Transcodes public/assets/{sfx,music} (mp3) to small OGG Vorbis files for the Godot client.
// usage: FFMPEG=/path/to/ffmpeg node godot/tools/convert-audio.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const out = join(root, 'godot', 'assets', 'audio');
// Songs kept (menu2, night and the unused beds are left out to stay under ~15 MB in total).
const SONGS = ['menu', 'lobby', 'battle', 'battle2', 'final', 'm_dunes', 'm_frost', 'm_grove', 'm_isles', 'm_marsh', 'm_oasis'];
const LOOPS = ['amb_day', 'amb_night', 'amb_rain', 'amb_storm', 'amb_snow', 'amb_marsh'];

function enc(src, dst, quality, channels) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-vn', '-ac', String(channels), '-c:a', 'libvorbis', '-q:a', String(quality), dst]);
}

mkdirSync(join(out, 'sfx'), { recursive: true });
mkdirSync(join(out, 'music'), { recursive: true });
for (const f of readdirSync(join(root, 'public/assets/sfx'))) {
  if (f.endsWith('.mp3')) enc(join(root, 'public/assets/sfx', f), join(out, 'sfx', f.replace('.mp3', '.ogg')), 3, 1);
}
for (const n of SONGS) enc(join(root, 'public/assets/music', n + '.mp3'), join(out, 'music', n + '.ogg'), 0, 2);
for (const n of LOOPS) enc(join(root, 'public/assets/music', n + '.mp3'), join(out, 'music', n + '.ogg'), 1, 1);
enc(join(root, 'public/assets/music/victory.mp3'), join(out, 'music', 'fanfare.ogg'), 2, 2);
