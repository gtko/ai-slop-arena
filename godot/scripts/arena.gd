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
var _decor: Array = []         # [MultiMeshInstance3D, full instance count]
# world (godot/scripts: kit, lighting, weather, water, ambient, skins): all children of the arena, so
# they are freed with it and need no wiring in main.gd
var kit: Kit
var lighting: Lighting
var weather: Weather
var water: Water
var ambient: Ambient
var skins: Skins
var items: Items
var ground_mats: Array = []          # the two floor tones (crumbling islands reuse them)
var _ground_slots: Dictionary = {}   # tile key -> [MultiMesh, index]

func build(map_data: Dictionary) -> void:
	map = map_data
	items = Items.new()   # power cubes on the ground ('item' / 'pick' events)
	add_child(items)
	Foliage.ensure_globals() # the world shaders read global parameters (wind, reveal, rim, sky)
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
	_world()

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
		# arena.js buildWalls: each block a slightly different grey, the outer ring reads darker
		var mm := mmi.multimesh
		var xfs: Array = []
		for k in tiles.size():
			xfs.append(mm.get_instance_transform(k))
		mm.instance_count = 0
		mm.use_colors = true
		mm.instance_count = tiles.size()
		for k in tiles.size():
			mm.set_instance_transform(k, xfs[k])
			var v := (0.62 + rng.randf() * 0.08) if bound else (0.9 + rng.randf() * 0.12)
			mm.set_instance_color(k, Color(v, v, v).srgb_to_linear())
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

# arena.js buildBushes: tall grass tufts on the maps with bushStyle "grass" (Dune Storm, Oasis),
# else the sculpted leaf ball. Tinted per instance like the web (HSL), swaying, dissolving around the
# player hidden inside (foliage.gd).
func _bushes(tiles: Array) -> void:
	if tiles.is_empty():
		return
	var grass: bool = String(map.get("bushStyle", "")) == "grass"
	var hsl: Array = map.get("bush", [0.3, 0.45, 0.72])
	var mesh: Mesh = null
	var mat: Material = null
	var list: Array = []
	if grass:
		mesh = Foliage.grass_tuft_mesh(3)
		mat = Foliage.grass_material()
	elif PropLib.has("bush"):
		mesh = PropLib.info("bush").mesh
		mat = Foliage.material_for("bush", 1.0, true, map.get("snow", false))
	else:
		_multi_box(tiles, Vector3(1.9, 1.4, 1.9), Color("4f9a2e"))
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = tiles.size()
	var info := PropLib.info("bush") if not grass else {}
	for k in tiles.size():
		var t: Vector2i = tiles[k]
		var yaw := rng.randf() * TAU
		var sc := 1.0 + rng.randf() * 0.12
		var ysc := 0.92 + rng.randf() * 0.16
		var xf: Transform3D
		if grass:
			xf = Transform3D(Basis(Vector3.UP, yaw) * Basis.from_scale(Vector3(sc, sc * ysc, sc)), center(t.x, t.y))
		else:
			xf = PropLib.placement(info, {"width": 1.95}, center(t.x, t.y), yaw, sc, ysc)
		mm.set_instance_transform(k, xf)
		var c := Color.from_hsv(0.0, 0.0, 0.88 + rng.randf() * 0.14) if not grass else _hsl(float(hsl[0]) + rng.randf() * 0.04, float(hsl[1]), float(hsl[2]) + rng.randf() * 0.2)
		mm.set_instance_color(k, c.srgb_to_linear())
		_reg(t, mm, k)
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = mat
	add_child(mmi)

# three's Color.setHSL (lightness clamped to 1)
static func _hsl(h: float, s: float, l: float) -> Color:
	h = fposmod(h, 1.0)
	l = clampf(l, 0.0, 1.0)
	s = clampf(s, 0.0, 1.0)
	if s == 0.0:
		return Color(l, l, l)
	var q := l * (1.0 + s) if l <= 0.5 else l + s - l * s
	var p := 2.0 * l - q
	return Color(_hue(p, q, h + 1.0 / 3.0), _hue(p, q, h), _hue(p, q, h - 1.0 / 3.0))

