class_name Fx
extends Node3D
# Combat effects, a port of the web's src/effects.js (Effects + LightPool) driven by the server's
# events. The projectiles themselves (attack / super of every brawler) live in fx_combat.gd, the
# aim indicator under your brawler in fx_aim.gd.
#
# Cheap on purpose (mobile / battery): every particle layer is one MultiMesh (one draw call,
# CPU-updated from preallocated arrays), rings / scorches are small pools, the dynamic lights are a
# FIXED pool of OmniLight3D handed each frame to the brightest emitters (projectiles, muzzle
# flashes, explosions), like the web's LightPool. Counts follow the quality preset (FxLib.k()).

static var current: Fx   # the running match's effects (fighters reach it for their status effects)

const MAX_NUM := 24

var arena: Arena
var fighters: Dictionary = {}
var local_id := ""
var combat: FxCombat
var aim: FxAim
var time := 0.0

var sparks: FxLayer
var debris: FxLayer
var smoke: FxLayer
var fire: FxLayer

var _rng := RandomNumberGenerator.new()

# expanding ground rings: [{mi, mat, life, max, radius}]
var _rings: Array = []
# light emitters of this frame + short flashes [{p, col, i, range, life, max}]
var _flashes: Array = []
var _emit: Array = []
var _lights: Array[OmniLight3D] = []
# scorch marks [{mi, life}]
var _scorches: Array = []
# lightning ribbons [{mi, mat, life, max}]
var _ribbons: Array = []
# zones / marks on the ground live in fx_combat.gd

# damage numbers
var _labels: Array[Label3D] = []
var _l_age := PackedFloat32Array()
var _l_key := PackedStringArray()     # merge key ("src>dst") of a number still counting up
var _l_total := PackedFloat32Array()
var _l_vel := PackedFloat32Array()
var _l_active := PackedByteArray()

func setup(arena_: Arena, fighters_: Dictionary, local_id_: String) -> void:
	arena = arena_
	fighters = fighters_
	local_id = local_id_
	current = self
	if sparks:
		return
	_rng.randomize()
	sparks = FxLayer.new(self, FxLib.octa(), FxLib.layer_material("sparks"), 800)
	debris = FxLayer.new(self, FxLib.box(), FxLib.layer_material("debris"), 360)
	smoke = FxLayer.new(self, FxLib.ico(1, 0.5), FxLib.layer_material("smoke"), 320)
	fire = FxLayer.new(self, FxLib.ico(1, 0.5), FxLib.layer_material("fire"), 260)
	# the web keeps 12 point lights on desktop; fewer here: forward renderers pay per light, and the
	# Mobile renderer lights a mesh with 8 omni lights at most, shared with the arena's lanterns
	var nl: int = {"low": 0, "medium": 2, "high": 4}.get(Quality.name_now(), 2)
	for k in nl:
		var l := OmniLight3D.new()
		l.shadow_enabled = false
		l.light_energy = 0.0
		l.omni_attenuation = 2.0
		l.light_specular = 0.3
		l.visible = false
		add_child(l)
		_lights.append(l)
	for k in MAX_NUM:
		var lb := Label3D.new()
		lb.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lb.no_depth_test = true
		lb.fixed_size = false
		lb.pixel_size = 0.011
		lb.font_size = 64
		lb.outline_size = 14
		lb.outline_modulate = Color(0, 0, 0, 0.9)
		lb.render_priority = 5
		lb.visible = false
		add_child(lb)
		_labels.append(lb)
	_l_age.resize(MAX_NUM); _l_total.resize(MAX_NUM); _l_vel.resize(MAX_NUM)
	_l_key.resize(MAX_NUM); _l_active.resize(MAX_NUM)
	combat = FxCombat.new()
	add_child(combat)
	combat.setup(self)
	aim = FxAim.new()
	add_child(aim)
	if _has_demo_arg():
		var demo := FxDemo.new()
		add_child(demo)
		demo.setup(self)

func _has_demo_arg() -> bool:
	for a in DebugArgs.list():
		if a.begins_with("--fxdemo"):
			return true
	return false

func _exit_tree() -> void:
	if current == self:
		current = null

func rnd(a: float, b: float) -> float:
	return a + _rng.randf() * (b - a)

# ---------------------------------------------------------------- effects.js API

