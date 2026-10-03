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
var _last_pos := Vector3.ZERO
# Feel (brawler.js update / animate): measured velocity (walk cycle, facing, footsteps), the aim
# hold after an attack, the victory dance, remote fighters' snapshot buffer.
var vel := Vector3.ZERO
var aim_hold := 0.0
var aim_facing := 0.0
var won := false
var _walk_phase := 0.0
var _walk_amp := 0.0
var _step_ph := 0
var _snaps: Array = []        # remote: [arrival time (s), Vector3] of the last snapshots
var _snap_gap := 1.0 / 15.0   # mean gap between two snapshots (adaptive interpolation delay)
var _snap_jit := 0.0
static var interp_glide := false   # --interp=glide: the web's exponential glide instead of the buffer
static var _motion_log := false    # --feellog: per-frame motion stats of remote fighters
var _mlog := {"n": 0, "sum": 0.0, "sum2": 0.0, "stall": 0, "frames": 0, "jerk": 0.0, "prev": 0.0}
var _bar: MeshInstance3D
var _bar_mat: StandardMaterial3D
var _label: Label3D
var _meshes: Array[MeshInstance3D] = []
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
var _cold_shown := -1.0
var _was_frozen := false
var _stun_fx := 0.0
static var _ice_mat: StandardMaterial3D
# Figurine look (figurines.js / brawler.js): one cartoon material per fighter (assets/shaders/
# fighter.gdshader, its own so the hit flash and the frost tint stay per brawler), the inverted-hull
# outline and the ring under the feet in the team colour.
const GAIN := {"blaster": 1.518, "bomber": 1.633, "frostbite": 1.213}   # figurines.js textureGain of each texture
# brawler.js LINE (outline) and RING (linear, blooms); "Cb": the colour-blind option (blue against orange)
const LINE := {"me": Color("19b6ff"), "foe": Color("5c0d14"), "meCb": Color("3a8dff"), "foeCb": Color("8a4400")}
const RING := {"me": Vector3(0.3, 1.6, 2.0), "foe": Vector3(1.8, 0.25, 0.2), "meCb": Vector3(0.35, 0.9, 2.4), "foeCb": Vector3(2.2, 1.0, 0.05)}
static var _ring_mesh: Mesh
var _mats: Array[ShaderMaterial] = []
var _lines: Array[MeshInstance3D] = []
var _line_mat: ShaderMaterial
var _ring: MeshInstance3D
var _ring_mat: ShaderMaterial
var _team := ""
var _dbg_cam: PackedFloat32Array = []   # --fightercam=zoom,facing (screenshots, see _debug)
var _dbg_fx := ""                        # --fighterfx=hurt|slow|freeze|stun|bush

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
	if _model:
		_look(key)
	_add_ring()
	Skins.apply(self, row)  # WORLD hook
	if _model:
		_base_scale = _model.scale
		_base_y = _model.position.y
	_hud()
	for a in DebugArgs.list():
		if a.begins_with("--fightercam="):
			for v in a.substr(13).split(","):
				_dbg_cam.append(float(v))
		elif a.begins_with("--fighterfx="):
			_dbg_fx = a.substr(12)
		elif a == "--interp=glide":
			interp_glide = true
		elif a == "--feellog":
			_motion_log = true

# The GLB's materials become the cartoon figurine material (same texture and colour), shared by the
# surfaces of this fighter; every mesh gets its outline hull: a second MeshInstance3D with the same
# mesh, skin and skeleton, drawn back faces only, pushed out along the normals (fighter_outline).
func _look(key: String) -> void:
	Foliage.ensure_globals()   # g_rim (lighting.gd sets it; the menu may draw a figure first)
	_line_mat = _team_mat("line", _team_key())
	var shader: Shader = preload("res://assets/shaders/fighter.gdshader")
	var cache := {}
	for mi in _meshes:
		if mi.mesh == null:
			continue
		for s in mi.mesh.get_surface_count():
			var src := mi.get_active_material(s) as BaseMaterial3D
			if src == null:
				continue
			if not cache.has(src):
				var m := ShaderMaterial.new()
				m.shader = shader
				m.set_shader_parameter("albedo", src.albedo_color)
				if src.albedo_texture:
					m.set_shader_parameter("albedo_tex", src.albedo_texture)
				m.set_shader_parameter("gain", float(GAIN.get(key, 1.0)))
				cache[src] = m
				_mats.append(m)
			mi.set_surface_override_material(s, cache[src])
		var line := MeshInstance3D.new()
		line.mesh = mi.mesh
		line.skin = mi.skin
		line.material_override = _line_mat
		line.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		line.transform = mi.transform
		mi.get_parent().add_child(line)
		line.skeleton = mi.skeleton   # a sibling: the same relative path
		_lines.append(line)
	_team_colours()

