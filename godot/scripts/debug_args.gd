class_name DebugArgs
extends RefCounted
# Command-line user args (`-- --autotest`) on native builds, URL query on web (`?autotest&map=grove`),
# so the same end-to-end check runs everywhere.

static func list() -> PackedStringArray:
	var out := OS.get_cmdline_user_args()
	if OS.has_feature("web"):
		var q = JavaScriptBridge.eval("location.search")
		if typeof(q) == TYPE_STRING:
			for part in String(q).trim_prefix("?").split("&", false):
				var kv := part.split("=", false, 1)
				out.append("--" + kv[0] + ("=" + kv[1] if kv.size() > 1 else ""))
	return out

static func has(flag: String) -> bool:
	return list().has("--" + flag)
