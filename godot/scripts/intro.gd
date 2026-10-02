extends CanvasLayer
# Boot intro of the native builds (Windows / Linux / Android), the web loader's gag
# (godot/web_shell) played with the real figurines: Blaster runs in and lobs seeds at the
# AI SLOP ARENA title, each hit letter wobbles, drops and bounces on the ground; Gunslinger runs in,
# zaps him, Blaster panics and runs off; the overlay fades on the menu (built behind it).
# ~3.6 s, once per launch (main.gd adds it at the end of _ready), skipped by any key / click / tap /
# pad button. Not on web (the HTML shell already plays it) nor under the --autotest / --menushot /
# --fxdemo / --keytest checks; --nointro turns it off. Own little 3D world in a SubViewport, the
# combat Fx (fx.gd) for sparks, dust and flashes.
#   godot --path godot -- --introshot=/tmp/intro   saves /tmp/intro_00.png... at fixed times, then quits

signal finished

const INK := Color("0d0a14")
const BG := Color("16121f")
const GOLD := Color("ffc93a")
const WHITE := Color("f4f0ff")
const TITLE := "AI SLOP ARENA"
const FS := 150                 # Label3D font size / pixel size: ~0.9 m tall capitals
const PS := 0.0058
const TITLE_Y := 4.05
const GRAV := 30.0
const B_HOME := -4.6
const G_HOME := 4.7

var audio: Node = null           # AudioManager (main.gd), may be null
var _shot_prefix := ""
var _shot_i := 0
var _root: Control
var _vp: SubViewport
var _world: Node3D
var _cam: Camera3D
var _fx: Fx
var _t := 0.0                   # timeline (starts once both figurines are loaded)
var _wall := 0.0
var _fade := -1.0
var _done := false
var _letters: Array = []        # {node, c, w, hx, hy, x, y, rot, vx, vy, vr, st, t, sq, wob, wobv}
var _order: Array = []
var _next_shot := 0
var _seeds: Array = []          # {node, p, v, t, T, l}
var _bolts: Array = []          # {node, p, v}
var _bang: Label3D
var _bang_t := -1.0
var _rng := RandomNumberGenerator.new()
var _paths := ["res://assets/models/blaster.glb", "res://assets/models/gunslinger.glb"]
var _b: Dictionary = {}         # actor: {node, anim, clips, x, y, vy, face, run, state}
var _g: Dictionary = {}
var _b_hit := -1.0

# Should the intro play this launch?
static func wanted() -> bool:
	if OS.has_feature("web"):
		return false
	for a in DebugArgs.list():
		var s := String(a)
		if s.begins_with("--introshot"):
			return true
		for f in ["--autotest", "--menushot", "--fxdemo", "--keytest", "--nointro"]:
			if s.begins_with(f):
				return false
	return true

func _init(audio_: Node = null) -> void:
	audio = audio_

func _ready() -> void:
	layer = 100
	_rng.randomize()
	for a in DebugArgs.list():
		if String(a).begins_with("--introshot="):
			_shot_prefix = String(a).substr(12)
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_root)
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(bg)
	var glow := UiKit.grad_rect(UiKit.grad([[0.0, Color("2a2040")], [1.0, Color(BG, 0.0)]], Vector2(0.5, 0.42), Vector2(1.1, 1.0), true))
	glow.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(glow)
	var svc := SubViewportContainer.new()
	svc.stretch = true
	svc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	svc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(svc)
	_vp = SubViewport.new()
	_vp.own_world_3d = true
	_vp.transparent_bg = true
	_vp.msaa_3d = Viewport.MSAA_2X
	svc.add_child(_vp)
	_world = Node3D.new()
	_vp.add_child(_world)
	_build_world()
	_build_title()
	for p in _paths:
		ResourceLoader.load_threaded_request(p)

