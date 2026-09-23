"""Background removal (rembg, local) for the menu art: art-src/chibi/action/<key>.png ->
art-src/chibi/cut_action/<key>.png (RGBA). Run with the .ai3d venv python; make_portraits.py then
builds the portraits from these cutouts.
Usage: .ai3d/venv/Scripts/python art-src/ai3d/cutout.py [keys...]"""
import os, sys
from PIL import Image
from rembg import remove, new_session

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src, dst = os.path.join(ROOT, 'art-src', 'chibi', 'action'), os.path.join(ROOT, 'art-src', 'chibi', 'cut_action')
os.makedirs(dst, exist_ok=True)
session = new_session('isnet-general-use')
for key in sys.argv[1:] or [f[:-4] for f in os.listdir(src) if f.endswith('.png')]:
    out = remove(Image.open(os.path.join(src, f'{key}.png')).convert('RGB'), session=session, post_process_mask=True)
    out.save(os.path.join(dst, f'{key}.png'))
    print(key, 'ok', flush=True)
