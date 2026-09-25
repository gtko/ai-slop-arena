"""Rig test sheet (rig_blender.py --check): is every joint at the right place, does the mesh bend well?

  work/check/<key>_ortho.png    front and side, orthographic, 720 px each: a grid every 0.125 in z
                                (5% of the height) and 0.25 in x / y, the landmarks as coloured balls
  work/check/<key>_weights.png  the same two views coloured by bone weights (PALETTE)
  work/check/<key>_poses.png    head turned left / right, head down / up (close-ups); arms raised,
                                elbows bent forward, deep squat, torso twist + stride
"""
import os
import subprocess

import bpy
from mathutils import Vector

import clips
from clips import E3, Pose, X, q

S = 360   # pose tiles
BIG = 720  # orthographic views
PALETTE = {  # bone -> weight colour
    'Hips': (1, 0.55, 0), 'Spine': (1, 0.9, 0), 'Spine1': (0.7, 1, 0.1), 'Spine2': (0.2, 0.9, 0.3),
    'Neck': (0, 0.9, 0.9), 'Head': (0.2, 0.4, 1),
    'LeftShoulder': (0.6, 0.2, 0.9), 'LeftArm': (1, 0.3, 0.6), 'LeftForeArm': (1, 0.1, 0.1), 'LeftHand': (0.5, 0, 0),
    'RightShoulder': (0.35, 0.1, 0.6), 'RightArm': (1, 0.6, 0.8), 'RightForeArm': (0.9, 0.45, 0.2), 'RightHand': (0.45, 0.25, 0.1),
    'LeftUpLeg': (0, 0.55, 0), 'LeftLeg': (0.4, 0.8, 0.5), 'LeftFoot': (0, 0.3, 0.2),
    'RightUpLeg': (0.1, 0.3, 0.8), 'RightLeg': (0.5, 0.7, 1), 'RightFoot': (0.1, 0.15, 0.4),
}


def _mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    return m


def _add_grid(H):
    """Horizontal lines every 5% of the height with their z, in front of (front view) and beside
    (side view) the character; vertical lines every 0.25 in x / y."""
    col = bpy.data.collections.new('grid')
    bpy.context.scene.collection.children.link(col)
    line_m, text_m = _mat('grid', (0.45, 0.45, 0.5)), _mat('gridtext', (0.1, 0.1, 0.15))

    def box(loc, dims):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        o = bpy.context.object
        o.scale = dims
        o.data.materials.append(line_m)
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)

    def label(txt, loc, rot):
        cu = bpy.data.curves.new('t', 'FONT')
        cu.body = txt
        cu.size = 0.075
        o = bpy.data.objects.new('t', cu)
        o.location, o.rotation_euler = loc, rot
        o.data.materials.append(text_m)
        col.objects.link(o)

    k = 0
    while k * 0.125 <= H + 1e-6:
        z = k * 0.125
        w = 0.004 if k % 2 else 0.008
        box((0, -1.4, z), (2.6, w, w))       # front view lines
        box((1.4, 0, z), (w, 2.6, w))        # side view lines
        label(f'{z:.3f}', (-1.28, -1.45, z + 0.008), (1.5708, 0, 0))
        label(f'{z:.3f}', (1.45, 1.28, z + 0.008), (1.5708, 0, 1.5708))
        k += 1
    for k in range(-4, 5):
        v = k * 0.25
        box((v, -1.4, H / 2), (0.003, 0.003, H + 0.1))
        box((1.4, v, H / 2), (0.003, 0.003, H + 0.1))
        label(f'x{v:+.2f}', (v - 0.07, -1.45, -0.09), (1.5708, 0, 0))
        label(f'y{v:+.2f}', (1.45, v + 0.07, -0.09), (1.5708, 0, 1.5708))
    return col


