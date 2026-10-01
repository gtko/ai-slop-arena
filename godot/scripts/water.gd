class_name Water
extends Node3D
# Ponds ('W' tiles) and frozen ponds ('I'), drawn along the rounded outline of the web build
# (src/shore.js TileField, src/water.js): the land/water tile set is blurred into a soft field (exact
# Gaussian blur of the tile squares, plus a little wobble), whose level 0.5 is the shore. The floor
# (ground.gdshader) is cut where the field drops under the shore lip, a sandy bank slopes from there
# down to the bed, and an animated transparent surface (water.gdshader) fills the outline. Frozen
# ponds get a cracked ice sheet (ice.gdshader) inside the outline. The swamp of Misty Marsh is olive.
# The field is a small texture (6 samples per tile) shared by those shaders. Shots, blasts and idle
# plops send ripple rings across the surface (ripple). Pebbles, reeds and the snow bank: shore.gd.

const WATER_Y := -0.16
const BED_Y := -0.85
const SHORE_LIP := 0.62        # arena.js: where the floor ends on the dry side of a pond
const RES := 6                 # field samples per tile
const SIGMA := 0.5
const LEVEL := 0.5
const WOBBLE := 0.07

const MAX_RIPPLES := 8

var mat: ShaderMaterial
var bed_mat: ShaderMaterial
var water_tiles: Array = []
var ripples := PackedVector4Array()
var next_ripple := 0
var idle_t := 1.0
var now := 0.0
var _rng := RandomNumberGenerator.new()
var field := PackedFloat32Array()
var field_tex: ImageTexture
var S := 0
var h := 0.0
var half := 0.0
var arena: Arena

# ------------------------------------------------------------------ the land field

static func _erf(x: float) -> float:
	var s := -1.0 if x < 0.0 else 1.0
	var a := absf(x)
	var t := 1.0 / (1.0 + 0.3275911 * a)
	return s * (1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a))

static func probit(p: float) -> float:
	var x := clampf(2.0 * p - 1.0, -0.9999, 0.9999)
	var l := log(1.0 - x * x)
	var a := 0.147
	var b := 2.0 / (PI * a) + l / 2.0
	return sqrt(2.0) * signf(x) * sqrt(sqrt(b * b - l / a) - b)

static func _imul(a: int, b: int) -> int:
	return (a * b) & 0xFFFFFFFF

static func _hash(i: int, j: int, s: int) -> float:
	var x := (_imul(i & 0xFFFFFFFF, 374761393) + _imul(j & 0xFFFFFFFF, 668265263) + _imul(s, 982451653)) & 0xFFFFFFFF
	x = _imul(x ^ (x >> 13), 1274126177)
	return float((x ^ (x >> 16)) & 0xFFFFFFFF) / 4294967296.0

static func noise2(x: float, z: float, s := 0) -> float:
	var i := floori(x)
	var j := floori(z)
	var fx := x - i
	var fz := z - j
	var u := fx * fx * (3.0 - 2.0 * fx)
	var v := fz * fz * (3.0 - 2.0 * fz)
	var a := _hash(i, j, s)
	var b := _hash(i + 1, j, s)
	var c := _hash(i, j + 1, s)
	var d := _hash(i + 1, j + 1, s)
	return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v

