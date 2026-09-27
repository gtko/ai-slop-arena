"""Fauna body plan "flyer": raw Hunyuan GLB -> rigged, animated bird in flight (art-src/fauna/README.md).

  <raw>/<key>.glb -> art-src/fauna/out/<key>.glb -> public/assets/models/fauna/<key>.glb

The reference art shows the bird from the front, upright, wings spread flat like a T. It is pitched
forward to fly (body along -y, belly down, wings along x), its head lifted back up so it looks where it
flies (baked in the rest pose), scaled to the wingspan and centred on the body (it lives in the air).

Rig: root > body > neck > head, body > tail, and per wing arm > forearm > hand (the primaries), so the
wing folds on the upstroke and the tips lag and curl through the downstroke. Joints are found on the
mesh and can be corrected in art-src/fauna/landmarks/<key>.json:
  {"rotate": [x, y, z] degrees before anything, "pitch": 90, "head_lift": 50,
   "wing_flat": false (a model whose body is already about level but whose wings stand up, like a
                 perched bird: each wing is turned about the shoulder in the rest pose so its span runs
                 along x, its plane is horizontal and its leading edge faces forward),
   "joints": {"shoulder": [x, y, z], "elbow": ..., "wrist": ..., "tip": ... (left side, mirrored),
              "tailtip", "tailbase", "chest", "neckbase", "headbase", "beak", ...: [x, y, z] or {"z": ..}},
   "flap": {"period": s, "amp": degrees}}
Clips: Fly (flap loop), Glide (loop), Bank (once).

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P art-src/fauna/rig_flyer.py -- [keys] [--preview] [--check]
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fl_common as C  # noqa: E402
from fl_common import I, TAU, X, Y, Z, q, smooth, env, ease  # noqa: E402

SPAN = {'vulture': 2.2, 'raven': 1.2}
PERIOD = {'vulture': 1.0, 'raven': 0.8}
MAX_TRIS = 5800
SIDES = (('L', 1), ('R', -1))


# ------------------------------------------------------------------ orientation and joints

def orient(obj, key, marks):
    if 'rotate' in marks:
        C.transform(obj, C.euler_deg(marks['rotate']))
    V = C.verts(obj)
    if np.ptp(V[:, 1]) > np.ptp(V[:, 0]):  # wings must run along x
        C.transform(obj, Matrix.Rotation(math.pi / 2, 4, 'Z'))
    # upright, facing -y -> flying: the top of the head goes forward (-y), the belly down
    C.transform(obj, Matrix.Rotation(math.radians(marks.get('pitch', 90)), 4, 'X'))
    V = C.verts(obj)
    C.transform(obj, Matrix.Scale(SPAN.get(key, 1.0) / np.ptp(V[:, 0]), 4))
    V = C.verts(obj)
    span = np.ptp(V[:, 0])
    body = V[np.abs(V[:, 0] - np.median(V[:, 0])) < 0.12 * span]
    c = Vector(((body[:, 0].min() + body[:, 0].max()) / 2, np.median(body[:, 1]),
                (body[:, 2].min() + body[:, 2].max()) / 2))
    C.transform(obj, Matrix.Translation(-c))


def joints(obj, marks):
    V = C.verts(obj)
    span = np.ptp(V[:, 0])
    half = V[:, 0].max()
    # wings flat (chord along y, thin along z), or still standing up in the model (wing_flat: chord
    # along z, thin along y; they are laid flat later by turning the arms in the rest pose)
    up = bool(marks.get('wing_flat', False))
    thin, chord = (1, 2) if up else (2, 1)
    # the shoulder: where the thick body gives way to the thin wing
    th0 = np.ptp(V[np.abs(V[:, 0]) < 0.04 * span, thin])
    xs = 0.3 * half
    for x in np.linspace(0.05 * span, 0.4 * half, 40):
        band = V[np.abs(np.abs(V[:, 0]) - x) < 0.01 * span]
        if len(band) and np.ptp(band[:, thin]) < 0.45 * th0:
            xs = x
            break

    def wing_pt(x):
        band = V[(np.abs(np.abs(V[:, 0]) - x) < 0.02 * span) & (V[:, 0] > 0)]
        c = band[:, chord]
        lead, trail = (c.max(), c.min()) if up else (c.min(), c.max())  # leading edge: top / front
        p = [x, 0.0, 0.0]
        p[chord] = lead + 0.3 * (trail - lead)
        p[thin] = float(np.median(band[:, thin]))
        return Vector(p)

    tipx = half * 0.97
    J = {'shoulder': wing_pt(xs * 0.95), 'elbow': wing_pt(xs + 0.3 * (tipx - xs)),
         'wrist': wing_pt(xs + 0.58 * (tipx - xs)), 'tip': wing_pt(tipx)}
    J['shoulder'].x = xs * 0.55
    body = V[np.abs(V[:, 0]) < 0.8 * xs]
    y0, y1 = body[:, 1].min(), body[:, 1].max()
    Lb = y1 - y0

    def cpt(y):
        sl = body[np.abs(body[:, 1] - y) < 0.03 * Lb]
        return Vector((0.0, y, (sl[:, 2].min() + sl[:, 2].max()) / 2 if len(sl) else 0.0))

    J['beak'] = cpt(y0 + 0.03 * Lb)
    J['beak'].y = y0
    J['headbase'] = cpt(y0 + 0.3 * Lb)
    J['neckbase'] = cpt(y0 + 0.4 * Lb)
    J['chest'] = cpt(y0 + 0.5 * Lb)
    J['tailbase'] = cpt(y0 + 0.7 * Lb)
    J['tailtip'] = cpt(y1 - 0.03 * Lb)
    J['tailtip'].y = y1
    for n, v in marks.get('joints', {}).items():
        if n not in J:
            raise KeyError(f'landmarks: unknown joint {n} ({", ".join(sorted(J))})')
        if isinstance(v, dict):
            for a, val in v.items():
                setattr(J[n], a, val)
        else:
            J[n] = Vector(v)
    return J, span, Lb, xs


def mirror(v, sg):
    return Vector((v.x * sg, v.y, v.z))


def layout(J, span):
    B = {'root': (Vector(), Vector((0, -0.05 * span, 0)), None),
         'body': (J['chest'], J['neckbase'], 'root'),
         'neck': (J['neckbase'], J['headbase'], 'body'),
         'head': (J['headbase'], J['beak'], 'neck'),
         'tail': (J['tailbase'], J['tailtip'], 'body')}
    for s, sg in SIDES:
        B['arm.' + s] = (mirror(J['shoulder'], sg), mirror(J['elbow'], sg), 'body')
        B['forearm.' + s] = (mirror(J['elbow'], sg), mirror(J['wrist'], sg), 'arm.' + s)
        B['hand.' + s] = (mirror(J['wrist'], sg), mirror(J['tip'], sg), 'forearm.' + s)
    return B


def weights(obj, J, span, Lb, xs):
    V = C.verts(obj)
    trunk = C.Chain([J['tailtip'], J['tailbase'], J['neckbase'], J['headbase'], J['beak']],
                    ['tail', 'body', 'neck', 'head'], [0, 0.08 * Lb, 0.06 * Lb, 0.05 * Lb])
    wings = {}
    for s, sg in SIDES:
        pts = [Vector((0, J['shoulder'].y, J['shoulder'].z))] + [mirror(J[n], sg) for n in ('shoulder', 'elbow', 'wrist', 'tip')]
        wings[sg] = C.Chain(pts, ['body', 'arm.' + s, 'forearm.' + s, 'hand.' + s],
                            [0, 0.04 * span, 0.05 * span, 0.06 * span])
    band = 0.25 * xs
    W = []
    for p in V:
        p = Vector(p)
        om = smooth(xs - band, xs + band, abs(p.x))  # how much of the vertex is wing
        w = {}
        if om < 1:
            for b, x in trunk.weights(trunk.locate(p)[1]).items():
                w[b] = w.get(b, 0) + x * (1 - om)
        if om > 0:
            ch = wings[1 if p.x > 0 else -1]
            for b, x in ch.weights(ch.locate(p)[1]).items():
                w[b] = w.get(b, 0) + x * om
        W.append(w)
    return W


def flatten(V, J, sg, xs):
    """The rotation laying one standing wing flat: its span (shoulder -> tip) onto the x axis, the
    plane of its vertices (least-variance normal) horizontal, the leading edge (top) forward."""
    W = V[V[:, 0] * sg > 1.3 * xs]
    c = W - W.mean(axis=0)
    n = Vector(np.linalg.eigh(c.T @ c)[1][:, 0])  # the wing plate's normal
    span = mirror(J['tip'], sg) - mirror(J['shoulder'], sg)
    chord = n.cross(span).normalized()
    if chord.z > 0:
        chord = -chord  # from the leading (top) edge toward the trailing edge
    return C.frame_rot(span, chord, Vector((sg, 0, 0)), Vector((0, 1, 0)))


def bake_rest(obj, rig, P, fk):
    """Pose the rig (head lifted) and make that the rest pose of both the mesh and the armature."""
    last = {}
    C.select_only(rig)
    rig.animation_data_create()
    act = bpy.data.actions.new('tmp')
    rig.animation_data.action = act
    C.key_pose(rig, fk, P, 0, last)
    bpy.context.scene.frame_set(0)
    rig.animation_data.action = None
    bpy.data.actions.remove(act)
    C.select_only(obj)
    bpy.ops.object.modifier_apply(modifier='Armature')
    C.select_only(rig)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_quaternion = I
        pb.location = Vector()
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


# ------------------------------------------------------------------ clips

class Flyer:
    def __init__(self, key, rig, span, marks):
        self.fk = C.FK(rig)
        self.span = span
        f = marks.get('flap', {})
        self.period = f.get('period', PERIOD.get(key, 0.9))
        self.amp = math.radians(f.get('amp', 42))

    def wing(self, P, s, raise_, sweep=0.0, twist=0.0, fore=(0.0, 0.0), hand=(0.0, 0.0, 0.0)):
        """raise_: up (rad) at the shoulder; sweep: back; twist: leading edge down.
        fore = (raise, sweep back) at the elbow, hand = (raise, sweep back, curl down twist)."""
        sg = 1 if s == 'L' else -1
        P.rot('arm.' + s, q(Y, -sg * raise_) @ q(Z, sg * sweep) @ q(X, twist))
        P.rot('forearm.' + s, q(Y, -sg * fore[0]) @ q(Z, sg * fore[1]))
        P.rot('hand.' + s, q(Y, -sg * hand[0]) @ q(Z, sg * hand[1]) @ q(X, hand[2]))


def c_fly(F, t):
    ph = TAU * t / F.period
    A = F.amp
    up = max(0.0, -math.sin(ph))  # 0..1 through the upstroke (the wing folds)
    down = max(0.0, math.sin(ph))  # 0..1 through the downstroke
    P = C.Pose()
    for s in 'LR':
        F.wing(P, s, A * math.cos(ph) + 0.08, sweep=0.12 * up - 0.04 * down, twist=0.12 * math.sin(ph),
               fore=(0.45 * A * math.cos(ph - 0.7) - 0.1 * up, 0.35 * up),
               hand=(0.6 * A * math.cos(ph - 1.3) - 0.15 * up, 0.45 * up, 0.15 * down))
    # the body rises on the downstroke and sinks on the upstroke; nose pitches with the thrust
    P.move('root', (0, 0, -0.035 * F.span * math.cos(ph)))
    P.rot('body', q(X, 0.06 * math.sin(ph)))
    P.rot('neck', q(X, -0.05 * math.sin(ph)))
    P.rot('head', q(X, -0.03 * math.sin(ph - 0.4)))
    P.rot('tail', q(X, -0.12 * math.sin(ph + 0.5)) @ q(Z, 0.08 * math.sin(ph / 1)))
    return P


def c_glide(F, t, dur=4.0):
    u = TAU * t / dur
    P = C.Pose()
    roll = 0.1 * math.sin(u)
    for s, sg in SIDES:
        flex = 0.06 * math.sin(2 * u + (0 if s == 'L' else 1.5))
        F.wing(P, s, 0.14 + 0.04 * math.sin(2 * u) - sg * 0.03 * math.sin(u), sweep=-0.03,
               fore=(-0.04, -0.02), hand=(0.12 + flex, 0.03 * math.sin(u + sg), 0.03 * math.sin(2 * u)))
    P.move('root', (0, 0, 0.012 * F.span * math.sin(u)))
    P.rot('body', q(Y, roll) @ q(X, 0.03 * math.sin(2 * u)))
    P.rot('neck', q(Y, -0.6 * roll) @ q(Z, 0.12 * math.sin(u + 1.2)))
    P.rot('head', q(Z, 0.15 * math.sin(u + 1.8)) @ q(X, 0.08 * math.sin(2 * u)))
    P.rot('tail', q(Z, -0.18 * math.sin(u - 0.6)) @ q(Y, -0.1 * math.sin(u)))
    return P


def c_bank(F, t, dur=2.4):
    """A turn to the left: roll in, hold, roll out; the head stays level, the tail steers."""
    k = env(t, 0.1, 0.8, 1.5, 2.3)
    P = C.Pose()
    roll = 0.6 * k
    for s, sg in SIDES:
        inner = 1 if s == 'L' else 0  # the inside wing (left) flexes, the outside one reaches
        F.wing(P, s, 0.12 + 0.1 * k * (1 - inner), sweep=0.08 * k * inner,
               fore=(0.0, 0.1 * k * inner), hand=(0.1 + 0.08 * k * inner, 0.12 * k * inner, 0.0))
    P.move('root', (0, 0, -0.02 * F.span * k))
    P.rot('body', q(Z, 0.25 * k) @ q(Y, roll) @ q(X, -0.05 * k))
    P.rot('neck', q(Y, -0.5 * roll) @ q(Z, 0.2 * k))
    P.rot('head', q(Y, -0.3 * roll) @ q(Z, 0.15 * k))
    P.rot('tail', q(Z, 0.3 * k) @ q(Y, 0.2 * k))
    return P


def clips(F):
    return [('Fly', lambda t: c_fly(F, t), F.period, True),
            ('Glide', lambda t: c_glide(F, t), 4.0, True),
            ('Bank', lambda t: c_bank(F, t), 2.4, False)]


# ------------------------------------------------------------------ main

def views(span):
    return [('front', (0, -6, 0), (0, 0, 0), span * 1.2),
            ('top', (0, 0, 6), (0, 0, 0), span * 1.2),
            ('side', (6, 0, 0), (0, 0, 0), span * 0.9)]


def build(key, opts):
    C.reset()
    marks = C.load_marks(key)
    obj = C.import_raw(key)
    tris, junk = C.clean(obj, MAX_TRIS)
    orient(obj, key, marks)
    C.shrink_texture(obj)
    J, span, Lb, xs = joints(obj, marks)
    print(key, f'tris {tris} (dropped {junk} islands) span {span:.3f} body {Lb:.3f} shoulder x {xs:.3f}')
    if '--check' in opts:
        mk = C.markers(list(J.values()) + [mirror(J[n], -1) for n in ('shoulder', 'elbow', 'wrist', 'tip')], 0.012 * span)
        print(key, 'check:', C.raw_views(key, obj, views(span), 400, 'TEXTURE', '_joints'))
        for m in mk:
            bpy.data.objects.remove(m)
    rig = C.build_armature(key, layout(J, span))
    C.apply_weights(obj, rig, weights(obj, J, span, Lb, xs), smooth_passes=3)
    lift = math.radians(marks.get('head_lift', 50))
    flat = marks.get('wing_flat', False)
    if lift or flat:  # lift the head to look ahead / lay standing wings flat, leading edge forward
        fk = C.FK(rig)
        P = C.Pose()
        P.rot('neck', q(X, -0.55 * lift))
        P.rot('head', q(X, -0.45 * lift))
        if flat:
            V = C.verts(obj)
            for s, sg in SIDES:
                P.rot('arm.' + s, flatten(V, J, sg, xs))
        bake_rest(obj, rig, P, fk)
        k = SPAN.get(key, span) / np.ptp(C.verts(obj)[:, 0])
        if abs(k - 1) > 0.01:  # flattened wings reach farther: back to the contract wingspan
            C.transform(obj, Matrix.Scale(k, 4))
            C.select_only(rig)
            bpy.ops.object.mode_set(mode='EDIT')
            for b in rig.data.edit_bones:
                b.head, b.tail = b.head * k, b.tail * k
            bpy.ops.object.mode_set(mode='OBJECT')
    return obj, rig, span, marks


def main():
    keys, opts = C.args()
    for key in keys or ['vulture', 'raven']:
        obj, rig, span, marks = build(key, opts)
        F = Flyer(key, rig, span, marks)
        made = C.make_clips(rig, F.fk, clips(F))
        print(key, 'bones', len(rig.data.bones), 'clips', ', '.join(f'{n} {d:.2f}s{" loop" if lp else ""}' for n, d, lp in made))
        if '--preview' in opts:
            print(key, 'preview:', C.contact_sheet(key, rig, obj, views(span), made))
        C.drop_weight_colors(obj)
        C.export(key, rig, obj)
        if '--nopack' not in opts:
            print(key, 'packed:', C.pack(key), 'bytes')


if __name__ == '__main__':
    main()
