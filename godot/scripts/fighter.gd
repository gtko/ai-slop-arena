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
# FX (fx.gd / brawler.js look): loadout gadget letter, hit squash spring, spawn pop, K.O. fall, status
var gadget := "A"
var _base_scale := Vector3.ONE
var _base_y := 0.0
var _squash := 0.0
var _squash_v := 0.0
var _spawn_t := 0.0
var _hitstop := 0.0
var _die_t := 0.0
var _launch := Vector3.ZERO
var _fell := false
var _ice: MeshInstance3D
var _cold_mat: StandardMaterial3D
var _cold_shown := -1.0
var _was_frozen := false
var _stun_fx := 0.0
static var _ice_mat: StandardMaterial3D

var radius: float:
	get: return float(type.get("radius", 0.62))

func setup(row: Dictionary, brawlers: Dictionary) -> void:
	id = row.id
	fname = row.name
	var key := String(row.type).split(":")[0]
	type = brawlers.get(key, brawlers.blaster)
	var lo := String(row.type).split(":")   # 'volt:B2' = gadget B, star 2
	if lo.size() > 1 and lo[1].begins_with("B"):
		gadget = "B"
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
	if _model:
		_base_scale = _model.scale
		_base_y = _model.position.y
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

# Hit (brawler.js hurt()): white flash, two frames at full then fading in 1/7 s, and a jelly squash.
func hurt() -> void:
	if _flash_mat == null:
		_flash_mat = StandardMaterial3D.new()
		_flash_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_flash_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_flash_mat.albedo_color = Color(1, 1, 1, 1)
	_set_overlay(_flash_mat)
	_flash_t = 1.0
	_squash = 1.0
	_squash_v = 0.0

func flash() -> void:
	hurt()

func _set_overlay(m: Material) -> void:
	for mi in _meshes:
		if is_instance_valid(mi):
			mi.material_overlay = m

# K.O. (game.js killFx + brawler.js die()): the body holds 150 ms, flies off away from the killer
# (a ring-out falls into the void), plays its Death clip, then vanishes in a puff after 1.25 s.
func die_fx(killer_pos: Vector3, fell: bool, seen: bool) -> void:
	_flash_t = 0.0
	_squash = 0.0
	_squash_v = 0.0
	_set_overlay(null)
	_cold_shown = -1.0
	if _ice:
		_ice.visible = false
	if not seen or _anim == null:
		_vanish()
		return
	_hitstop = 0.15
	_die_t = 1.25
	_fell = fell
	var k := Vector3(sin(rotation.y), 0, cos(rotation.y))
	if killer_pos != Vector3.INF:
		k = position - killer_pos
		k.y = 0
	k = k.normalized() if k.length() > 1e-3 else Vector3(0, 0, 1)
	_launch = Vector3(0, -1, 0) if fell else Vector3(k.x * 3.2, 4.2, k.z * 3.2)
	if _anim:
		for n in _anim.get_animation_list():
			if String(n).to_lower() == "death":
				_anim.get_animation(n).loop_mode = Animation.LOOP_NONE
				_anim.play(n, 0.08)
				_cur_anim = "once"
				break

func _vanish() -> void:
	_die_t = 0.0
	if Fx.current:
		Fx.current.poof(position.x, position.z, GameData.color_of(type.palette.main))
	position.y = 0.0
	_spawn_t = 0.0   # a Duo revive pops back in

func _update_dying(delta: float) -> void:
	if _hitstop > 0.0:
		_hitstop -= delta
		if _anim:
			_anim.speed_scale = 0.0
		return
	if _anim:
		_anim.speed_scale = 1.0
	_die_t -= delta
	if _fell:
		_launch.y -= 26.0 * delta
		position.y += _launch.y * delta
	elif _launch.y > 0.0 or position.y > 0.0:
		position.x += _launch.x * delta
		position.z += _launch.z * delta
		_launch.y -= 22.0 * delta
		position.y = maxf(0.0, position.y + _launch.y * delta)
	if _die_t <= 0.0:
		_vanish()

