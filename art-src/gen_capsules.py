"""Steam capsules and library art.

The backgrounds (an empty arena, no characters, no text) come from openai/gpt-image-2.5-sunburst through
OpenRouter (/api/v1/images): the model ignores reference images, so it cannot draw our brawlers. The real
brawlers (art-src/chibi/cut_action) and the real logo (docs/readme/logo.png) are composited on top here.
  backgrounds -> art-src/capsules/bg_<name>.png   (generated once; pass --regen <name> to redo one)
  capsules    -> steam/capsules/<asset>.png|jpg   (every size Steamworks asks for)
Uses the genere-assets skill key (env OPENROUTER_API_KEY or its embedded key).
Usage: python art-src/gen_capsules.py [--regen wide|tall ...]
"""
import base64, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

sys.path.insert(0, os.path.expanduser(
    '~/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/b89bbb8f-eeef-49b6-9979-270022f10b08/'
    '686c3b84-1bc8-435b-b613-12dbc87299e9/skills/genere-assets/scripts'))
from generate_asset import api_key  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
RAW = os.path.join(ROOT, 'art-src', 'capsules')
OUT = os.path.join(ROOT, 'steam', 'capsules')
MODEL = 'openai/gpt-image-2.5-sunburst'
STYLE = ('Key art background for a cute cartoon top-down brawler video game. Stylized glossy 3D render, soft toy-like '
         'shapes, warm saturated colours, cinematic golden-hour light with long soft shadows and a light bloom. '
         'The scene is a desert oasis battle arena: warm sand floor with hexagonal stone tiles, chunky orange '
         'terracotta brick walls and crates, clumps of tall golden grass, a small turquoise water pool, glowing '
         'lanterns on posts, palm trees and red sandstone cliffs in the distance, a clear sky. Absolutely no '
         'characters, no people, no creatures, no text, no letters, no logo, no UI. ')
BACKGROUNDS = {
    'wide': ('1536x1024', 'Low wide-angle view looking across the arena. Keep the lower middle of the image open '
                          'and uncluttered (a clear sandy area) and the upper third calm sky, for a title and a '
                          'group of characters to be placed there later.'),
    'tall': ('1024x1536', 'Vertical composition, low view looking up the arena towards the cliffs. Keep the lower '
                          'half open and uncluttered (clear sand) and the top quarter calm sky, for a title and a '
                          'group of characters to be placed there later.'),
}


def generate(name):
    size, framing = BACKGROUNDS[name]
    body = {'model': MODEL, 'prompt': STYLE + framing, 'size': size, 'n': 1}
    req = urllib.request.Request('https://openrouter.ai/api/v1/images', json.dumps(body).encode(),
                                 {'Authorization': 'Bearer ' + api_key(), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=600) as r:
        resp = json.loads(r.read())
    with open(os.path.join(RAW, f'bg_{name}.png'), 'wb') as f:
        f.write(base64.b64decode(resp['data'][0]['b64_json']))
    return f'bg_{name}: ${resp.get("usage", {}).get("cost", 0):.4f}'


# Group, left to right, drawn back to front: (brawler, height factor, depth order)
GROUP = [('frostbite', 0.80, 0), ('gunslinger', 0.92, 1), ('blaster', 1.0, 2), ('bomber', 0.92, 1), ('volt', 0.80, 0)]


def load_cut(key):
    im = Image.open(os.path.join(ROOT, 'art-src', 'chibi', 'cut_action', f'{key}.png')).convert('RGBA')
    return im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())


CUTS = {k: load_cut(k) for k, _, _ in GROUP}
LOGO = Image.open(os.path.join(ROOT, 'docs', 'readme', 'logo.png')).convert('RGBA')


def cover(img, w, h, fx=0.5, fy=0.5):
    """Scale img to cover w x h, cropping around the focal point (fx, fy)."""
    k = max(w / img.width, h / img.height)
    im = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    x = round((im.width - w) * fx)
    y = round((im.height - h) * fy)
    return im.crop((x, y, x + w, y + h))


def glow(img, radius, colour, strength):
    """Soft coloured halo around a cut-out (separates it from a busy background)."""
    a = img.getchannel('A').filter(ImageFilter.GaussianBlur(radius)).point(lambda v: min(255, v * strength))
    halo = Image.new('RGBA', img.size, colour)
    halo.putalpha(a)
    return halo


