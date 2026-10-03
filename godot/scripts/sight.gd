class_name Sight
extends CanvasLayer

# Line of sight (src/sight.js): what walls, trees and crates hide from you is dimmed and greyed out;
# in the sandstorm the hidden ground drowns in dust instead.
#
# Same visibility as the web: rays walked through the tile grid (DDA) from the viewer, each running
# INTO_WALL metres into the tile that stops it so its face and top stay lit, the area they cover
# drawn into a SIZE x SIZE top-down mask. The web casts a fan of 900 rays on the CPU and fills their
# polygon; GDScript is too slow for that every frame (2-3 ms on a desktop CPU), so here each mask
# texel walks the same DDA towards itself on the GPU (a tiny SubViewport, redrawn only when the
# viewer moves or a tile opens up): the same shape, sampled per texel instead of per 0.4 degree.
# A full-screen pass then projects every pixel onto the y = 0.6 plane along its view ray, looks the
# mask up there with the same 9-tap blur, and shades the hidden pixels. The web shades in linear HDR,
# before its cartoon grade and Neutral tone mapping; here it is a canvas pass over the finished 3D
# image (screen texture, layer -1: under the HUD), so with the grade LUT (Mobile / Forward+) the pass
# undoes lighting.gd's LUT (Neutral, grade) to get the HDR colour back, shades it like the web and
# redoes the LUT. Without the LUT (Compatibility: Linear tone mapper) it shades the decoded colour.
#
# Low on phones / tablets (Quality.shaders_low): no full-screen pass for the sight (it copied the
# whole frame, then read it back with 9 mask taps and the grade undone and redone per pixel). The
# 9-tap blur is drawn once into a second 256 x 256 mask (BLUR_SHADER) when the mask changes, and the
# LOW world shaders shade their own hidden pixels from it (toon.gdshaderinc SIGHT_SHADE: the same
# ray onto y = 0.6, one lookup, the same grey / dim / tint, before the lighting) through the global
# uniforms g_sight*; they draw the depth fog themselves to shade it too (lighting.gd g_fog). The
# sandstorm's dust, which must also hide what those shaders do not draw (items, fauna, effects), is a
# blended quad over the frame (DUST_SHADER: one lookup, no copy). On the Compatibility renderer the
# pass stays for the grade only (and does it all in the sandstorm).
#
# Self-driven: main.gd adds one node; it reads main.arena / main.me / main.cam / main.env each frame.

const SIZE := 256                       # mask resolution over the whole arena (~0.2 m per texel)
const INTO_WALL := 1.4                  # metres a ray keeps going inside the occluder
const PAD := 2                          # blocked border tiles around the grid (rays never leave it)
const W := GameData.N + 2 * PAD

