"""Bird body plan (penguin, duck, hen, sparrow): raw Hunyuan3D mesh -> rigged, animated game file.

  <raw>/<key>.glb -> art-src/fauna/out/<key>.glb -> public/assets/models/fauna/<key>.glb (meshopt, webp)

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P art-src/fauna/rig_bird.py --
         [keys...] [--preview] [--check] [--nopack] [--raw DIR]
  --check    landmark / weight renders only (work/check/<key>.png), no clips, no export
  --preview  contact sheet of every clip (work/preview/<key>.png, one strip per clip in work/preview/<key>/)
  --raw      folder of the raw GLBs (default art-src/glb/fauna, or $FAUNA_RAW)

The raw mesh is turned to face -Y (glTF +Z), put on the ground, centred between the feet, scaled to
the contract height, cleaned and decimated. Joints are estimated on the mesh (landmarks(), overrides
in landmarks/<key>.json), weights are computed here (heat weights fail on these fused figurines),
and the folded wings get a thin two-sided shell copy of their surface so they can open without
tearing the body. Clips are poses in the armature frame (the bird faces -Y, its left is +X):
  pitch = about X, positive tips forward / down;  yaw = about Z, positive turns left;
  roll  = about Y, positive leans left.
Planted feet use a two-bone IK (knee pole forward, as birds' hidden knees).
"""
import json
import math
import os
import subprocess
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT, WORK, MARKS = os.path.join(HERE, 'out'), os.path.join(HERE, 'work'), os.path.join(HERE, 'landmarks')
GAME = os.path.join(ROOT, 'public', 'assets', 'models', 'fauna')
FPS, TAU = 30, 2 * math.pi
TRIS, TEX = 5600, 512  # body triangles before the wing shells (contract: ~6k in all), texture px
I, V0 = Quaternion(), Vector()

# walk: T period (s, two steps), stride (per foot per cycle, x hip height), lift (x hip height), toe
# curl in swing (deg), roll / yaw of the body (deg), sway (side shift) / bob (x height), head bob
# (x the ground-fixed amount), tail wag (deg)
SPECIES = {
    'duck': dict(height=0.5, neck=0.58, wings='shell', extra='Swim',
                 walk=dict(T=0.6, stride=0.9, lift=0.3, toe=35, roll=9, yaw=7, sway=0.014, bob=0.01,
                           head=0.9, tail=12, pitch=0)),
    'hen': dict(height=0.55, neck=0.53, wings='shell', extra=None,
                walk=dict(T=0.8, stride=1.0, lift=0.5, toe=55, roll=3, yaw=4, sway=0.006, bob=0.012,
                          head=1.5, tail=5, pitch=-4)),
    'penguin': dict(height=0.6, neck=0.53, wings='flipper', extra='Slide',
                    walk=dict(T=0.6, stride=0.4, lift=0.14, toe=8, roll=13, yaw=9, sway=0.02, bob=0.006,
                              head=0.12, tail=8, pitch=0)),
    'sparrow': dict(height=0.25, neck=0.57, wings='shell', extra='Hop',
                    walk=dict(T=0.4, stride=0.8, lift=0.32, toe=30, roll=4, yaw=4, sway=0.006, bob=0.012,
                              head=1.0, tail=14, pitch=0)),
}
KEYS = ['duck', 'hen', 'penguin', 'sparrow']
SIDES = (('L', 1), ('R', -1))
HOP = 0.3  # sparrow hop length, x height


def sm(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def smv(e0, e1, x):
    """Vectorised smoothstep."""
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def rx(a): return Quaternion((1, 0, 0), a)
def ry(a): return Quaternion((0, 1, 0), a)
def rz(a): return Quaternion((0, 0, 1), a)
def rad(d): return math.radians(d)


# ------------------------------------------------------------------ raw mesh

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def select(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = active or objs[0]


def import_raw(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:  # bake the node transforms in, drop the hierarchy
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix()
    for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    select(meshes)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # weld the UV-seam splits (else every UV island is a loose part), drop floaters
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    size = max(obj.dimensions)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size * 1e-5)
    seen, parts = set(), []
    for f in bm.faces:
        if f in seen:
            continue
        stack, part = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        parts.append(part)
    big = max(len(p) for p in parts)
    drop = [f for p in parts if len(p) < 0.01 * big for f in p]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    print(f'  raw: {len(parts)} parts, dropped {len(parts) - sum(len(p) >= 0.01 * big for p in parts)} floaters')
    return obj


def decimate(obj, tris):
    obj.data.calc_loop_triangles()
    n = len(obj.data.loop_triangles)
    if n > tris:
        mod = obj.modifiers.new('dec', 'DECIMATE')
        mod.ratio = tris / n
        mod.use_collapse_triangulate = True
        select([obj])
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.shade_smooth()
    obj.data.calc_loop_triangles()
    print(f'  triangles: {n} -> {len(obj.data.loop_triangles)}')


def texture(obj):
    mat = obj.data.materials[0]
    img = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    if img.size[0] > TEX:
        img.scale(TEX, TEX)
    img.pack()
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.75  # matte figurine
    if 'Metallic' in bsdf.inputs:
        bsdf.inputs['Metallic'].default_value = 0.0
    return img


def vertex_colours(obj, img):
    """sRGB colour of every vertex (texture at its first loop's UV)."""
    me = obj.data
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    vi = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', vi)
    col = np.zeros((len(me.vertices), 3), np.float32)
    x = np.clip((uv[:, 0] % 1) * w, 0, w - 1).astype(int)
    y = np.clip((uv[:, 1] % 1) * h, 0, h - 1).astype(int)
    col[vi] = px[y, x, :3]
    return col


def verts(obj):
    a = np.empty(len(obj.data.vertices) * 3, np.float32)
    obj.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3).astype(np.float64)


def normals(obj):
    a = np.empty(len(obj.data.vertices) * 3, np.float32)
    obj.data.vertices.foreach_get('normal', a)
    return a.reshape(-1, 3).astype(np.float64)


def orient(obj, img, key, over):
    """Turn the bird to face -Y, feet on z = 0, centred between the feet, at the contract height.
    Heading = from the head's centre to the beak (the saturated orange / yellow at head height),
    which is robust on these big-headed figurines; a landmark "yaw" (deg) corrects it."""
    V = verts(obj)
    z0, z1 = V[:, 2].min(), V[:, 2].max()
    H0 = z1 - z0
    col = vertex_colours(obj, img)
    mx, mn = col.max(1), col.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-5)
    r, g, b = col.T
    d = np.maximum(mx - mn, 1e-5)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    head = V[:, 2] > z0 + 0.6 * H0
    beak = head & (sat > 0.5) & (mx > 0.6) & (hue > 18) & (hue < 62)
    hv = V[head]
    hc = (np.percentile(hv[:, :2], 3, 0) + np.percentile(hv[:, :2], 97, 0)) / 2
    if beak.sum() >= 6:
        look = V[beak, :2].mean(0) - hc
    else:
        look = hc - V[:, :2].mean(0)
    # the body (with its tail) is longest along its heading; the head may be turned (the 3/4
    # reference art) and the feet staggered, so the beak only says which way
    bv = V[(V[:, 2] > z0 + 0.12 * H0) & (V[:, 2] < z0 + 0.5 * H0), :2]
    bv = bv - bv.mean(0)
    ev, evec = np.linalg.eigh(bv.T @ bv)
    fwd = evec[:, 1]
    if ev[1] < 1.15 * ev[0]:  # round body: trust the beak
        fwd = look / np.linalg.norm(look)
    fwd = fwd if fwd @ look > 0 else -fwd
    ang = -math.pi / 2 - math.atan2(fwd[1], fwd[0]) + rad(over.get('yaw', 0.0))
    print(f'  heading along the body (axes {ev[1] / ev[0]:.2f}): raw yaw {math.degrees(math.atan2(fwd[1], fwd[0])):.0f} deg '
          f'(beak {math.degrees(math.atan2(look[1], look[0])):.0f}), turn {math.degrees(ang):.0f}')
    s = SPECIES[key]['height'] / H0
    M = Matrix.Diagonal((s, s, s, 1)) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Translation((0, 0, -z0))
    obj.data.transform(M)
    # untwist a turned head: rotate what is above the neck (blended over the neck) to look ahead
    V = verts(obj)
    H = SPECIES[key]['height']
    turn = math.atan2(look[1], look[0]) - math.atan2(fwd[1], fwd[0])
    turn = (turn + math.pi) % TAU - math.pi
    if abs(turn) > rad(6) and not over.get('keep_head'):
        zn = over.get('neck', SPECIES[key]['neck']) * H
        piv = V[np.abs(V[:, 2] - zn) < 0.02 * H, :2].mean(0)
        k = -turn * smv(zn - 0.06 * H, zn + 0.05 * H, V[:, 2])
        c, sn = np.cos(k), np.sin(k)
        d = V[:, :2] - piv
        V[:, 0] = piv[0] + c * d[:, 0] - sn * d[:, 1]
        V[:, 1] = piv[1] + sn * d[:, 0] + c * d[:, 1]
        obj.data.vertices.foreach_set('co', V.astype(np.float32).ravel())
        print(f'  head untwisted by {math.degrees(-turn):.0f} deg')
    # centre between the feet (the lowest few percent, split left / right)
    V = verts(obj)
    H = SPECIES[key]['height']
    low = V[V[:, 2] < 0.05 * H]
    cx = (np.percentile(low[:, 0], 2) + np.percentile(low[:, 0], 98)) / 2
    feet = [low[(low[:, 0] - cx) * sg > 0] for sg in (1, -1)]
    cy = np.mean([f[:, 1].mean() for f in feet if len(f)])
    obj.data.transform(Matrix.Translation((-cx, -cy, 0)))
    obj.data.update()