static func _hue(p: float, q: float, t: float) -> float:
	t = fposmod(t, 1.0)
	if t < 1.0 / 6.0:
		return p + (q - p) * 6.0 * t
	if t < 0.5:
		return q
	if t < 2.0 / 3.0:
		return p + (q - p) * 6.0 * (2.0 / 3.0 - t)
	return p

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
		_crate_gems(crates)
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

# arena.js buildTorches: a tall lantern on each 'T' tile, small ones on top of the outer walls (3 per
# side), each with an orange point light and a soft additive halo. Lights: see _glow.
func _lanterns(tiles: Array) -> void:
	var tall: Array = []
	for t in tiles:
		var pos := center(t.x, t.y)
		tall.append({"pos": pos, "yaw": rng.randf() * TAU})
		_torch(pos + Vector3(0, 2.4 * 0.72, 0), t)
	var small: Array = []
	if not map.get("sky", false):
		for k in [6, 12, 18]:
			for ij in [[0, k], [GameData.N - 1, k], [k, 0], [k, GameData.N - 1]]:
				var pos := center(ij[0], ij[1]) + Vector3(0, BOUND_H, 0)
				small.append({"pos": pos, "yaw": rng.randf() * TAU})
				_torch(pos + Vector3(0, 1.3 * 0.72, 0), Vector2i(ij[0], ij[1]))
	if not PropLib.has("lantern"):
		return
	if not tall.is_empty():
		var mmi := PropLib.multi("lantern", {"height": 2.4}, tall)
		add_child(mmi)
		for k in tiles.size():
			_reg(tiles[k], mmi.multimesh, k)
	if not small.is_empty():
		var mmi := PropLib.multi("lantern", {"height": 1.3}, small, Quality.preset().ring >= 1.0)
		add_child(mmi)

# Point lights of the world, lit by the nearest-first budget of _glow (the web's LightPool):
# [light, base intensity, + at night, flicker phase or -1, tile key]
var _lights: Array = []
var _halos: Array = []        # [MeshInstance3D, StandardMaterial3D, flicker phase]
var _gems: MultiMesh
var _gem_xf: Array = []        # [position, tile key]
var _glow_t := 0.0
static var _halo_tex: Texture2D

func _point_light(pos: Vector3, col: Color, rng_m: float, base: float, night: float, ph: float, t: Vector2i) -> void:
	if DebugArgs.has("nolight"):
		return
	var light := OmniLight3D.new()
	light.position = pos
	light.light_color = col.linear_to_srgb()
	light.omni_range = rng_m
	light.omni_attenuation = 2.0 # three's decay 2
	light.light_energy = 0.0
	light.shadow_enabled = false
	light.visible = false
	add_child(light)
	_lights.append([light, base, night, ph, t.y * GameData.N + t.x])

# A lantern: its light (three intensity 22 * (0.03 + 0.97 night), range 10) and its halo sprite.
func _torch(pos: Vector3, t: Vector2i) -> void:
	var ph := rng.randf() * 10.0
	_point_light(pos, Color(1.0, 0.5, 0.18), 10.0, 22.0 * 0.03, 22.0 * 0.97, ph, t)
	if _halo_tex == null:
		var g := Gradient.new()
		g.set_color(0, Color(1.0, 190.0 / 255.0, 110.0 / 255.0, 0.85))
		g.add_point(0.55, Color(1.0, 165.0 / 255.0, 80.0 / 255.0, 0.51))
		g.set_color(g.get_point_count() - 1, Color(1.0, 140.0 / 255.0, 50.0 / 255.0, 0.0))
		var gt := GradientTexture2D.new()
		gt.gradient = g
		gt.fill = GradientTexture2D.FILL_RADIAL
		gt.fill_from = Vector2(0.5, 0.5)
		gt.fill_to = Vector2(1.0, 0.5)
		gt.width = 64
		gt.height = 64
		_halo_tex = gt
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_texture = _halo_tex
	m.albedo_color = Color("ffb070")
	m.no_depth_test = false
	var q := QuadMesh.new()
	q.size = Vector2.ONE
	var mi := MeshInstance3D.new()
	mi.mesh = q
	mi.material_override = m
	mi.position = pos
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	_halos.append([mi, m, ph])

