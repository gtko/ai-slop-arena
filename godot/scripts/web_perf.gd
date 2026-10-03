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

func _process(delta: float) -> void:
	if not _cached:
		_cache_layers()
	_keep_rate(delta)
	_warm_up()

# ---------------------------------------------------------------- shader warm-up

# The Compatibility renderer compiles a shader the first time something draws with it (no
# ubershaders), and a WebGL compile + link costs tens of ms: the first explosion, the first
# additive flash, the first muzzle light each froze a frame of the first match. Once the menu's
# arena is up, every effect material (fx_lib glow variants and particle layers) is drawn for a few
# frames as a speck in front of the camera, with an omni and a spot light switched on, so those
# programs are built behind the menu instead. `?nowarm` skips it.
var _warm: Node3D
var _warm_frames := -1

func _warm_up() -> void:
	if _warm_frames == 0 or not OS.has_feature("web") or DebugArgs.has("nowarm"):
		return
	if _warm_frames > 0:
		_warm_frames -= 1
		if _warm_frames == 0 and is_instance_valid(_warm):
			_warm.queue_free()
		return
	var m := get_parent()
	var sc = m.get("showcase") if m else null
	var cam = m.get("cam") if m else null
	var a = sc.get("_arena") if sc else null
	if not (a is Node3D and is_instance_valid(a) and cam is Camera3D) or get_viewport().disable_3d:
		return
	_warm = Node3D.new()
	_warm.name = "ShaderWarmUp"
	(a as Node3D).add_child(_warm)
	var c := cam as Camera3D
	_warm.global_position = c.global_position - c.global_basis.z * 6.0
	var quad := QuadMesh.new()
	quad.size = Vector2(0.02, 0.02)
	var mats: Array[Material] = []
	for blend in ["mix", "add"]:
		for alpha in [1.0, 0.5]:
			for ds in [false, true]:
				mats.append(FxLib.glow(Color.WHITE, alpha, blend, ds))
	for kind in ["sparks", "fire", "smoke", "debris"]:
		mats.append(FxLib.layer_material(kind))
	for i in mats.size():
		var mi := MeshInstance3D.new()
		mi.mesh = quad
		mi.material_override = mats[i]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.position = Vector3((i % 6) * 0.03, (i / 6) * 0.03, 0.0)
		_warm.add_child(mi)
	var omni := OmniLight3D.new()
	omni.light_energy = 0.001
	omni.omni_range = 40.0
	_warm.add_child(omni)
	var spot := SpotLight3D.new()
	spot.light_energy = 0.001
	spot.spot_range = 40.0
	_warm.add_child(spot)
	_warm_frames = 4

# ---------------------------------------------------------------- automatic quality (autoquality.js)

const WINDOW := 4.0       # s per measure
const SLOW_FPS := 45.0    # under this for a window: one step down
const GOOD_FPS := 57.0    # this many good windows in a row: one step back up (to the ceiling)
const UP_WINDOWS := 5

var _t := 0.0
var _frames := 0
var _good := 0
var _failed := 0   # the best step that proved too slow this session, +1: no high/low/high oscillation
var _cool := 3.0 * WINDOW # let the start (shader compiles, loading) settle

# Web, quality "auto": measure the frame rate while the 3D view is drawn and the page is shown;
# too slow -> one step down (Low, then Low at 80 % and 65 % resolution), smooth for a while and
# under the GPU's ceiling -> one step up. `?noautoq` turns it off.
func _keep_rate(delta: float) -> void:
	if not OS.has_feature("web") or DebugArgs.has("noautoq"):
		return
	var active := Settings.gfx == "auto" and not Quality.saver and not get_viewport().disable_3d \
		and DisplayServer.window_is_focused() and Engine.max_fps != 5
	if not active or delta > 0.25:   # a hidden tab, a load, a burst of shader compiles: no verdict
		_t = 0.0
		_frames = 0
		if delta > 0.25:
			_cool = maxf(_cool, WINDOW)
		return
	_t += delta
	_frames += 1
	if _t < WINDOW:
		return
	var fps := _frames / _t
	_t = 0.0
	_frames = 0
	if _cool > 0.0:
		_cool -= WINDOW
		return
	var step := Quality.auto_step()
	var cap := float(Engine.max_fps) if Engine.max_fps > 0 else 60.0   # a 30 fps cap is not "slow"
	var slow := SLOW_FPS * minf(cap, 60.0) / 60.0
	var good := GOOD_FPS * minf(cap, 60.0) / 60.0
	if fps < slow and step < Quality.AUTO_STEPS.size() - 1:
		_good = 0
		_failed = maxi(_failed, step + 1)   # this step was too slow: never climb back to it this session
		_move(step + 1, fps)
	elif fps >= good and step > maxi(Quality.auto_max_step(), _failed):
		_good += 1
		if _good >= UP_WINDOWS:
			_good = 0
			_move(step - 1, fps)
	else:
		_good = 0

func _move(to: int, fps: float) -> void:
	print("WEBQ auto quality %s -> %s (%.1f fps)" % [Quality.step_name(), "%s@%d%%" % [Quality.AUTO_STEPS[to][0], roundi(float(Quality.AUTO_STEPS[to][1]) * 100.0)], fps])
	Quality.set_auto_step(to)
	_cool = 2.0 * WINDOW   # the new settings settle (and compile) before the next verdict

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
