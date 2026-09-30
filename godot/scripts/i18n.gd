class_name I18n
extends RefCounted
# Tiny localisation helper. The strings come from the web build (node godot/tools/export-i18n.mjs
# -> data/i18n/<code>.json, 30 languages); English is the fallback of every key.
#   I18n.t("lobby.start")   I18n.t("mm.inQueue", {"n": 3, "need": 8})   I18n.t("result.lost", {"n": 2})
# Plural entries are objects of forms ("one", "other"...): the form comes from vars.n.

const DIR := "res://data/i18n/"

static var lang := "en"
static var _en: Dictionary = {}
static var _dict: Dictionary = {}
static var _langs: Array = []

# Language from the OS locale ("fr_CH" -> fr, "zh_TW" -> zh-TW, "pt_BR" -> pt-BR, "nb" -> no).
static func detect(locale: String = "") -> String:
	var loc := (locale if locale != "" else OS.get_locale()).replace("_", "-").to_lower()
	var parts := loc.split("-")
	var base := parts[0]
	var region := parts[1] if parts.size() > 1 else ""
	var code := base
	if base == "zh":
		code = "zh-TW" if (loc.contains("tw") or loc.contains("hk") or loc.contains("hant")) else "zh-CN"
	elif base == "pt":
		code = "pt-BR" if region == "br" else "pt"
	elif base == "es":
		code = "es" if (region == "" or region == "es") else "es-419"
	elif base == "nb" or base == "nn":
		code = "no"
	return code if FileAccess.file_exists(DIR + code + ".json") else "en"

static func languages() -> Array:
	if _langs.is_empty():
		var v: Variant = _read(DIR + "langs.json")
		_langs = v if v is Array else [{"code": "en", "name": "English"}]
	return _langs

static func use(code: String) -> void:
	if _en.is_empty():
		_en = _read_dict(DIR + "en.json")
	lang = code if FileAccess.file_exists(DIR + code + ".json") else "en"
	_dict = _en if lang == "en" else _read_dict(DIR + lang + ".json")

static func t(key: String, vars: Dictionary = {}) -> String:
	if _en.is_empty():
		use(detect())
	var v: Variant = _dict.get(key, _en.get(key, key))
	if v is Dictionary:
		var d: Dictionary = v
		v = d.get(_plural(int(vars.get("n", 0))), d.get("other", key))
	var s := String(v)
	for k in vars:
		s = s.replace("{%s}" % k, str(vars[k]))
	return s

static func has(key: String) -> bool:
	return _en.has(key)

# Plural category: enough of CLDR for the shipped languages (one/few/many/other, French 0-1 = one).
static func _plural(n: int) -> String:
	match lang:
		"ja", "ko", "zh-CN", "zh-TW", "th", "vi", "id":
			return "other"
		"fr", "pt-BR", "pt":
			return "one" if n <= 1 else "other"
		"ru", "uk":
			if n % 10 == 1 and n % 100 != 11:
				return "one"
			if n % 10 >= 2 and n % 10 <= 4 and not (n % 100 >= 12 and n % 100 <= 14):
				return "few"
			return "many"
		"pl":
			if n == 1:
				return "one"
			if n % 10 >= 2 and n % 10 <= 4 and not (n % 100 >= 12 and n % 100 <= 14):
				return "few"
			return "many"
		"cs":
			return "one" if n == 1 else ("few" if n >= 2 and n <= 4 else "other")
		"ar":
			return "zero" if n == 0 else "one" if n == 1 else "two" if n == 2 else "few" if n % 100 >= 3 and n % 100 <= 10 else "many" if n % 100 >= 11 else "other"
	return "one" if n == 1 else "other"

static func is_rtl() -> bool:
	return lang == "ar"

static func _read(path: String) -> Variant:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	return JSON.parse_string(f.get_as_text())

static func _read_dict(path: String) -> Dictionary:
	var v: Variant = _read(path)
	return v if v is Dictionary else {}