# The power cube floating over each crate (arena.js makeCrate): a glowing green gem, spinning, with
# a green light (0.8 + 2.5 night, range 5).
func _crate_gems(crates: Array) -> void:
	if crates.is_empty():
		return
	var top := 1.5
	if PropLib.has("crate"):
		var info := PropLib.info("crate")
		top = float(info.size.y) * PropLib.scale_for(info.size, {"width": 1.75}).y
	var box := BoxMesh.new()
	box.size = Vector3(0.5, 0.5, 0.5)
	var m := StandardMaterial3D.new()
	m.albedo_color = Color("3dff7a")
	m.emission_enabled = true
	m.emission = Color("22ff66")
	m.emission_energy_multiplier = 1.1
	m.roughness = 0.3
	box.material = m
	_gems = MultiMesh.new()
	_gems.transform_format = MultiMesh.TRANSFORM_3D
	_gems.mesh = box
	_gems.instance_count = crates.size()
	for k in crates.size():
		var t: Vector2i = crates[k]
		var pos := center(t.x, t.y) + Vector3(0, top + 0.1, 0)
		_gem_xf.append(pos)
		_gems.set_instance_transform(k, Transform3D(Basis.IDENTITY, pos))
		_reg(t, _gems, k)
		_point_light(Vector3(pos.x, 2.6, pos.z), Color(0.3, 1.0, 0.45), 5.0, 0.8, 2.5, -1.0, t)
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = _gems
	add_child(mmi)

# Lantern flicker, halos, spinning gems and the light budget (arena.js update / emit, effects.js
# LightPool): every light is scored by intensity * range / (6 + distance to the camera focus), fading
# out from 22 to 30 m, and only the best few are on (see budget).
func _glow(delta: float) -> void:
	_glow_t += delta
	var t := _glow_t
	var night := float(lighting.state.get("night", 0.0)) if lighting else 0.0
	var m := get_parent()
	var focus: Vector3 = m.get("cam_focus") if m and m.get("cam_focus") != null else Vector3.ZERO
	var q := Quality.preset()
	# the Mobile renderer lights a mesh (the whole floor is one) with 8 omni lights at most, and
	# fx.gd keeps a pool of its own (4 on High, 2 on Medium, none on Low)
	var budget := int(q.get("alights", 4))   # Quality: 4 on High, 3 on Medium, 2 on Low
	var ranked: Array = []
	for e in _lights:
		if not is_instance_valid(e[0]):
			continue
		var l: OmniLight3D = e[0]
		var ph: float = e[3]
		var f := 0.85 + 0.15 * sin(t * 13.0 + ph) * sin(t * 7.3 + ph * 2.0) if ph >= 0.0 else 1.0
		var i := (float(e[1]) + float(e[2]) * night) * f
		var p := l.position
		var d := Vector2(p.x - focus.x, (p.z - focus.z) * 1.2).length()
		i *= 1.0 - smoothstep(22.0, 30.0, d)
		ranked.append([i * l.omni_range / (6.0 + d), l, i])
	ranked.sort_custom(func(a, b): return a[0] > b[0])
	for k in ranked.size():
		var l: OmniLight3D = ranked[k][1]
		var i: float = ranked[k][2]
		l.visible = k < budget and i > 0.02
		l.light_energy = i / PI
	var glow := 0.25 + 0.75 * night
	for h in _halos:
		var ph: float = h[2]
		var f := 0.85 + 0.15 * sin(t * 13.0 + ph) * sin(t * 7.3 + ph * 2.0)
		(h[0] as MeshInstance3D).scale = Vector3.ONE * (1.6 + glow * 1.2 * f)
		(h[1] as StandardMaterial3D).albedo_color.a = glow * (0.7 + 0.3 * f)
	if _gems:
		var b := Basis(Vector3.UP, t * 1.2) * Basis.from_euler(Vector3(PI / 4.0, PI / 4.0, 0.0))
		for k in _gem_xf.size():
			if _gems.get_instance_transform(k).basis.get_scale().x > 0.01:
				_gems.set_instance_transform(k, Transform3D(b, _gem_xf[k]))

