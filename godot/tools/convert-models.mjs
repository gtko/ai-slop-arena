// The game's GLBs use EXT_meshopt_compression, which Godot 4 does not import. This decodes them
// into plain GLBs under godot/assets/models/ (Godot then imports and compresses them per platform).
// Run: cd godot/tools && npm i && node convert-models.mjs
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../public/assets/models');
const dst = join(here, '../assets/models');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
mkdirSync(dst, { recursive: true });
let n = 0, bytes = 0;
for (const f of readdirSync(src)) { // brawlers only for now (top level); decor/ and fauna/ follow
  if (!f.endsWith('.glb') || !statSync(join(src, f)).isFile()) continue;
  const doc = await io.read(join(src, f));
  doc.getRoot().listExtensionsUsed().filter(e => e.extensionName === 'EXT_meshopt_compression').forEach(e => e.dispose());
  await io.write(join(dst, f), doc);
  bytes += statSync(join(dst, f)).size; n++;
}
console.log(`converted ${n} models, ${(bytes / 1e6).toFixed(1)} MB`);
