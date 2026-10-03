class_name Kit
extends Node3D
# Interactive arena kit of the map grid, drawn and (for the local player) played client-side. Port of
# src/kit.js. The server owns the rules: it launches, hurts, breaks and kills; this client
#   * launches the LOCAL player off a jump pad (the server only checks the distance, so the launch
#     must match: 0.8 s in the air, fixed velocity, `dist` metres toward the middle: kit.js checkPads),
#   * slides the local player on ice (brawler.js: acceleration 2.4 instead of 16),
#   * draws everything the server announces with 'kit' events (bridge, doom, crumble, trap, trapGo,
#     land, shroom) and the 'crate' / 'kill' events (barrel blast, ring-out fall).
#   V void (blocks feet, a ring-out under a pushed brawler)   = bridge (breaks)   J jump pad
#   H healing mushroom   E explosive barrel   M windmill (arena.gd)   I ice   W water
# Sky maps (`sky: true`, Windmill Isles): rock under every island, a sea of clouds far below, puffy
# clouds, gulls, far islets, and the islands that shake, then drop (`crumble: true`).

const PAD_MIN := 7.0
const PAD_MAX := 14.0
const PAD_AIR := 0.8
const DOOM_WARN := 5.0
const BRIDGE_COL := Color("9c6a3c")
const TILE := GameData.TILE

var arena: Arena
var map: Dictionary
var pads: Array = []            # {i, j, x, z, dx, dz, dist, node}
var shrooms: Array = []         # {i, j, node, ready}
var bridges: Dictionary = {}    # tile key -> idx in bridge_mm
var traps: Array = []           # {owner, i, j, x, z, node, was, grow}
var falling: Array = []         # {node, vy, rx, rz, t, free}
var lifted: Array = []          # doomed islands, lifted off the floor
var doomed: Dictionary = {}     # tile key -> true
var bridge_mm: MultiMesh
var rock_mm: MultiMesh
var rock_idx: Dictionary = {}   # tile key -> instance index
var pad_mat: StandardMaterial3D
var pad_mm: MultiMesh
var shroom_mm: MultiMesh
var t := 0.0
# the local player
var dash: Dictionary = {}       # {vx, vz, t, T} while flying off a pad
var vel := Vector3.ZERO         # local velocity on ice (momentum)
var remote_air: Dictionary = {} # fighter id -> time left in the air (pad arcs of the others)
# sky
var sea: MeshInstance3D
var sea_mat: StandardMaterial3D
var cloud_mm: MultiMesh
var clouds: Array = []
var bird_body: MultiMesh
var bird_wl: MultiMesh
var bird_wr: MultiMesh
var birds: Array = []
var islets: Array = []
var crack_tex: ImageTexture
var pebble_mesh: Mesh
var rng := RandomNumberGenerator.new()

static func key(i: int, j: int) -> int:
	return j * GameData.N + i

func build(a: Arena, kinds: Dictionary) -> void:
	arena = a
	map = a.map
	rng.seed = 4242
	for p in kinds.get("J", []):
		pads.append({"i": p.x, "j": p.y})
	for p in pads:
		_aim_pad(p)
	_build_pads()
	_build_shrooms(kinds.get("H", []))
	_build_bridges(kinds.get("=", []))
	if map.get("sky", false):
		_build_rock(kinds)
		_build_sky()

# ------------------------------------------------------------------ layout

# A jump pad lands on the first open ground at least 7 m toward the middle of the arena.
func _aim_pad(p: Dictionary) -> void:
	var c := arena.center(p.i, p.j)
	var dx := -c.x
	var dz := -c.z
	var l := maxf(sqrt(dx * dx + dz * dz), 1e-6)
	dx /= l
	dz /= l
	var dist := 0.0
	var d := PAD_MIN
	while d <= PAD_MAX and dist == 0.0:
		if _pad_ok(c, dx, dz, d):
			dist = d
		d += 0.5
	if dist == 0.0:
		d = PAD_MIN
		while d >= 2.0 and dist == 0.0:
			if _pad_ok(c, dx, dz, d):
				dist = d
			d -= 0.5
	p.x = c.x
	p.z = c.z
	p.dx = dx
	p.dz = dz
	p.dist = dist if dist > 0.0 else PAD_MIN

func _pad_ok(c: Vector3, dx: float, dz: float, d: float) -> bool:
	var x := c.x + dx * d
	var z := c.z + dz * d
	var ch := arena.char_at(x, z)
	return not arena.blocks_move(arena.to_tile(x), arena.to_tile(z)) and ch != "V" and ch != "J"

