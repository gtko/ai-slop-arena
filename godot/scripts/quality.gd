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
# Phones and tablets start on Low or Medium by their GPU (like autoquality.js does for mobile GPUs);
# desktops on High. `--quality=low|medium|high|ultra` on the command line overrides (tests), and
# `--device=mobile` makes a desktop build behave like a phone / tablet (frame budget, mobile tiers,
# automatic quality) to measure that path on a desktop.
#
# Phones and tablets (Android / iOS builds, and the web export on them): the WHOLE frame (3D, the
# full-screen passes, menus and HUD) is drawn at a pixel budget per tier ("frame", in megapixels) and
# upscaled once to the screen (Window content scale mode "viewport"). A 2880x1800 tablet otherwise
# draws 5.2 M pixels in every full-screen pass (tonemap / grade, line of sight, the 2D layers, the
# final blit) whatever the 3D render scale says: at Low it now draws 1.3 M (1440x900), the 3D at
# that size ("mscale" 1.0: no separate 3D upscale pass). The layout does not change: the UI is sized
# from the viewport's height (UiKit.css_scale). Desktops keep drawing at the window's resolution.
#
# Automatic quality ("auto", web_perf.gd): the frame-rate keeper steps through AUTO_STEPS when the
# frame rate stays low (web, and phones / tablets natively), the last step capping at a steady 30 fps.
# On Android it can also try the other renderer (Vulkan "mobile" / OpenGL ES "gl_compatibility") for
# the next launch when even the last step is too slow, and keeps whichever ran faster (renderer_probe).
#
# Web export (Compatibility renderer in a browser), desktops:
#   - "auto" starts from the GPU the browser reports (autoquality.js detectGpu: integrated GPUs on
#     Medium, discrete ones on High, phones on Low / Medium) and web_perf.gd steps it down when the
#     frame rate stays under 45, back up (to a ceiling) when it holds 57+: AUTO_STEPS, saved as
#     quality/auto_* so the next visit starts where this one ended;
#   - the 3D render resolution follows the page's CSS pixels times at most 1.5, like the three.js
#     client's pixel-ratio cap: the canvas itself is CSS px x devicePixelRatio, so a 2x laptop screen
#     rendered 4x the pixels of a 1x one (text and menus keep the full resolution).

const LEVELS := ["low", "medium", "high", "ultra"]
# scale: 3D render scale (desktop); mscale: the same on phones / tablets, of the frame budget below
# frame: phones / tablets, megapixels the whole frame is drawn at (0 = the screen's resolution)
# outline: the fighters' inverted-hull outline (a second skinned copy of every fighter mesh): 0 none, 1 yours only, 2 all
# anim: the other fighters' animation trees advance every `anim` frames (yours every frame)
# alights: the arena's lantern / crate lights on at once (arena.gd _glow)
const PRESETS := {
	"low": {"scale": 0.7, "mscale": 1.0, "frame": 1.3, "msaa": 0, "shadow": 0, "atlas": 1024, "weather": 0.25, "ring": 0.35, "fauna": 0.4, "glow": false, "water": 0, "lights": 0, "outline": 1, "anim": 2, "alights": 2},
	"medium": {"scale": 0.85, "mscale": 0.85, "frame": 2.3, "msaa": 0, "shadow": 1024, "atlas": 1024, "weather": 0.5, "ring": 0.6, "fauna": 0.7, "glow": false, "water": 1, "lights": 2, "outline": 2, "anim": 1, "alights": 3},
	"high": {"scale": 1.0, "mscale": 1.0, "frame": 3.7, "msaa": 2, "shadow": 2048, "atlas": 2048, "weather": 1.0, "ring": 1.0, "fauna": 1.0, "glow": true, "water": 2, "lights": 4, "outline": 2, "anim": 1, "alights": 4},
	"ultra": {"scale": 1.0, "mscale": 1.0, "frame": 0.0, "msaa": 4, "shadow": 4096, "atlas": 4096, "weather": 1.0, "ring": 1.0, "fauna": 1.0, "glow": true, "water": 2, "lights": 4, "outline": 2, "anim": 1, "alights": 4},
}
# The values the options can tune one by one (anything else follows the tier).
const TUNABLE := ["scale", "msaa", "shadow", "glow", "weather", "lights"]
const CFG := "user://world.cfg"
# Android: the renderer picked for the next launch (application/config/project_settings_override)
const RENDER_OVERRIDE := "user://renderer.cfg"

