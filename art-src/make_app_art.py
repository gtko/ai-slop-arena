"""App icon and splash screens from the menu portraits (public/assets/ui/<key>.png).
  icon   : one brawler on the brand violet gradient -> assets/icon-only.png, icon-foreground.png (Capacitor sources),
           google-play/icon-512.png, electron/icon.png + icon.ico
  splash : the five brawlers in a row on the dark background -> assets/splash.png, splash-dark.png
Then `npx capacitor-assets generate` spreads assets/ to the Android and iOS projects.
Usage: python art-src/make_app_art.py [icon_key]   (default gunslinger)"""
import sys
from PIL import Image

ICON_KEY = sys.argv[1] if len(sys.argv) > 1 else 'gunslinger'
ROSTER = ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt']
TOP, BOTTOM = (123, 77, 255), (22, 18, 31)  # brand violet -> night
portrait = lambda k: Image.open(f'public/assets/ui/{k}.png').convert('RGBA')


def gradient(size):
    col = Image.new('RGB', (1, size))
    for y in range(size):
        u = y / (size - 1)
        col.putpixel((0, y), tuple(round(a + (b - a) * u) for a, b in zip(TOP, BOTTOM)))
    return col.resize((size, size)).convert('RGBA')


def fit(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


# icon: the figure fills ~90% of the height, standing on the bottom edge like the first icon
icon = gradient(1024)
fig = fit(portrait(ICON_KEY), 900)
if fig.width > 900:
    fig = fit(fig, round(900 * 900 / fig.width))
icon.alpha_composite(fig, ((1024 - fig.width) // 2, 1024 - fig.height))
icon.save('assets/icon-only.png')
icon.save('assets/icon-foreground.png')
small = icon.resize((512, 512), Image.LANCZOS)
small.save('google-play/icon-512.png')
small.save('electron/icon.png')
icon.save('electron/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# splash: the roster at the old scale (a 520 px tall row, centred) on the dark background
splash = Image.new('RGBA', (2732, 2732), BOTTOM + (255,))
figs = [fit(portrait(k), 520) for k in ROSTER]
gap = 60
x = (2732 - sum(f.width for f in figs) - gap * (len(figs) - 1)) // 2
for f in figs:
    splash.alpha_composite(f, (x, 1106 + 520 - f.height))
    x += f.width + gap
splash = splash.convert('RGB')
splash.save('assets/splash.png')
splash.save('assets/splash-dark.png')
print('icon', ICON_KEY, '| splash', ROSTER)
