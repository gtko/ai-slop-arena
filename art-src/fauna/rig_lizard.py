"""Fauna body plan "lizard": raw Hunyuan GLB -> rigged, animated gecko (art-src/fauna/README.md).

  <raw>/lizard.glb -> art-src/fauna/out/lizard.glb -> public/assets/models/fauna/lizard.glb

Rig: root > hips > spine > chest > neck > head, tail1..tail5 off the hips, four sprawled legs of three
bones (upper, lower, foot). The joints are found on the mesh (centre line, the four foot pads) and can
be corrected in art-src/fauna/landmarks/<key>.json:
  {"rotate": [x, y, z] degrees before anything, "yaw": extra degrees after the auto heading,
   "joints": {"chest": [x, y, z], "shoulder.L": {"z": 0.1}, ...}  (final Blender coordinates, metres),
   "walk": {"period": s, "sweep": m, "lift": m}}
Clips: Idle, Walk (scurry, ground speed in the armature extras), Look, TailFlick, Pushup. The feet are
planted with a two-bone IK while the body moves.

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P art-src/fauna/rig_lizard.py -- [keys] [--preview] [--check]
"""
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fl_common as C  # noqa: E402
from fl_common import I, TAU, X, Y, Z, q, smooth, env, ease  # noqa: E402

LENGTH = {'lizard': 0.7}
MAX_TRIS = 5800
LEGS = [('L', 1, 'front'), ('R', -1, 'front'), ('L', 1, 'hind'), ('R', -1, 'hind')]


def leg_bones(s, end):
    return ('upper_arm.', 'forearm.', 'hand.') if end == 'front' else ('thigh.', 'shin.', 'foot.')


def names(s, end):
    return [b + s for b in leg_bones(s, end)]


# ------------------------------------------------------------------ orientation and joints

def centreline(V, L, nb=48):
    """Per slice along y: the body's centre x, z, its half-thickness and half-width (legs ignored:
    only the upper part and a central strip are measured)."""
    y0, y1 = V[:, 1].min(), V[:, 1].max()
    edges = np.linspace(y0, y1, nb + 1)
    rows = []
    for a, b in zip(edges, edges[1:]):
        P = V[(V[:, 1] >= a) & (V[:, 1] <= b)]
        if len(P) < 4:
            continue
        top = P[P[:, 2] > P[:, 2].max() * 0.55] if P[:, 2].max() > 0 else P
        xc = np.median(top[:, 0])
        strip = P[np.abs(P[:, 0] - xc) < 0.03 * L]
        if len(strip) < 3:
            strip = P
        zlo, zhi = strip[:, 2].min(), strip[:, 2].max()
        zc = (zlo + zhi) / 2
        upper = P[P[:, 2] >= zc]
        hw = np.percentile(np.abs(upper[:, 0] - xc), 90) if len(upper) else (zhi - zlo) / 2
        rows.append(((a + b) / 2, xc, zc, (zhi - zlo) / 2, hw))
    R = np.array(rows)
    for k in (1, 2, 3, 4):  # a light moving average
        R[1:-1, k] = (R[:-2, k] + R[1:-1, k] * 2 + R[2:, k]) / 4
    return R


def at(R, y, col):
    return float(np.interp(y, R[:, 0], R[:, col]))


def cpoint(R, y):
    return Vector((at(R, y, 1), y, at(R, y, 2)))


def feet(V, R, H):
    """The four foot pads: low vertices away from the centre line, split left/right and front/back."""
    low = V[V[:, 2] < 0.1 * H]
    xc = np.interp(low[:, 1], R[:, 0], R[:, 1])
    hw = np.interp(low[:, 1], R[:, 0], R[:, 4])
    lat = low[np.abs(low[:, 0] - xc) > 0.6 * hw]
    lat_xc = np.interp(lat[:, 1], R[:, 0], R[:, 1])
    # front / back: 2-means on y
    c0, c1 = np.percentile(lat[:, 1], 15), np.percentile(lat[:, 1], 70)
    for _ in range(20):
        front = np.abs(lat[:, 1] - c0) < np.abs(lat[:, 1] - c1)
        c0, c1 = lat[front, 1].mean(), lat[~front, 1].mean()
    out = {}
    for s, sg, end in LEGS:
        m = (np.sign(lat[:, 0] - lat_xc) == sg) & (front if end == 'front' else ~front)
        P = lat[m]
        out[(s, end)] = P
    return out


