"""Hopper fauna (frog, hare, squirrel): raw Hunyuan GLB -> rigged, animated game GLB.

  art-src/glb/fauna/<key>.glb -> art-src/fauna/out/<key>.glb -> public/assets/models/fauna/<key>.glb

Contract: art-src/fauna/README.md (faces -Y in Blender / +Z glTF, feet on 0, real size, clips
Idle, Hop, Look, Groom, Ears | Croak). Joints are fractions of the height in the normalised frame
(x left, -y forward, z up), defaults in SPECIES, overridden by art-src/fauna/landmarks/<key>.json:
  {"yaw": deg, "joints": {"knee_L": [x, y, z], ...}, "radius": {"thigh": 0.1, ...}, "hop": {...}}
Left-side joints end in _L; the right side is mirrored unless given.

Poses are rotations in the armature's rest axes (+X = the animal's left, so +X turns pitch the
nose / toes down), composed down the chain; the legs are placed by an analytic IK so planted feet
stay planted while the game slides the animal at the Hop speed.

Usage: blender -b -P art-src/fauna/rig_hopper.py -- [keys] [--preview] [--check] [--src DIR] [--nopack]
"""
import json
import math
import os
import subprocess
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
WORK, OUT = os.path.join(HERE, 'work'), os.path.join(HERE, 'out')
GAME = os.path.join(ROOT, 'public', 'assets', 'models', 'fauna')
SRC = os.path.join(ROOT, 'art-src', 'glb', 'fauna')
FPS = 30
TRIS = 5600
I = Quaternion()
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

# ------------------------------------------------------------------ species

# joints (fractions of the height): hip = pelvis head, spine, chest, neck, head -> crown; legs
# shoulder/elbow/wrist/fingers and thigh/knee/hock/toe; ears ear -> ear_tip; tail0..n -> tail_end.
SPECIES = {
    'frog': dict(height=0.3, yaw=None, ears=False, throat=True, tail=0, extra='Croak', groom='wipe', groom_sit=0.3,
                 hop=dict(length=0.32, dur=0.62, lift=0.5, pitch=38, trail=1.2),
                 joints={}),
    'hare': dict(height=0.5, yaw=None, ears=True, throat=False, tail=1, extra='Ears',
                 hop=dict(length=0.42, dur=0.52, lift=0.4, pitch=12, back=(0.93, 0.22), trail=0.5, tuck=0.3, peel=18, curl=0.5),
                 joints={}),
    'squirrel': dict(height=0.4, yaw=None, ears=True, throat=False, tail=3, extra='Ears', groom_sit=0.5,
                     groom_face=(0, -0.14, -0.07),
                     hop=dict(length=0.3, dur=0.44, lift=0.4, pitch=12, back=(0.93, 0.22), trail=0.5, tuck=0.3, peel=18, curl=0.5),
                     joints={}),
}

# bone -> (parent, head joint, tail joint); _L bones are mirrored to _R
BODY = [('root', None, 'origin', 'origin_up'), ('pelvis', 'root', 'hip', 'spine'),
        ('spine', 'pelvis', 'spine', 'chest'), ('chest', 'spine', 'chest', 'neck'),
        ('neck', 'chest', 'neck', 'head'), ('head', 'neck', 'head', 'crown')]
FRONT = [('upperarm', 'chest', 'shoulder', 'elbow'), ('forearm', 'upperarm', 'elbow', 'wrist'),
         ('hand', 'forearm', 'wrist', 'fingers')]
BACK = [('thigh', 'pelvis', 'thigh', 'knee'), ('shin', 'thigh', 'knee', 'hock'), ('foot', 'shin', 'hock', 'toe')]

# blend radius of each bone (fraction of the height): a vertex's weight falls with its distance
# to the bone divided by this, so thick bones (body) win over thin ones (legs) at the same distance
RADIUS = {'pelvis': 0.2, 'spine': 0.2, 'chest': 0.18, 'neck': 0.14, 'head': 0.2, 'ear': 0.05,
          'throat': 0.1, 'tail': 0.1, 'upperarm': 0.06, 'forearm': 0.05, 'hand': 0.04,
          'thigh': 0.1, 'shin': 0.06, 'foot': 0.045}


def bones_of(sp):
    out = list(BODY)
    for s in 'LR':
        for name, parent, h, t in FRONT + BACK:
            out.append((f'{name}_{s}', parent if parent in ('chest', 'pelvis') else f'{parent}_{s}', f'{h}_{s}', f'{t}_{s}'))
        if sp['ears']:
            out.append((f'ear_{s}', 'head', f'ear_{s}', f'ear_tip_{s}'))
    if sp['throat']:
        out.append(('throat', 'head', 'throat', 'throat_tip'))
    for i in range(sp['tail']):
        out.append((f'tail{i}', 'pelvis' if i == 0 else f'tail{i - 1}', f'tail{i}',
                    f'tail{i + 1}' if i + 1 < sp['tail'] else 'tail_end'))
    return out


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0))) if e1 != e0 else float(x >= e0)
    return t * t * (3 - 2 * t)


def load_spec(key):
    sp = json.loads(json.dumps(SPECIES[key]))
    path = os.path.join(HERE, 'landmarks', key + '.json')
    if os.path.exists(path):
        with open(path) as f:
            over = json.load(f)
        for k, v in over.items():
            if isinstance(v, dict) and isinstance(sp.get(k), dict):
                sp[k].update(v)
            else:
                sp[k] = v
    sp['radius'] = {**RADIUS, **sp.get('radius', {})}
    return sp


# ------------------------------------------------------------------ mesh

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def import_raw(key, src):
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, key + '.glb'))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in meshes:  # bake the importer's transforms and drop its empties
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix()
    for o in [o for o in bpy.data.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes):
            bpy.ops.object.join()
    body = meshes[0]
    body.name = body.data.name = key
    return body


def verts(me):
    a = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def auto_yaw(body):
    """Heading of a sitting animal, in degrees about +Z from -Y: the head (highest bulk, ears and
    tails trimmed) sits over the front paws, so the head band's centroid is forward of the ground
    footprint's. Only a first guess: SPECIES / landmarks 'yaw' wins, checked on the --check render."""
    v = verts(body.data)
    z0, z1 = v[:, 2].min(), v[:, 2].max()
    h = (v[:, 2] - z0) / (z1 - z0)
    foot = v[h < 0.12, :2].mean(0)
    head = v[(h > 0.55) & (h < 0.8), :2].mean(0)
    d = head - foot
    return math.degrees(math.atan2(d[0], -d[1]))  # angle of d from -Y, toward +X


