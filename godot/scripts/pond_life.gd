class_name PondLife
extends Node3D
# Life on the pools of Misty Marsh (src/ambient/maps/marsh.js): notched lily pads drifting and bobbing
# near the banks (a few with a pink flower), murky bubbles that swell on the surface and pop, and
# dragonflies that hover, then dart to a new point over the water. Cosmetic only, nothing reacts to
# brawlers (hide and seek in the fog). Counts follow Quality "fauna" like the web's density.

const WATER_Y := -0.16

var arena: Arena
var rng := RandomNumberGenerator.new()
var t := 0.0
var water: Array = []
var pads: Array = []
var flowers: Array = []
var bubbles: Array = []
var flies: Array = []
var pad_mm: MultiMesh
var flower_mm: MultiMesh
var bub_mm: MultiMesh
var fly_mm: MultiMesh

func setup(a: Arena, density: float) -> void:
	arena = a
	rng.seed = 4242
	for j in GameData.N:
		for i in GameData.N:
			if a.tile(i, j) == "W":
				water.append(Vector2i(i, j))
	if water.is_empty():
		return
	var n := func(k: int) -> int: return maxi(1, roundi(k * density))
	# lily pads near the banks
	var spots: Array = []
	for w in water:
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			if a.tile(w.x + d.x, w.y + d.y) != "W":
				spots.append(w)
				break
	if spots.is_empty():
		spots = water
	for k in n.call(14):
		var tl: Vector2i = spots[rng.randi() % spots.size()]
		var p := a.center(tl.x, tl.y) + Vector3((rng.randf() - 0.5) * 1.2, 0, (rng.randf() - 0.5) * 1.2)
		var pad := {"p": p, "r": 0.3 + rng.randf() * 0.18, "yaw": rng.randf() * 6.3, "ph": rng.randf() * 6.3}
		pads.append(pad)
		if rng.randf() < 0.3:
			flowers.append(pad)
	pad_mm = _multi(_pad_mesh(), pads.size(), Shore.material(0.7, false), true)
	for k in pads.size():
		pad_mm.set_instance_color(k, Color.hex(0x4f9d38ff).srgb_to_linear())
	flower_mm = _multi(_toy([
		[_cone(0.13, 0.1, 6), Transform3D(Basis.IDENTITY, Vector3(0, 0.05, 0)), 0xff8fc8],
		[_sphere(0.045), Transform3D(Basis.IDENTITY, Vector3(0, 0.1, 0)), 0xffe14a],
	]), flowers.size(), Shore.material(0.55, false), false)
	# bubbles on the murky surface
	for k in n.call(12):
		bubbles.append({"p": _in_water(), "c": -rng.randf() * 4.0, "grow": 0.8 + rng.randf() * 1.2, "s": 0.7 + rng.randf() * 0.6})
	var bm := StandardMaterial3D.new()
	bm.albedo_color = Color(Color.hex(0xcfe6b0ff), 0.8)
	bm.roughness = 0.08
	bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bub_mm = _multi(Shore.icosphere(), bubbles.size(), bm, false)
	# dragonflies around a few anchors over the water
	var anchors: Array = []
	for k in 5:
		anchors.append(_in_water())
	var wing := 0xe4f7ff
	var dragon := _toy([
		[_cyl(0.035, 0.02, 0.5, 6), Transform3D(Basis(Vector3.RIGHT, PI / 2.0), Vector3(0, 0, -0.08)), 0x2fc8ff],
		[_box(Vector3(0.11, 0.08, 0.1)), Transform3D(Basis.IDENTITY, Vector3(0, 0, 0.2)), 0x1b5f9a],
		[_tri(0.3, 0.09), Transform3D(Basis.IDENTITY, Vector3(0.02, 0.01, 0.1)), wing],
		[_tri(0.3, 0.09), Transform3D(Basis(Vector3.UP, PI), Vector3(-0.02, 0.01, 0.1)), wing],
		[_tri(0.26, 0.08), Transform3D(Basis.IDENTITY, Vector3(0.02, 0.01, 0.0)), wing],
		[_tri(0.26, 0.08), Transform3D(Basis(Vector3.UP, PI), Vector3(-0.02, 0.01, 0.0)), wing],
	])
	for k in n.call(8):
		var an: Vector3 = anchors[rng.randi() % anchors.size()]
		flies.append({"a": an, "pos": Vector3(an.x, 1.2, an.z), "to": Vector3(an.x, 1.2, an.z), "yaw": rng.randf() * 6.3,
			"wait": rng.randf() * 2.0, "dart": 0.0, "ph": rng.randf() * 6.3, "y": 0.9 + rng.randf() * 0.6, "s": 0.9 + rng.randf() * 0.3})
	fly_mm = _multi(dragon, flies.size(), Shore.material(0.4, true), false)
	update(0.0)

