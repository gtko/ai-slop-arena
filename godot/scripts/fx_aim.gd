class_name FxAim
extends Node3D
# The aim indicator under your brawler (game.js buildAim / updateAim): a translucent white shape on
# the ground showing what the attack covers (Blaster: a fan; the others: a lane; lobbers: a lane and
# a landing disc), gold and stronger while the super is aimed (right mouse / the super key / LT held
# with a full super: main.gd super_aiming). Faint when out of ammo. On touch it only shows while the aim stick is dragged.

var _mat: ShaderMaterial
var _fan: MeshInstance3D
var _fan_s: MeshInstance3D
var _cone: MeshInstance3D
var _lane: MeshInstance3D
var _target: MeshInstance3D

func _ready() -> void:
	_mat = FxLib.glow(Color(1, 1, 1), 0.16, "mix", true, 1)
	_fan = _part(FxLib.fan_mesh(0.56))
	_fan_s = _part(FxLib.fan_mesh(0.76))
	_cone = _part(FxLib.fan_mesh(1.24))   # Mochi's belly bump
	_lane = _part(FxLib.lane_mesh())
	_target = MeshInstance3D.new()
	_target.mesh = FxLib.disc_mesh()
	_target.material_override = _mat
	_target.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	get_parent().add_child.call_deferred(_target)
	visible = false

func _part(mesh: Mesh) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi

func _exit_tree() -> void:
	if is_instance_valid(_target):
		_target.queue_free()

func _hide() -> void:
	visible = false
	_target.visible = false

func _process(_dt: float) -> void:
	var m := Quality.main_node()
	var me: Fighter = m.get("me") if m else null
	if me == null or not me.alive or int(m.get("state")) != 4:   # main.State.PLAYING
		_hide()
		return
	var touch = m.get("touch")
	var on_touch: bool = touch != null and touch.visible
	if on_touch and (touch.aim as Vector2).length() < 0.25:
		_hide()
		return
	var a2: Vector2 = m.get("aim_dir")
	if a2.length() < 0.01:
		_hide()
		return
	var dir := Vector3(a2.x, 0, a2.y).normalized()
	var T := String(me.type.key)
	var R := float(me.type.range)
	var sup := not on_touch and bool(m.get("super_aiming"))
	var aim_dist := _aim_dist(m, me, R)
	visible = true
	position = Vector3(me.position.x, 0.06, me.position.z)
	rotation.y = atan2(-dir.z, dir.x)
	FxLib.set_col(_mat, Color("ffd23f").srgb_to_linear() if sup else Color(1, 1, 1), 0.32 if sup else (0.16 if me.ammo >= 1.0 else 0.07))
	_fan.visible = T == "blaster" and not sup
	_fan_s.visible = T == "blaster" and sup
	_fan.scale = Vector3.ONE * 9.5
	_fan_s.scale = Vector3.ONE * 11.0
	_lane.visible = T != "blaster" and not (T == "frostbite" and sup)
	_target.visible = T == "bomber" or (T == "kappa" and not sup) or (sup and T in ["frostbite", "volt", "pipchomp", "mochi"])
	_cone.visible = T == "mochi" and not sup
	if _cone.visible:
		_lane.visible = false
		_cone.scale = Vector3.ONE * 3.5
	var tgt_d := 0.0
	var tgt_s := 1.0
	match T:
		"pipchomp", "mochi":   # a 4 m lunge; supers: a trap (8 m) or a landing (9 m) where you aim
			var d := clampf(aim_dist, 2.0, 9.0 if T == "mochi" else 8.0)
			_lane.scale = Vector3(d if sup else 4.0, 1, 0.14 if sup else 1.1)
			tgt_d = d
			tgt_s = 4.0 if T == "mochi" else 1.0
		"gunslinger":
			_lane.scale = Vector3(20.0 if sup else 16.0, 1, 1.3 if sup else 0.8)
		"frostbite":
			_lane.scale = Vector3(12, 1, 0.9)
			tgt_s = 5.0
		"volt":
			var d := clampf(aim_dist, 2.0, R)
			_lane.scale = Vector3(d if sup else 13.0, 1, 0.14 if sup else 0.7)
			tgt_d = d
			tgt_s = 3.2
		"kappa":   # a bubble lobbed where you aim; the super: the wave's 10 x 5 m path
			var d := clampf(aim_dist, 2.0, R)
			_lane.scale = Vector3(10.6 if sup else d, 1, 5.0 if sup else 0.14)
			tgt_d = d
			tgt_s = 1.6
		"bomber":
			var d := clampf(aim_dist, 2.0, R)
			_lane.scale = Vector3(d, 1, 0.14)
			tgt_d = d
			tgt_s = 3.6 if sup else 2.2
	if _target.visible:
		_target.position = Vector3(me.position.x + dir.x * tgt_d, 0.065, me.position.z + dir.z * tgt_d)
		_target.scale = Vector3.ONE * tgt_s

# How far the attack is aimed: main.gd's aim_dist (mouse distance, stick tilt), else the mouse here.
func _aim_dist(m: Node, me: Fighter, R: float) -> float:
	var ad: Variant = m.get("aim_dist")
	if ad != null and float(ad) > 0.0:
		return float(ad)
	var touch = m.get("touch")
	if touch != null and touch.visible:
		return R * clampf((touch.aim as Vector2).length(), 0.0, 1.0)
	var cam: Camera3D = get_viewport().get_camera_3d()
	if cam == null:
		return R
	var mp := get_viewport().get_mouse_position()
	var from := cam.project_ray_origin(mp)
	var dir := cam.project_ray_normal(mp)
	if absf(dir.y) < 1e-4:
		return R
	var t := -from.y / dir.y
	if t <= 0.0:
		return R
	var p := from + dir * t
	return Vector2(p.x - me.position.x, p.z - me.position.z).length()