func _add_ring() -> void:
	if _ring_mesh == null:
		var r := TorusMesh.new()   # RingGeometry(0.78, 0.98): a torus squashed flat
		r.inner_radius = 0.78
		r.outer_radius = 0.98
		r.rings = 48
		r.ring_segments = 4
		_ring_mesh = r
	_ring = MeshInstance3D.new()
	_ring.mesh = _ring_mesh
	_ring.scale = Vector3(1, 0.02, 1)
	_ring.position.y = 0.045
	_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_ring_mat = _team_mat("ring", _team_key())
	_ring.material_override = _ring_mat
	add_child(_ring)
	_team_colours()

func _team_key() -> String:
	return ("me" if is_local else "foe") + ("Cb" if Settings.colorblind else "")

# You (and the menu's star) wear the bright cyan outline and ring, everybody else the dark red one.
# One outline and one ring material per team colour, shared by every fighter wearing it: the
# renderer batches them instead of switching material for each brawler.
static var _team_mats: Dictionary = {}

static func _team_mat(kind: String, team: String) -> ShaderMaterial:
	var key := kind + team
	if not _team_mats.has(key):
		var m := ShaderMaterial.new()
		if kind == "line":
			m.shader = preload("res://assets/shaders/fighter_outline.gdshader")
			m.set_shader_parameter("color", LINE[team])
		else:
			m.shader = preload("res://assets/shaders/fighter_ring.gdshader")
			m.set_shader_parameter("color", RING[team])
		_team_mats[key] = m
	return _team_mats[key]

func _team_colours() -> void:
	_team = _team_key()
	if _line_mat:
		_line_mat = _team_mat("line", _team)
		for l in _lines:
			l.material_override = _line_mat
	if _ring_mat:
		_ring_mat = _team_mat("ring", _team)
		_ring.material_override = _ring_mat

# Skins.apply: hue turn / saturation / brightness of the painted texture, or the golden figurine.
func set_skin(rc: Vector3, gold: bool) -> void:
	for m in _mats:
		m.set_shader_parameter("recol", rc)
		m.set_shader_parameter("gold", 1.0 if gold else 0.0)

# brawler.js drives the figurine's emissive: white for the hit flash, icy blue for slow / freeze.
func _set_tint(v: Vector3) -> void:
	for m in _mats:
		m.set_shader_parameter("tint", v)
	if _body:
		var bm := _body.material_override as StandardMaterial3D
		bm.emission_enabled = v != Vector3.ZERO
		bm.emission = Color(v.x, v.y, v.z)

# The rigged figurine as authored (figurines.js: 2.5 m tall, feet on the ground, root scale 1; the
# skinned mesh's own AABB is a bogus -1..1 box, so it is not used), weapons scaled up around the grip
# to read from the high camera (figurines.js WEAPON_SCALE).
const WEAPON_SCALE := {"blaster": 1.25, "gunslinger": 1.3, "bomber": 1.2, "frostbite": 1.1}
func _load_model(path: String) -> void:
	var inst: Node3D = (load(path) as PackedScene).instantiate()
	add_child(inst)
	var ws := float(WEAPON_SCALE.get(path.get_file().get_basename(), 1.0))
	for mi in inst.find_children("*", "MeshInstance3D", true, false):
		if (mi as MeshInstance3D).skin == null and mi.get_parent() is BoneAttachment3D:
			(mi as Node3D).scale *= ws
	_model = inst
	for ap in inst.find_children("*", "AnimationPlayer", true, false):
		_anim = ap
	_build_animator(path)

