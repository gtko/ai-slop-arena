class_name Fx
extends Node3D
# Combat feedback, cheap on purpose (mobile / battery): every particle of the match is one
# MultiMesh (one draw call, CPU-updated from preallocated arrays, no per-frame allocations),
# damage numbers are a fixed pool of Label3D, projectile trails are emitted from small tracer
# records (the same straight flight as the server's shot: range, speed, blocked by SHOT_BLOCK tiles).

const MAX_P := 320
const MAX_NUM := 24

var arena: Arena
var fighters: Dictionary = {}
var local_id := ""

# particle pool (structure of arrays, swap-remove)
var _n := 0
var _pos := PackedVector3Array()
var _vel := PackedVector3Array()
var _life := PackedFloat32Array()
var _max_life := PackedFloat32Array()
var _size := PackedFloat32Array()
var _grav := PackedFloat32Array()
var _col := PackedColorArray()
var _mm: MultiMesh
var _mmi: MultiMeshInstance3D
var _rng := RandomNumberGenerator.new()
var _basis_cache := Basis.IDENTITY

# damage numbers
var _labels: Array[Label3D] = []
var _l_age := PackedFloat32Array()
var _l_key := PackedStringArray()     # merge key ("src>dst") of a number still counting up
var _l_total := PackedFloat32Array()
var _l_vel := PackedFloat32Array()
var _l_active := PackedByteArray()

# projectile tracers: [{pos: Vector3, dir: Vector3, speed, left, col: Color, big: bool}]
var _tracers: Array = []

func setup(arena_: Arena, fighters_: Dictionary, local_id_: String) -> void:
	arena = arena_
	fighters = fighters_
	local_id = local_id_
	if _mmi:
		return
	_rng.randomize()
	_pos.resize(MAX_P); _vel.resize(MAX_P); _life.resize(MAX_P); _max_life.resize(MAX_P)
	_size.resize(MAX_P); _grav.resize(MAX_P); _col.resize(MAX_P)
	var sphere := SphereMesh.new()
	sphere.radius = 0.5
	sphere.height = 1.0
	sphere.radial_segments = 6
	sphere.rings = 3
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	sphere.material = mat
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.use_colors = true
	_mm.mesh = sphere
	_mm.instance_count = MAX_P
	_mm.visible_instance_count = 0
	_mmi = MultiMeshInstance3D.new()
	_mmi.multimesh = _mm
	_mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_mmi.custom_aabb = AABB(Vector3(-60, -2, -60), Vector3(120, 20, 120))
	add_child(_mmi)
	for k in MAX_NUM:
		var l := Label3D.new()
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		l.no_depth_test = true
		l.fixed_size = false
		l.pixel_size = 0.011
		l.font_size = 64
		l.outline_size = 14
		l.outline_modulate = Color(0, 0, 0, 0.9)
		l.render_priority = 5
		l.visible = false
		add_child(l)
		_labels.append(l)
	_l_age.resize(MAX_NUM); _l_total.resize(MAX_NUM); _l_vel.resize(MAX_NUM)
	_l_key.resize(MAX_NUM); _l_active.resize(MAX_NUM)

# ---------------------------------------------------------------- particles

func burst(p: Vector3, col: Color, count: int, speed: float, size: float, life: float, grav := 6.0, up := 0.6) -> void:
	for k in count:
		if _n >= MAX_P:
			return
		var a := _rng.randf() * TAU
		var s := speed * (0.4 + _rng.randf() * 0.6)
		var v := Vector3(cos(a) * s, up * speed * (0.3 + _rng.randf()), sin(a) * s)
		_add(p, v, col, size * (0.6 + _rng.randf() * 0.7), life * (0.6 + _rng.randf() * 0.6), grav)

# An expanding ring on the ground (super, landing, gadget).
func ring(p: Vector3, col: Color, radius: float, count := 28, life := 0.45) -> void:
	for k in count:
		if _n >= MAX_P:
			return
		var a := TAU * k / count
		_add(p + Vector3(0, 0.15, 0), Vector3(cos(a), 0, sin(a)) * (radius / life), col, 0.28, life, 0.0)

func _add(p: Vector3, v: Vector3, col: Color, sz: float, life: float, grav: float) -> void:
	var i := _n
	_n += 1
	_pos[i] = p; _vel[i] = v; _col[i] = col; _size[i] = sz
	_life[i] = life; _max_life[i] = life; _grav[i] = grav

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

# ---------------------------------------------------------------- events