def orient(obj, key, marks):
    """Heading from the geometry: the long horizontal axis, head at the taller end, refined with the
    front and hind foot pads; then head toward -y, feet on z = 0, the contract length."""
    if 'rotate' in marks:
        C.transform(obj, C.euler_deg(marks['rotate']))
    V = C.verts(obj)
    c = V.mean(axis=0)
    xy = V[:, :2] - c[:2]
    w, vec = np.linalg.eigh(np.cov(xy.T))
    ax = vec[:, np.argmax(w)]
    s = xy @ ax
    lo, hi = s.min(), s.max()
    zlo = V[s < lo + 0.25 * (hi - lo), 2].max()
    zhi = V[s > hi - 0.25 * (hi - lo), 2].max()
    head = ax if zhi > zlo else -ax  # the raised head is the taller end
    ang = math.atan2(-head[0], -head[1])  # rotate so `head` -> -y
    C.transform(obj, Matrix.Translation(Vector((c[0], c[1], 0))) @ Matrix.Rotation(ang, 4, 'Z')
                @ Matrix.Translation(Vector((-c[0], -c[1], 0))))
    # refine with the feet: the line hind pads -> front pads along -y
    V = C.verts(obj)
    V[:, 2] -= V[:, 2].min()
    L = V[:, 1].max() - V[:, 1].min()
    R = centreline(V, L)
    F = feet(V, R, V[:, 2].max())
    fm = np.mean([F[(s, 'front')].mean(axis=0) for s in 'LR'], axis=0)
    hm = np.mean([F[(s, 'hind')].mean(axis=0) for s in 'LR'], axis=0)
    d = fm - hm
    ang = math.atan2(-d[0], -d[1]) + math.radians(marks.get('yaw', 0.0))
    C.transform(obj, Matrix.Rotation(ang, 4, 'Z'))
    V = C.verts(obj)
    L = V[:, 1].max() - V[:, 1].min()
    k = LENGTH.get(key, 0.7) / L
    C.transform(obj, Matrix.Scale(k, 4))
    V = C.verts(obj)
    R = centreline(V, LENGTH.get(key, 0.7))
    F = feet(V - np.array([0, 0, V[:, 2].min()]), R, V[:, 2].max() - V[:, 2].min())
    mid = np.mean([F[k2].mean(axis=0) for k2 in F], axis=0)
    C.transform(obj, Matrix.Translation(Vector((-mid[0], -mid[1], -V[:, 2].min()))))
    return math.degrees(ang)


def joints(obj, key, marks):
    V = C.verts(obj)
    L = V[:, 1].max() - V[:, 1].min()
    H = V[:, 2].max()
    R = centreline(V, L)
    F = feet(V, R, H)
    y0, y1 = V[:, 1].min(), V[:, 1].max()
    fy = np.mean([F[(s, 'front')][:, 1].mean() for s in 'LR'])
    hy = np.mean([F[(s, 'hind')][:, 1].mean() for s in 'LR'])
    J = {}
    J['chest'] = cpoint(R, fy + 0.02 * L)
    J['hips'] = cpoint(R, hy)
    J['spine'] = cpoint(R, (fy + hy) / 2 + 0.01 * L)
    D = J['chest'].y - y0
    J['head'] = cpoint(R, y0 + 0.55 * D)
    J['neck'] = cpoint(R, y0 + 0.8 * D)
    J['snout'] = cpoint(R, y0 + 0.02 * L)
    J['snout'].y = y0
    tl = y1 - hy
    for i, f in enumerate((0.1, 0.27, 0.46, 0.68), 1):
        J[f'tail{i}'] = cpoint(R, hy + f * tl)
    J['tailtip'] = cpoint(R, y1 - 0.005 * L)
    J['tailtip'].y = y1
    for s, sg, end in LEGS:
        P = F[(s, end)]
        pad = Vector(P.mean(axis=0))
        base = J['chest'] if end == 'front' else J['hips']
        yb = base.y
        S = Vector((at(R, yb, 1) + sg * 0.6 * at(R, yb, 4), yb, at(R, yb, 2) - 0.25 * at(R, yb, 3)))
        # the toe tip: the pad point farthest from the shoulder / hip, on the ground plane
        d2 = (P[:, 0] - S.x) ** 2 + (P[:, 1] - S.y) ** 2
        T = Vector(P[np.argmax(d2)])
        T.z = min(T.z, 0.02 * H)
        W = pad + (pad - T) * 0.5
        W.z = 0.18 * S.z
        K = Vector((S.x + (W.x - S.x) * 0.85, (S.y + W.y) / 2, S.z * 0.85))
        tag = ('shoulder' if end == 'front' else 'hip') + '.' + s
        J[tag], J[('elbow' if end == 'front' else 'knee') + '.' + s] = S, K
        J[('wrist' if end == 'front' else 'ankle') + '.' + s], J[('toe_f' if end == 'front' else 'toe_h') + '.' + s] = W, T
    for n, v in marks.get('joints', {}).items():
        if n not in J:
            raise KeyError(f'landmarks: unknown joint {n} ({", ".join(sorted(J))})')
        if isinstance(v, dict):
            for a, val in v.items():
                setattr(J[n], a, val)
        else:
            J[n] = Vector(v)
    J['cy'] = (y0 + y1) / 2  # not a joint: the middle of the mesh, for the cameras
    return J, R, L, H


