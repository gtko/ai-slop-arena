class_name SteamPlatform
extends Node
# Steam: achievements + stats, the game language, rich presence and "Join game" from the friends list.
# Talks to Steamworks through the GodotSteam GDExtension (addons/godotsteam, not committed: it ships the
# Steamworks redistributables; `npm run godot:steam` fetches it, see steam/README.md). Everything is
# dynamic (Engine.get_singleton), so the game still parses and runs where the extension is absent (web,
# mobile, Epic, a checkout that did not fetch it) and when Steam is not running: `ready_ok` stays false
# and every call is a no-op.
#
# Online play does not use Steam networking: matches run on the Cloudflare rooms server like on every
# platform. A friend joins you by the room code Steam carries in the `connect` rich presence value.

signal join_room(code: String)

const APP_DATA := "res://data/steam.json"   # {"appId": n}, written by tools/export-data.mjs from package.json steam.appId
const SPACEWAR := 480                       # Valve's public test app: our achievements do not exist there
const STORE_DELAY := 1.5                    # stats go to Steam in one batch this long after the last change
const ROOM_RE := "room=([A-Za-z0-9]{4,6})"

var api: Object = null       # the "Steam" singleton (or a stand-in in tests)
var ready_ok := false
var app_id := SPACEWAR
var _dirty := false
var _store_in := 0.0
var _langs: Dictionary = {}  # Steam language name -> game language code

static func available() -> bool:
	return Engine.has_singleton("Steam") and not OS.has_feature("epic") and not OS.has_feature("web")

# Starts Steamworks. false = not available (no extension, Steam not running, wrong app...).
func start(stand_in: Object = null) -> bool:
	process_mode = Node.PROCESS_MODE_ALWAYS   # callbacks keep coming while the game is paused
	api = stand_in
	if api == null:
		if not available():
			return false
		api = Engine.get_singleton("Steam")
	app_id = _read_app_id()
	# A shipped build started outside Steam relaunches itself through Steam (real app ids only)
	if app_id != SPACEWAR and not OS.has_feature("editor") and api.restartAppIfNecessary(app_id):
		get_tree().quit()
		return false
	var r: Dictionary = api.steamInitEx(app_id)
	ready_ok = int(r.get("status", 1)) == 0
	if not ready_ok:
		push_warning("Steam: not available (%s)" % String(r.get("verbal", "?")))
		api = null
		return false
	_langs = _read_json("res://data/i18n/steam_langs.json")
	api.join_game_requested.connect(_on_join_game_requested)
	Achievements.connect_sink(self)   # re-sends what was earned offline
	return true

func _process(delta: float) -> void:
	if not ready_ok:
		return
	api.run_callbacks()
	if _dirty:
		_store_in -= delta
		if _store_in <= 0.0:
			_store()

func _notification(what: int) -> void:
	if ready_ok and (what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE) and _dirty:
		_store()

# ------------------------------------------------------------ achievements sink (achievements.gd)

func achieve(id: String) -> void:
	if ready_ok and api.setAchievement(id):
		_touch()

func set_stats(stats: Dictionary) -> void:
	if not ready_ok:
		return
	for k in stats:
		api.setStatInt(String(k), int(stats[k]))
	_touch()

func _touch() -> void:
	if not _dirty:
		_store_in = STORE_DELAY
	_dirty = true

func _store() -> void:
	_dirty = false
	api.storeStats()

# ------------------------------------------------------------ language

# The game language picked in Steam (Properties > Language), as one of ours; "" = no answer.
func language_code() -> String:
	if not ready_ok:
		return ""
	return String(_langs.get(String(api.getCurrentGameLanguage()), ""))

# ------------------------------------------------------------ rich presence + invites

# what: "menu" | "queue" | "lobby" | "match" (tokens of steam/rich_presence.vdf). room: a private room's
# code ("" = none): friends then get "Join game", and the group shows in the friends list.
func set_presence(what: String, room: String) -> void:
	if not ready_ok:
		return
	api.setRichPresence("steam_display", "#Status_" + what.capitalize())
	if room != "":
		api.setRichPresence("connect", "-- --room=" + room)   # the game's command line when started by an invite
		api.setRichPresence("steam_player_group", room)
	else:
		api.setRichPresence("connect", "")
		api.setRichPresence("steam_player_group", "")

# The room a friend's invite started the game with (`-- --room=CODE`), "" = none.
static func launch_room() -> String:
	return _room_in(OS.get_cmdline_user_args() + OS.get_cmdline_args())

static func _room_in(args: PackedStringArray) -> String:
	var re := RegEx.create_from_string("^--" + ROOM_RE + "$")
	for a in args:
		var m := re.search(a)
		if m:
			return m.get_string(1).to_upper()
	return ""

func _on_join_game_requested(_friend: int, connect: String) -> void:
	var m := RegEx.create_from_string(ROOM_RE).search(connect)
	if m:
		join_room.emit(m.get_string(1).to_upper())

# ------------------------------------------------------------ data

func _read_app_id() -> int:
	var id := int(_read_json(APP_DATA).get("appId", SPACEWAR))
	var env := OS.get_environment("STEAM_APP_ID")   # a test build against another app
	return int(env) if env.is_valid_int() else (id if id > 0 else SPACEWAR)

static func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return v if v is Dictionary else {}