# "auto", best first: [tier, extra render scale, frame cap]
const AUTO_STEPS := [["ultra", 1.0, 60], ["high", 1.0, 60], ["medium", 1.0, 60], ["low", 1.0, 60], ["low", 0.8, 60], ["low", 0.65, 60], ["low", 0.65, 30]]

static var auto_scale := 1.0     # the last auto steps lower the resolution below Low
static var auto_fps := 60        # and the very last one caps the frame rate at a steady 30
static var auto_max := "high"    # the auto ceiling (the GPU's tier)
static var level: String = _initial()
static var saver := false
static var custom: Dictionary = {}
static var _dpr := -1.0
# What the per-frame code reads (fighter.gd): refreshed by apply(); `rev` changes on every apply.
static var outlines := true
static var outline_level := 2   # 0 none, 1 your own brawler only, 2 everybody (preset "outline")
static var anim_every := 1
static var rev := 0
static var _resize_hooked := false

static func _initial() -> String:
	for a in DebugArgs.list():
		if a.begins_with("--quality=") and LEVELS.has(a.substr(10)):
			return a.substr(10)
	var cfg := ConfigFile.new()
	var loaded := cfg.load(CFG) == OK
	if loaded and LEVELS.has(String(cfg.get_value("quality", "level", ""))):
		return String(cfg.get_value("quality", "level"))
	var dl := device_level()
	if loaded and auto_keeper() and LEVELS.has(String(cfg.get_value("quality", "auto_level", ""))):
		auto_scale = clampf(float(cfg.get_value("quality", "auto_scale", 1.0)), 0.5, 1.0)
		auto_fps = 30 if int(cfg.get_value("quality", "auto_fps", 60)) == 30 else 60
		return String(cfg.get_value("quality", "auto_level"))
	return dl

# A phone or a tablet: Android / iOS builds, the web export in their browsers, `--device=mobile`.
static func mobile() -> bool:
	return OS.has_feature("mobile") or OS.has_feature("web_android") or OS.has_feature("web_ios") or DebugArgs.has("device=mobile")

# Where the automatic quality runs (web_perf.gd): the web export, phones and tablets.
static func auto_keeper() -> bool:
	return OS.has_feature("web") or mobile()

# What "auto" picks: phones and tablets Low / Medium by their GPU, desktops High; on the web, by the
# GPU the browser reports (web_tier).
static func device_level() -> String:
	var touch := mobile() or DisplayServer.is_touchscreen_available()
	if OS.has_feature("web"):
		var t := web_tier(touch)
		auto_max = t[1]
		return t[0]
	if mobile():
		var t := gpu_tier(RenderingServer.get_video_adapter_name(), true)
		auto_max = t[1]
		return t[0]
	return "low" if touch else "high"

# autoquality.js detectGpu on the browser's WebGL renderer string: [start tier, ceiling].
static func web_tier(touch: bool) -> Array:
	var gpu := ""
	var r = JavaScriptBridge.eval("""(() => { try { const g = document.createElement('canvas').getContext('webgl2');
		const e = g && g.getExtension('WEBGL_debug_renderer_info'); const s = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '';
		const l = g && g.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); return String(s); } catch (x) { return ''; } })()""", true)
	if typeof(r) == TYPE_STRING:
		gpu = String(r)
	return gpu_tier(gpu, touch)