# shore.js TileField (sigma 0.5 m, level 0.5, seed 7), built from arena.is_land
func _build_field() -> void:
	var N := GameData.N
	var TILE := GameData.TILE
	S = N * RES + 1
	h = TILE / RES
	half = N * TILE / 2.0
	var pad := 3
	var T := N + 2 * pad
	var k := 1.0 / (SIGMA * sqrt(2.0))
	var g := PackedFloat32Array()
	g.resize(T * S)
	for t in T:
		var a := (t - pad) * TILE - half
		var b := a + TILE
		for s in S:
			var x := s * h - half
			g[t * S + s] = 0.5 * (_erf((b - x) * k) - _erf((a - x) * k))
	var ind := PackedByteArray()
	ind.resize(T * T)
	for tj in T:
		for ti in T:
			ind[tj * T + ti] = 1 if arena.is_land(ti - pad, tj - pad) else 0
	field.resize(S * S)
	var reach := mini(pad, ceili(3.0 * SIGMA / TILE))
	for sz in S:
		var cj := int(sz / RES) + pad
		for sx in S:
			var ci := int(sx / RES) + pad
			var v := 0.0
			for tj in range(cj - reach, cj + reach + 1):
				if tj < 0 or tj >= T:
					continue
				var gz := g[tj * S + sz]
				if gz < 1e-5:
					continue
				for ti in range(ci - reach, ci + reach + 1):
					if ti >= 0 and ti < T and ind[tj * T + ti] == 1:
						v += g[ti * S + sx] * gz
			var x := sx * h - half
			var z := sz * h - half
			var n := noise2(x * 0.45, z * 0.45, 7) * 0.7 + noise2(x * 1.1, z * 1.1, 8) * 0.3 - 0.5
			v = clampf(v + n * WOBBLE * 2.0 * maxf(0.0, 1.0 - absf(v - LEVEL) * 2.0), 0.0, 1.0)
			field[sz * S + sx] = 0.5 * v / LEVEL if v < LEVEL else 0.5 + 0.5 * (v - LEVEL) / (1.0 - LEVEL)
	# R: the field, G: distance to the waterline in tiles / 1.5 (water.js shoreTexture)
	var img := Image.create(S, S, false, Image.FORMAT_RGF)
	for sz in S:
		for sx in S:
			var f := field[sz * S + sx]
			var d := -SIGMA * probit(f) / TILE if f < 0.5 else 0.0
			img.set_pixel(sx, sz, Color(f, clampf(d / 1.5, 0.0, 1.0), 0.0))
	field_tex = ImageTexture.create_from_image(img)

# field value at a world point (bilinear)
func at(x: float, z: float) -> float:
	var u := clampf((x + half) / h, 0.0, S - 1.001)
	var v := clampf((z + half) / h, 0.0, S - 1.001)
	var a := int(u)
	var b := int(v)
	var fu := u - a
	var fv := v - b
	var o := b * S + a
	return (field[o] * (1.0 - fu) + field[o + 1] * fu) * (1.0 - fv) + (field[o + S] * (1.0 - fu) + field[o + S + 1] * fu) * fv

# Shader parameters that let a material sample the field (ground, water, ice).
func bind(m: ShaderMaterial) -> void:
	m.set_shader_parameter("field_tex", field_tex)
	m.set_shader_parameter("field_half", half)
	m.set_shader_parameter("field_step", h)
	m.set_shader_parameter("field_size", float(S))

# ------------------------------------------------------------------ build

func setup(a: Arena) -> void:
	arena = a
	_build_field()

func build(a: Arena, tiles: Array, style: String) -> void:
	if arena == null:
		setup(a)
	if tiles.is_empty():
		return
	var swamp := style == "swamp"
	var cartoon: bool = a.map.get("ground", "") == "cartoon"
	var dry := Color("6e6248") if swamp else (Color("e6b98c") if cartoon else Color("8a7458"))
	var wet := Color("4a4234") if swamp else (Color("8a7458") if cartoon else Color("62563f"))
	var near := _near(tiles)
	_basin(near, dry.srgb_to_linear(), wet.srgb_to_linear())
	# surface: one quad per tile near the water, under the floor where the floor stays
	var surf := PlaneMesh.new()
	surf.size = Vector2(GameData.TILE, GameData.TILE)
	mat = ShaderMaterial.new()
	mat.shader = load("res://assets/shaders/water.gdshader")
	bind(mat)
	mat.set_shader_parameter("shallow", Color("5a7a3a") if swamp else Color("1fb8d8"))
	mat.set_shader_parameter("deep", Color("1e3a22") if swamp else Color("0a4c96"))
	mat.set_shader_parameter("water_n", load("res://assets/tex/water_n.png"))
	water_tiles = tiles
	ripples.resize(MAX_RIPPLES)
	for k in MAX_RIPPLES:
		ripples[k] = Vector4(0, 0, -99, 0)
	mat.set_shader_parameter("rip", ripples)
	surf.material = mat
	var smm := MultiMesh.new()
	smm.transform_format = MultiMesh.TRANSFORM_3D
	smm.mesh = surf
	smm.instance_count = near.size()
	for k in near.size():
		smm.set_instance_transform(k, Transform3D(Basis.IDENTITY, a.center(near[k].x, near[k].y) + Vector3(0, WATER_Y, 0)))
	var smi := MultiMeshInstance3D.new()
	smi.multimesh = smm
	smi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(smi)
	apply_quality()