def normalise(body, sp):
    """Turn to face -Y, feet on z = 0, centred under the body, scaled to the contract height."""
    me = body.data
    yaw = sp['yaw'] if sp.get('yaw') is not None else auto_yaw(body)
    sp['yaw_used'] = round(yaw, 1)
    me.transform(Matrix.Rotation(math.radians(-yaw), 4, 'Z'))
    v = verts(me)
    s = sp['height'] / (v[:, 2].max() - v[:, 2].min())
    low = v[(v[:, 2] - v[:, 2].min()) < 0.4 * (v[:, 2].max() - v[:, 2].min())]
    c = Vector(((low[:, 0].min() + low[:, 0].max()) / 2, (low[:, 1].min() + low[:, 1].max()) / 2, v[:, 2].min()))
    c += Vector(sp.get('centre', (0, 0, 0))) / s * sp['height']  # nudge, fraction of the height
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-c))
    me.update()


def clean(body):
    """Weld the UV-seam splits, drop floating crumbs, decimate to the budget, texture to 512 px."""
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    # connected parts: keep those with at least 2% of the biggest
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, part = [v], []
        seen.add(v.index)
        while stack:
            u = stack.pop()
            part.append(u)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        parts.append(part)
    big = max(len(p) for p in parts)
    bmesh.ops.delete(bm, geom=[v for p in parts if len(p) < 0.02 * big for v in p], context='VERTS')
    bm.to_mesh(me)
    bm.free()
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > TRIS:
        mod = body.modifiers.new('dec', 'DECIMATE')
        mod.ratio = TRIS / tris
        mod.use_collapse_triangulate = True
        with bpy.context.temp_override(object=body, active_object=body):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    for img in bpy.data.images:
        if img.size[0] > 512:
            img.scale(512, 512)
            img.pack()
    return sum(len(p.vertices) - 2 for p in me.polygons)


# ------------------------------------------------------------------ armature

def joints_of(sp):
    """Joint positions in metres (Blender frame) from the fractions; right side mirrored."""
    H = sp['height']
    J = {'origin': Vector((0, 0, 0)), 'origin_up': Vector((0, 0, 0.25 * H))}
    for k, v in sp['joints'].items():
        J[k] = Vector(v) * H
    for k in list(J):
        if k.endswith('_L') and k[:-2] + '_R' not in J:
            J[k[:-2] + '_R'] = Vector((-J[k].x, J[k].y, J[k].z))
    return J


def build_armature(key, sp, J):
    arm = bpy.data.armatures.new(key + '_rig')
    rig = bpy.data.objects.new(key + '_rig', arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, parent, h, t in bones_of(sp):
        b = arm.edit_bones.new(name)
        b.head, b.tail = J[h], J[t]
        # local X = the world side axis, so every bone pitches about X like the pose code expects
        y = (b.tail - b.head).normalized()
        b.align_roll(X.cross(y) if abs(y.x) < 0.9 else Z)
        if parent:
            b.parent = eb[parent]
        b.use_deform = name != 'root'
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.display_type = 'STICK'
    return rig


# ------------------------------------------------------------------ weights

def seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def island_labels(me, D):
    """Nearest bone (distance over radius) per vertex, then islands removed: a bone keeps only the
    connected patch of its vertices that holds its core (the vertices closest to it); stray
    patches (the back foot's toes that happen to lie nearer the front paw's bone) go to the bone
    of the surface around them."""
    n = len(me.vertices)
    ev = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get('vertices', ev)
    ev = ev.reshape(-1, 2).tolist()
    adj = [[] for _ in range(n)]
    for a, b in ev:
        adj[a].append(b)
        adj[b].append(a)
    label = D.argmin(1)
    for j in range(D.shape[1]):
        seen, patches = set(), []
        for v in np.nonzero(label == j)[0].tolist():
            if v in seen:
                continue
            stack, patch = [v], []
            seen.add(v)
            while stack:
                u = stack.pop()
                patch.append(u)
                for w in adj[u]:
                    if w not in seen and label[w] == j:
                        seen.add(w)
                        stack.append(w)
            patches.append(patch)
        if len(patches) > 1:  # keep the patch with the vertices nearest the bone
            keep = min(patches, key=lambda p: D[p, j].min())
            for p in patches:
                if p is not keep:
                    label[p] = -1
    while (label < 0).any():  # fill the holes from their labelled neighbours, ring by ring
        todo = np.nonzero(label < 0)[0].tolist()
        new = label.copy()
        for v in todo:
            ns = [label[w] for w in adj[v] if label[w] >= 0]
            if ns:
                new[v] = min(set(ns), key=lambda j: D[v, j])
        if (new == label).all():
            new[todo] = D[todo].argmin(1)
        label = new
    return label


def chain_of(name):
    base = name.split('_')[0].rstrip('0123456789')
    if base in ('upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'):
        return ('front' if base in ('upperarm', 'forearm', 'hand') else 'back') + name[-2:], base
    return ('tail' if base == 'tail' else 'body'), base


def cut_contacts(body, label, names, D):
    """Hunyuan fuses whatever touches: the front paw onto the back toes, the elbow onto the haunch.
    Each face goes with one part; the edges between faces of two limbs, or of a lower leg / paw
    and the body, are ripped open (vertices doubled), so the parts come apart without holes."""
    ch = [chain_of(n) for n in names]
    roots = ('upperarm', 'thigh')

    def bad(a, b):
        (ca, ba), (cb, bb) = ch[a], ch[b]
        if ca == cb:
            return False
        limbs = [x for x in ((ca, ba), (cb, bb)) if x[0] not in ('body', 'tail')]
        if len(limbs) == 2:
            return True  # two different limbs
        if not limbs:  # the tail against the back stays sewn on: a hole would show more than a stretch
            return False
        # a front paw / forearm against the chest (it rises to the face); back feet stay sewn to
        # the body: their gap would open while the body rocks over planted feet
        return limbs[0][1] in ('forearm', 'hand')

    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    flab = {}
    for f in bm.faces:  # a face goes with the part most of its corners belong to
        ls = [label[v.index] for v in f.verts]
        flab[f.index] = max(set(ls), key=lambda j: (ls.count(j), -D[[v.index for v in f.verts], j].mean()))
    rip = [e for e in bm.edges if len(e.link_faces) == 2 and bad(flab[e.link_faces[0].index], flab[e.link_faces[1].index])]
    if not rip:
        bm.free()
        return False
    bmesh.ops.split_edges(bm, edges=rip)
    bm.to_mesh(me)
    bm.free()
    me.update()
    print(f'  ripped {len(rip)} edges between touching parts')
    return True


def skin(body, rig, sp, J, cut=True):
    """Inverse distance to each bone (over its radius) to the 6th power: sharp inside a limb,
    blended at joints. Limbs and ears only on their own side, tail only behind the hips, the frog's
    throat as a soft sphere. Then smoothed over the surface."""
    H = sp['height']
    P = verts(body.data).astype(np.float64)
    names, W, D = [], [], []
    m = 0.025 * H
    for b in rig.data.bones:
        if not b.use_deform:
            continue
        base = b.name.split('_')[0].rstrip('0123456789')
        r = sp['radius'][base] * H
        h, tl = np.array(b.head_local), np.array(b.tail_local)
        if base in ('hand', 'foot'):  # the toes fan out past the joint at the toe
            tl = h + (tl - h) * 1.3
        d = seg_dist(P, h, tl) / r
        w = 1.0 / (d ** 6 + 1e-4)
        if b.name.endswith('_L'):
            w *= np.clip((P[:, 0] + m) / (2 * m), 0, 1)
        elif b.name.endswith('_R'):
            w *= np.clip((m - P[:, 0]) / (2 * m), 0, 1)
        if base == 'tail':
            y0 = J['tail0'].y
            w *= np.clip((P[:, 1] - y0 + m) / (2 * m), 0, 1)
        if base == 'ear':
            w *= np.clip((P[:, 2] - J[b.name].z + m) / m, 0, 1)  # nothing below the ear's base
        names.append(b.name)
        W.append(w)
        D.append(np.where(w > 0, d, np.inf))
    W, D = np.array(W).T, np.array(D).T
    # which bone each vertex belongs to, then only that bone and its parent / children weigh on
    # it. Sitting animals touch themselves everywhere (back toes beside the front paw, knee against
    # the elbow): straight-line distance glues them, the islands check keeps them apart
    label = island_labels(body.data, D)
    if os.environ.get('HOPPER_DEBUG'):
        sel = (P[:, 1] < -0.28 * H) & (P[:, 2] < 0.25 * H)
        print('  front-low labels', {names[j]: int(((label == j) & sel).sum()) for j in range(len(names)) if ((label == j) & sel).any()})
    if cut and cut_contacts(body, label, names, D):  # fused contacts torn apart: weigh the new mesh
        return skin(body, rig, sp, J, cut=False)
    near = {n: {n} for n in names}
    for b in rig.data.bones:
        if b.use_deform and b.parent and b.parent.use_deform:
            near[b.name].add(b.parent.name)
            near[b.parent.name].add(b.name)
    allow = np.array([[names[j] in near[names[label[i]]] for j in range(len(names))] for i in range(len(P))])
    W = np.where(allow, W, 0) + 1e-9 * (np.arange(len(names))[None, :] == label[:, None])
    if sp['throat']:  # a soft ball under the chin, inflated by scaling the throat bone
        c, rad = np.array(J['throat']), sp['radius']['throat'] * H
        k = np.clip(1 - np.linalg.norm(P - c, axis=1) / rad, 0, 1)
        k = k * k * (3 - 2 * k)
        i = names.index('throat')
        W[:, i] = 0
        W = W / W.sum(1, keepdims=True) * (1 - k[:, None])
        W[:, i] = k
    W = W / W.sum(1, keepdims=True)
    for j, n in enumerate(names):
        vg = body.vertex_groups.new(name=n)
        for x in np.unique(np.round(W[:, j], 3)):
            if x > 1e-3:
                vg.add(np.nonzero(np.round(W[:, j], 3) == x)[0].tolist(), float(x), 'REPLACE')
    for o in bpy.context.view_layer.objects:
        o.select_set(o == body)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=int(sp.get('smooth', 3)))
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    body.parent = rig
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