static func gpu_tier(name: String, touch: bool) -> Array:
	var gpu := name.to_lower()
	var re := RegEx.new()
	var has := func(pat: String) -> bool:
		re.compile(pat)
		return re.search(gpu) != null
	if has.call("swiftshader|llvmpipe|software|basic render"):
		return ["low", "low"]
	if touch or has.call("adreno|mali|powervr|tegra|videocore|xclipse") or (has.call("apple gpu") and touch):
		var flagship: bool = has.call(r"adreno( \(tm\))? (7[4-9]\d|8\d\d)|apple gpu|apple a1[5-9]|apple m\d|immortalis|mali-g7[1-9]\d|mali-g[89]\d\d|xclipse 9")
		return ["medium", "high"] if flagship else ["low", "medium"]
	if has.call(r"rtx|rx [5-9]\d{3}|radeon pro w|apple m[2-9]|arc a7|apple gpu"):
		return ["high", "high"]
	if has.call("gtx|radeon|rx |apple m1|arc|quadro|nvidia"):
		return ["high", "high"]
	if has.call(r"intel|iris|uhd|hd graphics|vega \d\b|radeon\(tm\) graphics"):
		return ["medium", "high"]
	return ["high", "high"] if OS.get_processor_count() >= 8 else ["medium", "high"]

# The frame budget is on: a phone / tablet whose screen has more pixels than its tier's budget.
static func frame_budget() -> float:
	if not mobile() or DisplayServer.get_name() == "headless":
		return 0.0
	# phone browsers (one thread, WebGL through ANGLE) get half the native budget: v0.18.0 drew their 3D
	# at about 0.25-0.4 MP through the pixel-ratio cap, the full native budget would be 4-5x that
	return float(preset().get("frame", 0.0)) * 1e6 * (0.5 if OS.has_feature("web") else 1.0)

# The render scale of the 3D view: the tier's, the auto step's, and on the web the pixel-ratio cap.
static func render_scale() -> float:
	var p := preset()
	if mobile():   # of the frame budget's viewport (custom "scale" values are taken as they are)
		var m := float(p.scale) if custom.has("scale") and not saver else float(p.get("mscale", p.scale))
		if custom.is_empty() and not saver:
			m *= auto_scale
		return clampf(m, 0.25, 2.0)
	var s := float(p.scale)
	if OS.has_feature("web"):
		var full := s
		s *= web_pixel_factor()
		if custom.is_empty() and not saver:
			s *= auto_scale
		# never under 0.75 3D pixel per CSS pixel: the upscale is blocky below that (three.js's
		# lowest was 0.5 x 1.25 = 0.63, but it upscaled smoothly)
		s = maxf(s, minf(full, 0.75 / maxf(_dpr, 1.0)))
	return clampf(s, 0.25, 2.0)

static func web_pixel_factor() -> float:
	if _dpr < 0.0:
		_dpr = 1.0
		var r = JavaScriptBridge.eval("window.devicePixelRatio || 1", true)
		if typeof(r) == TYPE_FLOAT or typeof(r) == TYPE_INT:
			_dpr = maxf(1.0, float(r))
	var touch := OS.has_feature("web_android") or OS.has_feature("web_ios") or DisplayServer.is_touchscreen_available()
	return minf(1.0, (1.25 if touch else 1.5) / _dpr)

# Phones / tablets: draw the whole frame at the tier's pixel budget (see the top of the file), or at
# the screen's resolution when it has fewer pixels (or on desktops).
static func apply_frame_budget(m: Node) -> void:
	var w := m.get_window()
	if w == null:
		return
	var budget := frame_budget()
	var win := DisplayServer.window_get_size()
	var px := float(win.x) * float(win.y)
	if budget > 0.0 and px > budget * 1.1:
		var k := sqrt(budget / px)
		w.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
		w.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND
		w.content_scale_size = Vector2i(maxi(roundi(win.x * k), 320), maxi(roundi(win.y * k), 180))
	elif w.content_scale_mode != Window.CONTENT_SCALE_MODE_CANVAS_ITEMS:
		w.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
		w.content_scale_size = Vector2i(int(ProjectSettings.get_setting("display/window/size/viewport_width", 1280)),
			int(ProjectSettings.get_setting("display/window/size/viewport_height", 720)))
	if not _resize_hooked and budget > 0.0:   # a rotation / split screen: the budget follows the new size
		_resize_hooked = true
		w.size_changed.connect(func(): apply_frame_budget(m))