def _add_markers(marks):
    col = bpy.data.collections.new('marks')
    bpy.context.scene.collection.children.link(col)
    for name, p in marks['joints'].items():
        rgb = PALETTE.get(name, (1, 1, 1))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.028, location=p, segments=12, ring_count=8)
        o = bpy.context.object
        o.data.materials.append(_mat('m_' + name, rgb))
        o.show_in_front = True
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)
    return col


def _weight_colors(body):
    me = body.data
    groups = {g.index: g.name for g in body.vertex_groups}
    attr = me.color_attributes.new('weights', 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        c = [0.0, 0.0, 0.0]
        for g in v.groups:
            rgb = PALETTE.get(groups[g.group], (1, 1, 1))
            for k in range(3):
                c[k] += rgb[k] * g.weight
        attr.data[v.index].color = (*c, 1)
    me.color_attributes.active_color = attr


def _camera(ortho, loc, target, scale=2.8, lens=50):
    cd = bpy.data.cameras.new('c')
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = scale
    else:
        cd.lens = lens
    cam = bpy.data.objects.new('c', cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    t = bpy.data.objects.new('t', None)
    t.location = target
    bpy.context.scene.collection.objects.link(t)
    cam.constraints.new('TRACK_TO').target = t
    bpy.context.scene.camera = cam
    return cam


def _render(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def _pose(C, rig, P):
    clips.apply(C, P)
    bpy.context.view_layer.update()


def sheet(d, rig, body, marks, out):
    os.makedirs(out, exist_ok=True)
    key, H = d['key'], d['height']
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = sc.render.resolution_y = S
    sc.render.image_settings.file_format = 'PNG'
    sc.render.film_transparent = False
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.42, 0.44, 0.5)
    sc.display.shading.background_type = 'WORLD'
    rig.hide_render = True
    C = clips.Char(d, rig)
    tmp = os.path.join(out, f'_{key}')
    os.makedirs(tmp, exist_ok=True)
    files = []

    def shot(name):
        p = os.path.join(tmp, name + '.png')
        _render(p)
        files.append(p)

    def tile(name, cols, size):
        png = os.path.join(out, f'{key}_{name}.png')
        ins = []
        for f in files:
            ins += ['-i', f]
        layout = '|'.join(f'{(k % cols) * size}_{(k // cols) * size}' for k in range(len(files)))
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *ins, '-filter_complex',
                        f'xstack=inputs={len(files)}:layout={layout}', png], check=True)
        files.clear()
        return png

    rest = Pose(C)
    _pose(C, rig, rest)
    grid, markers = _add_grid(H), _add_markers(marks)
    mid = (0, 0, H / 2)
    sc.render.resolution_x = sc.render.resolution_y = BIG
    _camera(True, (0, -6, H / 2), mid, scale=H * 1.12)
    shot('a_front')
    _camera(True, (6, 0, H / 2), mid, scale=H * 1.12)
    shot('b_side')
    ortho = tile('ortho', 2, BIG)
    # weights
    _weight_colors(body)
    sc.display.shading.color_type = 'VERTEX'
    _camera(True, (0, -6, H / 2), mid, scale=H * 1.12)
    shot('c_wfront')
    _camera(True, (6, 0, H / 2), mid, scale=H * 1.12)
    shot('d_wside')
    weights = tile('weights', 2, BIG)
    sc.display.shading.color_type = 'TEXTURE'
    grid.hide_render = markers.hide_render = True
    sc.render.resolution_x = sc.render.resolution_y = S

    head = marks['joints']['Head']
    top = marks['joints']['HeadTop']
    hc = (0, head.y, (head.z + top.z) / 2)
    hd = (top.z - head.z) * 3.2 + 0.8

    def head_pose(yaw=0.0, pitch=0.0):
        P = Pose(C)
        P.head(pitch, yaw)
        _pose(C, rig, P)

    for name, yaw, pitch in (('e_yawL', 1.0, 0), ('f_yawR', -1.0, 0), ('g_down', 0.4, 0.55), ('h_up', -0.3, -0.5)):
        head_pose(yaw, pitch)
        _camera(False, (0.25 * hd, -hd, hc[2] + 0.1 * hd), hc, lens=60)
        shot(name)

    body3q = ((2.9, -4.4, 2.0), (0, 0, 1.05))
    P = Pose(C)  # arms raised out to the sides, elbows a little bent
    for s, sg in (('L', 1), ('R', -1)):
        P.arm(s, C.arm_to(s, (sg * 0.8, -0.15, 0.58)))
        P.fore(s, -0.5)
    _pose(C, rig, P)
    _camera(False, (0.4, -5.2, 1.6), (0, 0, 1.15))
    shot('i_armsup')
    P = Pose(C)  # upper arms forward, elbows bent 90 degrees
    for s, sg in (('L', 1), ('R', -1)):
        P.arm(s, C.arm_to(s, (sg * 0.25, -0.9, -0.3)))
        P.fore(s, -1.5)
    _pose(C, rig, P)
    _camera(False, *body3q)
    shot('j_elbows')
    P = clips.crouch(C, 0, 0.3, 0.35)  # deep squat, feet planted
    _pose(C, rig, P)
    _camera(False, (4.6, -2.6, 1.4), (0, 0, 0.8))
    shot('k_squat')
    P = Pose(C)  # twist + side lean + a long stride
    P.spine(0.1, 0.6, 0.2)
    P.leg_fk('L', -0.9, 1.1, -0.2)
    P.leg_fk('R', 0.6, 0.4, 0.2)
    P.hips(0, -0.2, 0)
    _pose(C, rig, P)
    _camera(False, (4.6, -2.6, 1.4), (0, 0, 0.9))
    shot('l_twist')
    _pose(C, rig, Pose(C))

    poses = tile('poses', 4, S)
    return ', '.join((ortho, weights, poses))


