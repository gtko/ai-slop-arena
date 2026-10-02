class_name Shore
extends RefCounted
# Shore dressing of the ponds and frozen ponds (src/shore.js shoreDecor, src/arena.js groundGeometry):
#  - rounded pebbles on the bank and reed clumps (cattails on the marsh) at the waterline, wherever
#    the land field (water.gd) crosses the shore level next to a 'W' or 'I' tile;
#  - the soft snow bank that rings the frozen ponds of Frostbite Peak (a band of floor raised 7 cm
#    between field 0.5 and 0.64).
# Same seeds and the same random sequence (mulberry32) as the web build, so every pebble and reed
# sits where it does there.

const STYLE := {
	"oasis": {"pebble": [0xd9a47c, 0xc4876a, 0xe8c29a], "reed": [0x6f8f3a, 0xd0c060], "heads": false},
	"grove": {"pebble": [0x8d9088, 0x7a7d76, 0xa3a59c], "reed": [0x2f5a2a, 0x86b24e], "heads": false},
	"marsh": {"pebble": [0x6d6a5e, 0x7c7666, 0x5d5a50], "reed": [0x4a5528, 0xa8a45a], "heads": true},
	"ice": {"pebble": [0xb4c2d6, 0xa2b1c8, 0xd4def0], "reed": []},
}

# ------------------------------------------------------------------ mulberry32 (materials.js)