# ------------------------------------------------------------------ landmarks

def slab(V, z, h):
    return V[np.abs(V[:, 2] - z) < h]


def mid(a, axis, lo=3, hi=97):
    return (np.percentile(a[:, axis], lo) + np.percentile(a[:, axis], hi)) / 2


def landmarks(V, key, over):
    """Joint positions estimated on the oriented mesh; landmarks/<key>.json overrides any of them
    ({"joints": {"neck2": [x, y, z], ...}, "neck": 0.55 (x height), "yaw": deg, "wing_r": x height,
    "tail_base": 0.5}). Names: pelvis chest neck1 neck2 head top beak tail0 tail1, per side (.L/.R)
    hip knee ankle toe wing0 wing1 wing2 (a .L joint alone is mirrored to .R)."""
    sp = SPECIES[key]
    H = sp['height']
    x, y, z = V.T
    J = {}
    # belly underside: the lowest point near the mid-plane (the feet are off to the sides)
    centre = (np.abs(x) < 0.04 * H) & (np.abs(y) < 0.25 * H)
    zb = max(z[centre].min() if centre.any() else 0.12 * H, 0.08 * H)
    # neck: the narrowest slab between the body and the head, if there is a clear one
    zs = np.linspace(0.35 * H, 0.85 * H, 26)
    wid = np.array([np.ptp(np.percentile(slab(V, q, 0.012 * H)[:, 0], [3, 97])) if len(slab(V, q, 0.012 * H)) > 8 else 0
                    for q in zs])
    k = int(np.argmin(wid[3:-3])) + 3
    if 'neck' in over:
        zn = over['neck'] * H
    elif wid[k] < 0.85 * min(wid[:k].max(), wid[k:].max()):
        zn = zs[k]
    else:
        zn = sp['neck'] * H
    print(f'  belly {zb / H:.2f} H, neck {zn / H:.2f} H (narrowest {zs[k] / H:.2f}, ratio {wid[k] / max(1e-6, min(wid[:k].max(), wid[k:].max())):.2f})')
    # head
    hv = V[z > zn + 0.04 * H]
    hc = Vector((0, mid(hv, 1), mid(hv, 2)))
    front = hv[hv[:, 2] < zn + 0.35 * H]
    i = int(np.argmin(front[:, 1]))
    J['beak'] = Vector((0, front[i, 1], front[i, 2]))
    J['top'] = Vector((0, hc.y, z.max()))
    yc = lambda q: mid(slab(V, q, 0.02 * H), 1)
    # the neck pivots sit under the back half of the head (slab centres would be dragged back by
    # the tail and the wings)
    J['head'] = Vector((0, hc.y + 0.04 * H, zn + 0.03 * H))
    J['neck2'] = Vector((0, hc.y + 0.06 * H, zn - 0.03 * H))
    J['neck1'] = Vector((0, hc.y + 0.08 * H, zn - 0.1 * H))
    # body and tail (the tail: behind where the side profile thins out)
    bv = V[(z > zb) & (z < zn)]
    yf = np.percentile(bv[:, 1], 1)
    back = V[z > zb + 0.02 * H]
    ybins = np.arange(yf, back[:, 1].max(), 0.02 * H)
    ext = np.array([np.ptp(back[np.abs(back[:, 1] - q) < 0.012 * H][:, 2]) if (np.abs(back[:, 1] - q) < 0.012 * H).sum() > 4 else 0
                    for q in ybins])
    kmax = int(np.argmax(ext))
    tip_i = int(np.argmax(back[:, 1]))
    tip = Vector(back[tip_i])
    tipz = back[back[:, 1] > tip.y - 0.03 * H][:, 2].mean()
    thin = [j for j in range(kmax, len(ybins)) if ext[j] < 0.55 * ext[kmax]]
    ymid = (yf + tip.y) / 2
    yb = ybins[thin[0]] if thin and ybins[thin[0]] > ymid else ymid + over.get('tail_base', 0.5) * (tip.y - ymid)
    zt = z[(np.abs(y - yb) < 0.02 * H) & (z > zb)]
    J['tail0'] = Vector((0, yb - 0.03 * H, (np.percentile(zt, 20) + np.percentile(zt, 80)) / 2 if len(zt) else tipz))
    J['tail1'] = Vector((0, tip.y, tipz))
    J['pelvis'] = Vector((0, 0.0, zb + 0.14 * H))
    J['chest'] = Vector((0, yc(zb + 0.62 * (zn - zb)) - 0.02 * H, zb + 0.6 * (zn - zb)))
    # legs: the column under the belly, the foot on the ground
    for s, sg in SIDES:
        side = V[x * sg > 0.02 * H]
        foot = side[side[:, 2] < 0.04 * H]
        leg = side[(side[:, 2] > 0.05 * H) & (side[:, 2] < zb - 0.01 * H)]
        col = leg if len(leg) > 10 else foot
        cx, cy = mid(col, 0, 10, 90), mid(col, 1, 10, 90)
        kz = max(zb, 0.1 * H)
        az = min(0.07 * H, 0.45 * kz)
        J['knee.' + s] = Vector((cx, cy - 0.035 * H, kz))
        J['hip.' + s] = Vector((cx, cy, kz + 0.13 * H))
        J['ankle.' + s] = Vector((cx, cy, az))
        J['toe.' + s] = Vector((mid(foot, 0), np.percentile(foot[:, 1], 2), 0.012 * H))
    J['pelvis'].y = (J['hip.L'].y + J['hip.R'].y) / 2
    J['pelvis'].z = J['hip.L'].z
    # wings: shoulder at the front top of the body side, folded back and down toward the tail
    for s, sg in SIDES:
        hw = lambda q: np.percentile(slab(V, q, 0.02 * H)[:, 0] * sg, 97)
        if sp['wings'] == 'flipper':  # hanging along the sides
            zs0, zs2 = zn - 0.06 * H, zb + 0.2 * (zn - zb)
            J['wing0.' + s] = Vector((sg * hw(zs0) * 0.85, yc(zs0) + 0.02 * H, zs0))
            J['wing2.' + s] = Vector((sg * hw(zs2) * 1.0, yc(zs2) + 0.08 * H, zs2))
        else:
            zs0, zs2 = zn - 0.07 * H, zb + 0.4 * (zn - zb)
            J['wing0.' + s] = Vector((sg * hw(zs0) * 0.8, yc(zs0) - 0.02 * H, zs0))
            J['wing2.' + s] = Vector((sg * hw(zs2) * 0.8, J['tail0'].y, zs2))
        w0, w2 = J['wing0.' + s], J['wing2.' + s]
        m = (w0 + w2) / 2
        J['wing1.' + s] = Vector((sg * hw(m.z) * 0.95, m.y, m.z))
    for name, v in over.get('joints', {}).items():
        J[name] = Vector(v) * (H if over.get('relative') else 1)
        if name.endswith('.L') and name[:-2] + '.R' not in over.get('joints', {}):
            J[name[:-2] + '.R'] = Vector((-J[name].x, J[name].y, J[name].z))
    J['_zb'], J['_zn'] = zb, zn
    J['_wing_r'] = over.get('wing_r', 0.14 if sp['wings'] == 'shell' else 0.09) * H
    if sp['wings'] == 'flipper':  # how far inside the flipper line its inner face lies
        J['flipper_in'] = over.get('flipper_in', 0.04) * H
    return J