# ------------------------------------------------------------------ collisions

GROUP = {'Head': 'head', 'Neck': 'head', 'Hips': 'torso', 'Spine': 'torso', 'Spine1': 'torso', 'Spine2': 'torso'}
for _side, _s in (('Left', 'L'), ('Right', 'R')):
    GROUP.update({_side + 'Shoulder': 'torso', _side + 'Arm': 'upper' + _s, _side + 'ForeArm': 'lower' + _s,
                  _side + 'Hand': 'lower' + _s, _side + 'UpLeg': 'leg' + _s, _side + 'Leg': 'leg' + _s,
                  _side + 'Foot': 'leg' + _s})
# what must never pass through what (upper arms against the torso is the armpit: allowed)
PAIRS = [(a + s, b) for s in 'LR' for a in ('lower', 'upper') for b in ('head',)] + \
        [('lower' + s, b) for s in 'LR' for b in ('torso', 'legL', 'legR')] + [('lowerL', 'lowerR')] + \
        [('weapon' + s, b) for s in 'LR' for b in ('head', 'torso', 'legL', 'legR', 'upperL', 'upperR', 'lowerL' if s == 'R' else 'lowerR')] + \
        [('weaponL', 'weaponR')]
THRESHOLD = 12  # new intersecting faces before a frame counts as a collision


def _face_groups(body):
    me = body.data
    names = {g.index: g.name for g in body.vertex_groups}
    dom = []
    for v in me.vertices:
        g = max(v.groups, key=lambda x: x.weight) if v.groups else None
        dom.append(GROUP.get(names[g.group]) if g else None)
    groups = {}
    for p in me.polygons:
        vs = [dom[v] for v in p.vertices]
        g = max(set(vs), key=vs.count)
        if g:
            groups.setdefault(g, []).append(tuple(p.vertices))
    return groups