func flash(p: Vector3, col: Color, intensity: float, range_: float, life: float) -> void:
	_flashes.append({"p": p, "col": col, "i": intensity, "range": range_, "life": life, "max": life})

func light_count() -> int:
	return _lights.size()

# A light for this frame only (projectiles, bombs): fx_combat calls it every frame.
func emit_light(p: Vector3, col: Color, intensity: float, range_: float) -> void:
	_emit.append({"p": p, "col": col, "i": intensity, "range": range_})

func spark_burst(p: Vector3, col: Color, n := 10, speed := 6.0, life := 0.35, size := 0.16) -> void:
	for k in FxLib.n(n):
		var a := _rng.randf() * TAU
		var u := _rng.randf()
		var s := speed * rnd(0.4, 1.0)
		sparks.spawn(p, Vector3(cos(a) * s * (1.0 - u * 0.5), rnd(0.2, 1.0) * s, sin(a) * s * (1.0 - u * 0.5)),
			life * rnd(0.6, 1.2), size * rnd(0.6, 1.3), col, {"grav": 14.0, "drag": 2.0, "spin": rnd(-10, 10)})

func muzzle(p: Vector3, d: Vector3, col: Color) -> void:
	for k in 5:
		var s := rnd(4, 9)
		sparks.spawn(p, Vector3(d.x * s + rnd(-1.5, 1.5), rnd(-0.5, 1.5), d.z * s + rnd(-1.5, 1.5)), 0.12, rnd(0.12, 0.22), col, {"drag": 8.0})
	flash(p, col, 16, 7, 0.09)

# d: the bullet's direction; most sparks fly on through, like the hit carried on
func hit(p: Vector3, col: Color, d := Vector3.ZERO) -> void:
	spark_burst(p, col, 4, 5, 0.3, 0.14)
	for k in FxLib.n(6):
		var s := rnd(5, 10)
		sparks.spawn(p, Vector3(d.x * s + rnd(-2.2, 2.2), rnd(0.5, 3), d.z * s + rnd(-2.2, 2.2)), rnd(0.18, 0.3), rnd(0.1, 0.2), col,
			{"grav": 12.0, "drag": 4.0, "spin": rnd(-10, 10)})
	flash(p, col, 10, 5, 0.12)

func dust(x: float, z: float, n := 6, color := Color("d8bf94"), spread := 1.0) -> void:
	var c := color.srgb_to_linear()
	for k in FxLib.n(n):
		var a := _rng.randf() * TAU
		var s := rnd(1, 3) * spread
		smoke.spawn(Vector3(x + cos(a) * 0.4, rnd(0.2, 0.8), z + sin(a) * 0.4), Vector3(cos(a) * s, rnd(0.5, 1.5), sin(a) * s),
			rnd(0.6, 1.1), rnd(0.5, 0.9), c, {"drag": 2.5, "grow": 1.2, "shrink": 0.5})

func debris_burst(p: Vector3, col: Color, n := 12, size := 0.35, power := 7.0) -> void:
	for k in FxLib.n(n):
		var a := _rng.randf() * TAU
		var s := rnd(0.3, 1.0) * power
		var shade := rnd(0.7, 1.15)
		debris.spawn(p + Vector3(rnd(-0.6, 0.6), rnd(0, 1.5), rnd(-0.6, 0.6)), Vector3(cos(a) * s, rnd(3, 9), sin(a) * s),
			rnd(1.6, 2.6), size * rnd(0.5, 1.2), Color(col.r * shade, col.g * shade, col.b * shade),
			{"grav": 22.0, "spin": rnd(-12, 12), "bounce": true, "shrink": 0.35})

# Expanding ground ring (additive). Signature kept for hud.gd (count is unused: it is one mesh now).
func ring(p: Vector3, col: Color, radius: float, _count := 28, life := 0.45) -> void:
	var r: Dictionary = {}
	for o in _rings:
		if o.life <= 0.0:
			r = o
			break
	if r.is_empty():
		var mi := MeshInstance3D.new()
		mi.mesh = FxLib.ring_mesh()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var mat := FxLib.glow(col, 1.0, "add", true, 1)
		mi.material_override = mat
		add_child(mi)
		r = {"mi": mi, "mat": mat, "life": 0.0}
		_rings.append(r)
	r.mi.visible = true
	r.mi.position = Vector3(p.x, 0.08, p.z)
	FxLib.set_col(r.mat, col, 1.0)
	r.radius = radius
	r.life = life
	r.max = life
	_ring_scale(r)

