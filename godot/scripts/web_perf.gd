class_name WebPerf
extends Node
# Frame-rate keeper, added once by main.gd. On the web export it installs the WebGL state filter
# (web_gl_filter.gd) and caches the menu layers (ui_cache.gd); everywhere it carries the `?perf`
# probe (perf_probe.gd). `?nouicache` / `?noglfilter` (debug exports) turn the pieces off;
# `-- --uicache` tries the menu cache on a native build.

var _cached := false

func _init() -> void:
	name = "WebPerf"
	process_mode = Node.PROCESS_MODE_ALWAYS
	WebGlFilter.install()

func _ready() -> void:
	add_child(PerfProbe.new())

func _process(_delta: float) -> void:
	if not _cached:
		_cache_layers()

# main.gd builds its UI after this node: pick the layers up once they exist.
func _cache_layers() -> void:
	var m := get_parent()
	var ui = m.get("ui") if m else null
	var opts = m.get("settings_view") if m else null
	if not (ui is Control and opts is Control):
		return
	_cached = true
	var use := (OS.has_feature("web") or DebugArgs.has("uicache")) and not DebugArgs.has("nouicache")
	if not use:
		return
	for n in [ui, opts]:
		var l := (n as Node).get_parent() as CanvasLayer
		if l:
			add_child(UiCache.new(l))
