"""Steam achievement icons with openai/gpt-image-2.5-sunburst through OpenRouter (/api/v1/images).

Raw 1024x1024 images go to art-src/achievements/<ID>.png, then every icon is exported for Steamworks as
steam/achievements/<ID>.jpg (256x256, unlocked) and <ID>_locked.jpg (desaturated and dimmed), and for
Play Console as play/achievements/<ID>.png (512x512; Play greys locked ones out itself).
Uses the genere-assets skill key (env OPENROUTER_API_KEY or its embedded key).
Usage: python art-src/gen_achievements.py [ID ...]   (no IDs = every icon missing on disk; IDs = regenerate them)
"""
import base64, json, os, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageEnhance, ImageOps

sys.path.insert(0, os.path.expanduser(
    '~/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/b89bbb8f-eeef-49b6-9979-270022f10b08/'
    '686c3b84-1bc8-435b-b613-12dbc87299e9/skills/genere-assets/scripts'))
from generate_asset import api_key  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
RAW = os.path.join(ROOT, 'art-src', 'achievements')
OUT = os.path.join(ROOT, 'steam', 'achievements')
PLAY = os.path.join(ROOT, 'play', 'achievements')
MODEL = 'openai/gpt-image-2.5-sunburst'
STYLE = ('Square achievement icon for a cute cartoon top-down brawler video game. Glossy stylized 3D render in a chunky '
         'vinyl-toy style, one bold subject centered with a clear silhouette and a thick dark outline, vivid saturated colors, '
         'soft radial light rays in the background colour, the artwork fills the whole square edge to edge, no frame, '
         'no border, absolutely no text, letters or numbers. It must stay readable when shrunk to 64x64 pixels. ')
ICONS = {  # API name: (background colour, subject)
    'FIRST_KO': ('bright red', 'a big cartoon boxing glove punching forward out of a yellow impact starburst, with little dizzy stars flying'),
    'FIRST_WIN': ('golden yellow', 'a shiny gold trophy cup topped with a small crown, standing on a rock while swirling green poison gas curls around its base'),
    'RAMPAGE': ('fiery orange', 'a round black cartoon bomb with a lit fuse mid-explosion, chunky orange and yellow blast clouds and flying brick debris'),
    'POWER_HUNGRY': ('emerald green', 'a tall wobbly stack of glowing green energy cubes, each cube a glossy gem-like box with a bright inner glow, sparks around them'),
    'ONLINE_WIN': ('hot pink', 'a golden crown floating above a cheering crowd of small raised cartoon hands, colourful confetti everywhere'),
    'SQUAD_UP': ('turquoise', 'two chunky cartoon forearms doing an energetic high five, one wearing an orange fingerless combat glove and one a teal armoured robot glove, with a sparkle burst where the palms meet'),
    'WORLD_TOUR': ('sky blue', 'a small round cartoon planet divided into five biomes: a desert oasis with a palm tree, orange sand dunes, a rainy green forest, a snowy mountain peak and a foggy purple swamp'),
    'JACK_OF_ALL': ('royal purple', 'five cartoon weapons fanned out like a hand of cards: a pump shotgun, a silver revolver, a black round bomb, a wooden staff tipped with an ice crystal, and a crackling electric blue orb'),
    'VETERAN': ('navy blue', 'a battle-worn bronze medal with a star, hanging from a striped ribbon, small scratches and a proud shine'),
    'CENTURION': ('crimson', 'a cartoon Roman centurion helmet in polished gold and steel with a tall red brush crest, seen three-quarter'),
    'PODIUM': ('warm teal', 'a three-step winners podium in gold, silver and bronze with a big number-free star on the top step, small sparkles around it'),
    'SUPER_KO': ('electric violet', 'a glowing fist crackling with purple and yellow super energy, bursting through a comic starburst shockwave'),
    'NIGHT_OWL': ('deep midnight blue', 'a chubby cartoon owl with big glowing yellow eyes holding a small lit lantern, a crescent moon and tiny stars behind it'),
    'CRATE_CRUSHER': ('warm amber', 'a wooden cartoon crate smashing apart into flying planks and splinters, a glowing green energy cube popping out of it'),
    'CHAMPION': ('rich gold', 'a champion wrestling belt with a big shiny golden plate and a red gem, laurel leaves around it'),
}


def generate(prompt, timeout=600):
    body = {'model': MODEL, 'prompt': prompt, 'size': '1024x1024', 'n': 1}
    req = urllib.request.Request('https://openrouter.ai/api/v1/images', json.dumps(body).encode(),
                                 {'Authorization': 'Bearer ' + api_key(), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read())
    return base64.b64decode(resp['data'][0]['b64_json']), resp.get('usage', {}).get('cost', 0)


def job(name):
    colour, subject = ICONS[name]
    try:
        png, cost = generate(f'{STYLE}Background: {colour}. Subject: {subject}.')
    except urllib.error.HTTPError as e:
        return f'{name}: HTTP {e.code} {e.read()[:300]!r}', 0
    with open(os.path.join(RAW, name + '.png'), 'wb') as f:
        f.write(png)
    return f'{name}: ok', cost


def export(name):
    raw = Image.open(os.path.join(RAW, name + '.png')).convert('RGB')
    raw.resize((512, 512), Image.LANCZOS).save(os.path.join(PLAY, name + '.png'), optimize=True)
    im = raw.resize((256, 256), Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.jpg'), quality=95)
    locked = ImageEnhance.Brightness(ImageEnhance.Contrast(ImageOps.grayscale(im)).enhance(0.8)).enhance(0.55)
    locked.convert('RGB').save(os.path.join(OUT, name + '_locked.jpg'), quality=95)


if __name__ == '__main__':
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PLAY, exist_ok=True)
    names = sys.argv[1:] or [n for n in ICONS if not os.path.exists(os.path.join(RAW, n + '.png'))]
    total = 0
    with ThreadPoolExecutor(5) as pool:
        for msg, cost in pool.map(job, names):
            print(msg)
            total += cost or 0
    print(f'cost: ${total:.4f}')
    for n in ICONS:
        if os.path.exists(os.path.join(RAW, n + '.png')):
            export(n)