def place_group(canvas, height, bottom, width):
    """Draw the five brawlers: tallest `height` px, feet at `bottom` px, all of them within `width` px, centred."""
    ims = []
    for key, f, depth in GROUP:
        cut = CUTS[key]
        h = round(height * f)
        ims.append((depth, cut.resize((round(cut.width * h / cut.height), h), Image.LANCZOS)))
    # centres spread so that the outer brawlers' outer edges land on the group's edges
    span = width - (ims[0][1].width + ims[-1][1].width) / 2
    left = canvas.width / 2 - span / 2
    items = []
    for i, (depth, im) in enumerate(ims):
        cx = left + span * i / (len(ims) - 1)
        items.append((depth, im, round(cx - im.width / 2), round(bottom - im.height - (2 - depth) * height * 0.06)))
    for depth, im, x, y in sorted(items, key=lambda t: t[0]):
        pad = max(4, im.height // 12)
        layer = Image.new('RGBA', canvas.size)
        # ground shadow
        eh = max(2, im.height // 8)
        sh = Image.new('RGBA', (im.width + eh * 2, eh * 3), (40, 20, 10, 0))
        ImageDraw.Draw(sh).ellipse((eh + im.width * 0.12, eh, eh + im.width * 0.88, eh * 2), fill=(40, 20, 10, 150))
        sh = sh.filter(ImageFilter.GaussianBlur(eh / 4))
        layer.alpha_composite(sh, (x - eh, y + im.height - eh * 3 // 2))
        # warm halo, blurred on a padded copy so it is not clipped to the cut-out's box
        big = Image.new('RGBA', (im.width + pad * 4, im.height + pad * 4))
        big.alpha_composite(im, (pad * 2, pad * 2))
        layer.alpha_composite(glow(big, pad / 3, (255, 222, 170, 255), 0.55), (x - pad * 2, y - pad * 2))
        layer.alpha_composite(im, (x, y))
        canvas.alpha_composite(layer)


def place_logo(canvas, width, top):
    lg = LOGO.resize((round(width), round(LOGO.height * width / LOGO.width)), Image.LANCZOS)
    x = (canvas.width - lg.width) // 2
    sh = Image.new('RGBA', lg.size, (0, 0, 0, 0))
    sh.putalpha(lg.getchannel('A').point(lambda v: v * 0.6))
    blur = max(2, lg.height // 10)
    padded = Image.new('RGBA', (lg.width + blur * 4, lg.height + blur * 4))
    padded.alpha_composite(sh, (blur * 2, blur * 2))
    padded = padded.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(padded, (x - blur * 2 + blur // 2, round(top) - blur * 2 + blur))
    canvas.alpha_composite(lg, (x, round(top)))


def sky_shade(canvas, frac, alpha):
    """Darken the top of the image a little so the logo pops."""
    grad = Image.linear_gradient('L').resize((canvas.width, round(canvas.height * frac))).point(lambda v: (255 - v) * alpha)
    shade = Image.new('RGBA', grad.size, (30, 12, 40, 255))
    shade.putalpha(grad)
    canvas.alpha_composite(shade)


def capsule(bg, w, h, fx=0.5, fy=0.5, logo=None, group=None, shade=0.0):
    """logo = (width, top) and group = (height, bottom, width), all as fractions of the capsule."""
    c = cover(bg, w, h, fx, fy).convert('RGBA')
    if shade:
        sky_shade(c, 0.55, shade)
    if group:
        gh, gb, gw = group
        place_group(c, gh * h, gb * h, gw * w)
    if logo:
        lw, lt = logo
        place_logo(c, lw * w, lt * h)
    return c


def build():
    wide = Image.open(os.path.join(RAW, 'bg_wide.png')).convert('RGB')
    tall = Image.open(os.path.join(RAW, 'bg_tall.png')).convert('RGB')
    out = {
        'header_capsule': capsule(wide, 920, 430, 0.5, 0.45, logo=(0.84, 0.05), group=(0.78, 1.12, 0.92), shade=0.35),
        'small_capsule': capsule(wide, 462, 174, 0.5, 0.4, logo=(0.9, 0.24), shade=0.45),
        'main_capsule': capsule(wide, 1232, 706, 0.5, 0.5, logo=(0.74, 0.05), group=(0.78, 1.08, 0.86), shade=0.35),
        'vertical_capsule': capsule(tall, 748, 896, 0.5, 0.5, logo=(0.9, 0.05), group=(0.44, 0.97, 0.98), shade=0.35),
        'library_capsule': capsule(tall, 600, 900, 0.5, 0.5, logo=(0.9, 0.06), group=(0.38, 0.96, 0.98), shade=0.35),
        'library_header': capsule(wide, 920, 430, 0.5, 0.45, logo=(0.84, 0.05), group=(0.78, 1.12, 0.92), shade=0.35),
        'library_hero': capsule(wide, 3840, 1240, 0.5, 0.55, group=(0.78, 1.04, 0.46)),
        'page_background': ImageEnhance.Brightness(cover(wide, 1438, 810).filter(ImageFilter.GaussianBlur(3))).enhance(0.6),
    }
    for name, im in out.items():
        im.convert('RGB').save(os.path.join(OUT, name + '.jpg'), quality=92)
    # library logo: transparent PNG, logo centred with some margin
    lg = Image.new('RGBA', (1280, 720))
    place_logo(lg, 1180, (720 - LOGO.height * 1180 / LOGO.width) / 2)
    lg.save(os.path.join(OUT, 'library_logo.png'))
    Image.open(os.path.join(ROOT, 'electron', 'icon.png')).convert('RGB').resize((184, 184), Image.LANCZOS) \
        .save(os.path.join(OUT, 'community_icon.jpg'), quality=95)
    print('capsules ->', OUT)


if __name__ == '__main__':
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    regen = sys.argv[sys.argv.index('--regen') + 1:] if '--regen' in sys.argv else []
    todo = [n for n in BACKGROUNDS if n in regen or not os.path.exists(os.path.join(RAW, f'bg_{n}.png'))]
    with ThreadPoolExecutor(4) as pool:
        for msg in pool.map(generate, todo):
            print(msg)
    build()