# ------------------------------------------------------------------ pose, FK, IK

def q(axis, deg):
    return Quaternion(axis, math.radians(deg))


def qe(x=0.0, y=0.0, z=0.0):
    """Pitch (+ = nose / toes down), roll about Y, yaw about Z (+ = toward the left)."""
    return q(Z, z) @ q(Y, y) @ q(X, x)


class Rig:
    def __init__(self, rig, sp):
        self.rig, self.sp, self.H = rig, sp, sp['height']
        B = rig.data.bones
        self.order = [b.name for b in B]  # parents come first
        self.parent = {b.name: b.parent.name if b.parent else None for b in B}
        self.head = {b.name: b.head_local.copy() for b in B}
        self.tail = {b.name: b.tail_local.copy() for b in B}
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in B}

    def fk(self, P):
        """World delta rotation (A) and posed head / tail of every bone (root scale left out)."""
        A, hd, tl = {}, {}, {}
        for n in self.order:
            p = self.parent[n]
            if p is None:
                A[n], hd[n] = P.q.get(n, I), self.head[n].copy()
            else:
                A[n] = A[p] @ P.q.get(n, I)
                hd[n] = hd[p] + A[p] @ (self.head[n] - self.head[p])
            if n == 'pelvis':
                hd[n] = hd[n] + P.loc
            tl[n] = hd[n] + A[n] @ (self.tail[n] - self.head[n])
        return A, hd, tl

    def limb(self, P, chain, target, end=None, pole=None, reach=0.999):
        """Two-bone IK: chain = (upper, lower, end bone); the lower bone's tail lands on target, in
        the plane of the rest bend (knee forward, elbow back); end bone's world rotation = end."""
        a_, b_, c_ = chain
        A, hd, _ = self.fk(P)
        Ap = A[self.parent[a_]]
        root = hd[a_]
        la = (self.head[b_] - self.head[a_]).length
        lb = (self.head[c_] - self.head[b_]).length
        d = target - root
        dist = min(max(d.length, abs(la - lb) + 1e-4), (la + lb) * reach)
        dn = d.normalized()
        # rest bend: direction of the knee off the hip-ankle line, and the normal of that plane
        mid, rr = self.head[b_] - self.head[a_], (self.head[c_] - self.head[a_]).normalized()
        off = mid - rr * mid.dot(rr)
        off = off.normalized() if off.length > 1e-4 * self.H else Vector((0, -1 if 'thigh' in a_ else 1, 0))
        n_rest = rr.cross(off).normalized()
        if pole is None:  # the rest bend, carried by the parent
            pole = Ap @ off
        side = dn.cross(pole)
        side = side.normalized() if side.length > 1e-6 else Ap @ n_rest
        up = side.cross(dn).normalized()
        x = (la * la - lb * lb + dist * dist) / (2 * dist)
        h = math.sqrt(max(la * la - x * x, 0))
        knee = root + dn * x + up * h
        tip = root + dn * dist

        def frame(d, n):  # rotation taking (d, n) as its (Y, X) axes: aligns bone and bend plane
            d = d.normalized()
            n = (n - d * n.dot(d)).normalized()
            return Matrix((n, d, n.cross(d))).transposed().to_quaternion()

        # whole-frame alignment (bone direction + bend plane), not the shortest arc: an arm
        # swinging from down to up (about 180 degrees) must not pick a random twist
        ra = mid.normalized()
        rb = (self.head[c_] - self.head[b_]).normalized()
        Aa = frame(knee - root, side) @ frame(Ap @ ra, Ap @ n_rest).inverted() @ Ap
        Ab = frame(tip - knee, side) @ frame(Aa @ rb, Aa @ n_rest).inverted() @ Aa
        P.q[a_] = Ap.inverted() @ Aa
        P.q[b_] = Aa.inverted() @ Ab
        if end is not None:
            P.q[c_] = Ab.inverted() @ end


