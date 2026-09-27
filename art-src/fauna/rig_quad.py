"""Quadruped fauna (fennec, arctic_fox, cat, hedgehog): raw Hunyuan3D GLB -> rigged, animated game GLB.

  art-src/glb/fauna/<key>.glb -> art-src/fauna/out/<key>.glb -> public/assets/models/fauna/<key>.glb

The contract (orientation, size, clip names) is art-src/fauna/README.md. Steps:
  1. import, weld, drop floaters, decimate to the triangle budget, 512 px texture;
     turn to face -Y (PCA of the lower body + mirror symmetry), feet on z = 0, contract height
  2. landmarks guessed from the mesh (feet clusters, belly, back, ear gap, head, tail),
     overridden by landmarks/<key>.json; quadruped armature from them
  3. skin weights computed here (regions + distance to bones + smoothing), not Blender's heat
  4. clips (clips_quad.py), ground speeds in the armature extras
  5. export, then gltf-transform (resample, webp, meshopt) -> public/assets/models/fauna/

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P art-src/fauna/rig_quad.py --
         [keys] [--preview] [--check] [--raw DIR] [--no-export]
  --check    work/check/<key>.png: views of the mesh, the bones and the weights (no clips)
  --preview  work/preview/<key>.png: frames of every clip, side and 3/4-top
"""
import json
import math
import os
import subprocess
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clips_quad as clips  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(ROOT, 'art-src', 'glb', 'fauna')
WORK = os.path.join(HERE, 'work')
OUT = os.path.join(HERE, 'out')
GAME = os.path.join(ROOT, 'public', 'assets', 'models', 'fauna')
MARKS = os.path.join(HERE, 'landmarks')
KEYS = ['fennec', 'arctic_fox', 'cat', 'hedgehog']
HEIGHT = {'fennec': 0.55, 'arctic_fox': 0.55, 'cat': 0.5, 'hedgehog': 0.3}
TRIS = 5800  # contract: at most ~6k
TEX = 512

LEGS = {  # leg -> (upper, lower, paw) bones, parent body bone
    'FL': ('FrontUpperL', 'FrontLowerL', 'FrontPawL'), 'FR': ('FrontUpperR', 'FrontLowerR', 'FrontPawR'),
    'BL': ('BackUpperL', 'BackLowerL', 'BackPawL'), 'BR': ('BackUpperR', 'BackLowerR', 'BackPawR'),
}
# bone -> (parent, joint at its tail); a bone's head is the joint of its own name
BONES = {
    'Hips': (None, 'Spine1'), 'Spine1': ('Hips', 'Spine2'), 'Spine2': ('Spine1', 'Chest'),
    'Chest': ('Spine2', 'Neck'), 'Neck': ('Chest', 'Head'), 'Head': ('Neck', 'HeadEnd'),
    'EarL': ('Head', 'EarLEnd'), 'EarR': ('Head', 'EarREnd'),
    'Tail1': ('Hips', 'Tail2'), 'Tail2': ('Tail1', 'Tail3'), 'Tail3': ('Tail2', 'TailEnd'),
}
for _leg, (_u, _l, _p) in LEGS.items():
    _par = 'Chest' if _leg[0] == 'F' else 'Hips'
    BONES.update({_u: (_par, _l), _l: (_u, _p), _p: (_l, _p.replace('Paw', 'Toe'))})
BODY = ['Hips', 'Spine1', 'Spine2', 'Chest', 'Neck']


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def verts(me):
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


# ------------------------------------------------------------------ 1. mesh

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = clips.FPS