# The mask: white where the viewer sees (sight.js castRay, per texel).
const MASK_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D blocked : filter_nearest;   // W x W, red = 1: stops sight (PAD blocked tiles around)
uniform vec2 eye;                             // viewer, tile units
uniform float n = 25.0;
uniform float into = 0.7;                     // tiles
const int PAD = %d;
bool solid(ivec2 c) { return texelFetch(blocked, c + ivec2(PAD), 0).r > 0.5; }
void fragment() {
	vec2 p = UV * n;
	vec2 d = p - eye;
	float len = length(d);
	float vis = 1.0;
	if (len > 1e-4) {
		vec2 dir = d / len;
		if (abs(dir.x) < 1e-6) dir.x = 1e-6;
		if (abs(dir.y) < 1e-6) dir.y = 1e-6;
		ivec2 c = ivec2(floor(eye));
		ivec2 st = ivec2(dir.x > 0.0 ? 1 : -1, dir.y > 0.0 ? 1 : -1);
		vec2 td = abs(1.0 / dir);
		vec2 tm = vec2(dir.x > 0.0 ? float(c.x + 1) - eye.x : eye.x - float(c.x),
			dir.y > 0.0 ? float(c.y + 1) - eye.y : eye.y - float(c.y)) * td;
		float t = 0.0;
		float hit = -1.0;
		float end = 1e9;
		for (int k = 0; k < 128; k++) {
			if (tm.x < tm.y) { t = tm.x; tm.x += td.x; c.x += st.x; }
			else { t = tm.y; tm.y += td.y; c.y += st.y; }
			bool b = solid(c);
			if (hit < 0.0) {
				if (t >= len) break;          // reached the texel in the open: seen
				if (b) hit = t;
			} else if (!b || t - hit >= into) {
				end = min(t, hit + into);
				break;
			}
		}
		if (hit >= 0.0) vis = len <= min(end, hit + into) ? 1.0 : 0.0;
	}
	COLOR = vec4(vec3(vis), 1.0);
}
""" % PAD

const SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform sampler2D vis_tex : filter_linear, repeat_disable;
uniform vec3 cam_pos;
uniform vec3 cam_right;
uniform vec3 cam_up;
uniform vec3 cam_back;
uniform vec2 tan_half = vec2(0.6, 0.36);   // x: horizontal, y: vertical
uniform float half_size = 25.0;
uniform float amount = 0.0;
uniform vec2 center;
uniform vec3 dust;                          // linear
uniform float dust_amt = 0.0;
uniform float clear_r = 0.0;
uniform float outside = 0.0;
float vis(vec2 uv) {
	return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? outside : texture(vis_tex, uv).r;
}
vec3 to_lin(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 to_srgb(vec3 c) {
	c = clamp(c, vec3(0.0), vec3(1.0));
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
// lighting.gd _grade_lut: cartoon grade (saturation 1.18, contrast 1.06) then three's NeutralToneMapping
const float START = 0.76;
const float DESAT = 0.15;
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
vec3 neutral(vec3 c) {
	float x = min(c.r, min(c.g, c.b));
	c -= x < 0.08 ? x - 6.25 * x * x : 0.04;
	float peak = max(c.r, max(c.g, c.b));
	if (peak < START) return c;
	float d = 1.0 - START;
	float np = 1.0 - d * d / (peak + d - START);
	c *= np / peak;
	float g = 1.0 - 1.0 / (DESAT * (peak - np) + 1.0);
	return mix(c, vec3(np), g);
}
vec3 neutral_inv(vec3 c) {   // exact below the highlight roll-off; the roll-off's desaturation is ignored
	float peak = max(c.r, max(c.g, c.b));
	if (peak >= START) {
		float d = 1.0 - START;
		float np = min(peak, 0.995);
		c *= (d * d / (1.0 - np) - d + START) / max(peak, 1e-4);
	}
	float y = min(c.r, min(c.g, c.b));
	return c + (y < 0.04 ? sqrt(max(y, 0.0)) / 2.5 - y : 0.04);   // min out = 6.25 m^2 below 0.08
}
vec3 grade(vec3 v) {
	v = mix(vec3(dot(v, LUM)), v, 1.18);
	return max((v - 0.18) * 1.06 + 0.18, vec3(0.0));
}
vec3 grade_inv(vec3 v) {
	v = (v - 0.18) / 1.06 + 0.18;
	float l = dot(v, LUM);
	return max(vec3(l) + (v - vec3(l)) / 1.18, vec3(0.0));
}
uniform float graded = 0.0;   // 1: the frame went through the grade LUT; 2: it did not (Compatibility):
                              // this pass grades every pixel itself (lighting.gd compat_grade)
uniform float lut_scale = 0.5;
void fragment() {
	vec3 src = texture(screen_tex, SCREEN_UV).rgb;
	float hide = 0.0;
	if (amount > 0.0) {   // (menus, web grade only: no mask lookups)
		vec2 ndc = vec2(SCREEN_UV.x * 2.0 - 1.0, 1.0 - SCREEN_UV.y * 2.0);
		vec3 dir = normalize(-cam_back + cam_right * ndc.x * tan_half.x + cam_up * ndc.y * tan_half.y);
		vec2 hit = cam_pos.xz + dir.xz * ((0.6 - cam_pos.y) / min(dir.y, -1e-3));
		vec2 uv = (hit + half_size) / (2.0 * half_size);
		float r = 2.5 / 256.0;
		float v = vis(uv) * 0.28
			+ (vis(uv + vec2(r, 0.0)) + vis(uv - vec2(r, 0.0)) + vis(uv + vec2(0.0, r)) + vis(uv - vec2(0.0, r))) * 0.12
			+ (vis(uv + vec2(r, r)) + vis(uv - vec2(r, r)) + vis(uv + vec2(r, -r)) + vis(uv - vec2(r, -r))) * 0.06;
		hide = 1.0 - v;
		if (clear_r > 0.0) hide = max(hide, smoothstep(clear_r * 0.85, clear_r * 1.1, distance(hit, center)));
		hide *= amount;
	}
	if (hide < 0.002 && graded < 1.5) {
		COLOR = vec4(src, 1.0);
	} else {
		vec3 col = to_lin(src);
		if (graded > 1.5) col /= lut_scale;
		else if (graded > 0.5) col = grade_inv(neutral_inv(col));
		if (hide >= 0.002) {
			float l = dot(col, vec3(0.299, 0.587, 0.114));
			vec3 shade = mix(col, vec3(l), 0.5) * vec3(0.58, 0.61, 0.7);
			shade = mix(shade, dust * (0.85 + 0.3 * l), dust_amt);
			col = mix(col, shade, hide);
		}
		if (graded > 0.5) col = neutral(grade(col));
		COLOR = vec4(to_srgb(col), 1.0);
	}
}
"""

