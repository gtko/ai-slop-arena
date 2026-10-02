class_name DebugArgs
extends RefCounted
# Command-line user args (`-- --autotest`) on native builds, URL query on web (`?autotest&map=grove`),
# so the same end-to-end check runs everywhere.

static var _cache: PackedStringArray
static var _read := false

# Read once: the args never change during a run, and on web each read is a JavaScript eval
# (some callers ask every frame).
static func list() -> PackedStringArray:
	if not _read:
		_cache = _parse()
		_read = true
	return _cache

static func _parse() -> PackedStringArray:
	var out := OS.get_cmdline_user_args()
	# Web: only debug exports read the URL. On a release build anyone can craft a link, and flags such
	# as `?server=` (where your identity goes) or `?autotest` / `?keytest` (they write your saves)
	# must not be reachable from one.
	if OS.has_feature("web") and OS.is_debug_build():
		var q = JavaScriptBridge.eval("location.search")
		if typeof(q) == TYPE_STRING:
			for part in String(q).trim_prefix("?").split("&", false):
				var kv := part.split("=", false, 1)
				out.append("--" + kv[0] + ("=" + kv[1] if kv.size() > 1 else ""))
	return out

static func has(flag: String) -> bool:
	return list().has("--" + flag)
