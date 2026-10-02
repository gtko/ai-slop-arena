extends RefCounted
# One recorded attract-mode match (tools/record-attract.mjs): the server's 'snap' (15 Hz) and 'ev'
# messages of a bot match starring one brawler, decoded back to the protocol's shapes so the menu
# plays them through the same calls as a live match (menu_showcase.gd).

const DIR := "res://data/attract/"
const MAX_PER := 4   # recordings per map and brawler the loader looks for (<map>_<brawler>_<n>)

var map := ""
var star := ""
var winner := ""
var dur := 0.0            # seconds: the last K.O. + ~3 s (game.js restarts the backdrop then)
var roster: Array = []    # [{id, name, type, cos, spawn}], the star first
var snaps: Array = []     # [[t (s), {t: "snap", pt, b: [[id, x, z, facing, hp, maxHp, ammo, super, cubes, flags]]}]]
var evs: Array = []       # [[t (s), [event, ...]]]

static func path_of(map_key: String, brawler: String, n: int) -> String:
	return "%s%s_%s_%d.json.gz" % [DIR, map_key, brawler, n]

# The recordings there are for this map and brawler (an exported build lists none of its files
# reliably, so the names are tried in order).
static func available(map_key: String, brawler: String) -> Array:
	var out: Array = []
	for n in MAX_PER:
		var p := path_of(map_key, brawler, n)
		if FileAccess.file_exists(p):
			out.append(p)
	return out

func load_from(path: String) -> bool:
	var raw := FileAccess.get_file_as_bytes(path)
	if raw.is_empty():
		return false
	var txt := raw.decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP).get_string_from_utf8()
	var d: Variant = JSON.parse_string(txt)
	if not (d is Dictionary) or int(d.get("v", 0)) != 1:
		return false
	_decode(d)
	return true

func _decode(d: Dictionary) -> void:
	map = String(d.map)
	star = String(d.star)
	winner = String(d.get("winner", ""))
	dur = float(d.dur) / 1000.0
	roster = d.roster
	var ids: Array = []
	for r in roster:
		ids.append(String(r.id))
	var last := {}   # k -> [x cm, z cm, hp, maxHp, cubes, flags]
	var t := 0.0
	for s in d.snaps:
		t += float(s[0]) / 1000.0
		var rows: Array = []
		for row in s[2]:
			var k := int(row[0])
			var p: Array = last.get(k, [0, 0, 1, 1, 0, 0])
			var x := int(row[1]) + (int(p[0]) if last.has(k) else 0)
			var z := int(row[2]) + (int(p[1]) if last.has(k) else 0)
			var st := [p[2], p[3], p[4], p[5]]
			if row.size() > 4:
				st = [row[4], row[5], row[6], row[7]]
			last[k] = [x, z, st[0], st[1], st[2], st[3]]
			rows.append([ids[k], x / 100.0, z / 100.0, float(row[3]) / 50.0, float(st[0]), float(st[1]), 0.0, 0.0, int(st[2]), int(st[3])])
		snaps.append([t, {"t": "snap", "pt": float(s[1]) / 10.0, "b": rows}])
	for e in d.evs:
		evs.append([float(e[0]) / 1000.0, e[1]])
