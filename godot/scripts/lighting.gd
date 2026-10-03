class_name Lighting
extends Node
# Sun, sky, ambient, fog and exposure: the four times of day of src/lighting.js (Morning, Noon, Sunset,
# Night; the web default is Sunset), bent every frame by the map's weather (weather.gd `modify`).
# It drives the main scene's DirectionalLight3D and WorldEnvironment (main.gd `sun` / `env`), so it
# needs no wiring: Arena creates one per match and it dies with the arena. The world materials add
# the web's cartoon light ramp and rim light (assets/shaders/toon.gdshaderinc).
# Also: cheap blob shadows under the fighters (Quality "low": no shadow map at all).

# sun colour, sun intensity (three units), elevation, azimuth (0 = sun behind the camera),
# sky, ground, hemisphere intensity, studio environment, fog colour, near/far, exposure, bloom, night,
# rim strength and colour, shadow strength
const PRESETS := [
	{"name": "Morning", "sun": "#ffcf9e", "sunI": 4.8, "el": 28.0, "az": -105.0, "sky": "#b3d1ff", "ground": "#7d6446", "hemiI": 0.7, "env": 0.15, "fog": "#b6d2ef", "fogNear": 55.0, "fogFar": 140.0, "exposure": 1.0, "bloom": 0.35, "night": 0.0, "rim": 0.3, "rimC": "#ffe0bc", "shadowI": 0.95},
	{"name": "Noon", "sun": "#fff3de", "sunI": 4.8, "el": 52.0, "az": -150.0, "sky": "#c6e1ff", "ground": "#8c7552", "hemiI": 0.75, "env": 0.18, "fog": "#a9cff3", "fogNear": 55.0, "fogFar": 140.0, "exposure": 0.92, "bloom": 0.3, "night": 0.0, "rim": 0.25, "rimC": "#ffffff", "shadowI": 0.95},
	{"name": "Sunset", "sun": "#ff7a2e", "sunI": 6.2, "el": 19.0, "az": -245.0, "sky": "#7a70c4", "ground": "#51301f", "hemiI": 0.55, "env": 0.12, "fog": "#e0876a", "fogNear": 55.0, "fogFar": 140.0, "exposure": 1.08, "bloom": 0.55, "night": 0.35, "rim": 0.6, "rimC": "#ffa066", "shadowI": 0.96},
	{"name": "Night", "sun": "#7f9dff", "sunI": 0.75, "el": 50.0, "az": -200.0, "sky": "#2a3c78", "ground": "#0b0b14", "hemiI": 0.45, "env": 0.05, "fog": "#0a1122", "fogNear": 55.0, "fogFar": 140.0, "exposure": 1.0, "bloom": 0.85, "night": 1.0, "rim": 0.55, "rimC": "#8fb0ff", "shadowI": 0.9},
]
const COLOR_KEYS := ["sun", "sky", "ground", "fog", "rimC"]
const NUM_KEYS := ["sunI", "el", "az", "hemiI", "env", "fogNear", "fogFar", "exposure", "bloom", "night", "rim", "shadowI"]
# the cartoon look (main.js `lighting.style`)
const STYLE := {"hemi": 1.45, "env": 0.55, "exposure": 0.95, "sun": 0.9}
# The follow camera's offset from its focus (src/game.js camOffset: a ~47 degree pitch, 37 m away).
# The fog distances were tuned for a camera 22 m from the action: they move out by the difference.
const CAM_OFFSET := Vector3(0, 27.4, 25)
# Diffuse light of the web's studio environment (RoomEnvironment, prefiltered), per unit of `env`.
const ENV_FILL := 6.0

static var tod := 2.0          # 0 Morning, 1 Noon, 2 Sunset (default), 3 Night; the settings menu may set it
static var cycle := false      # slow day/night cycle (25 s per phase)
static var brightness := 1.0   # the options' brightness (settings.js exposure), on top of the tone mapping

