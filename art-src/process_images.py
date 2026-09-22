"""Turn the raw generated images into game-ready assets.

- textures: resized to 1024, saved as JPEG albedo + a tileable normal map derived from luminance
  (height = blurred luminance, gradients with wrap-around so seams stay invisible)
- portraits: white background flood-filled to alpha, cropped, 512 px tall PNG
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'assets')

# name in art-src -> (published name, normal strength, blur radius, invert height)
TEXTURES = {
    'sand2': ('sand', 2.0, 3, False),
    'brick2': ('brick', 5.0, 2, False),
    'stone': ('stone', 5.0, 2, False),
    'wood': ('wood', 3.0, 1.5, False),
    'grass2': ('grass', 2.5, 1.5, False),
    'snow': ('snow', 1.6, 3, False),
    'forest': ('forest', 2.5, 1.5, False),
    'mud': ('mud', 2.5, 2, False),
    'clay': ('clay', 4.0, 1.5, False),
    'mossbrick': ('mossbrick', 5.0, 2, False),
    'icestone': ('icestone', 4.0, 2, False),
}


def tile_blur(img, r):
    """Gaussian blur that wraps around (pad with tiles, blur, crop)."""
    w, h = img.size
    big = Image.new(img.mode, (w * 3, h * 3))
    for x in range(3):
        for y in range(3):
            big.paste(img, (x * w, y * h))
    return big.filter(ImageFilter.GaussianBlur(r)).crop((w, h, 2 * w, 2 * h))


def normal_map(img, strength, blur, invert):
    lum = tile_blur(img.convert('L'), blur)
    hgt = np.asarray(lum, dtype=np.float32) / 255.0
    if invert:
        hgt = 1.0 - hgt
    dx = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * 0.5
    dy = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * 0.5
    nx, ny, nz = -dx * strength * 10, dy * strength * 10, np.ones_like(hgt)
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / n, ny / n, nz / n], axis=-1) * 0.5 + 0.5
    return Image.fromarray((rgb * 255).astype(np.uint8), 'RGB')


def textures():
    os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
    for src, (name, strength, blur, inv) in TEXTURES.items():
        img = Image.open(os.path.join(HERE, src + '.png')).convert('RGB').resize((1024, 1024), Image.LANCZOS)
        img.save(os.path.join(OUT, 'tex', name + '.jpg'), quality=88)
        normal_map(img, strength, blur, inv).save(os.path.join(OUT, 'tex', name + '_n.png'), optimize=True)
        print('texture', name)


def portraits():
    os.makedirs(os.path.join(OUT, 'ui'), exist_ok=True)
    for name in ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt']:
        img = Image.open(os.path.join(HERE, 'p_' + name + '.png')).convert('RGB')
        w, h = img.size
        marker = (255, 0, 255)
        work = img.copy()
        seeds = [(x, y) for x in range(0, w, w // 16) for y in (0, h - 1)] + \
                [(x, y) for y in range(0, h, h // 16) for x in (0, w - 1)]
        for s in seeds:
            if min(work.getpixel(s)) > 225:
                ImageDraw.floodfill(work, s, marker, thresh=40)
        a = np.asarray(work)
        bg = (a[..., 0] == 255) & (a[..., 1] == 0) & (a[..., 2] == 255)
        alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8), 'L')
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
        rgba = img.copy()
        rgba.putalpha(alpha)
        rgba = rgba.crop(alpha.getbbox())
        s = 512 / rgba.height
        rgba = rgba.resize((round(rgba.width * s), 512), Image.LANCZOS)
        rgba.save(os.path.join(OUT, 'ui', name + '.png'), optimize=True)
        print('portrait', name, rgba.size)


def map_thumbs():
    for key in ['oasis', 'dunes', 'grove', 'frost', 'marsh']:
        img = Image.open(os.path.join(HERE, f'map_{key}.png')).convert('RGB').resize((384, 384), Image.LANCZOS)
        img.save(os.path.join(OUT, 'ui', f'map_{key}.jpg'), quality=84)
        print('map thumb', key)


if __name__ == '__main__':
    import sys
    textures()
    if '--no-portraits' not in sys.argv:
        portraits()
    map_thumbs()