# ---------------------------------------------------------------- animation (animator.js)
# The figurine's baked clips on three layers, like the web's Animator:
#   base   full body: a loop (Idle, Run, Sneak, BushIdle, Victory) or a one-shot (Bored, Fidget,
#          Wave, Super, Death) that hands back to the loop, crossfaded in 0.2 s (one-shots 0.15 s);
#          Run plays at 1.05 x the speed fraction (at least 0.45), Sneak at the fraction (>= 0.6)
#   upper  over the base's spine, arms and head: Aim (held 0.5 s after an attack) and one-shots
#          (Shoot, Cheer, the Super's upper half while running), so the legs keep running
#   hit    the Hit clip made additive (a flinch on top of whatever plays)
# An AnimationTree advanced by hand: frozen = 0, slowed = 0.6, hit stop = 0 (brawler.js mixer.timeScale).
const LOOPS := ["Idle", "Run", "Sneak", "BushIdle", "Slide", "Victory", "Aim"]
const BASE_ONCE := ["Bored", "Fidget", "Wave", "Super", "Death"]
const UPPER := ["Shoot", "Cough", "Cheer", "Super"]
const LOWER_BONES := ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]
static var _hit_libs := {}    # model path -> AnimationLibrary with the additive Hit (shared per brawler type)
var _tree: AnimationTree
var _clips := {}              # clip name -> animation name in the mixer
var _state := ""              # base state playing
var _loop := "Idle"           # loop the base returns to after a one-shot
var _busy := ""               # full-body one-shot running
var _busy_left := 0.0
var _held := false            # Death holds its last frame
var _loop_speed := 1.0
var _aim_w := 0.0
var _anim_rate := 1.0         # status: frozen 0, slowed 0.6
var _idle_t := 0.0
var _next_flourish := 6.0
var _cheer_until := 0.0
# Quality "anim" (Low: 2): the other fighters' trees advance every other frame, by the time gone
# (staggered by fighter, so half of them update each frame); yours every frame.
var _anim_acc := 0.0
var _anim_n := 0
var _q_rev := -1              # Quality.rev seen (outline hulls follow Quality.outlines)

func _build_animator(path: String) -> void:
	if _anim == null:
		return
	for n in _anim.get_animation_list():
		var s := String(n)
		_clips[s.get_slice("/", s.get_slice_count("/") - 1)] = s
	for k in _clips:
		_anim.get_animation(_clips[k]).loop_mode = Animation.LOOP_LINEAR if LOOPS.has(k) else Animation.LOOP_NONE
	if not _clips.has("Idle") or not _clips.has("Run"):
		if not _clips.is_empty():
			_anim.play(_clips.values()[0])
		return
	_tree = AnimationTree.new()
	_tree.name = "Animator"
	for lib in _anim.get_animation_library_list():
		_tree.add_animation_library(lib, _anim.get_animation_library(lib))
	var hit := _hit_library(path)
	if hit:
		_tree.add_animation_library("feel", hit)
	_anim.get_parent().add_child(_tree)
	_tree.root_node = _tree.get_path_to(_anim.get_node(_anim.root_node))
	_anim.active = false
	_tree.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	var bt := AnimationNodeBlendTree.new()
	var upper_paths := {}
	for k in _clips:
		var a := _anim.get_animation(_clips[k])
		for i in a.get_track_count():
			var p := a.track_get_path(i)
			if not LOWER_BONES.has(String(p.get_concatenated_subnames())):
				upper_paths[p] = true
	# base: loops and full-body one-shots
	var base := AnimationNodeTransition.new()
	base.xfade_time = 0.2
	base.allow_transition_to_self = true
	var states: Array = (LOOPS + BASE_ONCE).filter(func(k): return k != "Aim" and _clips.has(k))
	base.input_count = states.size()
	bt.add_node("base", base)
	for i in states.size():
		base.set_input_name(i, states[i])
		var an := AnimationNodeAnimation.new()
		an.animation = _clips[states[i]]
		bt.add_node("b_" + states[i], an)
		bt.connect_node("base", i, "b_" + states[i])
	var speed := AnimationNodeTimeScale.new()
	bt.add_node("speed", speed)
	bt.connect_node("speed", 0, "base")
	var last := "speed"
	if _clips.has("Aim"):   # upper layer: the held aim
		var aim := AnimationNodeBlend2.new()
		aim.filter_enabled = true
		for p in upper_paths:
			aim.set_filter_path(p, true)
		var aa := AnimationNodeAnimation.new()
		aa.animation = _clips.Aim
		bt.add_node("aim", aim)
		bt.add_node("a_Aim", aa)
		bt.connect_node("aim", 0, last)
		bt.connect_node("aim", 1, "a_Aim")
		last = "aim"
	var ups: Array = UPPER.filter(func(k): return _clips.has(k))
	if not ups.is_empty():   # upper layer: one-shots over the running legs
		var sel := AnimationNodeTransition.new()
		sel.xfade_time = 0.0
		sel.allow_transition_to_self = true
		sel.input_count = ups.size()
		bt.add_node("up_sel", sel)
		for i in ups.size():
			sel.set_input_name(i, ups[i])
			var an := AnimationNodeAnimation.new()
			an.animation = _clips[ups[i]]
			bt.add_node("u_" + ups[i], an)
			bt.connect_node("up_sel", i, "u_" + ups[i])
		var up := AnimationNodeOneShot.new()
		up.fadein_time = 0.05
		up.fadeout_time = 0.12
		up.filter_enabled = true
		for p in upper_paths:
			up.set_filter_path(p, true)
		bt.add_node("up", up)
		bt.connect_node("up", 0, last)
		bt.connect_node("up", 1, "up_sel")
		last = "up"
	if hit:   # the flinch, added on top
		var ha := AnimationNodeAnimation.new()
		ha.animation = "feel/Hit"
		var hs := AnimationNodeOneShot.new()
		hs.mix_mode = AnimationNodeOneShot.MIX_MODE_ADD
		hs.fadein_time = 0.02
		hs.fadeout_time = 0.08
		bt.add_node("h_Hit", ha)
		bt.add_node("hit", hs)
		bt.connect_node("hit", 0, last)
		bt.connect_node("hit", 1, "h_Hit")
		last = "hit"
	bt.connect_node("output", 0, last)
	_tree.tree_root = bt
	_tree.active = true
	_enter("Idle", 0.0)
	_tree.advance(0.0)

