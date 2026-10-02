class_name FxLib
extends RefCounted
# Meshes and materials of the combat effects, built once and shared (ports of the three.js geometry
# in src/combat.js and src/effects.js). Colours are LINEAR and may go above 1 (HDR, like the web's
# THREE.Color(4.2, 0.9, 0.35)): with glow on they bloom, without it they clip to a bright flat colour.
# Custom shaders on purpose: StandardMaterial3D colours are sRGB uniforms, these take the web's
# linear values as they are, and the same code runs on Mobile and Compatibility renderers.
#
# Tone mapping: the web renders these HDR colours through three's NeutralToneMapping (cartoon look),
# which rolls bright colours off toward white but keeps their hue (enemy shots stay red-orange,
# Gunslinger's bolts lavender). Every fx shader writes fx_out(colour):
#  - Compatibility (web export): the world uses the Linear tone mapper (identity below 1, clips above,
#    which would turn (4.2, 0.9, 0.35) into yellow), so fx_out applies three's Neutral curve itself;
#  - Mobile: lighting.gd bakes the Neutral curve into its colour-correction LUT, but that LUT only
#    covers 0..2 (LUT_SCALE), so fx_out writes the HDR colour that the LUT turns into the web's result
#    (the inverse of the curve applied to its output: the colour itself up to 2, a compressed one
#    above with the same final look; peaks cap at 0.95). Those values still feed the glow (bloom).

static var _cache: Dictionary = {}

# ---------------------------------------------------------------- materials

# three.js NeutralToneMapping (Khronos PBR Neutral), exposure 1, and its inverse on [0, 0.95]
const NEUTRAL := """
vec3 neutral(vec3 c) {
	float x = min(c.r, min(c.g, c.b));
	float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
	c -= off;
	float peak = max(c.r, max(c.g, c.b));
	if (peak < 0.76) return c;
	float d = 0.24;
	float np = 1.0 - d * d / (peak + d - 0.76);
	c *= np / peak;
	float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
	return mix(c, vec3(np), g);
}
vec3 inv_neutral(vec3 o) {
	vec3 c = max(o, vec3(0.0));
	float np = max(c.r, max(c.g, c.b));
	if (np >= 0.76) {
		float cap = min(np, 0.95);
		c *= cap / np;
		np = cap;
		float p = 0.0576 / (1.0 - np) - 0.24 + 0.76;
		float g = 1.0 - 1.0 / (0.15 * (p - np) + 1.0);
		c = (c - g * np) / max(1.0 - g, 1e-4);
		c *= p / np;
	}
	float m = min(c.r, min(c.g, c.b));
	float off = m >= 0.04 ? 0.04 : sqrt(max(m, 0.0) / 6.25) - m;
	return c + off;
}
"""

static var _world_tm := -1

# Does the world's grade already apply three's Neutral tone mapping (lighting.gd LUT)?
static func world_tonemaps() -> bool:
	if _world_tm < 0:
		_world_tm = 0
		var sc: Script = load("res://scripts/lighting.gd")
		if sc:
			for m in sc.get_script_method_list():
				if m.name == "_use_lut":
					_world_tm = 1 if sc.call("_use_lut") else 0
	return _world_tm == 1

static func neutral_code() -> String:
	if world_tonemaps():
		return NEUTRAL + "vec3 fx_out(vec3 c) { return inv_neutral(neutral(c)); }\n"
	return NEUTRAL + "vec3 fx_out(vec3 c) { return neutral(c); }\n"

const _SH_GLOW := """
shader_type spatial;
render_mode unshaded, %s, depth_draw_%s, cull_%s, shadows_disabled;
uniform vec4 col = vec4(1.0);
%s
void fragment() {
	ALBEDO = fx_out(col.rgb * COLOR.rgb);
	%s
}
"""

# One unshaded colour (HDR). blend: "mix" (opaque or alpha) / "add". alpha < 1 makes it transparent.
static func glow(c: Color, alpha := 1.0, blend := "mix", double_sided := false, priority := 0) -> ShaderMaterial:
	var transparent := alpha < 0.999 or blend == "add"
	var key := "glow_%s_%s_%s" % [blend, transparent, double_sided]
	var sh: Shader = _cache.get(key)
	if sh == null:
		sh = Shader.new()
		sh.code = _SH_GLOW % ["blend_add" if blend == "add" else "blend_mix", "never" if transparent else "opaque",
			"disabled" if double_sided else "back", neutral_code(), "ALPHA = col.a * COLOR.a;" if transparent else ""]
		_cache[key] = sh
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter("col", Color(c.r, c.g, c.b, alpha))
	m.render_priority = priority
	return m

static func set_col(m: ShaderMaterial, c: Color, alpha := -1.0) -> void:
	var a: float = alpha if alpha >= 0.0 else (m.get_shader_parameter("col") as Color).a
	m.set_shader_parameter("col", Color(c.r, c.g, c.b, a))

