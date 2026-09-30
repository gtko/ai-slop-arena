class_name Arena
extends Node3D
# The 25x25 tile arena, built from the map grid. Same tile letters and collision rules as
# src/arena.js, so the local prediction agrees with the server (which refuses illegal moves).
# Static tiles are MultiMeshes: one draw call per tile kind, which is what keeps mobile GPUs cool.

var map: Dictionary
var grid: Array = []          # Array of Strings, [j][i]
var spawns: Array[Vector3] = []

const WALL_PROP := {"strata": "wall_canyon", "strataDark": "wall_canyon", "mossbrick": "wall_moss", "stone": "wall_moss", "icestone": "wall_ice", "brick": "wall_canyon"}
const TREE_PROP := {"round": "tree_round", "pine": "tree_pine", "dead": "tree_dead", "cactus": "cactus", "cliff": "rock_canyon"}
const TREE_FIT := {"round": {"height": 4.6}, "pine": {"height": 5.4}, "dead": {"height": 4.4}, "cactus": {"height": 2.8}, "cliff": {"height": 3.2}}
const OBSTACLE_PROP := {"cactus": "cactus", "stump": "stump", "boulder": "boulder", "rock": "boulder"}
const WALL_H := 2.1
const BOUND_H := 2.7

var rng := RandomNumberGenerator.new()
var sails: Node3D
var _hidden: Dictionary = {}   # tile key -> Array of [MultiMesh, index]
var _decor: Array = []

func build(map_data: Dictionary) -> void:
	map = map_data
	rng.seed = 1337
	for row in map.grid:
		grid.append(String(row))
	var kinds := {}
	for j in GameData.N:
		for i in GameData.N:
			var ch := tile(i, j)
			if ch == "S":
				spawns.append(center(i, j))
				_put(i, j, ".")
				continue
			if not kinds.has(ch):
				kinds[ch] = []
			kinds[ch].append(Vector2i(i, j))
	_ground(kinds)
	_walls(kinds)
	_bushes(kinds.get("B", []))
	_obstacles(kinds.get("K", []))
	_crates(kinds.get("C", []), kinds.get("E", []))
	_lanterns(kinds.get("T", []))
	_kit(kinds)
	_windmill()
	if not map.get("sky", false):
		_decor_ring()

func _snowy(prop: String) -> String:
	return prop + "_snow" if map.get("snow", false) and PropLib.has(prop + "_snow") else prop

func _place(prop: String, fit: Dictionary, tiles: Array, jitter := 0.0, shadows := true, tint_ground := 0.0) -> void:
	var list: Array = []
	for t in tiles:
		var pos := center(t.x, t.y)
		list.append({"pos": pos, "yaw": rng.randf() * TAU, "mul": 1.0 + rng.randf() * jitter})
	var mmi := PropLib.multi(prop, fit, list, shadows)
	if mmi == null:
		return
	add_child(mmi)
	for k in tiles.size():
		var key: int = tiles[k].y * GameData.N + tiles[k].x
		if not _hidden.has(key):
			_hidden[key] = []
		_hidden[key].append([mmi.multimesh, k])

func _walls(kinds: Dictionary) -> void:
	var wall_prop: String = WALL_PROP.get(map.get("wall", ""), "")
	var bound_prop: String = WALL_PROP.get(map.get("bound", ""), "")
	var wall_col := GameData.color_of(map.get("wallCap", 0xcccccc))
	var bound_col := GameData.color_of(map.get("boundCap", 0x888888))
	_wall_kind(kinds.get("#", []), wall_prop, Vector3(1.98, WALL_H, 1.98), wall_col, false)
	_wall_kind(kinds.get("X", []), bound_prop, Vector3(1.99, BOUND_H, 1.99), bound_col, true)

func _wall_kind(tiles: Array, prop: String, box: Vector3, col: Color, bound: bool) -> void:
	if tiles.is_empty():
		return
	if prop != "" and PropLib.has(prop):
		var list: Array = []
		for t in tiles:
			list.append({"pos": center(t.x, t.y), "yaw": floorf(rng.randf() * 4.0) * PI / 2.0})
		var mmi := PropLib.multi(prop, {"box": box}, list)
		add_child(mmi)
		for k in tiles.size():
			_reg(tiles[k], mmi.multimesh, k)
	else:
		_multi_box(tiles, box, col)

func _reg(t: Vector2i, mm: MultiMesh, k: int) -> void:
	var key := t.y * GameData.N + t.x
	if not _hidden.has(key):
		_hidden[key] = []
	_hidden[key].append([mm, k])

func _multi_box(tiles: Array, size: Vector3, col: Color) -> void:
	var mesh := BoxMesh.new()
	mesh.size = Vector3.ONE
	mesh.material = _mat(col)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = tiles.size()
	for k in tiles.size():
		mm.set_instance_transform(k, Transform3D(Basis.from_scale(size), center(tiles[k].x, tiles[k].y) + Vector3(0, size.y / 2.0, 0)))
		_reg(tiles[k], mm, k)
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	add_child(mmi)

