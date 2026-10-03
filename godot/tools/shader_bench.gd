extends SceneTree
# Per-pixel cost of the world shaders and the line-of-sight pass (no server, no menus): builds each
# map's Arena under a host that looks like main.gd to it (like geometry_audit.gd), puts the 8
# brawlers around the camera focus with yours in the middle of the sight mask, and measures the GPU
# time of the frame (RenderingServer measured render time of the root viewport) for the full and the
# LOW shader variants (Quality.apply_shaders), with and without the sight pass, alternating the
# variants over several rounds so drifts (clocks, heat) hit them alike. Saves a PNG per map and
# variant with --shots.
#
#   godot --path godot --resolution 1442x901 -s res://tools/shader_bench.gd -- --device=mobile --quality=low [--maps=grove,oasis,frost] [--rounds=4] [--frames=240] [--stress] [--shots=dir] [--tod=0..3]
#
# --stress draws the 3D at twice the resolution each way (4x the pixels): per-pixel costs stand out
# on a fast desktop GPU. Needs a real renderer (not --headless). Mobile renderer by default, add
# `--rendering-method gl_compatibility` before `-s` for the web's.

const BRAWLERS := ["blaster", "bomber", "frostbite", "gunslinger", "kappa", "mochi", "pipchomp", "volt"]
const FOCUS := Vector3(0, 0, 4)   # main.gd's starting focus

class Host extends Node3D:
	var sun: DirectionalLight3D
	var env: WorldEnvironment
	var fighters: Dictionary = {}
	var me: Fighter
	var cam_focus := Vector3.ZERO
	var arena: Arena
	var cam: Camera3D
	func _process(delta: float) -> void:
		if arena:
			arena.update(delta)

var host: Host
var sight: Sight
var _args := {}

func _initialize() -> void:
	_run.call_deferred()

func _parse() -> void:
	for s in OS.get_cmdline_user_args():
		var kv := s.trim_prefix("--").split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else "1"

func _run() -> void:
	_parse()
	Engine.max_fps = 0
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	RenderingServer.viewport_set_measure_render_time(root.get_viewport_rid(), true)
	var maps: Array = ["grove", "oasis", "frost"]
	if _args.has("maps"):
		maps = Array(String(_args.maps).split(","))
	print("BENCH quality %s, renderer %s, adapter %s, viewport %s%s" % [Quality.level, RenderingServer.get_current_rendering_method(),
		RenderingServer.get_video_adapter_name(), root.get_visible_rect().size, " x2 (stress)" if _args.has("stress") else ""])
	var tods: Array = [Lighting.tod]
	if _args.has("tods"):   # --tods=0,1,2,3: every map at each time of day (shots named map_tod_variant)
		tods = Array(String(_args.tods).split(",")).map(func(s): return float(s))
	for t in tods:
		Lighting.tod = t
		for m in maps:
			await _bench_map(String(m), "_t%d" % int(t) if _args.has("tods") else "")
	quit()

func _wait(n: int) -> void:
	for k in n:
		await process_frame
	await RenderingServer.frame_post_draw

func _build(map_key: String) -> void:
	host = Host.new()
	host.name = "Main"
	root.add_child(host)
	current_scene = host
	host.cam = Camera3D.new()
	host.cam.fov = 40
	host.cam.near = 0.5
	host.cam.far = 260.0
	host.add_child(host.cam)
	host.cam.current = true
	host.sun = DirectionalLight3D.new()
	host.add_child(host.sun)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	host.add_child(env)
	host.env = env
	host.arena = Arena.new()
	host.add_child(host.arena)
	host.arena.build(GameData.maps[map_key])
	for k in BRAWLERS.size():
		var f := Fighter.new()
		host.add_child(f)
		f.setup({"id": "f%d" % k, "name": "", "type": BRAWLERS[k]}, GameData.brawlers)
		host.fighters[f.id] = f
		for nn in ["_bar", "_label"]:
			var v: Variant = f.get(nn)
			if v is Node3D:
				(v as Node3D).visible = false
		var a := TAU * k / BRAWLERS.size()
		var p := FOCUS + (Vector3.ZERO if k == 0 else Vector3(cos(a) * 6.0, 0, sin(a) * 4.0))
		f.position = p
		f.target = p
		if k == 0:
			f.is_local = true
			host.me = f
	host.cam_focus = FOCUS
	host.cam.position = FOCUS + Lighting.CAM_OFFSET
	host.cam.look_at(Vector3(FOCUS.x, 0.5, FOCUS.z))
	sight = Sight.new(host)
	host.add_child(sight)
	Quality.apply()
	if _args.has("stress"):
		root.scaling_3d_scale = 2.0

# GPU ms per frame, averaged over n frames.
func _measure(n: int) -> float:
	var vp := root.get_viewport_rid()
	var acc := 0.0
	for k in n:
		await process_frame
		acc += RenderingServer.viewport_get_measured_render_time_gpu(vp)
	return acc / n

func _bench_map(map_key: String, tag := "") -> void:
	_build(map_key)
	await _wait(30)
	var t0 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t0 < 1500:   # the sight dimming fades in
		await process_frame
	var rounds := int(_args.get("rounds", "4"))
	var frames := int(_args.get("frames", "240"))
	var configs := ["full", "full-nosight", "low", "low-nosight"]
	var sums := {}
	for c in configs:
		sums[c] = []
	for r in rounds:
		for c in configs:
			Quality.apply_shaders(String(c).begins_with("low"))
			sight.visible = true
			sight.set_process(not String(c).ends_with("nosight"))
			if String(c).ends_with("nosight"):
				sight.visible = false
				RenderingServer.global_shader_parameter_set("g_sight", Vector4.ZERO)
			await _wait(40)   # compiles, the mask and its blurred copy
			sums[c].append(await _measure(frames))
			if r == 0 and _args.has("shots"):
				await RenderingServer.frame_post_draw
				root.get_texture().get_image().save_png("%s/%s%s_%s.png" % [_args.shots, map_key, tag, c])
	var line := "BENCH %s%s:" % [map_key, tag]
	for c in configs:
		var a: Array = sums[c]
		a.sort()
		var med: float = (a[(a.size() - 1) / 2] + a[a.size() / 2]) * 0.5
		line += " %s=%.3fms(min %.3f)" % [c, med, a[0]]
	print(line)
	Quality.apply_shaders(false)
	host.free()
	host = null
	sight = null
	PropLib._cache.clear()
	PropLib._mats.clear()
	await _wait(2)
