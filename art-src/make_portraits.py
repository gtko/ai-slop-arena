"""Menu portraits from the chibi cutouts. Uses art-src/chibi/cut_apose/<key>.png (RGBA, background
removed by the local pipeline) when present, else art-src/chibi/cut/<key>.png (TRELLIS: character
premultiplied on black). Usage: python art-src/make_portraits.py blaster bomber ..."""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

for key in sys.argv[1:]:
    if os.path.exists(f'art-src/chibi/cut_apose/{key}.png'):
        im = Image.open(f'art-src/chibi/cut_apose/{key}.png').convert('RGBA')
        im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
        im = im.resize((round(im.width * 512 / im.height), 512), Image.LANCZOS)
        im.save(f'public/assets/ui/{key}.png', optimize=True)
        print(key, im.size, 'A-pose')
        continue
    im = Image.open(f'art-src/chibi/cut/{key}.png').convert('RGB')
    w, h = im.size
    # background = pure black pixels connected to the border (dark clothes inside stay opaque)
    mask = im.convert('L').point(lambda v: 255 if v > 2 else 0)
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if mask.getpixel((x, y)) == 0:
            ImageDraw.floodfill(mask, (x, y), 128)
    alpha = mask.point(lambda v: 0 if v == 128 else 255).filter(ImageFilter.GaussianBlur(0.7))
    im.putalpha(alpha)
    im = im.crop(alpha.getbbox())
    im = im.resize((round(im.width * 512 / im.height), 512), Image.LANCZOS)
    im.save(f'public/assets/ui/{key}.png', optimize=True)
    print(key, im.size)