func _bushes(tiles: Array) -> void:
	if tiles.is_empty():
		return
	if PropLib.has("bush"):
		var list: Array = []
		for t in tiles:
			list.append({"pos": center(t.x, t.y), "yaw": rng.randf() * TAU, "mul": 1.0 + rng.randf() * 0.12})
		var mmi := PropLib.multi("bush", {"width": 1.95}, list, false)
		add_child(mmi)
		for k in tiles.size():
			_reg(tiles[k], mmi.multimesh, k)
	else:
		_multi_box(tiles, Vector3(1.9, 1.4, 1.9), Color("4f9a2e"))

func _obstacles(tiles: Array) -> void:
	if tiles.is_empty():
		return
	var name: String = _snowy(OBSTACLE_PROP.get(map.get("obstacle", "boulder"), "boulder"))
	var fit := {"height": 2.3} if name == "cactus" else {"width": 1.75}
	if PropLib.has(name):
		_place(name, fit, tiles, 0.2)
	else:
		_multi_box(tiles, Vector3(1.4, 1.6, 1.4), Color("7a6a5a"))

func _crates(crates: Array, barrels: Array) -> void:
	if not crates.is_empty():
		if PropLib.has("crate"):
			_place("crate", {"width": 1.75}, crates)
		else:
			_multi_box(crates, Vector3(1.7, 1.45, 1.7), Color("d9a441"))
	if not barrels.is_empty():
		var mesh := CylinderMesh.new()
		mesh.top_radius = 0.6; mesh.bottom_radius = 0.6; mesh.height = 1.4
		mesh.material = _mat(Color("d9502a"))
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = barrels.size()
		for k in barrels.size():
			mm.set_instance_transform(k, Transform3D(Basis.IDENTITY, center(barrels[k].x, barrels[k].y) + Vector3(0, 0.7, 0)))
			_reg(barrels[k], mm, k)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		add_child(mmi)

func _lanterns(tiles: Array) -> void:
	for t in tiles:
		var pos := center(t.x, t.y)
		if PropLib.has("lantern"):
			var mmi := PropLib.multi("lantern", {"height": 2.4}, [{"pos": pos, "yaw": rng.randf() * TAU}], false)
			add_child(mmi)
			_reg(t, mmi.multimesh, 0)
		var light := OmniLight3D.new()
		light.position = pos + Vector3(0, 2.0, 0)
		light.light_color = Color(1.0, 0.75, 0.4)
		light.omni_range = 6.0
		light.light_energy = 1.2
		light.shadow_enabled = false
		if not OS.get_cmdline_user_args().has("--nolight"):
			add_child(light)

# Map kit (v0.15): bridges, jump pads, healing mushrooms.
func _kit(kinds: Dictionary) -> void:
	_flat(kinds.get("=", []), Color("9b6b3c"), 0.12, 1.9, 0.06)
	_flat(kinds.get("J", []), Color("3fd8e8"), 0.05, 1.5, 0.05, true)
	for t in kinds.get("H", []):
		var stem := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.22; cm.bottom_radius = 0.3; cm.height = 0.7
		cm.material = _mat(Color("f5e6d0"))
		stem.mesh = cm
		stem.position = center(t.x, t.y) + Vector3(0, 0.35, 0)
		add_child(stem)
		var cap := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.7; sm.height = 0.9
		sm.material = _mat(Color("e64980"))
		cap.mesh = sm
		cap.position = center(t.x, t.y) + Vector3(0, 0.95, 0)
		add_child(cap)

func _flat(tiles: Array, col: Color, y: float, size: float, thick: float, glow := false) -> void:
	if tiles.is_empty():
		return
	var mesh := BoxMesh.new()
	mesh.size = Vector3(size, thick, size)
	var m := _mat(col)
	if glow:
		m.emission_enabled = true
		m.emission = col
		m.emission_energy_multiplier = 1.2
	mesh.material = m
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = tiles.size()
	for k in tiles.size():
		mm.set_instance_transform(k, Transform3D(Basis.IDENTITY, center(tiles[k].x, tiles[k].y) + Vector3(0, y, 0)))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	add_child(mmi)