# ------------------------------------------------------------------ armature

# bone: (parent, head joint, tail joint)
BONES = {'root': (None, None, None), 'body': ('root', 'pelvis', 'chest'), 'chest': ('body', 'chest', 'neck1'),
         'neck1': ('chest', 'neck1', 'neck2'), 'neck2': ('neck1', 'neck2', 'head'),
         'head': ('neck2', 'head', 'top'), 'tail': ('body', 'tail0', 'tail1')}
for _s, _ in SIDES:
    BONES.update({f'wing1.{_s}': ('chest', f'wing0.{_s}', f'wing1.{_s}'), f'wing2.{_s}': (f'wing1.{_s}', f'wing1.{_s}', f'wing2.{_s}'),
                  f'thigh.{_s}': ('body', f'hip.{_s}', f'knee.{_s}'), f'shin.{_s}': (f'thigh.{_s}', f'knee.{_s}', f'ankle.{_s}'),
                  f'foot.{_s}': (f'shin.{_s}', f'ankle.{_s}', f'toe.{_s}')})
DEFORM = [b for b in BONES if b != 'root']


def build_armature(key, J, H):
    arm = bpy.data.armatures.new(key + '_rig')
    obj = bpy.data.objects.new(key + '_rig', arm)
    bpy.context.scene.collection.objects.link(obj)
    select([obj])
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, (parent, h, t) in BONES.items():
        b = arm.edit_bones.new(name)
        b.head, b.tail = (V0, Vector((0, 0, 0.12 * H))) if h is None else (J[h], J[t])
        d = (b.tail - b.head).normalized()
        b.align_roll(Vector((0, -1, 0)) if abs(d.z) > 0.7 else Vector((0, 0, 1)))
        if parent:
            b.parent = eb[parent]
        b.use_deform = name != 'root'
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.display_type = 'STICK'
    return obj


# ------------------------------------------------------------------ wing shells and weights

def wing_field(V, N, J, s, sg, soft):
    """How much each vertex is on the folded wing of side s (0..1), and where along it (arc)."""
    a, b, c = J['wing0.' + s], J['wing1.' + s], J['wing2.' + s]
    pts = [np.array(a), np.array(b), np.array(c)]
    best, arc, xl = np.full(len(V), 1e9), np.zeros(len(V)), np.zeros(len(V))
    cum = 0.0
    for p, q in zip(pts, pts[1:]):
        ab = q - p
        L = np.linalg.norm(ab)
        t = np.clip((V - p) @ ab / (L * L), 0, 1)
        foot = p + t[:, None] * ab
        dist = np.linalg.norm(V - foot, axis=1)
        hit = dist < best
        best[hit], arc[hit], xl[hit] = dist[hit], cum + t[hit] * L, foot[hit, 0]
        cum += L
    r = J['_wing_r']
    f = smv(r, r * (1 - soft), best) * (V[:, 0] * sg > 0)
    if 'flipper_in' in J:  # a flipper standing off the body: both faces, outward of its inner side
        f = f * smv(-J['flipper_in'], -0.6 * J['flipper_in'], (V[:, 0] - xl) * sg)
    else:  # a wing folded on the body: its outer surface only
        f = f * smv(0.05, 0.35, N[:, 0] * sg)
    # the ends of the capsule are round: taper past the tip
    return f, arc, cum


def add_shells(obj, J, H):
    """Duplicate the folded-wing surface of each side as a thin two-sided shell (outer copy facing
    out, inner copy facing in, pushed off the body by a few mm): the wings can then open over an
    intact body. Returns the per-vertex side code (1 L, 2 R, 0 body)."""
    me = obj.data
    V, N = verts(obj), normals(obj)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    lay = bm.verts.layers.int.new('shell')
    patch = {}
    for s, sg in SIDES:  # both patches picked before any duplicate renumbers the vertices
        # below the neck: a copy of neck skin left on the chest would show when the head turns
        core = (wing_field(V, N, J, s, sg, 0.25)[0] > 0.5) & (V[:, 2] < J['_zn'] - 0.04 * H)
        faces = {fc for fc in bm.faces if all(core[v.index] for v in fc.verts)}
        best = []
        while faces:  # keep the largest connected piece (no stray flakes)
            stack, part = [faces.pop()], []
            while stack:
                f = stack.pop()
                part.append(f)
                for v in f.verts:
                    for g in v.link_faces:
                        if g in faces:
                            faces.discard(g)
                            stack.append(g)
            best = max(best, part, key=len)
        patch[s] = best
    for s, sg in SIDES:
        faces = patch[s]
        for off, flip in ((0.009, False), (0.006, True)):
            geom = bmesh.ops.duplicate(bm, geom=faces)['geom']
            nv = [e for e in geom if isinstance(e, bmesh.types.BMVert)]
            nf = set(e for e in geom if isinstance(e, bmesh.types.BMFace))
            bm.normal_update()
            for v in nv:
                v.co += v.normal * off * H
                v[lay] = 1 if s == 'L' else 2
            # round off the saw-tooth outline the triangle selection leaves: smooth the border loop
            ring = {}
            for e in {e for f in nf for e in f.edges}:
                if len([f for f in e.link_faces if f in nf]) == 1:
                    a, b = e.verts
                    ring.setdefault(a, []).append(b)
                    ring.setdefault(b, []).append(a)
            for _ in range(6):
                new = {v: v.co * 0.5 + sum((u.co for u in nb), Vector()) * (0.5 / len(nb)) for v, nb in ring.items()}
                for v, co in new.items():
                    v.co = co
            if flip:
                bmesh.ops.reverse_faces(bm, faces=list(nf))
        print(f'  wing shell {s}: {len(faces)} faces x 2')
    bm.to_mesh(me)
    code = np.array([v[lay] for v in bm.verts])
    bm.free()
    me.update()
    return code