func _build_world() -> void:
	_cam = Camera3D.new()
	_cam.position = Vector3(0, 2.6, 11.0)
	_world.add_child(_cam)
	_cam.look_at(Vector3(0, 2.25, 0))
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -30, 0)
	sun.light_energy = 1.25
	_world.add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-15, 150, 0)
	fill.light_energy = 0.45
	_world.add_child(fill)
	var we := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.82, 0.8, 0.95)
	e.ambient_light_energy = 0.75
	we.environment = e
	_world.add_child(we)
	# the ground: a dark band with a lighter lip, like the web loader
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(80, 14)
	ground.mesh = pm
	ground.position = Vector3(0, 0, 1)
	var gm := StandardMaterial3D.new()
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gm.albedo_color = Color("1c1628")
	ground.material_override = gm
	_world.add_child(ground)
	var lip := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(80, 0.06, 0.06)
	lip.mesh = bm
	lip.position = Vector3(0, 0.0, -6)
	var lm := StandardMaterial3D.new()
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.albedo_color = Color("2f2545")
	lip.material_override = lm
	_world.add_child(lip)
	_fx = Fx.new()
	_world.add_child(_fx)
	var prev := Fx.current
	_fx.setup(null, {}, "")
	Fx.current = prev   # the intro's effects are its own: the match / menu keep theirs

func _label(text: String, col: Color, size: int, outline: int) -> Label3D:
	var lb := Label3D.new()
	lb.text = text
	lb.font = Fonts.display()
	lb.font_size = size
	lb.pixel_size = PS
	lb.outline_size = outline
	lb.outline_modulate = INK
	lb.modulate = col
	lb.double_sided = true
	lb.shaded = false
	lb.alpha_cut = Label3D.ALPHA_CUT_DISABLED
	lb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lb.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	return lb

func _build_title() -> void:
	var font := Fonts.display()
	var track := 0.06
	var widths: Array = []
	var total := 0.0
	for c in TITLE:
		var w := (font.get_string_size(c, HORIZONTAL_ALIGNMENT_LEFT, -1, FS).x * PS) if c != " " else 0.55
		widths.append(w)
		total += w + track
	total -= track
	var x := -total / 2.0
	var gold := true
	for i in TITLE.length():
		var c := TITLE[i]
		var w: float = widths[i]
		if c == " ":
			if i > 3:
				gold = false   # "ARENA" is white
			x += w + track
			continue
		var lb := _label(c, GOLD if gold else WHITE, FS, 44)
		var sh := _label(c, Color(0, 0, 0, 0.45), FS, 44)   # drop shadow
		sh.outline_modulate = Color(0, 0, 0, 0.45)
		sh.position = Vector3(0.03, -0.1, -0.05)
		lb.add_child(sh)
		_world.add_child(lb)
		var l := {"node": lb, "c": c, "w": w, "hx": x + w / 2.0, "hy": TITLE_Y, "x": x + w / 2.0, "y": TITLE_Y, "rot": 0.0,
			"vx": 0.0, "vy": 0.0, "vr": 0.0, "st": 0, "t": 0.0, "sq": 0.0, "wob": 0.0, "wobv": 0.0, "aimed": false}
		_letters.append(l)
		x += w + track
	_order = range(_letters.size())
	_order.shuffle()
	_bang = _label("!", GOLD, 230, 56)   # Blaster's "uh-oh"
	_bang.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_bang.visible = false
	_world.add_child(_bang)

# ---------------------------------------------------------------- figurines

func _actor(path: String) -> Dictionary:
	var ps := ResourceLoader.load_threaded_get(path) as PackedScene
	if ps == null:
		return {}
	var inst: Node3D = ps.instantiate()
	var holder := Node3D.new()
	holder.add_child(inst)
	_world.add_child(holder)
	var a := {"node": holder, "model": inst, "anim": null, "clips": {}, "x": 0.0, "y": 0.0, "vy": 0.0, "face": 1.0, "cur": "", "ph": 0.0, "run": 0.0}
	for ap in inst.find_children("*", "AnimationPlayer", true, false):
		a.anim = ap
	if a.anim:
		var player: AnimationPlayer = a.anim
		for n in player.get_animation_list():
			var s := String(n)
			var k := s.get_slice("/", s.get_slice_count("/") - 1)
			a.clips[k] = s
			player.get_animation(s).loop_mode = Animation.LOOP_LINEAR if k in ["Idle", "Run", "Aim", "Victory"] else Animation.LOOP_NONE
	return a

