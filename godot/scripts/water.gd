class_name Water
extends Node3D
# Water in a sunken basin (src/water.js, shore.js, cheap version): the floor has holes over the 'W'
# tiles; a sand bed 0.85 m down, four bank walls and one transparent animated surface (MultiMesh, one
# draw call, assets/shaders/water.gdshader). The swamp variant of Misty Marsh is olive and murky.

const WATER_Y := -0.16
const BED_Y := -0.85

var mat: ShaderMaterial

func build(arena: Arena, tiles: Array, style: String) -> void:
	var swamp := style == "swamp"
	var dry := Color("6e6248") if swamp else (Color("e6b98c") if arena.map.get("ground", "") == "cartoon" else Color("8a7458"))
	var wet := Color("4a4234") if swamp else (Color("8a7458") if arena.map.get("ground", "") == "cartoon" else Color("62563f"))
	var set := {}
	for t in tiles:
		set[t.y * GameData.N + t.x] = true
	# bed
	var bed := PlaneMesh.new()
	bed.size = Vector2(GameData.TILE, GameData.TILE)
	var bm := StandardMaterial3D.new()
	bm.albedo_color = wet.lerp(dry, 0.25)
	bm.roughness = 1.0
	bed.material = bm
	var bmm := MultiMesh.new()
	bmm.transform_format = MultiMesh.TRANSFORM_3D
	bmm.mesh = bed
	bmm.instance_count = tiles.size()
	# surface
	var surf := PlaneMesh.new()
	surf.size = Vector2(GameData.TILE, GameData.TILE)
	mat = ShaderMaterial.new()
	mat.shader = load("res://assets/shaders/water.gdshader")
	mat.set_shader_parameter("shallow", Color("5a7a3a") if swamp else Color("1fb8d8"))
	mat.set_shader_parameter("deep", Color("1e3a22") if swamp else Color("0a4c96"))
	mat.set_shader_parameter("murk", 1.0 if swamp else 0.0)
	mat.set_shader_parameter("sky_col", Color("b8c8b0") if swamp else Color("c6e1ff"))
	surf.material = mat
	var smm := MultiMesh.new()
	smm.transform_format = MultiMesh.TRANSFORM_3D
	smm.use_custom_data = true
	smm.mesh = surf
	smm.instance_count = tiles.size()
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var h := GameData.TILE / 2.0
	for k in tiles.size():
		var t: Vector2i = tiles[k]
		var c := arena.center(t.x, t.y)
		bmm.set_instance_transform(k, Transform3D(Basis.IDENTITY, c + Vector3(0, BED_Y, 0)))
		smm.set_instance_transform(k, Transform3D(Basis.IDENTITY, c + Vector3(0, WATER_Y, 0)))
		# edge flags: land on -x, +x, -z, +z
		var land := [not set.has(t.y * GameData.N + t.x - 1) and arena.tile(t.x - 1, t.y) != "V", not set.has(t.y * GameData.N + t.x + 1) and arena.tile(t.x + 1, t.y) != "V",
			not set.has((t.y - 1) * GameData.N + t.x) and arena.tile(t.x, t.y - 1) != "V", not set.has((t.y + 1) * GameData.N + t.x) and arena.tile(t.x, t.y + 1) != "V"]
		smm.set_instance_custom_data(k, Color(1.0 if land[0] else 0.0, 1.0 if land[1] else 0.0, 1.0 if land[2] else 0.0, 1.0 if land[3] else 0.0))
		# bank walls (facing the water)
		var corners := [
			[land[0], Vector3(-h, 0, h), Vector3(-h, 0, -h), Vector3(1, 0, 0)],
			[land[1], Vector3(h, 0, -h), Vector3(h, 0, h), Vector3(-1, 0, 0)],
			[land[2], Vector3(-h, 0, -h), Vector3(h, 0, -h), Vector3(0, 0, 1)],
			[land[3], Vector3(h, 0, h), Vector3(-h, 0, h), Vector3(0, 0, -1)]]
		for w in corners:
			if not w[0]:
				continue
			var a: Vector3 = c + w[1]
			var b: Vector3 = c + w[2]
			var n: Vector3 = w[3]
			var top := -0.02
			var pts := [Vector3(a.x, top, a.z), Vector3(b.x, top, b.z), Vector3(b.x, BED_Y, b.z), Vector3(a.x, BED_Y, a.z)]
			var cols := [dry, dry, wet, wet]
			for q in [0, 1, 2, 0, 2, 3]:
				st.set_color(cols[q])
				st.set_normal(n)
				st.add_vertex(pts[q])
	var bmi := MultiMeshInstance3D.new()
	bmi.multimesh = bmm
	bmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(bmi)
	var smi := MultiMeshInstance3D.new()
	smi.multimesh = smm
	smi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(smi)
	var banks := st.commit()
	var bkm := StandardMaterial3D.new()
	bkm.vertex_color_use_as_albedo = true
	bkm.roughness = 1.0
	bkm.cull_mode = BaseMaterial3D.CULL_DISABLED
	banks.surface_set_material(0, bkm)
	var kmi := MeshInstance3D.new()
	kmi.mesh = banks
	kmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(kmi)
	apply_quality()

func apply_quality() -> void:
	if mat:
		mat.set_shader_parameter("detail", 1.0 if int(Quality.preset().water) > 0 else 0.0)

func update(_delta: float) -> void:
	pass