def neighbours(me):
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get('vertices', e)
    return e.reshape(-1, 2)


def skin_weights(obj, J, key, shell):
    """Weights by region: legs below the belly (along knee-ankle-toe), the torso split by height
    (the head boundary tilted: chin low, nape high), the tail behind its base, the wings (shells, or
    the penguin's flippers straight on the body), then smoothed along the surface."""
    sp = SPECIES[key]
    H = sp['height']
    V, N = verts(obj), normals(obj)
    n = len(V)
    B = {b: i for i, b in enumerate(DEFORM)}
    W = np.zeros((n, len(DEFORM)))
    x, y, z = V.T
    zb, zn = J['_zb'], J['_zn']
    body = shell == 0
    # torso: body -> chest -> neck1 -> neck2 -> head by height
    # the neck / head boundaries slope: the chin goes with the head, the back stays on the chest
    front, back = math.tan(rad(25)), math.tan(rad(40))
    chain = [('chest', J['chest'].z, 0.07), ('neck1', J['neck1'].z, 0.035), ('neck2', J['neck2'].z, 0.03),
             ('head', J['head'].z, 0.025)]
    carry = np.ones(n)
    below = 'body'
    for bone, jz, band in chain:
        # (steep behind only where the neck leaves the chest: higher up, the nape is head)
        dy = y - J[bone].y
        zz = z if bone == 'chest' else z - np.where(dy > 0, back if bone == 'neck1' else 0.0, front) * dy
        u = smv(jz - band * H, jz + band * H, zz)
        W[:, B[below]] += carry * (1 - u)
        carry = carry * u
        below = bone
    W[:, B['head']] += carry
    # tail: past a plane through its base, across the tail direction
    t0, t1 = np.array(J['tail0']), np.array(J['tail1'])
    td = (t1 - t0) / np.linalg.norm(t1 - t0)
    # (a tail rising behind the head, like the hen's fan, must not take the back of the head)
    ft = smv(-0.035 * H, 0.035 * H, (V - t0) @ td) * smv(t0[1] - 0.14 * H, t0[1] - 0.08 * H, y)
    ft *= (z > zb + 0.02 * H)
    W *= (1 - ft)[:, None]
    W[:, B['tail']] += ft
    # legs: below the belly, per side, along knee -> ankle -> toe (thigh blends in at the belly)
    for s, sg in SIDES:
        kn, an, to, hp = (np.array(J[j + '.' + s]) for j in ('knee', 'ankle', 'toe', 'hip'))
        side = (x * sg > 0) & body
        dh = np.hypot(x - kn[0], y - kn[1])
        legm = side & (z < zb - 0.005 * H)
        # arc along ankle -> toe decides foot vs shin
        at = to - an
        u = np.clip((V - an) @ at / (at @ at), 0, 1)
        dfoot = np.linalg.norm(V - (an + u[:, None] * at), axis=1)
        footw = smv(an[2] + 0.02 * H, an[2] - 0.015 * H, z) * (dfoot < 0.2 * H)
        footw = np.maximum(footw, smv(0.03 * H, 0.012 * H, z))  # anything flat on the ground: the foot
        # the thigh takes a little of the belly just around the top of the leg (a band, not a column)
        thw = smv(zb - 0.03 * H, zb + 0.01 * H, z) * smv(zb + 0.08 * H, zb + 0.03 * H, z) * smv(0.07 * H, 0.03 * H, dh)
        lw = np.where(legm, 1.0, 0.0) + np.where(side & ~legm, thw * 0.6, 0.0)
        lw = np.clip(lw, 0, 1)
        ff = footw * legm
        shin = np.clip(1 - ff, 0, 1) * legm * (1 - smv(zb - 0.03 * H, zb + 0.005 * H, z))
        thigh = lw - ff - shin
        W *= (1 - lw)[:, None]
        W[:, B['foot.' + s]] += ff
        W[:, B['shin.' + s]] += shin
        W[:, B['thigh.' + s]] += np.clip(thigh, 0, 1)
    # wings
    for s, sg in SIDES:
        f, arc, L = wing_field(V, N, J, s, sg, 0.35)
        L1 = (J['wing1.' + s] - J['wing0.' + s]).length
        split = smv(L1 - 0.05 * H, L1 + 0.05 * H, arc)
        if sp['wings'] == 'shell':
            mine = shell == (1 if s == 'L' else 2)
            root = smv(0.0, 0.3 * L1, arc)  # the shoulder end stays on the chest
            wf = mine * root
            W[mine] = 0
            W[mine, B['chest']] = 1 - root[mine]
        else:
            wf = f * body * (z < zn)
            W *= (1 - wf)[:, None]
        W[:, B['wing1.' + s]] += wf * (1 - split)
        W[:, B['wing2.' + s]] += wf * split
    # smooth along the surface (the legs, feet and shells are separate enough not to bleed)
    E = neighbours(obj.data)
    deg = np.bincount(E.ravel(), minlength=n).astype(float)
    for _ in range(3):
        acc = np.zeros_like(W)
        np.add.at(acc, E[:, 0], W[E[:, 1]])
        np.add.at(acc, E[:, 1], W[E[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        W = np.where(deg[:, None] > 0, 0.5 * W + 0.5 * avg, W)
    # four influences at most, normalised
    idx = np.argsort(-W, axis=1)[:, 4:]
    np.put_along_axis(W, idx, 0, axis=1)
    W[W < 0.01] = 0
    lost = W.sum(1) < 0.5
    if lost.any():
        print(f'  {lost.sum()} vertices without weights, e.g. {V[lost][:3].round(3).tolist()}')
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    obj.vertex_groups.clear()
    for b, i in B.items():
        vg = obj.vertex_groups.new(name=b)
        for val in np.unique(np.round(W[:, i], 3)):
            if val <= 0:
                continue
            vg.add(np.nonzero(np.round(W[:, i], 3) == val)[0].tolist(), float(val), 'REPLACE')
    return W


# ------------------------------------------------------------------ pose solver

class Rig:
    """The armature's rest data and a forward / IK solver that mirrors Blender's pose evaluation:
    a bone's armature-frame delta is D = D(parent) @ q, its head P = P(parent) + D(parent) @ (rest
    offset + o). Keyed as rotation_quaternion = R^-1 q R, location = R^-1 o (R: rest orientation)."""

    def __init__(self, key, obj, body, J, W):
        self.key, self.obj, self.body, self.J, self.W = key, obj, body, J, W
        self.sp = SPECIES[key]
        self.H = self.sp['height']
        bones = obj.data.bones
        self.names = [b.name for b in bones]
        self.parent = {b.name: b.parent.name if b.parent else None for b in bones}
        self.h = {b.name: b.head_local.copy() for b in bones}
        self.t = {b.name: b.tail_local.copy() for b in bones}
        self.R = {b.name: b.matrix_local.to_quaternion() for b in bones}
        self.X = verts(body)
        self.head_vi = np.nonzero(W[:, DEFORM.index('head')] > 0.5)[0]
        self.cache = {}

    def solve(self, p):
        D, P = {}, {}
        for n in self.names:
            par = self.parent[n]
            if n.startswith('thigh.') and p.feet.get(n[-1]) is not None:
                self.leg_ik(p, n[-1], D, P)
            q, o = p.q.get(n, I), p.o.get(n, V0)
            if par is None:
                D[n], P[n] = q.copy(), self.h[n] + o
            else:
                D[n] = D[par] @ q
                P[n] = P[par] + D[par] @ (self.h[n] - self.h[par] + o)
        return D, P

    def leg_ik(self, p, s, D, P):
        th, sh, ft = 'thigh.' + s, 'shin.' + s, 'foot.' + s
        f = p.feet[s]
        Db = D['body']
        hip = P['body'] + Db @ (self.h[th] - self.h['body'])
        l1 = (self.h[sh] - self.h[th]).length
        l2 = (self.h[ft] - self.h[sh]).length
        v = f['pos'] - hip
        d = min(max(v.length, abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9999)
        u = v.normalized()
        pole = Db @ Vector((0, -1, 0))
        pp = (pole - u * pole.dot(u)).normalized()
        a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
        knee = hip + u * a + pp * math.sqrt(max(0.0, l1 * l1 - a * a))
        ankle = hip + u * d

        def frame(dv, nv):
            yv = dv.normalized()
            xv = (nv - yv * nv.dot(yv)).normalized()
            return Matrix((xv, yv, xv.cross(yv))).transposed()
        n_r = (self.h[ft] - self.h[th]).cross(Vector((0, -1, 0)))
        n_t = v.cross(pole)
        Dth = (frame(knee - hip, n_t) @ frame(self.h[sh] - self.h[th], n_r).transposed()).to_quaternion()
        Dsh = (frame(ankle - knee, n_t) @ frame(self.h[ft] - self.h[sh], n_r).transposed()).to_quaternion()
        Dft = rz(f.get('yaw', 0.0)) @ rx(f.get('pitch', 0.0))
        p.q[th] = Db.inverted() @ Dth
        p.q[sh] = Dth.inverted() @ Dsh
        p.q[ft] = Dsh.inverted() @ Dft

    def skinned(self, D, P, only=None):
        X = self.X if only is None else self.X[only]
        W = self.W if only is None else self.W[only]
        out = np.zeros_like(X)
        for j, n in enumerate(DEFORM):
            w = W[:, j]
            if not w.any():
                continue
            M = np.array(D[n].to_matrix())
            tr = np.array(P[n]) - M @ np.array(self.h[n])
            out += w[:, None] * (X @ M.T + tr)
        return out

    def apply(self, p, frame, last):
        for pb in self.obj.pose.bones:
            n = pb.name
            R = self.R[n]
            pb.rotation_mode = 'QUATERNION'
            qq = R.inverted() @ p.q.get(n, I) @ R
            if n in last and last[n].dot(qq) < 0:
                qq = -qq
            last[n] = qq.copy()
            pb.rotation_quaternion = qq
            pb.location = R.inverted() @ p.o.get(n, V0)
            pb.keyframe_insert('rotation_quaternion', frame=frame, group=n)
            pb.keyframe_insert('location', frame=frame, group=n)


class Pose:
    def __init__(self, C):
        self.q, self.o = {}, {}
        self.feet = {s: dict(pos=C.h['foot.' + s].copy(), pitch=0.0, yaw=0.0) for s, _ in SIDES}

    def rot(self, bone, qq):
        self.q[bone] = qq @ self.q.get(bone, I)

    def move(self, bone, v):
        self.o[bone] = self.o.get(bone, V0) + Vector(v)


# ------------------------------------------------------------------ clip helpers

def curve(t, ks, period=None):
    """Smooth piecewise curve through (time, value) keys; with a period it wraps (loops)."""
    if period:
        t %= period
        ks = [(ks[-1][0] - period, ks[-1][1])] + list(ks) + [(ks[0][0] + period, ks[0][1])]
    if t <= ks[0][0]:
        return ks[0][1]
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * sm((t - t0) / (t1 - t0))
    return ks[-1][1]


def bell(t, a, b):
    """0 outside [a, b], a smooth bump to 1 in the middle."""
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a)) ** 2


def look(p, yaw, tilt=0.0, nod=0.0):
    """Turn the head: spread over the neck, most of it in the head."""
    for b, k in (('neck1', 0.2), ('neck2', 0.3), ('head', 0.5)):
        p.rot(b, rz(yaw * k))
    p.rot('head', ry(tilt) @ rx(nod))


def wings(p, C, spread=0.0, flap=0.0, fold=0.0, back=0.0):
    """spread: the folded wing swings out to the side (0..1); flap: up (+) / down about the forward
    axis (rad); fold: wing2 opens relative to wing1 (0..1); back: flippers swept back (rad)."""
    for s, sg in SIDES:
        w1 = C.t['wing1.' + s] - C.h['wing1.' + s]
        out = Vector((sg, -0.15, 0.1)).normalized()
        q_sp = I.slerp(w1.normalized().rotation_difference(out), spread) if spread else I
        p.rot('wing1.' + s, ry(-sg * flap) @ rx(-back) @ q_sp)
        if fold:
            w2 = C.t['wing2.' + s] - C.h['wing2.' + s]
            p.rot('wing2.' + s, I.slerp(w2.normalized().rotation_difference(w1.normalized()), fold))


def breathe(p, C, t, period, amp=1.0):
    b = math.sin(TAU * t / period)
    p.rot('chest', rx(-0.03 * amp * b))
    p.rot('head', rx(0.02 * amp * b))


# ------------------------------------------------------------------ clips

def c_idle(C, t, T=4.0):
    p = Pose(C)
    H = C.H
    breathe(p, C, t, 2.0)
    shift = math.sin(TAU * t / T)
    p.rot('body', ry(rad(2.0) * shift))
    p.move('body', (0.006 * H * shift, 0, -0.004 * H * (1 - math.cos(TAU * t / 2.0))))
    yaw = curve(t, [(0.2, 0), (0.6, 30), (1.5, 30), (1.8, -12), (2.7, -12), (3.2, 0)], T)
    tilt = curve(t, [(0.2, 0), (0.6, 12), (1.5, 6), (1.8, -16), (2.7, -16), (3.2, 0)], T)
    nod = curve(t, [(0.0, 0), (3.2, 0), (3.4, 10), (3.6, 0)], T)
    look(p, rad(yaw), rad(tilt), rad(nod))
    flick = bell(t, 1.1, 1.55)
    p.rot('tail', rz(rad(18) * flick * math.sin(TAU * (t - 1.1) / 0.225)) @ rx(-rad(8) * flick))
    flick2 = bell(t, 2.9, 3.25)
    p.rot('tail', rz(rad(14) * flick2 * math.sin(TAU * (t - 2.9) / 0.175)))
    shuffle = bell(t, 3.3, 3.8)
    if C.sp['wings'] == 'flipper':
        wings(p, C, flap=rad(22) * shuffle * (0.6 + 0.4 * math.sin(TAU * (t - 3.3) / 0.25)))
    else:
        wings(p, C, spread=0.12 * shuffle, flap=rad(10) * shuffle)
    return p


def gait(C, t, g):
    """Walk cycle: phase of each foot, stride and the crouch that lets the legs reach."""
    H = C.H
    hip_h = C.h['thigh.L'].z
    S = g['stride'] * hip_h
    l = (C.h['shin.L'] - C.h['thigh.L']).length + (C.h['foot.L'] - C.h['shin.L']).length
    reach = C.h['thigh.L'].z - C.h['foot.L'].z
    crouch = max(0.0, reach - math.sqrt(max(0.0, (0.97 * l) ** 2 - (S / 2) ** 2)))
    return S, crouch, S / g['T']


def step_foot(C, p, s, u, S, lift, toe, beta=0.6, dx=0.0):
    """Foot s at phase u (0 = lands): planted and sliding back while the body passes over it,
    then lifted and swung forward (toes curled)."""
    base = C.h['foot.' + s]
    if u < beta:
        k = u / beta
        dy, dz, pitch = -S / 2 + S * k, 0.0, 0.0
    else:
        k = (u - beta) / (1 - beta)
        e = sm(k)
        dy = S / 2 - S * e
        dz = lift * math.sin(math.pi * k) ** 1.2
        pitch = rad(toe) * math.sin(math.pi * min(1.0, k * 1.15))
    p.feet[s] = dict(pos=base + Vector((dx, dy, dz)), pitch=pitch)


def c_walk(C, t):
    g = C.sp['walk']
    T, H = g['T'], C.H
    S, crouch, v = gait(C, t, g)
    uL = (t / T) % 1
    beta = 0.6
    hip_h = C.h['thigh.L'].z
    p = Pose(C)
    for s, off in (('L', 0.0), ('R', 0.5)):
        step_foot(C, p, s, (uL + off) % 1, S, g['lift'] * hip_h, g['toe'], beta)
    # lean over the planted foot (waddle), hips yaw with the swinging leg, bob twice per cycle
    lean = math.cos(TAU * (uL - beta / 2))
    p.rot('body', rz(rad(g['yaw']) * math.sin(TAU * (uL - beta / 2))) @ ry(rad(g['roll']) * lean) @ rx(rad(g['pitch'])))
    p.move('body', (g['sway'] * H * lean, 0, -crouch - g['bob'] * H * (0.5 + 0.5 * math.cos(2 * TAU * (uL - beta / 2)))))
    # keep the head level against the roll, the tail wags against the hips
    p.rot('neck1', ry(-rad(g['roll']) * 0.5 * lean))
    p.rot('head', ry(-rad(g['roll']) * 0.3 * lean))
    p.rot('tail', rz(-rad(g['tail']) * math.sin(TAU * (uL - beta / 2))) @ rx(-rad(g['tail']) * 0.3 * math.cos(2 * TAU * uL)))
    # head bob: the head holds still in the world (drifts back at the ground speed), then thrusts
    ph = (2 * uL) % 1
    hold = 0.55
    A = v * hold * (T / 2) / 2 * g['head']
    if ph < hold:
        hy = -A + 2 * A * ph / hold
        hz = 0.0
    else:
        k = (ph - hold) / (1 - hold)
        hy = A - 2 * A * sm(k)
        hz = -0.25 * A * math.sin(math.pi * k)
    p.move('neck1', (0, hy * 0.35, hz * 0.35))
    p.move('head', (0, hy * 0.65, hz * 0.65))
    p.rot('neck1', rx(-(hy / max(1e-6, A)) * rad(4) * min(1.0, g['head'])))
    if C.sp['wings'] == 'flipper':  # flippers out for balance, swinging with the waddle
        wings(p, C, flap=rad(g.get('flippers', 22)) + rad(8) * lean)
    else:
        wings(p, C, flap=rad(2) * math.cos(2 * TAU * uL))
    breathe(p, C, t, T, 0.5)
    return p


def c_peck(C, t, dur=1.8):
    """Bend down, two quick jabs to the ground, back up."""
    k0 = C.cache.get('peck')
    if k0 is None:  # how far to bend for the beak to touch the ground
        lo, hi = 0.0, 1.6
        for _ in range(18):
            mid_ = (lo + hi) / 2
            D, P = C.solve(bend(C, Pose(C), mid_))
            zmin = C.skinned(D, P, C.head_vi)[:, 2].min()
            lo, hi = (mid_, hi) if zmin > 0.004 * C.H else (lo, mid_)
        k0 = C.cache['peck'] = lo
        print(f'  peck: bend {k0:.2f} to touch the ground')
    k = curve(t, [(0, 0), (0.35, 0.82), (0.45, 1.0), (0.55, 0.8), (0.72, 0.8), (0.82, 1.0), (0.94, 0.78),
                  (1.25, 0.72), (1.75, 0)])
    p = bend(C, Pose(C), k * k0)
    p.rot('tail', rx(-rad(10) * min(1.0, k * 1.5)))
    wings(p, C, flap=rad(6) * k)
    return p


def bend(C, p, k):
    """Peck posture, k = 1: body tipped forward, neck and head pitched down."""
    H = C.H
    p.rot('body', rx(rad(34) * k))
    p.rot('chest', rx(rad(14) * k))
    p.rot('neck1', rx(rad(18) * k))
    p.rot('neck2', rx(rad(14) * k))
    p.rot('head', rx(rad(16) * k))
    p.move('body', (0, 0.03 * H * k, -0.015 * H * k))  # the hips sit back to balance
    return p


def c_look(C, t, dur=2.6):
    p = Pose(C)
    yaw = curve(t, [(0, 0), (0.35, 55), (0.95, 55), (1.35, -50), (1.95, -50), (2.45, 0)])
    tilt = curve(t, [(0, 0), (0.35, 14), (0.95, 20), (1.35, -14), (1.95, -20), (2.45, 0)])
    nod = curve(t, [(0, 0), (1.95, 0), (2.15, -8), (2.45, 0)])
    look(p, rad(yaw), rad(tilt), rad(nod))
    p.rot('body', rz(rad(yaw) * 0.12))
    breathe(p, C, t, 1.3, 0.6)
    return p


def c_flap(C, t, dur=1.8):
    """Stretch up, open the wings and flap a few times, fold them back."""
    p = Pose(C)
    H = C.H
    op = curve(t, [(0, 0), (0.3, 1), (1.4, 1), (1.75, 0)])
    beats = 4
    ph = min(1.0, max(0.0, (t - 0.3) / 1.1))
    beat = math.sin(TAU * beats * ph) * bell(ph, 0, 1) ** 0.3 if 0 < ph < 1 else 0.0
    if C.sp['wings'] == 'flipper':
        wings(p, C, flap=rad(28) * op + rad(22) * beat * op)
    else:  # half open and fluttering up: a full span shows the shell as a flat plate
        wings(p, C, spread=0.55 * op, flap=rad(30) * op + rad(28) * beat * op, fold=0.3 * op)
    p.rot('body', rx(-rad(10) * op))
    p.rot('chest', rx(-rad(6) * op))
    p.rot('neck2', rx(rad(8) * op))
    p.rot('tail', rx(-rad(14) * op) @ rz(rad(6) * beat))
    p.move('body', (0, 0, -0.012 * H * op + 0.01 * H * beat * op))
    return p


def c_hop(C, t, T=0.4):
    """Sparrow hop: both feet together, crouch, spring, land. The ground part slides back at the
    travel speed (locomotion in place)."""
    H = C.H
    d = HOP * C.H  # hop length
    v = d / T
    u = (t / T) % 1
    ground = 0.4  # fraction of the cycle on the ground
    p = Pose(C)
    slide = d * ground  # the feet slide back this much while on the ground (the body travels on)
    if u < ground:
        k = u / ground
        dy = -slide / 2 + slide * k
        crouch = math.sin(math.pi * k) * 0.06 * H
        air = 0.0
        pitch = 0.0
        tuck = 0.0
    else:
        k = (u - ground) / (1 - ground)
        dy = slide / 2 - slide * sm(k)
        crouch = 0.0
        air = 0.14 * H * 4 * k * (1 - k)
        pitch = rad(35) * math.sin(math.pi * k)
        tuck = math.sin(math.pi * k)
    for s, _ in SIDES:
        base = C.h['foot.' + s]
        p.feet[s] = dict(pos=base + Vector((0, dy, air + 0.05 * H * tuck)), pitch=pitch)
    p.move('root', (0, 0, air))
    p.move('body', (0, 0, -crouch))
    lean = math.sin(TAU * u)
    p.rot('body', rx(rad(8) * lean))
    p.rot('neck1', rx(-rad(6) * lean))
    p.rot('tail', rx(-rad(22) * bell(u, 0.0, 0.3) + rad(10) * tuck))
    wings(p, C, spread=0.08 * tuck, flap=rad(14) * tuck)
    return p


def c_slide(C, t, T=1.6):
    """Penguin belly slide: lying on the belly, head up, flippers back, feet trailing; gentle rock.
    The lowest point of the skinned mesh is put on the ground every frame."""
    p = Pose(C)
    rock = math.sin(TAU * t / T)
    p.feet = {'L': None, 'R': None}
    p.rot('body', rz(rad(3) * math.sin(TAU * t / T + 1.0)) @ ry(rad(7) * rock) @ rx(rad(82)))
    p.rot('chest', rx(rad(4)))
    p.rot('neck1', rx(-rad(28)))
    p.rot('neck2', rx(-rad(22)))
    p.rot('head', rx(-rad(20)) @ ry(-rad(5) * rock))
    for s, sg in SIDES:
        p.rot('thigh.' + s, rx(-rad(35)) @ rz(-sg * rad(8)))
        p.rot('foot.' + s, rx(-rad(30) + rad(10) * math.sin(TAU * t / T + (0 if s == 'L' else math.pi))))
    wings(p, C, flap=rad(12) + rad(6) * rock, back=rad(10))
    p.rot('tail', rx(-rad(72)))  # trails flat behind (the body is tipped 82 deg)
    D, P = C.solve(p)
    X = C.skinned(D, P)
    if 'slide_y' not in C.cache:  # centre the lying body over the origin (same shift every frame)
        C.cache['slide_y'] = -(X[:, 1].min() + X[:, 1].max()) / 2
    p.move('root', (0, C.cache['slide_y'], -X[:, 2].min()))
    return p


def c_swim(C, t, T=1.6):
    """Duck swimming: body sunk to the waterline (z = 0 is the water), gentle bob and rock, feet
    paddling underneath (folded back, kicking in turn)."""
    p = Pose(C)
    H = C.H
    zb, zn = C.J['_zb'], C.J['_zn']
    sink = zb + 0.3 * (zn - zb)
    ph = TAU * t / T
    p.feet = {'L': None, 'R': None}
    p.move('root', (0, 0, -sink + 0.008 * H * math.sin(2 * ph)))
    p.rot('body', rx(-rad(4) + rad(2) * math.sin(2 * ph + 0.6)) @ ry(rad(3) * math.sin(ph)))
    for s, sg in SIDES:
        k = math.sin(ph + (0 if s == 'L' else math.pi))
        p.rot('thigh.' + s, rx(-rad(30) - rad(22) * k))
        p.rot('shin.' + s, rx(-rad(20) + rad(15) * k))
        p.rot('foot.' + s, rx(rad(40) * max(0.0, -k) - rad(30)))
    p.rot('tail', rx(-rad(12)) @ rz(rad(8) * math.sin(ph)))
    look(p, rad(8) * math.sin(ph), 0.0, rad(3) * math.sin(2 * ph))
    breathe(p, C, t, T / 2, 0.5)
    return p


def clip_list(key):
    sp = SPECIES[key]
    cl = [('Idle', c_idle, 4.0, True), ('Walk', c_walk, sp['walk']['T'], True), ('Peck', c_peck, 1.8, False),
          ('Look', c_look, 2.6, False), ('Flap', c_flap, 1.8, False)]
    extra = {'Hop': (c_hop, 0.4, True), 'Slide': (c_slide, 1.6, True), 'Swim': (c_swim, 1.6, True)}
    if sp['extra']:
        cl.append((sp['extra'], *extra[sp['extra']]))
    return cl


def make_clips(C):
    rig = C.obj
    rig.animation_data_create()
    info = {}
    for name, fn, dur, loop in clip_list(C.key):
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        n = round(dur * FPS)
        last = {}
        for f in range(n + 1):
            t = 0.0 if loop and f == n else f / FPS
            p = fn(C, t)
            C.solve(p)  # fills the IK bones' rotations
            C.apply(p, f, last)
        act.frame_range = (0, n)
        act.use_frame_range = True
        act.use_cyclic = loop
        # the solver must mirror Blender's evaluation (planted feet stay planted): compare a frame
        fm = n // 3
        bpy.context.scene.frame_set(fm)
        D, P = C.solve(fn(C, fm / FPS))
        err = max((rig.pose.bones[b].tail - (P[b] + D[b] @ (C.t[b] - C.h[b]))).length for b in C.names)
        if err > 1e-4:
            print(f'  WARNING {name}: solver and Blender differ by {err:.5f} m')
        info[name] = dict(duration=round(n / FPS, 3), loop=loop)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion, pb.location = I, V0
    g = C.sp['walk']
    speed = {'Walk': round(gait(C, 0, g)[2], 3)}
    if C.sp['extra'] == 'Hop':
        speed['Hop'] = round(HOP * C.H / 0.4, 3)
    if C.sp['extra'] == 'Swim':
        speed['Swim'] = 0.25
    rig['speed'] = speed
    for k, v in speed.items():
        info[k]['speed'] = v
    return info


# ------------------------------------------------------------------ renders

def camera(name, loc, target, scale):
    cd = bpy.data.cameras.new(name)
    cd.type = 'ORTHO'
    cd.ortho_scale = scale
    cam = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return cam


def render_setup(res, color='TEXTURE'):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = color
    sc.display.shading.show_cavity = False
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.color = (0.72, 0.76, 0.8)


def ground(H):
    bpy.ops.mesh.primitive_plane_add(size=4 * H)
    g = bpy.context.active_object
    m = bpy.data.materials.new('ground')
    m.diffuse_color = (0.45, 0.55, 0.4, 1)
    g.data.materials.append(m)
    return g


def shoot(cam, path):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def tile(paths, cols, out):
    """Paste equal-size PNGs into a grid (row-major, top-left first)."""
    ims = [bpy.data.images.load(p) for p in paths]
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 4), np.float32)
    sheet[..., 3] = 1
    for k, im in enumerate(ims):
        a = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)  # bottom row first
        r, c = k // cols, k % cols
        y0 = (rows - 1 - r) * h
        sheet[y0:y0 + h, c * w:(c + 1) * w] = a
        bpy.data.images.remove(im)
    img = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def views(H, zc):
    """Side (the bird's left) and the game's view: from the front-left, high above."""
    side = camera('side', (4 * H, 0, zc), (0, 0, zc), 1.7 * H)
    top = camera('top', (2.2 * H, -3.0 * H, 4.2 * H), (0, 0, zc * 0.8), 1.7 * H)
    return side, top


