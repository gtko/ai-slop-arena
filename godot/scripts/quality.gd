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

static var level: String = _initial()
static var saver := false
static var custom: Dictionary = {}

static func _initial() -> String:
	for a in DebugArgs.list():
		if a.begins_with("--quality=") and LEVELS.has(a.substr(10)):
			return a.substr(10)
	var cfg := ConfigFile.new()
	if cfg.load(CFG) == OK and LEVELS.has(String(cfg.get_value("quality", "level", ""))):
		return String(cfg.get_value("quality", "level"))
	return device_level()

# What "auto" picks: phones and tablets Low, desktops High.
static func device_level() -> String:
	var mobile := OS.has_feature("mobile") or OS.has_feature("web_android") or OS.has_feature("web_ios") or DisplayServer.is_touchscreen_available()
	return "low" if mobile else "high"

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
		DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))
		apply()
		return
	if not LEVELS.has(l):
		return
	level = l
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
	vp.scaling_3d_scale = float(p.scale)
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
	return "saver" if saver else level