func _std(col: Color, rough := 0.85, emis := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	if emis > 0.0:
		m.emission_enabled = true
		m.emission = col
		m.emission_energy_multiplier = emis
	return m

func _arrow_mesh() -> ArrayMesh:
	var poly := PackedVector2Array([Vector2(0, 0.55), Vector2(0.42, 0.05), Vector2(0.16, 0.05), Vector2(0.16, -0.45), Vector2(-0.16, -0.45), Vector2(-0.16, 0.05), Vector2(-0.42, 0.05)])
	var idx := Geometry2D.triangulate_polygon(poly)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_normal(Vector3.UP)
	for k in idx:
		st.add_vertex(Vector3(poly[k].x, 0, -poly[k].y))
	return st.commit()

# ------------------------------------------------------------------ visuals

func _build_pads() -> void:
	if pads.is_empty():
		return
	var base := CylinderMesh.new()
	base.top_radius = 0.85
	base.bottom_radius = 0.95
	base.height = 0.16
	base.radial_segments = 20
	base.material = _std(Color("3a3f58"), 0.6)
	pad_mat = _std(Color("4dd0ff"), 0.35, 0.8)
	var disc := CylinderMesh.new()
	disc.top_radius = 0.7
	disc.bottom_radius = 0.7
	disc.height = 0.05
	disc.radial_segments = 20
	disc.material = pad_mat
	var arrow := _arrow_mesh()
	var am := StandardMaterial3D.new()
	am.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	am.cull_mode = BaseMaterial3D.CULL_DISABLED
	arrow.surface_set_material(0, am)
	# every pad in one MultiMesh of one baked mesh (base, glowing disc, arrow): 3 draw calls in all
	var pad: ArrayMesh = MeshMerge.bake([[base, Transform3D(Basis.IDENTITY, Vector3(0, 0.08, 0))], [disc, Transform3D(Basis.IDENTITY, Vector3(0, 0.18, 0)), true],
		[arrow, Transform3D(Basis.IDENTITY, Vector3(0, 0.215, 0)), true]])
	pad_mm = MultiMesh.new()
	pad_mm.transform_format = MultiMesh.TRANSFORM_3D
	pad_mm.mesh = pad
	pad_mm.instance_count = pads.size()
	for k in pads.size():
		var p: Dictionary = pads[k]
		p.k = k
		pad_mm.set_instance_transform(k, Transform3D(Basis(Vector3.UP, atan2(-p.dx, -p.dz)), Vector3(p.x, 0, p.z)))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = pad_mm
	add_child(mmi)

func _build_shrooms(tiles: Array) -> void:
	if tiles.is_empty():
		return
	var stem := CylinderMesh.new()
	stem.top_radius = 0.22
	stem.bottom_radius = 0.3
	stem.height = 0.6
	stem.radial_segments = 12
	stem.material = _std(Color("f4ecd8"), 0.7)
	var cap := SphereMesh.new()
	cap.radius = 0.55
	cap.height = 1.1
	cap.is_hemisphere = true
	cap.radial_segments = 16
	cap.rings = 8
	cap.material = _std(Color("e8455a"), 0.5, 0.25)
	var dot := SphereMesh.new()
	dot.radius = 0.09
	dot.height = 0.18
	dot.radial_segments = 6
	dot.rings = 3
	dot.material = _std(Color.WHITE, 0.6)
	# stem, cap and its 5 dots baked into one mesh, every mushroom in one MultiMesh: 2 draw calls in all
	var parts: Array = [[stem, Transform3D(Basis.IDENTITY, Vector3(0, 0.3, 0))], [cap, Transform3D(Basis.from_scale(Vector3(1, 0.8, 1)), Vector3(0, 0.55, 0))]]
	for k in 5:
		var a := k / 5.0 * TAU
		parts.append([dot, Transform3D(Basis.IDENTITY, Vector3(cos(a) * 0.36, 0.85, sin(a) * 0.36))])
	shroom_mm = MultiMesh.new()
	shroom_mm.transform_format = MultiMesh.TRANSFORM_3D
	shroom_mm.mesh = MeshMerge.bake(parts)
	shroom_mm.instance_count = tiles.size()
	for k in tiles.size():
		var tl: Vector2i = tiles[k]
		shroom_mm.set_instance_transform(k, Transform3D(Basis.IDENTITY, arena.center(tl.x, tl.y)))
		shrooms.append({"i": tl.x, "j": tl.y, "k": k, "ready": true})
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = shroom_mm
	add_child(mmi)

# A mushroom or a pad shown / hidden: its MultiMesh instance at its tile, or scaled to nothing.
func _show_shroom(s: Dictionary, on: bool) -> void:
	var c := arena.center(int(s.i), int(s.j))
	shroom_mm.set_instance_transform(int(s.k), Transform3D(Basis.IDENTITY if on else Basis.from_scale(Vector3.ZERO), c))

func _hide_pad(p: Dictionary) -> void:
	pad_mm.set_instance_transform(int(p.k), Transform3D(Basis.from_scale(Vector3.ZERO), Vector3(p.x, 0, p.z)))

func _build_bridges(tiles: Array) -> void:
	if tiles.is_empty():
		return
	var plank := BoxMesh.new()
	plank.size = Vector3(1.98, 0.22, 1.9)
	var m := _std(Color.WHITE, 0.8)
	m.vertex_color_use_as_albedo = true
	plank.material = m
	bridge_mm = MultiMesh.new()
	bridge_mm.transform_format = MultiMesh.TRANSFORM_3D
	bridge_mm.use_colors = true
	bridge_mm.mesh = plank
	bridge_mm.instance_count = tiles.size()
	for k in tiles.size():
		var tl: Vector2i = tiles[k]
		var along := arena.tile(tl.x - 1, tl.y) == "=" or arena.tile(tl.x + 1, tl.y) == "="
		var pos := arena.center(tl.x, tl.y) + Vector3(0, -0.08, 0)
		bridge_mm.set_instance_transform(k, Transform3D(Basis(Vector3.UP, 0.0 if along else PI / 2.0), pos))
		bridge_mm.set_instance_color(k, Color.from_hsv(0.07, 0.6, 0.55 + rng.randf() * 0.1))
		bridges[key(tl.x, tl.y)] = k
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = bridge_mm
	add_child(mmi)

# Rock under every island tile (sky maps).
func _build_rock(kinds: Dictionary) -> void:
	var land: Array = []
	for j in GameData.N:
		for i in GameData.N:
			var ch := arena.tile(i, j)
			if ch != "V" and ch != "=" and ch != "S":
				land.append(Vector2i(i, j))
	for p in kinds.get("S", []):
		land.append(p)
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.3
	cyl.bottom_radius = 0.7
	cyl.height = 4.2
	cyl.radial_segments = 6
	cyl.rings = 1
	var m := _std(Color.WHITE, 0.95)
	m.vertex_color_use_as_albedo = true
	cyl.material = m
	rock_mm = MultiMesh.new()
	rock_mm.transform_format = MultiMesh.TRANSFORM_3D
	rock_mm.use_colors = true
	rock_mm.mesh = cyl
	rock_mm.instance_count = land.size()
	for k in land.size():
		var tl: Vector2i = land[k]
		rock_mm.set_instance_transform(k, _rock_xf(tl.x, tl.y, Vector3.ZERO))
		rock_mm.set_instance_color(k, Color.from_hsv(0.07 + ((tl.x * 5 + tl.y * 3) % 4) * 0.01, 0.55, 0.42 + ((tl.x * 11 + tl.y * 7) % 5) * 0.03))
		rock_idx[key(tl.x, tl.y)] = k
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = rock_mm
	add_child(mmi)

func _rock_xf(i: int, j: int, off: Vector3) -> Transform3D:
	var c := arena.center(i, j) - off
	var b := Basis(Vector3.UP, float((i * 7 + j * 13) % 6)) * Basis.from_scale(Vector3(1, 0.7 + ((i * 31 + j * 17) % 10) / 16.0, 1))
	return Transform3D(b, c + b * Vector3(0, -2.14, 0))

func _tri_mesh(pts: Array, tris: Array, col: Color) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for tr in tris:
		var n: Vector3 = ((pts[tr[1]] as Vector3) - (pts[tr[0]] as Vector3)).cross((pts[tr[2]] as Vector3) - (pts[tr[0]] as Vector3)).normalized()
		st.set_normal(n)
		for k in 3:
			st.add_vertex(pts[tr[k]])
	var mesh := st.commit()
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.disable_fog = true
	mesh.surface_set_material(0, m)
	return mesh

func _multi(mesh: Mesh, n: int, colors := false) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.mesh = mesh
	mm.instance_count = n
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.custom_aabb = AABB(Vector3(-200, -60, -200), Vector3(400, 120, 400))
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	return mmi

# Below the islands: a sea of clouds, puffy clouds at every depth, gulls, far islets, cracks.
func _build_sky() -> void:
	# sea of clouds
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.frequency = 0.02
	noise.fractal_octaves = 3
	var nt := NoiseTexture2D.new()
	nt.noise = noise
	nt.seamless = true
	nt.width = 256
	nt.height = 256
	var ramp := Gradient.new()
	ramp.set_color(0, Color("86c6f5"))
	ramp.set_color(1, Color("ffffff"))
	ramp.set_offset(0, 0.45)
	ramp.set_offset(1, 0.85)
	nt.color_ramp = ramp
	sea_mat = StandardMaterial3D.new()
	sea_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sea_mat.albedo_texture = nt
	sea_mat.uv1_scale = Vector3(4, 4, 1)
	sea_mat.disable_fog = true
	var pm := PlaneMesh.new()
	pm.size = Vector2(400, 400)
	sea = MeshInstance3D.new()
	sea.mesh = pm
	sea.material_override = sea_mat
	sea.position.y = -30.0
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sea)
	# puffy clouds: a few spheres each, one MultiMesh
	var puffs := 0
	for k in 22:
		var rim := k >= 14
		var a := rng.randf() * TAU
		var d := (36.0 + rng.randf() * 14.0) if rim else (6.0 + rng.randf() * 44.0)
		var sz := (1.3 + rng.randf() * 0.9) if rim else (0.9 + rng.randf() * 1.2)
		var C := {"x": cos(a) * d, "y": (-9.0 - rng.randf() * 5.0) if rim else (-8.0 - rng.randf() * 14.0), "z": sin(a) * d, "v": 0.4 + rng.randf() * 0.6, "p": []}
		var n := 4 + int(rng.randf() * 4)
		for q in n:
			var f := 1.0 - absf(q - (n - 1) / 2.0) / n
			C.p.append([(q - (n - 1) / 2.0) * 1.5 * sz + (rng.randf() - 0.5) * sz, (rng.randf() - 0.3) * 0.7 * sz, (rng.randf() - 0.5) * 1.6 * sz, (1.1 + rng.randf() * 0.8) * sz * (0.55 + f * 0.6), puffs])
			puffs += 1
		clouds.append(C)
	var sph := SphereMesh.new()
	sph.radius = 1.0
	sph.height = 2.0
	sph.radial_segments = 10
	sph.rings = 5
	var cm := _std(Color.WHITE, 1.0)
	cm.emission_enabled = true
	cm.emission = Color(0.77, 0.85, 0.94)
	cm.emission_energy_multiplier = 0.55
	cm.disable_fog = true
	sph.material = cm
	var cmi := _multi(sph, puffs)
	cloud_mm = cmi.multimesh
	_place_clouds(0.0)
	# gulls
	var pts_b := [Vector3(0, 0, 0)]
	var cone := CylinderMesh.new()
	cone.top_radius = 0.0
	cone.bottom_radius = 0.13
	cone.height = 0.62
	cone.radial_segments = 5
	cone.rings = 1
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color("f6f6f2")
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gm.cull_mode = BaseMaterial3D.CULL_DISABLED
	gm.disable_fog = true
	cone.material = gm
	var wing := _tri_mesh([Vector3(0, 0, 0.16), Vector3(0, 0, -0.14), Vector3(0.95, 0, -0.18), Vector3(0.62, 0, 0.04)], [[0, 1, 2], [0, 2, 3]], Color("f6f6f2"))
	var nb := 0
	for f in 4:
		var F := {"r": 14.0 + rng.randf() * 26.0, "y": -3.5 - rng.randf() * 6.0, "w": (0.12 + rng.randf() * 0.08) * (1.0 if f % 2 == 1 else -1.0), "a": rng.randf() * TAU}
		var n := 3 + int(rng.randf() * 4)
		for k in n:
			var side := 1.0 if k % 2 == 1 else -1.0
			var row := ceilf(k / 2.0) * 1.8
			birds.append({"F": F, "ox": side * row * 0.9, "oz": -row * 0.8 + (rng.randf() - 0.5) * 0.3, "oy": (rng.randf() - 0.5) * 0.4, "ph": rng.randf() * TAU, "s": 1.2 + rng.randf() * 0.4})
			nb += 1
	bird_body = _multi(cone, nb).multimesh
	bird_wl = _multi(wing, nb).multimesh
	bird_wr = _multi(wing, nb).multimesh
	# far islets
	var rock := CylinderMesh.new()
	rock.top_radius = 1.0
	rock.bottom_radius = 0.0
	rock.height = 1.0
	rock.radial_segments = 7
	rock.rings = 1
	rock.material = _std(Color("8a6a4e"), 0.95)
	var top := CylinderMesh.new()
	top.top_radius = 1.0
	top.bottom_radius = 0.94
	top.height = 0.3
	top.radial_segments = 7
	top.material = _std(Color("8fcf63"), 0.9)
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.12
	trunk.bottom_radius = 0.16
	trunk.height = 0.9
	trunk.radial_segments = 6
	trunk.material = _std(Color("7a5232"), 0.85)
	var crown := SphereMesh.new()
	crown.radius = 0.6
	crown.height = 1.2
	crown.radial_segments = 8
	crown.rings = 4
	crown.material = _std(Color("5fae4a"), 0.85)
	var stone := _std(Color("ece2cf"), 0.85)
	var roofm := _std(Color("c8453a"), 0.7)
	var a0 := rng.randf() * TAU
	# each islet baked into one mesh (rock, grass, trees or tower and roof), its sails into another:
	# 1-2 draw calls an islet instead of 4 to 10; far below the arena, they cast no shadow
	for k in 9:
		var a := a0 + k / 9.0 * TAU + (rng.randf() - 0.5) * 0.4
		var d := 33.0 + rng.randf() * 12.0
		var sz := 1.4 + rng.randf() * 1.6
		var g := Node3D.new()
		var hh := sz * (1.6 + rng.randf())
		var parts: Array = [[rock, Transform3D(Basis.from_scale(Vector3(sz, hh, sz)), Vector3(0, -hh / 2.0, 0))],
			[top, Transform3D(Basis.from_scale(Vector3(sz, 1, sz)), Vector3(0, 0.15, 0))]]
		var hub: Node3D = null
		if k % 3 == 0: # a tiny windmill, sails turning
			var tm := CylinderMesh.new()
			tm.top_radius = 0.3
			tm.bottom_radius = 0.42
			tm.height = 1.3
			tm.radial_segments = 8
			tm.material = stone
			parts.append([tm, Transform3D(Basis.IDENTITY, Vector3(0, 0.95, 0))])
			var rm := CylinderMesh.new()
			rm.top_radius = 0.0
			rm.bottom_radius = 0.4
			rm.height = 0.45
			rm.radial_segments = 8
			rm.material = roofm
			parts.append([rm, Transform3D(Basis.IDENTITY, Vector3(0, 1.82, 0))])
			hub = Node3D.new()
			hub.position = Vector3(0, 1.35, 0.4)
			var sp := BoxMesh.new()
			sp.size = Vector3(0.08, 0.9, 0.03)
			sp.material = stone
			var sails: Array = []
			for q in 4:
				sails.append([sp, Transform3D(Basis(Vector3(0, 0, 1), q * PI / 2.0), Vector3.ZERO) * Transform3D(Basis.IDENTITY, Vector3(0, 0.45, 0))])
			var smi := MeshInstance3D.new()
			smi.mesh = MeshMerge.bake(sails)
			smi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			hub.add_child(smi)
			g.add_child(hub)
		else:
			for q in 1 + (k % 2):
				var cs := 0.8 + rng.randf() * 0.5
				var tp := Vector3((rng.randf() - 0.5) * sz * 0.9, 0, (rng.randf() - 0.5) * sz * 0.9)
				parts.append([trunk, Transform3D(Basis.IDENTITY, tp + Vector3(0, 0.75, 0))])
				parts.append([crown, Transform3D(Basis.from_scale(Vector3.ONE * cs), tp + Vector3(0, 1.35, 0))])
		var body := MeshInstance3D.new()
		body.mesh = MeshMerge.bake(parts)
		body.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		g.add_child(body)
		var y0 := -5.0 - rng.randf() * 7.0
		g.position = Vector3(cos(a) * d, y0, sin(a) * d)
		g.rotation.y = -a + PI / 2.0
		add_child(g)
		islets.append({"g": g, "y": y0, "ph": rng.randf() * TAU, "hub": hub})
	# the cracks drawn over a doomed island
	var img := Image.create(128, 128, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	for k in 5:
		_crack(img, rng.randf() * 128.0, rng.randf() * 128.0, rng.randf() * TAU, 8 + int(rng.randf() * 8), 2.6)
	crack_tex = ImageTexture.create_from_image(img)
	pebble_mesh = _dodeca()

func _dodeca() -> Mesh:
	var s := SphereMesh.new()
	s.radius = 0.28
	s.height = 0.56
	s.radial_segments = 5
	s.rings = 3
	s.material = _std(Color("8a6a4e"), 0.95)
	return s

func _crack(img: Image, px: float, py: float, ang: float, len: int, w: float) -> void:
	for k in len:
		var nx := px + cos(ang) * 6.0
		var ny := py + sin(ang) * 6.0
		var steps := 8
		for s in steps:
			var x := lerpf(px, nx, s / float(steps))
			var y := lerpf(py, ny, s / float(steps))
			for ox in range(-ceili(w), ceili(w) + 1):
				for oy in range(-ceili(w), ceili(w) + 1):
					if ox * ox + oy * oy <= w * w:
						img.set_pixel(posmod(int(x) + ox, 128), posmod(int(y) + oy, 128), Color(0.25, 0.15, 0.09, 1.0))
		px = nx
		py = ny
		ang += (rng.randf() - 0.5) * 0.9
		w = maxf(0.8, w * 0.93)
		if rng.randf() < 0.12 and w > 1.4:
			_crack(img, px, py, ang + (0.6 + rng.randf() * 0.6) * (1.0 if rng.randf() < 0.5 else -1.0), len - k - 2, w * 0.7)

func _place_clouds(dt: float) -> void:
	for C in clouds:
		C.x += C.v * dt
		if C.x > 70.0:
			C.x -= 140.0
		for p in C.p:
			var r: float = p[3]
			cloud_mm.set_instance_transform(int(p[4]), Transform3D(Basis.from_scale(Vector3(r, r * 0.72, r)), Vector3(C.x + p[0], C.y + p[1], C.z + p[2])))

func _fly_birds() -> void:
	for k in birds.size():
		var b: Dictionary = birds[k]
		var F: Dictionary = b.F
		var a: float = F.a + F.w * t
		var dir := signf(F.w)
		var hx := -sin(a) * dir
		var hz := cos(a) * dir
		var yaw := atan2(hx, hz)
		var px: float = cos(a) * F.r + cos(yaw) * b.ox + hx * b.oz
		var pz: float = sin(a) * F.r - sin(yaw) * b.ox + hz * b.oz
		var pos := Vector3(px, F.y + b.oy + sin(t * 0.8 + b.ph) * 0.3, pz)
		var basis := Basis(Vector3.UP, yaw) * Basis.from_scale(Vector3.ONE * b.s)
		bird_body.set_instance_transform(k, Transform3D(basis * Basis(Vector3.RIGHT, PI / 2.0), pos))
		var cyc := fmod(t * 0.35 + b.ph, 2.0)
		var flap := sin(t * 11.0 + b.ph) * 0.65 if cyc < 1.2 else 0.12
		bird_wr.set_instance_transform(k, Transform3D(basis * Basis(Vector3.BACK, flap), pos))
		bird_wl.set_instance_transform(k, Transform3D(basis * Basis(Vector3.BACK, -flap) * Basis.from_scale(Vector3(-1, 1, 1)), pos))

# ------------------------------------------------------------------ local player rules

# Called every frame for the local player instead of the plain walk when the world matters (ice, jump
# pad, a pad flight). Returns true when it moved `me` itself.
func step_local(me: Fighter, mv: Vector2, delta: float) -> bool:
	if not dash.is_empty():
		var D := dash
		var h := minf(delta, float(D.t))
		me.position.x += float(D.vx) * h
		me.position.z += float(D.vz) * h
		D.t = float(D.t) - delta
		var u := clampf(float(D.t) / float(D.T), 0.0, 1.0)
		_lift(me, 4.0 * 1.3 * (1.0 - u) * u)
		me.rotation.y = lerp_angle(me.rotation.y, atan2(float(D.vx), float(D.vz)), clampf(delta * 14.0, 0, 1))
		vel = Vector3(float(D.vx), 0, float(D.vz))
		if float(D.t) <= 1e-6:
			dash = {}
			_lift(me, 0.0)
			me.position = arena.collide_circle(me.position, me.radius)
			vel = Vector3.ZERO
			WorldFx.dust(self, me.position.x, me.position.z, 8, Color("d8c8a8"), 1.2)
		return true
	# a jump pad under the feet
	if (me.flags & (8 | 16 | 32)) == 0:
		for p in pads:
			if Vector2(me.position.x - p.x, me.position.z - p.z).length() <= 0.75:
				dash = {"vx": p.dx * p.dist / PAD_AIR, "vz": p.dz * p.dist / PAD_AIR, "t": PAD_AIR, "T": PAD_AIR}
				me.position.x = p.x
				me.position.z = p.z
				WorldFx.ring(self, p.x, p.z, 1.2, Color(0.6, 0.95, 1.0), 0.4)
				return true
	# ice keeps the momentum (brawler.js: acceleration 2.4 on ice, 16 elsewhere)
	var on_ice := arena.is_ice(me.position.x, me.position.z)
	var mul := 1.0
	if (me.flags & (8 | 16 | 32)) != 0:
		mul = 0.0
	elif (me.flags & 4) != 0:
		mul = 0.55
	var speed := float(me.type.speed)
	var target := Vector3(mv.x, 0, mv.y) * speed * mul
	if not on_ice and vel.distance_to(target) < 0.25:
		vel = target
		return false
	var k := 1.0 - exp(-(2.4 if on_ice else 16.0) * delta)
	vel += (target - vel) * k
	me.position = arena.collide_circle(me.position + vel * delta, me.radius)
	if mv != Vector2.ZERO:
		me.rotation.y = lerp_angle(me.rotation.y, atan2(mv.x, mv.y), clampf(delta * 14.0, 0, 1))
	elif vel.length() > 2.0:
		me.rotation.y = lerp_angle(me.rotation.y, atan2(vel.x, vel.z), clampf(delta * 8.0, 0, 1))
	return true

# Raise a fighter's model (jump pad flight) without touching its ground position.
func _lift(f: Node3D, y: float) -> void:
	for n in ["_model", "_body", "_bar", "_label"]:
		var node = f.get(n)
		if node is Node3D:
			if not (node as Node3D).has_meta("y0"):
				(node as Node3D).set_meta("y0", (node as Node3D).position.y)
			(node as Node3D).position.y = float((node as Node3D).get_meta("y0")) + y

# ------------------------------------------------------------------ events

func on_event(e: Dictionary) -> void:
	match String(e.get("k", "")):
		"trap":
			_remove_traps_of(String(e.get("id", "")))
			_add_trap(String(e.get("id", "")), int(e.i), int(e.j))
		"trapGo":
			for T in traps:
				if T.i == int(e.i) and T.j == int(e.j):
					_remove_trap(T, bool(e.get("snap", 0)))
					break
		"land":
			land_fx(float(e.x), float(e.z))
		"shroom":
			for s in shrooms:
				if s.i == int(e.i) and s.j == int(e.j):
					_shroom_fx(s, bool(int(e.get("on", 0))))
		"bridge":
			break_bridge(int(e.i), int(e.j))
		"doom":
			if e.get("t") is Array:
				doom(e.t)
		"crumble":
			if e.get("t") is Array:
				crumble(e.t)

func land_fx(x: float, z: float) -> void:
	WorldFx.ring(self, x, z, 2.0, Color(1.0, 0.9, 0.65), 0.4)
	WorldFx.dust(self, x, z, 10, Color("d8c8a8"), 1.4)

func _shroom_fx(s: Dictionary, on: bool) -> void:
	s.ready = on
	_show_shroom(s, on)
	var c := arena.center(s.i, s.j)
	if not on:
		WorldFx.sparks(self, Vector3(c.x, 1.0, c.z), Color(0.5, 1.0, 0.7), 16, 4.0, 0.5)
	WorldFx.ring(self, c.x, c.z, 0.9, Color(0.6, 1.0, 0.75), 0.4)

func barrel_fx(i: int, j: int) -> void:
	var c := arena.center(i, j)
	WorldFx.explosion(self, c.x, c.z, 2.5)

# Ring-out: the K.O.'d fighter tumbles into the void (a copy of its model; the fighter itself hides).
func fall_ghost(f: Node3D) -> void:
	var src = f.get("_model")
	if src == null:
		src = f.get("_body")
	if not (src is Node3D):
		return
	var g := Node3D.new()
	g.position = f.position
	g.rotation = f.rotation
	add_child(g)
	# a copy falls, the fighter's own model only hides: a Duo partner may revive it (fighter.gd revive)
	var copy := (src as Node3D).duplicate(Node.DUPLICATE_SIGNALS | Node.DUPLICATE_GROUPS | Node.DUPLICATE_SCRIPTS) as Node3D   # (not by instancing: the outline hulls were added at run time)
	g.add_child(copy)
	copy.transform = (src as Node3D).transform
	(src as Node3D).visible = false
	falling.append({"node": g, "vy": 0.0, "rx": (rng.randf() - 0.5) * 6.0, "rz": (rng.randf() - 0.5) * 6.0, "t": 1.4, "free": true, "shrink": true})

# ------------------------------------------------------------------ bridges

func break_bridge(i: int, j: int) -> void:
	var k := key(i, j)
	if not bridges.has(k):
		return
	bridge_mm.set_instance_transform(bridges[k], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
	bridges.erase(k)
	arena.set_tile(i, j, "V")
	var c := arena.center(i, j)
	_chunk(c.x, c.z, BRIDGE_COL, 0.25)
	WorldFx.debris(self, Vector3(c.x, 0.1, c.z), BRIDGE_COL, 10, 0.3, 5.0)

# A falling slab of ground (cosmetic).
func _chunk(x: float, z: float, col: Color, h: float) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(1.9, h, 1.9)
	bm.material = _std(col, 0.9)
	mi.mesh = bm
	mi.position = Vector3(x, -h / 2.0, z)
	add_child(mi)
	falling.append({"node": mi, "vy": 0.0, "rx": (rng.randf() - 0.5) * 2.0, "rz": (rng.randf() - 0.5) * 2.0, "t": 2.2, "free": true})

# ------------------------------------------------------------------ crumbling islands

# Doomed tiles leave the floor for their own piece (ground, rock, cracks): it shakes harder for the
# 5 s telegraph, sheds pebbles, then drops in one piece.
func doom(tiles: Array) -> void:
	var left := {}
	for tl in tiles:
		var i := int(tl[0])
		var j := int(tl[1])
		doomed[key(i, j)] = true
		var ch := arena.tile(i, j)
		if ch != "V" and ch != "=":
			left[key(i, j)] = Vector2i(i, j)
	while not left.is_empty():
		var first: int = left.keys()[0]
		var comp := {first: left[first]}
		var stack := [first]
		left.erase(first)
		while not stack.is_empty():
			var kk: int = stack.pop_back()
			var ci: int = kk % GameData.N
			var cj: int = kk / GameData.N
			for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
				var nk := key(ci + d.x, cj + d.y)
				if left.has(nk):
					comp[nk] = left[nk]
					left.erase(nk)
					stack.append(nk)
		_lift_island(comp)

func _lift_island(comp: Dictionary) -> void:
	var cx := 0.0
	var cz := 0.0
	for kk in comp:
		var c := arena.center(comp[kk].x, comp[kk].y)
		cx += c.x / comp.size()
		cz += c.z / comp.size()
	var off := Vector3(cx, 0, cz)
	var grp := Node3D.new()
	grp.position = off
	add_child(grp)
	# ground: the same two tones as the floor, tile quads
	var plane := PlaneMesh.new()
	plane.size = Vector2(TILE, TILE)
	var per := [[], []]
	for kk in comp:
		var tl: Vector2i = comp[kk]
		per[(tl.x + tl.y) % 2].append(tl)
		arena.hide_ground(tl.x, tl.y)
	for par in 2:
		if per[par].is_empty():
			continue
		var pm := PlaneMesh.new()
		pm.size = Vector2(TILE, TILE)
		pm.material = arena.ground_mats[par]
		var mmi := _multi(pm, per[par].size())
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.custom_aabb = AABB(Vector3(-60, -5, -60), Vector3(120, 10, 120))
		mmi.reparent(grp, false)
		for n in per[par].size():
			var tl: Vector2i = per[par][n]
			mmi.multimesh.set_instance_transform(n, Transform3D(Basis.IDENTITY, arena.center(tl.x, tl.y) - off + Vector3(0, -0.02, 0)))
	# cracks
	var crack_m: StandardMaterial3D = null
	if crack_tex:
		crack_m = StandardMaterial3D.new()
		crack_m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		crack_m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		crack_m.albedo_texture = crack_tex
		crack_m.albedo_color = Color(1, 1, 1, 0.15)
		crack_m.render_priority = 1
		var cp := PlaneMesh.new()
		cp.size = Vector2(TILE, TILE)
		cp.material = crack_m
		var cmi := _multi(cp, comp.size())
		cmi.reparent(grp, false)
		cmi.custom_aabb = AABB(Vector3(-60, -5, -60), Vector3(120, 10, 120))
		var n := 0
		for kk in comp:
			var tl: Vector2i = comp[kk]
			cmi.multimesh.set_instance_transform(n, Transform3D(Basis(Vector3.UP, (n % 4) * PI / 2.0), arena.center(tl.x, tl.y) - off + Vector3(0, 0.01, 0)))
			n += 1
	# rock: move the instances of this island out of the shared rock mesh
	var rock_keys: Array = []
	for kk in comp:
		if rock_idx.has(kk):
			rock_keys.append(kk)
	if not rock_keys.is_empty():
		var rmi := _multi(rock_mm.mesh, rock_keys.size(), true)
		rmi.reparent(grp, false)
		rmi.custom_aabb = AABB(Vector3(-60, -10, -60), Vector3(120, 20, 120))
		for n in rock_keys.size():
			var kk: int = rock_keys[n]
			var tl: Vector2i = comp[kk]
			rmi.multimesh.set_instance_transform(n, _rock_xf(tl.x, tl.y, off))
			rmi.multimesh.set_instance_color(n, rock_mm.get_instance_color(rock_idx[kk]))
			rock_mm.set_instance_transform(rock_idx[kk], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
	lifted.append({"grp": grp, "keys": comp.keys(), "cx": cx, "cz": cz, "t0": t, "pebble": 0.0, "fall": {}, "crack": crack_m})

# The ground gives way: what stood on it goes too.
func crumble(tiles: Array) -> void:
	for tl in tiles:
		var i := int(tl[0])
		var j := int(tl[1])
		var k := key(i, j)
		doomed.erase(k)
		var ch := arena.tile(i, j)
		if ch == "V":
			continue
		if ch == "=":
			break_bridge(i, j)
			continue
		arena.remove_tile(i, j)
		for T in traps.duplicate():
			if T.i == i and T.j == j:
				_remove_trap(T, false)
		for p in pads.duplicate():
			if p.i == i and p.j == j:
				_hide_pad(p)
				pads.erase(p)
		for s in shrooms:
			if s.i == i and s.j == j:
				s.ready = false
				_show_shroom(s, false)
		var in_lifted := false
		for L in lifted:
			if L.keys.has(k):
				in_lifted = true
		if rock_idx.has(k) and not in_lifted:
			rock_mm.set_instance_transform(rock_idx[k], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
		if not in_lifted:
			arena.hide_ground(i, j)
			if rng.randf() < 0.5:
				var c := arena.center(i, j)
				_chunk(c.x, c.z, Color("7fbf5a"), 1.0)
	for L in lifted:
		if L.fall.is_empty():
			for tl in tiles:
				if L.keys.has(key(int(tl[0]), int(tl[1]))):
					L.fall = {"vy": 0.0, "rx": (rng.randf() - 0.5) * 0.5, "rz": (rng.randf() - 0.5) * 0.5, "t": 3.2}
					L.grp.rotation = Vector3.ZERO
					L.grp.position = Vector3(L.cx, 0, L.cz)
					if L.crack:
						L.crack.albedo_color.a = 0.85
					WorldFx.dust(self, L.cx, L.cz, 14, Color("b89a74"), sqrt(L.keys.size()) * 1.2)
					break

func _update_lifted(delta: float) -> void:
	for n in range(lifted.size() - 1, -1, -1):
		var L: Dictionary = lifted[n]
		var G: Node3D = L.grp
		if not L.fall.is_empty():
			L.fall.vy += 16.0 * delta
			G.position.y -= float(L.fall.vy) * delta
			G.rotation.x += float(L.fall.rx) * delta
			G.rotation.z += float(L.fall.rz) * delta
			L.fall.t = float(L.fall.t) - delta
			if float(L.fall.t) <= 0.0:
				G.queue_free()
				lifted.remove_at(n)
			continue
		var p := clampf((t - float(L.t0)) / DOOM_WARN, 0.0, 1.0)
		var amp := 0.02 + 0.13 * p * p
		G.position = Vector3(L.cx + (rng.randf() - 0.5) * amp * 2.0, (rng.randf() - 0.5) * amp * 0.6, L.cz + (rng.randf() - 0.5) * amp * 2.0)
		G.rotation = Vector3(sin(t * 23.0) * amp * 0.05, 0, cos(t * 19.0) * amp * 0.05)
		if L.crack:
			L.crack.albedo_color.a = minf(0.85, 0.15 + p * 0.9)
		L.pebble = float(L.pebble) - delta
		if float(L.pebble) <= 0.0:
			L.pebble = 0.35 - p * 0.25
			var kk: int = L.keys[rng.randi() % L.keys.size()]
			var c := arena.center(kk % GameData.N, kk / GameData.N)
			var m := MeshInstance3D.new()
			m.mesh = pebble_mesh
			m.position = Vector3(c.x + (rng.randf() - 0.5) * 1.6, -0.6 - rng.randf() * 2.0, c.z + (rng.randf() - 0.5) * 1.6)
			m.scale = Vector3.ONE * (0.6 + rng.randf() * 0.9)
			add_child(m)
			falling.append({"node": m, "vy": 0.0, "rx": (rng.randf() - 0.5) * 6.0, "rz": (rng.randf() - 0.5) * 6.0, "t": 1.6, "free": true})
			if rng.randf() < 0.5:
				WorldFx.dust(self, c.x, c.z, 2 + int(round(p * 3.0)), Color("b89a74"), 0.8)

# ------------------------------------------------------------------ Pip & Chomp: Venus traps and spore puffs

func _add_trap(owner_id: String, i: int, j: int) -> void:
	var c := arena.center(i, j)
	var g := Node3D.new()
	g.position = c
	var leaf := _std(Color("3f9e44"), 0.7)
	var sm := SphereMesh.new()
	sm.radius = 0.42
	sm.height = 0.84
	sm.radial_segments = 10
	sm.rings = 5
	sm.material = leaf
	for k in 7:
		var a := k / 7.0 * TAU
		var m := MeshInstance3D.new()
		m.mesh = sm
		m.position = Vector3(cos(a) * 0.45, 0.45 + (k % 2) * 0.15, sin(a) * 0.45)
		m.scale = Vector3(1, 0.8, 1)
		g.add_child(m)
	var jm := SphereMesh.new()
	jm.radius = 0.3
	jm.height = 0.6
	jm.is_hemisphere = true
	jm.material = _std(Color("d6336c"), 0.5)
	var jaw := MeshInstance3D.new()
	jaw.mesh = jm
	jaw.position.y = 0.75
	g.add_child(jaw)
	g.scale = Vector3.ONE * 0.01
	add_child(g)
	var was := arena.tile(i, j)
	arena.set_tile(i, j, "B") # a bush: it hides whoever stands in it
	traps.append({"owner": owner_id, "i": i, "j": j, "x": c.x, "z": c.z, "node": g, "was": was, "grow": 0.0})
	WorldFx.dust(self, c.x, c.z, 8, Color("6a9a4a"), 1.0)

func _remove_traps_of(owner_id: String) -> void:
	for T in traps.duplicate():
		if T.owner == owner_id:
			_remove_trap(T, false)

func _remove_trap(T: Dictionary, snapped: bool) -> void:
	traps.erase(T)
	(T.node as Node3D).queue_free()
	if arena.tile(T.i, T.j) == "B":
		arena.set_tile(T.i, T.j, "." if T.was == "B" else String(T.was))
	if snapped:
		WorldFx.ring(self, T.x, T.z, 1.2, Color(1.0, 0.4, 0.6), 0.5)
		WorldFx.sparks(self, Vector3(T.x, 1.0, T.z), Color(0.5, 1.0, 0.4), 18, 5.0, 0.5, 0.14)

# A 3 m spore cloud for 3 s (Pip & Chomp gadget look event).
func puff(x: float, z: float) -> void:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 3.0
	sm.height = 6.0
	sm.radial_segments = 14
	sm.rings = 7
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.72, 0.65, 0.85, 0.5)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.material = m
	mi.mesh = sm
	mi.position = Vector3(x, 0.4, z)
	mi.scale = Vector3(1, 0.45, 1)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var tw := mi.create_tween()
	tw.tween_interval(2.5)
	tw.tween_property(m, "albedo_color:a", 0.0, 0.5)
	tw.tween_callback(mi.queue_free)

# ------------------------------------------------------------------ per frame

func update(delta: float, fighters: Dictionary, me: Fighter) -> void:
	t += delta
	if pad_mat:
		pad_mat.emission_energy_multiplier = 0.6 + 0.5 * sin(t * 5.0)
	for T in traps:
		T.grow = minf(1.0, float(T.grow) + delta / 0.4)
		(T.node as Node3D).scale = Vector3.ONE * maxf(0.01, float(T.grow) * 1.15 if float(T.grow) < 1.0 else 1.0)
	if sea_mat:
		sea_mat.uv1_offset.x += delta * 0.004
		_place_clouds(delta)
		_fly_birds()
		for I in islets:
			(I.g as Node3D).position.y = float(I.y) + sin(t * 0.5 + float(I.ph)) * 0.35
			if I.hub:
				(I.hub as Node3D).rotation.z += delta * 0.9
	_update_lifted(delta)
	for n in range(falling.size() - 1, -1, -1):
		var F: Dictionary = falling[n]
		F.vy += 18.0 * delta
		var node: Node3D = F.node
		node.position.y -= float(F.vy) * delta
		node.rotation.x += float(F.rx) * delta
		node.rotation.z += float(F.rz) * delta
		if F.get("shrink", false):
			node.scale = Vector3.ONE * maxf(0.05, node.scale.x - delta * 0.6)
		F.t = float(F.t) - delta
		if float(F.t) <= 0.0:
			node.queue_free()
			falling.remove_at(n)
	# the others' pad flights: the same arc, drawn on the model (the server moves them)
	for id in fighters:
		var f: Fighter = fighters[id]
		if f == me or not f.visible:
			continue
		if remote_air.has(id):
			remote_air[id] = float(remote_air[id]) - delta
			var u := clampf(float(remote_air[id]) / PAD_AIR, 0.0, 1.0)
			_lift(f, 4.0 * 1.3 * (1.0 - u) * u)
			if float(remote_air[id]) <= 0.0:
				remote_air.erase(id)
				_lift(f, 0.0)
		else:
			for p in pads:
				if Vector2(f.position.x - p.x, f.position.z - p.z).length() < 0.75:
					remote_air[id] = PAD_AIR
					break
