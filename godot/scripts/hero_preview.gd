class_name HeroPreview
extends SubViewportContainer
# The selected brawler as a slowly turning 3D model (own little world in a SubViewport, transparent
# background), like the figurine of the web menu (src/figurines.js). Falls back to the portrait
# picture when the model is missing. Rendering pauses while the menu is hidden.

var _vp: SubViewport
var _pivot: Node3D
var _cache: Dictionary = {}     # key -> Node3D (kept, models are big to decode)
var _current := ""
var _fallback: TextureRect
var _spin := 0.4

func _init() -> void:
	stretch = true
	custom_minimum_size = Vector2(300, 220)

func _ready() -> void:
	_vp = SubViewport.new()
	_vp.own_world_3d = true
	_vp.transparent_bg = true
	_vp.msaa_3d = Viewport.MSAA_2X
	_vp.render_target_update_mode = SubViewport.UPDATE_WHEN_PARENT_VISIBLE
	add_child(_vp)
	var cam := Camera3D.new()
	cam.fov = 30
	_vp.add_child(cam)
	cam.position = Vector3(0, 1.3, 7.2)
	cam.look_at(Vector3(0, 0.95, 0))
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -25, 0)
	sun.light_energy = 1.3
	_vp.add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-15, 150, 0)
	fill.light_energy = 0.5
	_vp.add_child(fill)
	var we := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.8, 0.82, 0.95)
	e.ambient_light_energy = 0.8
	we.environment = e
	_vp.add_child(we)
	_pivot = Node3D.new()
	_vp.add_child(_pivot)
	_fallback = TextureRect.new()
	_fallback.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_fallback.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_fallback.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_fallback.visible = false
	_fallback.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_fallback)

func show_brawler(key: String) -> void:
	if key == _current or _pivot == null:
		return
	_current = key
	for c in _pivot.get_children():
		_pivot.remove_child(c)
	var inst: Node3D = _cache.get(key)
	if inst == null:
		var path := "res://assets/models/%s.glb" % key
		if ResourceLoader.exists(path):
			inst = _instance(path)
			_cache[key] = inst
	if inst == null:
		_fallback.texture = UiKit.portrait(key)
		_fallback.visible = true
		return
	_fallback.visible = false
	_pivot.add_child(inst)
	_pivot.rotation.y = PI + 0.5

# The GLB scaled to a 2 m tall figure standing on the ground.
func _instance(path: String) -> Node3D:
	var inst: Node3D = (load(path) as PackedScene).instantiate()
	var holder := Node3D.new()
	holder.add_child(inst)
	_pivot.add_child(holder)   # in the tree so global transforms exist
	# Skinned meshes report a bogus AABB (y -1..1): the bones say where the figure really is
	# (feet on the ground, ~1.6 m tall), meshes without a skeleton use their box.
	var top := 0.0
	for sk in inst.find_children("*", "Skeleton3D", true, false):
		var ss := sk as Skeleton3D
		for b in ss.get_bone_count():
			top = maxf(top, ss.get_bone_global_pose(b).origin.y)
	if top <= 0.0:
		var box := AABB()
		var first := true
		for mi in inst.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			var a: AABB = (inst.global_transform.affine_inverse() * m.global_transform) * m.get_aabb()
			box = a if first else box.merge(a)
			first = false
		top = box.end.y
	var k := 2.0 / (top + 0.15)
	inst.scale = Vector3.ONE * k
	for ap in inst.find_children("*", "AnimationPlayer", true, false):
		var player := ap as AnimationPlayer
		for n in player.get_animation_list():
			if String(n).to_lower().contains("idle"):
				player.get_animation(n).loop_mode = Animation.LOOP_LINEAR
				player.play(n)
				break
	_pivot.remove_child(holder)
	return holder

func _process(delta: float) -> void:
	if is_visible_in_tree():
		_pivot.rotation.y += delta * _spin