func _in_water() -> Vector3:
	var tl: Vector2i = water[rng.randi() % water.size()]
	return arena.center(tl.x, tl.y) + Vector3((rng.randf() - 0.5) * 1.3, WATER_Y, (rng.randf() - 0.5) * 1.3)

func _multi(mesh: Mesh, count: int, mat: Material, colors: bool) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.mesh = mesh
	mm.instance_count = count
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = mat
	mi.custom_aabb = AABB(Vector3(-30, -1, -30), Vector3(60, 4, 60))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mm

func update(delta: float) -> void:
	if water.is_empty():
		return
	t += delta
	for k in pads.size():
		var P: Dictionary = pads[k]
		var b := Basis(Vector3.UP, P.yaw + sin(t * 0.2 + P.ph) * 0.15).scaled(Vector3(P.r, 1, P.r))
		pad_mm.set_instance_transform(k, Transform3D(b, Vector3(P.p.x, _pad_top(P), P.p.z)))
	for k in flowers.size():
		var P: Dictionary = flowers[k]
		flower_mm.set_instance_transform(k, Transform3D(Basis(Vector3.UP, P.ph), Vector3(P.p.x + P.r * 0.3, _pad_top(P) + 0.02, P.p.z - P.r * 0.2)))
	for k in bubbles.size():
		var B: Dictionary = bubbles[k]
		B.c += delta
		var s := 0.0
		if B.c > B.grow + 0.12:   # popped: wait, somewhere else
			B.c = -(1.0 + rng.randf() * 4.0)
			B.p = _in_water()
			B.grow = 0.8 + rng.randf() * 1.2
		elif B.c > B.grow:
			s = 1.35 * (1.0 - (B.c - B.grow) / 0.12)
		elif B.c > 0.0:
			s = B.c / B.grow
		var sc: float = maxf(s * B.s, 0.0001) * 0.1
		bub_mm.set_instance_transform(k, Transform3D(Basis.from_scale(Vector3(sc, sc * 0.7, sc)), B.p))
	for k in flies.size():
		var d: Dictionary = flies[k]
		if d.dart > 0.0:
			d.dart -= delta
			d.pos = (d.pos as Vector3).lerp(d.to, minf(1.0, delta * 9.0))
		else:
			d.wait -= delta
			if d.wait <= 0.0:   # pick a point over the water nearby and zip there
				for tries in 6:
					var x: float = d.a.x + (rng.randf() - 0.5) * 5.0
					var z: float = d.a.z + (rng.randf() - 0.5) * 5.0
					d.to = Vector3(x, d.y + (rng.randf() - 0.5) * 0.3, z)
					if arena.char_at(x, z) == "W":
						break
				d.yaw = atan2(d.to.x - d.pos.x, d.to.z - d.pos.z)
				d.dart = 0.5
				d.wait = 0.8 + rng.randf() * 2.2
		var hov := 0.0 if d.dart > 0.0 else 1.0
		var v := Vector3(d.pos.x + sin(t * 3.0 + d.ph) * 0.04 * hov, d.pos.y + sin(t * 2.3 + d.ph) * 0.06, d.pos.z + cos(t * 2.7 + d.ph) * 0.04 * hov)
		var b := Basis(Vector3.UP, d.yaw + sin(t * 1.7 + d.ph) * 0.15 * hov)
		b = b * Basis.from_scale(Vector3(d.s * (0.35 + 0.65 * absf(cos(t * 45.0 + d.ph))), d.s, d.s))   # wing blur
		fly_mm.set_instance_transform(k, Transform3D(b, v))

