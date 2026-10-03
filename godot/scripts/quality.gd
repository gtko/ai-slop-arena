class_name Quality
extends RefCounted
# Graphics quality (low / medium / high / ultra), mirroring the web presets of src/settings.js +
# src/autoquality.js (mobile table): render scale, MSAA, shadows (low = cheap blob shadows, no shadow
# map), bloom, particle density (weather, fauna), the ring of trees around the arena and the pool of
# dynamic lights.
#
# The options screen (settings_view.gd) calls these statics; nothing else is needed:
#   Quality.set_level("low")      # "auto" | "low" | "medium" | "high" | "ultra", saved to user://world.cfg
#   Quality.level                 # current tier ("auto" resolves to the device's tier)
#   Quality.custom = {...}        # hand-tuned values on top of the tier (the web's "custom" preset)
#   Quality.saver = true          # battery saver: forces "low" without forgetting the chosen level
# Phones and tablets start on Low (like autoquality.js does for mobile GPUs); desktops on High.
# `--quality=low|medium|high|ultra` on the command line overrides (tests).
#
# Web export (Compatibility renderer in a browser):
#   - "auto" starts from the GPU the browser reports (autoquality.js detectGpu: integrated GPUs on
#     Medium, discrete ones on High, phones on Low / Medium) and web_perf.gd steps it down when the
#     frame rate stays under 45, back up (to a ceiling) when it holds 57+: AUTO_STEPS, saved as
#     quality/auto_* so the next visit starts where this one ended;
#   - the 3D render resolution follows the page's CSS pixels times at most 1.5 (1.25 on phones),
#     like the three.js client's pixel-ratio cap: the canvas itself is CSS px x devicePixelRatio, so
#     a 2x laptop screen rendered 4x the pixels of a 1x one (text and menus keep the full resolution).

const LEVELS := ["low", "medium", "high", "ultra"]
const PRESETS := {
	"low": {"scale": 0.7, "msaa": 0, "shadow": 0, "atlas": 1024, "weather": 0.25, "ring": 0.35, "fauna": 0.4, "glow": false, "water": 0, "lights": 0},
	"medium": {"scale": 0.85, "msaa": 0, "shadow": 1024, "atlas": 1024, "weather": 0.5, "ring": 0.6, "fauna": 0.7, "glow": false, "water": 1, "lights": 2},
	"high": {"scale": 1.0, "msaa": 2, "shadow": 2048, "atlas": 2048, "weather": 1.0, "ring": 1.0, "fauna": 1.0, "glow": true, "water": 2, "lights": 4},
	"ultra": {"scale": 1.0, "msaa": 4, "shadow": 4096, "atlas": 4096, "weather": 1.0, "ring": 1.0, "fauna": 1.0, "glow": true, "water": 2, "lights": 4},
}
# The values the options can tune one by one (anything else follows the tier).
const TUNABLE := ["scale", "msaa", "shadow", "glow", "weather", "lights"]
const CFG := "user://world.cfg"

# "auto" on the web, best first: [tier, extra render scale]
const AUTO_STEPS := [["ultra", 1.0], ["high", 1.0], ["medium", 1.0], ["low", 1.0], ["low", 0.8], ["low", 0.65]]

static var auto_scale := 1.0     # the last auto steps lower the resolution below Low
static var auto_max := "high"    # the auto ceiling (the GPU's tier)
static var level: String = _initial()
static var saver := false
static var custom: Dictionary = {}
static var _dpr := -1.0

static func _initial() -> String:
	for a in DebugArgs.list():
		if a.begins_with("--quality=") and LEVELS.has(a.substr(10)):
			return a.substr(10)
	var cfg := ConfigFile.new()
	var loaded := cfg.load(CFG) == OK
	if loaded and LEVELS.has(String(cfg.get_value("quality", "level", ""))):
		return String(cfg.get_value("quality", "level"))
	var dl := device_level()
	if loaded and OS.has_feature("web") and LEVELS.has(String(cfg.get_value("quality", "auto_level", ""))):
		auto_scale = clampf(float(cfg.get_value("quality", "auto_scale", 1.0)), 0.5, 1.0)
		return String(cfg.get_value("quality", "auto_level"))
	return dl

