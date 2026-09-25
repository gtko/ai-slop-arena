"""The animation clips of every brawler, keyed on the humanoid armature built by rig_blender.py.

Poses are written as rotations in the armature frame (Blender: z up, the character faces -y, its
left is +x), composed parent to child, and converted to each pose bone's own frame when keyed:
   pitch  = rotation about x: positive leans a spine forward / swings a hanging limb back
   yaw    = about z: positive turns to the character's left
   roll   = about y: positive leans to the character's left
Arms are placed with directions (rotate the rest arm axis onto a target direction), legs that must
keep their feet planted (crouch, sneak, landing) use a two-bone IK in the side plane.

Clips (names are what the game plays, see src/animator.js):
  locomotion  Idle, Run, Sneak, BushIdle, Slide
  upper body  Aim, Shoot, Cough, Cheer
  one-shots   Bored, Fidget, Wave, Super, Hit, Death, Victory (loop)
"""
import math
import os

import bpy
from mathutils import Quaternion, Vector

FPS = 30
TAU = math.pi * 2
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
I = Quaternion()


def q(axis, a):
    return Quaternion(axis, a)


def E3(x=0.0, y=0.0, z=0.0):
    """A three.js Euler (XYZ, y up) as a Blender rotation: the old procedural numbers port as is."""
    return q(X, x) @ q(Z, y) @ q(Y, -z)


def clamp01(x):
    return min(1.0, max(0.0, x))


