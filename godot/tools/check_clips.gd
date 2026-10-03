extends SceneTree
# Plays ability clips (assets/abilities/*.ogv) through Godot's own Theora decoder and saves a contact
# sheet of frames per clip, to check what the game really shows (tools/record-abilities.mjs runs it):
#   godot --path godot --resolution 480x300 -s res://tools/check_clips.gd -- --out=<dir> [--only=gad_voltB,...]

var clips: Array = []
var out := ""
var player: VideoStreamPlayer
var k := -1
var t := 0.0
var shots := 0
const AT := [0.5, 1.2, 1.9, 2.6, 3.0]

func _initialize() -> void:
	var only: PackedStringArray = []
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out = a.substr(6)
		elif a.begins_with("--only="):
			only = a.substr(7).split(",")
	for f in DirAccess.get_files_at("res://assets/abilities/"):
		if f.ends_with(".ogv") and (only.is_empty() or only.has(f.get_basename())):
			clips.append(f.get_basename())
	clips.sort()
	player = VideoStreamPlayer.new()
	player.expand = true
	player.size = root.get_visible_rect().size
	root.add_child(player)
	_next()

func _next() -> void:
	k += 1
	t = 0.0
	shots = 0
	if k >= clips.size():
		print("CHECK done ", clips.size())
		quit(0)
		return
	player.stream = load("res://assets/abilities/%s.ogv" % clips[k])
	player.play()

func _process(delta: float) -> bool:
	if k >= clips.size() or k < 0:
		return false
	t += delta
	if shots < AT.size() and t >= AT[shots]:
		var img := root.get_texture().get_image()
		img.save_png("%s/%s_%d.png" % [out, clips[k], shots])
		shots += 1
		if shots == AT.size():
			_next()
	return false