# A crate or lantern that breaks takes its light with it.
func _drop_lights(key: int) -> void:
	for e in _lights.filter(func(x): return int(x[4]) == key):
		if is_instance_valid(e[0]):
			(e[0] as OmniLight3D).queue_free()
		_lights.erase(e)

# Map kit (v0.15): bridges, jump pads, healing mushrooms, sky islands (kit.gd).
func _kit(kinds: Dictionary) -> void:
	kit = Kit.new()
	add_child(kit)
	kit.build(self, kinds)

# Lighting, weather, water surface, fauna and cosmetics, then the quality preset.
func _world() -> void:
	if Quality.main_node() == null or get_parent() == null or get_parent().get("sun") == null:
		return # headless unit tests build a bare arena
	lighting = Lighting.new()
	add_child(lighting)
	lighting.setup(self, map)
	weather = Weather.new()
	add_child(weather)
	weather.setup(self, String(map.get("weather", "clear")))
	lighting.weather = weather
	ambient = Ambient.new()
	add_child(ambient)
	ambient.setup(self)
	skins = Skins.new()
	add_child(skins)
	if map.get("wet", false):
		_puddles()
	if map.get("stones", false):
		_stones()
	Quality.apply()

func apply_quality() -> void:
	var q := Quality.preset()
	if lighting:
		lighting.apply_quality()
	if weather:
		weather.apply_quality()
	if ambient:
		ambient.apply_quality()
	if water:
		water.apply_quality()
	for d in _decor:
		var mmi: MultiMeshInstance3D = d[0]
		mmi.multimesh.visible_instance_count = int(ceilf(int(d[1]) * float(q.ring)))
		# the web's ring casts shadows down to detail 0.6 (desktop and mobile high)
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if float(q.ring) >= 1.0 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

# Flat pentagon stepping stones with a darker rim on the open floor (arena.js buildStones, Oasis).
func _stones() -> void:
	var spots: Array = []
	for k in 400:
		if spots.size() >= 70:
			break
		var i := rng.randi_range(1, GameData.N - 2)
		var j := rng.randi_range(1, GameData.N - 2)
		if tile(i, j) != ".":
			continue
		var c := center(i, j)
		spots.append([c.x + (rng.randf() - 0.5) * 1.4, c.z + (rng.randf() - 0.5) * 1.4, 0.28 + rng.randf() * 0.3, rng.randf() * TAU])
	if spots.is_empty():
		return
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in 5:
		var a0 := TAU * k / 5.0
		var a1 := TAU * (k + 1) / 5.0
		for v in [Vector3.ZERO, Vector3(cos(a1), 0, -sin(a1)), Vector3(cos(a0), 0, -sin(a0))]:
			st.set_normal(Vector3.UP)
			st.add_vertex(v)
	var plate := st.commit()
	for layer in [[Color("c8704a"), 0.008, 1.18], [Color(map.get("stoneColor", "#f7c48e")), 0.014, 1.0]]:
		var m := _mat(layer[0], 0.9)
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = plate
		mm.instance_count = spots.size()
		for k in spots.size():
			var sp: Array = spots[k]
			var r: float = sp[2] * layer[2]
			mm.set_instance_transform(k, Transform3D(Basis(Vector3.UP, sp[3]) * Basis.from_scale(Vector3(r, 1.0, r * 0.85)), Vector3(sp[0], layer[1] - 0.02, sp[1])))
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = m
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)

