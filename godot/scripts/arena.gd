class_name Arena
extends Node3D
# The 25x25 tile arena, built from the map grid. Same tile letters and collision rules as
# src/arena.js, so the local prediction agrees with the server (which refuses illegal moves).
# Static tiles are MultiMeshes: one draw call per tile kind, which is what keeps mobile GPUs cool.

var map: Dictionary
var grid: Array = []          # Array of Strings, [j][i]
var spawns: Array[Vector3] = []
var _inst: Dictionary = {}    # tile index -> [MultiMesh, instance]

func build(map_data: Dictionary) -> void:
	map = map_data
	for row in map.grid:
		grid.append(String(row))
	var walls: Array = []; var bounds: Array = []; var bushes: Array = []; var props: Array = []
	var crates: Array = []; var water: Array = []
	for j in GameData.N:
		for i in GameData.N:
			var ch := tile(i, j)
			if ch == "S":
				spawns.append(center(i, j))
				_put(i, j, ".")
				continue
			match ch:
				"#": walls.append(Vector2i(i, j))
				"X": bounds.append(Vector2i(i, j))
				"B": bushes.append(Vector2i(i, j))
				"C": crates.append(Vector2i(i, j))
				"W": water.append(Vector2i(i, j))
				"K", "T", "G", "E", "M": props.append(Vector2i(i, j))
	_ground()
	var sw: Array = map.swatch
	var wall_col := GameData.color_of(map.wallCap)
	var bound_col := GameData.color_of(map.boundCap)
	_multi("wall", walls, BoxMesh.new(), Vector3(1.98, 2.0, 1.98), 1.0, wall_col)
	_multi("bound", bounds, BoxMesh.new(), Vector3(1.99, 2.4, 1.99), 1.2, bound_col)
	_multi("crate", crates, BoxMesh.new(), Vector3(1.4, 1.4, 1.4), 0.7, Color("d9a441"))
	_multi("prop", props, CylinderMesh.new(), Vector3(1.1, 2.2, 1.1), 1.1, Color(sw[1]).darkened(0.35))
	var bush_mesh := SphereMesh.new()
	_multi("bush", bushes, bush_mesh, Vector3(1.9, 1.5, 1.9), 0.75, Color(sw[1]).darkened(0.1))
	_water(water)

func center(i: int, j: int) -> Vector3:
	return Vector3((i - (GameData.N - 1) / 2.0) * GameData.TILE, 0.0, (j - (GameData.N - 1) / 2.0) * GameData.TILE)

func to_tile(x: float) -> int:
	return int(floor(x / GameData.TILE + GameData.N / 2.0))

func tile(i: int, j: int) -> String:
	if i < 0 or j < 0 or i >= GameData.N or j >= GameData.N:
		return "X"
	return grid[j][i]

func char_at(x: float, z: float) -> String:
	return tile(to_tile(x), to_tile(z))

func blocks_move(i: int, j: int) -> bool:
	return GameData.MOVE_BLOCK.contains(tile(i, j))

func is_bush(x: float, z: float) -> bool:
	return char_at(x, z) == "B"

func is_ice(x: float, z: float) -> bool:
	return char_at(x, z) == "I"

func break_tile(i: int, j: int) -> void:
	_put(i, j, ".")
	var key := j * GameData.N + i
	if _inst.has(key):
		var mm: MultiMesh = _inst[key][0]
		mm.set_instance_transform(_inst[key][1], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
		_inst.erase(key)

# Circle vs. blocked tiles: push the position out of every solid tile around it.
func collide_circle(p: Vector3, r: float) -> Vector3:
	var lim := GameData.HALF - r
	p.x = clampf(p.x, -lim, lim)
	p.z = clampf(p.z, -lim, lim)
	var ci := to_tile(p.x); var cj := to_tile(p.z)
	for dj in range(-1, 2):
		for di in range(-1, 2):
			var i := ci + di; var j := cj + dj
			if not blocks_move(i, j):
				continue
			var c := center(i, j)
			var h := GameData.TILE / 2.0
			var nx := clampf(p.x, c.x - h, c.x + h)
			var nz := clampf(p.z, c.z - h, c.z + h)
			var dx := p.x - nx; var dz := p.z - nz
			var d2 := dx * dx + dz * dz
			if d2 >= r * r:
				continue
			if d2 > 1e-6:
				var d := sqrt(d2)
				p.x = nx + dx / d * r
				p.z = nz + dz / d * r
			else: # centre inside the tile: leave through the nearest face
				var ex := h - absf(p.x - c.x); var ez := h - absf(p.z - c.z)
				if ex < ez:
					p.x += signf(p.x - c.x) * (ex + r)
				else:
					p.z += signf(p.z - c.z) * (ez + r)
	return p

func _put(i: int, j: int, ch: String) -> void:
	grid[j] = String(grid[j]).substr(0, i) + ch + String(grid[j]).substr(i + 1)

func _mat(col: Color, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	return m

func _ground() -> void:
	var tones: Array = map.groundTones if map.groundTones else [map.swatch[0], Color(map.swatch[0]).darkened(0.06).to_html()]
	var plane := PlaneMesh.new()
	plane.size = Vector2(GameData.N * GameData.TILE, GameData.N * GameData.TILE)
	var mi := MeshInstance3D.new()
	mi.mesh = plane
	mi.material_override = _mat(Color(tones[0]))
	add_child(mi)
	var outer := MeshInstance3D.new()
	var op := PlaneMesh.new()
	op.size = Vector2(300, 300)
	outer.mesh = op
	outer.position.y = -0.05
	outer.material_override = _mat(Color(map.swatch[1]).darkened(0.3))
	add_child(outer)

func _water(tiles: Array) -> void:
	if tiles.is_empty():
		return
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.25, 0.6, 0.85, 0.75)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.15
	_multi("water", tiles, PlaneMesh.new(), Vector3(2.0, 1.0, 2.0), 0.02, Color.WHITE, m)

func _multi(_kind: String, tiles: Array, mesh: Mesh, size: Vector3, y: float, col: Color, mat: Material = null) -> void:
	if tiles.is_empty():
		return
	if mesh is BoxMesh:
		mesh.size = Vector3.ONE
	elif mesh is CylinderMesh or mesh is SphereMesh:
		mesh.radial_segments = 12
		mesh.rings = 6 if mesh is SphereMesh else 1
		if mesh is CylinderMesh:
			mesh.top_radius = 0.5
			mesh.bottom_radius = 0.5
			mesh.height = 1.0
		else:
			mesh.radius = 0.5
			mesh.height = 1.0
	mesh.material = mat if mat else _mat(col)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = tiles.size()
	for k in tiles.size():
		var t: Vector2i = tiles[k]
		var b := Basis.from_scale(size)
		mm.set_instance_transform(k, Transform3D(b, center(t.x, t.y) + Vector3(0, y, 0)))
		_inst[t.y * GameData.N + t.x] = [mm, k]
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	add_child(mmi)
