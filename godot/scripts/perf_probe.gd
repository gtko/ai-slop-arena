class_name PerfProbe
extends CanvasLayer
# Performance overlay (Options > General > Show performance, Settings.show_perf), in every build:
# one screenshot tells where a slow device spends its frame.
#   fps        average, 1 % low (the mean of the slowest 1 % of frames) and the worst frame
#   cpu        "nodes": every node's _process of the frame, scripts and engine (animation players,
#              particles), from the first to the last (PerfProbe's _First marker to itself); "sync":
#              the rest of the engine's process time, mostly waiting for the renderer / vsync; physics;
#              the render CPU time; gpu = the main viewport's measured GPU time (n/a where the driver
#              has no timer queries, WebGL)
#   draws      draw calls, objects, triangles, nodes
#   3D         the 3D render size (viewport x 3D scale), the frame-budget viewport and the window
#   quality    tier / auto step / fps cap, renderer, GPU name, CPU cores
#   scripts    the per-system GDScript breakdown (PerfProbe.now / add around the heavy paths:
#              fighters, main, menu showcase, arena and its parts, fx, HUD, audio...); "engine" is
#              the part of "nodes" no section claims (animation players and trees, skeletons,
#              unmeasured scripts). "arena.*" parts run inside "showcase" (menu) or "main" (match).
# A verdict line names the likely bottleneck (GPU, CPU scripts, CPU render, physics).
#
# Measuring (debug flags): `?perf` on a debug web export (`-- --perf` natively) shows it too and
# prints a "PERF ..." line every 2 s (the CDP harness reads those); `?perfx=no3d,noui,nopost` A/B
# switches, `?perftree` / `?perfmesh` censuses, `--perfuncap` (native) lifts the frame cap.

const PERIOD := 2.0       # the PERF line (and the averages) cover this window
const SHOW_EVERY := 0.5   # the overlay's text refresh
const RING := 600         # frame times kept for the 1 % low (10 s at 60 fps)

static var on := false         # `--perf`: a measuring run (prints, and web_perf.gd judges unfocused)
static var _sec := false       # sections are timed (overlay shown or a measuring run)
static var _acc: Dictionary = {}   # section -> usec accumulated over the window
static var _t0: Dictionary = {}
static var _f0 := 0                # usec when the frame's first _process ran (_First)

# Processed before every other node (lowest priority): marks the start of the frame's _process pass.
class _First extends Node:
	func _init() -> void:
		process_priority = -1000000
		process_mode = Node.PROCESS_MODE_ALWAYS
	func _process(_d: float) -> void:
		PerfProbe._f0 = Time.get_ticks_usec()

var _panel: PanelContainer
var _label: Label
var _t := 0.0
var _show_t := 0.0
var _frames := 0
var _worst := 0.0
var _proc := 0.0
var _phys := 0.0
var _rcpu := 0.0
var _rgpu := 0.0
var _dc := 0.0
var _obj := 0.0
var _prims := 0.0
var _nodes := 0.0
var _ring := PackedFloat32Array()
var _ri := 0
var _rn := 0
var _measuring := false
var _last_line := ""
var _last_sec := ""

func _init() -> void:
	for a in DebugArgs.list():
		if a == "--perf" or a.begins_with("--perf="):
			on = true
	layer = 128   # over the menus, the HUD and the pause screen
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = 1000   # after everything else: the frame's numbers are complete
	_ring.resize(RING)

func _ready() -> void:
	_panel = PanelContainer.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.02, 0.02, 0.06, 0.8)
	sb.set_corner_radius_all(6)
	_panel.add_theme_stylebox_override("panel", sb)
	_label = Label.new()
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_label.add_theme_color_override("font_color", Color("b8ffcf"))
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_panel.add_child(_label)
	_panel.visible = false
	add_child(_panel)
	add_child(_First.new())

static func shown() -> bool:
	return on or Settings.show_perf

# Per-system timing: `var t := PerfProbe.now()` ... `PerfProbe.add("hud", t)`. Costs one call and a
# bool test while the overlay is off.
static func now() -> int:
	return Time.get_ticks_usec() if _sec else 0

static func add(key: String, t0: int) -> void:
	if t0 != 0 and _sec:
		_acc[key] = int(_acc.get(key, 0)) + Time.get_ticks_usec() - t0

static func begin(key: String) -> void:
	if _sec:
		_t0[key] = Time.get_ticks_usec()

static func end(key: String) -> void:
	if _sec and _t0.has(key):
		_acc[key] = int(_acc.get(key, 0)) + Time.get_ticks_usec() - int(_t0[key])

func _start() -> void:
	_measuring = true
	_sec = true
	_acc.clear()
	_reset()
	_rn = 0
	_ri = 0
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)

func _stop() -> void:
	_measuring = false
	_sec = false
	_acc.clear()
	_panel.visible = false
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), false)

