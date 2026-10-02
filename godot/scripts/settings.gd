class_name Settings
extends RefCounted
# Persisted user settings (user://settings.cfg), static so any script reads them; call save() after
# changing values. The options screen (settings_view.gd, the web's #options of src/menu.js) edits
# them and calls apply_display() / Quality.apply(); main.gd applies the rest (fps cap, window).
#   player   nickname, brawler, loadouts, profile icon
#   ui       language, graphics preset + custom values, battery saver, display (window, vsync, fps
#            cap, render scale, AA, shadows, bloom, weather, brightness, time of day), interface
#            (FPS counter, camera shake, colour-blind colours)
#   controls key bindings (only those changed from the defaults: controls.gd), gamepad dead zone,
#            vibration, aim assist
#   audio    volumes live in AudioManager (user://audio.cfg); vol_* here are the pre-options values
#   net      server, mode, map, chaos

const PATH := "user://settings.cfg"
const GFX := ["auto", "low", "medium", "high", "ultra"]   # + "custom" once a quality value is tuned by hand
const MOBILE_FPS := 60

static var nickname := ""
static var brawler := "blaster"
static var loadouts: Dictionary = {}     # brawler key -> "A1".."B2" (gadget + star power)
static var lang := ""                    # "" = automatic (OS locale)
static var gfx := "auto"
static var custom: Dictionary = {}       # gfx "custom": the Quality preset values tuned by hand
static var saver := false
static var vol_master := 1.0
static var vol_music := 0.8
static var vol_sfx := 1.0
static var server := ""                  # "" = the official server
static var mode := "solo"                # "solo" (Showdown) | "duo", for quick play and new rooms
static var map := "random"
static var chaos := false
static var icon := 0                     # profile icon (cosmetics.js ICONS index, 0-4 are free)
# display (Godot-only rows of the Graphics tab, plus the web's fullscreen / brightness / time of day)
static var window := "windowed"          # "windowed" | "fullscreen" | "exclusive"
static var vsync := "on"                 # "off" | "on" | "adaptive" | "mailbox"
static var fps_cap := -1                 # -1 = the default (60 on phones, none on desktop), 0 = none
static var fxaa := false
static var shadow_filter := "soft"       # "hard" | "soft" | "softer"
static var softness := 3.0               # settings.js softness (0..8): the sun's shadow blur
static var brightness := 1.0             # settings.js exposure (0.5..1.8)
static var tod := "2"                    # settings.js tod: "0".."3" (morning..night) or "cycle"
# interface
static var show_fps := false
static var shake := true
static var colorblind := false
# controls
static var binds: Dictionary = {}        # action -> physical keycode (only the changed ones)
static var deadzone := 0.18
static var vibration := true
static var aim_assist := true            # gamepad: firing without the right stick aims at the nearest foe
static var _loaded := false
static var _server_saved := ""          # the server on disk (the autotest points `server` at a test one, never saved)
static var _lang_saved := ""
static var server_override := false      # `--server=` gave this run's server: keep the saved one on disk
static var lang_override := false        # `--lang=` (screenshots): idem

# A test run (autotest, key test, screenshots): settings and the profile live in memory only, so a
# test never rewrites the player's binds, time of day, server, coins or XP.
static func test_run() -> bool:
	for a in DebugArgs.list():
		if a == "--autotest" or a == "--keytest" or a.begins_with("--menushot"):
			return true
	return false