# The windmill of Windmill Isles: a square of 'M' tiles drawn as one tower with turning sails.
func _windmill() -> void:
	for j in GameData.N - 1:
		for i in GameData.N - 1:
			if tile(i, j) != "M" or tile(i - 1, j) == "M" or tile(i, j - 1) == "M":
				continue
			var n := 1
			while tile(i + n, j) == "M":
				n += 1
			var c := center(i, j) + Vector3(GameData.TILE * (n - 1) / 2.0, 0, GameData.TILE * (n - 1) / 2.0)
			var w := n * GameData.TILE * 0.82
			var tower := PropLib.single("windmill", {"width": w})
			var sail := PropLib.single("windmill_sails", {"width": w * 1.4})
			if tower == null or sail == null:
				_multi_box([Vector2i(i, j)], Vector3(GameData.TILE * n, 5.0, GameData.TILE * n), Color("ece2cf"))
				continue
			var info := PropLib.info("windmill")
			var sc := PropLib.scale_for(info.size, {"width": w})
			var h: float = info.size.y * sc.y
			var d: float = info.size.z * sc.z / 2.0
			var g := Node3D.new()
			g.position = c
			g.add_child(tower)
			sails = Node3D.new()
			sails.position = Vector3(0, h * 0.68, d * 0.95)
			var sinfo := PropLib.info("windmill_sails")
			var ssc := PropLib.scale_for(sinfo.size, {"width": w * 1.4})
			sail.position = -Vector3(0, sinfo.size.y * ssc.y / 2.0, 0)
			sails.add_child(sail)
			g.add_child(sails)
			add_child(g)

func update(delta: float) -> void:
	if sails:
		sails.rotation.z += delta * 0.6

# The ring of trees / rocks around the arena, one MultiMesh per kind.
func _decor_ring() -> void:
	var kinds: Array = map.get("trees", {}).keys()
	if kinds.is_empty():
		return
	var weights: Array = map.trees.values()
	var by_kind := {}
	var n := GameData.N
	for j in range(-6, n + 6):
		for i in range(-6, n + 6):
			if i >= 0 and j >= 0 and i < n and j < n:
				continue
			var out: int = maxi(maxi(-i, -j), maxi(i - (n - 1), j - (n - 1)))
			if rng.randf() >= (0.75 if out == 1 else 0.45):
				continue
			var r := rng.randf()
			var kind: String = kinds[0]
			for k in kinds.size():
				r -= float(weights[k])
				if r <= 0.0:
					kind = kinds[k]
					break
			var low := 0.45 if j >= n and j <= n + 1 else 1.0
			var pos := center(i, j) + Vector3((rng.randf() - 0.5) * 1.4, 0, (rng.randf() - 0.5) * 1.4)
			var mul := (0.8 + rng.randf() * 0.5) * low
			if kind == "cliff":
				mul *= 1.2 + rng.randf() * 0.9
			if not by_kind.has(kind):
				by_kind[kind] = []
			by_kind[kind].append({"pos": pos, "yaw": rng.randf() * TAU, "mul": mul, "ysq": 0.9 + rng.randf() * 0.25})
	for kind in by_kind:
		var prop := _snowy(TREE_PROP.get(kind, "tree_round"))
		var mmi := PropLib.multi(prop, TREE_FIT.get(kind, {"height": 4.6}), by_kind[kind], false)
		if mmi:
			add_child(mmi)
			_decor.append(mmi)

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
	if _hidden.has(key):
		for e in _hidden[key]:
			e[0].set_instance_transform(e[1], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
		_hidden.erase(key)

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

func _ground(kinds: Dictionary) -> void:
	var swatch: Array = map.get("swatch", ["#cccccc", "#88aa88"])
	var tones: Array = map.get("groundTones", null) if map.get("groundTones", null) else [swatch[0], Color(swatch[0]).darkened(0.06).to_html()]
	var solid: Array = []
	var alt: Array = []
	var water: Array = kinds.get("W", [])
	var ice: Array = kinds.get("I", [])
	for j in GameData.N:
		for i in GameData.N:
			var ch := tile(i, j)
			if ch == "V" or ch == "W" or ch == "S":
				continue
			((alt) if (i + j) % 2 == 1 else solid).append(Vector2i(i, j))
	_flat_tiles(solid, Color(tones[0]), -0.02)
	_flat_tiles(alt, Color(tones[1]), -0.02)
	_flat_tiles(ice, Color(0.7, 0.88, 1.0), 0.0)
	if not water.is_empty():
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.25, 0.6, 0.85, 0.8) if map.get("water", "water") != "swamp" else Color(0.3, 0.42, 0.28, 0.85)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.roughness = 0.15
		_flat_tiles(water, Color.WHITE, -0.25, m)
	if not map.get("sky", false):
		var outer := MeshInstance3D.new()
		var op := PlaneMesh.new()
		op.size = Vector2(300, 300)
		outer.mesh = op
		outer.position.y = -0.08
		var oc := Color(map.get("groundTones", [swatch[1]])[0]) if map.get("outer", "") == "" else Color(swatch[1])
		outer.material_override = _mat(Color(swatch[1]).darkened(0.25) if map.get("outer", "") != "snow" else Color("eef4ff"))
		add_child(outer)

func _flat_tiles(tiles: Array, col: Color, y: float, mat: Material = null) -> void:
	if tiles.is_empty():
		return
	var mesh := PlaneMesh.new()
	mesh.size = Vector2(GameData.TILE, GameData.TILE)
	mesh.material = mat if mat else _mat(col)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = tiles.size()
	for k in tiles.size():
		mm.set_instance_transform(k, Transform3D(Basis.IDENTITY, center(tiles[k].x, tiles[k].y) + Vector3(0, y, 0)))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
