class_name Fighter
extends Node3D
# One brawler on screen. The server owns the truth; remote fighters glide to the last snapshot.

var id := ""
var fname := ""
var type: Dictionary
var alive := true
var is_local := false
var hp := 1.0
var max_hp := 1.0
var ammo := 0.0
var super_charge := 0.0
var cubes := 0
var flags := 0
var target := Vector3.ZERO
var facing := 0.0
var hidden_by_server := false
var _body: MeshInstance3D
var _model: Node3D
var _anim: AnimationPlayer
var _cur_anim := ""
var _last_pos := Vector3.ZERO
var _bar: MeshInstance3D
var _bar_mat: StandardMaterial3D
var _label: Label3D
var _meshes: Array[MeshInstance3D] = []
var _flash_mat: StandardMaterial3D
var _flash_t := 0.0
var _faded := false
var _emote: Label3D
var _emote_t := 0.0

var radius: float:
	get: return float(type.get("radius", 0.62))

func setup(row: Dictionary, brawlers: Dictionary) -> void:
	id = row.id
	fname = row.name
	var key := String(row.type).split(":")[0]
	type = brawlers.get(key, brawlers.blaster)
	max_hp = float(type.hp)
	hp = max_hp
	var pal: Dictionary = type.palette
	var mat := StandardMaterial3D.new()
	mat.albedo_color = GameData.color_of(pal.main)
	mat.roughness = 0.7
	var glb := "res://assets/models/%s.glb" % key
	if ResourceLoader.exists(glb):
		_load_model(glb)
	else:
		_capsule(mat)
	for mi in find_children("*", "MeshInstance3D", true, false):
		_meshes.append(mi as MeshInstance3D)
	Skins.apply(self, row)  # WORLD hook
	_hud()

# The sculpted GLB, scaled to a 1.9 m tall brawler standing on the ground (models differ in size).
func _load_model(path: String) -> void:
	var inst: Node3D = (load(path) as PackedScene).instantiate()
	add_child(inst)
	var box := AABB()
	var first := true
	for mi in inst.find_children("*", "MeshInstance3D", true, false):
		var a: AABB = (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
		box = a if first else box.merge(a)
		first = false
	var k := 1.9 / maxf(box.size.y, 0.01)
	inst.scale = Vector3.ONE * k
	inst.position.y = -box.position.y * k
	_model = inst
	for ap in inst.find_children("*", "AnimationPlayer", true, false):
		_anim = ap
	_play("idle")

func _play(kind: String) -> void:
	if _anim == null or kind == _cur_anim:
		return
	for n in _anim.get_animation_list():
		if String(n).to_lower().contains(kind):
			_cur_anim = kind
			_anim.get_animation(n).loop_mode = Animation.LOOP_LINEAR
			_anim.play(n)
			return

# One-shot clips (Shoot, Death); the idle/run logic resumes afterwards.
func play_once(kind: String) -> void:
	if _anim == null:
		return
	for n in _anim.get_animation_list():
		if String(n).to_lower() == kind:
			_anim.get_animation(n).loop_mode = Animation.LOOP_NONE
			_anim.play(n)
			_cur_anim = "once"
			return

func _capsule(mat: StandardMaterial3D) -> void:
	var pal: Dictionary = type.palette
	_body = MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = radius * 0.85
	cap.height = 1.7
	cap.radial_segments = 16
	cap.rings = 4
	_body.mesh = cap
	_body.material_override = mat
	_body.position.y = 0.85
	add_child(_body)
	var nose := MeshInstance3D.new()   # shows where it faces
	var nm := BoxMesh.new()
	nm.size = Vector3(0.25, 0.25, 0.5)
	nose.mesh = nm
	nose.position = Vector3(0, 1.0, radius)
	var nmat := StandardMaterial3D.new()
	nmat.albedo_color = GameData.color_of(pal.accent)
	nose.material_override = nmat
	_body.add_child(nose)
	nose.position = Vector3(0, 0.15, radius * 0.9)

func _hud() -> void:
	_bar = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(1.4, 0.16)
	_bar.mesh = q
	_bar_mat = StandardMaterial3D.new()
	_bar_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_bar_mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	_bar.material_override = _bar_mat
	_bar.position.y = 2.5
	add_child(_bar)
	_label = Label3D.new()
	_label.text = fname
	_label.font_size = 40
	_label.pixel_size = 0.008
	_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label.no_depth_test = true
	_label.position.y = 2.85
	add_child(_label)

# Hit flash: a white overlay on every mesh for ~0.14 s (one shared material, only assigned while flashing).
func flash() -> void:
	if _flash_mat == null:
		_flash_mat = StandardMaterial3D.new()
		_flash_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_flash_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_flash_mat.albedo_color = Color(1, 1, 1, 0.7)
	if _flash_t <= 0.0:
		for mi in _meshes:
			mi.material_overlay = _flash_mat
	_flash_t = 0.14

# The local brawler fades while it hides in a bush (the server hides it from everyone else).
func set_faded(on: bool) -> void:
	if on == _faded:
		return
	_faded = on
	for mi in _meshes:
		mi.transparency = 0.55 if on else 0.0

# Emote sticker above the head for 2 s.
func show_emote(text: String, col: Color) -> void:
	if _emote == null:
		_emote = Label3D.new()
		_emote.font_size = 72
		_emote.pixel_size = 0.01
		_emote.outline_size = 16
		_emote.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		_emote.no_depth_test = true
		_emote.position.y = 3.5
		add_child(_emote)
	_emote.text = text
	_emote.modulate = col
	_emote.visible = true
	_emote_t = 2.0

func apply_row(x: float, z: float, f: float, h: float, mh: float, am: float, sup: float, cb: int, fl: int) -> void:
	target = Vector3(x, 0, z)
	facing = f
	hp = h; max_hp = mh; ammo = am; super_charge = sup; cubes = cb; flags = fl

func _process(delta: float) -> void:
	if _flash_t > 0.0:
		_flash_t -= delta
		if _flash_t <= 0.0:
			for mi in _meshes:
				mi.material_overlay = null
		else:
			_flash_mat.albedo_color.a = 0.7 * clampf(_flash_t / 0.14, 0.0, 1.0)
	if _emote_t > 0.0:
		_emote_t -= delta
		_emote.position.y = 3.5 + 0.1 * sin(_emote_t * 6.0)
		if _emote_t <= 0.0:
			_emote.visible = false
	visible = alive and not hidden_by_server
	if not visible:
		return
	if not is_local:
		position = position.lerp(target, clampf(delta * 14.0, 0.0, 1.0))
		rotation.y = lerp_angle(rotation.y, facing, clampf(delta * 16.0, 0.0, 1.0))
	var frac := clampf(hp / maxf(max_hp, 1.0), 0.0, 1.0)
	_bar.scale.x = maxf(frac, 0.001)
	_bar_mat.albedo_color = Color(0.9, 0.2, 0.2).lerp(Color(0.3, 0.9, 0.3), frac)
	# a frozen / rooted / stunned brawler turns bluish, cheap status read without particles
	var moving := position.distance_to(_last_pos) > 0.01
	_last_pos = position
	if _anim == null or not _anim.is_playing() or _cur_anim != "once":
		_play("run" if moving else "idle")
	if _body:
		var m := _body.material_override as StandardMaterial3D
		m.emission_enabled = (flags & (8 | 16 | 32)) != 0
		m.emission = Color(0.3, 0.6, 1.0)