# Glossy dark puddles on wet maps (arena.js buildPuddles): mirrors for lanterns, projectiles, lightning.
func _puddles() -> void:
	var spots: Array = []
	for k in 40:
		if spots.size() >= 22:
			break
		var i := rng.randi_range(1, GameData.N - 2)
		var j := rng.randi_range(1, GameData.N - 2)
		if tile(i, j) != ".":
			continue
		var c := center(i, j)
		spots.append([c.x + rng.randf() - 0.5, c.z + rng.randf() - 0.5, 0.5 + rng.randf() * 0.6, rng.randf() * TAU])
	if spots.is_empty():
		return
	var mesh := CylinderMesh.new()
	mesh.top_radius = 1.0
	mesh.bottom_radius = 1.0
	mesh.height = 0.005
	mesh.radial_segments = 20
	mesh.rings = 1
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.14, 0.19, 0.23, 0.5)
	m.roughness = 0.05
	m.metallic = 0.3
	m.metallic_specular = 1.0
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.render_priority = 1
	mesh.material = m
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = spots.size()
	for k in spots.size():
		var sp: Array = spots[k]
		var b := Basis(Vector3.UP, float(sp[3])) * Basis.from_scale(Vector3(float(sp[2]) * 1.4, 1.0, float(sp[2])))
		mm.set_instance_transform(k, Transform3D(b, Vector3(float(sp[0]), 0.014, float(sp[1]))))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
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
	var m := get_parent()
	var fighters: Dictionary = m.get("fighters") if m and m.get("fighters") != null else {}
	var me: Fighter = m.get("me") if m else null
	var focus := me.position if me else Vector3.ZERO
	if kit:
		kit.update(delta, fighters, me)
	if lighting:
		lighting.update(delta)
		_glow(delta)
		for id in fighters:
			lighting.attach_blob(fighters[id])
	if weather:
		weather.update(delta, focus)
	if water:
		water.update(delta)
	if ambient:
		ambient.update(delta, fighters)
	if skins:
		skins.update(delta, fighters, self)
	Foliage.update(delta, me, self)
	if _sim:
		_simulate(delta, fighters, me)

# Test only (`--simkit` after `--`): plays the server's kit events on a timer so the effects can be
# looked at without a match that reaches them: a trap, a barrel blast, a bridge break, a landing, an
# island that shakes at 3 s and drops at 8 s, and the local player teleported onto a jump pad at 4 s.
var _sim := DebugArgs.list().has("--simkit")
var _sim_t := 0.0
var _sim_step := 0

func _simulate(delta: float, fighters: Dictionary, me: Fighter) -> void:
	_sim_t += delta
	var plan := [1.0, 2.0, 3.0, 4.0, 5.0, 40.0]
	if _sim_step >= plan.size() or _sim_t < plan[_sim_step]:
		return
	_sim_step += 1
	match _sim_step:
		1:
			var c := center(12, 8)
			for j in GameData.N:
				for i in GameData.N:
					if tile(i, j) == "E":
						c = center(i, j)
						on_event({"e": "crate", "i": i, "j": j})
						break
			kit.on_event({"e": "kit", "k": "trap", "id": me.id if me else "x", "i": 11, "j": 11})
		2:
			for k in kit.bridges.keys():
				kit.on_event({"e": "kit", "k": "bridge", "i": k % GameData.N, "j": k / GameData.N})
				break
			kit.on_event({"e": "kit", "k": "land", "id": "x", "x": 2.0, "z": 2.0})
		3:
			var tiles: Array = []
			for j in GameData.N:
				for i in GameData.N:
					var ch := tile(i, j)
					var mi := to_tile(me.position.x) if me else 12
					var mj := to_tile(me.position.z) if me else 12
					if ch != "V" and ch != "=" and ch != "X" and absi(i - mi) <= 3 and absi(j - mj) <= 4 and (absi(i - mi) > 1 or absi(j - mj) > 1):
						tiles.append([i, j])
			_sim_tiles = tiles
			kit.on_event({"e": "kit", "k": "doom", "t": tiles})
		4:
			if me and not kit.pads.is_empty():
				me.position = Vector3(kit.pads[0].x, 0, kit.pads[0].z)
				print("SIM pad start ", me.position, " dist ", kit.pads[0].dist)
		5:
			if me:
				print("SIM pad mid ", me.position, " dash ", kit.dash)
		6:
			kit.on_event({"e": "kit", "k": "crumble", "t": _sim_tiles})
			if me:
				print("SIM after ", me.position)

