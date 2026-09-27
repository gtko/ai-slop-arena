"""Helpers shared by rig_flyer.py and rig_lizard.py (fauna body plans flyer and lizard).

Blender frame everywhere: z up, the animal faces -y, its left is +x. Poses are written as rotations
in the armature's rest axes, relative to the parent bone (a child's rotation is carried by its
parent's), and a tiny forward-kinematics model (FK) gives the posed joints for the leg IK without
asking Blender's depsgraph.
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
RAW = os.environ.get('FAUNA_RAW') or os.path.normpath(os.path.join(
    ROOT, '..', 'blender-mcp-3d-models-cb1270', 'art-src', 'glb', 'fauna'))
if not os.path.isdir(RAW):
    RAW = os.path.join(ROOT, 'art-src', 'glb', 'fauna')
OUT = os.path.join(HERE, 'out')
WORK = os.path.join(HERE, 'work')
GAME = os.path.join(ROOT, 'public', 'assets', 'models', 'fauna')
MARKS = os.path.join(HERE, 'landmarks')
FPS = 30
TAU = math.tau
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
I = Quaternion()


def q(axis, a):
    return Quaternion(axis, a)


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0))) if e1 != e0 else float(x >= e0)
    return t * t * (3 - 2 * t)


def ease(x):
    return smooth(0.0, 1.0, x)


def env(t, a, b, c, d):
    """0 before a, up to 1 at b, holds, back to 0 from c to d."""
    return smooth(a, b, t) * (1 - smooth(c, d, t))


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return [a for a in argv if not a.startswith('--')], {a for a in argv if a.startswith('--')}


def load_marks(key):
    p = os.path.join(MARKS, key + '.json')
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {}


# ------------------------------------------------------------------ mesh

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.unit_settings.system = 'METRIC'


def select_only(obj):
    for o in bpy.context.scene.objects:
        if o:
            o.select_set(o == obj)
    bpy.context.view_layer.objects.active = obj


def import_raw(key):
    """The Hunyuan GLB as one mesh object with its transforms applied (UV-seam duplicates merged,
    so the skin cannot crack along the seams)."""
    bpy.ops.import_scene.gltf(filepath=os.path.join(RAW, key + '.glb'), merge_vertices=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.parent = None
    for o in [o for o in bpy.context.scene.objects if o != obj]:
        bpy.data.objects.remove(o)
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = obj.data.name = key
    return obj


def clean(obj, max_tris, min_island=0.02):
    """Weld, drop floating debris (islands under min_island of the vertices), decimate to the budget."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        comp, stack = [], [v]
        seen.add(v.index)
        while stack:
            a = stack.pop()
            comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index)
                    stack.append(b)
        islands.append(comp)
    n = len(bm.verts)
    junk = [v for c in islands if len(c) < min_island * n for v in c]
    bmesh.ops.delete(bm, geom=junk, context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > max_tris:
        mod = obj.modifiers.new('dec', 'DECIMATE')
        mod.ratio = max_tris / tris * 0.98
        mod.use_collapse_triangulate = True
        select_only(obj)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.polygons.foreach_set('use_smooth', [True] * len(obj.data.polygons))
    return sum(len(p.vertices) - 2 for p in obj.data.polygons), len(islands) - len([c for c in islands if len(c) >= min_island * n])


def shrink_texture(obj, size=512):
    for m in obj.data.materials:
        if not m or not m.node_tree:
            continue
        for nd in m.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image and nd.image.size[0] > size:
                img = nd.image
                img.scale(size, size)
                img.pack()
            if nd.type == 'BSDF_PRINCIPLED':
                nd.inputs['Roughness'].default_value = 0.7
                nd.inputs['Metallic'].default_value = 0.0


def verts(obj):
    n = len(obj.data.vertices)
    a = np.empty(n * 3)
    obj.data.vertices.foreach_get('co', a)
    return a.reshape(n, 3)


def transform(obj, M):
    obj.data.transform(M)
    obj.data.update()


def euler_deg(r):
    from mathutils import Euler
    return Euler([math.radians(a) for a in r], 'XYZ').to_matrix().to_4x4()


# ------------------------------------------------------------------ armature

def build_armature(key, bones, up=None):
    """bones: {name: (head, tail, parent)} in order. Every bone's roll puts its local z toward `up`
    (default: +z world, or -y for vertical bones), so the rig is readable in any tool."""
    arm = bpy.data.armatures.new(key + '_rig')
    rig = bpy.data.objects.new(key + '_rig', arm)
    bpy.context.scene.collection.objects.link(rig)
    select_only(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, (h, t, parent) in bones.items():
        b = arm.edit_bones.new(name)
        b.head, b.tail = Vector(h), Vector(t)
        if parent:
            b.parent = eb[parent]
        b.use_deform = name != 'root'
        d = (b.tail - b.head).normalized()
        b.align_roll(Vector((0, -1, 0)) if abs(d.z) > 0.8 else Vector((0, 0, 1)))
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.display_type = 'STICK'
    rig.show_in_front = True
    return rig


class FK:
    """Rest joints and bone frames of the rig, and the posed joints of a pose {bone: Q} + root offset."""

    def __init__(self, rig):
        self.rig = rig
        self.bones = [b.name for b in rig.data.bones]
        self.parent = {b.name: b.parent.name if b.parent else None for b in rig.data.bones}
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in rig.data.bones}
        self.head0 = {b.name: b.head_local.copy() for b in rig.data.bones}
        self.tail0 = {b.name: b.tail_local.copy() for b in rig.data.bones}

    def solve(self, P):
        """World (armature) rotation and head of every bone for the pose P."""
        tot, head = {}, {}
        for n in self.bones:  # bones are listed parents first
            p = self.parent[n]
            tot[n] = (tot[p] if p else I) @ P.Q.get(n, I)
            off = P.loc.get(n, Vector())
            head[n] = (head[p] + tot[p] @ (self.head0[n] - self.head0[p]) if p else self.head0[n]) + off
        return tot, head

    def tail(self, n, tot, head):
        return head[n] + tot[n] @ (self.tail0[n] - self.head0[n])


class Pose:
    def __init__(self):
        self.Q, self.loc = {}, {}

    def rot(self, bone, r):
        """Add a rotation (armature axes) on top of what the bone already has."""
        self.Q[bone] = r @ self.Q.get(bone, I)

    def move(self, bone, v):
        self.loc[bone] = self.loc.get(bone, Vector()) + Vector(v)


def frame_rot(a1, a2, b1, b2):
    """Rotation taking the frame built on (a1, bend a2) onto (b1, bend b2)."""
    def fr(u, w):
        u = u.normalized()
        n = u.cross(w)
        n = n.normalized() if n.length > 1e-6 else u.orthogonal().normalized()
        return Matrix((u, n, u.cross(n))).transposed()
    return (fr(b1, b2) @ fr(a1, a2).transposed()).to_quaternion()


IK_MISS = [0.0]


def two_bone_ik(fk, P, upper, lower, target, pole, foot=None, foot_world=I):
    """Place upper/lower so the lower bone's tail lands on `target` (armature frame), the joint
    bending toward `pole` (a world direction), keeping the bone twist in the bend plane. The foot
    bone (child of lower) gets the world rotation `foot_world` (identity = flat, as at rest)."""
    tot, head = fk.solve(P)
    par = fk.parent[upper]
    Qp = tot[par]
    S = head[upper]
    a = (fk.head0[lower] - fk.head0[upper]).length
    b = (fk.tail0[lower] - fk.head0[lower]).length
    D = target - S
    if D.length > (a + b) * 0.999:  # out of reach: the foot lifts off (counted, see make_clips)
        IK_MISS[0] = max(IK_MISS[0], D.length - (a + b))
    dist = min(max(D.length, abs(a - b) + 1e-4, 1e-4), (a + b) * 0.999)
    u = D.normalized()
    along = (a * a - b * b + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, a * a - along * along))
    n = pole - u * pole.dot(u)
    n = n.normalized() if n.length > 1e-6 else u.orthogonal().normalized()
    E = S + u * along + n * h
    T = S + u * dist
    r1 = fk.head0[lower] - fk.head0[upper]
    r2 = fk.tail0[lower] - fk.head0[lower]
    d1, d2 = E - S, T - E
    # world rotations taking each rest bone onto its posed direction, the rest bend plane onto
    # the posed one (so the limb doesn't twist), then made relative to the parent
    Wu = frame_rot(r1, r2, d1, d2)
    Wl = frame_rot(r2, -r1, d2, -d1)
    P.Q[upper] = Qp.inverted() @ Wu
    P.Q[lower] = Wu.inverted() @ Wl
    if foot:
        tot2, _ = fk.solve(P)
        P.Q[foot] = tot2[lower].inverted() @ foot_world
    return E, T


