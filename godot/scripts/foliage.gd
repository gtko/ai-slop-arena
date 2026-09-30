class_name Foliage
extends RefCounted
# Wind sway and bush "reveal" for trees / bushes (assets/shaders/foliage.gdshader). Two global shader
# parameters carry the shared state: g_reveal (x, z, radius, amount) around the local player while he
# hides in a bush, and g_wind (weather strength, set by weather.gd).

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

# A ShaderMaterial carrying the prop's own texture / colour (the GLB material) with sway + reveal.
static func material_for(prop: String, sway := 0.05, reveal := true) -> Material:
	ensure_globals()
	var key := "%s|%s|%s" % [prop, sway, reveal]
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
	if src:
		m.set_shader_parameter("albedo", src.albedo_color)
		m.set_shader_parameter("roughness", src.roughness)
		if src.albedo_texture:
			m.set_shader_parameter("albedo_tex", src.albedo_texture)
			m.set_shader_parameter("use_tex", 1.0)
		else:
			m.set_shader_parameter("use_tex", 0.0)
	else:
		m.set_shader_parameter("use_tex", 0.0)
	_mats[key] = m
	return m

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