def check_sheet(C, key):
    """Landmarks and weights: textured (x-ray joints), then bone colours, front / side / back / top."""
    out = os.path.join(WORK, 'check')
    os.makedirs(out, exist_ok=True)
    H, body = C.H, C.body
    me = body.data
    # body white, chest grey, necks cyan / blue, head yellow, tail magenta, wings red / orange,
    # thigh green, shin dark green, foot brown (both sides alike)
    PAL = {'body': (0.95, 0.95, 0.95), 'chest': (0.55, 0.55, 0.55), 'neck1': (0.2, 0.9, 0.9), 'neck2': (0.15, 0.3, 1.0),
           'head': (1.0, 0.85, 0.1), 'tail': (0.9, 0.1, 0.9), 'wing1': (0.95, 0.1, 0.1), 'wing2': (1.0, 0.55, 0.0),
           'thigh': (0.3, 1.0, 0.3), 'shin': (0.0, 0.45, 0.1), 'foot': (0.45, 0.25, 0.05)}
    pal = np.array([PAL[b.split('.')[0]] for b in DEFORM])
    colr = C.W @ pal
    attr = me.color_attributes.new('wcol', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.hstack([colr, np.ones((len(colr), 1))]).ravel().astype(np.float32))
    me.color_attributes.active_color = attr
    balls = []
    for name, v in C.J.items():
        if not isinstance(v, Vector):
            continue
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012 * H, location=v, segments=8, ring_count=6)
        balls.append(bpy.context.active_object)
    zc = H / 2
    cams = [camera('f', (0, -4 * H, zc), (0, 0, zc), 1.5 * H), camera('s', (4 * H, 0, zc), (0, 0, zc), 1.5 * H),
            camera('b', (0, 4 * H, zc), (0, 0, zc), 1.5 * H), camera('t', (0, -0.001, 5 * H), (0, 0, 0), 1.5 * H)]
    paths = []
    for color, xray in (('TEXTURE', True), ('VERTEX', False)):
        render_setup(320, color)
        sc = bpy.context.scene
        sc.display.shading.show_xray = xray
        sc.display.shading.xray_alpha = 0.55
        for b in balls:
            b.hide_render = not xray
        for cam in cams:
            pth = os.path.join(out, f'_{key}_{color}_{cam.name}.png')
            shoot(cam, pth)
            paths.append(pth)
    bpy.context.scene.display.shading.show_xray = False
    tile(paths, 4, os.path.join(out, key + '.png'))
    for o in balls + cams:
        bpy.data.objects.remove(o)
    me.color_attributes.remove(me.color_attributes['wcol'])
    return os.path.join(out, key + '.png')