def key_pose(rig, fk, P, frame, last):
    for pb in rig.pose.bones:
        R = fk.rest[pb.name]
        qq = R.inverted() @ P.Q.get(pb.name, I) @ R
        if pb.name in last and last[pb.name].dot(qq) < 0:  # no flips between keys
            qq = -qq
        last[pb.name] = qq.copy()
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = qq
        pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
        if pb.name in P.loc or pb.name == 'root':
            # a world offset, in the bone's own frame under its posed parent
            p = fk.parent[pb.name]
            tot = fk.solve(P)[0] if p else None
            v = P.loc.get(pb.name, Vector())
            pb.location = R.inverted() @ ((tot[p].inverted() @ v) if p else v)
            pb.keyframe_insert('location', frame=frame, group=pb.name)


def make_clips(rig, fk, clips):
    """clips: [(name, fn(t) -> Pose, duration s, loop)]. Loops end exactly on their first pose."""
    rig.animation_data_create()
    made = []
    for name, fn, dur, loop in clips:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        n = max(2, round(dur * FPS))
        last = {}
        IK_MISS[0] = 0.0
        for f in range(n + 1):
            P = fn(0.0 if loop and f == n else f / FPS)
            key_pose(rig, fk, P, f, last)
        act.frame_range = (0, n)
        act.use_frame_range = True
        act.use_cyclic = loop
        made.append((name, n / FPS, loop))
        if IK_MISS[0] > 0:
            print(f'  {name}: a foot misses its target by up to {IK_MISS[0] * 1000:.1f} mm')
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = I
        pb.location = Vector()
    return made