func _play(a: Dictionary, clip: String, speed := 1.0, fade := 0.12, restart := false) -> void:
	if a.is_empty() or a.anim == null or not a.clips.has(clip):
		return
	var player: AnimationPlayer = a.anim
	if a.cur == clip and not restart:
		player.speed_scale = speed
		return
	a.cur = clip
	player.speed_scale = speed
	player.play(a.clips[clip], fade)
	if restart:
		player.seek(0.0, true)

func _place(a: Dictionary) -> void:
	var n: Node3D = a.node
	n.position = Vector3(a.x, a.y, 0.4)
	# three-quarter view towards the side it faces
	n.rotation.y = 1.05 if a.face > 0 else -1.05

func _muzzle(a: Dictionary) -> Vector3:
	return Vector3(a.x + a.face * 1.15, a.y + 1.15, 0.9)

# ---------------------------------------------------------------- timeline

func _process(delta: float) -> void:
	if _done:
		return
	_wall += delta
	if _fade >= 0.0:
		_fade += delta
		_root.modulate.a = clampf(1.0 - _fade / 0.35, 0.0, 1.0)
		if _fade >= 0.35:
			_finish()
		return
	_fit_camera()
	if _b.is_empty():
		var ready := true
		for p in _paths:
			var st := ResourceLoader.load_threaded_get_status(p)
			if st == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
				ready = false
			elif st != ResourceLoader.THREAD_LOAD_LOADED:
				_skip()   # no figurines: no intro
				return
		if not ready:
			_bob_title(delta)
			if _wall > 3.0:
				_skip()
			return
		_b = _actor(_paths[0])
		_g = _actor(_paths[1])
		if _b.is_empty() or _g.is_empty():
			_skip()
			return
		_b.x = -9.0
		_g.x = 9.5
		_g.face = -1.0
		_place(_b)
		_place(_g)
	var t0 := _t
	_t += delta
	_direct(t0, _t, delta)
	_update_letters(delta)
	_update_projectiles(delta)
	_place(_b)
	_place(_g)
	if _shot_prefix != "":
		_maybe_shot()
	elif _t > 5.6:
		_skip()

func _at(t0: float, t1: float, t: float) -> bool:
	return t0 < t and t1 >= t