static func set_alpha(m: ShaderMaterial, alpha: float) -> void:
	var c: Color = m.get_shader_parameter("col")
	c.a = alpha
	m.set_shader_parameter("col", c)

# Particle layer materials (instance colour = COLOR, linear, may be HDR).
static func layer_material(kind: String) -> Material:
	var key := "layer_" + kind
	if _cache.has(key):
		return _cache[key]
	var sh := Shader.new()
	match kind:
		"sparks":   # three: MeshBasicMaterial, opaque
			sh.code = "shader_type spatial;\nrender_mode unshaded, cull_back, shadows_disabled;\n" + neutral_code() + "void fragment() { ALBEDO = fx_out(COLOR.rgb); }\n"
		"fire":     # additive, no depth write
			sh.code = "shader_type spatial;\nrender_mode unshaded, blend_add, depth_draw_never, cull_back, shadows_disabled;\n" + neutral_code() + "void fragment() { ALBEDO = fx_out(COLOR.rgb); ALPHA = 1.0; }\n"
		"smoke":    # lit, flat, 55 % opacity
			sh.code = "shader_type spatial;\nrender_mode depth_draw_never, cull_back, shadows_disabled;\nvoid fragment() { ALBEDO = COLOR.rgb; ROUGHNESS = 1.0; ALPHA = 0.55 * COLOR.a; }\n"
		_:          # debris: lit, opaque
			sh.code = "shader_type spatial;\nrender_mode cull_back;\nvoid fragment() { ALBEDO = COLOR.rgb; ROUGHNESS = 0.8; }\n"
	var m := ShaderMaterial.new()
	m.shader = sh
	_cache[key] = m
	return m

# ---------------------------------------------------------------- meshes

static func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3) -> void:
	# outward flat normal; Godot's front faces are clockwise seen from outside
	var n := (b - a).cross(c - a)
	if n.dot(a + b + c) < 0.0:
		var t := b
		b = c
		c = t
		n = -n
	n = n.normalized()
	st.set_normal(n)
	st.add_vertex(a)
	st.set_normal(n)
	st.add_vertex(c)
	st.set_normal(n)
	st.add_vertex(b)