class Pose:
    def __init__(self):
        self.q, self.loc, self.scale, self.rscale = {}, Vector(), {}, Vector((1, 1, 1))

    def rot(self, bone, quat):
        self.q[bone] = quat @ self.q.get(bone, I)


def track(keys, u, loop=True):
    """Catmull-Rom through (u, value) keys; periodic over [0, 1) when loop."""
    ks = sorted(keys)
    if loop:
        u %= 1.0
        ext = [(ks[-2][0] - 1, ks[-2][1]), (ks[-1][0] - 1, ks[-1][1])] + ks + [(ks[0][0] + 1, ks[0][1]), (ks[1][0] + 1, ks[1][1])]
    else:
        u = min(max(u, ks[0][0]), ks[-1][0])
        ext = [ks[0]] + ks + [ks[-1]]
    for i in range(1, len(ext) - 2):
        (u1, p1), (u2, p2) = ext[i], ext[i + 1]
        if u1 <= u <= u2 and u2 > u1:
            (u0, p0), (u3, p3) = ext[i - 1], ext[i + 2]
            t = (u - u1) / (u2 - u1)
            # tangents scaled to non-uniform key spacing
            m1 = (p2 - p0) / max(u2 - u0, 1e-6) * (u2 - u1) if u2 != u0 else 0
            m2 = (p3 - p1) / max(u3 - u1, 1e-6) * (u2 - u1) if u3 != u1 else 0
            t2, t3 = t * t, t * t * t
            return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2
    return ks[-1][1]


def win(u, a, b, fade):
    """1 inside [a, b] on a loop of 1, fading over `fade` at both ends."""
    def inside(x):
        return smooth(a - fade, a, x) * (1 - smooth(b, b + fade, x))
    return max(inside(u), inside(u + 1), inside(u - 1))


def kick(t, at, rise=0.06, decay=6.0):
    """A quick twitch at time `at`: up in `rise` s, then an exponential settle."""
    if t < at:
        return 0.0
    if t < at + rise:
        return smooth(0, 1, (t - at) / rise)
    return math.exp(-(t - at - rise) * decay)


# ------------------------------------------------------------------ clips

def planted(R, P, rest_pose=None):
    """Every foot and paw on its rest spot, flat (the sitting pose with the body moved)."""
    for s in 'LR':
        R.limb(P, (f'thigh_{s}', f'shin_{s}', f'foot_{s}'), R.head[f'foot_{s}'], I)
        R.limb(P, (f'upperarm_{s}', f'forearm_{s}', f'hand_{s}'), R.head[f'hand_{s}'], I)


def breathe(R, P, t, amp=1.0):
    b = math.sin(2 * math.pi * t / 1.5)
    P.rot('chest', qe(-1.2 * amp * b))
    P.rot('spine', qe(-0.6 * amp * b))
    P.loc += Vector((0, 0, 0.004 * amp * b * R.H))


def ears(R, P, sp, back=0.0, spread=0.0, twitch_l=0.0, twitch_r=0.0):
    """back: + folds them down the back; spread: + splays them out; twitch: a flick per side."""
    if not sp['ears']:
        return
    for s, sg, tw in (('L', 1, twitch_l), ('R', -1, twitch_r)):
        P.rot(f'ear_{s}', qe(-back - 12 * tw, sg * (spread + 8 * tw), sg * 10 * tw))


def tail(R, P, sp, curl=0.0, sway=0.0, t=0.0):
    """curl: + tucks the tail forward (over the back for the squirrel); sway: side swing (deg), the
    tip lagging behind the base."""
    n = sp['tail']
    for i in range(n):
        lag = math.sin(2 * math.pi * t / 2.2 - i * 0.7)
        P.rot(f'tail{i}', qe(curl / max(n, 1), 0, sway * lag * (0.6 + 0.4 * i)))


def c_idle(R, P, sp, t, dur):
    breathe(R, P, t)
    # head: a slow look-around with a small tilt, plus a sniff (nose bob) twice a cycle
    P.rot('head', qe(2 * math.sin(2 * math.pi * t / dur * 2) * math.sin(2 * math.pi * t / dur), 4 * math.sin(2 * math.pi * t / dur), 7 * math.sin(2 * math.pi * t / dur)))
    P.rot('neck', qe(0, 0, 3 * math.sin(2 * math.pi * t / dur)))
    ears(R, P, sp, back=3 * math.sin(2 * math.pi * t / 1.5), twitch_l=kick(t, 0.9, decay=9), twitch_r=kick(t, 2.1, decay=9))
    tail(R, P, sp, curl=3 * math.sin(2 * math.pi * t / 1.5), sway=10 if sp['tail'] > 1 else 14, t=t)
    if sp['throat']:  # frog: the throat pumps quickly while it breathes
        pump = 0.5 - 0.5 * math.cos(2 * math.pi * t / (dur / 6))
        P.scale['throat'] = 1 + 0.16 * pump
    planted(R, P)


def c_look(R, P, sp, t, dur):
    """Turn the head (and a bit of the chest) left, hold, right, hold, back."""
    u = t / dur
    yaw = track([(0, 0), (0.12, 0), (0.28, 38), (0.45, 38), (0.62, -34), (0.8, -34), (0.95, 0), (1, 0)], u, loop=False)
    tilt = track([(0, 0), (0.28, 8), (0.45, 10), (0.62, -8), (0.8, -8), (1, 0)], u, loop=False)
    breathe(R, P, t)
    P.rot('chest', qe(0, 0, 0.25 * yaw))
    P.rot('neck', qe(0, 0, 0.3 * yaw))
    P.rot('head', qe(-4 * abs(yaw) / 38, tilt, 0.45 * yaw))
    ears(R, P, sp, spread=0.1 * abs(yaw), twitch_l=kick(t, dur * 0.3, decay=8), twitch_r=kick(t, dur * 0.64, decay=8))
    tail(R, P, sp, sway=4, t=t)
    planted(R, P)


