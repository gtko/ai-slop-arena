"""Clips of the quadruped fauna (rig_quad.py): Idle, Walk, Run, Look, Sit, Sniff, Scratch.

Poses are written in the armature frame: every bone rotation is (x, y, z) degrees about the armature
axes (x = the side axis: +x pitches a forward-pointing bone down, swings a leg back and tips an ear
forward; +y rolls the top toward the animal's left; +z turns toward its left), applied about the bone's
head and chained down the hierarchy. The paws are placed by a planar two-bone IK (plus the paw's own
pitch), so planted paws stay put while the body bobs and rocks.
Loops end exactly on their first pose; locomotion is in place (the game moves the animal).
"""
import math
from collections import defaultdict

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

FPS = 30
LEGS = {
    'FL': ('FrontUpperL', 'FrontLowerL', 'FrontPawL'), 'FR': ('FrontUpperR', 'FrontLowerR', 'FrontPawR'),
    'BL': ('BackUpperL', 'BackLowerL', 'BackPawL'), 'BR': ('BackUpperR', 'BackLowerR', 'BackPawR'),
}
TAU = 2 * math.pi

# per-species tuning, overridable in landmarks/<key>.json "poses"
DEFAULTS = {
    'gait': 'bound',     # Run: 'bound' (half-bound gallop) or 'trot'
    'walk_T': None,      # cycle length (s); None = from the leg length
    'run_T': None,
    'walk_stride': 1.0,  # multipliers of the automatic stride / lift / bob
    'run_stride': 1.0,
    'lift': 1.0,
    'bob': 1.0,
    'tail': 1.0,         # tail swing amplitude
    'ears': 1.0,
    'sit_pitch': 34.0,   # degrees the body rears up when sitting
    'sniff': 1.0,
}


def clamp01(x):
    return min(1.0, max(0.0, x))


def ease(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def ramp(t, a, b):
    return ease((t - a) / (b - a))


def env(t, a, b, c, d):
    """0 before a, eases up to 1 at b, holds, eases back to 0 from c to d."""
    return ramp(t, a, b) * (1 - ramp(t, c, d))


def back_out(x, s=1.6):
    """Ease out with a small overshoot, for settling into a pose."""
    x = clamp01(x) - 1
    return 1 + (s + 1) * x ** 3 + s * x ** 2


def wobble(t, at, freq=6.0, decay=7.0):
    """A flick that rings down: 0 before `at`."""
    if t < at:
        return 0.0
    u = t - at
    return math.exp(-decay * u) * math.sin(TAU * freq * u)


def keys(t, pts):
    """Eased interpolation through (time, value) keys."""
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0))
    return pts[-1][1]


def wrap(a):
    return (a + math.pi) % TAU - math.pi


class Pose:
    def __init__(self):
        self.e = defaultdict(lambda: Vector((0.0, 0.0, 0.0)))
        self.loc = Vector((0.0, 0.0, 0.0))  # the Hips (root) offset, armature frame
        self.paw = {}   # leg -> (offset from the rest paw, paw pitch in degrees)
        self.fk = set()  # legs posed by rotations instead of the IK

    def rot(self, bone, x=0.0, y=0.0, z=0.0):
        self.e[bone] += Vector((x, y, z))


