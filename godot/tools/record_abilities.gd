extends SceneTree
# Films one staged ability scene (tools/stage-abilities.mjs -> build/abilities/<clip>.json) with the
# game's renderer, for the home screen's ability previews. Run by tools/record-abilities.mjs, which
# encodes the frames into assets/abilities/<clip>.ogv:
#
#   godot --path godot --resolution 960x600 --fixed-fps 30 --write-movie <dir>/f.png \
#     -s res://tools/record_abilities.gd -- --scene=<abs path to clip .json> [--warm=24]
#
# Movie Maker renders every frame with a fixed 1/30 s step, however long it takes. The first `warm`
# frames hold the scene at its first snapshot (shaders compile, the spawn pop settles), then the
# replay runs to the clip's end; the runner keeps frames [warm + from x 30, warm + to x 30).

const Stage := preload("res://tools/ability_stage.gd")

var stage
var warm := 24
var frame := 0
var end_t := 0.0

func _initialize() -> void:
	var path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--scene="):
			path = a.substr(8)
		elif a.begins_with("--warm="):
			warm = int(a.substr(7))
	Lighting.tod = 1.0            # noon: the clearest light
	Quality.level = "ultra"       # (not set_level: that would save it in the player's settings)
	Quality.custom = {}
	Quality.saver = false
	stage = Stage.new()
	root.add_child(stage)
	current_scene = stage
	_path = path

var _path := ""

func _process(_delta: float) -> bool:
	frame += 1
	if frame == 1:   # in the tree now (the viewport's quality settings need it)
		if _path == "" or not stage.load_scene(_path):
			push_error("record_abilities: --scene=<clip .json> missing or unreadable")
			quit(1)
			return false
		Quality.apply()
		end_t = float(stage.data.to) + 0.05
		print("ABILITY scene ", _path, " to ", end_t)
		return false
	if frame == warm:
		stage.playing = true
	if stage and stage.playing and stage._t >= end_t:
		print("ABILITY done frames=", frame)
		return true
	return false
