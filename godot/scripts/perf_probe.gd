class_name PerfProbe
extends CanvasLayer
# Frame-cost probe: `?perf` on a debug web export (`-- --perf` natively) shows a small overlay and
# prints a "PERF ..." line every 2 s with the engine's monitors: frame rate, idle (_process) and
# physics time, the main viewport's CPU render time, draw calls, objects, primitives, nodes, the
# quality step and the render size. Without the flag the node does nothing and costs nothing.
#
# `?perf=sec` adds a per-system breakdown (PerfProbe.begin / end around the heavy GDScript paths).

const PERIOD := 2.0

static var on := false
static var _sec := false
static var _acc: Dictionary = {}   # system -> usec accumulated over the period
static var _t0: Dictionary = {}

var _label: Label
var _t := 0.0
var _frames := 0
var _worst := 0.0
var _proc := 0.0
var _phys := 0.0
var _rcpu := 0.0
var _rgpu := 0.0
var _dc := 0.0

func _init() -> void:
	for a in DebugArgs.list():
		if a == "--perf" or a.begins_with("--perf="):
			on = true
			_sec = a == "--perf=sec"
	layer = 6
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = 1000   # after everything else: the frame's numbers are complete

func _ready() -> void:
	if not on:
		set_process(false)
		return
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	_label = Label.new()
	_label.position = Vector2(8, 70)
	_label.add_theme_font_size_override("font_size", 13)
	_label.add_theme_color_override("font_color", Color("4bff86"))
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 4)
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_label)

# A/B switches for measuring (`?perfx=no3d,noui,nopost`): what a frame costs without the 3D world,
# without the 2D layers (menus, HUD), without the full-screen pass.
var _x: PackedStringArray = []

func _experiments() -> void:
	if _x.is_empty():
		for a in DebugArgs.list():
			if a.begins_with("--perfx="):
				_x = a.substr(8).split(",")
		if _x.is_empty():
			_x = ["-"]
	if _x.size() == 1 and _x[0] == "-":
		return
	if _x.has("no3d"):
		get_viewport().disable_3d = true
	for c in get_tree().root.find_children("*", "CanvasLayer", true, false):
		if c != self:
			if _x.has("nopost") and c is Sight:
				(c as CanvasLayer).visible = false
			elif _x.has("noui") and not (c is Sight):
				(c as CanvasLayer).visible = false

# What the visible 2D tree is made of (each style box, clip, material or texture switch costs a
# draw call in the Compatibility renderer): `?perf&perftree`.
func _census() -> String:
	var n := {}
	var add := func(k: String, v := 1) -> void: n[k] = int(n.get(k, 0)) + v
	for c in get_tree().root.find_children("*", "CanvasItem", true, false):
		var ci := c as CanvasItem
		if not ci.is_visible_in_tree():
			continue
		add.call(ci.get_class())
		if ci.get_script() != null:
			add.call("scripted")
		if ci.material != null:
			add.call("material")
		if ci is Control:
			var ct := ci as Control
			if ct.clip_contents:
				add.call("clip")
			for sb in ["panel", "normal", "focus", "hover"]:
				if ct.has_theme_stylebox_override(sb):
					add.call("sb_" + sb)
	var parts: PackedStringArray = []
	for k in n:
		parts.append("%s=%d" % [k, n[k]])
	return " ".join(parts)