var sun: DirectionalLight3D
var env: Environment
var weather: Node              # Weather (weather.gd) or null
var arena: Node3D
var state: Dictionary = {}
var fog_shift := maxf(0.0, CAM_OFFSET.length() - 22.0)
var _t := 2.0
var _sky_override := Color(0, 0, 0, 0)
var _sky_mat: ShaderMaterial
var _sky_key := Vector3.ZERO   # last ambient pushed to the sky (its radiance is re-rendered on change)
var _blob_tex: Texture2D
var _blobs: Array = []
var no_shadow := false

func setup(a: Node3D, map: Dictionary) -> void:
	arena = a
	Foliage.ensure_globals()
	var m := Quality.main_node()
	sun = m.get("sun")
	var we: WorldEnvironment = m.get("env")
	env = we.environment
	no_shadow = DebugArgs.list().has("--noshadow")
	for arg in DebugArgs.list():
		if arg.begins_with("--tod="):
			tod = float(arg.substr(6))
	_t = tod
	if map.get("sky", false):
		_sky_override = Color(map.swatch[1])
	env.background_mode = Environment.BG_COLOR
	# hemisphere light: a sky used for the ambient light only (assets/shaders/hemi_sky.gdshader)
	_sky_mat = ShaderMaterial.new()
	_sky_mat.shader = load("res://assets/shaders/hemi_sky.gdshader")
	var sky := Sky.new()
	sky.sky_material = _sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_32
	env.sky = sky
	# (the Compatibility renderer, web: a flat colour, mostly the sky's, see apply)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR if _compat() else Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 1.0
	env.ambient_light_energy = 1.0
	env.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_depth_curve = 1.0
	env.fog_density = 1.0
	env.fog_sky_affect = 0.0
	env.fog_sun_scatter = 0.0
	env.fog_aerial_perspective = 0.0
	# Tone mapping: the web's cartoon grade (saturation 1.18, contrast 1.06) then three's
	# NeutralToneMapping, baked into a colour-correction LUT (see _grade_lut). Godot's Linear tone
	# mapper only scales by the exposure; half of it (LUT_SCALE) keeps highlights up to 2.0 inside
	# the LUT's 0..1 input, which the LUT scales back. The Compatibility renderer (web) has no
	# colour-correction LUT: sight.gd's full-screen pass runs the same grade + Neutral mapping on the
	# frame (compat_grade()), at full exposure (Compatibility does not scale the background by the
	# exposure: at half exposure the sky / fog came out twice too bright, and nothing above 1.0
	# survives the 8-bit frame anyway).
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_white = 1.0
	env.adjustment_enabled = not DebugArgs.has("noadj") and not compat_grade()
	env.adjustment_brightness = 1.0
	if _use_lut():
		env.adjustment_contrast = 1.0
		env.adjustment_saturation = 1.0
		env.adjustment_color_correction = _grade_lut()
	else:
		env.adjustment_contrast = 1.0
		env.adjustment_saturation = 0.95
	# UnrealBloomPass(strength = the time of day's bloom, radius 0.5, threshold 1.6): additive, HDR only
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.glow_hdr_threshold = 1.6
	env.glow_hdr_scale = 2.0
	env.glow_strength = 1.0
	env.glow_bloom = 0.0
	env.glow_normalized = true
	for lv in 7:
		env.set_glow_level(lv, [0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0][lv])
	# PCF shadows (radius 3) of a 64 m square that follows the view: one orthogonal map covers what
	# the 37 m camera sees, at about the web's texel density
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 72.0
	sun.directional_shadow_fade_start = 0.95
	sun.shadow_bias = 0.03
	sun.shadow_normal_bias = 1.0
	sun.shadow_blur = 1.5
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
	# three blends the key frames in linear space
	for k in COLOR_KEYS:
		state[k] = Color(a[k]).srgb_to_linear().lerp(Color(b[k]).srgb_to_linear(), f).linear_to_srgb()

func sun_dir() -> Vector3:
	var el := deg_to_rad(float(state.el))
	var az := deg_to_rad(float(state.az))
	return Vector3(cos(el) * sin(az), sin(el), cos(el) * cos(az)).normalized()