def ease(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def ramp(t, a, b):
    return ease((t - a) / (b - a)) if b != a else float(t >= a)


def env(t, a, b, c, d):
    """0 before a, eases up to 1 at b, holds, eases back to 0 from c to d."""
    return ramp(t, a, b) * (1 - ramp(t, c, d))


def lerp(a, b, k):
    return a + (b - a) * k


def between(a, b):
    return a.normalized().rotation_difference(b.normalized())


def kick(t, at, rise=0.05, decay=7.0):
    """Recoil-like impulse: 0 before `at`, snaps to 1, decays exponentially."""
    if t < at:
        return 0.0
    u = t - at
    return min(1.0, u / rise) * math.exp(-decay * max(0.0, u - rise))


def to_b(v):
    return Vector((v[0], -v[2], v[1]))


def principal_axis(pts, origin):
    """Main direction of a point cloud (power iteration), oriented from `origin` toward its centroid."""
    c = sum(pts, Vector()) / len(pts)
    m = [[sum((p[i] - c[i]) * (p[j] - c[j]) for p in pts) for j in range(3)] for i in range(3)]
    v = Vector((0.3, -0.5, 0.8))
    for _ in range(40):
        v = Vector([sum(m[i][j] * v[j] for j in range(3)) for i in range(3)])
        if v.length < 1e-12:
            return Vector((0, 0, 1))
        v.normalize()
    return v if v.dot(c - origin) >= 0 else -v


# ------------------------------------------------------------------ character

# Per-character pose adjustments ("poses" in art-src/rig/landmarks/<key>.json), all optional.
POSE_DEFAULTS = {
    'head_margin': 0.1,    # gap kept between arms / hands / weapons and the head (game units)
    'torso_margin': 0.02,  # the same against the torso (only deep penetration is corrected)
    'leg_margin': 0.02,    # the same against the thighs and shins
    'head_scale': [1, 1, 1],   # the head volume (an ellipsoid in the Head-weighted box): stretch it
    'head_shift': [0, 0, 0],   # ... and move it (e.g. to cover a hood, horns, gills)
    'torso_scale': [1, 1, 1],
    'torso_shift': [0, 0, 0],
    'leg_radius': None,        # thigh / shin thickness (measured when None)
    'shrug': 1.0,              # scale of the shoulder shrugs (sigh, flinch, shiver)
    'head_motion': 1.0,        # scale of the head turns and tilts (a big head brushing its pads)
    'reach': 0.9,              # IK: fraction of the arm's length a hand may reach (elbow stays bent)
    'raise_fore': None,        # Wave / Cheer forearm direction for the LEFT arm (mirrored), None = upright
    'resolve': True,       # every frame: swing an arm away from the head / torso when it goes through
    'up_forward': -0.12,   # raised arms lean forward (-y) or back (+y)
    'carry': {},           # {"R": [x, y, z]}: rest direction of the weapon (guns) or of the arm
    'aim': {},             # {"R": [x, y, z]}: aiming direction of the weapon / fist
    'throw_raise': -2.6,   # throwers: arm pitch of the cocked throw
    'mouth': [0, 0, 0],    # shift of the coughing hand's target (in front of the mouth)
    'watch': [0, 0, 0],    # shift of the watch-checking hand's target (in front of the chest)
}


class Char:
    """Rest data of one rigged character: bone rests, limb lengths, arm poses by weapon style, and
    the head / torso volumes the arms must stay out of."""

    def __init__(self, d, rig):
        self.key, self.style, self.weapon, self.H = d['key'], d['style'], d['weapon'], d['height']
        self.rig = rig
        self.over = {**POSE_DEFAULTS, **d.get('poses', {})}
        bones = rig.data.bones
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in bones}
        self.head = {b.name: b.head_local.copy() for b in bones}
        self.tail = {b.name: b.tail_local.copy() for b in bones}
        M = d.get('measure', {})
        ell = lambda box: ((Vector(box[0]) + Vector(box[1])) / 2, (Vector(box[1]) - Vector(box[0])) / 2)
        self.head_ell = ell(M['head']) if 'head' in M else (self.head['Head'] + Vector((0, 0, 0.5)), Vector((0.5, 0.5, 0.5)))
        self.torso_ell = ell(M['torso']) if 'torso' in M else None
        o = self.over
        mul = lambda a, b: Vector([a[i] * b[i] for i in range(3)])
        self.head_ell = (self.head_ell[0] + Vector(o['head_shift']), mul(self.head_ell[1], o['head_scale']))
        if self.torso_ell:
            self.torso_ell = (self.torso_ell[0] + Vector(o['torso_shift']), mul(self.torso_ell[1], o['torso_scale']))
        self.leg_r = o['leg_radius'] or M.get('leg_radius', 0.1)
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.chains = {}
        self.wcorners = {}
        for s_, box in M.get('weapon', {}).items():
            lo, hi = Vector(box[0]), Vector(box[1])
            self.wcorners[s_] = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)] + [(lo + hi) / 2]
        # surface samples of each arm piece and weapon (rig_blender.measure): what really collides
        self.samples = {k: [Vector(p) for p in v] for k, v in M.get('samples', {}).items()}
        self.wax = {}
        for s_ in 'LR':  # the weapon's axis from its own mesh (grip included), pointing to its bulk
            pts = self.samples.get('weapon' + s_)
            if pts and len(pts) > 4:
                self.wax[s_] = principal_axis(pts, self.head[SIDE[s_][0] + 'Hand'])
        self.cache = {}
        self.rest_k = None
        self.kinds = {}
        self.free = 'R' if self.weapon == 'L' else 'L'  # the hand that waves, coughs, cheers
        self.hang, self.aim, self.axis, self.wpn = {}, {}, {}, {}
        for s, sg in (('L', 1), ('R', -1)):
            J = d['joints'][s]
            side = SIDE[s][0]
            # the arm as rigged (landmarks), the weapon as found on the mesh by autorig.mjs
            self.axis[s] = (self.head[side + 'ForeArm'] - self.head[side + 'Arm']).normalized()
            self.wpn[s] = self.wax.get(s) or to_b(J['weaponAxis'])
            armed = self.armed(s)
            carry = self.over['carry'].get(s)
            if carry:
                self.hang[s] = between(self.wpn[s] if armed and self.style == 'gun' else self.axis[s], Vector(carry))
            elif armed and self.style == 'gun':
                self.hang[s] = between(self.wpn[s], Vector((sg * 0.12, -0.65, -0.75)))
            elif armed and self.style == 'staff':
                self.hang[s] = between(self.axis[s], Vector((sg * 0.45, -0.1, -0.9)))
            else:
                self.hang[s] = between(self.axis[s], Vector((sg * 0.18, -0.08, -1)))
            fwd = Vector(self.over['aim'].get(s, (sg * 0.06, -1, -0.06)))
            self.aim[s] = (between(self.wpn[s], fwd) if self.style == 'gun' else between(self.axis[s], fwd)) \
                if armed and self.style in ('gun', 'cast') else None
        # legs, for the IK: hip, knee, ankle in the side plane (y, z)
        self.leg = {}
        for s, side in (('L', 'Left'), ('R', 'Right')):
            hip, knee, ankle = self.head[side + 'UpLeg'], self.head[side + 'Leg'], self.head[side + 'Foot']
            self.leg[s] = (hip, knee, ankle)
        self.hips_z = self.head['Hips'].z
        # elbow hinge: bending by a negative angle brings the forearm forward, whatever the rest pose
        self.fore_rest, self.hinge = {}, {}
        for s, (side, _) in SIDE.items():
            b = bones[side + 'ForeArm']
            self.fore_rest[s] = (b.tail_local - b.head_local).normalized()
            h = Vector((0, -1, 0)).cross(self.fore_rest[s])
            self.hinge[s] = h.normalized() if h.length > 1e-3 else X.copy()

    def armed(self, s):
        return self.weapon == 'both' or self.weapon == s

    def arm_to(self, s, direction, weapon=False):
        return between(self.wpn[s] if weapon else self.axis[s], Vector(direction))

    def chain(self, bone):
        """Bones from the root down to `bone`."""
        if bone not in self.chains:
            out, b = [], bone
            while b:
                out.append(b)
                b = self.parent[b]
            self.chains[bone] = out[::-1]
        return self.chains[bone]

    def to_world(self, P, bone, p):
        """A rest point carried by `bone`, posed (armature frame)."""
        for b in reversed(self.chain(bone)):
            h = self.head[b]
            p = P.get(b) @ (p - h) + h
        return p + P.loc

    def to_local(self, P, bone, p):
        """A posed point back into `bone`'s rest frame."""
        p = p - P.loc
        for b in self.chain(bone):
            h = self.head[b]
            p = P.get(b).inverted() @ (p - h) + h
        return p

    def turn(self, P, bone):
        """Total rotation of `bone` (its deltas, root first)."""
        r = Quaternion()
        for b in self.chain(bone):
            r = r @ P.get(b)
        return r

    def arm_points(self, P, s):
        """(kind, posed point) on the arm, fist and weapon surfaces, in the armature frame (bone-line
        points when the rig has no surface samples)."""
        side = SIDE[s][0]
        S, E0, W0, T0 = self.head[side + 'Arm'], self.head[side + 'ForeArm'], self.head[side + 'Hand'], self.tail[side + 'Hand']
        sm = self.samples
        if sm:
            # 'pad': near the shoulder pivot, a swing of the arm can't move them (the shrug can)
            pts = [('pad', self.to_world(P, side + 'Shoulder', p)) for p in sm.get(side + 'Shoulder', [])]
            pts += [('pad' if (p - S).length < 0.12 else 'upper', self.to_world(P, side + 'Arm', p))
                    for p in sm.get(side + 'Arm', [])]
            pts += [('lower', self.to_world(P, side + 'ForeArm', p)) for p in sm.get(side + 'ForeArm', [])]
            pts += [('lower', self.to_world(P, side + 'Hand', p)) for p in sm.get(side + 'Hand', [])]
            pts += [('weapon', self.to_world(P, side + 'Hand', p)) for p in sm.get('weapon' + s, [])]
            return pts
        pts = [('upper', self.to_world(P, side + 'Arm', S.lerp(E0, k))) for k in (0.2, 0.6, 1.0)]
        pts += [('lower', self.to_world(P, side + 'ForeArm', E0.lerp(W0, k))) for k in (0.5, 1.0)]
        pts += [('lower', self.to_world(P, side + 'Hand', W0.lerp(T0, k))) for k in (0.5, 1.0)]
        pts += [('weapon', self.to_world(P, side + 'Hand', c)) for c in self.wcorners.get(s, [])]
        return pts

    def clearance(self, P, s, movable=False):
        """How far the arm stays out of the head, and its hand / weapon (deeply) out of the torso
        and the legs: < 0 = inside, in units of the volume's size. Returns (value, posed centre of the
        volume it hits)."""
        o = self.over
        c, r = self.head_ell
        best = (1e9, c)
        if self.rest_k is None:  # what already touches in the rest pose is allowed to stay there
            self.rest_k = {}
            rest = Pose(self)
            for s_ in 'LR':
                self.rest_k[s_] = [min(0.0, k) for k in self._point_ks(rest, s_)]
        if s not in self.kinds:
            self.kinds[s] = [kind for kind, _ in self.arm_points(Pose(self), s)]
        ks = self._point_ks(P, s, centres=True)
        for (k, ctr), k0, kind in zip(ks, self.rest_k[s], self.kinds[s]):
            if movable and kind == 'pad':
                continue
            k = k - k0
            if k < best[0]:
                best = (k, ctr)
        return best

    def _point_ks(self, P, s, centres=False):
        o = self.over
        c, r = self.head_ell
        out = []
        legs = []
        for side_ in ('Left', 'Right'):
            hip = self.to_world(P, side_ + 'UpLeg', self.head[side_ + 'UpLeg'])
            knee = self.to_world(P, side_ + 'Leg', self.head[side_ + 'Leg'])
            ankle = self.to_world(P, side_ + 'Foot', self.head[side_ + 'Foot'])
            toe = self.to_world(P, side_ + 'Foot', self.head[side_ + 'ToeBase'])
            legs += [(hip, knee), (knee, ankle), (ankle, toe)]
        hc = self.to_world(P, 'Head', c) if centres else None
        for kind, p in self.arm_points(P, s):
            v = self.to_local(P, 'Head', p) - c
            best = (math.sqrt(sum((v[i] / (r[i] + o['head_margin'])) ** 2 for i in range(3))) - 1, hc)
            if kind not in ('upper', 'pad'):
                if self.torso_ell:
                    tc, tr = self.torso_ell
                    v = self.to_local(P, 'Spine1', p) - tc
                    k = math.sqrt(sum((v[i] / (tr[i] * 0.9 + o['torso_margin'])) ** 2 for i in range(3))) - 1
                    if k < best[0]:
                        best = (k, self.to_world(P, 'Spine1', tc) if centres else None)
                for a, b_ in legs:
                    ab = b_ - a
                    t = min(1.0, max(0.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
                    near = a + ab * t
                    k = (p - near).length / (self.leg_r + o['leg_margin']) - 1
                    if k < best[0]:
                        best = (k, near)
            out.append(best if centres else best[0])
        return out

    def up_dir(self, s, fore_bend=-0.3, forward=None):
        """The highest raised-arm direction (out to the side and up) that keeps the fist and the
        weapon clear of the big chibi head."""
        key = ('up', s, fore_bend, forward)
        if key in self.cache:
            return self.cache[key]
        sg = SIDE[s][1]
        fwd = self.over['up_forward'] if forward is None else forward
        P = Pose(self)
        out = None
        for deg in range(85, -31, -5):
            e = math.radians(deg)
            out = Vector((sg * math.cos(e), fwd, math.sin(e))).normalized()
            P.arm(s, self.arm_to(s, out))
            P.fore(s, fore_bend)
            if self.clearance(P, s, movable=True)[0] >= 0.05:  # room for breathing and bobbing
                break
        self.cache[key] = out
        return out


SIDE = {'L': ('Left', 1), 'R': ('Right', -1)}


class Pose:
    def __init__(self, C):
        self.C = C
        self.r = {}
        self.loc = Vector()

    def get(self, b):
        return self.r.get(b, I)

    def set(self, b, rot):
        self.r[b] = rot

    def pre(self, b, rot):
        """Rotate bone b further, in the armature frame (after what it already has)."""
        self.r[b] = rot @ self.get(b)

    def spine(self, x=0.0, y=0.0, z=0.0):
        for b in ('Spine', 'Spine1', 'Spine2'):
            self.pre(b, E3(x / 3, y / 3, z / 3))

    def head(self, x=0.0, y=0.0, z=0.0):
        k = self.C.over['head_motion']
        x, y, z = x * k, y * k, z * k
        self.pre('Neck', E3(x * 0.3, y * 0.3, z * 0.3))
        self.pre('Head', E3(x * 0.7, y * 0.7, z * 0.7))

    def hips(self, x=0.0, y=0.0, z=0.0):
        self.pre('Hips', E3(x, y, z))

    def arm(self, s, rot):
        self.set(SIDE[s][0] + 'Arm', rot)

    def fore(self, s, bend=0.0, yaw=0.0, _unused=0.0):
        """Elbow bend (negative = forearm forward / up), plus a turn about the vertical."""
        self.set(SIDE[s][0] + 'ForeArm', q(Z, yaw) @ q(self.C.hinge[s], bend))

    def fore_to(self, s, direction):
        """Point the forearm along a direction of the torso frame, whatever the upper arm does."""
        arm = self.get(SIDE[s][0] + 'Arm')
        local = arm.inverted() @ Vector(direction).normalized()
        self.set(SIDE[s][0] + 'ForeArm', between(self.C.fore_rest[s], local))

    def reach(self, s, target, pole):
        """Two-bone IK: the wrist on `target` (torso frame), the elbow toward `pole`."""
        C = self.C
        side = SIDE[s][0]
        S, E0, W0 = C.head[side + 'Arm'], C.head[side + 'ForeArm'], C.head[side + 'Hand']
        l1, l2 = (E0 - S).length, (W0 - E0).length
        d = Vector(target) - S
        D = min(max(d.length, abs(l1 - l2) + 1e-3), (l1 + l2) * C.over['reach'])  # out of reach: bent elbow, pointing at it
        u = d.normalized()
        a = (l1 * l1 - l2 * l2 + D * D) / (2 * D)
        h = math.sqrt(max(0.0, l1 * l1 - a * a))
        p = Vector(pole)
        p = p - u * p.dot(u)
        p = p.normalized() if p.length > 1e-6 else Vector((SIDE[s][1], 0, 0))
        E, W = S + u * a + p * h, S + u * D
        Ra = between(E0 - S, E - S)
        self.set(side + 'Arm', Ra)
        self.set(side + 'ForeArm', between(W0 - E0, Ra.inverted() @ (W - E)))

    def point_weapon(self, s, direction, k=1.0):
        """Turn the hand so the weapon points along `direction` (torso frame), blended by k."""
        side = SIDE[s][0]
        Raf = self.get(side + 'Arm') @ self.get(side + 'ForeArm')
        turn = between(self.C.wpn[s], Raf.inverted() @ Vector(direction))
        self.set(side + 'Hand', self.get(side + 'Hand').slerp(turn, k))

    def shoulder(self, s, raise_):
        self.set(SIDE[s][0] + 'Shoulder', q(Y, -SIDE[s][1] * raise_ * self.C.over['shrug']))

    def leg_fk(self, s, thigh=0.0, shin=0.0, foot=0.0, out=0.0):
        side, sg = SIDE[s]
        self.set(side + 'UpLeg', E3(thigh, 0, sg * out))
        self.set(side + 'Leg', q(X, shin))
        self.set(side + 'Foot', q(X, foot))

    def leg_ik(self, s, dy=0.0, dz=0.0, dx=0.0, foot=0.0):
        """Plant the ankle at its rest spot + (dx, dy, dz), given the hips offset/pitch already set."""
        C = self.C
        hip, knee, ankle = C.leg[s]
        hp = self.get('Hips')
        pitch = 2 * math.atan2(hp.x, hp.w) if abs(hp.w) > 1e-6 else 0.0  # hips pitch (small yaw ignored)
        h = Vector((hip.y + self.loc.y, hip.z + self.loc.z))
        t = Vector((ankle.y + dy, ankle.z + dz))
        l1 = (knee - hip).length
        l2 = (ankle - knee).length
        d = t - h
        D = min(d.length, (l1 + l2) * 0.999)
        ang = lambda v: math.atan2(v.x, -v.y)  # 0 = straight down, + = toward +y (back)
        th_d = ang(d)
        phi = math.acos(max(-1.0, min(1.0, (l1 * l1 + D * D - l2 * l2) / (2 * l1 * D))))
        th1 = th_d - phi  # knee forward
        k = h + Vector((math.sin(th1), -math.cos(th1))) * l1
        th2 = ang(t - k)
        r1 = ang(Vector((knee.y - hip.y, knee.z - hip.z)))
        r2 = ang(Vector((ankle.y - knee.y, ankle.z - knee.z)))
        side, sg = SIDE[s]
        spread = math.atan2(dx, max(0.2, D)) * sg
        self.set(side + 'UpLeg', q(Y, spread) @ q(X, th1 - r1 - pitch))
        self.set(side + 'Leg', q(X, (th2 - r2) - (th1 - r1)))
        self.set(side + 'Foot', q(X, -(th2 - r2) + foot))


# ------------------------------------------------------------------ building blocks

def stance(C, t, breath_amp=1.0):
    """Relaxed idle: breathing, weight shift, arms at rest."""
    P = Pose(C)
    br, sh = math.sin(TAU * t / 2.0), math.sin(TAU * t / 4.0)
    P.loc.x = sh * 0.015
    P.hips(0, 0, sh * 0.02)
    P.spine(-br * 0.015 * breath_amp)
    P.head(-br * 0.01, math.sin(TAU * t / 4.0 + 1) * 0.2 * breath_amp)
    for s in ('L', 'R'):
        P.arm(s, q(X, br * 0.02) @ C.hang[s])
        P.fore(s, -0.12)
    P.leg_fk('L', -0.03, 0.06, -0.03, 0.03)
    P.leg_fk('R', -0.03, 0.06, -0.03, 0.03)
    return P


def crouch(C, t, drop, lean, feet_dy=(0.0, 0.0), feet_dz=(0.0, 0.0), spread=0.03):
    """Knees bent, torso leaning over: the bush / sneak base."""
    P = Pose(C)
    P.loc.z = -drop
    P.loc.y = drop * 0.35  # sit back over the heels
    P.hips(lean * 0.3)
    P.spine(lean * 0.7)
    P.head(-lean * 0.8)  # eyes stay on the horizon
    P.leg_ik('L', feet_dy[0], feet_dz[0], spread)
    P.leg_ik('R', feet_dy[1], feet_dz[1], -spread)
    for s in ('L', 'R'):
        P.arm(s, q(X, -0.25) @ C.hang[s])
        P.fore(s, -0.5)
    return P


def aim_arms(P, C, r, amount=1.0):
    """Weapon arm(s) up: guns / fists straight ahead, bombs cocked overhead, the staff thrust out.
    r is the recoil (0 = aiming, 1 = right after the shot)."""
    for s in ('L', 'R'):
        if not C.armed(s):
            continue
        if C.aim[s] is not None:
            target = q(X, -r * 0.45) @ C.aim[s]
        elif C.style == 'throw':
            target = q(X, C.over['throw_raise'] + r * 1.8) @ C.hang[s]
        else:  # staff
            target = q(X, -0.55 - r * 0.6) @ C.hang[s]
        P.arm(s, P.get(SIDE[s][0] + 'Arm').slerp(target, amount))
        P.fore(s, lerp(-0.12, 0.0, amount))
    P.spine(-r * 0.14 * amount)
    P.head(r * 0.05 * amount)


def blend_arm(P, s, target, k, fore=None, fore_dir=None):
    """Blend an arm toward a pose: `fore` = (bend, yaw), or `fore_dir` = forearm direction."""
    b, fb = SIDE[s][0] + 'Arm', SIDE[s][0] + 'ForeArm'
    old_fore = P.get(fb)
    P.set(b, P.get(b).slerp(target, k))
    if fore_dir is not None:
        P.set(fb, old_fore)
        tmp = Pose(P.C)
        tmp.set(b, target)
        tmp.fore_to(s, fore_dir)
        P.set(fb, old_fore.slerp(tmp.get(fb), k))
    elif fore is not None:
        tmp = Pose(P.C)
        tmp.fore(s, *fore)
        P.set(fb, old_fore.slerp(tmp.get(fb), k))


def resolve(C, P, s, step=0.05, steps=40, patience=6):
    """Safety net, every frame: while an arm (or its fist or weapon) is inside the head, deep in the
    torso or in a leg, swing it away from that volume about the shoulder, straightening the elbow.
    Shoulder pads (which a swing can't move) are only helped by dropping the shrug; the best pose
    found is kept, and the search stops when it no longer improves."""
    side = SIDE[s][0]
    k, centre = C.clearance(P, s)
    if k >= -1e-3:
        return
    if P.get(side + 'Shoulder') != I:  # a shrug pushing the pad into the head: drop it first
        for _ in range(4):
            P.set(side + 'Shoulder', P.get(side + 'Shoulder').slerp(I, 0.5))
            k, centre = C.clearance(P, s)
            if k >= -1e-3:
                return
    k, centre = C.clearance(P, s, movable=True)
    if k >= -1e-3:
        return
    best = (k, P.get(side + 'Arm'), P.get(side + 'ForeArm'))
    stale = 0
    for i in range(steps):
        S = C.to_world(P, side + 'Arm', C.head[side + 'Arm'])
        W = C.to_world(P, side + 'Hand', C.head[side + 'Hand'])
        d = (W - S).normalized()
        away = W - centre
        away = away - d * away.dot(d)
        away = away.normalized() if away.length > 1e-5 else Vector((SIDE[s][1], 0, 0))
        axis = C.turn(P, side + 'Shoulder').inverted() @ d.cross(away)  # into the arm's parent frame
        P.set(side + 'Arm', q(axis.normalized(), step) @ P.get(side + 'Arm'))
        if i % 3 == 2:  # a little less elbow bend too
            P.set(side + 'ForeArm', P.get(side + 'ForeArm').slerp(I, 0.15))
        k, centre = C.clearance(P, s, movable=True)
        if k >= -1e-3:
            return
        if k > best[0] + 1e-3:
            best, stale = (k, P.get(side + 'Arm'), P.get(side + 'ForeArm')), 0
        else:
            stale += 1
            if stale >= patience:
                break
    P.set(side + 'Arm', best[1])
    P.set(side + 'ForeArm', best[2])


def blend_reach(P, s, target, pole, k):
    """Blend an arm toward an IK pose (wrist on target)."""
    side = SIDE[s][0]
    tmp = Pose(P.C)
    tmp.reach(s, target, pole)
    for b in ('Arm', 'ForeArm'):
        P.set(side + b, P.get(side + b).slerp(tmp.get(side + b), k))


# ------------------------------------------------------------------ clips

def c_idle(C, t):
    return stance(C, t)


def c_run(C, t, dur=0.6):
    """The old procedural jog (brawler.js), one stride. Thighs swing, the knee folds while its leg
    travels forward, the pelvis twists and bobs, chest counter-twists, arms swing against the legs."""
    ph = TAU * t / dur
    s, c, bob = math.sin(ph), math.cos(ph), 0.5 + 0.5 * math.cos(2 * ph)
    P = Pose(C)
    P.leg_fk('L', -s * 0.5, max(0.0, c) * 0.75, max(0.0, -c) * 0.3 - max(0.0, c) * 0.2, 0.03)
    P.leg_fk('R', s * 0.5, max(0.0, -c) * 0.75, max(0.0, c) * 0.3 - max(0.0, -c) * 0.2, 0.03)
    P.loc.z = (bob - 0.6) * 0.07
    P.hips(0.04, -s * 0.16, -c * 0.07)
    P.spine(0.1, s * 0.24, c * 0.05)
    P.head(-0.08 + math.cos(2 * ph) * 0.035, -s * 0.12, -c * 0.04)
    for side, sg in (('L', 1), ('R', -1)):
        armed = C.armed(side) and C.style in ('gun', 'staff')
        P.arm(side, q(X, sg * s * (0.18 if armed else 0.42)) @ C.hang[side])
        P.fore(side, -0.12 - (0.15 + max(0.0, -sg * s) * 0.35))
    return P


def feet_cycle(u, stride, lift, stance_frac=0.62):
    """Foot offset (dy, dz) along a stride: planted and sliding back, then lifted forward."""
    if u < stance_frac:
        return lerp(-stride / 2, stride / 2, u / stance_frac), 0.0
    v = (u - stance_frac) / (1 - stance_frac)
    return lerp(stride / 2, -stride / 2, ease(v)), lift * math.sin(math.pi * v)


def c_sneak(C, t, dur=1.1):
    """Crouched tiptoe through the tall grass, looking around."""
    u = t / dur
    ph = TAU * u
    fl = feet_cycle(u % 1, 0.34, 0.1)
    fr = feet_cycle((u + 0.5) % 1, 0.34, 0.1)
    P = crouch(C, t, 0.2 + 0.015 * math.cos(2 * ph), 0.32, (fl[0], fr[0]), (fl[1], fr[1]), 0.05)
    P.hips(0, math.sin(ph) * 0.08, 0)
    P.head(0, math.sin(ph) * 0.25, 0)
    for side, sg in (('L', 1), ('R', -1)):
        P.pre(SIDE[side][0] + 'Arm', q(X, sg * math.sin(ph) * 0.12))
    return P


def peek(t):
    """Head yaw of the bush lookout: glance left, hold, glance right, hold, back (5 s loop)."""
    keys = [(0, 0), (0.6, 0), (1.1, 0.6), (1.9, 0.6), (2.5, -0.55), (3.4, -0.55), (3.9, 0), (5.0, 0)]
    for (t0, a0), (t1, a1) in zip(keys, keys[1:]):
        if t <= t1:
            return lerp(a0, a1, ease((t - t0) / (t1 - t0)))
    return 0.0


def c_bush(C, t):
    """Hiding in a bush: squatting low, peeking left and right, rising a little to look."""
    look = abs(peek(t))
    br = math.sin(TAU * t / 2.5)
    P = crouch(C, t, 0.24 - look * 0.06, 0.3 - look * 0.12)
    P.head(-br * 0.02, peek(t), -peek(t) * 0.15)
    P.spine(br * 0.02, peek(t) * 0.25)
    return P


def c_slide(C, t, dur=1.0):
    """Sliding on ice: arms wide and windmilling, wobbling on bent knees."""
    ph = TAU * t / dur
    P = Pose(C)
    P.loc.z = -0.08
    P.hips(0.05, 0, math.sin(ph) * 0.12)
    P.spine(0.1, math.sin(ph) * 0.1, -math.sin(ph) * 0.2)
    P.head(-0.15, 0, math.sin(ph + 1) * 0.15)
    P.leg_ik('L', -0.12, 0.0, 0.07, 0.0)
    P.leg_ik('R', 0.14, 0.0, -0.07, 0.0)
    for s, sg in (('L', 1), ('R', -1)):
        base = C.arm_to(s, (sg * 0.95, -0.05, 0.2))
        P.arm(s, q(X, math.sin(ph * 2 + (0 if sg > 0 else math.pi)) * 0.6) @ base)
        P.fore(s, -0.2)
    return P


def c_aim(C, t, dur=1.0):
    P = stance(C, 0, 0.0)
    br = math.sin(TAU * t / dur)
    aim_arms(P, C, 0.0)
    P.spine(br * 0.01)
    return P


def c_shoot(C, t):
    P = stance(C, 0, 0.0)
    r = kick(t, 0.02, 0.04 if C.style != 'throw' else 0.08, 7.0)
    aim_arms(P, C, r)
    return P


def c_super(C, t):
    """Each style's big move."""
    P = stance(C, 0, 0.0)
    st = C.style
    if st == 'gun':  # brace, huge kick back, recover
        b = env(t, 0.0, 0.25, 0.8, 1.05)
        r = kick(t, 0.3, 0.05, 4.0)
        P.loc.y = r * 0.18
        P.loc.z = -0.1 * b
        P.hips(-0.1 * r)
        P.leg_ik('L', -0.1 * b - r * 0.18, 0, 0.08 * b)
        P.leg_ik('R', 0.08 * b - r * 0.18, 0, -0.08 * b)
        aim_arms(P, C, 0.0, b)
        for s in ('L', 'R'):
            if C.armed(s):
                P.pre(SIDE[s][0] + 'Arm', q(X, -r * 0.9 * b))
        P.spine(-0.35 * r)
        P.head(-0.2 * r)
    elif st == 'throw':  # two-handed heave of the barrel bomb
        wind = ramp(t, 0.0, 0.35) * (1 - ramp(t, 0.4, 0.52))
        fling = env(t, 0.4, 0.52, 0.75, 1.1)
        up = Vector((0, 0.25, 0.95))
        for s, sg in (('L', 1), ('R', -1)):
            over = C.arm_to(s, C.up_dir(s, -0.6, 0.25))  # overhead, behind the head
            ahead = C.arm_to(s, (sg * 0.2, -0.95, -0.1))
            blend_arm(P, s, over, wind, (-0.6, 0, 0))
            blend_arm(P, s, ahead, fling, (-0.1, 0, 0))
        P.spine(-0.4 * wind + 0.45 * fling)
        P.head(-0.3 * wind + 0.1 * fling)
        P.loc.z = 0.12 * math.sin(math.pi * clamp01((t - 0.42) / 0.25))
        P.loc.y = -0.1 * fling
        P.leg_ik('L', -0.12 * (wind + fling), 0, 0.04)
        P.leg_ik('R', 0.1 * (wind + fling), 0, -0.04)
    elif st == 'staff':  # hop and slam the staff: frost nova
        crouch1 = env(t, 0.0, 0.18, 0.2, 0.3)
        air = clamp01((t - 0.25) / 0.3)
        slam = env(t, 0.52, 0.58, 0.75, 1.1)
        P.loc.z = -0.12 * crouch1 + 0.38 * math.sin(math.pi * air) * (t < 0.55) - 0.14 * slam
        P.loc.y = 0.06 * slam
        P.hips(0.08 * slam)
        P.spine(0.1 * crouch1 - 0.2 * (0.25 < t < 0.55) + 0.22 * slam)
        tuck = math.sin(math.pi * air) * (t < 0.55)
        for s in ('L', 'R'):
            P.leg_ik(s, 0, max(0.0, P.loc.z) + 0.12 * tuck, 0.05 if s == 'L' else -0.05)
        for s in ('L', 'R'):
            if C.armed(s):
                sg = SIDE[s][1]
                up = ramp(t, 0.15, 0.4) * (1 - ramp(t, 0.5, 0.58))
                # raised high in front, then driven down into the ground in front of the feet
                # lifted in front, then driven down: the staff stays upright, crystal up, beside the body
                blend_arm(P, s, C.arm_to(s, (sg * 0.5, -0.55, 0.25)), up, (-0.3, 0, 0))
                blend_arm(P, s, C.arm_to(s, (sg * 0.45, -0.55, -0.6)), slam, (0, 0, 0))
                if s in C.wcorners:
                    P.point_weapon(s, (sg * 0.05, -0.1, 1.0), max(up, slam))
            else:
                blend_arm(P, s, C.arm_to(s, (0.85 if s == 'L' else -0.85, 0, 0.3)), ramp(t, 0.2, 0.4) * (1 - ramp(t, 0.8, 1.1)), (-0.3, 0, 0))
        P.head(-0.2 * tuck - 0.1 * slam)
    else:  # cast: arms to the sky, lifted off the ground by the storm
        lift = env(t, 0.1, 0.35, 0.75, 1.05)
        tremble = math.sin(t * 60) * 0.03 * lift
        P.loc.z = 0.22 * lift
        P.hips(-0.1 * lift)
        P.spine(-0.25 * lift, 0, tremble)
        P.head(-0.45 * lift)
        for s, sg in (('L', 1), ('R', -1)):
            blend_arm(P, s, C.arm_to(s, C.up_dir(s, -0.1, 0.1)), lift, (-0.1 + tremble, 0, 0))
            P.leg_fk(s, -0.1 * lift, 0.5 * lift, 0.35 * lift, 0.05)
    return P


def c_hit(C, t):
    """Flinch: snapped back, shoulders up, knees give (played additively in game)."""
    e = kick(t, 0.0, 0.05, 11.0)
    P = stance(C, 0, 0.0)
    P.loc.y = 0.06 * e
    P.loc.z = -0.04 * e
    P.hips(-0.1 * e)
    P.spine(-0.4 * e, 0, 0.1 * e)
    P.head(-0.3 * e, 0, -0.12 * e)
    for s in ('L', 'R'):
        P.pre(SIDE[s][0] + 'Arm', q(X, 0.35 * e))
        P.shoulder(s, 0.3 * e)
    P.leg_ik('L', 0, 0)
    P.leg_ik('R', 0, 0)
    return P


def c_death(C, t):
    """Knocked out: staggers back, knees buckle, falls flat on the back with a little bounce."""
    P = stance(C, 0, 0.0)
    stag = ramp(t, 0.0, 0.22)
    fall = ease(clamp01((t - 0.18) / 0.5)) ** 1.6
    bounce = math.sin(math.pi * clamp01((t - 0.68) / 0.22)) * 0.06
    P.loc.y = 0.1 * stag + 0.35 * fall
    P.loc.z = -(C.hips_z - 0.3) * fall + bounce
    P.hips(-0.2 * stag - 1.35 * fall)
    P.spine(-0.3 * stag + 0.1 * fall, 0, 0.1 * stag)
    P.head(-0.4 * stag + 0.25 * fall, 0.5 * ramp(t, 0.7, 1.0), 0.2 * fall)
    for s, sg in (('L', 1), ('R', -1)):
        fling = C.arm_to(s, (sg * 0.7, 0.35, 0.6))
        flop = C.arm_to(s, (sg * 0.95, 0.2, 0.1))
        blend_arm(P, s, fling, stag * (1 - fall), (-0.5, 0, 0))
        blend_arm(P, s, flop, fall, (-0.25, 0, 0))
        P.leg_fk(s, 0.35 * fall - 0.2 * stag, 0.25 * stag + 0.35 * fall, 0.2 * fall, 0.08 * fall)
    return P


def c_victory(C, t, dur=1.2):
    """Jumping for joy, fists in the air (loops)."""
    squat = env(t, 0.0, 0.2, 0.22, 0.32) + env(t, 0.78, 0.88, 0.95, 1.2)
    air = clamp01((t - 0.28) / 0.52)
    hop = math.sin(math.pi * air) * (0.28 <= t <= 0.8)
    P = stance(C, t, 0.0)
    P.loc.z = -0.14 * squat + 0.42 * hop
    P.hips(0.12 * squat - 0.05 * hop)
    P.spine(0.15 * squat - 0.15 * hop)
    P.head(-0.3 + 0.2 * squat)
    for s in ('L', 'R'):
        P.leg_ik(s, 0.05 * hop, 0.5 * hop, 0.04 if s == 'L' else -0.04)
    pump = math.sin(TAU * t / dur * 2)
    for s, sg in (('L', 1), ('R', -1)):
        up = C.up_dir(s, -0.35)  # as high as the head lets the fists go
        P.arm(s, q(Y, -sg * 0.1 * (1 + pump)) @ C.arm_to(s, up))
        P.fore(s, -0.35 - 0.25 * (0.5 + 0.5 * pump))
    return P


def c_wave(C, t):
    """Hello! Raised hand swinging side to side."""
    s = C.free
    sg = SIDE[s][1]
    e = env(t, 0.1, 0.45, 1.75, 2.2)
    P = stance(C, t, 0.6)
    side = SIDE[s][0]
    raised = C.arm_to(s, C.up_dir(s, -1.0))
    w = math.sin(TAU * 2.4 * t)
    # upper arm out, forearm upright and swinging side to side, clear of the face
    rf = C.over['raise_fore']
    fd = (sg * (rf[0] + 0.35 * w), rf[1], rf[2]) if rf else (sg * (0.35 + 0.35 * w), -0.2, 1)
    blend_arm(P, s, raised, e, fore_dir=fd)
    P.head(0.05 * e, sg * 0.15 * e, -sg * 0.18 * e)
    P.hips(0, 0, -sg * 0.05 * e)
    return P


def c_bored(C, t):
    """Impatient: a big sigh, foot tapping while checking the watch, a head shake."""
    P = stance(C, t, 0.7)
    s = C.free
    side, sg = SIDE[s]
    sigh = env(t, 0.1, 0.55, 0.7, 1.2)
    slump = env(t, 1.0, 1.35, 3.8, 4.4)
    for a in ('L', 'R'):
        P.shoulder(a, 0.35 * sigh - 0.1 * slump)
    P.spine(-0.1 * sigh + 0.1 * slump)
    P.head(-0.3 * sigh)
    # watch: forearm up across the chest, head tilted down toward it
    watch = env(t, 1.4, 1.8, 3.1, 3.5)
    tc, tr = C.torso_ell or (C.head['Spine2'], Vector((0.3, 0.3, 0.3)))
    target = Vector((-sg * 0.02, tc.y - tr.y - 0.14, C.head['Spine2'].z)) + Vector(C.over['watch'])
    blend_reach(P, s, target, (sg, 0.4, -0.6), watch)  # wrist in front of the chest
    if C.armed(s) and s in C.wcorners:  # the weapon held down and out of the way
        P.point_weapon(s, (sg * 0.6, -0.2, -0.8), watch)
    P.head(0.35 * watch, sg * 0.35 * watch, 0)
    # foot tap on the other foot
    tapper = 'R' if s == 'L' else 'L'
    tap = env(t, 1.2, 1.4, 3.9, 4.1) * (0.5 - 0.5 * math.cos(TAU * 2.5 * (t - 1.2)))
    fb = SIDE[tapper][0] + 'Foot'
    P.pre(fb, q(X, -0.45 * tap))
    P.pre(SIDE[tapper][0] + 'UpLeg', q(X, -0.06 * tap))
    # tut-tut head shake
    shake = env(t, 3.5, 3.7, 4.3, 4.6)
    P.head(0, math.sin(TAU * 2.2 * (t - 3.5)) * 0.22 * shake, 0)
    return P


def c_fidget(C, t):
    """A personal idle flourish, one per brawler."""
    P = stance(C, t, 0.6)
    k = C.key
    if k == 'blaster':  # rests the shotgun on the shoulder, chest out, proud nod
        e = env(t, 0.2, 0.7, 2.3, 2.9)
        blend_arm(P, 'R', C.arm_to('R', (-0.55, -0.75, 0.15)), e, fore_dir=(-0.35, 0.2, 0.9))  # blunderbuss upright on the shoulder, beside the head
        P.spine(-0.12 * e)
        P.head(-0.15 * e + math.sin(TAU * 1.5 * max(0.0, t - 1.0)) * 0.1 * env(t, 1.0, 1.2, 2.0, 2.3))
        P.shoulder('R', 0.15 * e)
    elif k == 'gunslinger':  # twirls both revolvers, then finger-guns forward
        e = env(t, 0.1, 0.4, 1.6, 1.9)
        spin = ease(clamp01((t - 0.35) / 1.1)) * TAU * 2
        for s in ('L', 'R'):
            blend_arm(P, s, q(X, -0.7) @ C.hang[s], e, (-0.6, 0, 0))
            P.pre(SIDE[s][0] + 'Hand', q(X, -spin * e))
        pose = env(t, 1.9, 2.1, 2.6, 3.0)
        aim_arms(P, C, 0.25 * math.exp(-8 * max(0.0, t - 2.15)) * (t > 2.1), pose)
        P.head(0, 0.2 * pose, 0.1 * pose)
    elif k == 'bomber':  # juggles a bomb: two tosses, eyes following it
        e = env(t, 0.1, 0.35, 2.3, 2.7)
        toss = abs(math.sin(math.pi * clamp01((t - 0.4) / 1.8) * 2))
        blend_arm(P, 'L', q(X, -0.8 - 0.5 * toss) @ C.hang['L'], e, (-1.1 + 0.5 * toss, 0, 0))
        P.head(-0.45 * toss * e, 0.1 * e, 0)
        P.loc.z = -0.03 * (1 - toss) * e
    elif k == 'frostbite':  # taps the staff twice, then shivers
        e = env(t, 0.1, 0.3, 1.5, 1.8)
        tap = abs(math.sin(math.pi * clamp01((t - 0.3) / 1.2) * 2))
        blend_arm(P, 'R', q(X, -0.25 * tap) @ C.hang['R'], e)
        P.loc.z = 0.02 * tap * e
        brr = env(t, 1.8, 1.9, 2.6, 2.8)
        P.spine(0, 0, math.sin(t * 70) * 0.05 * brr)
        P.head(0.1 * brr, math.sin(t * 55) * 0.08 * brr)
        for s in ('L', 'R'):
            P.shoulder(s, 0.3 * brr)
    else:  # volt: glitches, head snapping to random angles, then reboots
        e = env(t, 0.1, 0.15, 1.5, 1.6)
        step = int(t / 0.11)
        rnd = lambda n: math.sin(step * 12.9898 + n * 78.233) * 43758.5453 % 1 * 2 - 1
        P.head(rnd(1) * 0.3 * e, rnd(2) * 0.6 * e, rnd(3) * 0.35 * e)
        for s in ('L', 'R'):
            P.pre(SIDE[s][0] + 'Arm', q(X, rnd(4 if s == 'L' else 5) * 0.4 * e))
        droop = env(t, 1.6, 1.9, 2.3, 2.45)
        P.head(0.7 * droop)
        P.spine(0.35 * droop)
        for s in ('L', 'R'):
            P.pre(SIDE[s][0] + 'Arm', q(X, 0.25 * droop))
        pop = kick(t, 2.4, 0.04, 9.0)
        P.loc.z += 0.06 * pop
        P.head(-0.2 * pop)
    return P


def c_cough(C, t):
    """In the poison gas: hand to the mouth, doubled over by three coughs."""
    P = stance(C, t, 0.5)
    s = C.free
    sg = SIDE[s][1]
    e = env(t, 0.05, 0.3, 1.25, 1.6)
    hc, hr = C.head_ell
    mouth = Vector((sg * 0.02, hc.y - hr.y - C.over['head_margin'] - 0.06, hc.z - 0.45 * hr.z)) + Vector(C.over['mouth'])
    blend_reach(P, s, mouth, (sg, 0.3, -1), e)  # the fist in front of the mouth
    if C.armed(s) and s in C.wcorners:  # the weapon held away, pointing down and out
        P.point_weapon(s, (sg * 0.7, -0.1, -0.7), e)
    c = sum(kick(t, a, 0.04, 9.0) for a in (0.35, 0.7, 1.05))
    P.spine(0.18 * e + 0.25 * c)
    P.head(0.1 * e + 0.2 * c)
    P.loc.z = -0.02 * c
    return P


def c_cheer(C, t):
    """Quick fist pump after a knockout."""
    P = stance(C, t, 0.5)
    arms = ['L', 'R'] if C.weapon == 'both' else [C.free]
    e = env(t, 0.05, 0.2, 0.7, 1.0)
    pump = 0.5 + 0.5 * math.sin(TAU * 2.5 * t)
    for s in arms:
        sg = SIDE[s][1]
        rf = C.over['raise_fore']
        fd = (sg * (rf[0] + 0.2 * pump), rf[1], rf[2]) if rf else (sg * (0.2 + 0.3 * pump), -0.25, 1)
        blend_arm(P, s, C.arm_to(s, C.up_dir(s, -0.5)), e, fore_dir=fd)
    P.spine(-0.1 * e)
    P.head(-0.2 * e)
    P.loc.z = 0.03 * e * pump
    return P


# name, function, duration (s), loops
CLIPS = [
    ('Idle', c_idle, 4.0, True),
    ('Run', c_run, 0.6, True),
    ('Sneak', c_sneak, 1.1, True),
    ('BushIdle', c_bush, 5.0, True),
    ('Slide', c_slide, 1.0, True),
    ('Aim', c_aim, 1.0, True),
    ('Shoot', c_shoot, 0.45, False),
    ('Super', c_super, 1.1, False),
    ('Hit', c_hit, 0.4, False),
    ('Death', c_death, 1.3, False),
    ('Victory', c_victory, 1.2, True),
    ('Wave', c_wave, 2.2, False),
    ('Bored', c_bored, 4.8, False),
    ('Fidget', c_fidget, 3.0, False),
    ('Cough', c_cough, 1.6, False),
    ('Cheer', c_cheer, 1.0, False),
]


# ------------------------------------------------------------------ keying

def apply(C, P):
    for pb in C.rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        R = C.rest[pb.name]
        pb.rotation_quaternion = R.inverted() @ P.get(pb.name) @ R
        pb.location = (R.inverted() @ P.loc) if pb.name == 'Hips' else Vector()
        pb.scale = (1, 1, 1)


def make_all(d, rig):
    C = Char(d, rig)
    rig.animation_data_create()
    made = []
    for name, fn, dur, loop in CLIPS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        n = round(dur * FPS)
        last = {}
        for f in range(n + 1):
            t = f / FPS
            P = fn(C, 0.0 if loop and f == n else t)  # loops end exactly where they start
            if C.over['resolve']:
                for side in 'LR':
                    resolve(C, P, side)
            apply(C, P)
            for pb in rig.pose.bones:
                qq = pb.rotation_quaternion
                if pb.name in last and last[pb.name].dot(qq) < 0:
                    pb.rotation_quaternion = -qq
                last[pb.name] = pb.rotation_quaternion.copy()
                pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
                if pb.name == 'Hips':
                    pb.keyframe_insert('location', frame=f, group=pb.name)
        act.frame_range = (0, n)
        act.use_frame_range = True
        act.use_cyclic = loop
        made.append(name)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = I
        pb.location = Vector()
    return made


# ------------------------------------------------------------------ preview renders

def preview(key, rig, body, out, frames_per_clip=4):
    """A few frames of every clip rendered with the workbench (checked by eye)."""
    os.makedirs(out, exist_ok=True)
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 50
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    cam.location = (2.7, -3.4, 1.7)
    tgt = bpy.data.objects.new('tgt', None)
    tgt.location = (0, 0, 1.05)
    sc.collection.objects.link(tgt)
    con = cam.constraints.new('TRACK_TO')
    con.target = tgt
    sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.light = 'STUDIO'
    sc.render.resolution_x = sc.render.resolution_y = 300
    sc.render.image_settings.file_format = 'PNG'
    body.hide_render = False
    rig.hide_render = True
    for act in [a for a in bpy.data.actions if a.use_fake_user]:
        rig.animation_data.action = act
        n = int(act.frame_range[1])
        for i in range(frames_per_clip):
            f = round(i * n / max(1, frames_per_clip - (0 if act.use_cyclic else 1)))
            sc.frame_set(min(f, n))
            sc.render.filepath = os.path.join(out, f'{key}_{act.name}_{i}.png')
            bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(tgt)
    # two sheets of 8 clips (one row each, frames_per_clip across), in CLIPS order
    import subprocess
    names = [c[0] for c in CLIPS]
    for part, chunk in (('A', names[:8]), ('B', names[8:])):
        ins = []
        for name in chunk:
            for i in range(frames_per_clip):
                ins += ['-i', os.path.join(out, f'{key}_{name}_{i}.png')]
        n = len(chunk) * frames_per_clip
        layout = '|'.join(f'{(k % frames_per_clip) * 300}_{(k // frames_per_clip) * 300}' for k in range(n))
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *ins, '-filter_complex',
                        f'xstack=inputs={n}:layout={layout}', os.path.join(out, f'{key}_sheet{part}.png')], check=True)