func _pad_top(P: Dictionary) -> float:
	return WATER_Y + 0.02 + sin(t * 0.9 + P.ph) * 0.012

# ------------------------------------------------------------------ toy meshes (src/ambient/toy.js)

static func _box(s: Vector3) -> PrimitiveMesh:
	var m := BoxMesh.new()
	m.size = s
	return m

static func _sphere(r: float) -> PrimitiveMesh:
	var m := SphereMesh.new()
	m.radius = r
	m.height = r * 2.0
	m.radial_segments = 8
	m.rings = 4
	return m

static func _cone(r: float, h: float, seg: int) -> PrimitiveMesh:
	var m := CylinderMesh.new()
	m.top_radius = 0.0
	m.bottom_radius = r
	m.height = h
	m.radial_segments = seg
	m.rings = 0
	return m

static func _cyl(r1: float, r2: float, h: float, seg: int) -> PrimitiveMesh:
	var m := CylinderMesh.new()
	m.top_radius = r1
	m.bottom_radius = r2
	m.height = h
	m.radial_segments = seg
	m.rings = 0
	return m

# a flat triangle in XZ, tip toward +x (wings)
static func _tri(w: float, l: float) -> Array:
	return [Vector3(0, 0, l * 0.5), Vector3(w, 0, 0), Vector3(0, 0, -l * 0.5)]

# parts: [mesh or triangle, transform, colour hex]; flat normals and vertex colours like toy.js
static func _toy(parts: Array) -> ArrayMesh:
	var pos := PackedVector3Array()
	var col := PackedColorArray()
	for p in parts:
		var xf: Transform3D = p[1]
		var c := Color.hex((int(p[2]) << 8) | 0xFF).srgb_to_linear()
		var tris := PackedVector3Array()
		if p[0] is Array:
			for v in p[0]:
				tris.append(v)
		else:
			var arr: Array = (p[0] as PrimitiveMesh).get_mesh_arrays()
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var ix: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
			if ix.is_empty():
				tris = vs
			else:
				for i in ix:
					tris.append(vs[i])
		for v in tris:
			pos.append(xf * v)
			col.append(c)
	var nrm := PackedVector3Array()
	nrm.resize(pos.size())
	for k in range(0, pos.size(), 3):
		var n := (pos[k + 1] - pos[k]).cross(pos[k + 2] - pos[k])
		n = -n.normalized() if n.length_squared() > 1e-14 else Vector3.UP
		nrm[k] = n
		nrm[k + 1] = n
		nrm[k + 2] = n
	var arrs := []
	arrs.resize(Mesh.ARRAY_MAX)
	arrs[Mesh.ARRAY_VERTEX] = pos
	arrs[Mesh.ARRAY_NORMAL] = nrm
	arrs[Mesh.ARRAY_COLOR] = col
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrs)
	return m

# CylinderGeometry(1, 1, 0.04, 14, 1, false, 0.35, 2 pi - 0.7): a disc with a notch
static func _pad_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var seg := 14
	var a0 := 0.35
	var span := TAU - 0.7
	var hy := 0.02
	var ring: Array = []
	for k in seg + 1:
		var a := a0 + span * k / seg
		ring.append(Vector3(sin(a), 0, cos(a)))   # three's theta: x = sin, z = cos
	for k in seg:
		var p: Vector3 = ring[k]
		var q: Vector3 = ring[k + 1]
		# top (clockwise from above for Godot) and bottom
		for v in [[Vector3(0, hy, 0), Vector3.UP], [q + Vector3(0, hy, 0), Vector3.UP], [p + Vector3(0, hy, 0), Vector3.UP],
				[Vector3(0, -hy, 0), Vector3.DOWN], [p - Vector3(0, hy, 0), Vector3.DOWN], [q - Vector3(0, hy, 0), Vector3.DOWN]]:
			st.set_normal(v[1])
			st.add_vertex(v[0])
		# rim
		var n := ((p + q) * 0.5).normalized()
		for v in [p + Vector3(0, hy, 0), q + Vector3(0, hy, 0), q - Vector3(0, hy, 0), p + Vector3(0, hy, 0), q - Vector3(0, hy, 0), p - Vector3(0, hy, 0)]:
			st.set_normal(n)
			st.add_vertex(v)
	return st.commit()