def preview(C, key, frames=6):
    """Contact sheet: per clip a row of side views and a row of game views."""
    out = os.path.join(WORK, 'preview', key)
    os.makedirs(out, exist_ok=True)
    H = C.H
    render_setup(256)
    g = ground(H)
    side, top = views(H, 0.45 * H)
    rig = C.obj
    allp = []
    for name, fn, dur, loop in clip_list(key):
        act = bpy.data.actions[name]
        rig.animation_data.action = act
        n = int(act.frame_range[1])
        paths = {'s': [], 't': []}
        for i in range(frames):
            f = round(i * n / (frames if loop else frames - 1))
            bpy.context.scene.frame_set(f)
            for tag, cam in (('s', side), ('t', top)):
                pth = os.path.join(out, f'{name}_{tag}{i}.png')
                shoot(cam, pth)
                paths[tag].append(pth)
        tile(paths['s'] + paths['t'], frames, os.path.join(out, name + '.png'))
        allp += paths['s'] + paths['t']
    rig.animation_data.action = None
    tile(allp, frames, os.path.join(WORK, 'preview', key + '.png'))
    for o in (g, side, top):
        bpy.data.objects.remove(o)


# ------------------------------------------------------------------ export

def export(key, rig, body):
    os.makedirs(OUT, exist_ok=True)
    select([rig, body], rig)
    path = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_skins=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_optimize_animation_size=True, export_def_bones=False, export_image_format='AUTO',
        export_normals=True, export_apply=False, export_reset_pose_bones=True, export_extras=True)
    return path


