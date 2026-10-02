class_name Feel
extends RefCounted
# Game feel, a port of src/feel.js (v0.11 IMPACT): camera trauma (smooth shake), zoom punches, the
# hit-confirm pitch ladder, the final-K.O. orbit, plus the per-weapon hit freeze / trauma table and
# combat.js FIRE_KICK. Everything here is cosmetic: the server's rules never pause.
#
# main.gd owns one (Feel.current) and applies it in _follow_camera; fx.gd / fx_combat.gd / fighters
# call the static helpers (shake_at, kick, rumble) so they need no reference to main.

static var current: Feel
static var shake_on := true       # settings.js `shake` (default on)
static var vibration := true      # settings.js `vibration` (default on): gamepad rumble / phone buzz

# Per weapon: [victim hit freeze (s), trauma when you land it, trauma when you take it]
const WEAPONS := {
	"blaster": [0.025, 0.04, 0.18], "blasterS": [0.09, 0.12, 0.35],
	"gunslinger": [0.02, 0.02, 0.1], "gunslingerS": [0.03, 0.03, 0.12],
	"bomber": [0.06, 0.2, 0.3], "bomberS": [0.11, 0.55, 0.55],
	"frostbite": [0.035, 0.05, 0.15], "frostbiteS": [0.12, 0.1, 0.4],
	"volt": [0.045, 0.06, 0.18], "voltS": [0.07, 0.3, 0.35],
	"kappa": [0.04, 0.08, 0.2], "kappaS": [0.08, 0.35, 0.4],
	"pipchomp": [0.08, 0.15, 0.25], "pipchompS": [0.1, 0.12, 0.3], "mochi": [0.07, 0.15, 0.3], "mochiS": [0.12, 0.5, 0.5],
}
const DEFAULT := [0.03, 0.05, 0.18]
# combat.js FIRE_KICK: camera kick when you fire (Gunslinger adds 0.03 per bolt instead)
const FIRE_KICK := {"blaster": 0.14, "blasterS": 0.4, "gunslinger": 0.0, "gunslingerS": 0.0, "bomber": 0.06, "bomberS": 0.1,
	"frostbite": 0.06, "frostbiteS": 0.35, "volt": 0.07, "voltS": 0.1, "kappa": 0.05, "kappaS": 0.3,
	"pipchomp": 0.1, "pipchompS": 0.15, "mochi": 0.12, "mochiS": 0.3}

# Trauma camera: shake = trauma^2, smooth noise (not white jitter), max 0.55 m and 1.2 deg of roll.
const MAX_OFFSET := 0.55
const MAX_ROLL := 1.2 * PI / 180.0
const FREQ := 16.0
const DECAY := 1.7

var trauma := 0.0
var t := 0.0
var zoom := 1.0          # camera distance factor, eased toward the wanted zoom * punch
var punch := 1.0         # short zoom punches (K.O., own super), eased back to 1
var punch_back := 4.0
var orbit := 0.0         # final K.O.: the camera circles the winner
var orbit_want := 0.0
var ladder := 0          # consecutive hits you landed (pitch ladder), reset after 1 s without one
var ladder_t := 0.0
var look := Vector2.ZERO # camera look-ahead (game.js F.lookX / lookZ)
var focus := Vector3.ZERO  # the camera focus (shake_at measures from it), set by main.gd
var playing := false       # a match is on (footsteps)
var _rumble_ms := 0

static func weapon(type_key: String, sup: bool) -> Array:
	return WEAPONS.get(type_key + ("S" if sup else ""), DEFAULT)

func reset() -> void:
	trauma = 0.0; t = 0.0; zoom = 1.0; punch = 1.0; punch_back = 4.0
	orbit = 0.0; orbit_want = 0.0; ladder = 0; ladder_t = 0.0; look = Vector2.ZERO

func add(amount: float) -> void:
	trauma = minf(1.0, trauma + amount)

# A zoom punch: factor (<1 = closer) reached at once, then eased back over `back` seconds.
func punch_to(factor: float, back := 0.25) -> void:
	punch = minf(punch, factor)
	punch_back = 1.0 / back

# The next hit-confirm step (0..4): each hit you land within a second rises in pitch.
func next_hit() -> int:
	ladder = mini(ladder + 1, 4) if ladder_t > 0.0 else 0
	ladder_t = 1.0
	return ladder

# Online the match keeps real time (no slow motion): only the ~120 deg orbit around the winner.
func final_ko() -> void:
	if orbit_want != 0.0:
		return
	orbit_want = 2.1

func update(dt: float, zoom_want: float) -> void:
	t += dt
	trauma = maxf(0.0, trauma - DECAY * dt)
	ladder_t -= dt
	punch += (1.0 - punch) * (1.0 - exp(-punch_back * 3.0 * dt))
	zoom += (zoom_want - zoom) * (1.0 - exp(-dt / 0.6))
	orbit += (orbit_want - orbit) * (1.0 - exp(-1.2 * dt))

static func _wobble(x: float, s: float) -> float:
	return (sin(x + s) + sin(x * 1.73 + s * 2.1) * 0.6 + sin(x * 2.91 + s * 3.7) * 0.35) / 1.95

# Camera offset from the trauma: xyz in metres, w = roll in radians.
func shake() -> Vector4:
	var s := trauma * trauma if shake_on else 0.0
	if s <= 0.0:
		return Vector4.ZERO
	var x := t * FREQ
	return Vector4(MAX_OFFSET * s * _wobble(x, 1), MAX_OFFSET * s * _wobble(x, 5) * 0.6,
		MAX_OFFSET * s * _wobble(x, 9), MAX_ROLL * s * _wobble(x, 13))

# ---------------------------------------------------------------- static hooks

# game.js shakeAt: trauma falling off with the distance to the camera focus (+ a rumble when strong).
static func shake_at(x: float, z: float, amount: float) -> void:
	var F := current
	if F == null:
		return
	var d2 := (x - F.focus.x) * (x - F.focus.x) + (z - F.focus.z) * (z - F.focus.z)
	var k := amount / (1.0 + d2 / 120.0)
	F.add(k)
	if k > 0.08:
		rumble(minf(1.0, k * 1.4), minf(1.0, k), 120.0 + k * 250.0)

static func kick(amount: float) -> void:
	if current:
		current.add(amount)

# input.js rumble: a gamepad rumble, or on a phone a short buzz. every_ms: minimum gap between two.
static func rumble(strong: float, weak: float, ms: float, every_ms := 0) -> void:
	var F := current
	if F == null or not vibration:
		return
	var now := Time.get_ticks_msec()
	if every_ms > 0 and now - F._rumble_ms < every_ms:
		return
	F._rumble_ms = now
	var pads := Input.get_connected_joypads()
	if not pads.is_empty():
		Input.start_joy_vibration(pads[0], clampf(weak, 0, 1), clampf(strong, 0, 1), ms / 1000.0)
	elif _can_buzz():
		Input.vibrate_handheld(maxi(8, roundi(ms * maxf(strong, weak) * 0.6)))

static var _buzz := -1
static func _can_buzz() -> bool:
	if _buzz == -1:
		_buzz = 0
		if OS.has_feature("ios"):
			_buzz = 1
		elif OS.has_feature("android"):   # needs android.permission.VIBRATE in the export preset
			_buzz = 1   # a normal (install-time) permission: get_granted_permissions() lists only runtime ones
	return _buzz == 1
