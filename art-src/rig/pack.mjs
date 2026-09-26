// Step 3 of the character rig: Blender's GLB -> game file (keyframes deduplicated, meshopt).
//   art-src/rig/out/<key>.glb -> public/assets/models/<key>.glb
// Usage: node art-src/rig/pack.mjs [keys...]
import { execSync } from 'child_process';
import fs from 'fs';

const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt', 'kappa'];
const cli = cmd => execSync(`npx --yes @gltf-transform/cli@4 ${cmd}`, { stdio: 'pipe' });
for (const key of keys) {
  const src = `art-src/rig/out/${key}.glb`, tmp = `art-src/rig/out/${key}.tmp.glb`, dst = `public/assets/models/${key}.glb`;
  cli(`resample ${src} ${tmp} --tolerance 0.0005`);
  cli(`meshopt ${tmp} ${dst} --level medium`);
  fs.unlinkSync(tmp);
  console.log(key, fs.statSync(src).size, '->', fs.statSync(dst).size);
}
