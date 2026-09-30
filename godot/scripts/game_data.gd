class_name GameData
extends RefCounted
# Maps and brawler stats exported from the JS source of truth (godot/tools/export-data.mjs).

const TILE := 2.0
const N := 25
const HALF := N * TILE / 2.0
const MOVE_BLOCK := "X#WCTKGVEM"
const SHOT_BLOCK := "X#CTKGEM"

static var maps: Dictionary = _load("res://data/maps.json")
static var brawlers: Dictionary = _load("res://data/brawlers.json")

static func _load(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("missing " + path)
		return {}
	return JSON.parse_string(f.get_as_text())

static func color_of(v: float) -> Color:
	return Color.from_rgba8((int(v) >> 16) & 255, (int(v) >> 8) & 255, int(v) & 255)
