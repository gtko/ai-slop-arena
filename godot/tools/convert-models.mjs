// The game's GLBs use EXT_meshopt_compression, which Godot 4 does not import (nor KHR_mesh_quantization). This decodes them
// into plain GLBs under godot/assets/models/ (Godot then imports and compresses them per platform).
// Run: cd godot/tools && npm i && node convert-models.mjs
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { dequantize, weld, normals } from '@gltf-transform/functions';
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
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
    await io.write(join(out, f), doc);
    if (DECIMATE[key]) {
      const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python', join(here, 'decimate.py'), '--', join(out, f), join(out, f), String(DECIMATE[key])], { encoding: 'utf8' });
      const line = (r.stdout || '').split(/\r?\n/).find(l => l.startsWith('DECIMATE'));
      console.log(line || `${key}: Blender decimation failed (${r.error || r.status}), kept the full mesh (set BLENDER=<blender.exe>)`);
    }
    bytes += statSync(join(out, f)).size; n++;
  }
}
await convert('');
console.log(`converted ${n} models, ${(bytes / 1e6).toFixed(1)} MB`);