func on_event(e: Dictionary) -> void:
	var f: Fighter = fighters.get(e.get("id", ""))
	match e.get("e", ""):
		"atk":
			if f == null:
				return
			var sup: bool = bool(e.get("s", false))
			var col := GameData.color_of(f.type.palette.accent)
			var d := Vector3(float(e.get("dx", 0.0)), 0, float(e.get("dz", 0.0)))
			if d.length() < 0.01:
				return
			d = d.normalized()
			burst(f.position + Vector3(0, 1.1, 0) + d * 0.8, col, 5, 3.0, 0.16, 0.25, 0.0, 0.2)   # muzzle
			_tracers.append({"pos": f.position + Vector3(0, 1.1, 0), "dir": d, "speed": float(f.type.projSpeed),
				"left": float(f.type.range), "col": col, "big": sup})
			if sup:
				ring(f.position, Color(1.0, 0.9, 0.3, 0.9), 3.2, 36, 0.5)
				burst(f.position + Vector3(0, 0.6, 0), Color(1.0, 0.85, 0.3, 0.9), 16, 6.0, 0.3, 0.5)
		"dmg":
			if f == null or not f.visible:
				return
			var mine := f.id == local_id
			var from_me := str(e.get("s", "")) == local_id
			var col2 := Color(1.0, 0.3, 0.25) if mine else (Color(1.0, 0.95, 0.4) if from_me else Color(1, 1, 1))
			number(f.position + Vector3(0, 2.8, 0), float(e.get("a", 0)), col2, "%s>%s" % [e.get("s", ""), f.id], bool(e.get("u", false)))
			f.flash()
			burst(f.position + Vector3(0, 1.1, 0), Color(1.0, 0.85, 0.5, 0.95), 6, 3.5, 0.14, 0.3)
		"kill":
			if f == null:
				return
			var c := GameData.color_of(f.type.palette.main)
			burst(f.position + Vector3(0, 0.9, 0), Color(c.r, c.g, c.b, 0.9), 22, 5.0, 0.3, 0.7, 4.0, 1.0)
			burst(f.position + Vector3(0, 0.9, 0), Color(0.9, 0.9, 0.9, 0.7), 10, 2.5, 0.5, 0.8, -0.5, 0.5)
		"heal":
			if f and f.visible:
				number(f.position + Vector3(0, 2.8, 0), float(e.get("a", 0)), Color(0.4, 1, 0.5), "", false)
				burst(f.position + Vector3(0, 1.0, 0), Color(0.4, 1, 0.5, 0.9), 6, 1.5, 0.15, 0.6, -1.0, 1.0)
		"gad":
			if f and f.visible:
				ring(f.position, Color(0.6, 0.9, 1.0, 0.8), 1.6, 20, 0.35)
		"flare":
			burst(Vector3(float(e.get("x", 0)), 1.0, float(e.get("z", 0))), Color(1.0, 0.9, 0.4, 0.9), 14, 4.0, 0.22, 0.8)
		"wall", "crate":
			if arena:
				var p := arena.center(int(e.get("i", 0)), int(e.get("j", 0)))
				burst(p + Vector3(0, 1.0, 0), Color(0.7, 0.62, 0.5, 0.9), 14, 4.0, 0.25, 0.6, 8.0, 1.0)

# ---------------------------------------------------------------- frame

func _process(delta: float) -> void:
	# tracers -> trail particles, impact bursts
	var k := _tracers.size() - 1
	while k >= 0:
		var t: Dictionary = _tracers[k]
		var step: float = t.speed * delta
		var p: Vector3 = t.pos + t.dir * step
		t.pos = p
		t.left -= step
		var col: Color = t.col
		_add(p, Vector3.ZERO, Color(col.r, col.g, col.b, 0.7), 0.3 if t.big else 0.17, 0.22, 0.0)
		if t.left <= 0.0 or (arena and GameData.SHOT_BLOCK.contains(arena.char_at(p.x, p.z))):
			burst(p, col, 7, 3.0, 0.18, 0.3, 5.0)
			_tracers.remove_at(k)
		k -= 1
	# particles
	var i := 0
	while i < _n:
		_life[i] -= delta
		if _life[i] <= 0.0:
			_n -= 1
			if i != _n:
				_pos[i] = _pos[_n]; _vel[i] = _vel[_n]; _life[i] = _life[_n]; _max_life[i] = _max_life[_n]
				_size[i] = _size[_n]; _grav[i] = _grav[_n]; _col[i] = _col[_n]
			continue
		_vel[i].y -= _grav[i] * delta
		_pos[i] += _vel[i] * delta
		if _pos[i].y < 0.05 and _grav[i] > 0.0:
			_pos[i].y = 0.05
			_vel[i] = Vector3(_vel[i].x * 0.5, 0.0, _vel[i].z * 0.5)
		var f := _life[i] / _max_life[i]
		var s := _size[i] * (0.4 + 0.6 * f)
		_mm.set_instance_transform(i, Transform3D(_basis_cache.scaled(Vector3(s, s, s)), _pos[i]))
		var c := _col[i]
		_mm.set_instance_color(i, Color(c.r, c.g, c.b, c.a * minf(1.0, f * 2.0)))
		i += 1
	_mm.visible_instance_count = _n
	# damage numbers
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