var _sim_tiles: Array = []

# The local player's movement when the world matters: ice (momentum), jump pads and their flight.
# Returns true when it moved `me` itself (main.gd then skips its plain walk).
func world_step(me: Fighter, mv: Vector2, delta: float) -> bool:
	return kit != null and kit.step_local(me, mv, delta)

# Every server event goes through here first (main.gd): kit events, barrel blasts, wall / crate
# debris, ring-out falls, K.O. effects.
func on_event(e: Dictionary) -> void:
	var fighters: Dictionary = get_parent().get("fighters")
	match String(e.get("e", "")):
		"kit":
			kit.on_event(e)
		"wall":
			var c := center(int(e.i), int(e.j))
			WorldFx.debris(self, Vector3(c.x, 1.0, c.z), GameData.color_of(map.get("debris", 0x9a8a70)), 12, 0.3, 6.0)
			WorldFx.dust(self, c.x, c.z, 8, Color("c8b8a0"), 1.2)
		"crate":
			var c := center(int(e.i), int(e.j))
			if tile(int(e.i), int(e.j)) == "E":
				kit.barrel_fx(int(e.i), int(e.j))
			else:   # game.js crateFx: wood, dust, green sparks and a flash on the freed cube
				WorldFx.debris(self, Vector3(c.x, 0.8, c.z), Color("c98a2e"), 9, 0.26, 5.0)
				WorldFx.dust(self, c.x, c.z, 8, Color("c9a070"), 1.2)
				var fx := Fx.current
				if fx and is_instance_valid(fx):
					fx.spark_burst(Vector3(c.x, 1.2, c.z), Color(0.4, 2.2, 0.8), 18, 6.0, 0.6)
					fx.flash(Vector3(c.x, 1.5, c.z), Color(0.3, 1.0, 0.45), 40.0, 8.0, 0.4)
		"item":
			if items:
				items.spawn(int(e.id), float(e.x), float(e.z), float(e.tx), float(e.tz))
		"pick":
			if items:
				items.pick(int(e.get("item", -1)))
		"kill":
			var f: Fighter = fighters.get(String(e.get("id", "")))
			if f and int(e.get("f", 0)) == 1:
				kit.fall_ghost(f)
			if f and skins:
				var by = e.get("by")
				skins.ko_burst(f.position, fighters.get(String(by)) if by != null else null)

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
		var list: Array = by_kind[kind]
		list.shuffle() # the quality preset hides the tail of the list: keep the thinning even
		var mmi := PropLib.multi(prop, TREE_FIT.get(kind, {"height": 4.6}), list, false)
		if mmi:
			add_child(mmi)
			_decor.append([mmi, list.size()])

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

# arena.js isLand: not a basin, ice, the void or a bridge (the outside counts as land, except on sky maps)
func is_land(i: int, j: int) -> bool:
	if i < 0 or j < 0 or i >= GameData.N or j >= GameData.N:
		return not map.get("sky", false)
	return not "WIV=".contains(tile(i, j))

func is_ice(x: float, z: float) -> bool:
	return char_at(x, z) == "I"