# ------------------------------------------------------------------ weights

def seg_closest(p, a, b):
    ab = b - a
    t = min(1.0, max(0.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length, t


class Chain:
    """Bones along a polyline of joints: a point is placed by its nearest point on the polyline
    (arc length s), each joint hands over to the next bone within +-band of it."""

    def __init__(self, pts, bones, bands):
        self.pts = [Vector(p) for p in pts]
        self.bones, self.bands = bones, bands
        self.cum = [0.0]
        for a, b in zip(self.pts, self.pts[1:]):
            self.cum.append(self.cum[-1] + (b - a).length)

    def locate(self, p):
        best = (1e9, 0.0)
        for i, (a, b) in enumerate(zip(self.pts, self.pts[1:])):
            d, t = seg_closest(p, a, b)
            if d < best[0]:
                best = (d, self.cum[i] + t * (b - a).length)
        return best

    def weights(self, s):
        out, carry = {}, 1.0
        for i, bone in enumerate(self.bones):
            u = smooth(self.cum[i + 1] - self.bands[i + 1], self.cum[i + 1] + self.bands[i + 1], s) \
                if i + 1 < len(self.bones) else 0.0
            out[bone] = out.get(bone, 0.0) + carry * (1 - u)
            carry *= u
        return out


def apply_weights(obj, rig, W, smooth_passes=2, factor=0.5):
    """W: per vertex {bone: weight}. Smoothed along the surface, at most 4 bones, normalised."""
    obj.vertex_groups.clear()
    groups = {}
    for i, w in enumerate(W):
        for b, x in w.items():
            if x > 1e-3:
                groups.setdefault(b, {}).setdefault(round(x, 3), []).append(i)
    for b in rig.data.bones:
        if not b.use_deform:
            continue
        vg = obj.vertex_groups.new(name=b.name)
        for x, ids in groups.get(b.name, {}).items():
            vg.add(ids, x, 'REPLACE')
    select_only(obj)
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    if smooth_passes:
        bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=factor, repeat=smooth_passes)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.parent = rig
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


# ------------------------------------------------------------------ export

def export(key, rig, body, extras=None):
    os.makedirs(OUT, exist_ok=True)
    if extras:
        for k, v in extras.items():
            rig[k] = v
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_skins=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_optimize_animation_size=True, export_def_bones=False, export_image_format='AUTO',
        export_normals=True, export_apply=False, export_reset_pose_bones=True, export_extras=True,
        export_morph=False)
    return path