# What "auto" picks: phones and tablets Low, desktops High; on the web, by the GPU (web_tier).
static func device_level() -> String:
	var mobile := OS.has_feature("mobile") or OS.has_feature("web_android") or OS.has_feature("web_ios") or DisplayServer.is_touchscreen_available()
	if OS.has_feature("web"):
		var t := web_tier(mobile)
		auto_max = t[1]
		return t[0]
	return "low" if mobile else "high"

# autoquality.js detectGpu on the browser's WebGL renderer string: [start tier, ceiling].
static func web_tier(mobile: bool) -> Array:
	var gpu := ""
	var r = JavaScriptBridge.eval("""(() => { try { const g = document.createElement('canvas').getContext('webgl2');
		const e = g && g.getExtension('WEBGL_debug_renderer_info'); const s = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '';
		const l = g && g.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); return String(s); } catch (x) { return ''; } })()""", true)
	if typeof(r) == TYPE_STRING:
		gpu = String(r).to_lower()
	var re := RegEx.new()
	var has := func(pat: String) -> bool:
		re.compile(pat)
		return re.search(gpu) != null
	if has.call("swiftshader|llvmpipe|software|basic render"):
		return ["low", "low"]
	if mobile or has.call("adreno|mali|powervr|tegra|videocore|xclipse") or (has.call("apple gpu") and mobile):
		var flagship: bool = has.call(r"adreno \(tm\) (7[4-9]\d|8\d\d)|apple gpu|immortalis|mali-g7[1-9]\d|mali-g[89]\d\d|xclipse 9")
		return ["medium", "high"] if flagship else ["low", "medium"]
	if has.call(r"rtx|rx [5-9]\d{3}|radeon pro w|apple m[2-9]|arc a7|apple gpu"):
		return ["high", "high"]
	if has.call("gtx|radeon|rx |apple m1|arc|quadro|nvidia"):
		return ["high", "high"]
	if has.call(r"intel|iris|uhd|hd graphics|vega \d\b|radeon\(tm\) graphics"):
		return ["medium", "high"]
	return ["high", "high"] if OS.get_processor_count() >= 8 else ["medium", "high"]

# The render scale of the 3D view: the tier's, the auto step's, and on the web the pixel-ratio cap.
static func render_scale() -> float:
	var s := float(preset().scale)
	if OS.has_feature("web"):
		s *= web_pixel_factor()
		if custom.is_empty() and not saver:
			s *= auto_scale
	return clampf(s, 0.25, 2.0)

static func web_pixel_factor() -> float:
	if _dpr < 0.0:
		_dpr = 1.0
		var r = JavaScriptBridge.eval("window.devicePixelRatio || 1", true)
		if typeof(r) == TYPE_FLOAT or typeof(r) == TYPE_INT:
			_dpr = maxf(1.0, float(r))
	var mobile := OS.has_feature("web_android") or OS.has_feature("web_ios") or DisplayServer.is_touchscreen_available()
	return minf(1.0, (1.25 if mobile else 1.5) / _dpr)

# The auto step now (index in AUTO_STEPS) and its ceiling.
static func auto_step() -> int:
	for i in AUTO_STEPS.size():
		if AUTO_STEPS[i][0] == level and is_equal_approx(float(AUTO_STEPS[i][1]), auto_scale):
			return i
	return 1

static func auto_max_step() -> int:
	for i in AUTO_STEPS.size():
		if AUTO_STEPS[i][0] == auto_max:
			return i
	return 1