func _direct(t0: float, t1: float, dt: float) -> void:
	# Blaster runs in, plants himself, rapid-fires at the title
	if _b.x < B_HOME and _b_hit < 0.0:
		_b.x = minf(B_HOME, _b.x + 9.0 * dt)
		_play(_b, "Run", 1.3)
		_steps(_b, dt)
		if _b.x >= B_HOME:
			_fx.dust(_b.x + 0.5, 0.4, 3, Color("5d527a"), 0.6)
			_play(_b, "Aim")
	elif _b_hit < 0.0 and _next_shot >= _letters.size() and t1 > 2.6:
		_play(_b, "Idle")
	while _next_shot < _letters.size() and t1 >= 0.62 + _next_shot * 0.11:
		_fire_seed(_letters[_order[_next_shot]])
		_next_shot += 1
	# Gunslinger runs in from the right, Blaster notices
	if t1 >= 1.75 and _g.x > G_HOME:
		_g.x = maxf(G_HOME, _g.x - 12.0 * dt)
		_play(_g, "Run", 1.4)
		_steps(_g, dt)
		if _g.x <= G_HOME:
			_fx.dust(_g.x - 0.5, 0.4, 4, Color("5d527a"), 0.7)
			_play(_g, "Aim")
	if _at(t0, t1, 1.9):
		_bang_t = 0.0
		_bang.visible = true
		_sfx("ping", 0.6)
	if _at(t0, t1, 2.15):
		_zap()
	if _at(t0, t1, 2.32):
		_zap()
	if _at(t0, t1, 2.75):
		_play(_g, "Victory")
		_fx.spark_burst(Vector3(_g.x, 2.9, 0.6), Color(3.0, 2.4, 0.6), 14, 4.0, 0.5, 0.14)
	if _at(t0, t1, 3.3) and _shot_prefix == "":
		_skip()
	# Blaster after the zap: hop, then run away to the left in a panic
	if _b_hit >= 0.0:
		_b_hit += dt
		_b.vy -= GRAV * dt
		_b.y = maxf(0.0, _b.y + _b.vy * dt)
		if _b_hit > 0.18:
			_b.face = -1.0
			_b.x -= 13.0 * dt * clampf((_b_hit - 0.18) * 4.0, 0.0, 1.0)
			_play(_b, "Run", 1.9)
			_steps(_b, dt)
			if _rng.randf() < dt * 10.0:   # panic sweat
				_fx.spark_burst(Vector3(_b.x, 2.6, 0.6), Color(0.6, 1.6, 3.0), 2, 2.5, 0.4, 0.12)
	if _bang_t >= 0.0:
		_bang_t += dt
		var s := _back(_bang_t / 0.18) * (1.0 - clampf((_bang_t - 0.7) / 0.15, 0.0, 1.0))
		_bang.position = Vector3(_b.x + 0.2, _b.y + 3.2, 0.6)
		_bang.scale = Vector3.ONE * maxf(0.001, s)
		_bang.rotation.z = sin(_bang_t * 30.0) * 0.08
		if _bang_t > 0.85 or _b_hit >= 0.0:
			_bang.visible = false
			_bang_t = -1.0

func _steps(a: Dictionary, dt: float) -> void:
	var op: float = a.ph
	a.ph = op + dt * 3.4
	if floori(op) != floori(a.ph):
		for l in _letters:   # kick the letters lying in the way
			if l.st == 3 and absf(l.x - a.x) < 0.7:
				l.st = 2
				l.vy = _rng.randf_range(5.0, 7.0)
				l.vx = a.face * _rng.randf_range(2.0, 5.0)
				l.vr = _rng.randf_range(-6.0, 6.0)

func _fire_seed(l: Dictionary) -> void:
	l.aimed = true
	var m := _muzzle(_b)
	var target := Vector3(l.x, l.y, 0.0)
	var T := 0.26 + m.distance_to(target) * 0.012
	var g := Vector3(0, -GRAV * 0.6, 0)
	var v := (target - m - 0.5 * g * T * T) / T
	var mi := MeshInstance3D.new()
	mi.mesh = FxLib.seed_mesh()
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("8bc34a")
	mat.emission_enabled = true
	mat.emission = Color("4a7a1c")
	mi.material_override = mat
	mi.scale = Vector3.ONE * 0.2
	mi.position = m
	_world.add_child(mi)
	_seeds.append({"node": mi, "p": m, "v": v, "g": g, "t": 0.0, "T": T, "l": l})
	_fx.muzzle(m, Vector3(1, 0, 0), Color(3.0, 2.6, 1.2))
	_play(_b, "Shoot", 2.2, 0.05, true)
	_sfx("shot", 0.45)

func _zap() -> void:
	var m := _muzzle(_g)
	var target := Vector3(_b.x, 1.3, 0.4)
	var mi := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.12
	cap.height = 1.1
	mi.mesh = cap
	mi.material_override = FxLib.glow(Color(0.5, 2.4, 3.2))
	mi.position = m
	_world.add_child(mi)
	var d := (target - m).normalized()
	mi.look_at_from_position(m, target, Vector3.UP)
	mi.rotate_object_local(Vector3.RIGHT, PI / 2.0)   # the capsule's axis is Y
	_bolts.append({"node": mi, "p": m, "v": d * 42.0})
	_fx.muzzle(m, d, Color(0.6, 2.6, 3.2))
	_play(_g, "Shoot", 2.0, 0.05, true)
	_sfx("shot_zap", 0.7)

