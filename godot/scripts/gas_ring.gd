class_name GasRing
extends Node3D
# Showdown gas, mirrored from src/poison.js: the server only sends its timer (`pt` in each
# snapshot); the ring level follows from it (startAt, then one more ring of tiles every
# `interval` seconds, tiles of ring 0..level are poisoned). Visuals like the web: every gassed
# tile fills with two glowing green cloud puffs (they grow in over 1.8 s, bob and turn), the next
# ring blinks as a square frame on the floor for the last 6 s, and the gas wall nearest to the
# camera spills green light (two lights of the fx light pool).
# One MultiMesh for every puff: a puff's transform is written once, when its tile fills; the bobbing,
# turning and growing run in the vertex shader (no per-frame CPU work for the clouds).

const HALF := GameData.HALF
const TILE := GameData.TILE
const N := GameData.N
const BOUND_H := 2.7

var start_at := 28.0
var interval := 7.0
var max_level := 9
var enabled := true
var timer := 0.0            # the server's poison timer, advanced locally between snapshots
var level := 0
var _shown := 0             # rings already filled with puffs
var _filled := PackedByteArray()
var _mm: MultiMesh
var _mat: ShaderMaterial
var _rng := RandomNumberGenerator.new()
var _frame: MeshInstance3D
var _frame_mat: ShaderMaterial
var _frame_half := -1.0
var _t := 0.0

# three: MeshStandardMaterial(color 0x58d46a, emissive 0x1fc04a x 0.9, roughness 1, flatShading,
# opacity 0.6, no depth write); puff = IcosahedronGeometry(1, 1)
const PUFF_SHADER := """
shader_type spatial;
render_mode depth_draw_never, cull_back, shadows_disabled;
uniform float gas_time = 0.0;
uniform vec3 albedo_lin;
uniform vec3 emission_lin;
mat3 rot_xyz(vec3 e) {
	float cx = cos(e.x), sx = sin(e.x), cy = cos(e.y), sy = sin(e.y), cz = cos(e.z), sz = sin(e.z);
	mat3 rx = mat3(vec3(1, 0, 0), vec3(0, cx, sx), vec3(0, -sx, cx));
	mat3 ry = mat3(vec3(cy, 0, -sy), vec3(0, 1, 0), vec3(sy, 0, cy));
	mat3 rz = mat3(vec3(cz, sz, 0), vec3(-sz, cz, 0), vec3(0, 0, 1));
	return rx * ry * rz;
}
void vertex() {
	// INSTANCE_CUSTOM: phase, fill time, base height, puff index (0 low / 1 high)
	float ph = INSTANCE_CUSTOM.x;
	float age = gas_time - INSTANCE_CUSTOM.y;
	float p = INSTANCE_CUSTOM.w;
	float grow = smoothstep(0.0, 1.8, age);
	float sc = (p > 0.5 ? 0.95 : 1.3) * (1.0 + 0.15 * sin(TIME * 0.9 + ph * 3.0)) * grow;
	mat3 r = rot_xyz(vec3(ph, TIME * 0.2 + ph, 0.0));
	float y = INSTANCE_CUSTOM.z + 0.7 + p * 0.9 + sin(TIME * 1.1 + ph) * 0.25;
	VERTEX = r * (VERTEX * vec3(sc, sc * 0.8, sc)) + vec3(0.0, y, 0.0);
	NORMAL = normalize(r * (NORMAL / vec3(1.0, 0.8, 1.0)));
}
void fragment() {
	ALBEDO = albedo_lin;
	EMISSION = emission_lin;
	ROUGHNESS = 1.0;
	ALPHA = 0.6;
}
"""

