class_name WebPerf
extends Node
# Frame-rate keeper, added once by main.gd. On the web export it installs the WebGL state filter
# (web_gl_filter.gd); everywhere it carries the `?perf` probe (perf_probe.gd).

func _init() -> void:
	name = "WebPerf"
	process_mode = Node.PROCESS_MODE_ALWAYS
	WebGlFilter.install()

func _ready() -> void:
	add_child(PerfProbe.new())