class Mulberry:
	var s := 0
	func _init(seed: int) -> void:
		s = seed & 0xFFFFFFFF
	func next() -> float:
		s = (s + 0x6d2b79f5) & 0xFFFFFFFF
		var t := _imul(s ^ (s >> 15), 1 | s)
		t = ((t + _imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
		return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
	static func _imul(a: int, b: int) -> int:
		return (a * b) & 0xFFFFFFFF   # int64 wraps: the low 32 bits stay exact

static func _lin(hex: int) -> Color:
	return Color.hex((hex << 8) | 0xFF).srgb_to_linear()

# ------------------------------------------------------------------ field helpers

# shore.js TileField.edge: points where the field crosses `level`, with the outward normal
# (towards lower values, i.e. the water).
static func edge(w: Water, level: float) -> Array:
	var out: Array = []
	var S := w.S
	var f := w.field
	for sz in S:
		for sx in S:
			var o := sz * S + sx
			var v := f[o] - level
			var x := sx * w.h - w.half
			var z := sz * w.h - w.half
			if sx < S - 1 and v * (f[o + 1] - level) < 0.0:
				out.append(_edge_pt(w, x + w.h * v / (v - f[o + 1] + level), z))
			if sz < S - 1 and v * (f[o + S] - level) < 0.0:
				out.append(_edge_pt(w, x, z + w.h * v / (v - f[o + S] + level)))
	return out

static func _edge_pt(w: Water, x: float, z: float) -> Vector4:
	var gx := w.at(x + 0.1, z) - w.at(x - 0.1, z)
	var gz := w.at(x, z + 0.1) - w.at(x, z - 0.1)
	var l := sqrt(gx * gx + gz * gz)
	if l == 0.0:
		l = 1.0
	return Vector4(x, z, -gx / l, -gz / l)

# ------------------------------------------------------------------ pebbles and reeds

static func decor(parent: Node3D, w: Water, a: Arena, style: String, bank: float, seed := 5) -> void:
	var st: Dictionary = STYLE.get(style, STYLE.grove)
	var rnd := Mulberry.new(seed)
	var pts: Array = []
	for p in edge(w, 0.5):
		if _near_pond(a, p.x, p.y):
			pts.append(p)
	if pts.is_empty():
		return
	for k in range(pts.size() - 1, 0, -1):   # shuffle, then keep the points far enough apart
		var m := int(floor(rnd.next() * (k + 1)))
		var tmp = pts[k]
		pts[k] = pts[m]
		pts[m] = tmp
	var peb := _spaced(pts, 0.9, 90)
	if not peb.is_empty():
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = icosphere()
		mm.instance_count = peb.size()
		var cols: Array = st.pebble
		for k in peb.size():
			var p: Vector4 = peb[k]
			var d := bank * (0.2 + rnd.next() * 0.9)
			var r := 0.1 + rnd.next() * 0.16
			var rot := rnd.next() * 6.28
			var sx := r * (1.0 + rnd.next() * 0.5)
			var b := Basis(Vector3.UP, rot) * Basis.from_scale(Vector3(sx, r * 0.55, r))
			mm.set_instance_transform(k, Transform3D(b, Vector3(p.x - p.z * d, 0.01, p.y - p.w * d)))
			mm.set_instance_color(k, _lin(int(cols[k % cols.size()])) * (0.9 + rnd.next() * 0.2))
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.material_override = material(0.85, false)
		parent.add_child(mi)
	var reed: Array = st.reed
	if reed.is_empty():
		return
	var reeds: Array = []
	for p in _spaced(pts, 1.6, 40):
		if rnd.next() < 0.7:
			reeds.append(p)
	if reeds.is_empty():
		return
	var rm := MultiMesh.new()
	rm.transform_format = MultiMesh.TRANSFORM_3D
	rm.mesh = _reed_mesh(int(reed[0]), int(reed[1]), bool(st.heads))
	rm.instance_count = reeds.size()
	for k in reeds.size():
		var p: Vector4 = reeds[k]
		var d := (rnd.next() - 0.35) * 0.5   # mostly in the shallows, some on the bank
		var s := 0.8 + rnd.next() * 0.5
		var rot := rnd.next() * 6.28
		rm.set_instance_transform(k, Transform3D(Basis(Vector3.UP, rot).scaled(Vector3(s, s, s)), Vector3(p.x + p.z * d, -0.12, p.y + p.w * d)))
	var ri := MultiMeshInstance3D.new()
	ri.multimesh = rm
	ri.material_override = material(0.8, true)
	parent.add_child(ri)

# arena.js: only the shores of a pond (a 'W' or 'I' tile around)
static func _near_pond(a: Arena, x: float, z: float) -> bool:
	var i := a.to_tile(x)
	var j := a.to_tile(z)
	for dj in range(-1, 2):
		for di in range(-1, 2):
			var c := a.tile(i + di, j + dj)
			if c == "W" or c == "I":
				return true
	return false

static func _spaced(pts: Array, mn: float, n: int) -> Array:
	var out: Array = []
	var m2 := mn * mn
	for p in pts:
		if out.size() >= n:
			break
		var ok := true
		for q in out:
			if (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) <= m2:
				ok = false
				break
		if ok:
			out.append(p)
	return out

static var _mats := {}

static func material(rough: float, two_sided: bool) -> ShaderMaterial:
	var key := "%s_%s" % [rough, two_sided]
	if _mats.has(key):
		return _mats[key]
	var m := ShaderMaterial.new()
	m.shader = load("res://assets/shaders/reed.gdshader" if two_sided else "res://assets/shaders/shore.gdshader")
	m.set_shader_parameter("roughness", rough)
	_mats[key] = m
	return m

static var _ico: ArrayMesh

# three.js IcosahedronGeometry(1, 1): 80 faces, smooth normals (the positions)
static func icosphere() -> ArrayMesh:
	if _ico:
		return _ico
	var t := (1.0 + sqrt(5.0)) / 2.0
	var v := [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
		Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	var f := [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
		3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in range(0, f.size(), 3):
		var a: Vector3 = v[f[k]].normalized()
		var b: Vector3 = v[f[k + 1]].normalized()
		var c: Vector3 = v[f[k + 2]].normalized()
		var ab := ((a + b) * 0.5).normalized()
		var bc := ((b + c) * 0.5).normalized()
		var ca := ((c + a) * 0.5).normalized()
		for tri in [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]:
			for p in [tri[0], tri[2], tri[1]]:   # Godot's front faces are clockwise
				st.set_normal(p)
				st.add_vertex(p)
	_ico = st.commit()
	return _ico

# shore.js reedGeometry: nine thin blades, every third with a cattail head on the marsh; vertex colours
# from root to tip; normals bent towards the sky so the blades light like the ground below them.
static func _reed_mesh(root_hex: int, tip_hex: int, heads: bool) -> ArrayMesh:
	var r := Mulberry.new(11)
	var cr := _lin(root_hex)
	var ct := _lin(tip_hex)
	var ch := _lin(0x5a3a22)
	var pos := PackedVector3Array()
	var col := PackedColorArray()
	# three's (a b c, a c d) wound the other way: Godot's front faces are clockwise
	var quad := func(a: Vector3, b: Vector3, c: Vector3, d: Vector3, ca: Color, cb: Color) -> void:
		pos.append_array([a, c, b, a, d, c])
		col.append_array([ca, cb, ca, ca, cb, cb])
	for k in 9:
		var an := r.next() * PI * 2.0
		var dd := r.next() * 0.16
		var x := cos(an) * dd
		var z := sin(an) * dd
		var H := 0.45 + r.next() * 0.45
		var lean := 0.1 + r.next() * 0.2
		var lx := cos(an) * lean
		var lz := sin(an) * lean
		var wd := 0.035 + r.next() * 0.02
		var px := -sin(an) * wd
		var pz := cos(an) * wd
		var mid := Vector3(x + lx * 0.3, H * 0.55, z + lz * 0.3)
		var top := Vector3(x + lx, H, z + lz)
		var cm := cr.lerp(ct, 0.55)
		quad.call(Vector3(x - px, 0, z - pz), Vector3(x + px, 0, z + pz), mid + Vector3(px * 0.7, 0, pz * 0.7), mid - Vector3(px * 0.7, 0, pz * 0.7), cr, cm)
		quad.call(mid - Vector3(px * 0.7, 0, pz * 0.7), mid + Vector3(px * 0.7, 0, pz * 0.7), top, top, cm, ct)
		if heads and k % 3 == 0:   # cattail: a brown sausage near the top, a cross of two quads
			var hy := H * 0.78
			var hx := x + lx * 0.8
			var hz := z + lz * 0.8
			var hw := 0.05
			quad.call(Vector3(hx - hw, hy - 0.1, hz), Vector3(hx + hw, hy - 0.1, hz), Vector3(hx + hw, hy + 0.1, hz), Vector3(hx - hw, hy + 0.1, hz), ch, ch)
			quad.call(Vector3(hx, hy - 0.1, hz - hw), Vector3(hx, hy - 0.1, hz + hw), Vector3(hx, hy + 0.1, hz + hw), Vector3(hx, hy + 0.1, hz - hw), ch, ch)
	# face normals (three's computeVertexNormals on its own winding), then bent up
	var nrm := PackedVector3Array()
	nrm.resize(pos.size())
	for k in range(0, pos.size(), 3):
		var n := (pos[k + 2] - pos[k]).cross(pos[k + 1] - pos[k])
		n = n.normalized() if n.length_squared() > 1e-12 else Vector3.UP
		var b := Vector3(n.x * 0.3, 1.0, n.z * 0.3).normalized()
		nrm[k] = b
		nrm[k + 1] = b
		nrm[k + 2] = b
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = pos
	arr[Mesh.ARRAY_NORMAL] = nrm
	arr[Mesh.ARRAY_COLOR] = col
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

# ------------------------------------------------------------------ the snow bank around frozen ponds

# arena.js groundGeometry (ice maps): between field 0.5 (the ice's edge) and 0.64 the floor rises in a
# soft bump, 0.07 * sin(pi * (f - 0.5) / 0.14), with smooth normals. Drawn with the floor's material.
static func snow_bank(parent: Node3D, w: Water, mat: Material) -> void:
	var lo := 0.5
	var hi := 0.64
	var S := w.S
	var f := w.field
	var h := w.h
	var verts := {}
	var pos := PackedVector3Array()
	var idx := PackedInt32Array()
	var vert := func(x: float, z: float, v: float) -> int:
		var key := Vector2i(roundi(x * 1000.0), roundi(z * 1000.0))
		if verts.has(key):
			return verts[key]
		var k := pos.size()
		verts[key] = k
		pos.append(Vector3(x, 0.07 * sin(PI * clampf((v - lo) / (hi - lo), 0.0, 1.0)), z))
		return k
	for b in S - 1:
		for a in S - 1:
			var o := b * S + a
			var v00 := f[o]
			var v10 := f[o + 1]
			var v01 := f[o + S]
			var v11 := f[o + S + 1]
			var mn := minf(minf(v00, v10), minf(v01, v11))
			var mx := maxf(maxf(v00, v10), maxf(v01, v11))
			if mx < lo or mn >= hi:
				continue
			var x := a * h - w.half
			var z := b * h - w.half
			var p00 := Vector3(x, z, v00)
			var p10 := Vector3(x + h, z, v10)
			var p01 := Vector3(x, z + h, v01)
			var p11 := Vector3(x + h, z + h, v11)
			for poly in [[p00, p10, p11], [p00, p11, p01]]:
				var q: Array = _clip(_clip(poly, lo, true), hi, false)
				if q.size() < 3:
					continue
				var ids: Array = []
				for p in q:
					ids.append(vert.call(p.x, p.y, p.z))
				for k in range(1, ids.size() - 1):
					var A: Vector3 = pos[ids[0]]
					var B: Vector3 = pos[ids[k]]
					var C: Vector3 = pos[ids[k + 1]]
					var cr := (B.x - A.x) * (C.z - A.z) - (B.z - A.z) * (C.x - A.x)
					if absf(cr) < 1e-7:
						continue
					# Godot front faces are clockwise seen from the normal side (up)
					if cr > 0.0:
						idx.append_array([ids[0], ids[k], ids[k + 1]])
					else:
						idx.append_array([ids[0], ids[k + 1], ids[k]])
	if idx.is_empty():
		return
	var nrm := PackedVector3Array()
	nrm.resize(pos.size())
	for k in range(0, idx.size(), 3):
		var n := (pos[idx[k + 2]] - pos[idx[k]]).cross(pos[idx[k + 1]] - pos[idx[k]])
		for q in 3:
			nrm[idx[k + q]] += n
	for k in nrm.size():
		nrm[k] = nrm[k].normalized() if nrm[k].length_squared() > 0.0 else Vector3.UP
		if nrm[k].y < 0.0:
			nrm[k] = -nrm[k]
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = pos
	arr[Mesh.ARRAY_NORMAL] = nrm
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = m
	mi.material_override = mat
	parent.add_child(mi)

# Sutherland-Hodgman against one field level (points: x, z, field value)
static func _clip(poly: Array, lvl: float, above: bool) -> Array:
	var out: Array = []
	var n := poly.size()
	for k in n:
		var A: Vector3 = poly[k]
		var B: Vector3 = poly[(k + 1) % n]
		var ia := A.z >= lvl if above else A.z < lvl
		var ib := B.z >= lvl if above else B.z < lvl
		if ia:
			out.append(A)
		if ia != ib:
			var t := (lvl - A.z) / (B.z - A.z)
			out.append(Vector3(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, lvl))
	return out