def layout(J, L):
    B = {'root': (Vector((0, 0, 0)), Vector((0, -0.1 * L, 0)), None),
         'hips': (J['hips'], J['spine'], 'root'), 'spine': (J['spine'], J['chest'], 'hips'),
         'chest': (J['chest'], J['neck'], 'spine'), 'neck': (J['neck'], J['head'], 'chest'),
         'head': (J['head'], J['snout'], 'neck')}
    prev, pb = J['hips'], 'hips'
    for i in range(1, 6):
        t = J[f'tail{i}'] if i < 5 else J['tailtip']
        B[f'tail{i}'] = (prev, t, pb)
        prev, pb = t, f'tail{i}'
    for s, sg, end in LEGS:
        a, b, c = names(s, end)
        f = end == 'front'
        S, K = J[('shoulder.' if f else 'hip.') + s], J[('elbow.' if f else 'knee.') + s]
        W, T = J[('wrist.' if f else 'ankle.') + s], J[('toe_f.' if f else 'toe_h.') + s]
        par = 'chest' if f else 'hips'
        B[a], B[b], B[c] = (S, K, par), (K, W, a), (W, T, b)
    return B


# ------------------------------------------------------------------ weights

def weights(obj, J, R, L):
    V = C.verts(obj)
    order = ['tailtip', 'tail4', 'tail3', 'tail2', 'tail1', 'hips', 'spine', 'chest', 'neck', 'head', 'snout']
    bones = ['tail5', 'tail4', 'tail3', 'tail2', 'tail1', 'hips', 'spine', 'chest', 'neck', 'head']
    bands = [0, 0.05, 0.05, 0.05, 0.05, 0.04, 0.05, 0.05, 0.04, 0.025]
    spine = C.Chain([J[n] for n in order], bones, [b * L for b in bands])
    legs = {}
    for s, sg, end in LEGS:
        f = end == 'front'
        S = J[('shoulder.' if f else 'hip.') + s]
        pts = [Vector((at(R, S.y, 1), S.y, S.z)), S, J[('elbow.' if f else 'knee.') + s],
               J[('wrist.' if f else 'ankle.') + s], J[('toe_f.' if f else 'toe_h.') + s]]
        a, b, c = names(s, end)
        legs[(s, end)] = (C.Chain(pts, ['chest' if f else 'hips', a, b, c], [0, 0.03 * L, 0.02 * L, 0.015 * L]),
                          0.3 * (pts[2] - pts[1]).length, sg)
    W = []
    for p in V:
        p = Vector(p)
        d_body, arc = spine.locate(p)
        rad = max(at(R, p.y, 3), at(R, p.y, 4))
        best, w = d_body / max(rad, 1e-4), None  # distances in body / leg radii
        for (s, end), (ch, rl, sg) in legs.items():
            if (p.x - at(R, p.y, 1)) * sg <= 0:
                continue
            dl, al = ch.locate(p)
            if dl / rl < best and al > ch.cum[1] * 0.5:
                best, w = dl / rl, ch.weights(al)
        W.append(w if w else spine.weights(arc))
    return W


# ------------------------------------------------------------------ clips