func _update_projectiles(dt: float) -> void:
	for i in range(_seeds.size() - 1, -1, -1):
		var s: Dictionary = _seeds[i]
		s.t += dt
		s.v += s.g * dt
		s.p += s.v * dt
		(s.node as Node3D).position = s.p
		(s.node as Node3D).rotate_z(dt * 14.0)
		if s.t >= s.T:
			var l: Dictionary = s.l
			_fx.hit(Vector3(l.x, l.y, 0.3), Color(3.2, 2.6, 0.6), (s.v as Vector3).normalized())
			_fx.spark_burst(Vector3(l.x, l.y, 0.3), Color(0.9, 2.2, 0.5), 5, 4.0, 0.5, 0.12)   # leaf bits
			l.st = 1
			l.t = 0.0
			l.wobv = (1.0 if (s.v as Vector3).x > 0.0 else -1.0) * 22.0
			l.sq = 0.6
			(s.node as Node).queue_free()
			_seeds.remove_at(i)
			_sfx("hit", 0.5)
	for i in range(_bolts.size() - 1, -1, -1):
		var b: Dictionary = _bolts[i]
		b.p += b.v * dt
		(b.node as Node3D).global_position = b.p
		if _b_hit < 0.0 and (b.p as Vector3).x <= _b.x + 0.4:
			var hp := Vector3(_b.x, 1.4, 0.6)
			_fx.hit(hp, Color(0.6, 2.8, 3.4), Vector3(-1, 0, 0))
			_fx.spark_burst(hp, Color(0.6, 2.8, 3.4), 16, 7.0, 0.45, 0.16)
			_fx.flash(hp, Color(0.6, 0.9, 1.0), 14, 7, 0.15)
			_b_hit = 0.0
			_b.vy = 7.0
			_play(_b, "Hit", 1.0, 0.03, true)
			_sfx("hurt", 0.8)
			(b.node as Node).queue_free()
			_bolts.remove_at(i)
		elif (b.p as Vector3).x < -16.0:
			(b.node as Node).queue_free()
			_bolts.remove_at(i)

func _update_letters(dt: float) -> void:
	var cap := FS * PS * 0.36   # half the height of a capital
	for l in _letters:
		l.wobv += (-l.wob * 260.0 - l.wobv * 9.0) * dt
		l.wob += l.wobv * dt
		l.sq *= exp(-dt * 8.0)
		if l.st == 0:
			l.y = l.hy + sin(_wall * 2.2 + l.hx * 0.4) * 0.05
		elif l.st == 1:
			l.t += dt
			l.x = l.hx + sin(l.t * 60.0) * 0.05 * (1.0 - l.t / 0.14)
			if l.t > 0.14:
				l.st = 2
				l.vx = _rng.randf_range(-1.0, 1.0) * 1.6
				l.vy = _rng.randf_range(4.0, 7.0)
				l.vr = _rng.randf_range(-3.0, 3.0)
		else:
			var hh: float = absf(cos(l.rot)) * cap + absf(sin(l.rot)) * l.w * 0.5
			if l.st == 2:
				l.vy -= GRAV * dt
				l.x += l.vx * dt
				l.y += l.vy * dt
				l.rot += l.vr * dt
				l.vr *= exp(-dt * 1.2)
				if l.y - hh <= 0.0:
					l.y = hh
					if l.vy < -3.0:
						var k := clampf(-l.vy / 14.0, 0.2, 1.0)
						l.vy = -l.vy * 0.36
						l.vx *= 0.6
						l.vr *= 0.3
						l.sq = k
						if k > 0.45:
							_fx.dust(l.x, 0.3, 1, Color("5d527a"), 0.4)
						_sfx("bump", 0.35 * k)
					else:
						l.st = 3
						l.vy = 0.0
			else:
				l.vx *= exp(-dt * 5.0)
				l.x += l.vx * dt
				l.rot = atan2(sin(l.rot), cos(l.rot))
				var rest := 0.0 if absf(l.rot) < 1.2 else signf(l.rot) * PI / 2.0
				l.rot = lerpf(l.rot, rest, minf(1.0, dt * 10.0))
				l.y = lerpf(l.y, hh, minf(1.0, dt * 20.0))
		var n: Label3D = l.node
		n.position = Vector3(l.x, l.y, 0.0)
		n.rotation.z = -(l.rot + l.wob * 0.06)
		var sq: float = l.sq * cos(l.sq * 8.0)
		n.scale = Vector3(1.0 + sq * 0.3, 1.0 - sq * 0.3, 1.0)

	var lying := _letters.filter(func(l): return l.st == 3)
	lying.sort_custom(func(a, b): return a.x < b.x)
	for i in range(1, lying.size()):
		var a: Dictionary = lying[i - 1]
		var b: Dictionary = lying[i]
		var o: float = _half(a) + _half(b) - (b.x - a.x)
		if o > 0.0:
			a.x -= o * 0.5 * minf(1.0, dt * 20.0)
			b.x += o * 0.5 * minf(1.0, dt * 20.0)
	for l in lying:
		(l.node as Node3D).position.x = l.x

