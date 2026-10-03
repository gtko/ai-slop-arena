class_name LocalRoom
extends NetClient
# Offline room: the server's rules (src/game.js, bundled with the room logic of src/server/local.js
# into res://local/sim_local.js by `npx vite build --mode localsim`) run inside the client for one
# human and 7 bots, or the training dojo. Same messages as the room socket (welcome, room, start,
# lprog, go, snap, ev, pong) and the same inputs (in, pick, map, mode, chaos, start, loaded, ping), so
# main.gd only swaps which NetClient it talks to.
#
# JS engine: the browser's own on the web (JavaScriptBridge), the QuickJSVM GDExtension on native
# builds (godot/addons/quickjs, native/quickjs). Native runs the simulation on its own thread (QuickJS
# is ~10x slower than V8 and building a match takes seconds); the web runs it on the main thread
# (the browser's JIT: a few ms per frame). Only JSON strings cross the boundary.

const BUNDLE := "res://local/sim_local.js"

var dojo := false
var level := 0.45
var last_step_ms := 0.0      # simulation cost of the last poll (measurement)
var engine := ""             # "browser" | "quickjs"

var _room := -1
var _js: JavaScriptObject    # web: window.SlopLocal
var _vm: Object              # native: QuickJSVM (on _thread)
var _thread: Thread
var _mutex := Mutex.new()
var _inbox: Array[String] = []
var _outbox: Array[String] = []
var _run := false
var _poll_us := PackedInt64Array()   # native: cost of each poll (measurement, last 600)

# The local room can run here: the bundle is in the pack and a JS engine is available.
static func available() -> bool:
	if not FileAccess.file_exists(BUNDLE):
		return false
	return OS.has_feature("web") or ClassDB.class_exists("QuickJSVM")

func connect_room(_origin: String, _code: String, player_name: String, brawler: String, lo: String = "A1", cos: String = "") -> Error:
	close()
	welcomed = false
	matchmade = false
	var opts := JSON.stringify({"name": player_name, "brawler": brawler, "lo": lo, "cos": cos, "level": level, "dojo": dojo, "plat": NetClient._platform()})
	var src := FileAccess.get_file_as_string(BUNDLE)
	if src == "":
		return ERR_FILE_NOT_FOUND
	var t0 := Time.get_ticks_usec()
	if OS.has_feature("web"):
		engine = "browser"
		if JavaScriptBridge.eval("typeof window.SlopLocal", true) != "object":
			JavaScriptBridge.eval(src, true)
		_js = JavaScriptBridge.get_interface("SlopLocal")
		if _js == null:
			return ERR_CANT_CREATE
		_room = int(_js.open(opts))
	else:
		if not ClassDB.class_exists("QuickJSVM"):
			return ERR_UNAVAILABLE
		engine = "quickjs"
		_vm = ClassDB.instantiate("QuickJSVM")
		_room = 0   # the VM loads the bundle and opens the room on its thread (inputs queue meanwhile)
		_run = true
		_thread = Thread.new()
		_thread.start(_sim_loop.bind(src, opts))
	print("LocalRoom: %s, started in %d ms" % [engine, (Time.get_ticks_usec() - t0) / 1000])
	connected = true   # welcome + room arrive on the next frame (like a socket: after main.gd is in LOBBY)
	return OK

func send(msg: Dictionary) -> void:
	if _room < 0:
		return
	var raw := JSON.stringify(msg)
	if _js != null:
		_js.send(_room, raw)
	else:
		_mutex.lock()
		_inbox.append(raw)
		_mutex.unlock()

func close() -> void:
	if _thread != null:
		_run = false
		_thread.wait_to_finish()
		_thread = null
	if _js != null and _room >= 0:
		_js.close(_room)
	_js = null
	_vm = null
	_room = -1
	_inbox.clear()
	_outbox.clear()
	connected = false
	_opening = false

func _exit_tree() -> void:
	close()

func _process(delta: float) -> void:
	if _room < 0:
		return
	if _js != null:
		var t := Time.get_ticks_usec()
		var raw := String(_js.poll(_room, delta))
		last_step_ms = (Time.get_ticks_usec() - t) / 1000.0
		_drain(raw)
		return
	_mutex.lock()
	var batches := _outbox.duplicate()
	_outbox.clear()
	_mutex.unlock()
	for raw in batches:
		_drain(raw)

func _drain(raw: String) -> void:
	var list = JSON.parse_string(raw)
	if typeof(list) != TYPE_ARRAY:
		return
	for msg in list:
		if typeof(msg) != TYPE_DICTIONARY:
			continue
		match msg.get("t", ""):
			"welcome":
				id = msg.id
				code = msg.code
				welcomed = true
				matchmade = false
			"error":
				if msg.get("code", "") == "sim":
					push_error("LocalRoom simulation: " + String(msg.get("msg", "")))
		message.emit(msg)

# Native: the simulation thread owns the VM (QuickJS is single-threaded): inputs in, real time
# advanced at ~60 Hz, messages out. A slow step (building a match) never blocks the renderer.
func _sim_loop(src: String, opts: String) -> void:
	var t0 := Time.get_ticks_usec()
	_vm.call("eval", src, "sim_local.js")
	if _vm.call("get_error") != "":
		push_error("LocalRoom: " + String(_vm.call("get_error")))
		return
	_room = int(_vm.call("call_function", "SlopLocal.open", [opts]))
	print("LocalRoom: bundle evaluated in %d ms" % ((Time.get_ticks_usec() - t0) / 1000))
	var last := Time.get_ticks_usec()
	while _run:
		_mutex.lock()
		var ins := _inbox.duplicate()
		_inbox.clear()
		_mutex.unlock()
		for raw in ins:
			var ts := Time.get_ticks_usec()
			_vm.call("call_function", "SlopLocal.send", [_room, raw])
			if Time.get_ticks_usec() - ts > 100000:
				print("LocalRoom: %s took %d ms" % [raw.substr(0, 24), (Time.get_ticks_usec() - ts) / 1000])
		var now := Time.get_ticks_usec()
		var dt := (now - last) / 1000000.0
		last = now
		var out = _vm.call("call_function", "SlopLocal.poll", [_room, dt])
		var cost := Time.get_ticks_usec() - now
		last_step_ms = cost / 1000.0
		_poll_us.append(cost)
		if _poll_us.size() > 600:
			_poll_us = _poll_us.slice(_poll_us.size() - 600)
		if typeof(out) == TYPE_STRING and out != "[]":
			_mutex.lock()
			_outbox.append(out)
			_mutex.unlock()
		elif _vm.call("get_error") != "":
			push_error("LocalRoom: " + String(_vm.call("get_error")))
		OS.delay_usec(maxi(1000, 16666 - (Time.get_ticks_usec() - now)))
	if _vm != null and _room >= 0:
		_vm.call("call_function", "SlopLocal.close", [_room])

# Measurement: mean / p95 / max cost of the recent polls in ms, and the VM heap.
func stats() -> Dictionary:
	var a := Array(_poll_us)
	if a.is_empty():
		return {"engine": engine, "step_ms": last_step_ms}
	a.sort()
	var sum := 0
	for v in a:
		sum += v
	return {"engine": engine, "polls": a.size(), "mean_ms": sum / 1000.0 / a.size(), "p95_ms": a[int(a.size() * 0.95)] / 1000.0,
		"max_ms": a[a.size() - 1] / 1000.0, "heap_mb": (int(_vm.call("memory_bytes")) / 1048576.0) if _vm != null else 0.0}
