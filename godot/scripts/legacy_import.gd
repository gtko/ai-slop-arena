class_name LegacyImport
extends RefCounted
# One-time import of the old three.js web client's saves. That client ran on the same origin as the
# Godot web export (/play, now /godot/<version>/) and kept everything in localStorage; this client keeps
# it in user:// (IndexedDB on web). On web, at the first launch only (FLAG), the old keys are read
# through JavaScriptBridge and merged into the Godot saves, then FLAG is written:
#   iaslop-profile      -> user://profile.json (MetaProfile, same JSON shape): the max of xp / coins / gems
#                          / road and of each brawler's trophies, the union of owned and seen; what you
#                          wear is taken where this client still has the default. A profile from before
#                          v0.13.1 (no "v"), or none but mastery points, keeps the five brawlers of before.
#   iaslop-cid          -> user://cid: the server's rank, reports and bans are keyed by it
#   iaslop-name, iaslop-brawler, iaslop-mode, iaslop-chaos, iaslop-loadout, iaslop-settings-v1 (language,
#                          graphics preset, time of day, brightness, shadow softness, shake, colour-blind,
#                          FPS counter, dead zone, vibration) -> user://settings.cfg (Settings)
#   brawl-arena-audio   -> user://audio.cfg (AudioManager), unless this client already has one
# Every old key is also copied as it is to user://legacy/web_storage.json, for what this client does
# not have yet (iaslop-mastery, iaslop-quests, iaslop-progress = achievements, iaslop-level = hidden
# bot level): their ports read it from there. Key bindings are not imported (KeyboardEvent codes).
# The merge is idempotent (max / union), so a run cut short is simply done again at the next launch.
#
# Call LegacyImport.run() once at startup, after Settings.load_all() and before anything reads the
# profile, the settings or the cid.

const FLAG := "user://legacy_import.json"
const RAW := "user://legacy/web_storage.json"
const AUDIO := "user://audio.cfg"
const CID := "user://cid"
const FIVE := ["blaster", "gunslinger", "bomber", "frostbite", "volt"]

static func run() -> void:
	if not OS.has_feature("web") or Settings.test_run() or FileAccess.file_exists(FLAG):
		return
	var old := _read_storage()
	if not old.is_empty():
		_import(old)
	var f := FileAccess.open(FLAG, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify({"migrated": true, "at": int(Time.get_unix_time_from_system()), "keys": old.keys()}))

# Every key of the old client: {key: raw string}. Empty when there is none (or no localStorage).
static func _read_storage() -> Dictionary:
	var js := "(() => { try { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);" \
		+ " if (k.startsWith('iaslop-') || k === 'brawl-arena-audio') o[k] = localStorage.getItem(k); } return JSON.stringify(o); }" \
		+ " catch (e) { return '{}'; } })()"
	var s = JavaScriptBridge.eval(js, true)
	if typeof(s) != TYPE_STRING:
		return {}
	var d: Variant = JSON.parse_string(String(s))
	return d if d is Dictionary else {}

static func _json(old: Dictionary, key: String) -> Variant:
	return JSON.parse_string(String(old[key])) if old.has(key) else null

static func _import(old: Dictionary) -> void:
	_save_raw(old)
	MetaProfile.load_all()   # this client's own profile first (its veteran rule reads the files as they are)
	_merge_profile(old)
	_adopt_cid(old)
	_merge_settings(old)
	_merge_audio(old)

static func _save_raw(old: Dictionary) -> void:
	DirAccess.make_dir_recursive_absolute(RAW.get_base_dir())
	var f := FileAccess.open(RAW, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(old))