# Low on phones / tablets: SHADER's 9-tap blur of the mask, done once per mask update (256 x 256),
# for the world shaders' single lookup.
const BLUR_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D mask : filter_linear, repeat_disable;
uniform float outside = 0.0;
float vis(vec2 uv) {
	return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? outside : texture(mask, uv).r;
}
void fragment() {
	vec2 uv = UV;
	float r = 2.5 / 256.0;
	float v = vis(uv) * 0.28
		+ (vis(uv + vec2(r, 0.0)) + vis(uv - vec2(r, 0.0)) + vis(uv + vec2(0.0, r)) + vis(uv - vec2(0.0, r))) * 0.12
		+ (vis(uv + vec2(r, r)) + vis(uv - vec2(r, r)) + vis(uv + vec2(r, -r)) + vis(uv - vec2(r, -r))) * 0.06;
	COLOR = vec4(vec3(v), 1.0);
}
"""

# Low on phones / tablets with the grade LUT, in the sandstorm: the dust over the hidden pixels as a
# blended quad (no screen copy), SHADER's mix towards the dust in display space.
const DUST_SHADER := """
shader_type canvas_item;
render_mode unshaded, blend_mix;
uniform sampler2D vis_tex : filter_linear, repeat_disable;   // the blurred mask
uniform vec3 cam_pos;
uniform vec3 cam_right;
uniform vec3 cam_up;
uniform vec3 cam_back;
uniform vec2 tan_half = vec2(0.6, 0.36);
uniform float half_size = 25.0;
uniform float amount = 0.0;
uniform vec2 center;
uniform float clear_r = 0.0;
uniform float outside = 0.0;
uniform vec3 dust_col = vec3(0.8, 0.6, 0.4);   // sRGB, as shown
uniform float dust_amt = 0.0;
void fragment() {
	vec2 ndc = vec2(SCREEN_UV.x * 2.0 - 1.0, 1.0 - SCREEN_UV.y * 2.0);
	vec3 dir = -cam_back + cam_right * ndc.x * tan_half.x + cam_up * ndc.y * tan_half.y;
	vec2 hit = cam_pos.xz + dir.xz * ((0.6 - cam_pos.y) / min(dir.y, -1e-3));
	vec2 uv = (hit + half_size) / (2.0 * half_size);
	float v = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? outside : texture(vis_tex, uv).r;
	float hide = 1.0 - v;
	if (clear_r > 0.0) hide = max(hide, smoothstep(clear_r * 0.85, clear_r * 1.1, distance(hit, center)));
	COLOR = vec4(dust_col, hide * amount * dust_amt);
}
"""

# The world shaders' globals (LOW variant, toon.gdshaderinc): added before they compile.
static var _globals := false

static func ensure_globals() -> void:
	if _globals:
		return
	_globals = true
	var white := Image.create(1, 1, false, Image.FORMAT_R8)
	white.fill(Color.WHITE)
	RenderingServer.global_shader_parameter_add("g_sight_tex", RenderingServer.GLOBAL_VAR_TYPE_SAMPLER2D, ImageTexture.create_from_image(white))
	RenderingServer.global_shader_parameter_add("g_sight", RenderingServer.GLOBAL_VAR_TYPE_VEC4, Vector4.ZERO)
	RenderingServer.global_shader_parameter_add("g_sight_b", RenderingServer.GLOBAL_VAR_TYPE_VEC4, Vector4(GameData.HALF, 0, 0, 0))
	# the depth fog the LOW shaders draw themselves (lighting.gd keeps them in step with the scene's)
	RenderingServer.global_shader_parameter_add("g_fog", RenderingServer.GLOBAL_VAR_TYPE_VEC4, Vector4.ZERO)
	RenderingServer.global_shader_parameter_add("g_fog_range", RenderingServer.GLOBAL_VAR_TYPE_VEC4, Vector4(1e5, 2e5, 0, 0))

var main: Node
var amount := 0.0
var _dust_amt := 0.0
var _key := Vector2i(1 << 30, 0)
var _grid_sig := ""
var _vp: SubViewport
var _mask_mat: ShaderMaterial
var _grid_tex: ImageTexture
var _rect: ColorRect
var _mat: ShaderMaterial
var _blur_vp: SubViewport
var _blur_mat: ShaderMaterial
var _full_mat: ShaderMaterial
var _dust_mat: ShaderMaterial
var _world := false   # the LOW world shaders shade the hidden pixels (no screen pass for the sight)
var _off := DebugArgs.has("nosight")   # screenshots without the dimming

func _init(main_: Node = null) -> void:
	main = main_
	layer = -1            # over the 3D world, under every HUD / menu layer
	visible = false

func _ready() -> void:
	_vp = SubViewport.new()
	_vp.size = Vector2i(SIZE, SIZE)
	_vp.disable_3d = true
	_vp.transparent_bg = false
	_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	# the blurred copy (Low on phones / tablets); the mask viewport inside it draws first
	_blur_vp = SubViewport.new()
	_blur_vp.size = Vector2i(SIZE, SIZE)
	_blur_vp.disable_3d = true
	_blur_vp.transparent_bg = false
	_blur_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(_blur_vp)
	_blur_vp.add_child(_vp)
	var blur := ColorRect.new()
	blur.size = Vector2(SIZE, SIZE)
	_blur_mat = ShaderMaterial.new()
	var bsh := Shader.new()
	bsh.code = BLUR_SHADER
	_blur_mat.shader = bsh
	_blur_mat.set_shader_parameter("mask", _vp.get_texture())
	blur.material = _blur_mat
	_blur_vp.add_child(blur)
	var mask := ColorRect.new()
	mask.size = Vector2(SIZE, SIZE)
	_mask_mat = ShaderMaterial.new()
	var msh := Shader.new()
	msh.code = MASK_SHADER
	_mask_mat.shader = msh
	_mask_mat.set_shader_parameter("n", float(GameData.N))
	_mask_mat.set_shader_parameter("into", INTO_WALL / GameData.TILE)
	mask.material = _mask_mat
	_vp.add_child(mask)
	_rect = ColorRect.new()
	_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_full_mat = _pass_mat(SHADER, _vp)
	_mat = _full_mat
	_rect.material = _mat
	add_child(_rect)

func _pass_mat(code: String, mask_vp: SubViewport) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = code
	m.shader = sh
	m.set_shader_parameter("vis_tex", mask_vp.get_texture())
	m.set_shader_parameter("half_size", GameData.HALF)
	return m

func _process(delta: float) -> void:
	var arena: Arena = main.get("arena") if main else null
	var me: Fighter = main.get("me") if main else null
	var cam: Camera3D = main.get("cam") if main else null
	if arena != null and not is_instance_valid(arena):
		arena = null
	var hud: Node = main.get("hud_ui") if main else null
	var vision := float(hud.get("vision")) if hud and hud.get("vision") != null else 0.0
	# game.js sightViewer: you while alive; on fog maps whoever the camera follows (here: still you)
	var viewer: Fighter = null
	var duo: Duo = main.get("duo") if main else null
	var mate_eye: Fighter = duo.sight_viewer() if duo and arena else null   # Duo: your partner's eyes once you are out
	if mate_eye:
		viewer = mate_eye
	elif me and is_instance_valid(me) and arena and (me.alive or vision > 0.0):
		viewer = me
	var want := 1.0 if viewer and not _off else 0.0
	amount += (want - amount) * (1.0 - exp(-4.0 * delta))
	if arena == null:
		amount = 0.0   # back to the menu: no stale mask over the showcase map
	var compat := Lighting.compat_grade()   # web: this pass is also the colour grade, menus included
	var sandstorm := arena != null and String(arena.map.get("weather", "")) == "sandstorm"
	# Low on phones / tablets: the world shaders grey the hidden pixels; the sandstorm's dust, which
	# must also cover what they do not draw (items, fauna, effects), is a blended quad (DUST_SHADER).
	# Compatibility in the sandstorm: the full pass, as it grades every pixel anyway.
	var world := Quality.shaders_low and amount > 0.005 and cam != null and not (compat and sandstorm)
	if world != _world:
		_world = world
		_key = Vector2i(1 << 30, 0)   # redraw the mask and its blurred copy
		if world:
			ensure_globals()
			RenderingServer.global_shader_parameter_set("g_sight_tex", _blur_vp.get_texture())
		else:
			RenderingServer.global_shader_parameter_set("g_sight", Vector4.ZERO)
	var want_mat := _full_mat
	if world and not compat:
		if _dust_mat == null:
			_dust_mat = _pass_mat(DUST_SHADER, _blur_vp)
		want_mat = _dust_mat
	if want_mat != _mat:
		_mat = want_mat
		_rect.material = _mat
	var d := 1.0 if sandstorm else 0.0
	_dust_amt += (d * 0.92 - _dust_amt) * (1.0 - exp(-2.0 * delta))
	visible = compat or (amount > 0.005 and cam != null and (not world or _dust_amt > 0.005))
	if not visible and not world:
		return
	if compat:
		_mat.set_shader_parameter("graded", 2.0)
		_mat.set_shader_parameter("lut_scale", 1.0)
	if amount <= 0.005 or cam == null or (world and compat):
		_mat.set_shader_parameter("amount", 0.0)
		if not world:
			return
	else:
		_mat.set_shader_parameter("amount", amount)
	var env := cam.get_world_3d().environment if cam.get_world_3d() else null
	if not compat:
		_mat.set_shader_parameter("graded", 1.0 if graded(env) else 0.0)
	var b := cam.global_transform.basis
	_mat.set_shader_parameter("cam_pos", cam.global_position)
	_mat.set_shader_parameter("cam_right", b.x)
	_mat.set_shader_parameter("cam_up", b.y)
	_mat.set_shader_parameter("cam_back", b.z)
	var vs := get_viewport().get_visible_rect().size
	var tv := tan(deg_to_rad(cam.fov) * 0.5)
	_mat.set_shader_parameter("tan_half", Vector2(tv * vs.x / maxf(vs.y, 1.0), tv))
	_mat.set_shader_parameter("dust_amt", _dust_amt)
	if sandstorm:
		if env:   # the scene fog colour, scaled like the scene by the exposure (the pass shades after it)
			var c := env.fog_light_color.srgb_to_linear() * exposure(env)
			_mat.set_shader_parameter("dust", Vector3(c.r, c.g, c.b))
			if _mat == _dust_mat:   # as the screen shows it (the quad blends over the finished frame)
				var dd := to_display(env.fog_light_color.srgb_to_linear() * 0.95, env)
				_mat.set_shader_parameter("dust_col", Vector3(dd.r, dd.g, dd.b))
	var clear := _sight_range(arena, vision, hud)
	var outside := 1.0 if arena and arena.map.get("sky", false) else 0.0
	_mat.set_shader_parameter("clear_r", clear)
	_mat.set_shader_parameter("outside", outside)
	if viewer:
		var at := Vector2(viewer.position.x, viewer.position.z)
		for arg in DebugArgs.list():   # screenshots side by side with the web: --sightat=x,z
			if arg.begins_with("--sightat="):
				var v := arg.substr(10).split(",")
				at = Vector2(float(v[0]), float(v[1]))
		_mat.set_shader_parameter("center", at)
		_trace(arena, at.x, at.y)
		if world:   # the LOW world shaders' copy of the same
			RenderingServer.global_shader_parameter_set("g_sight", Vector4(amount, clear, at.x, at.y))
			RenderingServer.global_shader_parameter_set("g_sight_b", Vector4(GameData.HALF, outside, 0.0, 0.0))
	elif world:
		RenderingServer.global_shader_parameter_set("g_sight", Vector4.ZERO)

# The frame gets the web's grade: lighting.gd's LUT (Mobile / Forward+), or this pass (Compatibility).
static func graded(env: Environment) -> bool:
	return (env != null and env.adjustment_enabled and env.adjustment_color_correction != null) or Lighting.compat_grade()

# The exposure the web applies in its output pass (Godot applies it first; with the LUT, half of it
# is LUT_SCALE, which the LUT undoes).
static func exposure(env: Environment) -> float:
	if env == null:
		return 1.0
	return env.tonemap_exposure / (Lighting.LUT_SCALE if graded(env) and not Lighting.compat_grade() else 1.0)

# A scene-linear colour (three.js Color) as the screen shows it: exposure, then with the LUT the
# web's cartoon grade + Neutral tone mapping, sRGB encoded. For 2D overlays that stand in for web
# passes running in linear HDR (hud.gd vision fog).
static func to_display(c: Color, env: Environment) -> Color:
	var v := Vector3(c.r, c.g, c.b) * exposure(env)
	if graded(env):
		var l := v.dot(Vector3(0.2126, 0.7152, 0.0722))
		v = Vector3(l, l, l).lerp(v, 1.18)
		v = (v - Vector3.ONE * 0.18) * 1.06 + Vector3.ONE * 0.18
		v = Lighting._neutral(v.max(Vector3.ZERO))
	v = v.clamp(Vector3.ZERO, Vector3.ONE)
	return Color(v.x, v.y, v.z).linear_to_srgb()

# game.js: how far anyone sees (fog maps use their fog wall instead); the sandstorm cuts it shorter,
# Night Hunt brings it to 9 m.
func _sight_range(arena: Arena, vision: float, hud: Node) -> float:
	if arena == null or vision > 0.0:
		return 0.0
	if hud and hud.get("night_hunt") == true:
		return 9.0
	return 11.0 if String(arena.map.get("weather", "")) == "sandstorm" else 14.0

func _trace(A: Arena, x: float, z: float) -> void:
	var sig := "%d:%d" % [A.get_instance_id(), A.rev]
	if sig != _grid_sig:   # new map, or a tile opened up (arena.js rev)
		_grid_sig = sig
		_key = Vector2i(1 << 30, 0)
		# what stops a bullet stops the eye (arena.js blocksSight); outside the grid counts as 'X'
		var data := PackedByteArray()
		data.resize(W * W)
		data.fill(255)
		for j in GameData.N:
			var row := String(A.grid[j])
			for i in GameData.N:
				data[(j + PAD) * W + i + PAD] = 255 if GameData.SHOT_BLOCK.contains(row[i]) else 0
		var img := Image.create_from_data(W, W, false, Image.FORMAT_R8, data)
		if _grid_tex and _grid_tex.get_size() == Vector2(W, W):
			_grid_tex.update(img)
		else:
			_grid_tex = ImageTexture.create_from_image(img)
			_mask_mat.set_shader_parameter("blocked", _grid_tex)
	var key := Vector2i(roundi(x * 5.0), roundi(z * 5.0))   # 0.2 m steps, about one mask texel
	if key == _key:
		return  # nothing moved, nothing broke: the mask still holds
	_key = key
	_mask_mat.set_shader_parameter("eye", Vector2(x / GameData.TILE + GameData.N / 2.0, z / GameData.TILE + GameData.N / 2.0))
	_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	if _world:
		_blur_mat.set_shader_parameter("outside", 1.0 if A.map.get("sky", false) else 0.0)
		_blur_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