# Frozen: an ice block around the brawler; slowed: a frosty tint; stunned: little stars over the head;
# the thaw: a ring (crowd-control immunity). Flags from the snapshot: 4 slow, 8 freeze, 16 root, 32 stun.
func _update_status(delta: float) -> void:
	var stunned := (flags & 32) != 0
	var frozen := (flags & 8) != 0 and not stunned
	if frozen and _ice == null:
		if _ice_mat == null:
			_ice_mat = StandardMaterial3D.new()
			_ice_mat.albedo_color = Color(Color("bfe8ff"), 0.55)
			_ice_mat.roughness = 0.05
			_ice_mat.metallic = 0.1
			_ice_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			_ice_mat.emission_enabled = true
			_ice_mat.emission = Color("2a6f9a")
			_ice_mat.emission_energy_multiplier = 0.6
		_ice = MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(1.5, 2.6, 1.5)
		_ice.mesh = b
		_ice.material_override = _ice_mat
		_ice.position.y = 1.3
		add_child(_ice)
	if _ice:
		_ice.visible = frozen
	if _anim:
		_anim.speed_scale = 0.0 if (flags & 8) != 0 else (0.6 if (flags & 4) != 0 else 1.0)
	var was := _was_frozen
	_was_frozen = (flags & 8) != 0
	if was and not _was_frozen and Fx.current:
		Fx.current.ring(position, Color(2.2, 3, 3.6), 1.4, 0, 0.5)
	if stunned and Fx.current:
		_stun_fx -= delta
		if _stun_fx <= 0.0:
			_stun_fx = 0.35
			Fx.current.spark_burst(position + Vector3(0, 2.9, 0), Color(3.2, 2.8, 0.6), 3, 1.5, 0.35, 0.12)
	var cold := 0.5 if frozen else (0.28 if (flags & 4) != 0 else 0.0)
	if cold != _cold_shown and _flash_t <= 0.0:
		_cold_shown = cold
		if cold <= 0.0:
			_set_overlay(null)
		else:
			if _cold_mat == null:
				_cold_mat = StandardMaterial3D.new()
				_cold_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
				_cold_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
			_cold_mat.albedo_color = Color(cold * 0.2, cold * 0.55, cold).linear_to_srgb()
			_set_overlay(_cold_mat)

# Spawn pop + hit squash (a spring k 320, damping 18 that overshoots once, like jelly) + power cubes
# make you visibly bigger (the hitbox stays).
func _update_scale(delta: float) -> void:
	if _model == null:
		return
	_spawn_t = minf(1.0, _spawn_t + delta * 3.0)
	var pop := 1.0 + sin(_spawn_t * PI) * 0.25 if _spawn_t < 1.0 else 1.0
	var rest := minf(delta, 0.1)
	while rest > 1e-5:
		var h := minf(rest, 1.0 / 120.0)
		_squash_v += (-320.0 * _squash - 18.0 * _squash_v) * h
		_squash += _squash_v * h
		rest -= 1.0 / 120.0
	var grow := 1.0 + minf(0.15, cubes * 0.015)
	var sq := _squash
	_model.scale = _base_scale * Vector3(grow * pop * (1.0 + 0.1 * sq), grow * _spawn_t * pop * (1.0 - 0.14 * sq), grow * pop * (1.0 + 0.1 * sq))
	_model.position.y = _base_y * _model.scale.y / maxf(_base_scale.y, 1e-4)

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
		_flash_t = maxf(0.0, _flash_t - delta * 7.0)
		if _flash_t <= 0.0:
			_set_overlay(null)
			_cold_shown = -1.0   # let the frost tint repaint
		else:
			_flash_mat.albedo_color.a = 1.0 if _flash_t > 0.75 else _flash_t * 0.9
	if _emote_t > 0.0:
		_emote_t -= delta
		_emote.position.y = 3.5 + 0.1 * sin(_emote_t * 6.0)
		if _emote_t <= 0.0:
			_emote.visible = false
	visible = (alive and not hidden_by_server) or _die_t > 0.0
	if not visible:
		return
	if not alive:
		_update_dying(delta)
		return
	_update_status(delta)
	_update_scale(delta)
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