# Units: three's lights are physical (a Lambert surface gets colour * intensity / PI) while Godot's
# energy 1 lights an albedo fully, so energy = three intensity / PI, for the ambient light too.
func apply() -> void:
	var S := state
	sun.basis = Basis.looking_at(-sun_dir(), Vector3.UP)
	sun.light_color = S.sun
	sun.light_energy = float(S.sunI) * STYLE.sun / PI
	sun.shadow_opacity = clampf(float(S.shadowI), 0.0, 1.0)
	var q := Quality.preset()
	sun.shadow_enabled = int(q.shadow) > 0 and not no_shadow
	var hemi := float(S.hemiI) * STYLE.hemi / PI
	var sky_l: Color = (S.sky as Color).srgb_to_linear() * hemi
	var ground_l: Color = (S.ground as Color).srgb_to_linear() * hemi
	var fill := float(S.env) * STYLE.env * ENV_FILL / PI
	var key := Vector3(sky_l.r + sky_l.g * 3.1 + sky_l.b * 7.3, ground_l.r + ground_l.g * 3.1 + ground_l.b * 7.3, fill)
	if key.distance_squared_to(_sky_key) > 1e-7:
		_sky_key = key
		_sky_mat.set_shader_parameter("sky_col", Vector3(sky_l.r, sky_l.g, sky_l.b))
		_sky_mat.set_shader_parameter("ground_col", Vector3(ground_l.r, ground_l.g, ground_l.b))
		_sky_mat.set_shader_parameter("fill", Vector3(fill, fill, fill))
		var flat: Color = sky_l * 0.85 + ground_l * 0.15 + Color(fill, fill, fill)
		env.ambient_light_color = Color(flat.r, flat.g, flat.b).linear_to_srgb()
	var fog: Color = S.fog
	env.fog_light_color = fog
	env.fog_light_energy = 1.0
	# three fogs by view depth, Godot by distance: 4 % further covers the difference off-axis
	env.fog_depth_begin = (float(S.fogNear) + fog_shift) * 1.04
	env.fog_depth_end = (float(S.fogFar) + fog_shift) * 1.04
	if Quality.shaders_low:   # the LOW world shaders draw this fog themselves (toon.gdshaderinc SIGHT_SHADE)
		var fl := fog.srgb_to_linear() * env.fog_light_energy
		RenderingServer.global_shader_parameter_set("g_fog", Vector4(fl.r, fl.g, fl.b, 1.0))
		RenderingServer.global_shader_parameter_set("g_fog_range", Vector4(env.fog_depth_begin, env.fog_depth_end, 0.0, 0.0))
	env.background_color = _sky_override if _sky_override.a > 0.0 else fog
	env.tonemap_exposure = brightness * float(S.exposure) * STYLE.exposure * (LUT_SCALE if env.adjustment_enabled and _use_lut() else 1.0 if compat_grade() else COMPAT_EXPOSURE)
	env.glow_enabled = bool(q.glow)
	env.glow_intensity = float(S.bloom)
	var rim: Color = (S.rimC as Color).srgb_to_linear()
	RenderingServer.global_shader_parameter_set("g_rim", Vector4(rim.r, rim.g, rim.b, float(S.rim)))
	var skyc: Color = (S.sky as Color).srgb_to_linear()
	RenderingServer.global_shader_parameter_set("g_sky", Vector4(skyc.r, skyc.g, skyc.b, 1.0))

const LUT_SCALE := 0.5
const COMPAT_EXPOSURE := 0.9   # without the LUT: no highlight roll-off, a little less light instead
const LUT_SIZE := 33
static var _lut: ImageTexture3D

static func _compat() -> bool:
	return RenderingServer.get_current_rendering_method() == "gl_compatibility"

static func _use_lut() -> bool:
	return not _compat() and not DebugArgs.has("nolut")

# Compatibility renderer (web export): the grade LUT's job is done by sight.gd's screen pass.
static func compat_grade() -> bool:
	return _compat() and not DebugArgs.has("nolut") and not DebugArgs.has("noadj")

