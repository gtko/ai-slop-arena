"""Animated promo media from the engine captures (src/trailer.js):
  steam/store/extras/battle.gif    3 s of the trailer's fight (616x347, 10 fps)
  steam/store/extras/weather.gif   the weather stills (site/feat_*.jpg), cross-faded
  steam/store/extras/daynight.gif  the four times of day (site/tod_*.jpg), cross-faded
  docs/readme/trailer.webp         a 13.7 s cut of the trailer, 800x450 at 15 fps
Inputs: .ai3d/capture/trailer/f*.jpg (recordTrailer) and public/assets/site/*.jpg (recordStills, recordDayNight).
Usage: python art-src/make_promo_media.py"""
import os
from PIL import Image

FRAMES = '.ai3d/capture/trailer'
SHOT = 150  # frames per arena in the trailer (oasis, grove, frost, dunes, marsh)
GIF = (616, 347)


def frame(n, size):
    return Image.open(f'{FRAMES}/f{n:05d}.jpg').convert('RGB').resize(size, Image.LANCZOS)


def save_gif(path, frames, ms):
    # one palette for the whole clip (from a strip of sample frames): unchanged pixels stay identical
    # between frames, which is what lets the GIF encoder skip them
    strip = Image.new('RGB', (frames[0].width, frames[0].height * 4))
    for k in range(4):
        strip.paste(frames[k * (len(frames) - 1) // 3], (0, k * frames[0].height))
    ref = strip.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
    pal = [f.quantize(palette=ref, dither=Image.Dither.NONE) for f in frames]
    pal[0].save(path, save_all=True, append_images=pal[1:], duration=ms, loop=0, optimize=True)
    print(path, len(frames), os.path.getsize(path))


def slideshow(stills, hold=12, fade=4):
    ims = [Image.open(s).convert('RGB').resize(GIF, Image.LANCZOS) for s in stills]
    out = []
    for i, im in enumerate(ims):
        out += [im] * hold
        nxt = ims[(i + 1) % len(ims)]
        out += [Image.blend(im, nxt, (k + 1) / (fade + 1)) for k in range(fade)]
    return out


# battle: 3 s of the Rainy Grove shot (the busiest fight of this recording), every third frame
save_gif('steam/store/extras/battle.gif', [frame(n, GIF) for n in range(215, 305, 3)], 100)
save_gif('steam/store/extras/weather.gif', slideshow([f'public/assets/site/{n}.jpg' for n in
                                                     ('feat_weather', 'feat_storm', 'feat_fog', 'feat_light')]), 100)
save_gif('steam/store/extras/daynight.gif', slideshow([f'public/assets/site/tod_{k}.jpg' for k in range(4)], hold=11), 100)

# README: 41 frames (every other one) from the heart of each arena's shot
webp = [frame(s * SHOT + 30 + 2 * k, (800, 450)) for s in range(5) for k in range(41)]
webp[0].save('docs/readme/trailer.webp', save_all=True, append_images=webp[1:], duration=67, loop=0, quality=62, method=6)
print('docs/readme/trailer.webp', len(webp), os.path.getsize('docs/readme/trailer.webp'))