class Lizard:
    def __init__(self, rig, J, L, marks):
        self.fk = C.FK(rig)
        self.J, self.L = J, L
        self.rest_tail = {}
        # where each lower leg ends at rest (IK target) and the bend direction (the elbow side)
        self.legs = {}
        for s, sg, end in LEGS:
            a, b, c = names(s, end)
            S, K, W = self.fk.head0[a], self.fk.head0[b], self.fk.head0[c]
            u = (W - S).normalized()
            pole = (K - S) - u * (K - S).dot(u)
            self.legs[(s, end)] = (a, b, c, W.copy(), pole.normalized())
        w = marks.get('walk', {})
        self.period = w.get('period', 0.42)
        reach = min((self.fk.head0[c] - self.fk.head0[a]).length for a, b, c, *_ in self.legs.values())
        self.sweep = w.get('sweep', 0.75 * reach)
        self.lift = w.get('lift', 0.35 * reach)
        self.duty = 0.55
        self.speed = self.sweep / (self.duty * self.period)

    def plant(self, P, offsets=None, foot_rot=None):
        """IK every leg onto its rest foot position (+ an offset per leg, root frame)."""
        offsets = offsets or {}
        tot, _ = self.fk.solve(P)
        for k, (a, b, c, W, pole) in self.legs.items():
            par = self.fk.parent[a]
            tgt = W + offsets.get(k, Vector()) + P.loc.get('root', Vector())
            # the elbow keeps its side as the girdle turns
            C.two_bone_ik(self.fk, P, a, b, tgt, tot[par] @ pole, foot=c,
                          foot_world=(foot_rot or {}).get(k, I))
        return P

    def tail(self, P, amp, phase, lift=0.0, curl=0.0):
        """A wave down the tail: amp (rad) per bone, growing to the tip; phase per bone."""
        for i in range(1, 6):
            g = 0.6 + 0.2 * i
            P.rot(f'tail{i}', q(Z, amp(i) * g) @ q(X, lift * (1 if i < 3 else 0.5)) @ q(Z, curl * i / 5))


def c_idle(Lz, t, dur=4.0):
    P = C.Pose()
    u = t / dur
    br = math.sin(TAU * 2 * u)  # two breaths per loop
    P.move('root', (0, 0, 0.004 * Lz.L * (br + 1)))
    P.rot('chest', q(X, -0.02 * br))
    P.rot('neck', q(X, 0.04 * math.sin(TAU * u)))
    tilt = math.sin(TAU * u) * 0.5 + 0.5 * math.sin(TAU * 2 * u + 1)
    P.rot('head', q(Z, 0.18 * math.sin(TAU * u + 0.5)) @ q(Y, 0.22 * tilt))
    Lz.tail(P, lambda i: 0.07 * math.sin(TAU * u - 0.7 * i), 0, curl=0.12 * math.sin(TAU * u + 2))
    return Lz.plant(P)


def c_walk(Lz, t):
    T, duty = Lz.period, Lz.duty
    ph = t / T
    P = C.Pose()
    offs, rots = {}, {}
    for s, sg, end in LEGS:
        diag = (s == 'L') == (end == 'front')  # front-left + hind-right move together
        u = (ph + (0.0 if diag else 0.5)) % 1.0
        if u < duty:  # stance: the foot slides back at the ground speed (planted in the world)
            k = u / duty
            y, z = -Lz.sweep / 2 + Lz.sweep * k, 0.0
            pitch = 0.0
        else:  # swing: lifted and carried forward
            k = (u - duty) / (1 - duty)
            e = ease(k)
            y = Lz.sweep / 2 - Lz.sweep * e
            z = Lz.lift * math.sin(math.pi * k)
            pitch = 0.35 * math.sin(math.pi * k)  # the sprawled toes tip up in the air
        offs[(s, end)] = Vector((0.0, y, z))
        rots[(s, end)] = q(Y, -sg * pitch)
    # the S wave: girdles turn opposite, so each reaching leg's shoulder / hip comes forward
    a = math.radians(14)
    w = math.sin(TAU * ph)
    P.move('root', (0, 0, 0.012 * Lz.L * abs(math.cos(TAU * ph))))
    P.rot('hips', q(Z, a * w))
    P.rot('spine', q(Z, -a * w))
    P.rot('chest', q(Z, -a * w))
    P.rot('neck', q(Z, 0.6 * a * w))
    P.rot('head', q(Z, 0.3 * a * w) @ q(X, 0.03 * math.sin(TAU * 2 * ph)))
    Lz.tail(P, lambda i: -0.2 * math.sin(TAU * ph - 0.55 * i), 0)
    return Lz.plant(P, offs, rots)


def c_look(Lz, t, dur=2.6):
    P = C.Pose()
    yaw = 0.75 * (env(t, 0.1, 0.5, 1.0, 1.4) - env(t, 1.2, 1.6, 2.0, 2.45))
    P.rot('chest', q(Z, 0.2 * yaw))
    P.rot('neck', q(Z, 0.45 * yaw) @ q(X, -0.1 * abs(yaw)))
    P.rot('head', q(Z, 0.5 * yaw) @ q(Y, -0.25 * yaw))
    Lz.tail(P, lambda i: -0.08 * yaw, 0)
    return Lz.plant(P)


