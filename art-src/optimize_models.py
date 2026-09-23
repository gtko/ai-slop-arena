"""Raw generated GLBs -> game-ready GLBs (webp texture, meshopt geometry, triangle budget).
  art-src/glb/<key>.glb        -> public/assets/models/<key>.glb         (characters, ~13k tris)
  art-src/glb/decor/<name>.glb -> public/assets/models/decor/<name>.glb  (instanced props, light)
Usage: python art-src/optimize_models.py [keys...]   python art-src/optimize_models.py --decor [names...]"""
import glob, os, subprocess, sys

# fraction of the triangles kept for each decor prop (raw props come out at ~30k triangles)
# (instanced by the hundred around the arena: a canyon pillar at 1k triangles x 286 copies is plenty)
DECOR_RATIO = {'wall': 0.05, 'crate': 0.08, 'tree': 0.05, 'bush': 0.04, 'rock': 0.035, 'boulder': 0.06, 'stump': 0.06,
               'cactus': 0.05, 'lantern': 0.1}


def run(src, dst, ratio, error, size):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(['npx', '--yes', '@gltf-transform/cli@4', 'optimize', src, dst, '--compress', 'meshopt',
                    '--texture-compress', 'webp', '--texture-size', str(size),
                    '--simplify-ratio', str(ratio), '--simplify-error', str(error)],
                   check=True, shell=os.name == 'nt', capture_output=True)
    print(os.path.basename(dst), os.path.getsize(dst))


args = sys.argv[1:]
if args[:1] == ['--decor']:
    names = args[1:] or [os.path.basename(p)[:-4] for p in glob.glob('art-src/glb/decor/*.glb')]
    for name in names:
        ratio = next((r for k, r in DECOR_RATIO.items() if name.startswith(k)), 0.15)
        error = 0.06 if name.startswith('bush') else 0.02  # the leaf balls resist simplification
        run(f'art-src/glb/decor/{name}.glb', f'public/assets/models/decor/{name}.glb', ratio, error, 512)
else:
    keys = args or [os.path.basename(p)[:-4] for p in glob.glob('art-src/glb/*.glb')]
    for key in keys:
        run(f'art-src/glb/{key}.glb', f'public/assets/models/{key}.glb', 0.6, 0.0008, 1024)