class Quad:
    """Rest data of the rig, forward kinematics and the leg IK."""

    def __init__(self, rig, J, info, H):
        self.rig, self.J, self.info, self.H = rig, J, info, H
        bones = rig.data.bones
        self.names = [b.name for b in bones]
        self.has = set(self.names)
        self.parent = {b.name: b.parent.name if b.parent else None for b in bones}
        self.B = {b.name: b.matrix_local.copy() for b in bones}
        self.Binv = {n: m.inverted() for n, m in self.B.items()}
        self.R = {n: m.to_quaternion() for n, m in self.B.items()}
        self.head = {b.name: b.head_local.copy() for b in bones}
        self.tail = {b.name: b.tail_local.copy() for b in bones}
        self.p = dict(DEFAULTS, **info.get('poses', {}))
        self.leg_len = {}
        for leg, (up, lo, paw) in LEGS.items():
            A, K, W = self.head[up], self.head[lo], self.head[paw]
            self.leg_len[leg] = (K - A).length + (W - K).length
        self.hind = (self.leg_len['BL'] + self.leg_len['BR']) / 2
        self.front = (self.leg_len['FL'] + self.leg_len['FR']) / 2
        self.span = self.head['FrontPawL'].y - self.head['BackPawL'].y  # negative: front is -y
        self.body_len = abs(self.span)

    def fk(self, D, loc):
        M = {}
        for n in self.names:
            R = self.R[n]
            L = (R.inverted() @ D.get(n, Quaternion()) @ R).to_matrix().to_4x4()
            p = self.parent[n]
            if p is None:
                M[n] = self.B[n] @ Matrix.Translation(R.inverted() @ loc) @ L
            else:
                M[n] = M[p] @ self.Binv[p] @ self.B[n] @ L
        return M

    def ik(self, leg, Mp, target, pitch):
        """Upper / lower / paw rotations (about x) putting the paw's head at `target` (armature frame)
        with the paw pitched by `pitch` from flat; solved in the parent's rest frame."""
        up, lo, paw = LEGS[leg]
        to_rest = self.B[self.parent[up]] @ Mp.inverted()
        w = to_rest @ target
        A, K, W, T = self.head[up], self.head[lo], self.head[paw], self.tail[paw]
        ang = lambda a, b: math.atan2(b.z - a.z, b.y - a.y)
        l1 = math.hypot(K.y - A.y, K.z - A.z)
        l2 = math.hypot(W.y - K.y, W.z - K.z)
        dy, dz = w.y - A.y, w.z - A.z
        d = min(max(math.hypot(dy, dz), abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995)
        base = math.atan2(dz, dy)
        cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
        cross = (W.y - A.y) * (K.z - A.z) - (W.z - A.z) * (K.y - A.y)  # side of the rest bend
        s = 1.0 if cross >= 0 else -1.0
        a1 = base + s * math.acos(max(-1.0, min(1.0, cosA)))
        th1 = wrap(a1 - ang(A, K))
        ky, kz = A.y + l1 * math.cos(a1), A.z + l1 * math.sin(a1)
        wy, wz = A.y + d * math.cos(base), A.z + d * math.sin(base)
        th2 = wrap(math.atan2(wz - kz, wy - ky) - ang(K, W) - th1)
        want = Quaternion((1, 0, 0), math.radians(pitch)) @ (T - W)
        want = to_rest.to_3x3() @ want
        th3 = wrap(math.atan2(want.z, want.y) - ang(W, T) - th1 - th2)
        X = Vector((1, 0, 0))
        return {up: Quaternion(X, th1), lo: Quaternion(X, th2), paw: Quaternion(X, th3)}

    def solve(self, P):
        D = {n: Euler([math.radians(a) for a in v], 'XYZ').to_quaternion() for n, v in P.e.items() if n in self.has}
        M = self.fk(D, P.loc)
        for leg, (up, _lo, paw) in LEGS.items():
            if leg in P.fk:
                continue
            off, pitch = P.paw.get(leg, (Vector(), 0.0))
            D.update(self.ik(leg, M[self.parent[up]], self.head[paw] + off, pitch))
        return D

    def joint(self, P, bone):
        """World (armature) position of a bone's head in pose P, before the leg IK."""
        D = {n: Euler([math.radians(a) for a in v], 'XYZ').to_quaternion() for n, v in P.e.items() if n in self.has}
        return self.fk(D, P.loc)[bone].translation


# ------------------------------------------------------------------ shared motion

def paw_cycle(ph, stride, lift, beta, curl=50.0):
    """One paw over a cycle phase: planted and sliding back (stance), then lifted forward (swing)."""
    if ph < beta:
        return -stride / 2 + stride * ph / beta, 0.0, 0.0
    v = (ph - beta) / (1 - beta)
    y = stride / 2 - stride * ease(v)
    z = lift * math.sin(math.pi * v) * (1.0 + 0.25 * math.sin(math.pi * v))
    pitch = curl * math.sin(math.pi * min(1.0, v * 1.4))  # toes trail, then reach flat for the landing
    return y, z / 1.25, pitch


def tail_wave(C, P, t, T, amp, pitch=0.0, harm=1, lag=0.55):
    """Side-to-side wave running down the tail (each segment later and wider: overlapping action)."""
    a = amp * C.p['tail']
    for i, b in enumerate(('Tail1', 'Tail2', 'Tail3')):
        P.rot(b, x=pitch * (1 if i == 0 else 0.3), z=a * (0.7 + 0.25 * i) * math.sin(TAU * harm * t / T - lag * i))


def ears(C, P, x=0.0, z=0.0, y=0.0):
    k = C.p['ears']
    P.rot('EarL', x=x * k, y=y * k, z=z * k)
    P.rot('EarR', x=x * k, y=-y * k, z=-z * k)


def look(P, yaw, pitch=0.0, tilt=0.0, chest=0.15, neck=0.35):
    """Spread a head turn over the chest, neck and head."""
    P.rot('Chest', z=yaw * chest)
    P.rot('Neck', x=pitch * 0.5, z=yaw * neck)
    P.rot('Head', x=pitch * 0.5, y=tilt, z=yaw * (1 - chest - neck))


def breathe(C, P, t, period, amp=1.0):
    b = math.sin(TAU * t / period)
    P.rot('Spine2', x=-1.0 * amp * b)
    P.rot('Chest', x=0.8 * amp * b)
    P.loc.z += 0.004 * C.H * amp * b


# ------------------------------------------------------------------ clips

def c_idle(C, t, dur):
    P = Pose()
    breathe(C, P, t, dur / 2)
    P.rot('Hips', y=1.5 * math.sin(TAU * t / dur))
    yaw = keys(t, [(0, 0), (0.5, 0), (1.0, 16), (1.7, 16), (2.2, -10), (2.9, -10), (3.35, 0), (dur, 0)])
    tilt = 6 * env(t, 1.0, 1.3, 1.5, 1.8)
    look(P, yaw, pitch=-3 * env(t, 2.2, 2.5, 2.7, 3.1), tilt=tilt)
    ears(C, P, x=3 * math.sin(TAU * 2 * t / dur))
    P.rot('EarL', x=-18 * wobble(t, 1.25, 7, 8) * C.p['ears'], z=6 * wobble(t, 1.25, 7, 8))
    P.rot('EarR', x=-18 * wobble(t, 2.55, 7, 8) * C.p['ears'], z=-6 * wobble(t, 2.55, 7, 8))
    tail_wave(C, P, t, dur, 10, pitch=2 * math.sin(TAU * 2 * t / dur))
    for b, k in (('Tail2', 3), ('Tail3', 4)):
        P.rot(b, z=k * math.sin(TAU * 3 * t / dur - 1.0))
    return P


def c_walk(C, t, dur):
    P = Pose()
    u = t / dur
    stride = C.walk_stride
    lift = 0.32 * C.hind * C.p['lift']
    for leg, off in (('BL', 0.0), ('FL', 0.25), ('BR', 0.5), ('FR', 0.75)):  # lateral-sequence walk
        y, z, pitch = paw_cycle((u - off) % 1, stride, lift * (1.1 if leg[0] == 'F' else 1.0), 0.64)
        P.paw[leg] = (Vector((0, y, z)), pitch)
    bob = 0.018 * C.H * C.p['bob']
    P.loc.z -= bob * (0.5 + 0.5 * math.cos(TAU * 2 * (u - 0.12)))
    P.loc.x += 0.006 * C.H * math.sin(TAU * u)
    P.rot('Hips', y=-2.5 * math.sin(TAU * u), z=5 * math.sin(TAU * u))  # hips swing with the hind legs
    P.rot('Spine2', z=-2 * math.sin(TAU * u - 0.3))
    P.rot('Chest', y=2 * math.sin(TAU * u - 1.6), z=-5 * math.sin(TAU * u - 0.4))
    P.rot('Neck', x=3.5 * math.sin(TAU * 2 * u - 1.2), z=1.5 * math.sin(TAU * u - 0.8))
    P.rot('Head', x=-2 * math.sin(TAU * 2 * u - 1.8), z=-1.5 * math.sin(TAU * u - 1.2))
    ears(C, P, x=6 * math.sin(TAU * 2 * u - 2.2), z=2 * math.sin(TAU * u - 1.5))
    tail_wave(C, P, t, dur, 14, pitch=4 + 3 * math.sin(TAU * 2 * u - 1.4))
    return P


def c_run(C, t, dur):
    P = Pose()
    u = t / dur
    stride = C.run_stride
    lift = 0.5 * C.hind * C.p['lift']
    if C.p['gait'] == 'trot':
        order, beta = (('BL', 0.0), ('FR', 0.03), ('BR', 0.5), ('FL', 0.53)), 0.42
    else:  # half-bound: hind pair, suspension, front pair, gathered suspension
        order, beta = (('BL', 0.0), ('BR', 0.07), ('FL', 0.45), ('FR', 0.52)), 0.3
    for leg, off in order:
        y, z, pitch = paw_cycle((u - off) % 1, stride, lift, beta, curl=70)
        P.paw[leg] = (Vector((0, y, z)), pitch)
    bob = 0.03 * C.H * C.p['bob']
    if C.p['gait'] == 'trot':
        P.loc.z += bob * 0.6 * math.cos(TAU * 2 * (u - 0.3))
        P.rot('Hips', y=-3 * math.sin(TAU * u), z=4 * math.sin(TAU * u))
        P.rot('Chest', z=-4 * math.sin(TAU * u - 0.3))
        P.rot('Neck', x=-8 + 3 * math.sin(TAU * 2 * u - 1.0))
        P.rot('Head', x=6)
    else:
        flex = math.cos(TAU * (u - 0.9))  # +1 gathered (back arched), -1 stretched
        rock = math.sin(TAU * (u - 0.2))  # nose up on the hind legs, down on the front legs
        P.loc.z += bob * math.cos(TAU * 2 * (u - 0.41))
        P.rot('Hips', x=-7 * flex - 6 * rock)
        P.rot('Spine1', x=5 * flex)
        P.rot('Spine2', x=5 * flex)
        P.rot('Chest', x=4 * flex)
        P.rot('Neck', x=-8 + 7 * rock - 6 * flex)  # keeps the head steadier than the body
        P.rot('Head', x=4 + 3 * math.sin(TAU * (u - 0.45)))
    ears(C, P, x=-22 + 6 * math.sin(TAU * u - 2.0))
    for i, b in enumerate(('Tail1', 'Tail2', 'Tail3')):
        P.rot(b, x=(6 if i == 0 else 0) + 9 * math.sin(TAU * u - 1.2 - 0.6 * i) * C.p['tail'],
              z=4 * math.sin(TAU * u - 0.6 * i) * C.p['tail'])
    return P


def c_look(C, t, dur):
    """Turns the head to one side, then the other, back to rest (once)."""
    P = Pose()
    yaw = keys(t, [(0, 0), (0.15, -4), (0.55, 42), (1.15, 42), (1.55, -38), (2.15, -38), (2.6, 0), (dur, 0)])
    lag = keys(t - 0.1, [(0, 0), (0.15, -4), (0.55, 42), (1.15, 42), (1.55, -38), (2.15, -38), (2.6, 0), (dur, 0)])
    P.rot('Chest', z=0.12 * lag)
    P.rot('Neck', z=0.35 * yaw, x=-4 * env(t, 0.3, 0.6, 2.2, 2.6))
    P.rot('Head', z=0.53 * yaw, y=9 * env(t, 0.6, 0.9, 1.0, 1.3) - 7 * env(t, 1.7, 2.0, 2.0, 2.3))
    perk = env(t, 0.2, 0.5, 2.3, 2.7)
    ears(C, P, x=6 * perk, z=10 * perk)
    P.rot('EarL', x=-12 * wobble(t, 0.5, 6, 7))
    P.rot('EarR', x=-12 * wobble(t, 1.5, 6, 7))
    breathe(C, P, t, dur, 0.6)
    swish = 16 * (math.sin(TAU * t / dur) * env(t, 0.2, 0.6, 2.2, 2.7))
    for i, b in enumerate(('Tail1', 'Tail2', 'Tail3')):
        P.rot(b, z=swish * (0.6 + 0.3 * i) * C.p['tail'])
    return P


def c_sit(C, t, dur):
    """Rears up onto the haunches, front legs straight, tail curls round (once, ends seated)."""
    P = Pose()
    k = back_out(ramp(t, 0.15, 0.95) ** 0.9 if t > 0.15 else 0.0, 1.2)
    pitch = C.p['sit_pitch']
    P.rot('Hips', x=3 * env(t, 0.0, 0.12, 0.12, 0.3) - pitch * k)  # a small lean forward first
    P.rot('Spine2', x=4 * k)
    P.rot('Chest', x=3 * k)
    P.rot('Neck', x=pitch * 0.55 * k)
    P.rot('Head', x=pitch * 0.3 * k, y=10 * ramp(t, 1.0, 1.35))  # a cute head tilt once seated
    P.loc.y += 0.03 * C.H * k
    # drop the body until the straight front legs just reach the ground under the shoulders
    sh = C.joint(P, 'FrontUpperL')
    paw = C.head['FrontPawL']
    drop = max(0.0, sh.z - paw.z - 0.97 * C.front)
    P.loc.z -= drop
    for leg in ('FL', 'FR'):
        dy = (sh.y - C.head[LEGS[leg][2]].y) * k
        P.paw[leg] = (Vector((0, dy, 0)), 0.0)
    for leg in ('BL', 'BR'):
        P.paw[leg] = (Vector((0, -0.04 * C.H * k, 0)), -8 * k)
    ears(C, P, x=4 * k, z=-4 * wobble(t, 0.95, 5, 6))
    curl = ramp(t, 0.5, 1.3)
    for i, b in enumerate(('Tail1', 'Tail2', 'Tail3')):
        P.rot(b, x=(pitch * 0.9 if i == 0 else -4) * k, z=(22 + 10 * i) * curl * C.p['tail'])
    breathe(C, P, t, dur, 0.5 * ramp(t, 0.8, 1.2))
    return P


def c_sniff(C, t, dur):
    """Nose down to the ground, a few quick sniffs, a look around, back up (once)."""
    P = Pose()
    k = env(t, 0.1, 0.5, 1.85, 2.35) * C.p['sniff']
    P.rot('Hips', x=-3 * k)
    P.rot('Chest', x=10 * k)
    P.loc.z -= 0.012 * C.H * k
    sn = env(t, 0.5, 0.6, 1.65, 1.8)
    scan = 14 * math.sin(TAU * 0.8 * (t - 0.55)) * env(t, 0.55, 0.9, 1.4, 1.8)
    P.rot('Neck', x=26 * k, z=0.4 * scan)
    P.rot('Head', x=16 * k + 4 * math.sin(TAU * 6.5 * t) * sn, z=0.6 * scan)
    ears(C, P, x=12 * k)
    wag = 12 * math.sin(TAU * 3 * t) * env(t, 0.4, 0.7, 1.7, 2.1)
    for i, b in enumerate(('Tail1', 'Tail2', 'Tail3')):
        P.rot(b, x=(12 * k if i == 0 else 0), z=wag * (0.6 + 0.3 * i) * C.p['tail'])
    return P


def c_scratch(C, t, dur):
    """Half sits, the left hind paw scratches behind the ear, head tilted into it (once)."""
    P = Pose()
    k = env(t, 0.1, 0.5, 2.0, 2.5)
    fast = env(t, 0.5, 0.62, 1.85, 1.98)
    s = math.sin(TAU * 7 * t)
    P.loc.z -= 0.35 * C.hind * k
    P.loc.y += 0.02 * C.H * k
    P.rot('Hips', x=-14 * k, y=-9 * k + 1.5 * s * fast)
    P.rot('Chest', y=-3 * k)
    P.fk.add('BL')
    P.rot('BackUpperL', x=-80 * k + 6 * s * fast, y=-22 * k)
    P.rot('BackLowerL', x=45 * k + 22 * math.sin(TAU * 7 * t - 0.9) * fast)
    P.rot('BackPawL', x=35 * k)
    P.paw['BR'] = (Vector((0, -0.02 * C.H * k, 0)), -6 * k)
    P.rot('Neck', x=6 * k, y=10 * k, z=16 * k)
    P.rot('Head', x=6 * k, y=16 * k + 3 * math.sin(TAU * 7 * t - 1.6) * fast, z=8 * k)
    P.rot('EarL', x=-14 * k + 8 * s * fast)
    P.rot('EarR', x=6 * k)
    for i, b in enumerate(('Tail1', 'Tail2', 'Tail3')):
        P.rot(b, x=-6 * k if i == 0 else 0, z=-(12 + 6 * i) * k * C.p['tail'])
    return P


# name, function, duration (s; None = locomotion cycle), loops
CLIPS = [
    ('Idle', c_idle, 3.6, True),
    ('Walk', c_walk, None, True),
    ('Run', c_run, None, True),
    ('Look', c_look, 2.8, False),
    ('Sit', c_sit, 1.5, False),
    ('Sniff', c_sniff, 2.5, False),
    ('Scratch', c_scratch, 2.6, False),
]


def apply(C, D, loc):
    for pb in C.rig.pose.bones:
        R = C.R[pb.name]
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = R.inverted() @ D.get(pb.name, Quaternion()) @ R
        pb.location = R.inverted() @ loc if C.parent[pb.name] is None else Vector()
        pb.scale = (1, 1, 1)


def cycle(C):
    """Cycle lengths (whole frames, so the loops close) and the stride of each gait."""
    L = C.hind
    walk_T = C.p['walk_T'] or 0.55 + 1.3 * L
    run_T = C.p['run_T'] or (0.3 + 0.6 * L if C.p['gait'] == 'bound' else 0.26 + 0.5 * L)
    walk_T = round(walk_T * FPS) / FPS
    run_T = round(run_T * FPS) / FPS
    C.walk_stride = (0.75 * L + 0.12 * C.body_len) * C.p['walk_stride']
    C.run_stride = (1.35 * L + 0.25 * C.body_len) * C.p['run_stride']
    beta_run = 0.42 if C.p['gait'] == 'trot' else 0.3
    speed = {'Walk': round(C.walk_stride / (0.64 * walk_T), 3), 'Run': round(C.run_stride / (beta_run * run_T), 3)}
    return walk_T, run_T, speed


def make_all(rig, J, info, H):
    C = Quad(rig, J, info, H)
    walk_T, run_T, speed = cycle(C)
    rig.animation_data_create()
    made = []
    for name, fn, dur, loop in CLIPS:
        dur = dur or (walk_T if name == 'Walk' else run_T)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        n = round(dur * FPS)
        last = {}
        for f in range(n + 1):
            t = 0.0 if loop and f == n else f / FPS
            P = fn(C, t, dur)
            D = C.solve(P)
            apply(C, D, P.loc)
            for pb in rig.pose.bones:
                q = pb.rotation_quaternion
                if pb.name in last and last[pb.name].dot(q) < 0:
                    pb.rotation_quaternion = -q
                last[pb.name] = pb.rotation_quaternion.copy()
                pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
                if C.parent[pb.name] is None:
                    pb.keyframe_insert('location', frame=f, group=pb.name)
        act.frame_range = (0, n)
        act.use_frame_range = True
        act.use_cyclic = loop
        made.append((name, n / FPS))
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    return made, speed