# three.js IcosahedronGeometry(1, detail) points, as a list of triangles (flat, non indexed).
static func _ico_tris(detail: int) -> Array:
	var t := (1.0 + sqrt(5.0)) / 2.0
	var v := [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
		Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	for k in v.size():
		v[k] = (v[k] as Vector3).normalized()
	var f := [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
	var n := detail + 1
	var out := []
	for face in f:
		var a: Vector3 = v[face[0]]
		var b: Vector3 = v[face[1]]
		var c: Vector3 = v[face[2]]
		var P := func(i: int, j: int) -> Vector3: return (a + (b - a) * (float(i) / n) + (c - a) * (float(j) / n)).normalized()
		for i in n:
			for j in n - i:
				out.append([P.call(i, j), P.call(i + 1, j), P.call(i, j + 1)])
				if j < n - 1 - i:
					out.append([P.call(i + 1, j), P.call(i + 1, j + 1), P.call(i, j + 1)])
	return out

static func _build(tris: Array) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for tr in tris:
		_tri(st, tr[0], tr[1], tr[2])
	return st.commit()

static func ico(detail: int, r := 1.0) -> ArrayMesh:
	var key := "ico_%d_%f" % [detail, r]
	if not _cache.has(key):
		var tris := _ico_tris(detail)
		for tr in tris:
			for k in 3:
				tr[k] = tr[k] * r
		_cache[key] = _build(tris)
	return _cache[key]

# Blaster seed: an icosphere whose 12 original corners are pulled out into thorns.
static func seed_mesh() -> ArrayMesh:
	if not _cache.has("seed"):
		var corners := []
		for tr in _ico_tris(0):
			for p in tr:
				corners.append(p)
		var tris := _ico_tris(1)
		for tr in tris:
			for k in 3:
				for c in corners:
					if (tr[k] as Vector3).distance_squared_to(c) < 1e-4:
						tr[k] = tr[k] * 1.8
						break
		_cache["seed"] = _build(tris)
	return _cache["seed"]

# Bomber fireball / meteor: a lumpy faceted rock (bump hashed from the position: seams move together).
static func rock_mesh(r: float, bump: float) -> ArrayMesh:
	var key := "rock_%f" % r
	if not _cache.has(key):
		var tris := _ico_tris(1)
		for tr in tris:
			for k in 3:
				var p: Vector3 = tr[k] * r
				var h := sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453
				tr[k] = p * (1.0 + (h - floor(h) - 0.5) * bump)
		_cache[key] = _build(tris)
	return _cache[key]

static func octa() -> ArrayMesh:   # three OctahedronGeometry(0.5)
	if not _cache.has("octa"):
		var p := [Vector3(0.5, 0, 0), Vector3(-0.5, 0, 0), Vector3(0, 0.5, 0), Vector3(0, -0.5, 0), Vector3(0, 0, 0.5), Vector3(0, 0, -0.5)]
		var tris := []
		for x in [0, 1]:
			for y in [2, 3]:
				for z in [4, 5]:
					tris.append([p[x], p[y], p[z]])
		_cache["octa"] = _build(tris)
	return _cache["octa"]

static func box() -> BoxMesh:
	if not _cache.has("box"):
		var b := BoxMesh.new()
		b.size = Vector3.ONE
		_cache["box"] = b
	return _cache["box"]

static func sphere(r := 1.0, seg := 12, rings := 8) -> SphereMesh:
	var key := "sph_%f_%d_%d" % [r, seg, rings]
	if not _cache.has(key):
		var s := SphereMesh.new()
		s.radius = r
		s.height = r * 2.0
		s.radial_segments = seg
		s.rings = rings
		_cache[key] = s
	return _cache[key]

# Flat shapes lying on the ground (XZ), double sided.
static func ring_mesh() -> ArrayMesh:   # three RingGeometry(0.82, 1, 56)
	if not _cache.has("ring"):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var n := 56
		for k in n:
			var a0 := TAU * k / n
			var a1 := TAU * (k + 1) / n
			var i0 := Vector3(cos(a0), 0, sin(a0)) * 0.82
			var o0 := Vector3(cos(a0), 0, sin(a0))
			var i1 := Vector3(cos(a1), 0, sin(a1)) * 0.82
			var o1 := Vector3(cos(a1), 0, sin(a1))
			for p in [i0, o0, o1, i0, o1, i1]:
				st.set_normal(Vector3.UP)
				st.add_vertex(p)
		_cache["ring"] = st.commit()
	return _cache["ring"]

# Circle sector of `span` radians around +X (span = TAU: a full disc), radius 1.
static func fan_mesh(span: float, seg := 40) -> ArrayMesh:
	var key := "fan_%f" % span
	if not _cache.has(key):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		for k in seg:
			var a0 := -span / 2.0 + span * k / seg
			var a1 := -span / 2.0 + span * (k + 1) / seg
			for p in [Vector3.ZERO, Vector3(cos(a0), 0, -sin(a0)), Vector3(cos(a1), 0, -sin(a1))]:
				st.set_normal(Vector3.UP)
				st.add_vertex(p)
		_cache[key] = st.commit()
	return _cache[key]

static func disc_mesh() -> ArrayMesh:
	return fan_mesh(TAU, 32)

# Unit rectangle from x = 0 to 1, z = -0.5 to 0.5 (aim lane).
static func lane_mesh() -> ArrayMesh:
	if not _cache.has("lane"):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		for p in [Vector3(0, 0, -0.5), Vector3(1, 0, -0.5), Vector3(1, 0, 0.5), Vector3(0, 0, -0.5), Vector3(1, 0, 0.5), Vector3(0, 0, 0.5)]:
			st.set_normal(Vector3.UP)
			st.add_vertex(p)
		_cache["lane"] = st.commit()
	return _cache["lane"]

# Nurse Kappa's Tidal Wave: a curling crest 5 m wide (three PlaneGeometry(5, 1.6, 10, 3) bent).
static func wave_mesh() -> ArrayMesh:
	if not _cache.has("wave"):
		var nx := 10
		var ny := 3
		var P := func(ix: int, iy: int) -> Vector3:
			var x := -2.5 + 5.0 * ix / nx
			var y := -0.8 + 1.6 * iy / ny
			var u := x / 2.5
			var v := (y + 0.8) / 1.6
			return Vector3(x, y + 0.8, -0.5 * v * v + 0.15 * (1.0 - u * u))
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		for iy in ny:
			for ix in nx:
				for p in [P.call(ix, iy), P.call(ix + 1, iy), P.call(ix + 1, iy + 1), P.call(ix, iy), P.call(ix + 1, iy + 1), P.call(ix, iy + 1)]:
					st.set_normal(Vector3.BACK)
					st.add_vertex(p)
		_cache["wave"] = st.commit()
	return _cache["wave"]

# Soft dark blot for scorch marks (three radialTexture('rgba(20,12,8,0.9)', transparent)).
static func scorch_material() -> StandardMaterial3D:
	if not _cache.has("scorch"):
		var g := Gradient.new()
		g.set_color(0, Color8(20, 12, 8, 230))
		g.set_color(1, Color8(20, 12, 8, 0))
		g.add_point(0.45, Color8(20, 12, 8, 150))
		var tex := GradientTexture2D.new()
		tex.gradient = g
		tex.fill = GradientTexture2D.FILL_RADIAL
		tex.fill_from = Vector2(0.5, 0.5)
		tex.fill_to = Vector2(1.0, 0.5)
		tex.width = 128
		tex.height = 128
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_texture = tex
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.render_priority = -1
		_cache["scorch"] = m
	return _cache["scorch"]

# Quality scaling of particle counts (low = fewer, never zero).
static func k() -> float:
	return clampf(0.35 + float(Quality.preset().weather) * 0.65, 0.3, 1.0)

static func n(count: int) -> int:
	return maxi(1, int(round(count * k())))