func _half(l: Dictionary) -> float:
	return (absf(cos(l.rot)) * l.w + absf(sin(l.rot)) * FS * PS * 0.72) * 0.5 + 0.06

func _bob_title(_dt: float) -> void:
	for l in _letters:
		(l.node as Node3D).position.y = l.hy + sin(_wall * 2.2 + l.hx * 0.4) * 0.05

func _fit_camera() -> void:
	var s := _vp.size
	if s.y <= 0:
		return
	var a := float(s.x) / float(s.y)
	if a >= 1.6:
		_cam.keep_aspect = Camera3D.KEEP_HEIGHT
		_cam.fov = 34.0
	else:   # narrower than 16:10: keep the stage's width
		_cam.keep_aspect = Camera3D.KEEP_WIDTH
		_cam.fov = 58.0

static func _back(t: float) -> float:
	t = clampf(t, 0.0, 1.0) - 1.0
	return 1.0 + 2.7 * t * t * t + 1.7 * t * t

func _sfx(n: String, vol: float) -> void:
	if audio and audio.has_method("has_sound") and audio.call("has_sound", n):
		audio.call("play", n, null, vol)

# ---------------------------------------------------------------- skip / end

func _input(event: InputEvent) -> void:
	if _done or _shot_prefix != "":
		return
	var hit: bool = (event is InputEventKey and event.pressed and not event.echo) \
		or (event is InputEventMouseButton and event.pressed) \
		or (event is InputEventScreenTouch and event.pressed) \
		or (event is InputEventJoypadButton and event.pressed)
	if hit:
		get_viewport().set_input_as_handled()
		_skip()

func _skip() -> void:
	if _fade < 0.0:
		_fade = 0.0

func _finish() -> void:
	if _done:
		return
	_done = true
	for p in _paths:   # do not leave a threaded load dangling
		if ResourceLoader.load_threaded_get_status(p) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
			ResourceLoader.load_threaded_get(p)
	finished.emit()
	queue_free()

# --introshot: frames at fixed timeline times, then quit
const SHOTS := [0.3, 0.75, 0.95, 1.3, 1.7, 1.95, 2.2, 2.45, 2.7, 3.0, 3.3, 3.8]
func _maybe_shot() -> void:
	if _shot_i >= SHOTS.size():
		get_tree().quit()
		return
	if _t < SHOTS[_shot_i]:
		return
	var path := "%s_%02d.png" % [_shot_prefix, _shot_i]
	_shot_i += 1
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("introshot ", path, " t=", snappedf(_t, 0.01))
