"""Step 2 of the character rig: mesh + weights (export_rig.mjs) -> rigged, animated character.

  art-src/rig/work/<key>.json  ->  public/assets/models/<key>.glb     (game: skin + every clip)
                                   art-src/rigged/<key>.blend / .fbx  (for other tools)

Standard humanoid armature with Mixamo bone names (Hips, Spine, Spine1, Spine2, Neck, Head,
LeftShoulder, LeftArm, LeftForeArm, LeftHand, LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase and the
Right side), so the characters retarget in Blender, Unity, Unreal, Godot, Mixamo tools...
The clips themselves are written in clips.py.

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P art-src/rig/rig_blender.py -- [keys...] [--preview]
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

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

def build_mesh(d):
    """Weld the UV-seam duplicates (UVs live on the loops in Blender) and keep only used vertices."""
    P, U, idx = d['position'], d['uv'], d['index']
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

def joint_layout(d):
    """Head/tail of every bone (Blender coords) from the fitted joints."""
    J, H = d['joints'], d['height']
    L, R = J['L'], J['R']
    depth = -(L['thigh'][2] + R['thigh'][2]) / 2  # Blender y of the pelvis
    c = lambda z: Vector((0, depth, z))
    hips = J['crotch'] + 0.04 * H
    spine0 = J['crotch'] + 0.1 * H
    neck0 = J['neck'] - 0.035 * H
    s1 = spine0 + (neck0 - spine0) * 0.36
    s2 = spine0 + (neck0 - spine0) * 0.7
    bones = {
        'Hips': (c(hips), c(spine0), None),
        'Spine': (c(spine0), c(s1), 'Hips'),
        'Spine1': (c(s1), c(s2), 'Spine'),
        'Spine2': (c(s2), c(neck0), 'Spine1'),
        'Neck': (c(neck0), c(J['neck']), 'Spine2'),
        'Head': (c(J['neck']), c(H * 0.98), 'Neck'),
    }
    extra = {}
    for s, side in (('L', 'Left'), ('R', 'Right')):
        S = J[s]
        sh, el = to_b(S['arm']), to_b(S['fore'])
        up = el - sh
        wrist = el + up.normalized() * up.length * 0.8
        hand_end = wrist + up.normalized() * 0.07 * H
        inner = Vector((sh.x * 0.25, sh.y, J['shoulderY'] + 0.01 * H))
        th, kn = to_b(S['thigh']), to_b(S['shin'])
        ankle = Vector((kn.x, kn.y, 0.06 * H))
        toe = Vector((ankle.x, ankle.y - 0.07 * H, 0.015 * H))
        bones.update({
            side + 'Shoulder': (inner, sh, 'Spine2'),
            side + 'Arm': (sh, el, side + 'Shoulder'),
            side + 'ForeArm': (el, wrist, side + 'Arm'),
            side + 'Hand': (wrist, hand_end, side + 'ForeArm'),
            side + 'UpLeg': (th, kn, 'Hips'),
            side + 'Leg': (kn, ankle, side + 'UpLeg'),
            side + 'Foot': (ankle, toe, side + 'Leg'),
            side + 'ToeBase': (toe, toe + Vector((0, -0.04 * H, 0)), side + 'Foot'),
        })
        extra[s] = {'shoulder': sh, 'elbow': el, 'wrist': wrist, 'hand_end': hand_end, 'ankle_z': ankle.z}
    return bones, extra


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


def skin(d, obj, src, bones, extra):
    """The 12 fitted weights, spread over the finer humanoid chain along each chain's axis.
    On an empty hand's side, arm weights far from the arm itself (a cape, a sleeve of cloth hanging
    beside it) go mostly to the chest: raising that arm lifts the cloth like a wing instead of dragging it all."""
    J, H = d['joints'], d['height']
    armed = lambda s: d['weapon'] in ('both', s)
    names = d['bones']
    SI, SW, P = d['skinIndex'], d['skinWeight'], d['position']
    spine_cuts = [(bones['Spine'][1].z, 'Spine', 'Spine1'), (bones['Spine1'][1].z, 'Spine1', 'Spine2'),
                  (bones['Spine2'][1].z, 'Spine2', 'Neck'), (J['neck'], 'Neck', 'Head')]
    groups = {}
    for i, o in enumerate(src):
        p = to_b(P[o * 3:o * 3 + 3])
        w = {}
        add = lambda b, x: w.__setitem__(b, w.get(b, 0) + x)
        for j in range(4):
            bone, wt = names[SI[o * 4 + j]], SW[o * 4 + j]
            if wt < 1e-4:
                continue
            if bone in ('root', 'hips'):
                add('Hips', wt)
            elif bone in ('spine', 'head'):
                # chain Spine > Spine1 > Spine2 > Neck > Head by height, soft over +-2.5% of the height
                rest = wt
                for z, lo, hi in spine_cuts:
                    k = smooth(z - 0.025 * H, z + 0.025 * H, p.z)
                    add(lo, rest * (1 - k))
                    rest *= k
                add('Head', rest)
            else:
                s = bone[-1]
                side = 'Left' if s == 'L' else 'Right'
                E = extra[s]
                if bone.startswith('thigh'):
                    add(side + 'UpLeg', wt)
                elif bone.startswith('shin'):
                    k = smooth(E['ankle_z'] + 0.02 * H, E['ankle_z'] - 0.02 * H, p.z)
                    add(side + 'Leg', wt * (1 - k))
                    add(side + 'Foot', wt * k)
                else:
                    if not armed(s):
                        far = 0.7 * smooth(0.06 * H, 0.2 * H, min(
                            seg_dist(p, E['shoulder'], E['elbow']), seg_dist(p, E['elbow'], E['wrist']),
                            seg_dist(p, E['wrist'], E['hand_end'])))
                        add('Spine2', wt * far)
                        wt *= 1 - far
                    if bone.startswith('arm'):
                        add(side + 'Arm', wt)
                        continue
                    ax = (E['wrist'] - E['elbow'])
                    t = (p - E['elbow']).dot(ax.normalized())
                    k = smooth(ax.length - 0.03 * H, ax.length + 0.03 * H, t)
                    add(side + 'ForeArm', wt * (1 - k))
                    add(side + 'Hand', wt * k)
        for b, x in w.items():
            if x > 1e-3:
                groups.setdefault(b, {}).setdefault(round(x, 3), []).append(i)
    for b in bones:
        vg = obj.vertex_groups.new(name=b)
        for x, ids in groups.get(b, {}).items():
            vg.add(ids, x, 'REPLACE')
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)


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
    me, src = build_mesh(d)
    me.materials.append(build_material(d))
    body = bpy.data.objects.new(key, me)
    bpy.context.scene.collection.objects.link(body)
    bones, extra = joint_layout(d)
    rig = build_armature(d, bones)
    rig.name = key + '_rig'
    skin(d, body, src, bones, extra)
    body.parent = rig
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    return d, rig, body


def export(key, rig, body):
    os.makedirs(GAME, exist_ok=True)
    os.makedirs(RIGGED, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(GAME, key + '.glb'), export_format='GLB', use_selection=True,
        export_yup=True, export_skins=True, export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_optimize_animation_size=True, export_def_bones=False,
        export_image_format='AUTO', export_normals=True, export_apply=False, export_reset_pose_bones=True)
    bpy.ops.export_scene.fbx(
        filepath=os.path.join(RIGGED, key + '.fbx'), use_selection=True, object_types={'ARMATURE', 'MESH'},
        add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False,
        bake_anim_force_startend_keying=True, path_mode='COPY', embed_textures=True, armature_nodetype='NULL',
        axis_forward='-Z', axis_up='Y')
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(RIGGED, key + '.blend'), compress=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = '--preview' in argv
    keys = [a for a in argv if not a.startswith('--')] or KEYS
    for key in keys:
        d, rig, body = build(key)
        made = clips.make_all(d, rig)
        print(key, 'clips:', ', '.join(made))
        if preview:
            clips.preview(key, rig, body, os.path.join(HERE, 'work', 'preview'))
        export(key, rig, body)


if __name__ == '__main__':
    main()