func _ring_scale(r: Dictionary) -> void:
	var a := maxf(r.life / r.max, 0.0)
	r.mi.scale = Vector3.ONE * maxf(r.radius * (0.25 + (1.0 - a * a) * 0.95), 0.001)
	FxLib.set_alpha(r.mat, a)

func scorch(x: float, z: float, radius: float) -> void:
	var s: Dictionary
	if _scorches.size() >= 24:
		s = _scorches.pop_front()
	else:
		var mi := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2.ONE
		q.orientation = PlaneMesh.FACE_Y
		mi.mesh = q
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.material_override = FxLib.scorch_material()
		add_child(mi)
		s = {"mi": mi}
	s.mi.position = Vector3(x, 0.03 + _scorches.size() * 0.0004, z)
	s.mi.rotation.y = _rng.randf() * TAU
	s.mi.scale = Vector3.ONE * radius * 2.2
	s.mi.transparency = 0.0
	s.life = 9.0
	_scorches.append(s)

# Water splash: droplets arcing out and falling back, plus a burst of white spray.
func splash(x: float, z: float, size := 1.0) -> void:
	var white := Color(0.82, 0.93, 1.0)
	for k in FxLib.n(int(round(16 * size))):
		var a := _rng.randf() * TAU
		var s := rnd(1, 4.5) * size
		smoke.spawn(Vector3(x + cos(a) * 0.3, 0, z + sin(a) * 0.3), Vector3(cos(a) * s, rnd(4, 9) * sqrt(size), sin(a) * s),
			rnd(0.5, 0.8), rnd(0.14, 0.28) * size, white, {"grav": 20.0, "shrink": 0.5})
	for k in FxLib.n(int(round(6 * size))):
		var a := _rng.randf() * TAU
		smoke.spawn(Vector3(x, 0.1, z), Vector3(cos(a) * 1.5, rnd(1, 2.5), sin(a) * 1.5), rnd(0.4, 0.7), rnd(0.5, 0.9) * size,
			Color(0.9, 0.96, 1.0), {"drag": 3.0, "grow": 1.4, "shrink": 0.6})

func explosion(x: float, z: float, radius: float, big := false, on_water := false) -> void:
	var y := 0.6
	for k in FxLib.n(26 if big else 16):
		var a := _rng.randf() * TAU
		var s := rnd(2, 7) * radius * 0.35
		var hot := _rng.randf()
		fire.spawn(Vector3(x, y + rnd(0, 0.6), z), Vector3(cos(a) * s, rnd(1, 5), sin(a) * s), rnd(0.25, 0.5), rnd(0.8, 1.5) * radius * 0.45,
			Color(3.2 + hot * 2.0, 1.1 + hot * 1.6, 0.25 + hot * 0.4), {"drag": 5.0, "grow": 1.0, "shrink": 0.7, "fade": true})
	for k in FxLib.n(22 if big else 12):
		var a := _rng.randf() * TAU
		var s := rnd(1, 4) * radius * 0.3
		var g := rnd(0.42, 0.6)
		smoke.spawn(Vector3(x, y + rnd(0, 1), z), Vector3(cos(a) * s, rnd(1.5, 3.5), sin(a) * s), rnd(0.9, 1.6), rnd(0.8, 1.3) * radius * 0.4,
			Color(g, g * 0.95, g * 0.9), {"drag": 2.2, "grow": 1.6, "shrink": 0.5})
	spark_burst(Vector3(x, y, z), Color(5, 2.6, 0.8), 40 if big else 24, 11.0 * radius * 0.4, 0.6, 0.15)
	flash(Vector3(x, 1.6, z), Color(1.0, 0.62, 0.3), 260 if big else 150, radius * 5.5, 0.55 if big else 0.4)
	ring(Vector3(x, 0, z), Color(2.4, 1.3, 0.5), radius * 1.15, 0, 0.4)
	if on_water:
		splash(x, z, 1.8 if big else 1.3)
	else:
		scorch(x, z, radius)