func _reset() -> void:
	_t = 0.0
	_frames = 0
	_worst = 0.0
	_proc = 0.0
	_phys = 0.0
	_rcpu = 0.0
	_rgpu = 0.0
	_dc = 0.0
	_obj = 0.0
	_prims = 0.0
	_nodes = 0.0

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
	var add_n := func(k: String, v := 1) -> void: n[k] = int(n.get(k, 0)) + v
	for c in get_tree().root.find_children("*", "CanvasItem", true, false):
		var ci := c as CanvasItem
		if not ci.is_visible_in_tree():
			continue
		add_n.call(ci.get_class())
		if ci.get_script() != null:
			add_n.call("scripted")
		if ci.material != null:
			add_n.call("material")
		if ci is Control:
			var ct := ci as Control
			if ct.clip_contents:
				add_n.call("clip")
			for sb in ["panel", "normal", "focus", "hover"]:
				if ct.has_theme_stylebox_override(sb):
					add_n.call("sb_" + sb)
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

func _process(delta: float) -> void:
	if on:
		_experiments()
		# a run started from a terminal has no focus: main.gd's 5 fps background cap would be measured
		if Engine.max_fps == 5 and not OS.has_feature("web"):
			Engine.max_fps = Settings.max_fps()
		# `--perfuncap`: no frame cap and no vsync, so the frame time shows the headroom (native)
		if DebugArgs.has("perfuncap") and not OS.has_feature("web") and _frames == 0 and _t == 0.0:
			Engine.max_fps = 0
			DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	var want := shown()
	if want != _measuring:
		if want:
			_start()
		else:
			_stop()
	if not _measuring:
		return
	_t += delta
	_frames += 1
	_worst = maxf(_worst, delta)
	_ring[_ri] = delta
	_ri = (_ri + 1) % RING
	_rn = mini(_rn + 1, RING)
	if _f0 > 0:
		_nodes += float(Time.get_ticks_usec() - _f0) / 1000.0
	var rid := get_viewport().get_viewport_rid()
	_proc += Performance.get_monitor(Performance.TIME_PROCESS)
	_phys += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
	_rcpu += RenderingServer.viewport_get_measured_render_time_cpu(rid) + RenderingServer.get_frame_setup_time_cpu()
	_rgpu += RenderingServer.viewport_get_measured_render_time_gpu(rid)
	_dc += Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
	_obj += Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)
	_prims += Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)
	_show_t += delta
	if _show_t >= SHOW_EVERY:
		_show_t = 0.0
		_draw_text()
	if _t < PERIOD:
		return
	_window_done()

# The 2 s window closes: the averages and the section costs for the overlay (and the PERF line).
func _window_done() -> void:
	var n := float(_frames)
	var vp := get_viewport()
	var size := vp.get_visible_rect().size
	var win := DisplayServer.window_get_size()
	_avg = {"fps": n / _t, "frame": _t / n * 1000.0, "worst": _worst * 1000.0, "proc": _proc / n * 1000.0,
		"phys": _phys / n * 1000.0, "rcpu": _rcpu / n, "gpu": _rgpu / n, "draws": roundi(_dc / n),
		"obj": roundi(_obj / n), "prims": roundi(_prims / n), "nodes": _nodes / n}
	var sec: Array = []
	var claimed := 0.0
	for k in _acc:
		var ms := float(_acc[k]) / n / 1000.0
		sec.append([String(k), ms])
		if not String(k).contains("."):
			claimed += ms
	sec.sort_custom(func(a, b): return a[1] > b[1])
	_secs = sec
	_other = maxf(0.0, float(_avg.nodes) - claimed)
	_acc.clear()
	if on:
		var line := "PERF fps=%.1f worst=%.1fms frame=%.2fms process_max=%.2fms physics_max=%.2fms nodes=%.2fms render_cpu=%.2fms gpu=%.2fms draws=%d objects=%d prims=%dk nodes=%d q=%s scale=%.2f msaa=%d win=%dx%d vp=%dx%d 3d=%s" % [
			_avg.fps, _avg.worst, _avg.frame, _avg.proc, _avg.phys, _avg.nodes, _avg.rcpu, _avg.gpu, _avg.draws, _avg.obj,
			int(_avg.prims / 1000.0), int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
			Quality.step_name(), vp.scaling_3d_scale, int(vp.msaa_3d), win.x, win.y, size.x, size.y,
			"off" if vp.disable_3d else "on"]
		if not sec.is_empty():
			var parts: PackedStringArray = []
			for s in sec:
				parts.append("%s=%.2f" % [s[0], s[1]])
			parts.append("engine=%.2f" % _other)
			line += " | " + " ".join(parts)
		print(line)
		if DebugArgs.has("perftree"):
			print("PERFTREE ", _census())
		if DebugArgs.has("perfmesh"):
			print("PERFMESH ", _mesh_census())
	_reset()

var _avg: Dictionary = {}
var _secs: Array = []
var _other := 0.0