# three.js AnimationUtils.makeClipAdditive on Godot's rest-relative blending: each key becomes
# rest * (frame0^-1 * key), so adding it over a pose adds only the flinch's motion from its first frame.
func _hit_library(path: String) -> AnimationLibrary:
	if _hit_libs.has(path):
		return _hit_libs[path]
	var lib: AnimationLibrary = null
	var skels := _model.find_children("*", "Skeleton3D", true, false)
	if _clips.has("Hit") and not skels.is_empty():
		var skel := skels[0] as Skeleton3D
		var src := _anim.get_animation(_clips.Hit)
		var dst := Animation.new()
		dst.length = src.length
		dst.loop_mode = Animation.LOOP_NONE
		for i in src.get_track_count():
			var tt := src.track_get_type(i)
			if tt != Animation.TYPE_ROTATION_3D and tt != Animation.TYPE_POSITION_3D:
				continue
			var p := src.track_get_path(i)
			var bi := skel.find_bone(String(p.get_concatenated_subnames()))
			if bi < 0:
				continue
			var rest := skel.get_bone_rest(bi)
			var j := dst.add_track(tt)
			dst.track_set_path(j, p)
			var steps := maxi(1, ceili(src.length * 30.0))
			if tt == Animation.TYPE_ROTATION_3D:
				var r0 := rest.basis.get_rotation_quaternion()
				var ref := src.rotation_track_interpolate(i, 0.0).inverse()
				for k in steps + 1:
					var tm := minf(src.length, k / 30.0)
					dst.rotation_track_insert_key(j, tm, (r0 * (ref * src.rotation_track_interpolate(i, tm))).normalized())
			else:
				var ref := src.position_track_interpolate(i, 0.0)
				for k in steps + 1:
					var tm := minf(src.length, k / 30.0)
					dst.position_track_insert_key(j, tm, rest.origin + (src.position_track_interpolate(i, tm) - ref))
		lib = AnimationLibrary.new()
		lib.add_animation("Hit", dst)
	_hit_libs[path] = lib
	return lib

# Base state (crossfade): a loop, or a one-shot that hands back to the loop near its end.
func _enter(state: String, fade := 0.2) -> void:
	if _tree == null or not _clips.has(state):
		return
	var base := (_tree.tree_root as AnimationNodeBlendTree).get_node("base") as AnimationNodeTransition
	base.xfade_time = fade
	_tree.set("parameters/base/transition_request", state)
	_state = state

func _set_loop(state: String, speed := 1.0) -> void:
	if _held or not _clips.has(state):
		return
	_loop_speed = speed
	if _loop == state and (_state == state or _busy != ""):
		return
	_loop = state
	if _busy == "":
		_enter(state)

