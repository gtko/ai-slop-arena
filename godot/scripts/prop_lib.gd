class_name PropLib
extends RefCounted
# Sculpted decor GLBs (godot/assets/models/decor), fitted like src/props.js does: set on the
# ground, centred on their footprint, scaled to a box / height / width. Instanced with MultiMesh
# (one draw call per prop kind), which is what keeps trees, walls and bushes cheap on mobile.
# They are drawn with assets/shaders/prop.gdshader (the web's prop material: cartoon light ramp, rim
# light, wind bend for trees and cacti), see `material`.

const SWAY := ["tree_round", "tree_pine", "tree_pine_snow", "tree_dead", "bush", "cactus"]

static var _cache: Dictionary = {}
static var _mats: Dictionary = {}

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
	mmi.material_override = mat if mat else material(prop_name) # foliage: sway + bush reveal (foliage.gd)
	if has(prop_name + "_low"):
		mmi.set_meta("prop", prop_name)   # set_low can swap in its Low tier copy
	return mmi

# Low tier: a MultiMesh of a prop with a decimated copy (<prop>_low.glb, 20-45 % of the triangles, made
# by tools/convert-models.mjs) draws that copy instead. A MultiMesh picks one LOD for all its instances
# from its whole bounding box, which reaches the camera: Godot's own LODs never kick in for the decor
# (a map's ring of trees drew ~130 trees x 1500 triangles on Low). Same material, same placement: the
# two meshes share the GLB's scene space, so each instance only changes by the two node transforms.
static func set_low(mmi: MultiMeshInstance3D, on: bool) -> void:
	if not mmi.has_meta("prop") or bool(mmi.get_meta("low", false)) == on:
		return
	var full := info(String(mmi.get_meta("prop")))
	var low := info(String(mmi.get_meta("prop")) + "_low")
	if full.is_empty() or low.is_empty():
		return
	var corr: Transform3D = (full.xf as Transform3D).affine_inverse() * (low.xf as Transform3D)
	if not on:
		corr = corr.affine_inverse()
	var mm := mmi.multimesh
	mm.mesh = low.mesh if on else full.mesh
	for k in mm.instance_count:
		mm.set_instance_transform(k, mm.get_instance_transform(k) * corr)
	mmi.set_meta("low", on)

# The prop's shader material (src/props.js `prepare`): its GLB texture, roughness 0.78, no metal,
# rim light, the wind bend for trees and cacti.
static func material(prop_name: String) -> Material:
	if _mats.has(prop_name):
		return _mats[prop_name]
	Foliage.ensure_globals()
	var p := info(prop_name)
	var m := ShaderMaterial.new()
	m.shader = load("res://assets/shaders/prop.gdshader")
	m.set_shader_parameter("sway", 1.0 if SWAY.has(prop_name) else 0.0)
	var src: BaseMaterial3D = null
	var mesh: Mesh = p.get("mesh")
	if mesh and mesh.get_surface_count() > 0:
		src = mesh.surface_get_material(0) as BaseMaterial3D
	if src and src.albedo_texture:
		m.set_shader_parameter("albedo_tex", src.albedo_texture)
		m.set_shader_parameter("use_tex", 1.0)
	else:
		m.set_shader_parameter("use_tex", 0.0)
	if src:
		m.set_shader_parameter("albedo", src.albedo_color)
	_mats[prop_name] = m
	return m

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
	mi.material_override = material(prop_name)
	var root := Node3D.new()
	root.add_child(mi)
	return root
