// The game's GLBs use EXT_meshopt_compression, which Godot 4 does not import (nor KHR_mesh_quantization). This decodes them
// into plain GLBs under godot/assets/models/ (Godot then imports and compresses them per platform).
// Run: cd godot/tools && npm i && node convert-models.mjs
//
// Textures: Godot's scene import extracts each GLB's embedded texture next to it (<model>_<image>.webp).
// Those files and their .import are committed with VRAM compression (compress/mode=2: ETC2/ASTC on
// phones, S3TC/BPTC on desktops) and mipmaps: Godot's default for an extracted texture is lossless,
// i.e. uncompressed RGBA in GPU memory (8x the bytes and the bandwidth of ETC2), its "detect 3D"
// switch to VRAM only runs in the editor. The .import keeps the image's md5: a changed texture is
// extracted again and keeps these settings; a new model's texture needs its .import set to mode 2.
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { dequantize, weld, normals } from '@gltf-transform/functions';
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, statSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Decor drawn by the hundred in MultiMeshes (one LOD for a whole map's MultiMesh, so Godot's automatic
// LODs never kick in): cut to a triangle budget that still reads at the game camera (about 37 m away,
// a 2 m tile is ~60 px tall on a 1080p screen). Ratio of the triangles kept, by Blender's collapse
// decimation (tools/decimate.py; meshoptimizer's simplifier stalls on these scanned meshes, locked by
// their many UV islands and non-manifold edges). tools/geometry_audit.gd shows the cost per map.
// Brawlers and fauna keep their meshes (one MeshInstance3D each: Godot builds their LODs).
const DECIMATE = {
  'decor/bush.glb': 0.3,          // 3582 -> ~1070 triangles, up to ~120 bushes a map (Sunny Grove: 415k -> 125k)
  'decor/wall_moss.glb': 0.35,    // 1500 -> ~520, every wall block of Grove / Marsh (126 on Grove)
  'decor/wall_canyon.glb': 0.35,
  'decor/wall_ice.glb': 0.35,
};
// Low tier copies (<prop>_low.glb, ratio of the shipped GLB's triangles): the props drawn by the dozen
// in MultiMeshes, whose single LOD for the whole MultiMesh stays at full detail at the game camera.
// PropLib swaps them in on Low (prop_lib.gd set_low); no material (the full prop's is used).
const LOW = {
  'decor/tree_round.glb': 0.2, 'decor/tree_pine.glb': 0.2, 'decor/tree_pine_snow.glb': 0.2,
  'decor/tree_dead.glb': 0.2, 'decor/cactus.glb': 0.25, 'decor/rock_canyon.glb': 0.25,
  'decor/boulder.glb': 0.25, 'decor/boulder_snow.glb': 0.25, 'decor/stump.glb': 0.25,
  'decor/crate.glb': 0.25, 'decor/lantern.glb': 0.25,
  'decor/wall_canyon.glb': 0.45, 'decor/wall_ice.glb': 0.45, 'decor/wall_moss.glb': 0.45,
};
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../public/assets/models');
const dst = join(here, '../assets/models');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
let n = 0, bytes = 0;
async function convert(dir) {
  const out = join(dst, dir);
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(join(src, dir))) {
    const p = join(src, dir, f);
    if (statSync(p).isDirectory()) { await convert(join(dir, f)); continue; }
    if (!f.endsWith('.glb')) continue;
    const doc = await io.read(p);
    // Godot has no KHR_mesh_quantization; the decor GLBs ship without normals (three computes them at
    // load). normals() unwelds the whole document (flat normals need split corners), so weld again
    // after it: without indices every triangle owns its 3 vertices (4.4x the vertices to skin and
    // shade on a brawler, and Godot cannot build LODs).
    const key = join(dir, f).split(sep).join('/');
    await doc.transform(dequantize(), weld(), normals({ overwrite: false }), weld());
    doc.getRoot().listExtensionsUsed().filter(e => ['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(e.extensionName)).forEach(e => e.dispose());
    if (DECIMATE[key]) {
      // decimated in Blender from a temp copy: without Blender (CI containers) the committed, already
      // decimated GLB stays as it is instead of being replaced by the full mesh
      const tmp = join(out, f + '.full.glb');
      await io.write(tmp, doc);
      const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python', join(here, 'decimate.py'), '--', tmp, join(out, f), String(DECIMATE[key])], { encoding: 'utf8' });
      const line = (r.stdout || '').split(/\r?\n/).find(l => l.startsWith('DECIMATE'));
      if (line) console.log(line);
      else if (existsSync(join(out, f))) console.log(`${key}: no Blender (${r.error || r.status}), kept the committed decimated GLB (set BLENDER=<blender.exe> to rebuild it)`);
      else { renameSync(tmp, join(out, f)); console.log(`${key}: no Blender and no committed GLB: the full mesh ships`); }
      rmSync(tmp, { force: true });
    } else {
      await io.write(join(out, f), doc);
    }
    if (LOW[key]) {
      const low = join(out, f.replace(/\.glb$/, '_low.glb'));
      const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python', join(here, 'decimate.py'), '--', join(out, f), low, String(LOW[key]), 'nomat'], { encoding: 'utf8' });
      const line = (r.stdout || '').split(/\r?\n/).find(l => l.startsWith('DECIMATE'));
      console.log(line || `${key}: no Blender (${r.error || r.status}), kept the committed ${existsSync(low) ? 'low copy' : 'full mesh only (no low copy)'}`);
    }
    bytes += statSync(join(out, f)).size; n++;
  }
}
await convert('');
console.log(`converted ${n} models, ${(bytes / 1e6).toFixed(1)} MB`);