# Full-body one-shot; back to the loop at the end (or holds the last frame: Death).
func _once(state: String, hold := false, fade := 0.15) -> bool:
	if _tree == null or not _clips.has(state):
		return false
	_enter(state, fade)
	_busy = "" if hold else state
	_busy_left = _anim.get_animation(_clips[state]).length
	_held = hold
	if hold:
		_tree.set("parameters/up/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FADE_OUT)
		_aim_w = 0.0
	return true

# Upper-body one-shot (Shoot, Cheer, Super while running).
func _fire(clip: String) -> void:
	if _tree == null or _held or not _clips.has(clip) or not UPPER.has(clip):
		return
	_tree.set("parameters/up_sel/transition_request", clip)
	_tree.set("parameters/up/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)

# brawler.js face(): turn to the attack for half a second.
func face(dx: float, dz: float) -> void:
	if absf(dx) + absf(dz) < 1e-4:
		return
	aim_facing = atan2(dx, dz)
	aim_hold = 0.5

# brawler.js attacked(): Shoot over the body; a Super over the arms while running, else full body.
func attacked(sup: bool) -> void:
	if not sup:
		_fire("Shoot")
	elif vel.length() > 1.0:
		_fire("Super")
	else:
		_once("Super")

# The killer's cheer (game.js killFx): over the aim, the arms go up.
func cheer() -> void:
	_cheer_until = Time.get_ticks_msec() + 1400
	if alive:
		_fire("Cheer")

# Kept for older call sites (main.gd / fx_demo.gd): "shoot" / "super" / "death".
func play_once(kind: String) -> void:
	match kind:
		"shoot": attacked(false)
		"super": attacked(true)
		"death": _once("Death", true, 0.08)

# Per frame: pick the clips for what the brawler is doing (brawler.js animateFigurine).
func _animate(delta: float, speed_frac: float, in_bush: bool) -> void:
	if _tree == null or not _tree.active:
		return
	var moving := speed_frac > 0.15
	var aiming := aim_hold > 0.0
	if won:
		_set_loop("Victory")
	elif moving:
		_set_loop("Sneak" if in_bush else "Run", maxf(0.6, speed_frac) if in_bush else 1.05 * maxf(0.45, speed_frac))
	else:
		_set_loop("BushIdle" if in_bush else "Idle")
	# idle flourishes: now and then, standing around out of the bushes, a sigh or a personal quirk
	var flourish := _busy == "Bored" or _busy == "Fidget" or _busy == "Wave"
	if flourish and (moving or aiming or in_bush):
		_busy = ""
		_enter(_loop)
	if not moving and not aiming and not in_bush and not won and _busy == "" and not _held:
		_idle_t += delta
		if _idle_t > _next_flourish:
			_once("Bored" if randf() < 0.5 else "Fidget")
			_idle_t = 0.0
			_next_flourish = 6.0 + randf() * 8.0
	else:
		_idle_t = 0.0
	var rate := 0.0 if _hitstop > 0.0 else _anim_rate
	var dt := delta * rate
	if _busy != "":
		_busy_left -= dt
		if _busy_left <= 0.15:
			_busy = ""
			_enter(_loop)
	_aim_w = move_toward(_aim_w, 1.0 if aiming and not _held else 0.0, dt / 0.12)
	_tree.set("parameters/aim/blend_amount", _aim_w)
	_tree.set("parameters/speed/scale", _loop_speed if _state == _loop else 1.0)
	_anim_acc += dt
	_anim_n += 1
	var every := 1 if is_local else Quality.anim_every
	if every <= 1 or (_anim_n + get_instance_id()) % every == 0:
		_tree.advance(_anim_acc)
		_anim_acc = 0.0

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
	_bar.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_bar)
	_label = Label3D.new()
	_label.text = fname
	_label.font_size = 40
	_label.pixel_size = 0.008
	_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label.no_depth_test = true
	_label.position.y = 2.85
	add_child(_label)

# Hit (brawler.js hurt()): white flash, two frames at full then fading in 1/7 s, a jelly squash, the
# Hit flinch, and `stop` seconds of hit freeze (feel.js WEAPONS: the pose holds, the server goes on).
func hurt(stop := 0.0) -> void:
	_set_tint(Vector3.ONE)
	_flash_t = 1.0
	_squash = 1.0
	_squash_v = 0.0
	_hitstop = maxf(_hitstop, stop)
	if _tree and alive and _clips.has("Hit"):
		_tree.set("parameters/hit/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)

func flash() -> void:
	hurt()

# K.O. (game.js killFx + brawler.js die()): the body holds 150 ms, flies off away from the killer
# (a ring-out falls into the void), plays its Death clip, then vanishes in a puff after 1.25 s.
func die_fx(killer_pos: Vector3, fell: bool, seen: bool) -> void:
	_flash_t = 0.0
	_squash = 0.0
	_squash_v = 0.0
	_set_tint(Vector3.ZERO)
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
	if _tree:
		_tree.set("parameters/hit/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_ABORT)
		_once("Death", true, 0.08)
	elif _anim and _clips.has("Death"):
		_anim.play(_clips.Death, 0.08)

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
	if _tree:
		_tree.advance(delta)
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
	_anim_rate = 0.0 if (flags & 8) != 0 else (0.6 if (flags & 4) != 0 else 1.0)   # frozen solid mid-pose
	if _anim and _tree == null:
		_anim.speed_scale = _anim_rate
	var was := _was_frozen
	_was_frozen = (flags & 8) != 0
	if was and not _was_frozen and Fx.current:
		Fx.current.ring(position, Color(2.2, 3, 3.6), 1.4, 0, 0.5)
		if AudioManager.current and Feel.current and Feel.current.playing:   # FEEL: the ice breaks
			AudioManager.current.play("immune", position)
	if stunned and Fx.current:
		_stun_fx -= delta
		if _stun_fx <= 0.0:
			_stun_fx = 0.35
			Fx.current.spark_burst(position + Vector3(0, 2.9, 0), Color(3.2, 2.8, 0.6), 3, 1.5, 0.35, 0.12)
	var cold := 0.5 if frozen else (0.28 if (flags & 4) != 0 else 0.0)
	if cold != _cold_shown and _flash_t <= 0.0:
		_cold_shown = cold
		_set_tint(Vector3(cold * 0.2, cold * 0.55, cold))

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

# The local brawler fades while it hides in a bush (the server hides it from everyone else): half
# see-through (brawler.js hiddenLook), the outline hull off (it would show through as a solid blob).
func set_faded(on: bool) -> void:
	if on == _faded:
		return
	_faded = on
	for mi in _meshes:
		mi.transparency = 0.5 if on else 0.0
	_show_lines()

# The outline hull is a second skinned draw of every mesh: off while faded, and on Low only on your
# own brawler (Quality "outline": 0 none, 1 yours, 2 everybody); the ring under the feet still
# carries everybody's team colour.
func _show_lines() -> void:
	_q_rev = Quality.rev
	var lvl := Quality.outline_level
	var on := not _faded and (lvl >= 2 or (lvl == 1 and is_local))
	for l in _lines:
		l.visible = on

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

# main.gd calls this before clearing hidden_by_server: a brawler back in sight (out of a bush, round
# a wall, through the fog) appears where it is instead of gliding there from where it was last seen,
# through the wall (game.js applySnap); a jump of more than 6 m is a teleport too (brawler.js).
func apply_row(x: float, z: float, f: float, h: float, mh: float, am: float, sup: float, cb: int, fl: int) -> void:
	target = Vector3(x, 0, z)
	facing = f
	if not is_local and (hidden_by_server or position.distance_to(target) > 6.0):
		position = target
		rotation.y = f
		_last_pos = target
		_snaps.clear()   # FEEL: the interpolation buffer restarts from here
	hp = h; max_hp = mh; ammo = am; super_charge = sup; cubes = cb; flags = fl
	if not is_local:
		_push_snap(target)

# FEEL: remote fighters. The snapshots (15 Hz, but sent on the server's 50 ms ticks, so 50 / 100 ms
# apart) are kept with their arrival time and played back a little behind (one mean gap + 2 x the
# jitter), at the speed they really moved, instead of gliding toward the newest one (the web's
# glide: the speed pulses with each packet). After a gap (lag spike) or a jump: there at once.
func _push_snap(p: Vector3) -> void:
	var now := Time.get_ticks_usec() / 1e6
	if not _snaps.is_empty():
		var last: Array = _snaps[_snaps.size() - 1]
		var gap: float = now - float(last[0])
		if gap > 0.35 or p.distance_to(last[1]) > 6.0:
			_snaps.clear()
			position = p
		else:
			_snap_jit += (absf(gap - _snap_gap) - _snap_jit) * 0.1
			_snap_gap += (gap - _snap_gap) * 0.1
	_snaps.append([now, p])
	if _snaps.size() > 8:
		_snaps.remove_at(0)

func _interp_pos() -> Vector3:
	var n := _snaps.size()
	if n == 0:
		return target
	var delay := clampf(_snap_gap + 2.0 * _snap_jit, 0.06, 0.2)
	var rt := Time.get_ticks_usec() / 1e6 - delay
	var first: Array = _snaps[0]
	if n == 1 or rt <= float(first[0]):
		return first[1]
	for i in range(n - 1, 0, -1):
		var a: Array = _snaps[i - 1]
		if rt >= float(a[0]):
			var b: Array = _snaps[i]
			var span: float = float(b[0]) - float(a[0])
			var u := (rt - float(a[0])) / maxf(span, 1e-3)
			if i == n - 1 and u > 1.0:   # starved: keep going the same way for up to 0.1 s
				u = minf(u, 1.0 + 0.1 / maxf(span, 1e-3))
			return (a[1] as Vector3).lerp(b[1], u)
	return first[1]

# FEEL (brawler.js update): position (remote), measured velocity, facing (the attack for 0.5 s,
# else where it runs, else the server's facing), the walk cycle and footsteps, the animation.
func _motion(delta: float) -> void:
	if not is_local:
		if interp_glide or _snaps.is_empty():
			position = position.lerp(target, 1.0 - exp(-14.0 * delta))
		else:
			position = _interp_pos()
	var dp := position - _last_pos
	dp.y = 0.0
	_last_pos = position
	var v := dp / maxf(delta, 1e-3)
	if v.length() > 40.0:   # a teleport / respawn, not a speed
		v = Vector3.ZERO
	vel = vel.lerp(v, 1.0 - exp(-25.0 * delta))
	if _motion_log and not is_local:
		_log_motion(v.length(), delta)
	aim_hold -= delta
	var speed := vel.length()
	var want := rotation.y
	if aim_hold > 0.0:
		want = aim_facing
	elif speed > 0.8:
		want = atan2(vel.x, vel.z)
	elif not is_local:
		want = facing
	rotation.y = lerp_angle(rotation.y, want, 1.0 - exp(-16.0 * delta))
	var A = get_parent().get("arena") if get_parent() else null
	var in_bush: bool = A is Arena and (A as Arena).is_bush(position.x, position.z)
	var sf := speed / maxf(float(type.get("speed", 6.0)), 0.1)
	_walk_amp += ((1.0 if sf > 0.15 else 0.0) - _walk_amp) * (1.0 - exp(-10.0 * delta))
	_walk_phase += delta * 11.0 * maxf(sf, 0.2)
	_footsteps(A, in_bush)
	_hitstop -= delta
	_animate(delta, sf, in_bush)

# One footstep per half walk cycle on the map's ground (grass in bushes): yours, and the brawlers you
# can see close by, softer; a puff of dust on sand, snow (one in two) and mud (brawler.js footsteps).
const GROUND := {"oasis": "sand", "dunes": "sand", "grove": "grass", "frost": "snow", "marsh": "mud", "isles": "grass"}
func _footsteps(A, in_bush: bool) -> void:
	var ph := floori(_walk_phase / PI)
	if ph == _step_ph:
		return
	_step_ph = ph
	var F := Feel.current
	if _walk_amp < 0.5 or F == null or not F.playing or not (A is Arena) or position.y > 0.05:
		return
	if not is_local and not (visible and Vector2(position.x - F.focus.x, position.z - F.focus.z).length() < 8.0):
		return
	var ground: String = "grass" if in_bush else String(GROUND.get(String((A as Arena).map.get("key", "")), "stone"))
	if AudioManager.current:
		AudioManager.current.play("step_" + ground, null if is_local else position, (0.35 if is_local else 0.2) * (0.6 if in_bush else 1.0))
	var c := (A as Arena).char_at(position.x, position.z)
	if not in_bush and ground in ["sand", "snow", "mud"] and not c in ["I", "W", "="] and Fx.current and (ground != "snow" or randf() < 0.5):
		Fx.current.dust(position.x, position.z, 2, Color("f4f8ff") if ground == "snow" else (Color("6a5a44") if ground == "mud" else Color("e0c08a")), 0.35)

# --feellog: how smooth remote fighters move (frame-to-frame speed while they run).
func _log_motion(spd: float, delta: float) -> void:
	_mlog.frames += 1
	if target.distance_to(position) > 0.05 or spd > 1.0:
		_mlog.n += 1
		_mlog.sum += spd
		_mlog.sum2 += spd * spd
		if spd < 0.5 and vel.length() > 2.0:
			_mlog.stall += 1
		_mlog.jerk += absf(spd - float(_mlog.prev))   # frame-to-frame speed change: 0 = perfectly even
	_mlog.prev = spd

func motion_stats() -> Dictionary:
	var n: int = maxi(1, int(_mlog.n))
	var mean: float = _mlog.sum / n
	var sd := sqrt(maxf(0.0, _mlog.sum2 / n - mean * mean))
	return {"n": _mlog.n, "mean": mean, "cv": sd / maxf(mean, 1e-3), "stall": _mlog.stall, "jerk": _mlog.jerk / n / maxf(mean, 1e-3)}

func _process(delta: float) -> void:
	if _dbg_cam.size() > 0 or _dbg_fx != "":
		_debug()
	if _team != _team_key():
		_team_colours()
	if _q_rev != Quality.rev:
		_show_lines()
	if _flash_t > 0.0:
		_flash_t = maxf(0.0, _flash_t - delta * 7.0)
		if _flash_t <= 0.0:
			_set_tint(Vector3.ZERO)
			_cold_shown = -1.0   # let the frost tint repaint
		else:
			var f := 1.0 if _flash_t > 0.75 else _flash_t * 0.9   # white, two frames at full
			_set_tint(Vector3(f, f, f))
	if _emote_t > 0.0:
		_emote_t -= delta
		_emote.position.y = 3.5 + 0.1 * sin(_emote_t * 6.0)
		if _emote_t <= 0.0:
			_emote.visible = false
	visible = (alive and not hidden_by_server) or _die_t > 0.0
	if _ring:
		_ring.visible = alive
	if not visible:
		return
	if not alive:
		_update_dying(delta)
		return
	_update_status(delta)
	_update_scale(delta)
	if _held:   # a Duo revive: back on its feet
		_held = false
		_busy = ""
		_enter("Idle", 0.0)
	_motion(delta)   # FEEL
	var frac := clampf(hp / maxf(max_hp, 1.0), 0.0, 1.0)
	_bar.scale.x = maxf(frac, 0.001)
	_bar_mat.albedo_color = Color(0.9, 0.2, 0.2).lerp(Color(0.3, 0.9, 0.3), frac)

# Screenshots side by side with the web build (devtools.js pose / close), your own brawler only:
#   --fightercam=zoom,facing   stand still (Idle frame 0), the game camera on you at that zoom; the
#                              position is never touched (the server kicks a teleporting client)
#   --fightercam=dist,yaw,h,facing   the close-up of devtools.js pose() instead
#   --fighterfx=hurt|slow|freeze|stun|bush   hold that look
func _debug() -> void:
	if not is_local:
		return
	if _dbg_cam.size() >= 1:
		var m := Quality.main_node()
		var touch = m.get("touch") if m else null
		if touch != null:
			touch.move = Vector2.ZERO
		rotation.y = _dbg_cam[_dbg_cam.size() - 1] if _dbg_cam.size() in [2, 4] else rotation.y
		var cam := get_viewport().get_camera_3d()
		if cam and _dbg_cam.size() >= 3:   # devtools.js close(dist, yaw, h)
			var d := _dbg_cam[0]
			cam.position = position + Vector3(sin(_dbg_cam[1]) * d, d * _dbg_cam[2] + 1.1, cos(_dbg_cam[1]) * d)
			cam.look_at(position + Vector3(0, 1.1, 0))
		elif cam:
			cam.position = position + Lighting.CAM_OFFSET * _dbg_cam[0]
			cam.look_at(position + Vector3(0, 0.5, 0))
		if not has_meta("dbg_said"):
			set_meta("dbg_said", true)
			print("FIGHTERCAM at ", position, " map ", get_parent().get("_map"))
		if _anim and _clips.has("Idle") and _busy == "" and not _held:   # the tree steps aside
			if _tree:
				_tree.active = false
			_anim.active = true
			_anim.play(_clips.Idle)
			_anim.seek(0.0, true)
			_anim.speed_scale = 0.0
	match _dbg_fx:
		"hurt": _flash_t = 0.9
		"slow": flags |= 4
		"freeze": flags |= 8
		"stun": flags |= 32
		"bush": set_faded(true)