# K.O.: the body vanishes in a puff (smoke, chunks of its colour, white sparks, a flash).
func poof(x: float, z: float, color: Color) -> void:
	for k in FxLib.n(14):
		var a := _rng.randf() * TAU
		var s := rnd(1.5, 4)
		smoke.spawn(Vector3(x, rnd(0.3, 1.8), z), Vector3(cos(a) * s, rnd(0.5, 3), sin(a) * s), rnd(0.7, 1.2), rnd(0.6, 1.0),
			Color(0.85, 0.85, 0.9), {"drag": 3.0, "grow": 1.4, "shrink": 0.5})
	debris_burst(Vector3(x, 0.8, z), color.srgb_to_linear(), 10, 0.3, 5)
	spark_burst(Vector3(x, 1, z), Color(4, 4, 4), 14, 7, 0.45)
	flash(Vector3(x, 1.5, z), Color(1, 1, 1), 40, 8, 0.25)

# Jagged lightning ribbon through [Vector2(x, z)...] at chest height (Volt's chain).
func arc(pts: Array, col: Color) -> void:
	var tris := PackedVector3Array()
	var w := 0.09
	var y := 1.2
	var m := maxf(col.r, maxf(col.g, col.b))
	for k in pts.size() - 1:
		var A: Vector2 = pts[k]
		var B: Vector2 = pts[k + 1]
		var len_ := maxf(A.distance_to(B), 0.001)
		var px := -(B.y - A.y) / len_
		var pz := (B.x - A.x) / len_
		var n := maxi(3, int(round(len_ / 0.7)))
		var lx := A.x
		var lz := A.y
		for s in range(1, n + 1):
			var t := float(s) / n
			var j := 0.0 if s == n else (_rng.randf() - 0.5) * 0.9
			var nx := A.x + (B.x - A.x) * t + px * j
			var nz := A.y + (B.y - A.y) * t + pz * j
			tris.append_array([Vector3(lx - px * w, y, lz - pz * w), Vector3(lx + px * w, y, lz + pz * w), Vector3(nx + px * w, y, nz + pz * w),
				Vector3(lx - px * w, y, lz - pz * w), Vector3(nx + px * w, y, nz + pz * w), Vector3(nx - px * w, y, nz - pz * w)])
			lx = nx
			lz = nz
		flash(Vector3(B.x, 1.5, B.y), Color(col.r / m, col.g / m, col.b / m), 40, 7, 0.2)
	_ribbon(tris, col, 0.22)

# Vertical lightning strike from the sky to (x, z) (Volt's storm).
func bolt(x: float, z: float, col: Color) -> void:
	var tris := PackedVector3Array()
	var w := 0.2
	var bx := x + (_rng.randf() - 0.5) * 2.0
	var bz := z
	var y := 22.0
	while y > 0.0:
		var ny := maxf(0.0, y - 2.0)
		var nx := x if ny == 0.0 else bx + (_rng.randf() - 0.5) * 1.4
		var nz := z if ny == 0.0 else bz + (_rng.randf() - 0.5) * 0.6
		tris.append_array([Vector3(bx - w, y, bz), Vector3(bx + w, y, bz), Vector3(nx + w, ny, nz),
			Vector3(bx - w, y, bz), Vector3(nx + w, ny, nz), Vector3(nx - w, ny, nz)])
		bx = nx
		bz = nz
		y -= 2.0
	_ribbon(tris, col, 0.28)

func _ribbon(tris: PackedVector3Array, col: Color, life: float) -> void:
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = tris
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mat := FxLib.glow(col, 1.0, "add", true, 2)
	mi.material_override = mat
	add_child(mi)
	_ribbons.append({"mi": mi, "mat": mat, "life": life, "max": life})

# ---------------------------------------------------------------- damage numbers

func number(p: Vector3, amount: float, col: Color, key: String, big: bool) -> int:
	if key != "":
		for k in MAX_NUM:
			if _l_active[k] == 1 and _l_key[k] == key and _l_age[k] < 0.32:
				_l_total[k] += amount
				_l_age[k] = 0.0
				_labels[k].text = str(int(_l_total[k]))
				_labels[k].scale = Vector3.ONE * 1.35
				return k
	var slot := -1
	var oldest := -1.0
	for k in MAX_NUM:
		if _l_active[k] == 0:
			slot = k
			break
		if _l_age[k] > oldest:
			oldest = _l_age[k]; slot = k
	var l := _labels[slot]
	_l_active[slot] = 1
	_l_age[slot] = 0.0
	_l_total[slot] = amount
	_l_key[slot] = key
	_l_vel[slot] = 2.6
	l.text = str(int(amount))
	l.modulate = col
	l.position = p + Vector3(_rng.randf_range(-0.4, 0.4), 0, 0)
	l.scale = Vector3.ONE * (1.5 if big else 1.0)
	l.visible = true
	return slot