static func load_all() -> void:
	if _loaded:
		return
	_loaded = true
	var cf := ConfigFile.new()
	if cf.load(PATH) != OK:
		_push()
		return
	nickname = String(cf.get_value("player", "nickname", nickname))
	brawler = String(cf.get_value("player", "brawler", brawler))
	var lo: Variant = cf.get_value("player", "loadouts", {})
	loadouts = lo if lo is Dictionary else {}
	icon = int(cf.get_value("player", "icon", icon))
	lang = String(cf.get_value("ui", "lang", lang))
	_lang_saved = lang
	gfx = String(cf.get_value("ui", "gfx", gfx))
	if not (GFX.has(gfx) or gfx == "custom"):
		gfx = "auto"
	var cu: Variant = cf.get_value("ui", "custom", {})
	custom = cu if cu is Dictionary else {}
	saver = bool(cf.get_value("ui", "saver", saver))
	window = String(cf.get_value("ui", "window", window))
	vsync = String(cf.get_value("ui", "vsync", vsync))
	fps_cap = int(cf.get_value("ui", "fps_cap", fps_cap))
	fxaa = bool(cf.get_value("ui", "fxaa", fxaa))
	shadow_filter = String(cf.get_value("ui", "shadow_filter", shadow_filter))
	softness = float(cf.get_value("ui", "softness", softness))
	brightness = float(cf.get_value("ui", "brightness", brightness))
	tod = String(cf.get_value("ui", "tod", tod))
	show_fps = bool(cf.get_value("ui", "show_fps", show_fps))
	shake = bool(cf.get_value("ui", "shake", shake))
	colorblind = bool(cf.get_value("ui", "colorblind", colorblind))
	var b: Variant = cf.get_value("controls", "binds", {})
	binds = b if b is Dictionary else {}
	deadzone = float(cf.get_value("controls", "deadzone", deadzone))
	vibration = bool(cf.get_value("controls", "vibration", vibration))
	aim_assist = bool(cf.get_value("controls", "aim_assist", aim_assist))
	vol_master = float(cf.get_value("audio", "master", vol_master))
	vol_music = float(cf.get_value("audio", "music", vol_music))
	vol_sfx = float(cf.get_value("audio", "sfx", vol_sfx))
	server = String(cf.get_value("net", "server", server))
	_server_saved = server
	mode = String(cf.get_value("net", "mode", mode))
	map = String(cf.get_value("net", "map", map))
	chaos = bool(cf.get_value("net", "chaos", chaos))
	_push()

static func save() -> void:
	var cf := ConfigFile.new()
	cf.set_value("player", "nickname", nickname)
	cf.set_value("player", "brawler", brawler)
	cf.set_value("player", "loadouts", loadouts)
	cf.set_value("player", "icon", icon)
	if not lang_override:
		_lang_saved = lang
	cf.set_value("ui", "lang", _lang_saved)
	cf.set_value("ui", "gfx", gfx)
	cf.set_value("ui", "custom", custom)
	cf.set_value("ui", "saver", saver)
	cf.set_value("ui", "window", window)
	cf.set_value("ui", "vsync", vsync)
	cf.set_value("ui", "fps_cap", fps_cap)
	cf.set_value("ui", "fxaa", fxaa)
	cf.set_value("ui", "shadow_filter", shadow_filter)
	cf.set_value("ui", "softness", softness)
	cf.set_value("ui", "brightness", brightness)
	cf.set_value("ui", "tod", tod)
	cf.set_value("ui", "show_fps", show_fps)
	cf.set_value("ui", "shake", shake)
	cf.set_value("ui", "colorblind", colorblind)
	cf.set_value("controls", "binds", binds)
	cf.set_value("controls", "deadzone", deadzone)
	cf.set_value("controls", "vibration", vibration)
	cf.set_value("controls", "aim_assist", aim_assist)
	cf.set_value("audio", "master", vol_master)
	cf.set_value("audio", "music", vol_music)
	cf.set_value("audio", "sfx", vol_sfx)
	if not server_override and not DebugArgs.has("autotest"):
		_server_saved = server
	cf.set_value("net", "server", _server_saved)
	cf.set_value("net", "mode", mode)
	cf.set_value("net", "map", map)
	cf.set_value("net", "chaos", chaos)
	if not test_run():
		cf.save(PATH)
	_push()

# The flags other scripts read as statics (feel.gd, lighting.gd, quality.gd).
static func _push() -> void:
	Feel.shake_on = shake
	Feel.vibration = vibration
	Lighting.cycle = tod == "cycle"
	if tod != "cycle":
		Lighting.tod = clampf(float(tod), 0.0, 3.0)
	Lighting.brightness = brightness
	Quality.custom = custom if gfx == "custom" else {}

