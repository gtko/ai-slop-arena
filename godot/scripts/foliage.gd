class_name Foliage
extends RefCounted
# Wind sway and bush "reveal" for bushes and tall grass (assets/shaders/foliage.gdshader, grass.gdshader).
# Global shader parameters carry the shared state: g_reveal (x, z, radius, amount) around the local
# player while he hides in a bush, g_wind (weather strength, set by weather.gd) and g_rim (the time
# of day's rim light on props and its sky colour for the water, set by lighting.gd).

const REVEAL_R := 3.4
static var _ready := false
static var _amt := 0.0
static var _mats: Dictionary = {}
static var wind := 1.0

static func ensure_globals() -> void:
	if _ready:
		return
	_ready = true
	# (listing the globals is editor-only: add them once per run)
	RenderingServer.global_shader_parameter_add("g_reveal", RenderingServer.GLOBAL_VAR_TYPE_VEC4, Vector4(0, 0, REVEAL_R, 0))
	RenderingServer.global_shader_parameter_add("g_wind", RenderingServer.GLOBAL_VAR_TYPE_FLOAT, 1.0)
	RenderingServer.global_shader_parameter_add("g_rim", RenderingServer.GLOBAL_VAR_TYPE_VEC4, Vector4(1, 1, 1, 0.3))
	RenderingServer.global_shader_parameter_add("g_sky", RenderingServer.GLOBAL_VAR_TYPE_VEC4, Vector4(0.6, 0.75, 1, 1))

# A ShaderMaterial carrying the prop's own texture / colour (the GLB material) with sway + reveal
# (sway 1 = the web's foliage sway), snow settling on top on snowy maps.
static func material_for(prop: String, sway := 1.0, reveal := true, snow := false) -> Material:
	ensure_globals()
	var key := "%s|%s|%s|%s" % [prop, sway, reveal, snow]
	if _mats.has(key):
		return _mats[key]
	var info := PropLib.info(prop)
	var mesh: Mesh = info.get("mesh")
	var src: BaseMaterial3D = null
	if mesh and mesh.get_surface_count() > 0:
		src = mesh.surface_get_material(0) as BaseMaterial3D
	var m := ShaderMaterial.new()
	m.shader = load("res://assets/shaders/foliage.gdshader")
	m.set_shader_parameter("sway", sway)
	m.set_shader_parameter("reveal_on", 1.0 if reveal else 0.0)
	m.set_shader_parameter("snow", 1.0 if snow else 0.0)
	if src:
		m.set_shader_parameter("albedo", src.albedo_color)
		if src.albedo_texture:
			m.set_shader_parameter("albedo_tex", src.albedo_texture)
			m.set_shader_parameter("use_tex", 1.0)
		else:
			m.set_shader_parameter("use_tex", 0.0)
	else:
		m.set_shader_parameter("use_tex", 0.0)
	_mats[key] = m
	return m

static var _grass: Material

# Tall grass tufts (grass.gdshader): colours come from the mesh and the MultiMesh instances.
static func grass_material() -> Material:
	ensure_globals()
	if _grass == null:
		var m := ShaderMaterial.new()
		m.shader = load("res://assets/shaders/grass.gdshader")
		_grass = m
	return _grass

# src/foliage.js grassTuftGeometry: ~95 tapered blades leaning out from the centre, orange at the
# root to warm yellow at the tip (vertex colours, linear), normals tilted up; about 2 m wide.
static func grass_tuft_mesh(seed := 3, blades := 95) -> ArrayMesh:
	var r := RandomNumberGenerator.new()
	r.seed = seed
	var root := Color("f08a34").srgb_to_linear()
	var tip := Color("ffe06a").srgb_to_linear()
	var mid := Color("ffb640").srgb_to_linear()
	var pos := PackedVector3Array()
	var nor := PackedVector3Array()
	var col := PackedColorArray()
	for k in blades:
		var x := (r.randf() - 0.5) * 2.1
		var z := (r.randf() - 0.5) * 2.1
		var a := r.randf() * TAU
		var h := 0.95 + r.randf() * 0.5
		var w := 0.16 + r.randf() * 0.08
		var lean := 0.15 + r.randf() * 0.25
		var dx := cos(a)
		var dz := sin(a)
		var px := -dz * w
		var pz := dx * w
		var ox := x * 0.12 * lean
		var oz := z * 0.12 * lean
		var tip_c := tip.lerp(mid, r.randf() * 0.5)
		var pts: Array = []
		for ring in [[0.0, 1.0], [0.55, 0.62], [1.0, 0.0]]:
			var t: float = ring[0]
			pts.append([x + ox * t * t * 6.0, h * t, z + oz * t * t * 6.0, ring[1]])
		var n := Vector3(x * 0.3 + dx * 0.2, 1.0, z * 0.3 + dz * 0.2).normalized()
		for s in 2:
			var A: Array = pts[s]
			var B: Array = pts[s + 1]
			var quad := [Vector3(A[0] - px * A[3], A[1], A[2] - pz * A[3]), Vector3(A[0] + px * A[3], A[1], A[2] + pz * A[3]), Vector3(B[0] + px * B[3], B[1], B[2] + pz * B[3]),
				Vector3(A[0] - px * A[3], A[1], A[2] - pz * A[3]), Vector3(B[0] + px * B[3], B[1], B[2] + pz * B[3]), Vector3(B[0] - px * B[3], B[1], B[2] - pz * B[3])]
			for q in quad:
				pos.append(q)
				nor.append(n)
				col.append(root.lerp(tip_c, pow(q.y / h, 0.7)))
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = pos
	arr[Mesh.ARRAY_NORMAL] = nor
	arr[Mesh.ARRAY_COLOR] = col
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return mesh

# Per frame: ease the reveal amount toward 1 while the local player is hidden in a bush (and not
# revealed by shooting: flags bit 2), and follow him.
static func update(delta: float, me: Fighter, arena: Arena) -> void:
	if not _ready:
		return
	var want := 0.0
	var pos := Vector3.ZERO
	if me:
		pos = me.position
		if me.alive and arena.is_bush(pos.x, pos.z) and (me.flags & 2) == 0:
			want = 1.0
	_amt += (want - _amt) * (1.0 - exp(-8.0 * delta))
	RenderingServer.global_shader_parameter_set("g_reveal", Vector4(pos.x, pos.z, REVEAL_R, _amt))
	RenderingServer.global_shader_parameter_set("g_wind", wind)
