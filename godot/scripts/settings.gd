class_name Settings
extends RefCounted
# Persisted user settings (user://settings.cfg): nickname, brawler, loadout, language, graphics
# preset, battery saver, volumes, server, looks. Static so any script reads them; call save() after
# changing values and Settings.apply_audio() for the volumes.

const PATH := "user://settings.cfg"
const GFX := ["auto", "low", "medium", "high"]

static var nickname := ""
static var brawler := "blaster"
static var loadouts: Dictionary = {}     # brawler key -> "A1".."B2" (gadget + star power)
static var lang := ""                    # "" = automatic (OS locale)
static var gfx := "auto"
static var saver := false
static var vol_master := 1.0
static var vol_music := 0.8
static var vol_sfx := 1.0
static var server := ""                  # "" = the official server
static var mode := "solo"                # "solo" (Showdown) | "duo", for quick play and new rooms
static var map := "random"
static var chaos := false
static var icon := 0                     # profile icon (cosmetics.js ICONS index, 0-4 are free)
static var _loaded := false

static func load_all() -> void:
	if _loaded:
		return
	_loaded = true
	var cf := ConfigFile.new()
	if cf.load(PATH) != OK:
		return
	nickname = String(cf.get_value("player", "nickname", nickname))
	brawler = String(cf.get_value("player", "brawler", brawler))
	var lo: Variant = cf.get_value("player", "loadouts", {})
	loadouts = lo if lo is Dictionary else {}
	icon = int(cf.get_value("player", "icon", icon))
	lang = String(cf.get_value("ui", "lang", lang))
	gfx = String(cf.get_value("ui", "gfx", gfx))
	saver = bool(cf.get_value("ui", "saver", saver))
	vol_master = float(cf.get_value("audio", "master", vol_master))
	vol_music = float(cf.get_value("audio", "music", vol_music))
	vol_sfx = float(cf.get_value("audio", "sfx", vol_sfx))
	server = String(cf.get_value("net", "server", server))
	mode = String(cf.get_value("net", "mode", mode))
	map = String(cf.get_value("net", "map", map))
	chaos = bool(cf.get_value("net", "chaos", chaos))

static func save() -> void:
	var cf := ConfigFile.new()
	cf.set_value("player", "nickname", nickname)
	cf.set_value("player", "brawler", brawler)
	cf.set_value("player", "loadouts", loadouts)
	cf.set_value("player", "icon", icon)
	cf.set_value("ui", "lang", lang)
	cf.set_value("ui", "gfx", gfx)
	cf.set_value("ui", "saver", saver)
	cf.set_value("audio", "master", vol_master)
	cf.set_value("audio", "music", vol_music)
	cf.set_value("audio", "sfx", vol_sfx)
	cf.set_value("net", "server", server)
	cf.set_value("net", "mode", mode)
	cf.set_value("net", "map", map)
	cf.set_value("net", "chaos", chaos)
	cf.save(PATH)

static func loadout_of(key: String) -> String:
	var lo := String(loadouts.get(key, "A1"))
	return lo if lo.length() == 2 and "AB".contains(lo[0]) and "12".contains(lo[1]) else "A1"

static func set_loadout(key: String, lo: String) -> void:
	loadouts[key] = lo

# The nickname to send (14 characters at most, like the server keeps).
static func display_name() -> String:
	var n := nickname.strip_edges().left(14)
	return n if n != "" else I18n.t("lobby.namePlaceholder")

# cosmetics.js network string 'skin.trail.ko.frame.title.icon'; only free items are selectable.
static func cos_string() -> String:
	return "0.0.0.0.1.%d" % clampi(icon, 0, 4)

static func server_url() -> String:
	var s := server.strip_edges().trim_suffix("/")
	if s == "":
		return NetClient.WEB_ORIGIN
	if s.begins_with("http"):
		s = "ws" + s.substr(4)
	return s if s.begins_with("ws") else "wss://" + s

static func volume(which: String) -> float:
	return vol_music if which == "music" else vol_sfx if which == "sfx" else vol_master

static func set_volume(which: String, v: float) -> void:
	match which:
		"music": vol_music = v
		"sfx": vol_sfx = v
		_: vol_master = v
	apply_audio()

# Volumes on the audio buses (Master always; "Music" / "SFX" when the audio setup has such buses).
static func apply_audio() -> void:
	_set_bus("Master", vol_master)
	_set_bus("Music", vol_music)
	_set_bus("SFX", vol_sfx)

static func _set_bus(bus: String, v: float) -> void:
	var i := AudioServer.get_bus_index(bus)
	if i < 0:
		return
	AudioServer.set_bus_volume_db(i, linear_to_db(maxf(v, 0.0001)))
	AudioServer.set_bus_mute(i, v <= 0.001)

# Render settings of a graphics preset: {scale, msaa, shadows, fps}. "auto" picks by device class.
static func gfx_profile() -> Dictionary:
	var g := gfx
	if g == "auto":
		g = "medium" if (DisplayServer.is_touchscreen_available() or OS.get_name() == "Web") else "high"
	var p := {"low": {"scale": 0.7, "msaa": Viewport.MSAA_DISABLED, "shadows": false},
		"medium": {"scale": 0.85, "msaa": Viewport.MSAA_2X, "shadows": true},
		"high": {"scale": 1.0, "msaa": Viewport.MSAA_4X, "shadows": true}}[g] as Dictionary
	var prof := p.duplicate()
	prof["fps"] = 60
	if saver:
		prof = {"scale": 0.7, "msaa": Viewport.MSAA_DISABLED, "shadows": false, "fps": 30}
	return prof
