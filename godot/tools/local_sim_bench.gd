extends SceneTree
# The local room benchmark (scripts/local-sim-bench.js) inside the QuickJSVM GDExtension:
#   godot --headless --path godot --script res://tools/local_sim_bench.gd -- [--full] [--dojo] [--maxt=120] [--bench=<path>]
# --bench: path of scripts/local-sim-bench.js (default: ../scripts/local-sim-bench.js from the project).

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if not ClassDB.class_exists("QuickJSVM"):
		print("QuickJSVM missing (godot/addons/quickjs)")
		quit(1)
		return
	var bench_path := ProjectSettings.globalize_path("res://").path_join("../scripts/local-sim-bench.js")
	var pre := "globalThis.BUCKETS = true;"
	for a in args:
		if a == "--full": pre += "globalThis.FULL = true;"
		elif a == "--dojo": pre += "globalThis.DOJO = true;"
		elif a.begins_with("--maxt="): pre += "globalThis.MAXT = %d;" % int(a.substr(7))
		elif a.begins_with("--map="): pre += "globalThis.MAP = '%s';" % a.substr(6)
		elif a.begins_with("--bench="): bench_path = a.substr(8)
	var vm: Object = ClassDB.instantiate("QuickJSVM")
	print(vm.call("engine_version"))
	var t0 := Time.get_ticks_usec()
	vm.call("eval", FileAccess.get_file_as_string("res://local/sim_local.js"), "sim_local.js")
	print("bundle eval ms: %d  heap MB: %.1f" % [(Time.get_ticks_usec() - t0) / 1000, int(vm.call("memory_bytes")) / 1048576.0])
	vm.call("eval", "globalThis.print = __godot_print;" + pre, "pre.js")
	vm.call("eval", FileAccess.get_file_as_string(bench_path), "bench.js")
	if vm.call("get_error") != "":
		print(vm.call("get_error"))
	print("heap MB after: %.1f" % (int(vm.call("memory_bytes")) / 1048576.0))
	quit(0)