# The auto step now (index in AUTO_STEPS) and its ceiling.
static func auto_step() -> int:
	for i in AUTO_STEPS.size():
		if AUTO_STEPS[i][0] == level and is_equal_approx(float(AUTO_STEPS[i][1]), auto_scale) and int(AUTO_STEPS[i][2]) == auto_fps:
			return i
	for i in AUTO_STEPS.size():
		if AUTO_STEPS[i][0] == level:
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
	auto_fps = int(AUTO_STEPS[i][2])
	var cfg := ConfigFile.new()
	cfg.load(CFG)
	if not LEVELS.has(String(cfg.get_value("quality", "level", ""))) and not Settings.test_run():
		cfg.set_value("quality", "auto_level", level)
		cfg.set_value("quality", "auto_scale", auto_scale)
		cfg.set_value("quality", "auto_fps", auto_fps)
		cfg.save(CFG)
	Engine.max_fps = Settings.max_fps()
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
		auto_fps = 60
		if not Settings.test_run():
			cfg.load(CFG)
			for k in ["level", "auto_level", "auto_scale", "auto_fps"]:
				if cfg.has_section_key("quality", k):
					cfg.erase_section_key("quality", k)
			cfg.save(CFG)   # (the renderer probe's results stay)
		Engine.max_fps = Settings.max_fps()
		apply()
		return
	if not LEVELS.has(l):
		return
	level = l
	auto_scale = 1.0
	auto_fps = 60
	cfg.load(CFG)
	cfg.set_value("quality", "level", l)
	if not Settings.test_run():
		cfg.save(CFG)
	Engine.max_fps = Settings.max_fps()
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
	var p := preset()
	outline_level = int(p.get("outline", 2))
	outlines = outline_level > 0
	anim_every = maxi(1, int(p.get("anim", 1)))
	rev += 1
	var m := Quality.main_node()
	if m == null:
		return
	apply_frame_budget(m)
	var vp := m.get_viewport()
	vp.scaling_3d_scale = render_scale()
	vp.msaa_3d = {2: Viewport.MSAA_2X, 4: Viewport.MSAA_4X, 8: Viewport.MSAA_8X}.get(int(p.msaa), Viewport.MSAA_DISABLED)
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if Settings.fxaa else Viewport.SCREEN_SPACE_AA_DISABLED
	RenderingServer.directional_shadow_atlas_set_size(int(p.atlas), true)
	var fq: int = {"hard": RenderingServer.SHADOW_QUALITY_HARD, "soft": RenderingServer.SHADOW_QUALITY_SOFT_LOW,
		"softer": RenderingServer.SHADOW_QUALITY_SOFT_HIGH}.get(Settings.shadow_filter, RenderingServer.SHADOW_QUALITY_SOFT_LOW)
	if mobile() and int(p.shadow) <= 1024:   # phones / tablets: the 1024 map unfiltered (one tap, not 12)
		fq = RenderingServer.SHADOW_QUALITY_HARD
	RenderingServer.directional_soft_shadow_filter_set_quality(fq)
	RenderingServer.positional_soft_shadow_filter_set_quality(fq)
	var sun = m.get("sun")
	if sun is DirectionalLight3D:
		(sun as DirectionalLight3D).shadow_blur = clampf(Settings.softness / 3.0, 0.0, 3.0) if fq != RenderingServer.SHADOW_QUALITY_HARD else 0.0
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
	return level + ("@%d%%" % roundi(auto_scale * 100.0) if auto_scale < 1.0 else "") + ("@30fps" if auto_fps == 30 else "")