def pack(key):
    """Blender's GLB -> game file: keyframes deduplicated, 512 px webp, meshopt."""
    os.makedirs(GAME, exist_ok=True)
    src = os.path.join(OUT, key + '.glb')
    tmp = [os.path.join(OUT, f'{key}.tmp{i}.glb') for i in range(3)]
    dst = os.path.join(GAME, key + '.glb')
    cli = lambda *a: subprocess.run('npx --yes @gltf-transform/cli@4 ' + ' '.join(f'"{x}"' for x in a),
                                    shell=True, check=True, capture_output=True, cwd=ROOT)
    cli('resample', src, tmp[0], '--tolerance', '0.0005')
    cli('resize', tmp[0], tmp[1], '--width', str(TEX), '--height', str(TEX))
    cli('webp', tmp[1], tmp[2], '--quality', '88')
    cli('meshopt', tmp[2], dst, '--level', 'medium')
    for f in tmp:
        os.remove(f)
    return dst


def inspect(path):
    """What the game will get: triangles, joints, clips (duration from the time accessors), extras."""
    import struct
    b = open(path, 'rb').read()
    n = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + n])
    acc = j['accessors']
    tris = sum(acc[p['indices']]['count'] // 3 for m in j['meshes'] for p in m['primitives'])
    clips = {a['name']: round(max(acc[s['input']]['max'][0] for s in a['samplers']), 3) for a in j['animations']}
    extras = [nd['extras'] for nd in j['nodes'] if 'extras' in nd]
    tex = [i.get('mimeType') for i in j.get('images', [])]
    return dict(bytes=len(b), triangles=tris, joints=len(j['skins'][0]['joints']), clips=clips, extras=extras,
                images=tex, extensions=j.get('extensionsRequired'))


# ------------------------------------------------------------------ main

def raw_dir(argv):
    if '--raw' in argv:
        return argv[argv.index('--raw') + 1]
    return os.environ.get('FAUNA_RAW') or os.path.join(ROOT, 'art-src', 'glb', 'fauna')


def build(key, raw):
    reset()
    path = os.path.join(MARKS, key + '.json')
    over = json.load(open(path)) if os.path.exists(path) else {}
    print(f'== {key}')
    obj = import_raw(os.path.join(raw, key + '.glb'))
    obj.name = key
    decimate(obj, TRIS if SPECIES[key]['wings'] != 'shell' else TRIS - 900)  # shells add ~0.7-1.3k
    img = texture(obj)
    orient(obj, img, key, over)
    H = SPECIES[key]['height']
    J = landmarks(verts(obj), key, over)
    with open(os.path.join(WORK, key + '_landmarks.json'), 'w') as f:
        json.dump({k: ([round(c, 4) for c in v] if isinstance(v, Vector) else round(float(v), 4)) for k, v in J.items()}, f, indent=1)
    shell = add_shells(obj, J, H) if SPECIES[key]['wings'] == 'shell' else np.zeros(len(obj.data.vertices), int)
    rig = build_armature(key, J, H)
    W = skin_weights(obj, J, key, shell)
    obj.parent = rig
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    obj.data.calc_loop_triangles()
    print(f'  final: {len(obj.data.loop_triangles)} triangles, {len(obj.data.vertices)} vertices, {len(DEFORM) + 1} bones')
    return Rig(key, rig, obj, J, W)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    raw = raw_dir(argv)
    skip = {raw} if '--raw' in argv else set()
    keys = [a for a in argv if not a.startswith('--') and a not in skip] or KEYS
    os.makedirs(WORK, exist_ok=True)
    report = {}
    for key in keys:
        C = build(key, raw)
        if '--check' in argv:
            print('  check sheet:', check_sheet(C, key))
            continue
        info = make_clips(C)
        print('  clips:', json.dumps(info))
        if '--preview' in argv:
            preview(C, key)
            print('  preview:', os.path.join(WORK, 'preview', key + '.png'))
        path = export(key, C.obj, C.body)
        report[key] = dict(clips=info, glb=os.path.getsize(path))
        if '--nopack' not in argv:
            dst = pack(key)
            report[key]['packed'] = inspect(dst)
            print(f'  packed: {dst}', json.dumps(report[key]['packed']))
    with open(os.path.join(WORK, 'report.json'), 'w') as f:
        json.dump(report, f, indent=1)


if __name__ == '__main__':
    main()