const FRAME_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix, shadows_disabled;
uniform float half_size = 10.0;
uniform float alpha = 0.0;
uniform vec3 col;
varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	float d = max(abs(wpos.x), abs(wpos.z));
	float fr = step(half_size - 0.35, d) * step(d, half_size);
	ALBEDO = col;
	ALPHA = fr * alpha;
}
"""

func setup(params: Dictionary = {}) -> void:
	start_at = float(params.get("startAt", 28.0))
	interval = float(params.get("interval", 7.0))
	enabled = start_at < 1e6
	_rng.randomize()
	_filled.resize(N * N)
	_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = PUFF_SHADER
	_mat.shader = sh
	_mat.set_shader_parameter("albedo_lin", _vec(Color("58d46a").srgb_to_linear()))
	_mat.set_shader_parameter("emission_lin", _vec(Color("1fc04a").srgb_to_linear()) * 0.9)
	_mat.render_priority = 2
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.use_custom_data = true
	_mm.mesh = FxLib.ico(1)
	_mm.instance_count = N * N * 2
	_mm.visible_instance_count = 0
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = _mm
	mmi.material_override = _mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-HALF - 4, -2, -HALF - 4), Vector3(HALF * 2 + 8, 12, HALF * 2 + 8))
	add_child(mmi)
	# the next ring, drawn on the floor for the last 6 s before it fills: a square frame, blinking
	_frame = MeshInstance3D.new()
	var fq := PlaneMesh.new()
	fq.size = Vector2(HALF * 2, HALF * 2)
	_frame.mesh = fq
	_frame.position.y = 0.07
	_frame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_frame_mat = ShaderMaterial.new()
	var sf := Shader.new()
	sf.code = FRAME_SHADER
	_frame_mat.shader = sf
	_frame_mat.set_shader_parameter("col", _vec(_tm(Color(0.5, 2.4, 0.8))))
	_frame_mat.render_priority = 1
	_frame.material_override = _frame_mat
	_frame.visible = false
	add_child(_frame)

static func _vec(c: Color) -> Vector3:
	return Vector3(c.r, c.g, c.b)

# The frame's HDR green as the web shows it (three's Neutral tone mapping, see fx_lib.gd).
static func _tm(c: Color) -> Color:
	var x := minf(c.r, minf(c.g, c.b))
	var off := x - 6.25 * x * x if x < 0.08 else 0.04
	var v := Vector3(c.r - off, c.g - off, c.b - off)
	var peak := maxf(v.x, maxf(v.y, v.z))
	if peak < 0.76:
		return Color(v.x, v.y, v.z)
	var np := 1.0 - 0.0576 / (peak + 0.24 - 0.76)
	v *= np / peak
	var g := 1.0 - 1.0 / (0.15 * (peak - np) + 1.0)
	v = v.lerp(Vector3(np, np, np), g)
	return Color(v.x, v.y, v.z)

# `pt` from a snapshot (seconds since the gas clock started).
func set_timer(pt: float) -> void:
	timer = pt

func level_at(t: float) -> int:
	if not enabled or t < start_at:
		return 0
	return mini(max_level, 1 + int(floor((t - start_at) / interval)))

func next_in() -> float:
	if not enabled or level >= max_level:
		return INF
	return start_at - timer if level == 0 else start_at + level * interval - timer

func half_at_level(l: int) -> float:
	return HALF - (l + 1) * TILE if l > 0 else HALF

func safe_half() -> float:
	return half_at_level(level)

static func ring(i: int, j: int) -> int:
	return mini(mini(i, j), mini(N - 1 - i, N - 1 - j))

# The tile at (x, z) is gassed (ring <= level), like Poison.isPoisonedAt without its lanes.
func in_gas(x: float, z: float) -> bool:
	if level <= 0:
		return false
	var i := int(floor((x + HALF) / TILE))
	var j := int(floor((z + HALF) / TILE))
	if i < 0 or j < 0 or i >= N or j >= N:
		return true
	return ring(i, j) <= level

# Fill the tiles of the new rings with puffs (each puff: its transform once, the rest in the shader).
func _fill_to(l: int) -> void:
	_shown = l
	for j in N:
		for i in N:
			var r := ring(i, j)
			if r > l or _filled[j * N + i] == 1:
				continue
			_filled[j * N + i] = 1
			var c := Vector3((i - (N - 1) / 2.0) * TILE, 0.0, (j - (N - 1) / 2.0) * TILE)
			var ph := _rng.randf() * 10.0
			for p in 2:
				var php := ph + p * 2.3
				var k := _mm.visible_instance_count
				if k >= _mm.instance_count:
					return
				_mm.set_instance_transform(k, Transform3D(Basis.IDENTITY, c + Vector3(sin(php * 3.1) * 0.5, 0.0, cos(php * 2.7) * 0.5)))
				_mm.set_instance_custom_data(k, Color(php, timer, BOUND_H if r == 0 else 0.0, float(p)))
				_mm.visible_instance_count = k + 1

func _process(delta: float) -> void:   # timed for the perf overlay (perf_probe.gd)
	var t0 := PerfProbe.now()
	_process_timed(delta)
	PerfProbe.add("gas", t0)

func _process_timed(delta: float) -> void:
	if not enabled:
		return
	_t += delta
	timer += delta
	level = level_at(timer)
	if level > _shown:
		_fill_to(level)
	_mat.set_shader_parameter("gas_time", timer)
	var soon := next_in()
	var nxt := HALF - (level + 2) * TILE
	_frame.visible = soon < 6.0 and soon > 0.0 and nxt > 0.0
	if _frame.visible:
		if nxt != _frame_half:
			_frame_half = nxt
			_frame_mat.set_shader_parameter("half_size", nxt)
		_frame_mat.set_shader_parameter("alpha", (0.35 + 0.35 * sin(_t * (14.0 if soon < 2.0 else 7.0))) * minf(1.0, (6.0 - soon) / 1.5))
	# green glow spilling out of the two gas walls nearest to the camera
	if level > 0 and Fx.current and Fx.current.light_count() >= 4:
		var m := Quality.main_node()
		var cf = m.get("cam_focus") if m else null
		var f: Vector3 = cf if cf is Vector3 else Vector3.ZERO
		var s := safe_half()
		var cand := [
			[absf(s - f.x), Vector3(s + 1, 1.6, clampf(f.z, -s, s))],
			[absf(-s - f.x), Vector3(-s - 1, 1.6, clampf(f.z, -s, s))],
			[absf(s - f.z), Vector3(clampf(f.x, -s, s), 1.6, s + 1)],
			[absf(-s - f.z), Vector3(clampf(f.x, -s, s), 1.6, -s - 1)],
		]
		cand.sort_custom(func(a, b): return a[0] < b[0])
		for k in 2:
			Fx.current.emit_light(cand[k][1], Color(0.35, 1.0, 0.4), 14.0, 11.0)
