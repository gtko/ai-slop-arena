class_name Quality
extends RefCounted
# Graphics quality (low / medium / high), mirroring the web presets of src/settings.js + src/autoquality.js
# (mobile table): render scale, MSAA, shadows (low = cheap blob shadows, no shadow map), particle
# density (weather, fauna) and the ring of trees around the arena.
#
# The settings menu calls these statics; nothing else is needed:
#   Quality.set_level("low")      # "low" | "medium" | "high", saved to user://world.cfg
#   Quality.level                 # current level
#   Quality.saver = true          # battery saver: forces "low" without forgetting the chosen level
# Phones and tablets start on Low (like autoquality.js does for mobile GPUs); desktops on High.
# `--quality=low|medium|high` on the command line overrides (tests).

const LEVELS := ["low", "medium", "high"]
const PRESETS := {
	"low": {"scale": 0.7, "msaa": 0, "shadow": 0, "atlas": 1024, "weather": 0.25, "ring": 0.35, "fauna": 0.4, "glow": false, "water": 0},
	"medium": {"scale": 0.85, "msaa": 0, "shadow": 1024, "atlas": 1024, "weather": 0.5, "ring": 0.6, "fauna": 0.7, "glow": false, "water": 1},
	"high": {"scale": 1.0, "msaa": 2, "shadow": 2048, "atlas": 2048, "weather": 1.0, "ring": 1.0, "fauna": 1.0, "glow": true, "water": 2},
}
const CFG := "user://world.cfg"

static var level: String = _initial()
static var saver := false

static func _initial() -> String:
	for a in DebugArgs.list():
		if a.begins_with("--quality=") and LEVELS.has(a.substr(10)):
			return a.substr(10)
	var cfg := ConfigFile.new()
	if cfg.load(CFG) == OK and LEVELS.has(String(cfg.get_value("quality", "level", ""))):
		return String(cfg.get_value("quality", "level"))
	var mobile := OS.has_feature("mobile") or OS.has_feature("web_android") or OS.has_feature("web_ios") or DisplayServer.is_touchscreen_available()
	return "low" if mobile else "high"

# The effective preset (battery saver = low).
static func preset() -> Dictionary:
	return PRESETS["low" if saver else level]

static func name_now() -> String:
	return "low" if saver else level

static func set_level(l: String) -> void:
	if not LEVELS.has(l):
		return
	level = l
	var cfg := ConfigFile.new()
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

# Push the preset to the viewport and to the world (arena: lighting, weather, fauna, trees).
static func apply() -> void:
	var m := main_node()
	if m == null:
		return
	var p := preset()
	var vp := m.get_viewport()
	vp.scaling_3d_scale = float(p.scale)
	vp.msaa_3d = Viewport.MSAA_2X if int(p.msaa) == 2 else Viewport.MSAA_DISABLED
	RenderingServer.directional_shadow_atlas_set_size(int(p.atlas), true)
	var arena = m.get("arena")
	if arena != null and arena.has_method("apply_quality"):
		arena.apply_quality()
	else:
		var sun = m.get("sun")
		if sun is DirectionalLight3D:
			sun.shadow_enabled = int(p.shadow) > 0
