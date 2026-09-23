"""Reference images for the 3D decor (art-src/decor/<name>.png), one shared style formula so every
prop sits in the same art direction as the chibi figurines. They feed art-src/ai3d/make3d.py.
Usage: python art-src/ai3d/decor_images.py [names...]"""
import os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

GEN = os.path.expandvars(r'$APPDATA/Claude/local-agent-mode-sessions/skills-plugin/b89bbb8f-eeef-49b6-9979-270022f10b08/'
                         r'686c3b84-1bc8-435b-b613-12dbc87299e9/skills/genere-assets/scripts/generate_asset.py')
STYLE = ('stylized 3D game prop for a cute cartoon arena brawler, chunky rounded toy-like shapes, bold saturated '
         'hand-painted colors, soft clean studio lighting, high quality 3D render like a vinyl collectible, '
         'single object centered and fully visible, seen from the front and slightly above, '
         'isolated on a plain pure white background, no ground, no shadow, no text')
PROPS = {
    'tree_round': 'a round leafy tree with a short thick curvy brown trunk and a big fluffy canopy of puffy bright green leaf clumps',
    'tree_pine': 'a pine tree made of three stacked chunky dark green cone layers with a short brown trunk',
    'tree_pine_snow': 'a pine tree made of three stacked chunky dark green cone layers covered with thick white snow caps, short brown trunk',
    'tree_dead': 'a spooky dead tree with a twisted gray-brown trunk and a few bare curly branches, no leaves',
    'cactus': 'a saguaro cactus with two raised arms, rounded chunky green ribs, tiny spines and a small pink flower on top',
    'rock_canyon': 'a chunky tall canyon rock pillar made of stacked orange and red sandstone layers with faceted edges',
    'boulder': 'a round chunky gray boulder with soft facets and a small patch of green moss on top',
    'boulder_snow': 'a round chunky blue-gray boulder with a thick cap of white snow on top',
    'stump': 'a tree stump with visible growth rings on the flat top, chunky bark and small roots spreading out',
    'crate': 'a sturdy wooden supply crate, a perfect cube with thick planks, metal corner brackets and big round bolts',
    'lantern': 'a stone lantern post with a square base, a slim pillar and a little roofed lamp box on top with glowing warm windows',
    'wall_canyon': 'a single cube-shaped wall block of orange sandstone with horizontal rock strata bands and a flat top, slightly beveled edges',
    'wall_moss': 'a single cube-shaped wall block of gray stone bricks with a flat top covered by a layer of green moss, slightly beveled edges',
    'wall_ice': 'a single cube-shaped wall block of pale blue ice stone with a flat top covered by a layer of snow, slightly beveled edges',
    'bush': 'a round fluffy bush made of many clustered puffy green leaf balls',
}


def gen(name):
    out = f'art-src/decor/{name}.png'
    if os.path.exists(out):
        return name, 'exists'
    r = subprocess.run([sys.executable, GEN, '--prompt', f'{PROPS[name]}. {STYLE}', '--out', out],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return name, 'ok' if os.path.exists(out) else r.stdout[-300:] + r.stderr[-300:]


if __name__ == '__main__':
    os.makedirs('art-src/decor', exist_ok=True)
    names = sys.argv[1:] or list(PROPS)
    with ThreadPoolExecutor(4) as pool:
        for name, status in pool.map(gen, names):
            print(name, status, flush=True)