func break_tile(i: int, j: int) -> void:
	_put(i, j, ".")
	_hide_props(i, j)
	_drop_lights(j * GameData.N + i)

func _hide_props(i: int, j: int) -> void:
	var key := j * GameData.N + i
	if _hidden.has(key):
		for e in _hidden[key]:
			e[0].set_instance_transform(e[1], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
		_hidden.erase(key)

func set_tile(i: int, j: int, ch: String) -> void:
	_put(i, j, ch)

# A tile that falls away (crumbling island): whatever stood on it goes, it becomes void.
func remove_tile(i: int, j: int) -> void:
	_hide_props(i, j)
	_drop_lights(j * GameData.N + i)
	_put(i, j, "V")

# Take the floor quad of a tile out of the shared floor (it moved to its own piece, or fell).
func hide_ground(i: int, j: int) -> void:
	var key := j * GameData.N + i
	if _ground_slots.has(key):
		var e: Array = _ground_slots[key]
		e[0].set_instance_transform(e[1], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
		_ground_slots.erase(key)

# Circle vs. blocked tiles: push the position out of every solid tile around it. Void tiles ('V')
# block feet like walls, except for a circle already over the void (a pushed brawler goes over the
# edge and the void never pushes it back: src/arena.js collideCircle, `voidOk`).
func collide_circle(p: Vector3, r: float, void_ok := false) -> Vector3:
	var lim := GameData.HALF - r
	p.x = clampf(p.x, -lim, lim)
	p.z = clampf(p.z, -lim, lim)
	var ci := to_tile(p.x); var cj := to_tile(p.z)
	var over := tile(ci, cj) == "V"
	for dj in range(-1, 2):
		for di in range(-1, 2):
			var i := ci + di; var j := cj + dj
			if not blocks_move(i, j):
				continue
			if tile(i, j) == "V" and (void_ok or over):
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

var rev := 0                    # bumped on every tile change (arena.js rev): sight.gd rebuilds its mask

func _put(i: int, j: int, ch: String) -> void:
	rev += 1
	grid[j] = String(grid[j]).substr(0, i) + ch + String(grid[j]).substr(i + 1)

func _mat(col: Color, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	return m

func _ground(kinds: Dictionary) -> void:
	var solid: Array = []
	var water: Array = kinds.get("W", [])
	var ice: Array = kinds.get("I", [])
	for j in GameData.N:
		for i in GameData.N:
			var ch := tile(i, j)
			if ch == "V" or ch == "S":
				continue
			solid.append(Vector2i(i, j))
	var m0 := _ground_material()
	ground_mats = [m0, m0]
	_flat_tiles(solid, Color.WHITE, -0.02, m0, true)
	# ponds and frozen ponds follow a rounded outline (water.gd): the floor is cut along it
	if not water.is_empty() or not ice.is_empty():
		self.water = Water.new()
		add_child(self.water)
		self.water.setup(self)
		m0.shader = load("res://assets/shaders/ground_field.gdshader")
		self.water.bind(m0)
		m0.set_shader_parameter("field_lip", Water.SHORE_LIP if not water.is_empty() else 0.5)
		self.water.build(self, water, String(map.get("water", "water")))
		self.water.build_ice(self, ice)
		self.water.shores(self, m0)   # pebbles, reeds, the snow bank (shore.gd)
	if not map.get("sky", false):
		# the land around the arena (maps.js `outer`: sand, grass, snow), as a frame: the water basins
		# and their banks sit inside the arena, a full plane would cover them
		var outer_name := String(map.get("outer", "grass"))
		var om := _outer_material(outer_name)
		var e := GameData.HALF
		for r in [[Vector2(260, 130 - e), Vector3(0, 0, -(e + (130 - e) / 2.0))], [Vector2(260, 130 - e), Vector3(0, 0, e + (130 - e) / 2.0)],
				[Vector2(130 - e, e * 2.0), Vector3(-(e + (130 - e) / 2.0), 0, 0)], [Vector2(130 - e, e * 2.0), Vector3(e + (130 - e) / 2.0, 0, 0)]]:
			var outer := MeshInstance3D.new()
			var op := PlaneMesh.new()
			op.size = r[0]
			outer.mesh = op
			outer.position = (r[1] as Vector3) + Vector3(0, -0.02, 0)
			outer.material_override = om
			outer.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(outer)

const TEX_DIR := "res://assets/tex/%s.jpg"

# sRGB values as they are (a Color shader parameter would be converted to linear)
static func _v4(c: Color) -> Vector4:
	return Vector4(c.r, c.g, c.b, c.a)

const NORMAL_DIR := "res://assets/tex/%s_n.png"

# 'rgba(110,40,15,0.12)' (maps.js `checker`) -> Color in sRGB with that alpha
static func _css_rgba(css: String, fallback := Color(0, 0, 0, 0)) -> Color:
	var a := css.find("(")
	var b := css.find(")")
	if a < 0 or b < a:
		return fallback
	var parts := css.substr(a + 1, b - a - 1).split(",")
	if parts.size() < 3:
		return fallback
	return Color(float(parts[0]) / 255.0, float(parts[1]) / 255.0, float(parts[2]) / 255.0, float(parts[3]) if parts.size() > 3 else 1.0)

# The arena floor (arena.js buildGround): the painted ground picture per tile with the map's checker
# tint and thin seams, or the two flat tones of the cartoon maps. Wet maps: darker and glossier.
func _ground_material() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://assets/shaders/ground.gdshader")
	var gname := String(map.get("ground", "sand"))
	var wet: bool = map.get("wet", false)
	m.set_shader_parameter("origin", GameData.HALF)
	m.set_shader_parameter("period", GameData.TILE)
	m.set_shader_parameter("roughness", 0.42 if wet else 0.93)
	m.set_shader_parameter("tint", _v4(Color("b4b4b4") if wet else Color.WHITE))
	if gname == "cartoon":
		var tones: Array = map.get("groundTones", ["#f0ad7e", "#eba272"])
		m.set_shader_parameter("use_tex", 0.0)
		m.set_shader_parameter("use_normal", 0.0)
		m.set_shader_parameter("tone_a", _v4(Color(tones[0])))
		m.set_shader_parameter("tone_b", _v4(Color(tones[1])))
		m.set_shader_parameter("speckles", 1.0)
		return m
	if not ResourceLoader.exists(TEX_DIR % gname):
		gname = "sand"
	m.set_shader_parameter("albedo_tex", load(TEX_DIR % gname))
	m.set_shader_parameter("normal_tex", load(NORMAL_DIR % gname))
	m.set_shader_parameter("checker", _v4(_css_rgba(String(map.get("checker", "rgba(150,92,38,0.14)")))))
	return m

# The land around the arena: its picture every 5.2 m (arena.js: repeat 50/260 per metre).
func _outer_material(outer_name: String) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://assets/shaders/ground.gdshader")
	var oname := outer_name if ResourceLoader.exists(TEX_DIR % outer_name) else "grass"
	m.set_shader_parameter("albedo_tex", load(TEX_DIR % oname))
	m.set_shader_parameter("normal_tex", load(NORMAL_DIR % oname))
	m.set_shader_parameter("normal_scale", 1.0)
	m.set_shader_parameter("period", 260.0 / 50.0)
	m.set_shader_parameter("origin", 130.0)
	m.set_shader_parameter("seam", Vector4.ZERO)
	m.set_shader_parameter("roughness", 1.0)
	m.set_shader_parameter("tint", _v4(Color("e0b98a") if outer_name == "sand" else Color.WHITE))
	return m

func _flat_tiles(tiles: Array, col: Color, y: float, mat: Material = null, register := false) -> void:
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
		if register:
			_ground_slots[tiles[k].y * GameData.N + tiles[k].x] = [mm, k]
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