def pack(key):
    """out/<key>.glb -> public/assets/models/fauna/<key>.glb: keys resampled, meshopt, webp 512."""
    os.makedirs(GAME, exist_ok=True)
    src = os.path.join(OUT, key + '.glb')
    tmp = os.path.join(OUT, key + '.tmp.glb')
    dst = os.path.join(GAME, key + '.glb')
    npx = 'npx.cmd' if os.name == 'nt' else 'npx'
    run = lambda *a: subprocess.run([npx, '--yes', '@gltf-transform/cli@4', *a], check=True, cwd=ROOT,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    run('resample', src, tmp, '--tolerance', '0.0005')
    run('optimize', tmp, dst, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512',
        '--simplify', 'false', '--instance', 'false', '--flatten', 'false', '--join', 'false', '--palette', 'false')
    os.remove(tmp)
    return os.path.getsize(dst)


# ------------------------------------------------------------------ preview

def _cam(name, loc, target, ortho):
    cd = bpy.data.cameras.new(name)
    cd.type = 'ORTHO'
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y' if abs(d.normalized().z) < 0.99 else 'Y').to_euler()
    if abs(d.normalized().z) > 0.99:
        cam.rotation_euler = (0, 0, math.pi)  # straight down, the animal's head (-y) up in the image
    return cam


def _setup_render(size):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.show_shadows = False
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.exposure = 0.6
    sc.world = sc.world or bpy.data.worlds.new('w')


def _grid(obj_z, span):
    """A ground grid (10 cm lines) so sliding feet and height show."""
    me = bpy.data.meshes.new('grid')
    n = int(span / 0.1) + 1
    vs, es = [], []
    for i in range(n):
        c = -span / 2 + i * 0.1
        vs += [(c, -span / 2, obj_z), (c, span / 2, obj_z), (-span / 2, c, obj_z), (span / 2, c, obj_z)]
        es += [(len(vs) - 4, len(vs) - 3), (len(vs) - 2, len(vs) - 1)]
    me.from_pydata(vs, es, [])
    ob = bpy.data.objects.new('grid', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('w', 'WIREFRAME')
    mod.thickness = 0.004
    return ob


def _read(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return a


def _save(a, path):
    h, w = a.shape[:2]
    img = bpy.data.images.new('sheet', w, h, alpha=True)
    img.pixels.foreach_set(a.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def contact_sheet(key, rig, body, views, clips, cols=6, size=220, grid=None):
    """Rows: every clip x every view ((name, cam location, target, ortho scale)), `cols` frames
    across the clip. The first row is the rest pose with the weights in colour."""
    out = os.path.join(WORK, 'preview')
    tmpd = os.path.join(WORK, 'tmp')
    os.makedirs(out, exist_ok=True)
    os.makedirs(tmpd, exist_ok=True)
    _setup_render(size)
    sc = bpy.context.scene
    g = _grid(*grid) if grid else None
    cams = [_cam(n, l, t, o) for n, l, t, o in views]
    rig.hide_render = True
    rows = []

    def shot(cam, color):
        sc.display.shading.color_type = color
        sc.camera = cam
        p = os.path.join(tmpd, 'f.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        return _read(p)

    weight_colors(body)
    rig.animation_data.action = None
    sc.frame_set(0)
    row = [shot(c, 'VERTEX') for c in cams] + [shot(c, 'TEXTURE') for c in cams]
    rows.append(row[:cols] + [np.ones_like(row[0])] * (cols - len(row[:cols])))
    for name, dur, loop in clips:
        act = bpy.data.actions[name]
        rig.animation_data.action = act
        n = int(act.frame_range[1])
        frames = [round(i * n / (cols if loop else cols - 1)) for i in range(cols)]
        for cam in cams:
            r = []
            for f in frames:
                sc.frame_set(f)
                r.append(shot(cam, 'TEXTURE'))
            rows.append(r)
    rig.animation_data.action = None
    sc.frame_set(0)
    for c in cams:
        bpy.data.objects.remove(c)
    if g:
        bpy.data.objects.remove(g)
    # rows are bottom-up in Blender's pixel order: stack reversed so row 0 is at the top
    sheet = np.concatenate([np.concatenate(r, axis=1) for r in reversed(rows)], axis=0)
    # thin separators between the tiles
    for k in range(1, cols):
        sheet[:, k * size, :3] = 0.2
    for k in range(1, len(rows)):
        sheet[k * size, :, :3] = 0.2
    path = os.path.join(out, key + '.png')
    _save(sheet, path)
    return path


PALETTE = [(0.9, 0.2, 0.2), (0.2, 0.7, 0.2), (0.2, 0.3, 0.9), (0.9, 0.8, 0.1), (0.8, 0.2, 0.8),
           (0.1, 0.8, 0.8), (1.0, 0.5, 0.1), (0.5, 0.3, 0.1), (0.6, 0.6, 1.0), (0.4, 0.9, 0.5),
           (1.0, 0.6, 0.7), (0.3, 0.3, 0.3), (0.7, 1.0, 0.2), (0.2, 0.5, 0.5), (0.9, 0.9, 0.9),
           (0.5, 0.1, 0.4), (0.1, 0.2, 0.5), (0.6, 0.4, 0.0), (0.0, 0.6, 0.3), (0.8, 0.5, 0.5),
           (0.4, 0.6, 0.9), (0.9, 0.3, 0.5), (0.3, 0.8, 1.0), (0.7, 0.7, 0.3)]


def weight_colors(body):
    """A colour attribute blending the bone colours by weight (the weight check)."""
    me = body.data
    if 'wcol' in me.color_attributes:
        return
    col = [PALETTE[i % len(PALETTE)] for i in range(len(body.vertex_groups))]
    ca = me.color_attributes.new('wcol', 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        c = [0.0, 0.0, 0.0]
        for g in v.groups:
            k = col[g.group]
            c = [c[j] + k[j] * g.weight for j in range(3)]
        ca.data[v.index].color = (*c, 1.0)
    me.color_attributes.active_color = ca
    # keep the texture as the render / export colour
    me.color_attributes.render_color_index = me.color_attributes.find('wcol')


def drop_weight_colors(body):
    me = body.data
    if 'wcol' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['wcol'])


def markers(points, r):
    """Small red balls on the joints, for the check renders (removed by the caller)."""
    out = []
    for p in points:
        me = bpy.data.meshes.new('mk')
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        bm.to_mesh(me)
        bm.free()
        ca = me.color_attributes.new('wcol', 'FLOAT_COLOR', 'POINT')
        for d in ca.data:
            d.color = (1, 0, 0, 1)
        ob = bpy.data.objects.new('mk', me)
        ob.location = p
        ob.show_in_front = True
        bpy.context.scene.collection.objects.link(ob)
        out.append(ob)
    return out


def raw_views(key, obj, views, size=400, color='TEXTURE', suffix='_raw'):
    """Renders of the imported mesh, before any rig (orientation checks)."""
    out = os.path.join(WORK, 'preview')
    os.makedirs(out, exist_ok=True)
    _setup_render(size)
    sc = bpy.context.scene
    sc.display.shading.color_type = color
    tiles = []
    for n, l, t, o in views:
        cam = _cam(n, l, t, o)
        sc.camera = cam
        p = os.path.join(WORK, 'tmp', 'r.png')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        tiles.append(_read(p))
        bpy.data.objects.remove(cam)
    path = os.path.join(out, key + suffix + '.png')
    _save(np.concatenate(tiles, axis=1), path)
    return path