# the tiles of the set and the ring around it
func _near(tiles: Array) -> Array:
	var keys := {}
	var out: Array = []
	for t in tiles:
		for dj in range(-1, 2):
			for di in range(-1, 2):
				var i: int = t.x + di
				var j: int = t.y + dj
				var key := j * GameData.N + i
				if i < 0 or j < 0 or i >= GameData.N or j >= GameData.N or keys.has(key):
					continue
				keys[key] = true
				out.append(Vector2i(i, j))
	return out

# water.js bankY: a sandy beach from the floor's edge (f = lip) down to the surface at the outline
# (f = 0.5), then a slope to the bed. 2.5 cm lower than the web's so the floor (at -0.02) covers it.
static func bank_y(f: float) -> float:
	var y := 0.0
	if f >= 0.5:
		y = WATER_Y * (1.0 - smoothstep(0.0, 1.0, (f - 0.5) / (SHORE_LIP - 0.5)))
	else:
		y = WATER_Y + (BED_Y - WATER_Y) * smoothstep(0.0, 1.0, (0.5 - f) / 0.3)
	return y - 0.025

# The basin: a grid over the tiles near the water (one vertex per field sample), the bank profile
# as its height, sun-dried sand on the lip and dark wet sand under the waterline.
func _basin(near: Array, dry: Color, wet: Color) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var TILE := GameData.TILE
	var nv := 0
	for t in near:
		var x0: float = t.x * TILE - half
		var z0: float = t.y * TILE - half
		for b in RES:
			for a in RES:
				var o: int = (t.y * RES + b) * S + t.x * RES + a
				var fs := [field[o], field[o + 1], field[o + S + 1], field[o + S]]
				if fs.min() >= SHORE_LIP:
					continue # dry: the floor is there
				nv += 6
				var ps := [Vector2(x0 + a * h, z0 + b * h), Vector2(x0 + (a + 1) * h, z0 + b * h), Vector2(x0 + (a + 1) * h, z0 + (b + 1) * h), Vector2(x0 + a * h, z0 + (b + 1) * h)]
				for q in [0, 1, 2, 0, 2, 3]:
					var f: float = fs[q]
					var p: Vector2 = ps[q]
					st.set_color(wet.lerp(dry, smoothstep(0.0, 1.0, (f - 0.5 + 0.02) / 0.12)))
					st.set_uv(Vector2(p.x / TILE, -p.y / TILE) * 0.5)
					var e := h * 0.5
					st.set_normal(Vector3(bank_y(at(p.x - e, p.y)) - bank_y(at(p.x + e, p.y)), 2.0 * e, bank_y(at(p.x, p.y - e)) - bank_y(at(p.x, p.y + e))).normalized())
					st.add_vertex(Vector3(p.x, bank_y(f), p.y))
	if nv == 0:
		return
	st.generate_tangents()
	var mesh := st.commit()
	var m := ShaderMaterial.new()
	m.shader = load("res://assets/shaders/water_bed.gdshader")
	m.set_shader_parameter("water_y", WATER_Y)
	if ResourceLoader.exists("res://assets/tex/sand.jpg"):
		m.set_shader_parameter("albedo_tex", load("res://assets/tex/sand.jpg"))
		m.set_shader_parameter("normal_tex", load("res://assets/tex/sand_n.png"))
	else:
		m.set_shader_parameter("use_tex", 0.0)
	bed_mat = m
	mesh.surface_set_material(0, m)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_DOUBLE_SIDED   # banks shade the pool when the sun is low
	add_child(mi)

