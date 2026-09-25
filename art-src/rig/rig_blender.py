"""Step 2 of the character rig: mesh + weights (export_rig.mjs) -> rigged, animated character.

  art-src/rig/work/<key>.json  ->  public/assets/models/<key>.glb     (game: skin + every clip)
                                   art-src/rigged/<key>.blend / .fbx  (for other tools)

Standard humanoid armature with Mixamo bone names (Hips, Spine, Spine1, Spine2, Neck, Head,
LeftShoulder, LeftArm, LeftForeArm, LeftHand, LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase and the
Right side), so the characters retarget in Blender, Unity, Unreal, Godot, Mixamo tools...
The clips themselves are written in clips.py.

Joints come from the automatic fit, corrected per character by art-src/rig/landmarks/<key>.json
(see load_marks).

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P art-src/rig/rig_blender.py -- [keys...]
         [--preview] [--check] [--collide] [--quick]   (--quick: no export; with --check alone, no clips either)
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clips  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
WORK = os.path.join(HERE, 'work')
GAME = os.path.join(ROOT, 'art-src', 'rig', 'out')  # then meshopt -> public/assets/models (build.mjs)
RIGGED = os.path.join(ROOT, 'art-src', 'rigged')
KEYS = ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt']


def to_b(v):
    """three.js (y up, faces +z) -> Blender (z up, faces -y)."""
    return Vector((v[0], -v[2], v[1]))


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0))) if e1 != e0 else float(x >= e0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ mesh

def build_mesh(d, idx):
    """Weld the UV-seam duplicates (UVs live on the loops in Blender) and keep only used vertices."""
    P, U = d['position'], d['uv']
    n = len(P) // 3
    weld, keys, first = [0] * n, {}, []
    for i in range(n):
        k = (round(P[i * 3] * 1e4), round(P[i * 3 + 1] * 1e4), round(P[i * 3 + 2] * 1e4))
        w = keys.get(k)
        if w is None:
            w = keys[k] = len(first)
            first.append(i)
        weld[i] = w
    used = sorted({weld[i] for i in idx})
    remap = {w: j for j, w in enumerate(used)}
    verts = [to_b(P[first[w] * 3:first[w] * 3 + 3]) for w in used]
    faces, uvs = [], []
    for f in range(0, len(idx), 3):
        tri = idx[f:f + 3]
        vs = [remap[weld[i]] for i in tri]
        if len(set(vs)) < 3:
            continue
        faces.append(vs)
        for i in tri:
            uvs.extend((U[i * 2], 1 - U[i * 2 + 1]))  # glTF v goes down
    me = bpy.data.meshes.new(d['key'])
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', uvs)
    me.polygons.foreach_set('use_smooth', [True] * len(faces))
    me.validate()
    src = [first[w] for w in used]  # original vertex (weights) of each Blender vertex
    return me, src


def build_material(d):
    mat = bpy.data.materials.new(d['key'])
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    img = bpy.data.images.load(os.path.join(WORK, d['texture']))
    img.pack()
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.6
    return mat


# ------------------------------------------------------------------ armature

MARKS = os.path.join(HERE, 'landmarks')
SIDES = (('L', 'Left', 1), ('R', 'Right', -1))

# bone -> (parent, joint at its tail). Every bone's head is the joint of the same name, so a
# landmark file only lists joints: bone names plus the three end points HeadTop, *HandEnd, *ToeEnd.
BONES = {
    'Hips': (None, 'Spine'), 'Spine': ('Hips', 'Spine1'), 'Spine1': ('Spine', 'Spine2'),
    'Spine2': ('Spine1', 'Neck'), 'Neck': ('Spine2', 'Head'), 'Head': ('Neck', 'HeadTop'),
}
for _s, _side, _ in SIDES:
    BONES.update({
        _side + 'Shoulder': ('Spine2', _side + 'Arm'), _side + 'Arm': (_side + 'Shoulder', _side + 'ForeArm'),
        _side + 'ForeArm': (_side + 'Arm', _side + 'Hand'), _side + 'Hand': (_side + 'ForeArm', _side + 'HandEnd'),
        _side + 'UpLeg': ('Hips', _side + 'Leg'), _side + 'Leg': (_side + 'UpLeg', _side + 'Foot'),
        _side + 'Foot': (_side + 'Leg', _side + 'ToeBase'), _side + 'ToeBase': (_side + 'Foot', _side + 'ToeEnd'),
    })

# Half-width of the soft blend where each bone takes over from its parent, as a fraction of the
# height (side-less names). Small = the joint bends sharply at the landmark, large = a rubbery joint.
BANDS = {'Spine': 0.03, 'Spine1': 0.03, 'Spine2': 0.03, 'Neck': 0.015, 'Head': 0.01,
         'Shoulder': 0.03, 'Arm': 0.025, 'ForeArm': 0.02, 'Hand': 0.015,
         'Hips': 0.02, 'UpLeg': 0.03, 'Leg': 0.02, 'Foot': 0.012}


def default_marks(d):
    """Joint positions from the automatic fit (autorig.mjs), before landmarks/<key>.json."""
    J, H = d['joints'], d['height']
    L, R = J['L'], J['R']
    depth = -(L['thigh'][2] + R['thigh'][2]) / 2  # Blender y of the pelvis
    c = lambda z: Vector((0, depth, z))
    spine0 = J['crotch'] + 0.1 * H
    neck0 = J['neck'] - 0.035 * H
    j = {
        'Hips': c(J['crotch'] + 0.04 * H), 'Spine': c(spine0),
        'Spine1': c(spine0 + (neck0 - spine0) * 0.36), 'Spine2': c(spine0 + (neck0 - spine0) * 0.7),
        'Neck': c(neck0), 'Head': c(J['neck']), 'HeadTop': c(H * 0.98),
    }
    for s, side, _ in SIDES:
        S = J[s]
        sh, el = to_b(S['arm']), to_b(S['fore'])
        up = el - sh
        wrist = el + up.normalized() * up.length * 0.8
        th, kn = to_b(S['thigh']), to_b(S['shin'])
        ankle = Vector((kn.x, kn.y, 0.06 * H))
        toe = Vector((ankle.x, ankle.y - 0.07 * H, 0.015 * H))
        j.update({
            side + 'Shoulder': Vector((sh.x * 0.25, sh.y, J['shoulderY'] + 0.01 * H)), side + 'Arm': sh,
            side + 'ForeArm': el, side + 'Hand': wrist, side + 'HandEnd': wrist + up.normalized() * 0.07 * H,
            side + 'UpLeg': th, side + 'Leg': kn, side + 'Foot': ankle, side + 'ToeBase': toe,
            side + 'ToeEnd': toe + Vector((0, -0.04 * H, 0)),
        })
    return {'joints': j, 'bands': dict(BANDS), 'head_tilt': 20.0, 'smooth': 2, 'cloth': True,
            'weapon_radius': 0.07, 'regions': [], 'weapons': {}, 'poses': {}, 'sway': []}


def load_marks(d):
    """Defaults overlaid with art-src/rig/landmarks/<key>.json:
      joints        {"LeftForeArm": [x, y, z], "Head": {"z": 1.3}, ...}   Blender coords, game units
      bands         {"Head": 0.008, ...}   blend half-widths, fractions of the height
      head_tilt     degrees: the neck/head boundary rises toward the back of the head (chin low, nape high)
      smooth        weight smoothing passes along the surface after the split (0 = crisp)
      cloth         on an empty hand's side, cloth hanging far from the arm stays on the chest
      weapon_radius on an armed side, forearm-part vertices farther than this from the arm (fraction of
                    the height) are the weapon: rigid on the hand
      regions       [{"sphere": [x, y, z], "radius": r} or {"box": [[x0, y0, z0], [x1, y1, z1]]},
                     + "part": "body" | "armL" | "armR" | "legL" | "legR"  (move those vertices to a part)
                     or "bone": "<Bone>"  (weight them fully to one bone)
                     or "bone": {"Spine2": 0.6, "LeftArm": 0.4}  (fixed shared weights)], in order
      weapons       {"R": {"add": [shapes], "remove": [shapes], "grip": {"rotate": [x, y, z] degrees,
                    "offset": [x, y, z]}}}: the weapon in that hand becomes its own object, parented
                    to the hand bone. It starts as the vertices pinned to the hand (weapon_radius, or a
                    region with "bone": "<Side>Hand"), plus / minus the shapes; the grip turns it about
                    the wrist and shifts it, in the rest pose.
      poses         per-character adjustments of the clips (clips.py, POSE_DEFAULTS)
      sway          [{"box" | "sphere": ..., "axis": [x, y, z], "from": d, "length": L, "amp": a}]
                    or {..., "root": [x, y, z], "from": d, "length": L}: the soft parts (leaves,
                    gills, cape, hair, antenna). Inside the shape, a vertex sways by
                    amp * smoothstep((p . axis - from) / length), or by its distance from root:
                    0 where it's attached, 1 at the tips. The game's shader moves them with the
                    wind and the brawler's motion (src/figurines.js); also the "Sway" vertex group.
    The resolved set is written to work/<key>_landmarks.json (a starting point to copy)."""
    m = default_marks(d)
    path = os.path.join(MARKS, d['key'] + '.json')
    if os.path.exists(path):
        with open(path) as f:
            over = json.load(f)
        for name, v in over.get('joints', {}).items():
            if name not in m['joints']:
                raise KeyError(f'{path}: unknown joint {name}')
            if isinstance(v, dict):
                for ax, val in v.items():
                    setattr(m['joints'][name], ax, val)
            else:
                m['joints'][name] = Vector(v)
        m['bands'].update(over.get('bands', {}))
        for k in ('head_tilt', 'smooth', 'cloth', 'weapon_radius', 'regions', 'weapons', 'poses', 'sway'):
            if k in over:
                m[k] = over[k]
    out = {**m, 'joints': {k: [round(c, 4) for c in v] for k, v in m['joints'].items()}}
    with open(os.path.join(WORK, d['key'] + '_landmarks.json'), 'w') as f:
        json.dump(out, f, indent=1)
    return m


def joint_layout(m):
    J = m['joints']
    return {name: (J[name], J[tail], parent) for name, (parent, tail) in BONES.items()}


def build_armature(d, bones):
    arm = bpy.data.armatures.new(d['key'] + '_rig')
    obj = bpy.data.objects.new('Armature', arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, (h, t, parent) in bones.items():
        b = arm.edit_bones.new(name)
        b.head, b.tail = h, t
        b.roll = 0
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        b.use_deform = not name.endswith('ToeBase')
        eb[name] = b
    # local X = the side axis on every bone, so knees, elbows and spine bend about X
    for b in arm.edit_bones:
        b.align_roll(Vector((0, 0, 1)) if 'Foot' in b.name or 'Toe' in b.name else Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.display_type = 'STICK'
    obj.show_in_front = True
    return obj


# ------------------------------------------------------------------ weights

def seg_dist(p, a, b):
    ab = b - a
    t = min(1.0, max(0.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


class Chain:
    """Bones along a polyline of joints: a vertex is placed by its nearest point on the polyline
    (arc length s), and each joint hands over to the next bone within +-band of it."""

    def __init__(self, pts, bones, bands):
        self.pts, self.bones, self.bands = pts, bones, bands
        self.cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.cum.append(self.cum[-1] + (b - a).length)

    def locate(self, p):
        best = (1e9, 0.0)
        for i, (a, b) in enumerate(zip(self.pts, self.pts[1:])):
            ab = b - a
            t = min(1.0, max(0.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
            dist = (p - (a + ab * t)).length
            if dist < best[0]:
                best = (dist, self.cum[i] + t * ab.length)
        return best  # (distance to the chain, arc length)

    def weights(self, s):
        out, carry = {}, 1.0
        for i, bone in enumerate(self.bones):
            if i + 1 < len(self.bones):
                b, bw = self.cum[i + 1], self.bands[i + 1]
                u = smooth(b - bw, b + bw, s)
            else:
                u = 0.0
            out[bone] = out.get(bone, 0.0) + carry * (1 - u)
            carry *= u
        return out


def in_shape(r, p):
    if 'sphere' in r:
        return (p - Vector(r['sphere'])).length <= r['radius']
    lo, hi = r['box']
    return all(lo[k] <= p[k] <= hi[k] for k in range(3))


PART_OF = {'root': 'body', 'hips': 'body', 'spine': 'body', 'head': 'body'}
for _s in 'LR':
    PART_OF.update({'thigh' + _s: 'leg' + _s, 'shin' + _s: 'leg' + _s, 'arm' + _s: 'arm' + _s, 'fore' + _s: 'arm' + _s})


def classify(d, m):
    """Part of every vertex (body / armL / armR / legL / legR) after the landmark regions, and the
    bone a region pins it to (or None)."""
    names, P, parts = d['bones'], d['position'], d['part']
    part, rigid = [], []
    for o in range(len(parts)):
        p = to_b(P[o * 3:o * 3 + 3])
        pt, rb = PART_OF[names[parts[o]]], None
        for r in m['regions']:
            if in_shape(r, p):
                if 'bone' in r:
                    rb = r['bone']
                else:
                    pt = r['part']
        part.append(pt)
        rigid.append(rb)
    return part, rigid


def stitched(d, part, rigid):
    """The mesh's faces: the cut autorig.mjs made between parts, minus the faces whose three corners
    the regions put back in one part (or pin to one bone): no crack left inside a fireball or a robe."""
    idx, cut, back = list(d['index']), d.get('cut', []), 0
    for f in range(0, len(cut), 3):
        a, b, c = cut[f:f + 3]
        if (part[a] == part[b] == part[c]) or (rigid[a] and rigid[a] == rigid[b] == rigid[c]):
            idx.extend((a, b, c))
            back += 1
    print(d['key'], f'cut faces: {len(cut) // 3 - back} kept open, {back} stitched back')
    return idx


def skin(d, obj, src, m, part_of_vertex, rigid_of_vertex):
    """Weights from the body parts found by autorig.mjs (which already cut the arms and legs free),
    each part split along its own chain of landmarks: the torso and head by height (the head boundary
    tilted up toward the nape, so the whole face turns with the head), legs and arms by where the
    vertex sits along hip-knee-ankle-toe / shoulder-elbow-wrist-hand."""
    H = d['height']
    J, B = m['joints'], m['bands']
    bw = lambda name: B[name.replace('Left', '').replace('Right', '')] * H
    P = d['position']
    tilt = math.tan(math.radians(m['head_tilt']))
    torso = [('Spine', 'Hips'), ('Spine1', 'Spine'), ('Spine2', 'Spine1'), ('Neck', 'Spine2'), ('Head', 'Neck')]
    limbs = {}
    for s, side, _ in SIDES:
        hip = J[side + 'UpLeg']
        limbs['leg' + s] = Chain(
            [hip + Vector((0, 0, 0.1 * H)), hip, J[side + 'Leg'], J[side + 'Foot'], J[side + 'ToeEnd']],
            ['Hips', side + 'UpLeg', side + 'Leg', side + 'Foot'],
            [0, bw('UpLeg'), bw('Leg'), bw('Foot')])
        limbs['arm' + s] = Chain(
            [J[side + 'Shoulder'], J[side + 'Arm'], J[side + 'ForeArm'], J[side + 'Hand'], J[side + 'HandEnd']],
            [side + 'Shoulder', side + 'Arm', side + 'ForeArm', side + 'Hand'],
            [0, bw('Arm'), bw('ForeArm'), bw('Hand')])
    armed = lambda s: d['weapon'] in ('both', s)
    groups = {}
    wside = [None] * len(src)  # the hand whose weapon this vertex belongs to
    for i, o in enumerate(src):
        p = to_b(P[o * 3:o * 3 + 3])
        part, rigid = part_of_vertex[o], rigid_of_vertex[o]
        if isinstance(rigid, dict):  # shared between bones, e.g. a mantle half on the arm
            w = dict(rigid)
        elif rigid:
            w = {rigid: 1.0}
            if rigid in ('LeftHand', 'RightHand'):
                wside[i] = rigid[0]
        elif part == 'body':
            w, carry = {}, 1.0
            for bone, below in torso:
                z = p.z - tilt * (p.y - J['Head'].y) if bone == 'Head' else p.z
                u = smooth(J[bone].z - bw(bone), J[bone].z + bw(bone), z)
                w[below] = w.get(below, 0.0) + carry * (1 - u)
                carry *= u
            w['Head'] = w.get('Head', 0.0) + carry
        else:
            s = part[-1]
            side = 'Left' if s == 'L' else 'Right'
            ch = limbs[part]
            dist, arc = ch.locate(p)
            if part.startswith('arm') and armed(s) and dist > m['weapon_radius'] * H \
                    and arc > ch.cum[2]:  # the weapon, past the elbow: rigid on the hand
                w = {side + 'Hand': 1.0}
                wside[i] = s
            else:
                w = ch.weights(arc)
                if part.startswith('arm') and not armed(s) and m['cloth']:
                    far = 0.7 * smooth(0.06 * H, 0.2 * H, dist)  # a cape beside the arm stays mostly on the chest
                    w = {b: x * (1 - far) for b, x in w.items()}
                    w['Spine2'] = w.get('Spine2', 0.0) + far
        for b, x in w.items():
            if x > 1e-3:
                groups.setdefault(b, {}).setdefault(round(x, 3), []).append(i)
    for b in BONES:
        vg = obj.vertex_groups.new(name=b)
        for x, ids in groups.get(b, {}).items():
            vg.add(ids, x, 'REPLACE')
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    if m['smooth']:
        bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=int(m['smooth']))
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for s, spec in m['weapons'].items():
        for i, o in enumerate(src):
            p = to_b(P[o * 3:o * 3 + 3])
            if any(in_shape(r, p) for r in spec.get('add', [])):
                wside[i] = s
            if wside[i] == s and any(in_shape(r, p) for r in spec.get('remove', [])):
                wside[i] = None
    return wside


def split_weapons(d, body, rig, m, wside):
    """Each weapon becomes its own mesh, parented to its hand bone (rigid, and free to be placed or
    swapped): the faces whose corners all belong to it leave the body."""
    out = []
    me = body.data
    # kept as a mesh attribute: separating a weapon renumbers the body's vertices
    attr = me.attributes.new('weapon_side', 'INT', 'POINT')
    attr.data.foreach_set('value', [{'L': 1, 'R': 2}.get(w, 0) for w in wside])
    for s, side, _ in SIDES:
        code = 1 if s == 'L' else 2
        sel = [a.value == code for a in me.attributes['weapon_side'].data]
        faces = [all(sel[v] for v in p.vertices) for p in me.polygons]
        if sum(faces) < 20:
            continue
        me.vertices.foreach_set('select', sel)
        me.edges.foreach_set('select', [sel[e.vertices[0]] and sel[e.vertices[1]] for e in me.edges])
        me.polygons.foreach_set('select', faces)
        for o in bpy.context.view_layer.objects:
            o.select_set(o == body)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        wpn = next(o for o in bpy.context.selected_objects if o != body)
        wpn.name = wpn.data.name = f"{d['key']}_weapon_{s}"
        wpn.vertex_groups.clear()
        wpn.modifiers.clear()
        # grip: turn about the wrist and shift, then put the object's origin on the wrist
        wrist = m['joints'][side + 'Hand']
        g = m['weapons'].get(s, {}).get('grip', {})
        rot = Euler([math.radians(a) for a in g.get('rotate', (0, 0, 0))]).to_matrix().to_4x4()
        pivot = wrist + Vector(g.get('offset', (0, 0, 0)))
        wpn.data.transform(Matrix.Translation(pivot) @ rot @ Matrix.Translation(-wrist))
        wpn.data.transform(Matrix.Translation(-pivot))
        wpn.parent = None
        wpn.matrix_world = Matrix.Translation(pivot)
        bpy.context.view_layer.update()
        mw = wpn.matrix_world.copy()
        # its own bone under the hand: clips can move the weapon (put it away at the hip)
        centre = sum((v.co for v in wpn.data.vertices), Vector()) / len(wpn.data.vertices)
        for o in bpy.context.view_layer.objects:
            o.select_set(o == rig)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode='EDIT')
        eb = rig.data.edit_bones.new(side + 'Weapon')
        eb.head = pivot
        eb.tail = pivot + (centre.normalized() if centre.length > 1e-4 else Vector((0, 0, 1))) * 0.2
        eb.parent = rig.data.edit_bones[side + 'Hand']
        eb.use_deform = False
        eb.align_roll(Vector((0, -1, 0)))
        bpy.ops.object.mode_set(mode='OBJECT')
        wpn.parent = rig
        wpn.parent_type = 'BONE'
        wpn.parent_bone = side + 'Weapon'
        bpy.context.view_layer.update()
        wpn.matrix_world = mw
        if 'weapon_side' in wpn.data.attributes:
            wpn.data.attributes.remove(wpn.data.attributes['weapon_side'])
        out.append(wpn)
    me.attributes.remove(me.attributes['weapon_side'])
    return out


def _spread(pts, n):
    """n points spread over a point set (farthest-point sampling)."""
    if len(pts) <= n:
        return [list(p) for p in pts]
    out = [pts[0]]
    dist = [(p - pts[0]).length for p in pts]
    while len(out) < n:
        i = max(range(len(pts)), key=dist.__getitem__)
        out.append(pts[i])
        dist = [min(dist[k], (pts[k] - pts[i]).length) for k in range(len(pts))]
    return [list(p) for p in out]


def sway(body, m):
    """Per-vertex softness (0 rigid .. 1 free tip) from the landmark "sway" shapes, as the mesh
    attribute "_sway" (exported to the GLB) and a "Sway" vertex group (for cloth / jiggle setups)."""
    me = body.data
    w = [0.0] * len(me.vertices)
    for spec in m['sway']:
        amp = spec.get('amp', 1.0)
        axis = Vector(spec['axis']).normalized() if 'axis' in spec else None
        root = Vector(spec['root']) if 'root' in spec else None
        for v in me.vertices:
            p = v.co
            if not in_shape(spec, p):
                continue
            d = p.dot(axis) if axis is not None else (p - root).length
            k = amp * smooth(0.0, 1.0, (d - spec.get('from', 0.0)) / spec['length'])
            w[v.index] = max(w[v.index], k)
    if not any(w):
        return 0
    attr = me.attributes.new('_sway', 'FLOAT', 'POINT')
    attr.data.foreach_set('value', w)
    return sum(1 for x in w if x > 1e-3)


def sway_group(body):
    """The softness as a "Sway" vertex group too (added last: it isn't a bone)."""
    me = body.data
    if '_sway' not in me.attributes or 'Sway' in body.vertex_groups:
        return
    vg = body.vertex_groups.new(name='Sway')
    for i, a in enumerate(me.attributes['_sway'].data):
        if a.value > 1e-3:
            vg.add([i], a.value, 'REPLACE')


def measure(body, weapons):
    """Rest-pose volumes the clips keep the arms out of: the head (box), the torso (box), the legs'
    thickness, and surface samples of each arm piece (upper arm with its pad, forearm, fist) and
    weapon, in the armature frame, for the clearance checks."""
    me = body.data
    names = {g.index: g.name for g in body.vertex_groups}
    pts = {'head': [], 'torso': []}
    for v in me.vertices:
        if not v.groups:
            continue
        g = max(v.groups, key=lambda x: x.weight)
        name = names[g.group]
        if name == 'Head':
            pts['head'].append(v.co)
        elif name in ('Hips', 'Spine', 'Spine1', 'Spine2'):
            pts['torso'].append(v.co)
    box = lambda ps: [[min(p[k] for p in ps) for k in range(3)], [max(p[k] for p in ps) for k in range(3)]]
    out = {k: box(v) for k, v in pts.items() if v}
    pieces = {}
    for v in me.vertices:
        if v.groups:
            name = names[max(v.groups, key=lambda x: x.weight).group]
            if name.endswith(('Shoulder', 'Arm', 'ForeArm', 'Hand')):
                pieces.setdefault(name, []).append(v.co.copy())
    out['samples'] = {name: _spread(ps[::max(1, len(ps) // 600)], 16) for name, ps in pieces.items()}
    # leg thickness: median distance of the thigh / shin vertices to their bone
    arm = body.parent.data.bones if body.parent else None
    dists = []
    if arm:
        for v in me.vertices:
            if not v.groups:
                continue
            name = names[max(v.groups, key=lambda x: x.weight).group]
            if name.endswith('UpLeg') or name.endswith('Leg'):
                bn = arm[name]
                dists.append(seg_dist(v.co, bn.head_local, bn.tail_local))
    out['leg_radius'] = sorted(dists)[len(dists) // 2] if dists else 0.1
    # the belt: outermost pelvis / waist surface on each side, where a put-away weapon hangs
    out['belt'] = {}
    if arm:
        hz = arm['Hips'].head_local.z
        for s_, sg in (('L', 1), ('R', -1)):
            best = None
            for v in me.vertices:
                if not v.groups or abs(v.co.z - (hz + 0.06)) > 0.06 or abs(v.co.y - arm['Hips'].head_local.y) > 0.2:
                    continue
                name = names[max(v.groups, key=lambda x: x.weight).group]
                if name in ('Hips', 'Spine') and (best is None or sg * v.co.x > sg * best.x):
                    best = v.co.copy()
            if best is not None:
                out['belt'][s_] = list(best)
    out['weapon'] = {}
    for w in weapons:
        vs = [w.matrix_world @ v.co for v in w.data.vertices]
        out['weapon'][w.name[-1]] = box(vs)
        out['samples']['weapon' + w.name[-1]] = _spread(vs[::max(1, len(vs) // 800)], 24)
    return out



# ------------------------------------------------------------------ main

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = clips.FPS
    sc.unit_settings.system = 'METRIC'


def build(key):
    reset()
    with open(os.path.join(WORK, key + '.json')) as f:
        d = json.load(f)
    marks = load_marks(d)
    part, rigid = classify(d, marks)
    me, src = build_mesh(d, stitched(d, part, rigid))
    me.materials.append(build_material(d))
    body = bpy.data.objects.new(key, me)
    bpy.context.scene.collection.objects.link(body)
    rig = build_armature(d, joint_layout(marks))
    rig.name = key + '_rig'
    wside = skin(d, body, src, marks, part, rigid)
    weapons = split_weapons(d, body, rig, marks, wside)
    body.parent = rig  # (before measure: it reads the bones)
    print(key, 'soft vertices:', sway(body, marks))
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    d['measure'] = measure(body, weapons)
    d['poses'] = marks['poses']
    return d, rig, body, marks, weapons


def export(key, rig, body, weapons):
    os.makedirs(GAME, exist_ok=True)
    os.makedirs(RIGGED, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    body.select_set(True)
    for w in weapons:
        w.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(GAME, key + '.glb'), export_format='GLB', use_selection=True,
        export_yup=True, export_skins=True, export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_optimize_animation_size=True, export_def_bones=False,
        export_image_format='AUTO', export_normals=True, export_apply=False, export_reset_pose_bones=True,
        export_attributes=True)  # _sway
    sway_group(body)
    bpy.ops.export_scene.fbx(
        filepath=os.path.join(RIGGED, key + '.fbx'), use_selection=True, object_types={'ARMATURE', 'MESH'},
        add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False,
        bake_anim_force_startend_keying=True, path_mode='COPY', embed_textures=True, armature_nodetype='NULL',
        axis_forward='-Z', axis_up='Y')
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(RIGGED, key + '.blend'), compress=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview, check, quick, collide = '--preview' in argv, '--check' in argv, '--quick' in argv, '--collide' in argv
    keys = [a for a in argv if not a.startswith('--')] or KEYS
    for key in keys:
        d, rig, body, marks, weapons = build(key)
        print(key, 'weapons:', ', '.join(f'{w.name} ({len(w.data.polygons)} faces)' for w in weapons) or 'none')
        if '--sway' in argv:  # the soft parts, coloured: work/check/<key>_sway.png
            import rig_check
            print(key, 'sway sheet:', rig_check.sway_sheet(d, rig, body, marks, os.path.join(WORK, 'check')))
        if check:  # the rig test sheet: work/check/<key>_*.png
            import rig_check
            print(key, 'check sheet:', rig_check.sheet(d, rig, body, marks, os.path.join(WORK, 'check')))
        if quick and not collide:  # --check --quick: the sheet only, no clips, no export
            continue
        made = clips.make_all(d, rig)
        print(key, 'clips:', ', '.join(made))
        if collide:  # arms / weapons through the head or body, per clip: work/collide/<key>.*
            import rig_check
            rig_check.collide(d, rig, body, weapons, os.path.join(WORK, 'collide'))
        if preview:
            clips.preview(key, rig, body, os.path.join(HERE, 'work', 'preview'))
        if not quick:
            export(key, rig, body, weapons)


if __name__ == '__main__':
    main()