func text_popup(p: Vector3, text: String, col: Color) -> void:
	var slot := number(p, 0.0, col, "", false)
	_labels[slot].text = text

# Kept for older call sites: a burst of round sparks.
func burst(p: Vector3, col: Color, count: int, speed: float, size: float, life: float, _grav := 6.0, _up := 0.6) -> void:
	spark_burst(p, col, count, speed, life, size)

# ---------------------------------------------------------------- events

func seen(f: Fighter) -> bool:
	return f != null and f.visible

# An 'atk' main.gd held back while the server hid the shooter (main.gd _hold_attack): replayed `lead`
# seconds late from where the shooter now shows, or (blind) with the shooter still hidden, only what
# lands at the aim point (fx_combat.gd attack_blind).
func late_attack(e: Dictionary, lead: float, blind: bool) -> void:
	var f: Fighter = fighters.get(str(e.get("id", "")))
	if f == null or not f.alive:
		return
	var d := Vector3(float(e.get("dx", 0.0)), 0, float(e.get("dz", 0.0)))
	var p := Vector3(float(e.get("px", f.position.x)), 0, float(e.get("pz", f.position.z)))
	if blind:
		combat.attack_blind(f, d, p, bool(e.get("s", false)), lead)
	else:
		combat.lead = lead
		combat.attack(f, d, p, bool(e.get("s", false)))
		combat.lead = 0.0

func on_event(e: Dictionary) -> void:
	var f: Fighter = fighters.get(str(e.get("id", "")))
	match str(e.get("e", "")):
		"atk":
			if f:
				combat.attack(f, Vector3(float(e.get("dx", 0.0)), 0, float(e.get("dz", 0.0))),
					Vector3(float(e.get("px", f.position.x)), 0, float(e.get("pz", f.position.z))), bool(e.get("s", false)))
		"dmg":
			if f == null or not seen(f):
				return
			var mine := f.id == local_id
			var from_me := str(e.get("s", "")) == local_id
			var col2 := Color(1.0, 0.3, 0.25) if mine else (Color(1.0, 0.95, 0.4) if from_me else Color(1, 1, 1))
			number(f.position + Vector3(0, 2.8, 0), float(e.get("a", 0)), col2, "%s>%s" % [e.get("s", ""), f.id], bool(e.get("u", false)))
			var src: Fighter = fighters.get(str(e.get("s", "")))   # FEEL: the weapon's hit freeze (feel.js)
			f.hurt(float(Feel.weapon(String(src.type.key) if src else "", bool(e.get("u", false)))[0]))
		"kill":
			if f == null:
				return
			var by: Fighter = fighters.get(str(e.get("by", "")))
			f.die_fx(by.position if by and by != f else Vector3.INF, bool(e.get("f", false)), seen(f))
		"heal":
			if f and seen(f):
				var sl := number(f.position + Vector3(0, 2.9, 0), float(e.get("a", 0)), Color(0.4, 1, 0.5), "heal>" + f.id, false)
				_labels[sl].text = "+%d" % int(_l_total[sl])
				spark_burst(f.position + Vector3(0, 1.4, 0), Color(0.8, 3.2, 1.4), 8, 3, 0.5, 0.14)
		"gad":
			if f:
				combat.gadget(f, Vector3(float(e.get("dx", 0.0)), 0, float(e.get("dz", 0.0))))
		"flare":
			combat.flare(float(e.get("x", 0)), float(e.get("z", 0)))
		"zap":
			var pts := []
			for p in e.get("pts", []):
				pts.append(Vector2(float(p[0]), float(p[1])))
			if pts.size() > 1:
				arc(pts, Color(3.2, 4.2, 5.2))
		"bite":
			combat.bite_fx(float(e.get("x", 0)), float(e.get("z", 0)))
		"miss":
			if f and seen(f):
				text_popup(f.position + Vector3(0, 3.0, 0), I18n.t("hud.miss"), Color(0.85, 0.9, 1.0))
		"imm":
			if f and seen(f):
				text_popup(f.position + Vector3(0, 3.1, 0), I18n.t("hud.immune"), Color(0.6, 0.9, 1.0))
		"zone":
			combat.zone_event(e.get("z", {}))
		"zoneOff":
			combat.zone_off(float(e.get("x", 0)), float(e.get("z", 0)))