# Frozen ponds (water.js IceField): a sheet of cracked ice filling the rounded outline of the 'I'
# tiles, just above the floor.
func build_ice(a: Arena, tiles: Array) -> void:
	if arena == null:
		setup(a)
	if tiles.is_empty():
		return
	var near := _near(tiles)
	var q := PlaneMesh.new()
	q.size = Vector2(GameData.TILE, GameData.TILE)
	var m := ShaderMaterial.new()
	m.shader = load("res://assets/shaders/ice.gdshader")
	bind(m)
	q.material = m
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = q
	mm.instance_count = near.size()
	for k in near.size():
		mm.set_instance_transform(k, Transform3D(Basis.IDENTITY, a.center(near[k].x, near[k].y) + Vector3(0, 0.012, 0)))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)

# arena.js: pebbles and reeds along the rounded shores, the snow bank around frozen ponds (shore.gd).
# floor_mat: the floor's material, for the bank.
func shores(a: Arena, floor_mat: ShaderMaterial) -> void:
	var has_w := false
	var has_i := false
	for j in GameData.N:
		for i in GameData.N:
			var c := a.tile(i, j)
			has_w = has_w or c == "W"
			has_i = has_i or c == "I"
	if not has_w and not has_i:
		return
	var style := "ice" if has_i else ("marsh" if String(a.map.get("water", "")) == "swamp" else ("oasis" if String(a.map.get("ground", "")) == "cartoon" else "grove"))
	Shore.decor(self, self, a, style, 0.45 if has_i else 0.35)
	if has_i and not has_w and floor_mat:
		var bm: ShaderMaterial = floor_mat.duplicate()
		bm.shader = load("res://assets/shaders/ground_bank.gdshader")
		Shore.snow_bank(self, self, bm)

# water.js ripple: a ring spreading from (x, z), amp 1 for a bubble pop, 0.55 for a spent bullet
func ripple(x: float, z: float, amp := 1.0) -> void:
	if mat == null:
		return
	ripples[next_ripple] = Vector4(x, z, now, amp)
	next_ripple = (next_ripple + 1) % MAX_RIPPLES
	mat.set_shader_parameter("rip", ripples)

func apply_quality() -> void:
	if mat:
		mat.set_shader_parameter("detail", 1.0 if int(Quality.preset().water) > 0 else 0.0)
	if bed_mat:
		bed_mat.set_shader_parameter("caustics_on", 1.0 if int(Quality.preset().water) > 0 else 0.0)

func update(delta: float) -> void:
	if mat == null:
		return
	now += delta
	mat.set_shader_parameter("now", now)
	if bed_mat:
		bed_mat.set_shader_parameter("now", now)
	# occasional idle ripples keep the pools alive
	idle_t -= delta
	if idle_t <= 0.0 and not water_tiles.is_empty():
		idle_t = 0.6 + _rng.randf() * 1.4
		var t: Vector2i = water_tiles[_rng.randi() % water_tiles.size()]
		var x := (t.x - GameData.N / 2.0 + 0.2 + _rng.randf() * 0.6) * GameData.TILE
		var z := (t.y - GameData.N / 2.0 + 0.2 + _rng.randf() * 0.6) * GameData.TILE
		ripple(x, z, 0.25 + _rng.randf() * 0.2)
