class_name Lighting
extends Node
# Sun, sky, ambient, fog and exposure: the four times of day of src/lighting.js (Morning, Noon, Sunset,
# Night; the web default is Sunset), bent every frame by the map's weather (weather.gd `modify`).
# It drives the main scene's DirectionalLight3D and WorldEnvironment (main.gd `sun` / `env`), so it
# needs no wiring: Arena creates one per match and it dies with the arena.
# Also: cheap blob shadows under the fighters (Quality "low": no shadow map at all).

# sun colour, sun intensity (three units), elevation, azimuth (0 = sun behind the camera),
# sky, ground, hemisphere intensity, fog colour, near/far, exposure, bloom, night, shadow strength
const PRESETS := [
	{"name": "Morning", "sun": "#ffcf9e", "sunI": 4.8, "el": 28.0, "az": -105.0, "sky": "#b3d1ff", "ground": "#7d6446", "hemiI": 0.7, "fog": "#b6d2ef", "fogNear": 55.0, "fogFar": 140.0, "exposure": 1.0, "bloom": 0.35, "night": 0.0, "shadowI": 0.95},
	{"name": "Noon", "sun": "#fff3de", "sunI": 4.8, "el": 52.0, "az": -150.0, "sky": "#c6e1ff", "ground": "#8c7552", "hemiI": 0.75, "fog": "#a9cff3", "fogNear": 55.0, "fogFar": 140.0, "exposure": 0.92, "bloom": 0.3, "night": 0.0, "shadowI": 0.95},
	{"name": "Sunset", "sun": "#ff7a2e", "sunI": 6.2, "el": 19.0, "az": -245.0, "sky": "#7a70c4", "ground": "#51301f", "hemiI": 0.55, "fog": "#e0876a", "fogNear": 55.0, "fogFar": 140.0, "exposure": 1.08, "bloom": 0.55, "night": 0.35, "shadowI": 0.96},
	{"name": "Night", "sun": "#7f9dff", "sunI": 0.75, "el": 50.0, "az": -200.0, "sky": "#2a3c78", "ground": "#0b0b14", "hemiI": 0.45, "fog": "#0a1122", "fogNear": 55.0, "fogFar": 140.0, "exposure": 1.0, "bloom": 0.85, "night": 1.0, "shadowI": 0.9},
]
const COLOR_KEYS := ["sun", "sky", "ground", "fog"]
const NUM_KEYS := ["sunI", "el", "az", "hemiI", "fogNear", "fogFar", "exposure", "bloom", "night", "shadowI"]
# the cartoon look (main.js `lighting.style`)
const STYLE := {"hemi": 1.45, "exposure": 0.95, "sun": 0.9}

static var tod := 2.0          # 0 Morning, 1 Noon, 2 Sunset (default), 3 Night; the settings menu may set it
static var cycle := false      # slow day/night cycle (25 s per phase)

var sun: DirectionalLight3D
var env: Environment
var weather: Node              # Weather (weather.gd) or null
var arena: Node3D
var state: Dictionary = {}
var _t := 2.0
var _sky_override := Color(0, 0, 0, 0)
var _blob_tex: Texture2D
var _blobs: Array = []
var no_shadow := false

func setup(a: Node3D, map: Dictionary) -> void:
	arena = a
	var m := Quality.main_node()
	sun = m.get("sun")
	var we: WorldEnvironment = m.get("env")
	env = we.environment
	no_shadow = OS.get_cmdline_user_args().has("--noshadow")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--tod="):
			tod = float(arg.substr(6))
	_t = tod
	if map.get("sky", false):
		_sky_override = Color(map.swatch[1])
	env.background_mode = Environment.BG_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_depth_curve = 1.0
	env.fog_sun_scatter = 0.0
	env.fog_aerial_perspective = 0.0
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 44.0
	sun.directional_shadow_blend_splits = true
	sun.shadow_bias = 0.04
	sun.shadow_normal_bias = 1.2
	evaluate()
	apply()