def c_ears(R, P, sp, t, dur):
    """Ears: back flat, then pricked up and swivelling, one flick each, back to rest."""
    u = t / dur
    back = track([(0, 0), (0.15, 35), (0.3, 35), (0.45, -12), (0.7, -6), (1, 0)], u, loop=False)
    spread = track([(0, 0), (0.15, 12), (0.3, 12), (0.45, -4), (0.6, 10), (0.75, -6), (1, 0)], u, loop=False)
    breathe(R, P, t)
    P.rot('head', qe(track([(0, 0), (0.15, 6), (0.45, -8), (1, 0)], u, loop=False), 0, 0))
    ears(R, P, sp, back=back, spread=spread, twitch_l=kick(t, dur * 0.55, decay=10), twitch_r=kick(t, dur * 0.68, decay=10))
    tail(R, P, sp, sway=5, t=t)
    planted(R, P)


def c_croak(R, P, sp, t, dur):
    """Frog: head up, the throat balloons twice, head back down."""
    u = t / dur
    lift = track([(0, 0), (0.15, 1), (0.85, 1), (1, 0)], u, loop=False)
    sac = sum(smooth(a, a + 0.1, u) * (1 - smooth(a + 0.2, a + 0.32, u)) for a in (0.15, 0.5))
    P.loc += Vector((0, 0, 0.03 * R.H * lift))
    P.rot('chest', qe(-8 * lift))
    P.rot('head', qe(-14 * lift - 6 * sac))
    P.scale['throat'] = 1 + 1.1 * sac
    breathe(R, P, t, 0.5)
    planted(R, P)


def c_groom(R, P, sp, t, dur):
    """Face wash. 'both' (hare, squirrel): sits up, both paws to the muzzle, rubbing in small
    circles while the head nods into them. 'wipe' (frog): the head dips and tilts, one front leg
    at a time sweeps up over the eye, twice per side."""
    u = t / dur
    H = R.H
    up = track([(0, 0), (0.16, 1), (0.84, 1), (1, 0)], u, loop=False)
    sit = sp.get('groom_sit', 1.0)
    wipe = sp.get('groom', 'both') == 'wipe'
    P.loc += Vector((0, 0.03 * H * up * sit, 0.07 * H * up * sit))
    P.rot('spine', qe(-16 * up * sit))
    P.rot('chest', qe(-10 * up * sit))
    act = 0.2 < u < 0.8
    rub = math.sin(2 * math.pi * (u - 0.2) / 0.15) if act else 0.0
    # frog: the head leans into the wiping leg, left then right
    tilt = 18 * up * (1 - 2 * smooth(0.44, 0.56, u)) if wipe else 0.0
    P.rot('neck', qe(10 * up))
    P.rot('head', qe(sp.get('groom_nod', 20) * up + 4 * rub * up, tilt, 0))
    ears(R, P, sp, back=12 * up)
    breathe(R, P, t, 0.4)
    for s in 'LR':  # back feet stay put
        R.limb(P, (f'thigh_{s}', f'shin_{s}', f'foot_{s}'), R.head[f'foot_{s}'], I)
    A, hd, tl = R.fk(P)
    for s, sg in (('L', 1), ('R', -1)):
        ch = (f'upperarm_{s}', f'forearm_{s}', f'hand_{s}')
        rest_dir = (R.tail[ch[2]] - R.head[ch[2]]).normalized()
        if wipe:
            # this side's turn: u in [0.18, 0.5] for L, [0.5, 0.82] for R; two sweeps each
            a0 = 0.18 if s == 'L' else 0.5
            k = smooth(a0, a0 + 0.06, u) * (1 - smooth(a0 + 0.26, a0 + 0.32, u))
            ph = min(1, max(0, (u - a0 - 0.04) / 0.24))
            sweep = 0.5 - 0.5 * math.cos(2 * math.pi * 2 * ph)  # 0 below the eye .. 1 over it
            eye = Vector((sg * 0.2, -0.1 - 0.06 * sweep, 0.1 + 0.18 * sweep)) * H
            tgt = hd['head'] + A['head'] @ eye
            dirn = (A['head'] @ Vector((sg * 0.2, 0.4, 1.0))).normalized()
        else:
            k = smooth(0.04, 0.22, u) * (1 - smooth(0.8, 0.96, u))
            ph = 2 * math.pi * (u - 0.2) / 0.3 + (0 if s == 'L' else math.pi)
            circ = Vector((0, 0.012 * math.cos(ph), 0.03 * math.sin(ph))) * (1 if act else 0)
            face = Vector(sp.get('groom_face', (0, -0.16, 0.0)))
            tgt = hd['head'] + A['head'] @ ((face + Vector((sg * 0.05, 0, 0)) + circ) * H)
            dirn = (A['head'] @ Vector((-sg * 0.3, -0.2, 1.0))).normalized()
        end = rest_dir.rotation_difference(dirn)
        R.limb(P, ch, R.head[ch[2]].lerp(tgt, k), I.slerp(end, k))
    tail(R, P, sp, sway=5, t=t)


