class_name PropLib
extends RefCounted
# Sculpted decor GLBs (godot/assets/models/decor), fitted like src/props.js does: set on the
# ground, centred on their footprint, scaled to a box / height / width. Instanced with MultiMesh
# (one draw call per prop kind), which is what keeps trees, walls and bushes cheap on mobile.

static var _cache: Dictionary = {}

static func has(prop: String) -> bool:
	return ResourceLoader.exists("res://assets/models/decor/%s.glb" % prop)

static func info(prop: String) -> Dictionary:
	if _cache.has(prop):
		return _cache[prop]
	var res := {}
	if has(prop):
		var scene := (load("res://assets/models/decor/%s.glb" % prop) as PackedScene).instantiate()
		var mi: MeshInstance3D = null
		for n in scene.find_children("*", "MeshInstance3D", true, false):
			mi = n
			break
		if mi:
			# glTF materials without pbr data default to metallic 1: black without an environment map
			for s in mi.mesh.get_surface_count():
				var bm := mi.mesh.surface_get_material(s) as BaseMaterial3D
				if bm:
					bm.metallic = 0.0
			var xf := Transform3D.IDENTITY
			var n: Node = mi
			while n != null and n != scene:
				xf = (n as Node3D).transform * xf
				n = n.get_parent()
			var box: AABB = xf * mi.get_aabb()
			res = {"mesh": mi.mesh, "xf": xf, "size": box.size,
				"offset": Vector3(-(box.position.x + box.size.x / 2.0), -box.position.y, -(box.position.z + box.size.z / 2.0))}
		scene.free()
	_cache[prop] = res
	return res

# fit: {"box": Vector3} | {"height": f} | {"width": f}
static func scale_for(size: Vector3, fit: Dictionary) -> Vector3:
	if fit.has("box"):
		var b: Vector3 = fit.box
		return Vector3(b.x / size.x, b.y / size.y, b.z / size.z)
	var k: float = fit.height / size.y if fit.has("height") else fit.width / maxf(size.x, size.z)
	return Vector3.ONE * k

# One prop placement: world position, yaw, extra scale. Returns the transform for a MultiMesh.
static func placement(prop: Dictionary, fit: Dictionary, pos: Vector3, yaw: float, mul := 1.0, ysq := 1.0) -> Transform3D:
	var sz: Vector3 = prop.size
	var s := scale_for(sz, fit) * mul
	s.y *= ysq
	var off: Vector3 = prop.offset
	var xf: Transform3D = prop.xf
	var local: Transform3D = Transform3D(Basis.from_scale(s), Vector3.ZERO) * Transform3D(Basis.IDENTITY, off) * xf
	return Transform3D(Basis(Vector3.UP, yaw), pos) * local

static func multi(prop_name: String, fit: Dictionary, placements: Array, shadows := true, mat: Material = null) -> MultiMeshInstance3D:
	var p := info(prop_name)
	if p.is_empty() or placements.is_empty():
		return null
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = p.mesh
	mm.instance_count = placements.size()
	for k in placements.size():
		var d: Dictionary = placements[k]
		mm.set_instance_transform(k, placement(p, fit, d.pos, d.get("yaw", 0.0), d.get("mul", 1.0), d.get("ysq", 1.0)))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if mat:
		mmi.material_override = mat # foliage: sway + bush reveal (foliage.gd)
	return mmi

# Single (non-instanced) prop, for the windmill and its sails.
static func single(prop_name: String, fit: Dictionary) -> Node3D:
	var p := info(prop_name)
	if p.is_empty():
		return null
	var mi := MeshInstance3D.new()
	mi.mesh = p.mesh
	var sz: Vector3 = p.size
	var off: Vector3 = p.offset
	var xf: Transform3D = p.xf
	mi.transform = Transform3D(Basis.from_scale(scale_for(sz, fit)), Vector3.ZERO) * Transform3D(Basis.IDENTITY, off) * xf
	var root := Node3D.new()
	root.add_child(mi)
	return root