# ---------------------------------------------------------------- Android renderer probe
# Godot's Mobile renderer (Vulkan) is the default on Android. Some GPUs / drivers (Adreno 6xx among
# them, by many reports) run small-draw-call scenes faster on the Compatibility renderer (OpenGL ES
# 3), which is also what the web export runs: same shaders, same look (lighting.gd / sight.gd grade
# it in their Compatibility path). The renderer is fixed at launch, so the choice goes through
# application/config/project_settings_override (RENDER_OVERRIDE) and takes effect at the next one.
# web_perf.gd calls renderer_probe() when even the last automatic step stays too slow: the fps of
# this renderer is saved, the other one is tried at the next launch, and once both are measured the
# faster one stays (and nothing is tried again). `--renderer=` is not needed: desktops never probe.

static func renderer_now() -> String:
	return "gl" if RenderingServer.get_current_rendering_method() == "gl_compatibility" else "vulkan"

# fps: the frame rate measured at the last automatic step (60 fps cap). Returns true when the other
# renderer will be tried at the next launch.
static func renderer_probe(fps: float) -> bool:
	if OS.get_name() != "Android" or Settings.test_run():
		return false
	var cfg := ConfigFile.new()
	cfg.load(CFG)
	if bool(cfg.get_value("renderer", "decided", false)):
		return false
	var now := renderer_now()
	cfg.set_value("renderer", "fps_" + now, snappedf(fps, 0.1))
	var other := "vulkan" if now == "gl" else "gl"
	var other_fps := float(cfg.get_value("renderer", "fps_" + other, -1.0))
	var pick := other
	if other_fps >= 0.0:   # both measured: keep the faster one (the current one on a tie)
		pick = other if other_fps > fps * 1.08 else now
		cfg.set_value("renderer", "decided", true)
	if pick != now:
		_write_renderer(pick)
	cfg.save(CFG)
	# (the next launch starts on the 30 fps step; after 20 smooth seconds it tries the 60 fps step
	# again, and if that is still too slow this is called again there, with that renderer's fps)
	print("AUTOQ renderer probe: %s %.1f fps, %s %s -> %s next launch" % [now, fps, other, "untested" if other_fps < 0.0 else "%.1f fps" % other_fps, pick])
	return pick != now

# A launch on a renderer this device never confirmed is a trial: the override file is removed at once,
# so a crash or a frozen boot falls back to the default renderer at the next launch by itself. After a
# minute of play without a frozen stretch it is written back and confirmed (renderer_confirm); a
# catastrophic stretch (renderer_failed) gives up on it for good.
static var _trial := false

static func renderer_boot_check() -> void:
	if OS.get_name() != "Android" or Settings.test_run() or not FileAccess.file_exists(RENDER_OVERRIDE):
		return
	var cfg := ConfigFile.new()
	cfg.load(CFG)
	if bool(cfg.get_value("renderer", "ok_" + renderer_now(), false)):
		return
	_trial = true
	DirAccess.remove_absolute(ProjectSettings.globalize_path(RENDER_OVERRIDE))

static func renderer_confirm() -> void:
	if not _trial:
		return
	_trial = false
	var cfg := ConfigFile.new()
	cfg.load(CFG)
	cfg.set_value("renderer", "ok_" + renderer_now(), true)
	cfg.save(CFG)
	_write_renderer(renderer_now())

static func renderer_failed() -> void:
	if not _trial:
		return
	_trial = false
	var cfg := ConfigFile.new()
	cfg.load(CFG)
	cfg.set_value("renderer", "fps_" + renderer_now(), 0.0)
	cfg.set_value("renderer", "decided", true)   # the default renderer stays (its override is already gone)
	cfg.save(CFG)
	print("AUTOQ renderer %s froze: back to the default renderer from the next launch" % renderer_now())

static func renderer_trial() -> bool:
	return _trial

static func _write_renderer(r: String) -> void:
	var method := "gl_compatibility" if r == "gl" else "mobile"
	var f := FileAccess.open(RENDER_OVERRIDE, FileAccess.WRITE)
	if f == null:
		return
	# the .mobile feature override of project.godot wins over the plain key: set both
	f.store_string("[rendering]\n\nrenderer/rendering_method=\"%s\"\nrenderer/rendering_method.mobile=\"%s\"\n" % [method, method])
	f.close()