# The web's last steps as a 3D LUT over the (sRGB encoded) tone-mapper output: undo LUT_SCALE, the
# cartoon grade pass (cartoon.js cartoonGradePass), three's NeutralToneMapping, back to sRGB.
# (The grade runs after the exposure here, before it on the web: the same to a percent.)
static func _grade_lut() -> ImageTexture3D:
	if _lut:
		return _lut
	var images: Array[Image] = []
	var n := LUT_SIZE
	for b in n:
		var data := PackedByteArray()
		data.resize(n * n * 3)
		var o := 0
		for g in n:
			for r in n:
				var c := Color(float(r) / (n - 1), float(g) / (n - 1), float(b) / (n - 1)).srgb_to_linear()
				var v := Vector3(c.r, c.g, c.b) / LUT_SCALE
				var l := v.dot(Vector3(0.2126, 0.7152, 0.0722))
				v = Vector3(l, l, l).lerp(v, 1.18)
				v = (v - Vector3.ONE * 0.18) * 1.06 + Vector3.ONE * 0.18
				v = _neutral(v.max(Vector3.ZERO))
				var out := Color(v.x, v.y, v.z).linear_to_srgb()
				data[o] = clampi(roundi(out.r * 255.0), 0, 255)
				data[o + 1] = clampi(roundi(out.g * 255.0), 0, 255)
				data[o + 2] = clampi(roundi(out.b * 255.0), 0, 255)
				o += 3
		images.append(Image.create_from_data(n, n, false, Image.FORMAT_RGB8, data))
	_lut = ImageTexture3D.new()
	_lut.create(Image.FORMAT_RGB8, n, n, n, false, images)
	return _lut

# three.js NeutralToneMapping (Khronos PBR Neutral), exposure already applied
static func _neutral(c: Vector3) -> Vector3:
	const START := 0.8 - 0.04
	const DESAT := 0.15
	var x := minf(c.x, minf(c.y, c.z))
	var offset := x - 6.25 * x * x if x < 0.08 else 0.04
	c -= Vector3.ONE * offset
	var peak := maxf(c.x, maxf(c.y, c.z))
	if peak < START:
		return c
	var d := 1.0 - START
	var new_peak := 1.0 - d * d / (peak + d - START)
	c *= new_peak / peak
	var g := 1.0 - 1.0 / (DESAT * (peak - new_peak) + 1.0)
	return c.lerp(Vector3.ONE * new_peak, g)

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
	_head_lamp()

var lamp: SpotLight3D

# The head-lamp of the local player (game.js updateLights): a warm spot ahead of him that fades in
# after dusk (three: 70 * smoothstep(night, 0.2, 1), range 26, cone 0.62 rad, decay 1.4). It casts
# shadows on High only (one more shadow pass), like the web's full detail.
func _head_lamp() -> void:
	var m := Quality.main_node()
	var me = m.get("me") if m else null
	var k := smoothstep(0.2, 1.0, float(state.get("night", 0.0)))
	if me == null or not is_instance_valid(me) or not me.alive or k < 0.001 or DebugArgs.has("nolight"):
		if lamp:
			lamp.visible = false
		return
	if lamp == null:
		lamp = SpotLight3D.new()
		lamp.light_color = Color("ffd7a0")
		lamp.spot_range = 26.0
		lamp.spot_attenuation = 1.4
		lamp.spot_angle = rad_to_deg(0.62)
		lamp.spot_angle_attenuation = 0.6
		lamp.shadow_bias = 0.05
		add_child(lamp)
	var yaw: float = (me as Node3D).rotation.y
	var d := Vector3(sin(yaw), 0.0, cos(yaw))
	var p: Vector3 = (me as Node3D).position
	lamp.position = Vector3(p.x + d.x * 0.6, 2.05, p.z + d.z * 0.6)
	lamp.look_at(Vector3(p.x + d.x * 9.0, 0.0, p.z + d.z * 9.0))
	lamp.visible = true
	lamp.light_energy = 70.0 * k / PI
	# (not on the web: in the Compatibility renderer a shadowed spot adds a shadow map and a whole
	# additive lighting pass over everything it touches)
	lamp.shadow_enabled = int(Quality.preset().shadow) >= 2048 and not no_shadow and not OS.has_feature("web")

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