func evaluate() -> void:
	var i0 := int(floorf(_t)) % 4
	var i1 := (i0 + 1) % 4
	var f := _t - floorf(_t)
	f = f * f * (3.0 - 2.0 * f)
	var a: Dictionary = PRESETS[i0]
	var b: Dictionary = PRESETS[i1]
	for k in NUM_KEYS:
		state[k] = lerpf(float(a[k]), float(b[k]), f)
	for k in COLOR_KEYS:
		state[k] = Color(a[k]).lerp(Color(b[k]), f)

func sun_dir() -> Vector3:
	var el := deg_to_rad(float(state.el))
	var az := deg_to_rad(float(state.az))
	return Vector3(cos(el) * sin(az), sin(el), cos(el) * cos(az)).normalized()

func apply() -> void:
	var S := state
	sun.basis = Basis.looking_at(-sun_dir(), Vector3.UP)
	sun.light_color = S.sun
	# three's physical units (4.8) to Godot's (about 1 is a bright sun)
	sun.light_energy = float(S.sunI) / 4.8 * STYLE.sun * 1.15
	sun.shadow_opacity = clampf(float(S.shadowI), 0.0, 1.0)
	var q := Quality.preset()
	sun.shadow_enabled = int(q.shadow) > 0 and not no_shadow
	# hemisphere light + the studio environment of the web build (a neutral fill): sky and ground, whitened
	var amb: Color = (S.sky as Color).lerp(S.ground, 0.25).lerp(Color.WHITE, 0.45)
	env.ambient_light_color = amb
	env.ambient_light_energy = float(S.hemiI) * STYLE.hemi * 1.05
	var fog: Color = S.fog
	env.fog_light_color = fog
	env.fog_depth_begin = float(S.fogNear)
	env.fog_depth_end = float(S.fogFar)
	env.background_color = _sky_override.lerp(fog, 0.0) if _sky_override.a > 0.0 else fog
	if _sky_override.a > 0.0:
		env.background_color = _sky_override
	env.tonemap_exposure = float(S.exposure) * STYLE.exposure
	env.glow_enabled = bool(q.glow)
	env.glow_intensity = 0.5 + 0.5 * float(S.bloom)
	env.glow_bloom = 0.0
	env.glow_hdr_threshold = 1.1

func update(delta: float) -> void:
	if cycle:
		_t = fposmod(_t + delta / 25.0, 4.0)
	else:
		var diff := fposmod(tod - _t, 4.0)
		if diff > 1e-4:
			_t = fposmod(_t + minf(diff, delta * 0.9), 4.0)
	evaluate()
	if weather and weather.has_method("modify"):
		weather.modify(state)
	apply()

func apply_quality() -> void:
	var q := Quality.preset()
	sun.shadow_enabled = int(q.shadow) > 0 and not no_shadow
	var real: bool = int(q.shadow) > 0
	for b in _blobs:
		if is_instance_valid(b):
			b.visible = not real

# A round dark quad under a fighter: the low preset's shadow (no shadow map is rendered).
func attach_blob(f: Node3D) -> void:
	if f.has_meta("blob"):
		return
	if _blob_tex == null:
		var g := Gradient.new()
		g.set_color(0, Color(0, 0, 0, 0.55))
		g.set_color(1, Color(0, 0, 0, 0))
		g.set_offset(0, 0.0)
		g.set_offset(1, 1.0)
		var gt := GradientTexture2D.new()
		gt.gradient = g
		gt.fill = GradientTexture2D.FILL_RADIAL
		gt.fill_from = Vector2(0.5, 0.5)
		gt.fill_to = Vector2(1.0, 0.5)
		gt.width = 64
		gt.height = 64
		_blob_tex = gt
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(1.7, 1.7)
	q.orientation = PlaneMesh.FACE_Y
	mi.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = _blob_tex
	m.no_depth_test = false
	m.render_priority = -1
	mi.material_override = m
	mi.position.y = 0.04
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = int(Quality.preset().shadow) == 0
	f.add_child(mi)
	f.set_meta("blob", true)
	_blobs.append(mi)