# The mean frame rate of the slowest 1 % of the last RING frames.
func _low1() -> float:
	if _rn < 10:
		return 0.0
	var a := _ring.slice(0, _rn)
	a.sort()
	var k := maxi(1, _rn / 100)
	var s := 0.0
	for i in k:
		s += a[_rn - 1 - i]
	return k / maxf(s, 1e-6)

func _draw_text() -> void:
	var vp := get_viewport()
	var k := UiKit.css_scale(vp)
	_panel.visible = true
	_label.add_theme_font_size_override("font_size", maxi(9, roundi(11.0 * k)))
	_label.add_theme_constant_override("outline_size", maxi(1, roundi(2.0 * k)))
	_label.add_theme_constant_override("line_spacing", roundi(-2.0 * k))
	(_panel.get_theme_stylebox("panel") as StyleBoxFlat).set_content_margin_all(5.0 * k)
	_panel.position = Vector2(8.0, 46.0) * k
	var lines: PackedStringArray = []
	var fps := Engine.get_frames_per_second()
	lines.append("%d fps  1%%low %.0f  cap %s" % [fps, _low1(), str(Engine.max_fps) if Engine.max_fps > 0 else "-"])
	if not _avg.is_empty():
		var a := _avg
		var gpu := "%.1f" % a.gpu if float(a.gpu) > 0.0 else "n/a"
		lines.append("frame %.1f ms  worst %.0f  gpu %s" % [a.frame, a.worst, gpu])
		lines.append("cpu nodes %.1f  sync %.1f  phys %.1f  rend %.1f" % [a.nodes, maxf(0.0, float(a.proc) - float(a.nodes)), a.phys, a.rcpu])
		lines.append("draws %d  obj %d  tris %dk  nodes %d" % [a.draws, a.obj, int(a.prims / 1000.0), int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))])
	var size := vp.get_visible_rect().size
	var win := DisplayServer.window_get_size()
	var s3 := vp.scaling_3d_scale
	# the frame budget (Quality.apply_frame_budget) draws everything at the content size; otherwise
	# the root viewport is the window (the canvas size is only the layout's)
	var px := size if get_window().content_scale_mode == Window.CONTENT_SCALE_MODE_VIEWPORT else Vector2(win)
	lines.append("3D %dx%d (x%.2f of %dx%d)  win %dx%d" % [roundi(px.x * s3), roundi(px.y * s3), s3, px.x, px.y, win.x, win.y])
	var q := Quality.step_name()
	if Settings.gfx == "auto" and not Quality.saver:
		q += "  auto %d/%d" % [Quality.auto_step(), Quality.AUTO_STEPS.size() - 1]
	elif Settings.gfx == "custom":
		q += " custom"
	lines.append("q %s  %s%s" % [q, "vulkan" if Quality.renderer_now() == "vulkan" else "gles3", " mobile" if Quality.mobile() else ""])
	lines.append("%s  %d cores" % [RenderingServer.get_video_adapter_name().left(34), OS.get_processor_count()])
	if not _avg.is_empty():
		lines.append(_verdict())
	if not _secs.is_empty():
		var parts: PackedStringArray = []
		var row := "ms "
		for s in _secs:
			if float(s[1]) < 0.05:
				continue
			var item := "%s %.1f" % [s[0], s[1]]
			if row.length() + item.length() > 44:
				parts.append(row)
				row = "   "
			row += item + "  "
		row += "engine %.1f" % _other
		parts.append(row)
		lines.append_array(parts)
	_label.text = "\n".join(lines)
	_panel.reset_size()

# The likely bottleneck, from the averages: the GPU when its time is the biggest part, else the
# biggest CPU part (nodes = scripts + animation, render submission, physics). "sync" (waiting for the
# renderer or vsync) is not work: a frame that is slow with little work points at the GPU.
func _verdict() -> String:
	var a := _avg
	var frame: float = a.frame
	var nodes: float = a.nodes
	var cpu: float = nodes + float(a.phys) + float(a.rcpu)
	var budget := 1000.0 / float(Engine.max_fps) if Engine.max_fps > 0 else 1000.0 / 60.0
	var tag := "ok" if frame <= budget * 1.1 else "SLOW"
	var what := ""
	if float(a.gpu) > cpu:
		what = "gpu %.1f > cpu %.1f" % [a.gpu, cpu]
	elif nodes >= float(a.rcpu) and nodes >= float(a.phys):
		what = "cpu nodes %.1f" % nodes
	elif float(a.rcpu) >= float(a.phys):
		what = "cpu render %.1f" % a.rcpu
	else:
		what = "cpu physics %.1f" % a.phys
	if float(a.gpu) <= 0.0 and tag == "SLOW" and frame > cpu * 1.5:
		what = "gpu? (work %.1f of %.1f ms)" % [cpu, frame]
	return "%s  bound: %s" % [tag, what]