# ---------------------------------------------------------------- frame

func _process(delta: float) -> void:
	time += delta
	sparks.update(delta)
	debris.update(delta)
	smoke.update(delta)
	fire.update(delta)
	for r in _rings:
		if r.life <= 0.0:
			continue
		r.life -= delta
		_ring_scale(r)
		if r.life <= 0.0:
			r.mi.visible = false
	var k := _ribbons.size() - 1
	while k >= 0:
		var rb: Dictionary = _ribbons[k]
		rb.life -= delta
		FxLib.set_alpha(rb.mat, maxf(0.0, rb.life / rb.max) * (0.6 + 0.4 * _rng.randf()))   # flicker while fading
		if rb.life <= 0.0:
			rb.mi.queue_free()
			_ribbons.remove_at(k)
		k -= 1
	for s in _scorches:
		s.life -= delta
		s.mi.transparency = 1.0 - clampf(s.life / 3.0, 0.0, 1.0)
	_update_lights(delta)
	_update_numbers(delta)

# LightPool.end(): score every emitter by brightness and distance to the camera focus, hand the
# fixed lights to the best ones; far ones fade out before they lose their slot.
func _update_lights(delta: float) -> void:
	var k := _flashes.size() - 1
	while k >= 0:
		var f: Dictionary = _flashes[k]
		f.life -= delta
		if f.life <= 0.0:
			_flashes.remove_at(k)
		else:
			var a: float = f.life / f.max
			_emit.append({"p": f.p, "col": f.col, "i": f.i * a * a, "range": f.range})
		k -= 1
	if _lights.is_empty():
		_emit.clear()
		return
	# the camera focus: the brawler it follows (yours, or whoever it watches once you are out)
	var focus := Vector3.ZERO
	var mn := Quality.main_node()
	var cf = mn.get("cam_focus") if mn else null
	var me = mn.get("me") if mn else null
	if cf is Vector3:
		focus = cf
	elif me is Fighter and me.alive:
		focus = me.position
	else:
		var cam := get_viewport().get_camera_3d()
		if cam:
			var fw := -cam.global_transform.basis.z
			focus = cam.global_position + fw * (-cam.global_position.y / minf(fw.y, -0.1))
	for e in _emit:
		var d := Vector2(e.p.x - focus.x, (e.p.z - focus.z) * 1.2).length()
		e.i *= 1.0 - smoothstep(22.0, 30.0, d)
		e.score = e.i * e.range / (6.0 + d)
	_emit.sort_custom(func(a, b): return a.score > b.score)
	for i in _lights.size():
		var l := _lights[i]
		if i < _emit.size() and _emit[i].i > 0.02:
			var e: Dictionary = _emit[i]
			var c: Color = e.col
			var m := maxf(c.r, maxf(c.g, maxf(c.b, 0.001)))
			l.visible = true
			l.position = e.p
			l.light_color = Color(c.r / m, c.g / m, c.b / m).linear_to_srgb()
			l.light_energy = e.i * LIGHT_K
			l.omni_range = e.range
		else:
			l.visible = false
	_emit.clear()

# three.js PointLight intensity -> Godot omni energy. Both fall off as 1/d^2 inside a windowed range
# (omni_attenuation 2); 1:1 matched the web's pools of coloured light under the shots by eye.
const LIGHT_K := 1.0

func _update_numbers(delta: float) -> void:
	for n in MAX_NUM:
		if _l_active[n] == 0:
			continue
		var l := _labels[n]
		_l_age[n] += delta
		var a := _l_age[n]
		l.position.y += _l_vel[n] * delta
		_l_vel[n] = maxf(_l_vel[n] - 5.0 * delta, 0.6)
		l.scale = l.scale.lerp(Vector3.ONE, clampf(delta * 12.0, 0.0, 1.0))
		l.modulate.a = clampf((1.1 - a) * 3.0, 0.0, 1.0)
		if a > 1.1:
			_l_active[n] = 0
			_l_key[n] = ""
			l.visible = false