static func _merge_profile(old: Dictionary) -> void:
	var raw: Variant = _json(old, "iaslop-profile")
	var mastery: Variant = _json(old, "iaslop-mastery")
	var veteran := (not (raw as Dictionary).has("v")) if raw is Dictionary else (mastery is Dictionary and not (mastery as Dictionary).is_empty())
	if not (raw is Dictionary) and not veteran:
		return
	var o: Dictionary = raw if raw is Dictionary else {}
	var P := MetaProfile.P
	for k in ["xp", "coins", "gems", "road"]:
		P[k] = maxi(int(P.get(k, 0)), int(o.get(k, 0)) if (o.get(k) is float or o.get(k) is int) else 0)
	for k in ["owned", "seen"]:
		var mine: Array = P.get(k, []) if P.get(k) is Array else []
		if o.get(k) is Array:
			for id in o[k]:
				if id is String and not mine.has(id):
					mine.append(id)
		P[k] = mine
	if veteran:
		for b in FIVE:
			if not (P.owned as Array).has("brawler:" + b):
				(P.owned as Array).append("brawler:" + b)
	var tro: Dictionary = P.get("trophies", {}) if P.get("trophies") is Dictionary else {}
	if o.get("trophies") is Dictionary:
		for b in o.trophies:
			tro[b] = maxi(int(tro.get(b, 0)), int(o.trophies[b]))
	P.trophies = tro
	# what you wear: the old choice wherever this client still has the default
	var blank: Dictionary = MetaProfile._blank().wear
	var wear: Dictionary = P.wear
	if o.get("wear") is Dictionary:
		for k in o.wear:
			if k == "skins" and o.wear.skins is Dictionary:
				for b in o.wear.skins:
					if not (wear.skins as Dictionary).has(b):
						wear.skins[b] = int(o.wear.skins[b])
			elif blank.has(k) and k != "skins" and int(wear.get(k, 0)) == int(blank[k]):
				wear[k] = int(o.wear[k])
	P.v = 2
	MetaProfile.save()

static func _adopt_cid(old: Dictionary) -> void:
	var cid := String(old.get("iaslop-cid", "")).strip_edges()
	if not RegEx.create_from_string("^[\\w-]{8,40}$").search(cid):
		return
	var f := FileAccess.open(CID, FileAccess.WRITE)
	if f:
		f.store_string(cid)

static func _merge_settings(old: Dictionary) -> void:
	var name := String(old.get("iaslop-name", "")).strip_edges()
	if name != "" and Settings.nickname.strip_edges() == "":
		Settings.nickname = name.left(14)
	var b := String(old.get("iaslop-brawler", ""))
	if GameData.brawlers.has(b) and MetaProfile.owns("brawler:" + b):
		Settings.brawler = b
	if old.has("iaslop-mode"):
		Settings.mode = "duo" if old["iaslop-mode"] == "duo" else "solo"
	if old.has("iaslop-chaos"):
		Settings.chaos = old["iaslop-chaos"] == "1"
	var lo: Variant = _json(old, "iaslop-loadout")
	if lo is Dictionary:
		for k in lo:
			if not Settings.loadouts.has(k) and lo[k] is String:
				Settings.loadouts[k] = lo[k]
	var s: Variant = _json(old, "iaslop-settings-v1")
	if s is Dictionary:
		var S := s as Dictionary
		var lang := String(S.get("lang", "auto"))
		if lang != "auto" and Settings.lang == "":
			Settings.lang = lang
		var preset := String(S.get("preset", "auto"))
		if Settings.GFX.has(preset):   # "custom" (hand-tuned three.js values) stays on auto
			Settings.gfx = preset
		if S.has("tod"):
			Settings.tod = String(S.tod)
		if S.get("exposure") is float or S.get("exposure") is int:
			Settings.brightness = clampf(float(S.exposure), 0.5, 1.8)
		if S.get("softness") is float or S.get("softness") is int:
			Settings.softness = clampf(float(S.softness), 0.0, 8.0)
		if S.get("deadzone") is float or S.get("deadzone") is int:
			Settings.deadzone = clampf(float(S.deadzone), 0.0, 0.6)
		if S.get("shake") is bool:
			Settings.shake = S.shake
		if S.get("colorblind") is bool:
			Settings.colorblind = S.colorblind
		if S.get("fps") is bool:
			Settings.show_fps = S.fps
		if S.get("vibration") is bool:
			Settings.vibration = S.vibration
	Settings.save()

static func _merge_audio(old: Dictionary) -> void:
	var a: Variant = _json(old, "brawl-arena-audio")
	if not (a is Dictionary) or FileAccess.file_exists(AUDIO):
		return
	var cf := ConfigFile.new()
	for k in ["master", "sfx", "music", "amb"]:
		if a.get(k) is float or a.get(k) is int:
			cf.set_value("audio", k, clampf(float(a[k]), 0.0, 1.0))
	if a.get("muted") is bool:
		cf.set_value("audio", "muted", a.muted)
	if a.get("track") is String:
		cf.set_value("audio", "track", a.track)
	cf.save(AUDIO)