# Where the triangles are (`?perf&perfmesh`): visible MeshInstance3D / MultiMeshInstance3D grouped by
# their parent's name, triangles x instances (shadow and outline copies count as their own nodes).
func _mesh_census() -> String:
	var tri := {}
	var cnt := {}
	for c in get_tree().root.find_children("*", "GeometryInstance3D", true, false):
		var g := c as GeometryInstance3D
		if not g.is_visible_in_tree():
			continue
		var mesh: Mesh = null
		var n := 1
		if g is MeshInstance3D:
			mesh = (g as MeshInstance3D).mesh
		elif g is MultiMeshInstance3D and (g as MultiMeshInstance3D).multimesh:
			var mm := (g as MultiMeshInstance3D).multimesh
			mesh = mm.mesh
			n = mm.visible_instance_count if mm.visible_instance_count >= 0 else mm.instance_count
		if mesh == null:
			continue
		var t := 0
		for s in mesh.get_surface_count():
			var arr := mesh.surface_get_arrays(s)
			var idx = arr[Mesh.ARRAY_INDEX]
			t += (idx.size() if idx != null and idx.size() > 0 else (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
		var mn := mesh.resource_path.get_file() if mesh.resource_path != "" else mesh.resource_name
		var key := "%s/%s:%s" % [g.get_parent().name if g.get_parent() else "-", g.get_class(), mn]
		tri[key] = int(tri.get(key, 0)) + t * n
		cnt[key] = int(cnt.get(key, 0)) + n
	var keys := tri.keys()
	keys.sort_custom(func(a, b): return int(tri[a]) > int(tri[b]))
	var parts: PackedStringArray = []
	for k in keys.slice(0, 25):
		parts.append("%s=%dk(x%d)" % [k, int(tri[k]) / 1000, cnt[k]])
	return " ".join(parts)

# Per-system timing (only with ?perf=sec): PerfProbe.begin("hud") ... PerfProbe.end("hud").
static func begin(key: String) -> void:
	if _sec:
		_t0[key] = Time.get_ticks_usec()

static func end(key: String) -> void:
	if _sec and _t0.has(key):
		_acc[key] = int(_acc.get(key, 0)) + Time.get_ticks_usec() - int(_t0[key])

func _process(delta: float) -> void:
	_experiments()
	# a run started from a terminal has no focus: main.gd's 5 fps background cap would be measured
	if Engine.max_fps == 5 and not OS.has_feature("web"):
		Engine.max_fps = Settings.max_fps()
	# `--perfuncap`: no frame cap and no vsync, so the frame time shows the headroom (native)
	if DebugArgs.has("perfuncap") and not OS.has_feature("web") and _frames == 0 and _t == 0.0:
		Engine.max_fps = 0
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	_t += delta
	_frames += 1
	_worst = maxf(_worst, delta)
	_proc += Performance.get_monitor(Performance.TIME_PROCESS)
	_phys += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
	_rcpu += RenderingServer.viewport_get_measured_render_time_cpu(get_viewport().get_viewport_rid()) \
		+ RenderingServer.get_frame_setup_time_cpu()
	_rgpu += RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid())
	_dc += Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
	if _t < PERIOD:
		return
	var n := float(_frames)
	var vp := get_viewport()
	var size := vp.get_visible_rect().size
	var win := DisplayServer.window_get_size()
	var line := "PERF fps=%.1f worst=%.1fms frame=%.2fms process_max=%.2fms physics_max=%.2fms render_cpu=%.2fms gpu=%.2fms draws=%d objects=%d prims=%dk nodes=%d q=%s scale=%.2f msaa=%d win=%dx%d vp=%dx%d 3d=%s" % [
		n / _t, _worst * 1000.0, _t / n * 1000.0, _proc / n * 1000.0, _phys / n * 1000.0, _rcpu / n, _rgpu / n, roundi(_dc / n),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0),
		int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		Quality.step_name(), vp.scaling_3d_scale, int(vp.msaa_3d), win.x, win.y, size.x, size.y,
		"off" if vp.disable_3d else "on"]
	if _sec and not _acc.is_empty():
		var parts: PackedStringArray = []
		var keys := _acc.keys()
		keys.sort_custom(func(a, b): return int(_acc[a]) > int(_acc[b]))
		for k in keys:
			parts.append("%s=%.2f" % [k, float(_acc[k]) / n / 1000.0])
		line += " | " + " ".join(parts)
		_acc.clear()
	print(line)
	if DebugArgs.has("perftree"):
		print("PERFTREE ", _census())
	if DebugArgs.has("perfmesh"):
		print("PERFMESH ", _mesh_census())
	_label.text = line.replace(" ", "\n").replace("|\n", "")
	_t = 0.0
	_frames = 0
	_worst = 0.0
	_proc = 0.0
	_phys = 0.0
	_rcpu = 0.0
	_rgpu = 0.0
	_dc = 0.0
