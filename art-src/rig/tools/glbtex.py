"""Read / replace the base-colour texture inside a (non-compressed) GLB.
  python glbtex.py dump <in.glb> <out_dir>            -> writes every image
  python glbtex.py beak <in.glb> <out.glb> [preview]  -> Kappa's beak repainted bright yellow
"""
import io, json, struct, sys, os, colorsys
import numpy as np
from PIL import Image

def read(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    off, chunks = 12, []
    while off < len(b):
        ln, typ = struct.unpack_from('<I4s', b, off)
        chunks.append((typ, b[off + 8: off + 8 + ln]))
        off += 8 + ln
    j = json.loads(chunks[0][1])
    return j, bytearray(chunks[1][1])

def write(path, j, bin_):
    while len(bin_) % 4: bin_ += b'\0'
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    j['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(bin_), b'BIN\0') + bytes(bin_)
    open(path, 'wb').write(out)

def image_bytes(j, bin_, i):
    bv = j['bufferViews'][j['images'][i]['bufferView']]
    s = bv.get('byteOffset', 0)
    return bytes(bin_[s:s + bv['byteLength']])

def replace_image(j, bin_, i, data):
    """Replace image i's bytes, shifting every later bufferView."""
    vi = j['images'][i]['bufferView']
    bv = j['bufferViews'][vi]
    s, old = bv.get('byteOffset', 0), bv['byteLength']
    pad = (-len(data)) % 4
    new = data + b'\0' * pad
    oldp = old + ((-old) % 4)
    delta = len(new) - oldp
    bin_[s:s + oldp] = new
    bv['byteLength'] = len(data)
    for k, v in enumerate(j['bufferViews']):
        if k != vi and v.get('byteOffset', 0) > s: v['byteOffset'] = v.get('byteOffset', 0) + delta
    return bin_

def beak(img):
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    s = (mx - mn) / np.maximum(mx, 1e-5)
    # hue in degrees
    d = np.maximum(mx - mn, 1e-5)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return a, h, s, mx

if __name__ == '__main__':
    cmd = sys.argv[1]
    j, bin_ = read(sys.argv[2])
    if cmd == 'dump':
        os.makedirs(sys.argv[3], exist_ok=True)
        for i, im in enumerate(j.get('images', [])):
            data = image_bytes(j, bin_, i)
            p = os.path.join(sys.argv[3], f'img{i}_{im.get("name", "")}.{im["mimeType"].split("/")[1]}')
            open(p, 'wb').write(data)
            print(p, Image.open(io.BytesIO(data)).size, im['mimeType'])
        print(json.dumps(j.get('materials'), indent=1)[:800])
    elif cmd == 'hist':
        im = Image.open(io.BytesIO(image_bytes(j, bin_, int(sys.argv[3]))))
        a, h, s, v = beak(im)
        m = (s > 0.3) & (v > 0.35)
        hist, edges = np.histogram(h[m], bins=36, range=(0, 360))
        for c, e in zip(hist, edges):
            if c: print(int(e), c)
