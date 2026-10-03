class_name IceWalls
extends Node3D
# Frostbite's Ice Wall gadget (src/arena.js iceWall): the server's 'ice' event lists the tiles; each
# becomes a block of ice for 3 s that grows in (0.15 s) and melts away (the last 0.3 s). While it
# stands, the tile is 'G' in the client's grid too, so the shots drawn here stop on it like the
# server's (fx_combat.gd).

const LIFE := 3.0
static var _mesh: BoxMesh
static var _mat: StandardMaterial3D

var arena: Arena
var _walls: Array = []   # {i, j, was, mi, t}

static func add_to(a: Arena, tiles: Array) -> void:
	var w: IceWalls = a.get_node_or_null("IceWalls")
	if w == null:
		w = IceWalls.new()
		w.name = "IceWalls"
		w.arena = a
		a.add_child(w)
	w.place(tiles)

func place(tiles: Array) -> void:
	if _mesh == null:
		_mesh = BoxMesh.new()
		_mesh.size = Vector3(GameData.TILE * 0.96, 1.9, GameData.TILE * 0.96)
		_mat = StandardMaterial3D.new()
		_mat.albedo_color = Color(Color("bfe8ff"), 0.8)
		_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_DEPTH_PRE_PASS
		_mat.roughness = 0.08
		_mat.metallic = 0.1
		_mat.emission_enabled = true
		_mat.emission = Color("2a6f9a")
		_mat.emission_energy_multiplier = 0.5
	for t in tiles:
		var i := int(t[0])
		var j := int(t[1])
		var was := arena.tile(i, j)
		if was == "G":
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = _mesh
		mi.material_override = _mat
		mi.position = arena.center(i, j) + Vector3(0, 0.95, 0)
		mi.scale = Vector3(1, 0.01, 1)
		add_child(mi)
		arena.set_tile(i, j, "G")
		_walls.append({"i": i, "j": j, "was": was, "mi": mi, "t": LIFE})

func _process(delta: float) -> void:
	for k in range(_walls.size() - 1, -1, -1):
		var w: Dictionary = _walls[k]
		w.t -= delta
		(w.mi as MeshInstance3D).scale.y = clampf(minf((LIFE - float(w.t)) / 0.15, float(w.t) / 0.3), 0.01, 1.0)
		if float(w.t) > 0.0:
			continue
		(w.mi as MeshInstance3D).queue_free()
		if arena.tile(int(w.i), int(w.j)) == "G":
			arena.set_tile(int(w.i), int(w.j), String(w.was))
		_walls.remove_at(k)