def _hits(body, weapons, polys):
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    mw = body.matrix_world
    co = [mw @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    trees = {g: BVHTree.FromPolygons(co, ps) for g, ps in polys.items()}
    for w in weapons:
        wev = w.evaluated_get(dg)
        wco = [wev.matrix_world @ v.co for v in w.data.vertices]
        trees['weapon' + w.name[-1]] = BVHTree.FromPolygons(wco, [tuple(p.vertices) for p in w.data.polygons])
    out = {}
    for a, b in PAIRS:
        if a in trees and b in trees:
            out[(a, b)] = {i for i, _ in trees[a].overlap(trees[b])}
    return out


def collide(d, rig, body, weapons, out):
    """Every clip, every other frame: faces of forearms / hands / weapons inside the head, the torso,
    the legs or the other arm (and upper arms inside the head), not counting what already touches in
    the rest pose. Writes work/collide/<key>.json, prints one line per clip, and renders the worst frame
    of each colliding clip to work/collide/<key>.png (in the printed order)."""
    import json
    os.makedirs(out, exist_ok=True)
    key = d['key']
    sc = bpy.context.scene
    polys = _face_groups(body)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    rest = _hits(body, weapons, polys)
    report, worst = {}, []
    for act in [a for a in bpy.data.actions if a.use_fake_user]:
        rig.animation_data.action = act
        n = int(act.frame_range[1])
        best = (0, 0, {})
        for f in range(0, n + 1, 2):
            sc.frame_set(f)
            hits = _hits(body, weapons, polys)
            per = {f'{a}/{b}': len(v - rest.get((a, b), set())) for (a, b), v in hits.items()}
            per = {k: v for k, v in per.items() if v}
            total = sum(per.values())
            if total > best[0]:
                best = (total, f, per)
        report[act.name] = {'faces': best[0], 'frame': best[1], 'pairs': best[2]}
        if best[0] >= THRESHOLD:
            worst.append((act, best[1]))
    rest_n = {f'{a}/{b}': len(v) for (a, b), v in rest.items() if v}
    with open(os.path.join(out, key + '.json'), 'w') as f:
        json.dump({'rest_contacts': rest_n, 'clips': report}, f, indent=1)
    print(key, 'collisions (new faces at the worst frame, >=', THRESHOLD, 'is a problem):')
    for name, r in sorted(report.items(), key=lambda kv: -kv[1]['faces']):
        pairs = ', '.join(f'{k} {v}' for k, v in sorted(r['pairs'].items(), key=lambda kv: -kv[1]))
        print(f"  {name:9s} {r['faces']:5d}  frame {r['frame']:3d}  {pairs}")
    # the worst frames, rendered
    if worst:
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.light = 'STUDIO'
        sc.display.shading.color_type = 'TEXTURE'
        sc.render.resolution_x = sc.render.resolution_y = S
        sc.render.film_transparent = False
        if not sc.world:
            sc.world = bpy.data.worlds.new('w')
        sc.world.color = (0.42, 0.44, 0.5)
        sc.display.shading.background_type = 'WORLD'
        rig.hide_render = True
        _camera(False, (1.6, -4.8, 1.9), (0, 0, 1.1))
        tmp = os.path.join(out, f'_{key}')
        os.makedirs(tmp, exist_ok=True)
        files = []
        for i, (act, f) in enumerate(worst[:16]):
            rig.animation_data.action = act
            sc.frame_set(f)
            p = os.path.join(tmp, f'{i:02d}.png')
            _render(p)
            files.append(p)
        print('  worst frames rendered, in order:', ', '.join(f'{a.name}@{f}' for a, f in worst[:16]))
        ins = []
        for f in files:
            ins += ['-i', f]
        cols = min(4, len(files))
        layout = '|'.join(f'{(k % cols) * S}_{(k // cols) * S}' for k in range(len(files)))
        png = os.path.join(out, key + '.png')
        if len(files) == 1:
            import shutil
            shutil.copy(files[0], png)
        else:
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *ins, '-filter_complex',
                            f'xstack=inputs={len(files)}:layout={layout}', png], check=True)
    rig.animation_data.action = None
    return report