def c_tailflick(Lz, t, dur=1.3):
    P = C.Pose()
    e = env(t, 0.0, 0.15, 0.85, 1.25)
    Lz.tail(P, lambda i: e * 0.45 * math.sin(TAU * 2.2 * t - 0.9 * i), 0, lift=-0.12 * e)
    P.rot('head', q(Z, -0.12 * e * math.sin(TAU * 2.2 * t)))
    P.rot('hips', q(Z, 0.05 * e * math.sin(TAU * 2.2 * t)))
    return Lz.plant(P)


def c_pushup(Lz, t, dur=2.6):
    """The lizard display: three quick push-ups on the front legs, head up, then settle."""
    P = C.Pose()
    n = 3
    k = 0.0
    if 0.2 < t < 2.2:
        u = (t - 0.2) / 2.0 * n
        k = math.sin(math.pi * (u % 1.0)) ** 2  # up and down, a snap at the top
    base = env(t, 0.0, 0.25, 2.2, 2.55)
    lift = base * (0.35 + 0.65 * k)
    # the front legs are almost straight at rest: the push-ups dip below the rest pose (elbows
    # bending) and come back up just above it, so the hands stay planted
    bob = base * (1.2 * k - 0.5)
    P.rot('spine', q(X, -0.12 * bob))
    P.rot('chest', q(X, -0.06 * bob))
    P.rot('neck', q(X, 0.2 * lift))
    P.rot('head', q(X, 0.15 * lift) @ q(Y, 0.1 * base * math.sin(TAU * t)))
    Lz.tail(P, lambda i: 0.05 * base * math.sin(TAU * t - i), 0, lift=0.08 * lift)
    return Lz.plant(P)


def clips(Lz):
    return [('Idle', lambda t: c_idle(Lz, t), 4.0, True),
            ('Walk', lambda t: c_walk(Lz, t), Lz.period, True),
            ('Look', lambda t: c_look(Lz, t), 2.6, False),
            ('TailFlick', lambda t: c_tailflick(Lz, t), 1.3, False),
            ('Pushup', lambda t: c_pushup(Lz, t), 2.6, False)]


# ------------------------------------------------------------------ main

def views(L, cy=0.0):
    return [('side', (1.6, cy, 0.1), (0, cy, 0.1), L * 1.05),
            ('top', (0, cy, 2.0), (0, cy, 0), L * 1.05),
            ('persp', (-1.0, cy - 1.1, 1.2), (0, cy, 0.05), L * 1.2)]


def build(key, opts):
    C.reset()
    marks = C.load_marks(key)
    obj = C.import_raw(key)
    tris, junk = C.clean(obj, MAX_TRIS)
    heading = orient(obj, key, marks)
    C.shrink_texture(obj)
    J, R, L, H = joints(obj, key, marks)
    print(key, f'tris {tris} (dropped {junk} islands) heading {heading:.0f} deg  length {L:.3f} height {H:.3f}')
    if '--check' in opts:  # orientation and joints, no rig
        mk = C.markers([v for k, v in J.items() if k != 'cy'], 0.006)
        print(key, 'check:', C.raw_views(key, obj, views(L, J['cy']), 400, 'TEXTURE', '_joints'))
        for m in mk:
            C.bpy.data.objects.remove(m)
    rig = C.build_armature(key, layout(J, L))
    C.apply_weights(obj, rig, weights(obj, J, R, L), smooth_passes=3)
    return obj, rig, J, L, marks


def main():
    keys, opts = C.args()
    for key in keys or ['lizard']:
        obj, rig, J, L, marks = build(key, opts)
        Lz = Lizard(rig, J, L, marks)
        made = C.make_clips(rig, Lz.fk, clips(Lz))
        speed = round(Lz.speed, 3)
        print(key, 'bones', len(rig.data.bones), 'clips', ', '.join(f'{n} {d:.2f}s{" loop" if lp else ""}' for n, d, lp in made),
              'walk speed', speed, 'm/s')
        if '--preview' in opts:
            print(key, 'preview:', C.contact_sheet(key, rig, obj, views(L, J['cy']), made, size=260, grid=(0.0, 1.2)))
        C.drop_weight_colors(obj)
        C.export(key, rig, obj, {'speed': {'Walk': speed}})
        if '--nopack' not in opts:
            print(key, 'packed:', C.pack(key), 'bytes')


if __name__ == '__main__':
    main()
