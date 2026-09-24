"""Reference art for the brawlers redesigned as original characters (blaster, gunslinger, bomber):
one shared figurine style, one description per character, two poses:
  apose  -> art-src/chibi/apose/<key>.png   (front A-pose, feeds make3d.py for the 3D figurine)
  action -> art-src/chibi/action/<key>.png  (3/4 action pose, feeds cutout.py -> menu portrait)
Images come from openai/gpt-image-2.5-sunburst on OpenRouter (the same prompts work through the
openrouter-images MCP server). With --ref, the chosen concept is passed along so both poses stay on model.
Usage: python art-src/ai3d/char_images.py apose blaster bomber ... [--ref art-src/chibi/<key>.png] [--count N]"""
import os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

GEN = os.path.expandvars(r'$APPDATA/Claude/local-agent-mode-sessions/skills-plugin/b89bbb8f-eeef-49b6-9979-270022f10b08/'
                         r'686c3b84-1bc8-435b-b613-12dbc87299e9/skills/genere-assets/scripts/generate_asset.py')
MODEL = 'openai/gpt-image-2.5-sunburst'
STYLE = ('3D character render of a collectible glossy painted vinyl toy figurine for a cute cartoon arena brawler game. '
         'Chibi proportions: very big head (about 40% of the total height), short sturdy body, short legs. Chunky rounded '
         'toy-like shapes, bold saturated colours, soft clean studio lighting, high quality 3D render. Original design, '
         'not resembling any existing game character. Isolated on a plain pure white background, no floor, no shadow, no text.')
POSES = {
    'apose': ('Pose: strict front view, standing straight in a relaxed A-pose, both arms held clearly away from the body '
              'with a visible gap between arms and torso, legs slightly apart with a gap between them, the weapon held '
              'out to the side (not in front of the body), whole figure fully visible and centered, feet at the bottom. '
              'Square image.'),
    'action': ('Pose: dynamic three-quarter view action pose, ready for battle, weapon raised, confident expression, '
               'whole figure fully visible and centered. Square image.'),
}
CHARS = {
    'blaster': (
        'Subject: a stocky little TREE-STUMP GOLEM guardian. The body is a chunky living tree stump with warm brown '
        'bark plates and visible light wood rings on the shoulders, short thick root-like legs ending in rooty feet. '
        'On top of the head a bushy crown of bright green leaf clumps with a small sapling sprout and two pink blossoms. '
        'Big friendly-determined face carved in lighter wood, glowing amber eyes, a few moss patches on the shoulders, '
        'a leather strap across the chest with seed pouches. Holds in the right hand a chunky SEED BLUNDERBUSS: a short '
        'hollow-log cannon with a wide flared bell-shaped muzzle, bound with vine rings, loaded with green thorny seeds.'),
    'gunslinger': (
        'Subject: a cheeky PINK AXOLOTL STAR-RANGER. Soft bubblegum-pink amphibian skin, three frilly magenta gill '
        'fronds on each side of the big round head, big shiny dark eyes with a confident smirk, small tail. Wears a '
        'fitted white and violet retro space-ranger suit with a gold star badge on the chest, violet gloves, chunky '
        'white boots with violet soles and a short violet scarf. Holds one chunky retro RAY PISTOL in each hand, '
        'white and violet with glowing cyan energy coils and a round emitter tip.'),
    'bomber': (
        'Subject: a small mischievous MAGMA IMP. Body made of dark charcoal-grey volcanic basalt rock with chunky '
        'rounded plates and glowing bright orange lava cracks between them. The top of the head is a tall tuft of '
        'stylized solid orange-and-yellow flames swept back like a hairdo, with two short curved black horns. Big '
        'eyes with glowing amber irises, a cheeky toothy grin with small fangs, soot-stained brown leather belt with a '
        'pouch, rock-plated boots with glowing toes. Holds up in the left hand a blazing round FIREBALL (a molten rock '
        'ball wrapped in stylized solid flames); the right hand is empty.'),
}


def gen(job):
    pose, key, ref, count = job
    out = f'art-src/chibi/{pose}/{key}.png'
    cmd = [sys.executable, GEN, '--model', MODEL, '--prompt', f'{STYLE}\n\n{CHARS[key]}\n\n{POSES[pose]}', '--out', out, '--count', str(count)]
    if ref:
        cmd[4] += '\n\nKeep exactly the same character design, colours and weapon as the reference image.'
        cmd += ['--ref', ref]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return key, (r.stdout + r.stderr)[-400:]


if __name__ == '__main__':
    args = sys.argv[1:]
    ref = args[args.index('--ref') + 1] if '--ref' in args else None
    count = int(args[args.index('--count') + 1]) if '--count' in args else 1
    args = [a for i, a in enumerate(args) if not (a.startswith('--') or (i and args[i - 1] in ('--ref', '--count')))]
    pose, keys = args[0], args[1:] or list(CHARS)
    os.makedirs(f'art-src/chibi/{pose}', exist_ok=True)
    with ThreadPoolExecutor(3) as pool:
        for key, status in pool.map(gen, [(pose, k, ref, count) for k in keys]):
            print(key, status.strip(), flush=True)
