class_name GasRing
extends Node3D
# Showdown gas, mirrored from src/poison.js: the server only sends its timer (`pt` in each
# snapshot); the ring level follows from it (startAt, then one more ring of tiles every
# `interval` seconds, tiles of ring 0..level are poisoned). Visuals only: a glowing wall at the
# safe square, a red floor tint outside, a blinking frame where the next ring will land.
# One floor quad + four wall quads, all shader driven, no per-frame allocation.

const HALF := GameData.HALF
const TILE := GameData.TILE

var start_at := 28.0
var interval := 7.0
var max_level := 9
var enabled := true
var timer := 0.0            # the server's poison timer, advanced locally between snapshots
var level := 0
var safe_half := HALF       # animated value drawn
var _target_half := HALF
var _floor: MeshInstance3D
var _floor_mat: ShaderMaterial
var _walls: Array[MeshInstance3D] = []
var _wall_mat: ShaderMaterial
var _t := 0.0

const FLOOR_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix;
uniform float safe_half = 25.0;
uniform float next_half = -1.0;
uniform float warn = 0.0;
uniform float pulse = 0.0;
varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	float d = max(abs(wpos.x), abs(wpos.z));
	float out_a = step(safe_half, d) * (0.26 + 0.08 * pulse);
	vec3 col = mix(vec3(0.25, 0.85, 0.35), vec3(0.9, 0.15, 0.12), 0.55);
	float a = out_a;
	// next ring frame, 0.35 m wide
	float fr = step(next_half - 0.35, d) * step(d, next_half) * warn * step(0.0, next_half);
	col = mix(col, vec3(0.5, 2.4, 0.8), fr);
	a = max(a, fr * (0.35 + 0.35 * pulse));
	ALBEDO = col;
	ALPHA = a;
}
"""

const WALL_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix;
uniform float time = 0.0;
varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	float u = wpos.x + wpos.z;
	float h = clamp(wpos.y / 4.0, 0.0, 1.0);
	float band = 0.5 + 0.5 * sin(u * 1.3 + time * 1.6) * sin(wpos.y * 2.0 - time * 1.1);
	ALBEDO = mix(vec3(0.12, 0.75, 0.3), vec3(0.45, 1.0, 0.55), band);
	ALPHA = (1.0 - h) * (0.35 + 0.35 * band);
}
"""

func setup(params: Dictionary = {}) -> void:
	start_at = float(params.get("startAt", 28.0))
	interval = float(params.get("interval", 7.0))
	enabled = start_at < 1e6
	var fq := PlaneMesh.new()
	fq.size = Vector2(260, 260)
	_floor = MeshInstance3D.new()
	_floor.mesh = fq
	_floor.position.y = 0.06
	_floor.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_floor_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = FLOOR_SHADER
	_floor_mat.shader = sh
	_floor.material_override = _floor_mat
	add_child(_floor)
	_wall_mat = ShaderMaterial.new()
	var sw := Shader.new()
	sw.code = WALL_SHADER
	_wall_mat.shader = sw
	for k in 4:
		var w := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(2.0, 4.0)
		w.mesh = q
		w.material_override = _wall_mat
		w.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(w)
		_walls.append(w)
	visible = false
	_layout()

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

# The tile at (x, z) is gassed (ring <= level), like Poison.isPoisonedAt without its lanes.
func in_gas(x: float, z: float) -> bool:
	if level <= 0:
		return false
	var i := int(floor((x + HALF) / TILE))
	var j := int(floor((z + HALF) / TILE))
	var n := GameData.N
	if i < 0 or j < 0 or i >= n or j >= n:
		return true
	return mini(mini(i, j), mini(n - 1 - i, n - 1 - j)) <= level

func _layout() -> void:
	var s := safe_half
	_walls[0].position = Vector3(0, 2.0, -s); _walls[0].rotation = Vector3.ZERO
	_walls[1].position = Vector3(0, 2.0, s); _walls[1].rotation = Vector3.ZERO
	_walls[2].position = Vector3(-s, 2.0, 0); _walls[2].rotation = Vector3(0, PI / 2, 0)
	_walls[3].position = Vector3(s, 2.0, 0); _walls[3].rotation = Vector3(0, PI / 2, 0)
	for w in _walls:
		w.scale = Vector3(s, 1.0, 1.0)
	_floor_mat.set_shader_parameter("safe_half", s)

func _process(delta: float) -> void:
	if not enabled:
		return
	_t += delta
	timer += delta
	level = level_at(timer)
	_target_half = half_at_level(level)
	visible = level > 0 or next_in() < 6.0
	if not visible:
		return
	if absf(safe_half - _target_half) > 0.01:
		safe_half = move_toward(safe_half, _target_half, delta * 2.2)   # the wall closes in over ~1 s
		_layout()
	var soon := next_in()
	var nxt := half_at_level(level + 1) if level < max_level else -1.0
	var warn := 1.0 if (soon < 6.0 and soon > 0.0 and nxt > 0.0) else 0.0
	warn *= clampf((6.0 - soon) / 1.5, 0.0, 1.0)
	_floor_mat.set_shader_parameter("warn", warn)
	_floor_mat.set_shader_parameter("next_half", nxt)
	_floor_mat.set_shader_parameter("pulse", 0.5 + 0.5 * sin(_t * (14.0 if soon < 2.0 else 7.0)))
	_wall_mat.set_shader_parameter("time", _t)
	for w in _walls:
		w.visible = level > 0