# web_perf.gd's frame-rate keeper moves "auto" one step; saved apart from a level picked by hand.
static func set_auto_step(i: int) -> void:
	i = clampi(i, 0, AUTO_STEPS.size() - 1)
	level = String(AUTO_STEPS[i][0])
	auto_scale = float(AUTO_STEPS[i][1])
	var cfg := ConfigFile.new()
	cfg.load(CFG)
	if not LEVELS.has(String(cfg.get_value("quality", "level", ""))):
		cfg.set_value("quality", "auto_level", level)
		cfg.set_value("quality", "auto_scale", auto_scale)
		cfg.save(CFG)
	apply()

# The effective preset (battery saver = low; hand-tuned values on top of the tier).
static func preset() -> Dictionary:
	if saver:
		return PRESETS["low"]
	var p: Dictionary = PRESETS.get(level, PRESETS["high"])
	if custom.is_empty():
		return p
	var q := p.duplicate()
	for k in custom:
		if TUNABLE.has(k):
			q[k] = custom[k]
	if q.has("shadow"):
		q["atlas"] = maxi(1024, int(q.shadow))
	return q

# The tier's name for code that sizes things by tier (fx.gd's light pool): ultra counts as high.
static func name_now() -> String:
	if saver:
		return "low"
	return "high" if level == "ultra" else level

static func set_level(l: String) -> void:
	var cfg := ConfigFile.new()
	if l == "auto":
		level = device_level()
		auto_scale = 1.0
		DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))
		apply()
		return
	if not LEVELS.has(l):
		return
	level = l
	auto_scale = 1.0
	cfg.set_value("quality", "level", l)
	cfg.save(CFG)
	apply()

static func set_saver(on: bool) -> void:
	saver = on
	apply()

# The running game (main.gd), whatever the scene tree looks like.
static func main_node() -> Node:
	var tree := Engine.get_main_loop() as SceneTree
	return tree.current_scene if tree else null

# Push the preset to the viewport and to the world (arena: lighting, weather, fauna, trees), plus the
# options that are not part of a tier (FXAA, shadow filter and softness).
static func apply() -> void:
	var m := Quality.main_node()
	if m == null:
		return
	var p := preset()
	var vp := m.get_viewport()
	vp.scaling_3d_scale = render_scale()
	vp.msaa_3d = {2: Viewport.MSAA_2X, 4: Viewport.MSAA_4X, 8: Viewport.MSAA_8X}.get(int(p.msaa), Viewport.MSAA_DISABLED)
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if Settings.fxaa else Viewport.SCREEN_SPACE_AA_DISABLED
	RenderingServer.directional_shadow_atlas_set_size(int(p.atlas), true)
	var fq: int = {"hard": RenderingServer.SHADOW_QUALITY_HARD, "soft": RenderingServer.SHADOW_QUALITY_SOFT_LOW,
		"softer": RenderingServer.SHADOW_QUALITY_SOFT_HIGH}.get(Settings.shadow_filter, RenderingServer.SHADOW_QUALITY_SOFT_LOW)
	RenderingServer.directional_soft_shadow_filter_set_quality(fq)
	RenderingServer.positional_soft_shadow_filter_set_quality(fq)
	var sun = m.get("sun")
	if sun is DirectionalLight3D:
		(sun as DirectionalLight3D).shadow_blur = clampf(Settings.softness / 3.0, 0.0, 3.0) if Settings.shadow_filter != "hard" else 0.0
	var arena = m.get("arena")
	var showcase = m.get("showcase")   # the menu's live arena (menu_showcase.gd) is a separate Arena
	if arena == null and showcase != null and is_instance_valid(showcase.get("_arena")):
		arena = showcase.get("_arena")
	if arena != null and arena.has_method("apply_quality"):
		arena.apply_quality()
	elif sun is DirectionalLight3D:
		sun.shadow_enabled = int(p.shadow) > 0

# A short name of what runs now, for the perf probe (perf_probe.gd).
static func step_name() -> String:
	if saver:
		return "saver"
	return level + ("@%d%%" % roundi(auto_scale * 100.0) if auto_scale < 1.0 else "")