static func loadout_of(key: String) -> String:
	var lo := String(loadouts.get(key, "A1"))
	return lo if lo.length() == 2 and "AB".contains(lo[0]) and "12".contains(lo[1]) else "A1"

static func set_loadout(key: String, lo: String) -> void:
	loadouts[key] = lo

# The nickname to send (14 characters at most, like the server keeps).
static func display_name() -> String:
	var n := nickname.strip_edges().left(14)
	return n if n != "" else I18n.t("lobby.namePlaceholder")

# cosmetics.js network string 'skin.trail.ko.frame.title.icon' of the chosen brawler: what you own and
# wear (meta_profile.gd, the web's profile.js cosFor), with the profile icon picked here.
static func cos_string() -> String:
	return MetaProfile.cos_for(brawler, icon)

static func server_url() -> String:
	var s := server.strip_edges().trim_suffix("/")
	if s == "":
		return NetClient.WEB_ORIGIN
	if s.begins_with("http"):
		s = "ws" + s.substr(4)
	return s if s.begins_with("ws") else "wss://" + s

# Volumes: the AudioManager's mix (user://audio.cfg) once it exists, these fields before.
static func volume(which: String) -> float:
	var a := AudioManager.current
	if a and is_instance_valid(a):
		return float(a.get(which if which in ["music", "sfx", "amb"] else "master"))
	return vol_music if which == "music" else vol_sfx if which == "sfx" else vol_master

static func set_volume(which: String, v: float) -> void:
	var a := AudioManager.current
	if a and is_instance_valid(a):
		a.set(which if which in ["music", "sfx", "amb"] else "master", v)
		return
	match which:
		"music": vol_music = v
		"sfx": vol_sfx = v
		_: vol_master = v

# The AudioManager owns the buses (its balance x the user mix); this only re-applies it.
static func apply_audio() -> void:
	var a := AudioManager.current
	if a and is_instance_valid(a) and a.has_method("_apply_mix"):
		a.call("_apply_mix")

static func is_mobile() -> bool:
	return OS.has_feature("mobile") or OS.has_feature("web_android") or OS.has_feature("web_ios") or DisplayServer.is_touchscreen_available()

static func is_desktop_window() -> bool:
	return not OS.has_feature("mobile") and not OS.has_feature("web") and DisplayServer.get_name() != "headless"

# The frame cap: battery saver 30, else the chosen one (phones default to 60, like main.js FRAME_MS).
static func max_fps() -> int:
	if saver:
		return 30
	if fps_cap >= 0:
		return fps_cap
	return MOBILE_FPS if is_mobile() else 0

# Window mode and vsync (desktop builds only; the web / phones own their window).
static func apply_display() -> void:
	if not is_desktop_window():
		return
	var vs := {"off": DisplayServer.VSYNC_DISABLED, "on": DisplayServer.VSYNC_ENABLED,
		"adaptive": DisplayServer.VSYNC_ADAPTIVE, "mailbox": DisplayServer.VSYNC_MAILBOX}
	DisplayServer.window_set_vsync_mode(int(vs.get(vsync, DisplayServer.VSYNC_ENABLED)))
	var want := DisplayServer.WINDOW_MODE_WINDOWED
	if window == "fullscreen":
		want = DisplayServer.WINDOW_MODE_FULLSCREEN
	elif window == "exclusive":
		want = DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN
	var cur := DisplayServer.window_get_mode()
	var cur_full := cur == DisplayServer.WINDOW_MODE_FULLSCREEN or cur == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN
	if cur != want and (cur_full or want != DisplayServer.WINDOW_MODE_WINDOWED):
		DisplayServer.window_set_mode(want)

# Render settings of the graphics preset (kept for older callers): {scale, msaa, shadows, fps}.
static func gfx_profile() -> Dictionary:
	var p := Quality.preset()
	return {"scale": float(p.scale), "msaa": int(p.msaa), "shadows": int(p.shadow) > 0, "fps": max_fps()}