def c_hop(R, P, sp, t, dur):
    """One hop, looping: crouch, push off with the back legs, stretch in the air, front paws land,
    back feet swing in ahead of them, squash. The game slides the animal at L / dur: every planted
    foot slides back at that speed so it stays still on the ground."""
    H, hp = R.H, sp['hop']
    L = hp['length']
    u = (t / dur) % 1.0
    v = L  # metres per cycle
    lift = hp['lift'] * H
    # body: height, surge (local forward = -y), pitch (+ nose down), spine curl (+ hunched)
    z = track([(0, -0.05), (0.1, -0.02), (0.22, 0.25), (0.4, 1.0), (0.56, 0.55), (0.66, 0.1), (0.76, -0.06), (0.86, -0.05)], u) * lift
    surge = track([(0, 0), (0.2, -0.06), (0.4, -0.12), (0.6, -0.14), (0.74, -0.06), (0.88, 0.0)], u) * L
    # the back legs lift the rear as they extend: the sitting body tips forward into the flight
    # line, lands nose first on the front paws, then settles back as the back feet come in
    pa = hp.get('pitch', 22)
    pitch = pa * track([(0, 0.1), (0.1, 0.3), (0.22, 0.75), (0.4, 0.8), (0.56, 1.25), (0.66, 1.2), (0.76, 0.6), (0.88, 0.15)], u)
    curl = hp.get('curl', 1.0) * track([(0, 10), (0.14, 2), (0.26, -14), (0.42, -10), (0.58, 2), (0.74, 12), (0.88, 10)], u)
    P.loc += Vector((0, surge, z))
    P.rot('pelvis', qe(pitch))
    P.rot('spine', qe(0.5 * curl))
    P.rot('chest', qe(0.3 * curl))
    P.rot('neck', qe(-0.4 * pitch - 0.3 * curl))
    P.rot('head', qe(-0.5 * pitch - 0.1 * curl))
    stretch = track([(0, -1), (0.12, -0.3), (0.26, 1), (0.42, 0.4), (0.56, 0), (0.72, -0.6), (0.8, -1.0), (0.9, -0.8)], u)
    k = 0.07 * stretch
    P.rscale = Vector((1 - 0.5 * k, 1 - 0.5 * k, 1 + k))
    ears(R, P, sp, back=track([(0, 5), (0.26, 30), (0.5, 22), (0.66, -8), (0.8, 0)], u), spread=4)
    tail(R, P, sp, curl=track([(0, 0), (0.25, -18), (0.5, -10), (0.7, 12), (0.85, 4)], u), sway=0, t=t)
    if sp['throat']:
        P.scale['throat'] = 1 - 0.05 * max(stretch, 0)

    # contact windows (u, looping): every foot is on its rest spot at the gather (u = 0), so a
    # planted foot is at rest.y + v * (u - 0) and lands (u - land) cycles earlier, further forward
    bl, bo = hp.get('back', (0.72, 0.24))
    fl, fo = hp.get('front', (0.6, 0.06))
    A, hd, _ = R.fk(P)
    for s in 'LR':
        for part, land, off in (('back', bl, bo), ('front', fl, fo)):
            ch = (f'thigh_{s}', f'shin_{s}', f'foot_{s}') if part == 'back' else (f'upperarm_{s}', f'forearm_{s}', f'hand_{s}')
            rest, tip = R.head[ch[2]], R.tail[ch[2]]
            span, du = (off - land) % 1.0, (u - land) % 1.0
            y_land = -((0 - land) % 1.0) * v  # slide offset when it lands
            peel_max = hp.get('peel', 55) if part == 'back' else 35
            if du <= span:  # planted, sliding back; the heel peels up just before lift-off
                dy = y_land + du * v
                Q = qe(-peel_max * smooth(span - 0.14, span, du))
                toe = tip + Vector((0, dy, 0))
                R.limb(P, ch, toe + Q @ (rest - tip), Q)
                continue
            # airborne: lift-off spot -> trailing / reaching pose (hip-relative) -> landing spot
            a = (du - span) / (1 - span)
            hip = hd[ch[0]]
            Ap = A[R.parent[ch[0]]]
            if part == 'back':  # legs trail behind, stretched, then swing forward under the belly
                trail = Vector((0, 0.35, -0.1)) * H * hp.get('trail', 1.0)
                tuck = Vector((0, -0.12, 0.08)) * H * hp.get('tuck', 1.0)
            else:  # paws tuck up after take-off, then reach forward for the landing
                trail = Vector((0, 0.06, 0.1)) * H
                tuck = Vector((0, -0.16, -0.02)) * H
            base = Ap @ (rest - R.head[ch[0]]) + hip
            mid = base + Ap @ trail.lerp(tuck, smooth(0.25, 0.8, a))
            start = rest + Vector((0, y_land + span * v, 0))
            end = rest + Vector((0, y_land, 0))
            tgt = start.lerp(mid, smooth(0, 0.3, a)).lerp(end, smooth(0.72, 1.0, a))
            tgt.z = max(tgt.z, rest.z)
            pk = peel_max * (1 - smooth(0, 0.3, a))
            # toes point back while trailing, flatten (a touch up) for the landing
            swing = (40 if part == 'back' else -30) * smooth(0.1, 0.35, a) * (1 - smooth(0.45, 0.7, a))
            Q = (Ap @ qe(-pk + swing) if part == 'back' else qe(-pk + swing)).slerp(qe(-8), smooth(0.6, 0.95, a))
            Q = Q.slerp(I, smooth(0.9, 1.0, a))
            R.limb(P, ch, tgt, Q)
            _, _, tl = R.fk(P)
            if tl[ch[2]].z < 0.004 * H:  # never through the ground
                R.limb(P, ch, tgt + Vector((0, 0, 0.004 * H - tl[ch[2]].z)), Q)


def clip_list(sp):
    hop = round(sp['hop']['dur'] * FPS) / FPS
    extra = ('Croak', c_croak, 1.8) if sp['extra'] == 'Croak' else ('Ears', c_ears, 1.4)
    return [('Idle', c_idle, 3.0, True), ('Hop', c_hop, hop, True), ('Look', c_look, 2.4, False),
            ('Groom', c_groom, 2.6, False), (*extra, False)]


# ------------------------------------------------------------------ keying

def apply(R, P):
    rs = P.rscale
    for pb in R.rig.pose.bones:
        n = pb.name
        pb.rotation_mode = 'QUATERNION'
        Rq = R.rest[n]
        pb.rotation_quaternion = Rq.inverted() @ P.q.get(n, I) @ Rq
        pb.location = Rq.inverted() @ P.loc if n == 'pelvis' else Vector()
        if n == 'root':  # squash / stretch in world axes (root's local x, y, z = world x, z, -y)
            pb.scale = (rs.x, rs.z, rs.y)
        else:
            s = P.scale.get(n, 1.0)
            pb.scale = (s, s, s)


def make_clips(R, sp):
    rig = R.rig
    rig.animation_data_create()
    out = []
    for name, fn, dur, loop in clip_list(sp):
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        n = round(dur * FPS)
        last = {}
        for f in range(n + 1):
            P = Pose()
            fn(R, P, sp, 0.0 if loop and f == n else f / FPS, dur)  # loops end where they start
            apply(R, P)
            for pb in rig.pose.bones:
                qq = pb.rotation_quaternion
                if pb.name in last and last[pb.name].dot(qq) < 0:
                    pb.rotation_quaternion = -qq
                last[pb.name] = pb.rotation_quaternion.copy()
                pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
                if pb.name in ('pelvis', 'root', 'throat'):
                    pb.keyframe_insert('location' if pb.name == 'pelvis' else 'scale', frame=f, group=pb.name)
        act.frame_range = (0, n)
        act.use_frame_range = True
        act.use_cyclic = loop
        out.append((name, round(n / FPS, 3), loop))
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion, pb.location, pb.scale = I, Vector(), (1, 1, 1)
    return out


# ------------------------------------------------------------------ renders

