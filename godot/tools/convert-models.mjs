// The game's GLBs use EXT_meshopt_compression, which Godot 4 does not import (nor KHR_mesh_quantization). This decodes them
// into plain GLBs under godot/assets/models/ (Godot then imports and compresses them per platform).
// Run: cd godot/tools && npm i && node convert-models.mjs
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { dequantize, weld, normals } from '@gltf-transform/functions';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    await doc.transform(dequantize(), weld(), normals({ overwrite: false })); // Godot has no KHR_mesh_quantization; the decor GLBs ship without normals (three computes them at load)
    doc.getRoot().listExtensionsUsed().filter(e => ['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(e.extensionName)).forEach(e => e.dispose());
    await io.write(join(out, f), doc);
    bytes += statSync(join(out, f)).size; n++;
  }
}
await convert('');
console.log(`converted ${n} models, ${(bytes / 1e6).toFixed(1)} MB`);
