class_name MeshMerge
extends RefCounted
# Bakes small assemblies of primitive meshes (a mushroom: stem, cap, dots; a far islet: rock, grass,
# trees, tower) into one ArrayMesh, so they cost one draw call instead of one per part: on mobile
# GPUs (Vulkan Mobile on an Adreno 650) each draw and each material switch costs CPU and driver time.
# Parts whose materials only differ by colour and roughness share one surface, the colour moved to
# the vertices (sRGB like albedo_color) and the roughness averaged; parts with emission, another
# shading mode or a material marked `keep` get their own surface and keep their material.
#
#   var mesh := MeshMerge.bake([[stem_mesh, Transform3D(...)], [cap_mesh, xf, true]])  # true = keep material

static var _mats: Dictionary = {}   # roughness bucket -> shared vertex-colour material

static func bake(parts: Array) -> ArrayMesh:
	var groups := {}   # key -> {"mat": Material, "pos", "nor", "col", "idx", "rough": [sum, n]}
	var order: Array = []
	for part in parts:
		var mesh: Mesh = part[0]
		var xf: Transform3D = part[1]
		var keep: bool = part.size() > 2 and bool(part[2])
		for s in mesh.get_surface_count():
			var mat := mesh.surface_get_material(s)
			if mat == null and mesh is PrimitiveMesh:
				mat = (mesh as PrimitiveMesh).material
			var bm := mat as BaseMaterial3D
			var plain := bm != null and not keep and not bm.emission_enabled and bm.shading_mode == BaseMaterial3D.SHADING_MODE_PER_PIXEL \
				and bm.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED and bm.albedo_texture == null and bm.cull_mode == BaseMaterial3D.CULL_BACK
			var key: Variant = "plain" if plain else mat
			if not groups.has(key):
				groups[key] = {"mat": mat, "pos": PackedVector3Array(), "nor": PackedVector3Array(), "col": PackedColorArray(), "idx": PackedInt32Array(), "rough": [0.0, 0]}
				order.append(key)
			var g: Dictionary = groups[key]
			var arr := mesh.surface_get_arrays(s)
			var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var norms: PackedVector3Array = arr[Mesh.ARRAY_NORMAL] if arr[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
			var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			var base: int = (g.pos as PackedVector3Array).size()
			var col := bm.albedo_color if bm and plain else Color.WHITE
			var nb := xf.basis.inverse().transposed()
			for k in verts.size():
				g.pos.append(xf * verts[k])
				g.nor.append((nb * norms[k]).normalized() if k < norms.size() else Vector3.UP)
				g.col.append(col)
			if idx.is_empty():
				for k in verts.size():
					g.idx.append(base + k)
			else:
				for k in idx:
					g.idx.append(base + k)
			if plain:
				g.rough[0] += bm.roughness
				g.rough[1] += 1
	var out := ArrayMesh.new()
	for key in order:
		var g: Dictionary = groups[key]
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = g.pos
		arr[Mesh.ARRAY_NORMAL] = g.nor
		arr[Mesh.ARRAY_INDEX] = g.idx
		if key is String:
			arr[Mesh.ARRAY_COLOR] = g.col
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		var si := out.get_surface_count() - 1
		if key is String:
			out.surface_set_material(si, _vc_material(float(g.rough[0]) / maxf(1.0, float(g.rough[1]))))
		elif g.mat:
			out.surface_set_material(si, g.mat)
	return out

# One material per roughness step (0.05), shared by every baked mesh: batches stay together.
static func _vc_material(rough: float) -> StandardMaterial3D:
	var r := snappedf(rough, 0.05)
	if _mats.has(r):
		return _mats[r]
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.vertex_color_is_srgb = true
	m.roughness = r
	_mats[r] = m
	return m