def import_raw(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for k in list(obj.keys()):
        del obj[k]
    return obj


def clean(obj):
    """Weld the UV-seam duplicates (else the skin tears along the seams) and drop the floaters."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    size = max(obj.dimensions)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5 * size)
    bm.verts.ensure_lookup_table()
    comp, sizes = [-1] * len(bm.verts), []
    for v0 in bm.verts:
        if comp[v0.index] >= 0:
            continue
        c, stack, n = len(sizes), [v0], 0
        comp[v0.index] = c
        while stack:
            v = stack.pop()
            n += 1
            for e in v.link_edges:
                w = e.other_vert(v)
                if comp[w.index] < 0:
                    comp[w.index] = c
                    stack.append(w)
        sizes.append(n)
    big = max(sizes)
    drop = [v for v in bm.verts if sizes[comp[v.index]] < 0.005 * big]
    bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    return len(sizes), len(drop)


def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def decimate(obj, budget):
    tris = tri_count(obj.data)
    if tris > budget:
        m = obj.modifiers.new('dec', 'DECIMATE')
        m.ratio = budget / tris * 0.99
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)
    me = obj.data
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    try:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except RuntimeError:
        pass
    return tris, tri_count(me)


def textures(obj):
    """Base colour only, 512 px (the game file budget); matte like the figurines."""
    for mat in obj.data.materials:
        nt = mat and mat.node_tree
        if not nt:
            continue
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        base = [l.from_node for l in nt.links if l.to_socket == bsdf.inputs['Base Color']]
        for n in list(nt.nodes):
            if n.type == 'TEX_IMAGE' and n not in base:
                nt.nodes.remove(n)
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.8
        for n in base:
            img = getattr(n, 'image', None)
            if img and max(img.size) > TEX:
                img.scale(TEX, TEX)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def symmetry_yaw(co, H):
    """Yaw correction that best mirrors the lower body about x = 0 (animals are left-right symmetric;
    the head may be turned in the reference art, so it is left out)."""
    sel = co[co[:, 2] < co[:, 2].min() + 0.5 * H]
    sel = sel[np.random.default_rng(1).choice(len(sel), min(1500, len(sel)), replace=False)]
    best = (1e9, 0.0)
    for deg in np.arange(-20, 20.5, 1.0):
        p = sel @ rot_z(math.radians(deg)).T
        p[:, 0] -= p[:, 0].mean()
        m = p * np.array([-1, 1, 1])
        d = np.sqrt(((p[:, None, :] - m[None, :, :]) ** 2).sum(-1).min(1)).mean()
        best = min(best, (d, deg))
    return best[1]


def orient(obj, key, over):
    """Face -Y, feet on z = 0, contract height, centred under the body."""
    me = obj.data
    co = verts(me)
    zmin, H0 = co[:, 2].min(), np.ptp(co[:, 2])
    lo = co[co[:, 2] < zmin + 0.55 * H0]
    c = lo[:, :2].mean(0)
    _, vec = np.linalg.eigh((lo[:, :2] - c).T @ (lo[:, :2] - c))
    a = vec[:, 1]  # body axis: the long axis of the lower body's footprint
    top = co[co[:, 2] > zmin + 0.7 * H0][:, :2].mean(0)
    geo = float((top - c) @ a)  # the head (and ears) stand at the high end
    prior = float(a @ np.array([-1.0, -1.0]))  # reference art: head toward the viewer's left / front
    s = np.sign(geo) if abs(geo) > 0.04 * H0 else np.sign(prior)
    if over.get('flip'):
        s = -s
    h = s * a
    yaw = -math.pi / 2 - math.atan2(h[1], h[0])
    p = (co - np.array([c[0], c[1], 0])) @ rot_z(yaw).T
    fix = symmetry_yaw(p, H0)
    yaw += math.radians(fix + over.get('yaw', 0.0))
    print(f'{key}: axis {a.round(3)}, head end by height {geo:+.3f}, by reference view {prior:+.3f}, '
          f'symmetry {fix:+.0f} deg, yaw {math.degrees(yaw):.0f} deg')
    p = (co - np.array([c[0], c[1], 0])) @ rot_z(yaw).T
    k = HEIGHT[key] / np.ptp(p[:, 2])
    p *= k
    p[:, 2] -= p[:, 2].min()
    H = HEIGHT[key]
    body = p[p[:, 2] < 0.5 * H]
    feet = p[p[:, 2] < 0.04 * H]
    p[:, 0] -= body[:, 0].mean()
    p[:, 1] -= (feet[:, 1].min() + feet[:, 1].max()) / 2
    me.vertices.foreach_set('co', p.ravel())
    me.update()
    return H


# ------------------------------------------------------------------ 2. landmarks

def slice_centre(co, z, xy, r, dz):
    m = (np.abs(co[:, 2] - z) < dz) & (np.hypot(co[:, 0] - xy[0], co[:, 1] - xy[1]) < r)
    return co[m].mean(0) if m.sum() >= 3 else None, co[m]


def auto_marks(co, H):
    """Joints guessed from the mesh (facing -Y, feet on z = 0)."""
    x, y, z = co.T
    J, info = {}, {}
    # paws: the lowest band, split front / back (2-means on y) and left / right
    feet = co[(z < 0.035 * H) & (np.abs(x) > 0.015 * H)]
    fy = feet[:, 1]
    c0, c1 = fy.min(), fy.max()
    for _ in range(30):
        m = np.abs(fy - c0) < np.abs(fy - c1)
        c0, c1 = fy[m].mean(), fy[~m].mean()
    paws = {}
    for end, pts in (('F', feet[m]), ('B', feet[~m])):
        for s, sg in (('L', 1), ('R', -1)):
            q = pts[pts[:, 0] * sg > 0]
            paws[end + s] = q
    yF = np.mean([np.median(paws[k][:, 1]) for k in ('FL', 'FR')])
    yB = np.mean([np.median(paws[k][:, 1]) for k in ('BL', 'BR')])
    span = yB - yF
    half = np.mean([abs(np.median(paws[k][:, 0])) for k in paws])
    mid = (np.abs(y - (yF + yB) / 2) < 0.2 * span) & (np.abs(x) < 0.5 * half)
    belly = float(z[mid].min()) if mid.sum() else 0.35 * H
    top = float(z[mid].max()) if mid.sum() else 0.6 * H
    info.update(yF=yF, yB=yB, belly=belly, top=top, half=half)
    zs = belly + 0.5 * (top - belly)  # spine height
    J['Hips'] = Vector((0, yB, zs))
    J['Chest'] = Vector((0, yF, zs))
    J['Spine1'] = J['Hips'].lerp(J['Chest'], 1 / 3)
    J['Spine2'] = J['Hips'].lerp(J['Chest'], 2 / 3)
    # legs: slice centres of each leg column
    r = 0.9 * min(half, span / 2)
    info['leg_radius'] = {}
    for leg, (up, lo, paw) in LEGS.items():
        q = paws[leg]
        pc = np.median(q[:, :2], 0)
        zk, zw = 0.5 * belly, max(0.06 * H, 0.22 * belly)
        cols = {}
        for name, zz in (('top', belly - 0.02 * H), ('knee', zk), ('wrist', zw)):
            cen, _ = slice_centre(co, zz, pc, r, 0.012 * H)
            cols[name] = cen if cen is not None else np.array([pc[0], pc[1], zz])
        _, kp = slice_centre(co, zk, cols['knee'][:2], r, 0.012 * H)
        rad = float(np.percentile(np.hypot(kp[:, 0] - cols['knee'][0], kp[:, 1] - cols['knee'][1]), 85)) if len(kp) > 5 else 0.05 * H
        info['leg_radius'][leg] = rad
        bend = (0.08 if leg[0] == 'F' else -0.08) * belly  # elbows behind, knees ahead: the IK bend side
        J[up] = Vector((cols['top'][0], cols['top'][1], belly + 0.35 * (top - belly)))
        J[lo] = Vector((cols['knee'][0], cols['knee'][1] + bend, zk))
        J[paw] = Vector((cols['wrist'][0], cols['wrist'][1], zw))
        J[paw.replace('Paw', 'Toe')] = Vector((pc[0], q[:, 1].min() + 0.2 * rad, 0.02 * H))
    # ears: from the top down, the slices of the front half stay split in two (no vertex near x = 0)
    front = co[y < (yF + yB) / 2]
    zmax = front[:, 2].max()
    ear_base = None
    for zz in np.arange(zmax, 0.4 * H, -0.004 * H):
        sl = front[np.abs(front[:, 2] - zz) < 0.005 * H]
        if len(sl) >= 5 and (np.abs(sl[:, 0]) < 0.03 * H).sum() >= 3:
            ear_base = float(zz)
            break
    info['ear_base'] = ear_base
    ears = ear_base is not None and zmax - ear_base > 0.05 * H
    # head: what rises above the back in the front half, else what sticks out ahead of the front paws
    cap = ear_base if ears else zmax + 1
    hv = co[(y < (yF + yB) / 2) & (z > top) & (z < cap)]
    if len(hv) < 50:
        hv = co[(y < yF - 0.03 * H) & (z > belly) & (z < cap)]
    hx = float(np.ptp(hv[:, 0])) / 2
    hc = Vector((0, float((hv[:, 1].min() + hv[:, 1].max()) / 2), float(min(hv[:, 2].max(), cap) - hx)))
    J['Neck'] = Vector((0, yF, zs + 0.5 * (top - zs)))
    to_neck = (J['Neck'] - hc)
    J['Head'] = hc + to_neck.normalized() * min(0.6 * hx, 0.8 * to_neck.length)
    J['HeadEnd'] = hc + Vector((0, -hx, 0))
    info['head'] = (hc, hx)
    if ears:
        for s, sg in (('L', 1), ('R', -1)):
            q = front[(front[:, 2] > ear_base) & (front[:, 0] * sg > 0)]
            tip = q[q[:, 2] > q[:, 2].max() - 0.03 * H].mean(0)
            base = q[q[:, 2] < ear_base + 0.03 * H].mean(0)
            J['Ear' + s] = Vector((base[0], base[1], ear_base - 0.01 * H))
            J['Ear' + s + 'End'] = Vector(tip)
    # tail: behind the rump, where the section shrinks; then bands of distance from its root
    back = co[(y > yB) & (z > 0.6 * belly)]
    ext = []
    for yy in np.arange(yB, y.max(), 0.01 * H):
        sl = back[np.abs(back[:, 1] - yy) < 0.006 * H]
        ext.append((yy, np.ptp(sl[:, 2]) if len(sl) > 3 else 0.0, sl))
    root = None
    e0 = ext[0][1] if ext else 0
    for yy, e, sl in ext:
        if yy > yB + 0.2 * H:
            break
        if e < 0.55 * e0 and len(sl):
            root = Vector((0, float(yy), float(sl[:, 2].mean())))
            break
    if root is None:  # a bushy tail as thick as the rump: root just behind the hind legs
        root = Vector((0, yB + 0.09 * H, zs + 0.3 * (top - zs)))
    if root is not None:
        tv = co[(y > root.y - 0.005 * H) & (z > 0.5 * belly)]
        d = np.linalg.norm(tv - np.array(root), axis=1)
        dmax = float(np.percentile(d, 99))
        if dmax > 0.08 * H:
            J['Tail1'] = root
            for i, q in ((2, 1 / 3), (3, 2 / 3)):
                J[f'Tail{i}'] = Vector(tv[np.abs(d - q * dmax) < 0.07 * dmax].mean(0))
            J['TailEnd'] = Vector(tv[d > 0.93 * dmax].mean(0))
    return J, info


def load_marks(key, co, H):
    """Automatic joints overlaid with landmarks/<key>.json:
      joints      {"Head": [x, y, z], "Neck": {"z": 0.3}, ...}  Blender coords, metres (after orient)
      drop        ["EarL", "EarR", "Tail1", ...]  bones this species goes without (ears, tail)
      leg_radius  {"FL": r, ...}  radius of the leg region for the weights
      belly       height of the belly (the legs blend into the body above it)
      flip / yaw  heading fixes for orient (reverse, extra degrees)
      poses       clip parameters (clips_quad.DEFAULTS)
    The resolved set goes to work/<key>_landmarks.json."""
    J, info = auto_marks(co, H)
    over = read_over(key)
    for name, v in over.get('joints', {}).items():
        if isinstance(v, dict):
            J.setdefault(name, Vector((0, 0, 0)))
            for ax, val in v.items():
                setattr(J[name], ax, val)
        else:
            J[name] = Vector(v)
    for name in over.get('drop', []):
        J.pop(name, None)
    info['leg_radius'].update(over.get('leg_radius', {}))
    if 'belly' in over:
        info['belly'] = over['belly']
    info['poses'] = over.get('poses', {})
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, key + '_landmarks.json'), 'w') as f:
        json.dump({'joints': {k: [round(c, 4) for c in v] for k, v in J.items()},
                   'leg_radius': {k: round(v, 4) for k, v in info['leg_radius'].items()},
                   'belly': round(info['belly'], 4), 'ear_base': info['ear_base']}, f, indent=1)
    return J, info


def read_over(key):
    path = os.path.join(MARKS, key + '.json')
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


# ------------------------------------------------------------------ armature

def build_armature(key, J):
    arm = bpy.data.armatures.new(key + '_rig')
    obj = bpy.data.objects.new(key + '_rig', arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, (parent, tail) in BONES.items():
        if name not in J or tail not in J or (parent and parent not in eb):
            continue
        b = arm.edit_bones.new(name)
        b.head, b.tail = J[name], J[tail]
        if (b.tail - b.head).length < 1e-4:
            b.tail = b.head + Vector((0, 0, 0.01))
        b.roll = 0
        if parent:
            b.parent = eb[parent]
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.display_type = 'STICK'
    return obj


# ------------------------------------------------------------------ 3. weights

def seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def inv_dist(P, segs, power):
    d = np.stack([seg_dist(P, a, b) for a, b in segs], 1) + 1e-4
    w = d ** -power
    return w / w.sum(1, keepdims=True)


def skin(body, rig, J, info, H, passes=3):
    """Regions (legs, ears, head, tail, body) blended by smoothsteps, distance to the bones inside a
    region, a few smoothing passes along the surface. Heat weights break on these generated meshes."""
    me = body.data
    P = verts(me)
    names = [b.name for b in rig.data.bones]
    ix = {n: i for i, n in enumerate(names)}
    seg = {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in rig.data.bones}
    W = np.zeros((len(P), len(names)))

    def put(cols, w, mask_w):
        """W <- (1 - m) W + m w, over the bones cols."""
        full = np.zeros_like(W)
        full[:, [ix[c] for c in cols]] = w
        W[:] = W * (1 - mask_w[:, None]) + full * mask_w[:, None]

    put(BODY, inv_dist(P, [seg[n] for n in BODY], 4), np.ones(len(P)))
    if 'Tail1' in ix:
        tb = [n for n in ('Tail1', 'Tail2', 'Tail3') if n in ix]
        a, b = np.array(J['Tail1']), np.array(J['Tail2'])
        n = (b - a) / np.linalg.norm(b - a)
        near = np.min(np.stack([seg_dist(P, *seg[t]) for t in tb], 1), 1)
        m = smoothstep(-0.01 * H, 0.025 * H, (P - a) @ n) * (near < 0.25 * H)
        put(tb, inv_dist(P, [seg[t] for t in tb], 4), m)
    a, c = np.array(J['Head']), np.array(J['Neck'])
    n = (a - c) / np.linalg.norm(a - c)
    m = smoothstep(-0.02 * H, 0.02 * H, (P - a) @ n)
    put(['Head'], np.ones((len(P), 1)), m)
    eb = info['ear_base']
    for s, sg in (('L', 1), ('R', -1)):
        if 'Ear' + s in ix:
            m = smoothstep(eb - 0.015 * H, eb + 0.03 * H, P[:, 2]) * (P[:, 0] * sg > 0) * (P[:, 1] < (info['yF'] + info['yB']) / 2)
            put(['Ear' + s], np.ones((len(P), 1)), m)
    belly = info['belly']
    for leg, bones in LEGS.items():
        up, lo, paw = bones
        par = 'Chest' if leg[0] == 'F' else 'Hips'
        axis = [(np.array(J[up]), np.array(J[lo])), (np.array(J[lo]), np.array(J[paw]))]
        r = info['leg_radius'][leg]
        # distance to the leg's vertical axis, ignoring z: legs are columns
        d = np.min(np.stack([seg_dist(P * [1, 1, 0], a * [1, 1, 0], b * [1, 1, 0]) for a, b in axis], 1), 1)
        side = np.sign(J[up].x)
        inside = (d < 1.35 * r) & (P[:, 0] * side > 0) & (P[:, 2] < J[up].z + 0.03 * H)
        body_share = smoothstep(belly - 0.03 * H, J[up].z + 0.02 * H, P[:, 2])
        wl = inv_dist(P, [seg[b] for b in bones], 5) * (1 - body_share)[:, None]
        w = np.concatenate([wl, body_share[:, None]], 1)
        put(list(bones) + [par], w, inside.astype(float))
    # smoothing along the surface: soft joints, no seams between regions
    E = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', E)
    E = E.reshape(-1, 2)
    deg = np.bincount(E.ravel(), minlength=len(P))[:, None].clip(1)
    for _ in range(passes):
        acc = np.zeros_like(W)
        np.add.at(acc, E[:, 0], W[E[:, 1]])
        np.add.at(acc, E[:, 1], W[E[:, 0]])
        W = 0.5 * W + 0.5 * acc / deg
    # four influences at most (glTF), renormalised
    order = np.argsort(-W, 1)
    W[np.arange(len(P))[:, None], order[:, 4:]] = 0
    W[W < 0.01] = 0
    W /= W.sum(1, keepdims=True)
    groups = {n: body.vertex_groups.new(name=n) for n in names}
    for i in range(len(P)):
        for j in np.nonzero(W[i])[0]:
            groups[names[j]].add([i], float(W[i, j]), 'REPLACE')
    return W, names


# ------------------------------------------------------------------ check renders

PALETTE = [(0.9, 0.2, 0.2), (0.2, 0.7, 0.2), (0.2, 0.3, 0.95), (0.95, 0.8, 0.1), (0.8, 0.2, 0.9),
           (0.1, 0.85, 0.85), (1.0, 0.5, 0.1), (0.5, 0.3, 0.1), (0.6, 0.6, 0.6), (0.2, 0.5, 0.4),
           (0.95, 0.5, 0.7), (0.4, 0.9, 0.4)]


def weight_colours(body, W, names):
    cols = np.array([PALETTE[i % len(PALETTE)] for i in range(len(names))])
    rgb = W @ cols
    me = body.data
    attr = me.color_attributes.new('weights', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.concatenate([rgb, np.ones((len(rgb), 1))], 1).ravel())
    me.color_attributes.active_color = attr


def bone_sticks(rig, H):
    """Thin pyramids along the bones: the workbench does not draw armatures."""
    bm = bmesh.new()
    for b in rig.data.bones:
        h, t = b.head_local, b.tail_local
        ax = (t - h)
        if ax.length < 1e-6:
            continue
        r = max(0.006 * H, 0.08 * ax.length)
        u = ax.orthogonal().normalized() * r
        v = ax.normalized().cross(u)
        base = h + ax * 0.15
        vs = [bm.verts.new(h), bm.verts.new(t)] + [bm.verts.new(base + q) for q in (u, v, -u, -v)]
        for i in range(4):
            a, c = vs[2 + i], vs[2 + (i + 1) % 4]
            bm.faces.new((vs[0], a, c))
            bm.faces.new((vs[1], c, a))
    me = bpy.data.meshes.new('sticks')
    bm.to_mesh(me)
    bm.free()
    attr = me.color_attributes.new('weights', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', [0.02, 0.02, 0.02, 1.0] * len(me.vertices))
    obj = bpy.data.objects.new('sticks', me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def scene_setup(H, extent):
    """Workbench, a ground, two ortho cameras (side, 3/4 from above like the game)."""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_shadows = True
    sh.shadow_intensity = 0.35
    sh.show_cavity = False
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.8, 0.82, 0.85)
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.mesh.primitive_plane_add(size=extent * 12, location=(0, 0, 0))
    ground = bpy.context.active_object
    mat = bpy.data.materials.new('ground')
    mat.diffuse_color = (0.55, 0.6, 0.5, 1)
    ground.data.materials.append(mat)
    cams = {}
    y0 = 0.0
    for name, direction in (('side', (1, 0, 0.12)), ('top', (-0.55, -0.6, 1.25)), ('front', (0, -1, 0.1)),
                            ('above', (0, 0.001, 1))):
        cd = bpy.data.cameras.new(name)
        cd.type = 'ORTHO'
        cd.ortho_scale = extent * 1.25
        cam = bpy.data.objects.new(name, cd)
        sc.collection.objects.link(cam)
        tgt = Vector((0, y0, 0.42 * H))
        cam.location = tgt + Vector(direction).normalized() * 5
        cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cams[name] = cam
    return cams


def label(cam, text, extent):
    cu = bpy.data.curves.new('label', 'FONT')
    cu.body = text
    cu.size = extent * 0.08
    obj = bpy.data.objects.new('label', cu)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new('ink')
    mat.diffuse_color = (0.05, 0.05, 0.05, 1)
    cu.materials.append(mat)
    obj.parent = cam
    obj.location = (-extent * 0.6, extent * 0.52, -1)
    return obj


def render_tile(cam, path, size):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def tile_sheet(rows, out):
    """rows: lists of PNG paths -> one PNG (numpy, no external tool)."""
    imgs = [[bpy.data.images.load(p) for p in r] for r in rows]
    w, h = imgs[0][0].size
    cols = max(len(r) for r in rows)
    sheet = np.ones((h * len(rows), w * cols, 4), dtype=np.float32)
    for i, r in enumerate(imgs):
        for j, im in enumerate(r):
            a = np.empty(w * h * 4, dtype=np.float32)
            im.pixels.foreach_get(a)
            sheet[i * h:(i + 1) * h, j * w:(j + 1) * w] = a.reshape(h, w, 4)[::-1]
            bpy.data.images.remove(im)
    H_, W_ = sheet.shape[:2]
    img = bpy.data.images.new('sheet', W_, H_, alpha=True)
    img.pixels.foreach_set(sheet[::-1].ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return out


def extent_of(body, H):
    co = verts(body.data)
    return max(H, float(np.ptp(co[:, 1])), float(np.ptp(co[:, 0])))


def check_sheet(key, rig, body, W, names, H):
    """Row 1: textured views. Row 2: bones over the weights (x-ray)."""
    out = os.path.join(WORK, 'check')
    os.makedirs(out, exist_ok=True)
    ext = extent_of(body, H)
    cams = scene_setup(H, ext)
    weight_colours(body, W, names)
    sticks = bone_sticks(rig, H)
    sh = bpy.context.scene.display.shading
    rows = []
    for mode, xray in (('TEXTURE', False), ('VERTEX', False), ('VERTEX', True)):
        sh.color_type = mode
        sh.show_xray = xray
        sh.xray_alpha = 0.3
        sticks.hide_render = not xray
        row = []
        for name in ('side', 'front', 'above', 'top'):
            p = os.path.join(out, f'{key}_{mode}{int(xray)}_{name}.png')
            render_tile(cams[name], p, 420)
            row.append(p)
        rows.append(row)
    sh.show_xray = False
    bpy.data.objects.remove(sticks)
    for c in cams.values():
        bpy.data.objects.remove(c)
    return tile_sheet(rows, os.path.join(out, key + '.png'))


def preview_sheet(key, rig, body, H, frames=6, size=200):
    """Every clip, `frames` frames across; one row side view, one row 3/4-top view."""
    out = os.path.join(WORK, 'preview')
    tmp = os.path.join(out, 'frames')
    os.makedirs(tmp, exist_ok=True)
    ext = extent_of(body, H)
    cams = scene_setup(H, ext)
    sc = bpy.context.scene
    sc.display.shading.color_type = 'TEXTURE'
    rows = []
    for name, _fn, _dur, loop in clips.CLIPS:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        rig.animation_data.action = act
        n = int(act.frame_range[1])
        fs = [round(i * n / (frames if loop else frames - 1)) for i in range(frames)]
        for view in ('side', 'top'):
            lab = label(cams[view], name, ext)
            row = []
            for i, f in enumerate(fs):
                sc.frame_set(f)
                lab.data.body = f'{name} {f}/{n}' if i == 0 else f'{f}'
                p = os.path.join(tmp, f'{key}_{name}_{view}_{i}.png')
                render_tile(cams[view], p, size)
                row.append(p)
            bpy.data.objects.remove(lab)
            rows.append(row)
    rig.animation_data.action = None
    sc.frame_set(0)
    for c in cams.values():
        bpy.data.objects.remove(c)
    return tile_sheet(rows, os.path.join(out, key + '.png'))


# ------------------------------------------------------------------ 5. export, pack

def export(key, rig, body):
    os.makedirs(OUT, exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o in (rig, body))
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_skins=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_optimize_animation_size=True, export_def_bones=False, export_image_format='AUTO',
        export_normals=True, export_apply=False, export_reset_pose_bones=True, export_extras=True,
        export_attributes=False)
    return path


def pack(key):
    """Deduplicated keys, webp texture, meshopt geometry (same tools as art-src/rig/pack.mjs)."""
    os.makedirs(GAME, exist_ok=True)
    src, dst = os.path.join(OUT, key + '.glb'), os.path.join(GAME, key + '.glb')
    t1, t2 = os.path.join(OUT, key + '.t1.glb'), os.path.join(OUT, key + '.t2.glb')
    npx = 'npx.cmd' if os.name == 'nt' else 'npx'
    cli = lambda *a: subprocess.run([npx, '--yes', '@gltf-transform/cli@4', *a], check=True, cwd=ROOT,
                                    stdout=subprocess.DEVNULL)
    cli('resample', src, t1, '--tolerance', '0.0005')
    cli('webp', t1, t2, '--quality', '88')
    cli('meshopt', t2, dst, '--level', 'medium')
    os.remove(t1)
    os.remove(t2)
    print(key, 'packed', os.path.getsize(src), '->', os.path.getsize(dst), 'bytes')


# ------------------------------------------------------------------ main

def build(key, raw):
    reset()
    over = read_over(key)
    body = import_raw(os.path.join(raw, key + '.glb'))
    body.name = key
    body.data.name = key
    islands, dropped = clean(body)
    before, after = decimate(body, TRIS)
    textures(body)
    H = orient(body, key, over)
    print(f'{key}: {islands} islands ({dropped} floater vertices dropped), {before} -> {after} triangles')
    co = verts(body.data)
    J, info = load_marks(key, co, H)
    rig = build_armature(key, J)
    W, names = skin(body, rig, J, info, H)
    body.parent = rig
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    print(f'{key}: {len(names)} bones: {" ".join(names)}')
    return body, rig, J, info, H, W, names


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    raw = argv[argv.index('--raw') + 1] if '--raw' in argv else RAW
    skip = {raw}
    keys = [a for a in argv if not a.startswith('--') and a not in skip] or KEYS
    for key in keys:
        body, rig, J, info, H, W, names = build(key, raw)
        if '--check' in argv:
            print(key, 'check sheet:', check_sheet(key, rig, body, W, names, H))
            continue
        made, speed = clips.make_all(rig, J, info, H)
        rig['speed'] = speed
        print(key, 'clips:', ', '.join(f'{n} {d:.2f}s' for n, d in made), '| speed', speed)
        if '--preview' in argv:
            print(key, 'preview:', preview_sheet(key, rig, body, H))
        if '--no-export' not in argv:
            print(key, 'exported:', export(key, rig, body))
            pack(key)


if __name__ == '__main__':
    main()
