"""Kappa's beak: find it in 3D (beak-coloured vertices at the front of the head), rasterise its triangles
in UV space into a mask, and repaint those texels a clear yellow (keeping the shading).
  python beak.py probe <glb>
  python beak.py fix <in.glb> <out.glb> x0 x1 y0 y1 zmin     (box in model units)
"""
import io, sys, struct
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from glbtex import read, write, image_bytes, replace_image, beak

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def acc(j, bin_, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    n, c, dt = a['count'], NC[a['type']], CT[a['componentType']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or c * np.dtype(dt).itemsize
    raw = np.frombuffer(bytes(bin_), dtype=np.uint8)
    out = np.empty((n, c), dtype=dt)
    rows = np.lib.stride_tricks.as_strided(raw[start:], shape=(n, c * np.dtype(dt).itemsize), strides=(stride, 1))
    out = rows.copy().view(dt).reshape(n, c)
    if a.get('normalized') and dt != np.float32: out = out.astype(np.float32) / np.iinfo(dt).max
    return out.astype(np.float32) if dt == np.float32 else out

def body_prims(j, bin_):
    for m in j['meshes']:
        if 'weapon' in m.get('name', ''): continue
        for p in m['primitives']:
            yield acc(j, bin_, p['attributes']['POSITION']), acc(j, bin_, p['attributes']['TEXCOORD_0']), acc(j, bin_, p['indices']).reshape(-1, 3)

if __name__ == '__main__':
    cmd = sys.argv[1]
    j, bin_ = read(sys.argv[2])
    img = Image.open(io.BytesIO(image_bytes(j, bin_, 0))).convert('RGB')
    W, H = img.size
    a, h, s, v = beak(img)
    col = (h >= 25) & (h <= 56) & (s > 0.35) & (v > 0.4)
    if cmd == 'probe':
        for P, UV, I in body_prims(j, bin_):
            px = np.clip((UV[:, 0] * W).astype(int), 0, W - 1); py = np.clip((UV[:, 1] * H).astype(int), 0, H - 1)
            hit = col[py, px]
            Q = P[hit]
            print('verts', len(P), 'beak-coloured', len(Q), 'bbox all', P.min(0).round(3), P.max(0).round(3))
            # the front-most cluster
            front = Q[Q[:, 2] > np.percentile(P[:, 2], 90)] if len(Q) else Q
            for axis in range(3): print('axis', axis, np.percentile(front[:, axis], [2, 25, 50, 75, 98]).round(3) if len(front) else '-')
    else:
        x0, x1, y0, y1, zmin = map(float, sys.argv[4:9])
        mask = Image.new('L', (W, H), 0); d = ImageDraw.Draw(mask)
        n = 0
        for P, UV, I in body_prims(j, bin_):
            inbox = (P[:, 0] >= x0) & (P[:, 0] <= x1) & (P[:, 1] >= y0) & (P[:, 1] <= y1) & (P[:, 2] >= zmin)
            for t in I:
                if inbox[t].all():
                    d.polygon([(UV[k, 0] * W, UV[k, 1] * H) for k in t], fill=255); n += 1
        m = (np.asarray(mask) > 0) & (h > 15) & (h < 60) & (v > 0.25) & ~((s < 0.2) & (v > 0.8))  # skip dark lines and white highlights
        # yellow with the texel's own brightness (shading kept)
        lum = (0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2])[m]
        k = np.clip(lum / 0.78, 0.5, 1.05)[:, None]
        target = np.array([1.0, 0.74, 0.13], dtype=np.float32)
        a2 = a.copy(); a2[m] = np.clip(target * k, 0, 1)
        out = Image.fromarray((a2 * 255).astype(np.uint8))
        prev = out.copy(); pv = np.asarray(prev).copy(); pv[m & (np.arange(W)[None, :] % 8 == 0)] = [255, 0, 255]
        Image.fromarray(pv).save(sys.argv[3] + '.mask.png')
        buf = io.BytesIO(); out.save(buf, 'WEBP', quality=92)
        bin_ = replace_image(j, bin_, 0, buf.getvalue())
        write(sys.argv[3], j, bin_)
        print('triangles', n, 'texels', int(m.sum()))