def workbench(res):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('bg')
    sc.world.color = (0.32, 0.34, 0.38)
    sh = sc.display.shading
    sh.light, sh.color_type, sh.show_shadows = 'STUDIO', 'TEXTURE', True
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.use_stamp = True
    for k in ('date', 'time', 'render_time', 'frame', 'frame_range', 'memory', 'hostname', 'camera',
              'lens', 'scene', 'marker', 'filename', 'sequencer_strip'):
        if hasattr(sc.render, 'use_stamp_' + k):
            setattr(sc.render, 'use_stamp_' + k, False)
    sc.render.use_stamp_note = True
    sc.render.stamp_font_size = max(10, res // 18)


def camera(name, loc, target, ortho):
    cd = bpy.data.cameras.new(name)
    cd.type, cd.ortho_scale = 'ORTHO', ortho
    cam = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return cam


def ground(size):
    bpy.ops.mesh.primitive_plane_add(size=size)
    g = bpy.context.active_object
    mat = bpy.data.materials.new('ground')
    mat.diffuse_color = (0.55, 0.62, 0.45, 1)
    g.data.materials.append(mat)
    return g


def render(cam, path, note):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.stamp_note_text = note
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def tile(paths, cols, out):
    """Paste equal-size PNGs row by row into one image (blank cells for None)."""
    imgs = [bpy.data.images.load(p) if p else None for p in paths]
    w, h = next(i for i in imgs if i).size
    rows = (len(imgs) + cols - 1) // cols
    big = np.ones((rows * h, cols * w, 4), np.float32)
    for k, im in enumerate(imgs):
        if im is None:
            continue
        a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
        r, c = k // cols, k % cols
        big[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = a  # Blender rows go up
        bpy.data.images.remove(im)
    img = bpy.data.images.new('sheet', cols * w, rows * h, alpha=False)
    img.pixels[:] = big.ravel()
    img.filepath_raw, img.file_format = out, 'PNG'
    img.save()
    bpy.data.images.remove(img)
    for p in paths:
        if p:
            os.remove(p)


def views(R):
    """Side (the animal's left) and the game's view: high, three-quarter from the front-left."""
    H = R.H
    side = camera('side', (6 * H, 0, 0.45 * H), (0, 0, 0.45 * H), 2.6 * H)
    top = camera('top', (-4.2 * H, -5.2 * H, 7.5 * H), (0, 0, 0.3 * H), 2.3 * H)
    return side, top


def preview(key, R, body, sp, clips, only=(), weights=False, res=220):
    """Every clip: 8 frames from the side (Hop: moving at its speed, so planted feet must look still)
    and from the game camera; rows = clips, side row then top row."""
    out = os.path.join(WORK, 'preview')
    os.makedirs(out, exist_ok=True)
    workbench(res)
    ca = weight_colors(body, R) if weights else None
    if weights:
        bpy.context.scene.display.shading.color_type = 'VERTEX'
    g = ground(8 * R.H)
    side, top = views(R)
    rig, cols, paths = R.rig, 8, []
    speed = sp['hop']['length'] / clips[1][1]
    for name, dur, loop in clips:
        if only and name not in only:
            continue
        rig.animation_data.action = bpy.data.actions[name]
        side.data.ortho_scale = (2.6 if name == 'Hop' else 1.5) * R.H
        top.data.ortho_scale = (2.3 if name == 'Hop' else 1.5) * R.H
        n = round(dur * FPS)
        row = {'side': [], 'top': []}
        for i in range(cols):
            f = round(i * n / (cols if loop else cols - 1))
            bpy.context.scene.frame_set(f)
            rig.location = (0, -speed * f / FPS + 0.5 * sp['hop']['length'], 0) if name == 'Hop' else (0, 0, 0)
            bpy.context.view_layer.update()
            for v, cam in (('side', side), ('top', top)):
                p = os.path.join(out, f'_{key}_{name}_{v}_{i}.png')
                render(cam, p, f'{name} {f}/{n}')
                row[v].append(p)
        paths += row['side'] + row['top']
    rig.location = (0, 0, 0)
    rig.animation_data.action = None
    bpy.data.objects.remove(g)
    sheet = os.path.join(out, key + '.png')
    tile(paths, cols, sheet)
    return sheet


def weight_colors(body, R):
    """Vertex colour = the dominant bone's colour, darker where it shares. Body grey to white up
    the spine, head yellow, throat pink, ears / tail purple; left limbs warm (thigh red, shin
    orange, foot brown; arm green, forearm lime, hand olive), right limbs the same with red and
    blue swapped."""
    me = body.data
    groups = {g.index: g.name for g in body.vertex_groups}
    fam = {'pelvis': (.15, .15, .15), 'spine': (.4, .4, .4), 'chest': (.65, .65, .65), 'neck': (.9, .9, .9),
           'head': (1, .85, 0), 'throat': (1, .3, .7), 'ear': (.6, 0, .8), 'tail': (.35, 0, .5)}
    limb = {'thigh': (1, 0, 0), 'shin': (1, .5, 0), 'foot': (.45, .2, 0),
            'upperarm': (0, .7, 0), 'forearm': (.6, 1, .2), 'hand': (.3, .35, 0)}
    col = {}
    for n in R.order:
        base = n.split('_')[0].rstrip('0123456789')
        c = fam.get(base) or limb.get(base, (0, 0, 0))
        col[n] = (c[2], c[1] * 0.8, c[0]) if n.endswith('_R') and base in limb else c
    ca = me.color_attributes.new('w', 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        if v.groups:
            g = max(v.groups, key=lambda g: g.weight)
            ca.data[v.index].color = (*(Vector(col[groups[g.group]]) * (0.4 + 0.6 * g.weight)), 1)
    return ca


def check(key, R, body, sp, J):
    """Rest pose with the bones (x-ray) from the front, side, top, and the weights in bone colours."""
    out = os.path.join(WORK, 'check')
    os.makedirs(out, exist_ok=True)
    workbench(360)
    H = sp['height']
    mk = []
    for name in (R.order if R else []):  # a stick per bone
        h, t = R.head[name], R.tail[name]
        bpy.ops.mesh.primitive_cylinder_add(radius=0.012 * H, depth=(t - h).length, location=(h + t) / 2)
        o = bpy.context.active_object
        o.rotation_euler = (t - h).to_track_quat('Z', 'Y').to_euler()
        mk.append(o)

    def grid(axis):
        """Lines every 0.1 H (0.5 H thicker) in the plane seen by that camera, just in front of it."""
        objs = []
        for k in range(-8, 13):
            w = 0.004 * H * (2.5 if k % 5 == 0 else 1)
            for d in (0, 1):
                c, s = [0, 0, 0], [0, 0, 0]
                u, v = {'x': (1, 2), 'y': (0, 2), 'z': (0, 1)}[axis]
                n = {'x': 0, 'y': 1, 'z': 2}[axis]
                c[n] = {'x': 1.2, 'y': -1.2, 'z': 1.3}[axis] * H
                lin, cross = (u, v) if d == 0 else (v, u)
                c[cross] = k * 0.1 * H
                s[lin], s[cross], s[n] = 4 * H, w, w
                if cross == 2 and not 0 <= k <= 10:
                    continue
                bpy.ops.mesh.primitive_cube_add(size=1, location=c)
                o = bpy.context.active_object
                o.scale = s
                objs.append(o)
        return objs

    cams = [camera('front', (0, -6 * H, 0.5 * H), (0, 0, 0.5 * H), 1.6 * H),
            camera('side', (6 * H, 0, 0.5 * H), (0, 0, 0.5 * H), 1.6 * H),
            camera('top', (0, -0.001, 6 * H), (0, 0, 0), 1.6 * H),
            camera('ref', (-3.5 * H, -5 * H, 1.2 * H), (0, 0, 0.5 * H), 1.6 * H)]
    grids = {'front': grid('y'), 'side': grid('x'), 'top': grid('z'), 'ref': []}
    paths = []
    sh = bpy.context.scene.display.shading
    for xray in (False, True):
        sh.show_xray, sh.xray_alpha = xray, 0.35
        for cam in cams:
            for k, objs in grids.items():
                for o in objs:
                    o.hide_render = not xray or k != cam.name
            p = os.path.join(out, f'_{key}_{cam.name}_{xray}.png')
            render(cam, p, f'{cam.name} yaw {sp["yaw_used"]}')
            paths.append(p)
    sh.show_xray = False
    for o in mk + [o for g in grids.values() for o in g]:
        bpy.data.objects.remove(o)
    if body.vertex_groups:  # weights: the dominant bone's colour
        ca = weight_colors(body, R)
        sh.light = 'FLAT'
        sh.color_type = 'VERTEX'
        for cam in cams:
            p = os.path.join(out, f'_{key}_{cam.name}_w.png')
            render(cam, p, 'weights')
            paths.append(p)
        body.data.color_attributes.remove(ca)
        sh.color_type, sh.light = 'TEXTURE', 'STUDIO'
    for c in cams:
        bpy.data.objects.remove(c)
    sheet = os.path.join(out, key + '.png')
    tile(paths, 4, sheet)
    return sheet


# ------------------------------------------------------------------ export

def export(key, R, body, speed):
    os.makedirs(OUT, exist_ok=True)
    R.rig['speed'] = {'Hop': round(speed, 3)}  # node extras: the game scales Hop to its real speed
    bpy.ops.object.select_all(action='DESELECT')
    R.rig.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = R.rig
    path = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_skins=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_optimize_animation_size=True, export_def_bones=False, export_image_format='AUTO',
        export_normals=True, export_apply=False, export_reset_pose_bones=True, export_extras=True,
        export_morph=False)
    return path


def pack(key):
    """Blender's GLB -> game file: keyframes deduplicated, 512 px webp, meshopt."""
    os.makedirs(GAME, exist_ok=True)
    src, dst = os.path.join(OUT, key + '.glb'), os.path.join(GAME, key + '.glb')
    tmp = [os.path.join(OUT, f'{key}.tmp{i}.glb') for i in range(3)]
    npx = 'npx.cmd' if os.name == 'nt' else 'npx'
    cli = lambda *a: subprocess.run([npx, '--yes', '@gltf-transform/cli@4', *a], check=True, cwd=ROOT,
                                    stdout=subprocess.DEVNULL)
    cli('resample', src, tmp[0], '--tolerance', '0.0005')
    cli('resize', tmp[0], tmp[1], '--width', '512', '--height', '512')
    cli('webp', tmp[1], tmp[2], '--quality', '88')
    cli('meshopt', tmp[2], dst, '--level', 'medium')
    for t in tmp:
        os.remove(t)
    return os.path.getsize(dst)


# ------------------------------------------------------------------ main

def build(key, src):
    sp = load_spec(key)
    reset()
    body = import_raw(key, src)
    normalise(body, sp)
    tris = clean(body)
    J = joints_of(sp)
    rig = build_armature(key, sp, J) if sp['joints'] else None
    return sp, body, rig and Rig(rig, sp), J, tris


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    src = argv[argv.index('--src') + 1] if '--src' in argv else SRC
    vals = {argv[i + 1] for i, a in enumerate(argv[:-1]) if a in ('--src', '--only', '--res')}
    keys = [a for a in argv if not a.startswith('--') and a not in vals] or list(SPECIES)
    for key in keys:
        sp, body, R, J, tris = build(key, src)
        print(f'[{key}] yaw {sp["yaw_used"]} tris {tris} bones {R and len(R.order)}')
        if R is None:  # no landmarks yet: the turned mesh on a grid, to place them
            print(f'[{key}] check', check(key, R, body, sp, J))
            continue
        skin(body, R.rig, sp, J)
        if '--check' in argv:
            print(f'[{key}] check', check(key, R, body, sp, J))
            if '--quick' in argv:
                continue
        clips = make_clips(R, sp)
        if '--fkcheck' in argv:  # my FK against Blender's pose, on a busy frame of every clip
            for name, dur, loop in clips:
                fn = next(c[1] for c in clip_list(sp) if c[0] == name)
                f = round(dur * FPS * 0.37)
                P = Pose()
                fn(R, P, sp, f / FPS, dur)
                _, hd, tl = R.fk(P)
                R.rig.animation_data.action = bpy.data.actions[name]
                bpy.context.scene.frame_set(f)
                err = max(((R.rig.pose.bones[n].tail - tl[n]).length for n in R.order if n != 'root'))
                print(f'[{key}] fk {name} f{f} max tail error {err / R.H:.4f} H')
            R.rig.animation_data.action = None
        speed = sp['hop']['length'] / clips[1][1]
        print(f'[{key}] clips', clips, f'hop speed {speed:.3f} m/s')
        if '--preview' in argv:
            only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else ()
            print(f'[{key}] preview', preview(key, R, body, sp, clips, only, '--weights' in argv,
                                                   int(argv[argv.index('--res') + 1]) if '--res' in argv else 220))
        path = export(key, R, body, speed)
        if '--nopack' not in argv:
            print(f'[{key}] packed {os.path.getsize(path)} -> {pack(key)} bytes')


if __name__ == '__main__':
    main()

