class_name Hud
extends Control
# In-match HUD and combat feedback, drawn to look like the web build (src/hud.js + the HUD part of
# src/style.css / meta.css). Pure presentation: the server owns every rule. main.gd only forwards
# data to the API below:
#   setup(net, cam, world, touch)   once, when the UI is built
#   begin_match(start_msg, arena, fighters)   after the roster is created
#   set_local(fighter)              the local brawler (begin_match does it too, from net.id)
#   on_snapshot(msg) / on_event(e)  every "snap" / every entry of an "ev" list
#   fill_input(msg) -> msg          adds g/gx/gz/em/ei/pg... to the outgoing "in" message
#   result_open                     set by main.gd while its result screen (result_view.gd) is up
#   end_match()                     frees the match visuals (main calls it from _clear_match)
# Signals: play_again, menu_requested.
# Keys (same defaults as the web game, rebindable: controls.gd): Space / right click super (main.gd),
# E gadget, B emote wheel, G ping, M mute (main.gd), Esc pause; gamepad LB gadget, R3 wheel, X ping,
# Start pause. main.gd calls shortcuts() every frame of a match.
# Layers (bottom to top, like the web DOM): plates + numbers (hud_plates.gd), screen-edge
# vignettes (shader), then the HUD itself (_front), the emote wheel, pause and result boxes.
# All sizes are the web's CSS px times HudDraw.css_scale().

signal play_again
signal menu_requested
signal options_requested         # the pause card's OPTIONS (main.gd opens settings_view.gd)

const D := preload("res://scripts/hud_draw.gd")
const GADGET_LOCKOUT := 5.0
const GADGET_CHARGES := 3
# mobility gadgets (A): [distance m, seconds]; the server widens its move check for them
const DASH := {"blasterA": [4.0, 0.25], "gunslingerA": [3.5, 0.22], "bomberA": [5.0, 0.5], "frostbiteA": [5.0, 0.35],
	"voltA": [5.0, 0.15], "kappaA": [5.0, 0.3], "pipchompA": [6.0, 0.3], "mochiA": [5.0, 0.4]}
const PING_TEXT := {"attack": "ATTACK", "loot": "LOOT", "danger": "DANGER", "go": "GO"}
const PING_COL := {"attack": Color("ff5a4a"), "loot": Color("ffd24a"), "danger": Color("ff9a2a"), "go": Color("52e0e8")}
const PING_ICONS := {"go": "📍", "attack": "⚔️", "loot": "💎", "danger": "⚠️"}   # game.js PING_ICONS
# gadgets.js GADGET_ICONS
const GADGET_ICONS := {"blasterA": "🐏", "blasterB": "🪵", "gunslingerA": "🌀", "gunslingerB": "🎆", "bomberA": "🦘",
	"bomberB": "🧨", "frostbiteA": "⛸️", "frostbiteB": "🧊", "voltA": "⚡", "voltB": "🔋", "kappaA": "🤿", "kappaB": "🥣",
	"pipchompA": "🍖", "pipchompB": "🍄", "mochiA": "🛷", "mochiB": "🍡"}
# feel.js WEAPONS: the hurt flash strength when you take a hit from that weapon (normal, super)
const TAKEN := {"blaster": [0.18, 0.35], "gunslinger": [0.1, 0.12], "bomber": [0.3, 0.55], "frostbite": [0.15, 0.4],
	"volt": [0.18, 0.35], "kappa": [0.2, 0.4], "pipchomp": [0.25, 0.3], "mochi": [0.3, 0.5]}
const FEED_MAX := 4
const FEED_LIFE := 4.5

# Inset box-shadows of the web (#vignette poison, #bushEdge, #lowhp, #hurt), exact: a blurred inner
# rectangle (erf), composited in DOM order; plus the vision fog of the dark maps.
const SCREEN_SHADER := """
shader_type canvas_item;
uniform vec2 vs = vec2(1280.0, 720.0);
uniform float k = 1.0;
uniform float poison = 0.0;
uniform float bush = 0.0;
uniform float low = 0.0;
uniform float hurt = 0.0;
uniform float fog_on = 0.0;
uniform vec2 fog_c = vec2(0.5);
uniform vec2 fog_r = vec2(0.3, 0.2);
uniform vec3 fog_col = vec3(0.6, 0.66, 0.72);
float erf_(float x) {
	float s = sign(x);
	x = abs(x);
	float t = 1.0 + 0.278393 * x + 0.230389 * x * x + 0.000972 * x * x * x + 0.078108 * x * x * x * x;
	return s * (1.0 - 1.0 / (t * t * t * t));
}
// alpha of `box-shadow: inset 0 0 blur spread` at pixel p
float inset(vec2 p, float blur, float spread) {
	float sg = max(blur * 0.5 * k, 0.001) * 1.41421;
	float sp = spread * k;
	float cx = 0.5 * (erf_((p.x - sp) / sg) + erf_((vs.x - sp - p.x) / sg));
	float cy = 0.5 * (erf_((p.y - sp) / sg) + erf_((vs.y - sp - p.y) / sg));
	return 1.0 - clamp(cx * cy, 0.0, 1.0);
}
void over(inout vec3 rgb, inout float a, vec3 c, float ca) {
	rgb = c * ca + rgb * (1.0 - ca);
	a = ca + a * (1.0 - ca);
}
void fragment() {
	vec2 p = UV * vs;
	vec3 rgb = vec3(0.0);
	float a = 0.0;
	if (fog_on > 0.5) {
		vec2 d = (UV - fog_c) / fog_r;
		over(rgb, a, fog_col, smoothstep(0.85, 1.25, length(d)) * 0.93);
	}
	if (poison > 0.001) over(rgb, a, vec3(40.0, 220.0, 90.0) / 255.0, 0.55 * poison * inset(p, 160.0, 40.0));
	if (bush > 0.001) over(rgb, a, vec3(47.0, 180.0, 80.0) / 255.0, 0.45 * bush * inset(p, 90.0, 18.0));
	if (low > 0.001) over(rgb, a, vec3(230.0, 30.0, 40.0) / 255.0, 0.55 * low * inset(p, 140.0, 30.0));
	if (hurt > 0.001) over(rgb, a, vec3(1.0, 40.0 / 255.0, 40.0 / 255.0), 0.7 * hurt * inset(p, 90.0, 10.0));
	COLOR = vec4(a > 0.0001 ? rgb / a : vec3(0.0), clamp(a, 0.0, 1.0));
}
"""

var net: NetClient
var cam: Camera3D
var world: Node3D
var touch: TouchControls
var arena: Arena
var fighters: Dictionary = {}
var me: Fighter
var fx: Fx
var gas: GasRing
var wheel: EmoteWheel

var playing := false
var alive_n := 0
var vision := 0.0
var night_hunt := false     # read by sight.gd (Night Hunt: you see 9 m)
const MOON_MIST := Color(0.1, 0.13, 0.13)   # visionfog.js, linear
var last_pt := -1.0
var _gas_debug := false
var _dbg_desktop := false
var _dbg_test := -1.0
var in_gas := false
var gas_tick := 0.0

# input counters sent to the server
var gad_seq := 0
var gad_dir := Vector2(0, 1)
var emote_seq := 0
var emote_idx := -1
var ping_seq := 0
var ping_at := Vector2.ZERO
var _has_ping := false

# gadget state (server is the truth: 'gad' / 'gadNo' events resync it)
var gad_charges := GADGET_CHARGES
var gad_cd := 0.0
var _dash_t := 0.0
var _dash_v := Vector2.ZERO
var _emote_cd := 0.0
var _ping_cd := 0.0

# look state
var _time := 0.0
var _feed: Array = []          # {killer, kkey, victim, vkey, sup, kind, age}
var _banner := {}              # {text, kind, age}
var _cutin := {}               # {tex, age}
var _pings: Array = []         # {p: Vector3, kind, t, age}
var _mh_lag := 1.0
var _mh_alpha := 1.0
var _hurt_v := 0.0
var _hurt_age := 9.0
var _low_on := 0.0
var _poison_v := 0.0
var _bush_v := 0.0
var _gad_bump := 9.0
var _faces: Dictionary = {}
var _audio: Node

var _plates: HudPlates
var _screen: ColorRect
var _screen_mat: ShaderMaterial
var _front: Control
var _pause_box: Control
var result_open := false        # main.gd's result screen (result_view.gd) is up: no pause box

func setup(net_: NetClient, cam_: Camera3D, world_: Node3D, touch_: TouchControls) -> void:
	net = net_
	cam = cam_
	world = world_
	touch = touch_
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_plates = HudPlates.new()
	add_child(_plates)
	_screen = ColorRect.new()
	_screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_screen_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SCREEN_SHADER
	_screen_mat.shader = sh
	_screen.material = _screen_mat
	add_child(_screen)
	_front = Control.new()
	_front.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_front.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_front.draw.connect(_draw_front)
	add_child(_front)
	wheel = EmoteWheel.new()
	wheel.picked.connect(_on_emote_picked)
	add_child(wheel)
	touch.gadget_pressed.connect(use_gadget)
	touch.emote_pressed.connect(func(): if playing and me and me.alive: wheel.toggle())
	touch.pause_pressed.connect(_toggle_pause)
	_build_pause()
	get_viewport().size_changed.connect(func(): D.invalidate(); _front.queue_redraw())
	visible = false

func _build_pause() -> void:
	var pv := PauseView.new()   # the web's #pause card (pause_view.gd)
	pv.quit.connect(func(): menu_requested.emit())
	pv.options.connect(func(): options_requested.emit())
	add_child(pv)
	_pause_box = pv

# ---------------------------------------------------------------- match lifecycle

func begin_match(start_msg: Dictionary, arena_: Arena, fighters_: Dictionary) -> void:
	end_match()
	arena = arena_
	fighters = fighters_
	alive_n = fighters.size()
	fx = Fx.new()
	world.add_child(fx)
	fx.setup(arena, fighters, net.id)
	# the damage numbers are drawn in 2D by HudPlates (web .floater look): keep fx's 3D labels off camera
	var labels: Variant = fx.get("_labels")
	if labels is Array:
		for l in labels:
			if l is VisualInstance3D:
				(l as VisualInstance3D).layers = 0
	gas = GasRing.new()
	world.add_child(gas)
	var mut := str(start_msg.get("mut", "") if typeof(start_msg.get("mut", "")) == TYPE_STRING else "")
	# poison.js real-match defaults; the gasBreath mutator is faster; crumble maps have no gas
	var params := {"startAt": 28.0, "interval": 7.0}
	if mut == "gasBreath":
		params = {"startAt": 16.0, "interval": 4.5}
	if arena.map.get("crumble", false):
		params = {"startAt": 1e9, "interval": 7.0}
	gas.setup(params)
	_gas_debug = DebugArgs.list().has("--gastest")   # screenshot check: pretend the gas clock is at 45 s
	_dbg_desktop = DebugArgs.has("desktophud")
	_dbg_test = 0.0 if DebugArgs.has("hudtest") else -1.0
	if _gas_debug:
		gas.set_timer(45.0)
	vision = float(arena.map.get("vision", 0.0))
	night_hunt = mut == "nightHunt"
	if mut == "nightHunt":
		vision = vision * 0.8
	_screen_mat.set_shader_parameter("fog_on", 1.0 if vision > 0.0 else 0.0)
	me = fighters.get(net.id)
	gad_charges = GADGET_CHARGES
	gad_cd = 0.0
	_dash_t = 0.0
	last_pt = -1.0
	_feed.clear()
	_pings.clear()
	_banner = {}
	_cutin = {}
	_mh_lag = 1.0
	_hurt_age = 9.0
	_poison_v = 0.0
	_bush_v = 0.0
	result_open = false
	_pause_box.visible = false
	_plates.begin(cam, fighters, me, arena)
	_plates.visible = true
	visible = true

func end_match() -> void:
	if fx:
		fx.queue_free()
		fx = null
	if gas:
		gas.queue_free()
		gas = null
	me = null
	playing = false
	visible = false
	if _plates:
		_plates.clear()
	if wheel:
		wheel.close()
	result_open = false
	if _pause_box:
		_pause_box.visible = false

func set_local(f: Fighter) -> void:
	me = f
	if _plates:
		_plates.me = f

func on_snapshot(m: Dictionary) -> void:
	if gas and m.has("pt") and not _gas_debug:
		var pt := float(m.pt)
		# resync the local clock when it drifts (the snapshot is the truth)
		if last_pt < 0.0 or absf(gas.timer - pt) > 0.25:
			gas.set_timer(pt)
		last_pt = pt

func on_event(e: Dictionary) -> void:
	var id := str(e.get("id", ""))
	var f: Fighter = fighters.get(id)
	if fx:
		fx.on_event(e)
	match str(e.get("e", "")):
		"dmg":
			if f == null or not f.visible:
				return
			var src := str(e.get("s", ""))
			var cls := "dmg-in" if f == me else ("dmg-out" if me and src == me.id else "dmg-other")
			_plates.floater(f.position + Vector3(0, 2.6, 0), float(e.get("a", 0)), cls, "%s>%s" % [src, f.id] if src != "" else "")
			if f == me and me:
				var sf: Fighter = fighters.get(src)
				var spec: Array = TAKEN.get(str(sf.type.get("key", "")) if sf else "", [0.18, 0.18])
				_hurt_v = minf(1.0, 0.35 + float(spec[1 if bool(e.get("u", false)) else 0]) * 1.6)
				_hurt_age = 0.0
		"heal":
			if f and f.visible:
				var a := float(e.get("a", 0))
				_plates.floater(f.position + Vector3(0, 2.9, 0), a, "heal", "heal>" + f.id, "+%d" % int(round(a)))
		"miss":   # combat.js missFx: a whiffed bite
			if f and f.visible:
				_plates.floater(f.position + Vector3(0, 3.0, 0), 0.0, "immune", "", I18n.t("hud.miss"))
		"imm":    # game.js: a hit on an untouchable brawler
			if f and f.visible:
				_plates.floater(f.position + Vector3(0, 3.1, 0), 0.0, "immune", "", I18n.t("hud.immune"))
		"atk":
			if f and f == me and bool(e.get("s", false)):
				var key := str(me.type.get("key", ""))
				var tex := _face(key)
				if tex:
					_cutin = {"tex": tex, "age": 0.0}
		"kill":
			var before := alive_n
			alive_n = maxi(alive_n - 1, 0)
			var by: Fighter = fighters.get(str(e.get("by", "")))
			var row := {"killer": "", "kkey": "", "victim": I18n.t("hud.you") if f == me else (f.fname if f else "?"),
				"vkey": str(f.type.get("key", "")) if f else "", "sup": bool(e.get("sup", false)), "kind": "", "age": 0.0}
			if by and by != f:
				row.killer = I18n.t("hud.you") if by == me else by.fname
				row.kkey = str(by.type.get("key", ""))
			if by and by == me and f != me:
				row.kind = "mine"
				if f:
					_plates.ko_stamp(f.position + Vector3(0, 1.6, 0))
			elif f == me:
				row.kind = "me"
			_feed.push_front(row)
			while _feed.size() > FEED_MAX:
				_feed.pop_back()
			if me and alive_n < before and not result_open:
				if alive_n == 3:
					_show_banner(I18n.t("hud.threeLeft"), "three")
				elif alive_n == 2:
					_show_banner(I18n.t("hud.finalDuel"), "duel")
		# (the result screen itself: main.gd + result_view.gd, after the web's 1.2 s beat)
		"gad":
			if f == me and f and e.has("c"):
				gad_charges = int(e.c)
		"gadNo":
			if f == me and f:
				gad_charges = int(e.get("c", gad_charges))
				gad_cd = float(e.get("cd", 0.0))
		"emo":
			var i := int(e.get("i", -1))
			if f and i >= 0 and i < EmoteWheel.NAMES.size():
				_plates.say(f, EmoteWheel.ICONS[i], EmoteWheel.NAMES[i], EmoteWheel.COLORS[i])
		"ping":
			_add_ping(Vector3(float(e.get("x", 0)), 0, float(e.get("z", 0))), str(e.get("k", "go")))

func _show_banner(text: String, kind: String) -> void:
	_banner = {"text": text, "kind": kind, "age": 0.0}

func _add_ping(p: Vector3, k: String) -> void:
	_pings.append({"p": p, "kind": k, "t": 4.0, "age": 0.0})
	while _pings.size() > 4:
		_pings.pop_front()
	if fx:
		fx.ring(p, PING_COL.get(k, Color.WHITE), 1.4, 20, 0.7)

# The counters and vectors of the outgoing "in" message.
func fill_input(msg: Dictionary) -> Dictionary:
	msg["g"] = gad_seq
	msg["gx"] = snappedf(gad_dir.x, 0.01)
	msg["gz"] = snappedf(gad_dir.y, 0.01)
	msg["em"] = emote_seq
	msg["ei"] = emote_idx
	if _has_ping:
		msg["pg"] = ping_seq
		msg["qx"] = snappedf(ping_at.x, 0.01)
		msg["qz"] = snappedf(ping_at.y, 0.01)
	return msg

# ---------------------------------------------------------------- actions

func _walk_dir() -> Vector2:
	var mv := touch.move if touch and touch.visible else Vector2.ZERO
	var kb := Controls.move()
	return kb if kb != Vector2.ZERO else mv

func use_gadget() -> void:
	if not playing or me == null or not me.alive or gad_charges <= 0 or gad_cd > 0.0 or _dash_t > 0.0:
		return
	# mobility gadgets go where you walk (if you walk), else where you face
	var d := _walk_dir()
	if d.length() < 0.2:
		d = Vector2(sin(me.rotation.y), cos(me.rotation.y))
	d = d.normalized()
	gad_dir = d
	gad_seq += 1
	gad_charges -= 1
	gad_cd = GADGET_LOCKOUT
	_gad_bump = 0.0
	var key := str(me.type.get("key", "")) + "A"
	if DASH.has(key):
		var spec: Array = DASH[key]
		_dash_t = float(spec[1])
		_dash_v = d * (float(spec[0]) / float(spec[1]))
	if fx:
		fx.ring(me.position, Color(0.6, 0.9, 1.0, 0.8), 1.4, 18, 0.3)

func _on_emote_picked(i: int) -> void:
	if _emote_cd > 0.0 or not playing:
		return
	_emote_cd = 2.5
	emote_seq += 1
	emote_idx = i

# at: where (the gamepad's aim point); null = under the mouse, or 8 m ahead on a touch screen.
func send_ping(at: Variant = null) -> void:
	if not playing or me == null or not me.alive or _ping_cd > 0.0:
		return
	_ping_cd = 1.0
	var p := me.position + Vector3(sin(me.rotation.y), 0, cos(me.rotation.y)) * 8.0
	if at is Vector3:
		p = at
	elif not (touch and touch.visible):
		var mp := get_viewport().get_mouse_position()
		var from := cam.project_ray_origin(mp)
		var dir := cam.project_ray_normal(mp)
		if absf(dir.y) > 1e-4 and -from.y / dir.y > 0.0:
			p = from + dir * (-from.y / dir.y)
	ping_seq += 1
	ping_at = Vector2(p.x, p.z)
	_has_ping = true

func _toggle_pause() -> void:
	if playing and not result_open:
		_pause_box.visible = not _pause_box.visible

func pause_view() -> Control:
	return _pause_box

func pause_open() -> bool:
	return _pause_box != null and _pause_box.visible

func close_pause() -> void:
	if _pause_box:
		_pause_box.visible = false

func _toggle_mute() -> void:
	var a := _audio_mgr()
	if a and a.has_method("toggle_mute"):
		a.call("toggle_mute")

func _muted() -> bool:
	var a := _audio_mgr()
	return a != null and bool(a.get("muted"))

func _audio_mgr() -> Node:
	if _audio == null or not is_instance_valid(_audio):
		var s := get_tree().current_scene
		var v: Variant = s.get("audio") if s else null
		_audio = v if v is Node else null
	return _audio

# The match shortcuts (bound keys + gamepad), polled by main.gd every frame of a match while no
# options screen is open. ping_at: the gamepad's aim point (null = under the mouse).
func shortcuts(ping_at: Variant = null) -> void:
	if wheel.visible:
		wheel.pad_update()
	if pause_open():
		if Controls.just("pause") or Controls.pad_hit(JOY_BUTTON_B):
			close_pause()
		return
	if Controls.just("pause"):
		if wheel.visible:
			wheel.close()
		else:
			_toggle_pause()
		return
	if Controls.just("gadget"):
		use_gadget()
	if Controls.just("emote") and playing and me and me.alive:
		wheel.toggle_or_pick()
	if Controls.just("ping"):
		send_ping(ping_at if Controls.using_pad else null)

# the sound button (top left): a click mutes / unmutes (the web opens its volume panel)
func _input(ev: InputEvent) -> void:
	if not visible or not (ev is InputEventMouseButton) or not ev.pressed or ev.button_index != MOUSE_BUTTON_LEFT:
		return
	if _sound_rect().has_point(ev.position):
		_toggle_mute()
		get_viewport().set_input_as_handled()

func _sound_rect() -> Rect2:
	var k := D.css_scale(self)
	return Rect2(12.0 * k, 12.0 * k, 44.0 * k, 44.0 * k)

# ---------------------------------------------------------------- frame

func _process(delta: float) -> void:
	if not visible:
		return
	_time += delta
	if _dbg_desktop:
		touch.visible = false   # screenshot check of the keyboard / mouse HUD (the autotest forces touch on)
	if _dbg_test >= 0.0:
		_hud_test(delta)
	if me == null and net:
		me = fighters.get(net.id)
		_plates.me = me
	# the web hides the in-match HUD under #result: no plates or counters through the result card
	_plates.visible = not result_open
	_front.visible = not result_open
	playing = me != null and me.alive and arena != null
	_emote_cd = maxf(_emote_cd - delta, 0.0)
	_ping_cd = maxf(_ping_cd - delta, 0.0)
	gad_cd = maxf(gad_cd - delta, 0.0)
	_hurt_age += delta
	_gad_bump += delta
	for r in _feed:
		r.age += delta
	_feed = _feed.filter(func(r): return r.age < FEED_LIFE + 0.5)
	for p in _pings:
		p.t -= delta
		p.age += delta
	_pings = _pings.filter(func(p): return p.t > 0.0)
	if not _banner.is_empty():
		_banner.age += delta
		if _banner.age > 2.2:
			_banner = {}
	if not _cutin.is_empty():
		_cutin.age += delta
		if _cutin.age > 0.8:
			_cutin = {}
	if playing:
		_local_effects(delta)
	if me:
		var f := clampf(me.hp / maxf(me.max_hp, 1.0), 0.0, 1.0)
		_mh_lag = maxf(f, _mh_lag - delta * 0.6)
	_mh_alpha = move_toward(_mh_alpha, 1.0 if playing else 0.0, delta / 0.3)
	touch.buttons_on = playing
	touch.super_frac = clampf(me.super_charge / maxf(float(me.type.superCost), 1.0), 0.0, 1.0) if me else 0.0
	touch.gadget_cd = gad_cd / GADGET_LOCKOUT
	touch.gadget_charges = gad_charges
	touch.gadget_ready = gad_cd <= 0.0
	_update_screen(delta)
	_front.queue_redraw()

# --hudtest: local, cosmetic-only events so a screenshot shows the kill feed, numbers, stamp, emote,
# banner and a spent gadget (nothing is sent to the server).
func _hud_test(delta: float) -> void:
	var t0 := _dbg_test
	_dbg_test += delta
	var others: Array = fighters.values().filter(func(f): return f != me)
	if me == null or others.size() < 3:
		return
	var a: Fighter = others[0]
	var b: Fighter = others[1]
	var c: Fighter = others[2]
	if _dbg_test < 6.0:
		return
	var tick := func(period: float, phase := 0.0) -> bool:
		return fmod(t0 - phase + 100.0, period) > fmod(_dbg_test - phase + 100.0, period)
	if tick.call(2.0):
		var keep := alive_n
		on_event({"e": "kill", "id": c.id, "by": a.id, "rank": 8})
		on_event({"e": "kill", "id": b.id, "by": "", "rank": 7})
		on_event({"e": "kill", "id": a.id, "by": me.id, "rank": 6, "sup": 1})
		alive_n = keep
		_show_banner(I18n.t("hud.threeLeft"), "three")
		on_event({"e": "emo", "id": me.id, "i": 3})
		on_event({"e": "emo", "id": a.id, "i": 0})
		_add_ping(me.position + Vector3(-4, 0, -2), "attack")
		gad_charges = 2
		gad_cd = 3.0
	if tick.call(1.0, 0.5):
		_plates.ko_stamp(me.position + Vector3(3, 1.6, 2))
	if tick.call(0.6, 0.2):
		on_event({"e": "miss", "id": me.id})
		on_event({"e": "imm", "id": a.id})
	# a K.O. in progress: the fighter falls for ~1.25 s (fighter.gd die_fx) but its plate is gone at once
	if tick.call(2.0, 1.9):
		b.alive = true
	if tick.call(2.0):
		b.alive = false
		if b.has_method("die_fx"):
			b.call("die_fx", me.position, false, true)
	if tick.call(2.0, 0.3):
		print("HUDTEST dying fighter: visible=%s alive=%s plate_drawn=%s" % [b.visible, b.alive, b.visible and b.alive])
	if tick.call(0.7):
		_plates.floater(me.position + Vector3(2.5, 2.6, 0), 320, "dmg-out", "")
		_plates.floater(me.position + Vector3(0, 2.6, 0), 450, "dmg-in", "")
		_plates.floater(me.position + Vector3(-3, 2.6, 0), 210, "dmg-other", "")
		_hurt_v = 0.8
		_hurt_age = 0.1

func _local_effects(delta: float) -> void:
	# the dash of a mobility gadget: applied on top of main.gd's walking, with the same tile collision
	if _dash_t > 0.0:
		var dt := minf(delta, _dash_t)
		_dash_t -= delta
		var p := me.position + Vector3(_dash_v.x, 0, _dash_v.y) * dt
		me.position = arena.collide_circle(p, me.radius)
	var bush := arena.is_bush(me.position.x, me.position.z)
	me.set_faded(bush)
	_bush_v += ((1.0 if bush else 0.0) - _bush_v) * (1.0 - exp(-10.0 * delta))   # brawler.js hideK
	in_gas = gas != null and gas.in_gas(me.position.x, me.position.z)

func _update_screen(delta: float) -> void:
	var k := D.css_scale(self)
	_screen_mat.set_shader_parameter("vs", size)
	_screen_mat.set_shader_parameter("k", k)
	# #hurt: a blink that fades in 0.35 s (ease-out)
	var hurt := _hurt_v * (1.0 - D.ease_out(_hurt_age / 0.35)) if _hurt_age < 0.35 else 0.0
	# #lowhp under 30 %: lowBeat (0.85 s, 0.6 s under 15 %)
	var hp_frac := clampf(me.hp / maxf(me.max_hp, 1.0), 0.0, 1.0) if me and me.alive else 1.0
	var low_want := 1.0 if playing and hp_frac < 0.3 else 0.0
	_low_on = move_toward(_low_on, low_want, delta / 0.4)
	var period := 0.6 if hp_frac < 0.15 else 0.85
	var ph := fmod(_time, period) / period
	var beat := _keys(ph, [[0.0, 0.55], [0.12, 1.0], [0.3, 0.7], [0.42, 0.95], [1.0, 0.55]])
	# #vignette in the gas, #bushEdge while hidden
	_poison_v = move_toward(_poison_v, 1.0 if in_gas and playing else 0.0, delta / 0.3)
	_screen_mat.set_shader_parameter("hurt", hurt)
	_screen_mat.set_shader_parameter("low", _low_on * beat)
	_screen_mat.set_shader_parameter("poison", _poison_v)
	_screen_mat.set_shader_parameter("bush", _bush_v if playing and _bush_v > 0.02 else 0.0)
	if vision > 0.0 and me and cam:
		var vs := get_viewport_rect().size
		var c := cam.unproject_position(me.position + Vector3(0, 1.0, 0))
		var rx := absf(cam.unproject_position(me.position + Vector3(vision, 1.0, 0)).x - c.x)
		var rz := absf(cam.unproject_position(me.position + Vector3(0, 1.0, vision)).y - c.y)
		_screen_mat.set_shader_parameter("fog_c", c / vs)
		_screen_mat.set_shader_parameter("fog_r", Vector2(rx / vs.x, rz / vs.y))
		# visionfog.js: the scene fog colour; at night (near-black) a faint moonlit grey-green.
		# The web mixes it in linear HDR before its grade and tone mapping: redo those for this overlay.
		var w3 := cam.get_world_3d()
		if w3 and w3.environment:
			var fc := w3.environment.fog_light_color.srgb_to_linear()
			if fc.r + fc.g + fc.b < 0.35:
				fc = fc.lerp(MOON_MIST, 0.55)
			fc = Sight.to_display(fc, w3.environment)   # as the web's linear HDR pass would show it
			_screen_mat.set_shader_parameter("fog_col", Vector3(fc.r, fc.g, fc.b))

# piecewise keyframes [[t, v]...], ease-out between keys
static func _keys(t: float, keys: Array) -> float:
	for i in keys.size() - 1:
		if t <= keys[i + 1][0]:
			var u := D.ease_out((t - keys[i][0]) / maxf(keys[i + 1][0] - keys[i][0], 1e-4))
			return lerpf(keys[i][1], keys[i + 1][1], u)
	return keys[keys.size() - 1][1]

func _face(key: String) -> Texture2D:
	if key == "":
		return null
	if not _faces.has(key):
		var p := "res://assets/ui/%s.png" % key
		_faces[key] = load(p) if ResourceLoader.exists(p) else null
	return _faces[key]

# ---------------------------------------------------------------- drawing (_front)

func _draw_front() -> void:
	if arena == null:
		return
	var c := _front
	var k := D.css_scale(self)
	var vs := size
	var touch_mode := touch != null and touch.visible and not _dbg_desktop
	var short := D.short_screen(self)
	_draw_cutin(c, k, vs)
	_draw_pings(c, k, vs)
	_draw_top(c, k, vs, touch_mode)
	_draw_feed(c, k, vs, touch_mode, short)
	_draw_banner(c, k, vs, short)
	if me:
		_draw_cubes(c, k, vs)
		_draw_myhp(c, k, vs, touch_mode, short)
		if not touch_mode:
			_draw_super(c, k, vs)
			_draw_gadget(c, k, vs)
	_draw_sound(c, k)

# #top: "8 BRAWLERS LEFT" and the gas clock pills
func _draw_top(c: Control, k: float, vs: Vector2, touch_mode: bool) -> void:
	var disp := Fonts.display()
	var pills: Array = []   # [[small, big, big colour, warn, small first]]
	pills.append([I18n.t("hud.left"), str(alive_n), D.TEXT, false, false])
	if gas and gas.enabled and gas.next_in() < 1e8:
		var n := gas.next_in()
		var txt := ""
		if gas.level >= gas.max_level or n > 1e5:
			txt = I18n.t("hud.max")
		else:
			var s := ceili(maxf(n, 0.0))
			txt = "%d:%02d" % [floori(maxf(n, 0.0) / 60.0), s % 60]
		pills.append([I18n.t("hud.gasIn") if gas.level == 0 else I18n.t("hud.gasGrows"), txt, D.GREEN, n < 6.0 and n > 0.0, true])
	var big := 24.0 * k
	var sm := 12.0 * k
	var asc := maxf(disp.get_ascent(int(round(big))), disp.get_ascent(int(round(sm))))
	var lh := D.line_h(disp, big)
	var h := lh + 12.0 * k + 4.0 * k
	var widths: Array = []
	var total := 0.0
	for p in pills:
		var w := D.width(disp, p[0], sm) + 8.0 * k + D.width(disp, p[1], big) + 28.0 * k + 4.0 * k
		widths.append(w)
		total += w
	total += 10.0 * k * (pills.size() - 1)
	var x := vs.x * 0.5 - total * 0.5
	var y := (10.0 if touch_mode else 14.0) * k
	for i in pills.size():
		var p: Array = pills[i]
		var w: float = widths[i]
		var bg := D.PANEL
		if p[3]:   # warn: background pulses to green (0.6 s alternate)
			var u := 0.5 - 0.5 * cos(_time * PI / 0.6)
			bg = D.PANEL.lerp(Color(40 / 255.0, 120 / 255.0, 50 / 255.0, 0.85), u)
		D.box(c, Rect2(x, y, w, h), 12.0 * k, bg, 2.0 * k, D.INK, 3.0 * k, Color(0, 0, 0, 0.4))
		var base := y + 2.0 * k + 6.0 * k + asc
		var tx := x + 2.0 * k + 14.0 * k
		var parts := [[p[0], sm, D.MUTED], [p[1], big, p[2]]] if p[4] else [[p[1], big, p[2]], [p[0], sm, D.MUTED]]
		for q in parts:
			var fs := int(round(q[1]))
			c.draw_string(disp, Vector2(tx, base), q[0], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, q[2])
			tx += D.width(disp, q[0], q[1]) + 8.0 * k
		x += w + 10.0 * k

# #cubes: the green power cube and your count (bottom left)
func _draw_cubes(c: Control, k: float, vs: Vector2) -> void:
	var disp := Fonts.display()
	var fs := 26.0 * k
	var lh := D.line_h(disp, fs)
	var top := vs.y - 58.0 * k - lh
	var cc := Vector2(18.0 * k + 11.0 * k, top + lh * 0.5)
	D.glow(c, cc, 13.0 * k, 14.0 * k, Color(75 / 255.0, 1.0, 134 / 255.0, 0.6))
	c.draw_set_transform(cc, PI / 4, Vector2.ONE)
	var r := Rect2(-11.0 * k, -11.0 * k, 22.0 * k, 22.0 * k)
	D.box(c, r, 4.0 * k, D.INK)
	D.grad_fill(c, r.grow(-2.0 * k), 2.0 * k, Color("8bffb0"), Color("1fc45a"))
	c.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	D.text(c, Vector2(18.0 * k + 22.0 * k + 8.0 * k, top), str(me.cubes), disp, fs, Color.WHITE, 3.0 * k)

# #myhp: the big health bar with its number, the 3 ammo bars under it (bottom centre)
func _draw_myhp(c: Control, k: float, vs: Vector2, touch_mode: bool, short: bool) -> void:
	if _mh_alpha <= 0.01:
		return
	var a := _mh_alpha
	var css_w := vs.x / k
	var w := minf(420.0, css_w * 0.42)
	var bottom := 16.0
	if touch_mode:
		w = minf(230.0, css_w * 0.30) if short else minf(300.0, css_w * 0.34)
		bottom = 10.0
	w *= k
	var bh := 26.0 * k
	var ah := 9.0 * k
	var y1 := vs.y - bottom * k
	var y0 := y1 - ah - 5.0 * k - bh
	var x0 := vs.x * 0.5 - w * 0.5
	var bar := Rect2(x0, y0, w, bh)
	D.box(c, bar, 13.0 * k, Color(12 / 255.0, 9 / 255.0, 24 / 255.0, 0.75 * a), 3.0 * k, _ink(a), 4.0 * k, Color(0, 0, 0, 0.35 * a))
	var inner := bar.grow(-3.0 * k)
	var f := clampf(me.hp / maxf(me.max_hp, 1.0), 0.0, 1.0)
	D.flat_fill(c, inner, 10.0 * k, Color(1.0, 243 / 255.0, 196 / 255.0, 0.8 * a), inner.size.x * _mh_lag)
	var top := Color("7dffa8")
	var bot := Color("1fc45a")
	var mul := 1.0
	if f < 0.3:
		top = Color("ff8a7a"); bot = Color("e0342e")
		mul = 1.0 + 0.35 * (0.5 - 0.5 * cos(_time * TAU / 0.85))   # mhPulse
	elif f < 0.6:
		top = Color("ffe36b"); bot = Color("f0a800")
	D.grad_fill(c, inner, 10.0 * k, _al(top, a), _al(bot, a), inner.size.x * f, mul)
	D.text_c(c, bar.get_center(), str(ceili(maxf(me.hp, 0.0))), Fonts.display(), 18.0 * k, Color(1, 1, 1, a), 3.0 * k, _ink(a))
	# ammo
	var cw := 64.0 * k
	var gap := 5.0 * k
	var ax := vs.x * 0.5 - (cw * 3.0 + gap * 2.0) * 0.5
	for i in 3:
		var r := Rect2(ax + i * (cw + gap), y1 - ah, cw, ah)
		D.box(c, r, 5.0 * k, Color(12 / 255.0, 9 / 255.0, 24 / 255.0, 0.75 * a), 2.0 * k, _ink(a))
		var ir := r.grow(-2.0 * k)
		D.grad_fill(c, ir, 3.0 * k, _al(Color("ffd98a"), a), _al(Color("ff9f1c"), a), ir.size.x * clampf(me.ammo - i, 0.0, 1.0))

# #super (desktop): the ring that fills with your super charge, "RMB · SPACE" under it
func _draw_super(c: Control, k: float, vs: Vector2) -> void:
	var sf := clampf(me.super_charge / maxf(float(me.type.superCost), 1.0), 0.0, 1.0)
	var ready := sf >= 1.0 and playing
	var ctr := Vector2(vs.x - 30.0 * k - 54.0 * k, vs.y - 30.0 * k - 54.0 * k)
	var s := 1.0
	if ready:   # `ready` 0.8 s ease-in-out alternate: scale 1.07 + a yellow glow
		var u := 0.5 - 0.5 * cos(_time * PI / 0.8)
		s = 1.0 + 0.07 * u
		D.glow(c, ctr, 52.0 * k, 16.0 * k * u + 2.0, Color(1.0, 210 / 255.0, 63 / 255.0, 0.7 * u))
	c.draw_set_transform(ctr, 0.0, Vector2(s, s))
	var r := 44.0 * 1.08 * k
	var sw := 9.0 * 1.08 * k
	c.draw_circle(Vector2.ZERO, r, Color(1.0, 190 / 255.0, 40 / 255.0, 0.28) if ready else Color(20 / 255.0, 16 / 255.0, 30 / 255.0, 0.6))
	c.draw_arc(Vector2.ZERO, r, 0, TAU, 64, Color(0, 0, 0, 0.45), sw, true)
	D.arc(c, Vector2.ZERO, r, sf, D.YELLOW, sw)
	D.text_c(c, Vector2.ZERO, I18n.t("hud.super"), Fonts.display(), 20.0 * k, D.YELLOW if ready else Color("9b93b8"), 3.0 * k)
	c.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	_small_hint(c, Vector2(ctr.x, vs.y - 30.0 * k + 18.0 * k), _super_hint(), k)

# The key hints under the super / gadget buttons: the bound keys ("RMB · SPACE", "E"), or the pad's.
func _super_hint() -> String:
	if Controls.using_pad:
		return "RB · LT"
	var k := Controls.action_label("super").to_upper()
	return I18n.t("hud.superKeys") if k == "SPACE" else "RMB · " + k

func _gadget_hint() -> String:
	return "LB" if Controls.using_pad else Controls.action_label("gadget")

# #gadget (desktop): icon, 3 charge pips, the lockout ring, its key ("E") under it
func _draw_gadget(c: Control, k: float, vs: Vector2) -> void:
	var ctr := Vector2(vs.x - 152.0 * k - 35.0 * k, vs.y - 30.0 * k - 35.0 * k)
	var cd := gad_cd / GADGET_LOCKOUT
	var ready := playing and gad_charges > 0 and cd <= 0.0
	var a := 1.0 if ready else (0.25 if gad_charges <= 0 else 0.55)
	var s := 1.0
	if _gad_bump < 0.35:   # gadgetPop: 1.25 at 40 %
		var t := _gad_bump / 0.35
		s = 1.0 + 0.25 * (t / 0.4 if t < 0.4 else (1.0 - t) / 0.6)
	c.draw_set_transform(ctr, 0.0, Vector2(s, s))
	var r := 44.0 * 0.7 * k
	var sw := 9.0 * 0.7 * k
	c.draw_circle(Vector2.ZERO, r, Color(20 / 255.0, 16 / 255.0, 30 / 255.0, 0.6 * a))
	c.draw_arc(Vector2.ZERO, r, 0, TAU, 48, Color(0, 0, 0, 0.45 * a), sw, true)
	D.arc(c, Vector2.ZERO, r, 1.0 - cd, _al(Color("7de3ff"), a), sw)
	var key := str(me.type.get("key", "")) + Settings.loadout_of(str(me.type.get("key", ""))).left(1)
	var icon: String = GADGET_ICONS.get(key, "")
	if icon != "" and D.has_emoji():
		var ef := D.emoji_font()
		D.text_c(c, Vector2(0, 2.0 * k), icon, ef, 28.0 * k, Color(0, 0, 0, 0.5 * a))
		D.text_c(c, Vector2.ZERO, icon, ef, 28.0 * k, Color(1, 1, 1, a))
	else:
		D.star4(c, Vector2(0, 2.0 * k), 13.0 * k, Color(0, 0, 0, 0.5 * a))
		D.star4(c, Vector2.ZERO, 13.0 * k, _al(Color("7de3ff"), a))
	# pips: 10 px dots, 4 px apart, 10 px above the ring
	var py := -35.0 * k - 10.0 * k + 5.0 * k
	for i in GADGET_CHARGES:
		var pc := Vector2((i - 1) * 14.0 * k, py)
		c.draw_circle(pc, 5.0 * k, _ink(a))
		c.draw_circle(pc, 3.0 * k, _al(Color("7de3ff"), a) if i < gad_charges else Color(20 / 255.0, 16 / 255.0, 30 / 255.0, 0.8 * a))
	c.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	_small_hint(c, Vector2(ctr.x, vs.y - 30.0 * k + 18.0 * k), _gadget_hint(), k, a)

# a key hint under a round button: Nunito 800 11px, muted, its bottom edge at `bottom_c.y`
func _small_hint(c: Control, bottom_c: Vector2, s: String, k: float, a := 1.0) -> void:
	var f := Fonts.body(800)
	var fs := 11.0 * k
	var w := D.width(f, s, fs)
	D.text(c, Vector2(bottom_c.x - w * 0.5, bottom_c.y - D.line_h(f, fs)), s, f, fs, _al(D.MUTED, a))

# #killfeed (top right): newest on top, 4 rows, 4.5 s each
func _draw_feed(c: Control, k: float, vs: Vector2, touch_mode: bool, short: bool) -> void:
	var f := Fonts.body(900)
	var fs := (11.0 if short else 13.0) * k
	var img := (20.0 if short else 26.0) * k
	var lh := D.line_h(f, fs)
	var rh := maxf(img, lh) + 6.0 * k + 4.0 * k
	var right := vs.x - (70.0 if touch_mode else 18.0) * k
	var y := (56.0 if touch_mode and short else (12.0 if touch_mode else 14.0)) * k
	for row in _feed:
		var age: float = row.age
		var op := 1.0
		var dx := 0.0
		var s := 1.0
		if age < 0.3:   # kfIn
			var u := D.back_out(age / 0.3)
			op = clampf(u, 0.0, 1.0)
			dx = 30.0 * k * (1.0 - u)
			s = 0.9 + 0.1 * u
		elif age > FEED_LIFE:   # .out
			var u2 := clampf((age - FEED_LIFE) / 0.5, 0.0, 1.0)
			op = 1.0 - u2
			dx = 20.0 * k * u2
		var gap := 6.0 * k
		var w := 6.0 * k + 10.0 * k + 4.0 * k
		var kw := D.width(f, row.killer, fs) if row.killer != "" else 0.0
		var vw := D.width(f, row.victim, fs)
		var icon := 14.0 * k
		w += (kw + gap if row.killer != "" else 0.0) + img + gap + icon + gap + img + gap + vw
		var r := Rect2(right - w + dx, y, w, rh)
		c.draw_set_transform(r.get_center(), 0.0, Vector2(s, s))
		var lr := Rect2(-r.size * 0.5, r.size)
		var bc := Color(1, 1, 1, 0.08)
		if row.kind == "mine":
			bc = Color(57 / 255.0, 198 / 255.0, 1.0, 0.7)
		elif row.kind == "me":
			bc = Color(1.0, 75 / 255.0, 75 / 255.0, 0.7)
		D.box(c, lr, 12.0 * k, Color(18 / 255.0, 14 / 255.0, 32 / 255.0, 0.72 * op), 2.0 * k, _al(bc, op))
		var x := lr.position.x + 2.0 * k + 6.0 * k
		var cy := 0.0
		if row.killer != "":
			D.text(c, Vector2(x, cy - lh * 0.5), row.killer, f, fs, _al(D.TEXT, op))
			x += kw + gap
			_feed_face(c, Rect2(x, cy - img * 0.5, img, img), row.kkey, k, op)
		else:   # the gas
			var gc := Vector2(x + img * 0.5, cy)
			D.glow(c, gc, 11.0 * k * img / (26.0 * k), 10.0 * k, Color(75 / 255.0, 1.0, 134 / 255.0, 0.6 * op))
			c.draw_circle(gc, 11.0 * k * img / (26.0 * k), _al(Color("1f8a3a"), op))
			c.draw_circle(gc, 6.0 * k * img / (26.0 * k), _al(Color("8bff9a"), op))
		x += img + gap
		if row.sup:
			D.star4(c, Vector2(x + icon * 0.5, cy), icon * 0.5, _al(D.YELLOW, op))
		else:
			D.cross(c, Vector2(x + icon * 0.5, cy), icon * 0.32, _al(D.YELLOW, op))
		x += icon + gap
		_feed_face(c, Rect2(x, cy - img * 0.5, img, img), row.vkey, k, op)
		x += img + gap
		D.text(c, Vector2(x, cy - lh * 0.5), row.victim, f, fs, _al(D.TEXT, op))
		c.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		y += rh + 6.0 * k

func _feed_face(c: Control, r: Rect2, key: String, k: float, op: float) -> void:
	D.flat_fill(c, r, 8.0 * k, Color(1, 1, 1, 0.08 * op))
	var tex := _face(key)
	if tex == null:
		return
	var ts := tex.get_size()
	var sc := minf(r.size.x / ts.x, r.size.y / ts.y)   # object-fit: contain; object-position: top
	var ds := ts * sc
	c.draw_texture_rect(tex, Rect2(r.position.x + (r.size.x - ds.x) * 0.5, r.position.y, ds.x, ds.y), false, Color(1, 1, 1, op))

# #banner: "3 LEFT" / "FINAL DUEL" (bannerIn 2.2 s)
func _draw_banner(c: Control, k: float, vs: Vector2, short: bool) -> void:
	if _banner.is_empty():
		return
	var duel: bool = _banner.kind == "duel"
	var fs := ((48.0 if duel else 40.0) if short else (76.0 if duel else 64.0)) * k
	var stroke := (4.0 if short else 6.0) * k
	var t: float = _banner.age / 2.2
	var op := 1.0
	var s := 1.0
	var dy := 0.0
	if t < 0.12:
		var u := D.back_out(t / 0.12)
		op = clampf(u, 0.0, 1.0); s = lerpf(2.0, 1.0, u)
	elif t < 0.8:
		s = lerpf(1.0, 1.03, D.ease_out((t - 0.12) / 0.68))
	else:
		var u2 := D.ease_out((t - 0.8) / 0.2)
		op = 1.0 - u2; s = lerpf(1.03, 0.96, u2); dy = -0.1 * u2
	var col := D.YELLOW if duel else Color.WHITE
	col.a = op
	var disp := Fonts.display()
	D.text_xf(c, Vector2(vs.x * 0.5, vs.y * 0.26 + dy * D.line_h(disp, fs)), _banner.text, disp, fs, col, stroke, s, 0.0, stroke)

# .cutin: your portrait slashes across the screen when you fire your super (0.8 s)
func _draw_cutin(c: Control, k: float, vs: Vector2) -> void:
	if _cutin.is_empty():
		return
	var t: float = _cutin.age / 0.8
	var fade := 1.0 if t < 0.8 else 1.0 - (t - 0.8) / 0.2
	var top := vs.y * 0.3
	# the bar: inset 35px 0 of a 150 px box, skewY(-6deg), scaleX 0 -> 1 by 30 % from the left
	var bx := clampf(D.ease_out(t / 0.3), 0.0, 1.0)
	var y0 := top + 35.0 * k
	var y1 := top + 115.0 * k
	var w := vs.x * bx
	var sk := tan(deg_to_rad(-6.0))
	var cx := vs.x * 0.5
	var stops := [[0.0, Color(1, 210 / 255.0, 63 / 255.0, 0.0)], [0.2, Color(1, 210 / 255.0, 63 / 255.0, 0.9)],
		[0.8, Color(1, 150 / 255.0, 30 / 255.0, 0.9)], [1.0, Color(1, 150 / 255.0, 30 / 255.0, 0.0)]]
	for i in 3:
		var xa: float = stops[i][0] * vs.x
		var xb: float = minf(stops[i + 1][0] * vs.x, w)
		if xb <= xa:
			break
		var ca: Color = stops[i][1]
		var cb: Color = (stops[i][1] as Color).lerp(stops[i + 1][1], (xb - xa) / maxf((stops[i + 1][0] - stops[i][0]) * vs.x, 1.0))
		ca.a *= fade; cb.a *= fade
		var pts := PackedVector2Array([Vector2(xa, y0 + (xa - cx) * sk), Vector2(xb, y0 + (xb - cx) * sk),
			Vector2(xb, y1 + (xb - cx) * sk), Vector2(xa, y1 + (xa - cx) * sk)])
		c.draw_polygon(pts, PackedColorArray([ca, cb, cb, ca]))
	# the portrait: 170 px tall, slides -20 % -> 42 % (30 %) -> 46 % (75 %) -> 110 % (fades)
	var tex: Texture2D = _cutin.tex
	var ih := 170.0 * k
	var iw := ih * tex.get_width() / maxf(tex.get_height(), 1.0)
	var lx := 0.0
	var ia := fade
	if t < 0.3:
		lx = lerpf(-0.2, 0.42, D.ease_out(t / 0.3))
	elif t < 0.75:
		lx = lerpf(0.42, 0.46, (t - 0.3) / 0.45)
	else:
		var u := D.ease_out((t - 0.75) / 0.25)
		lx = lerpf(0.46, 1.1, u)
		ia = 1.0 - u
	var ir := Rect2(lx * vs.x, top - 10.0 * k, iw, ih)
	c.draw_texture_rect(tex, Rect2(ir.position + Vector2(0, 6.0 * k), ir.size), false, Color(D.INK.r, D.INK.g, D.INK.b, ia))
	c.draw_texture_rect(tex, ir, false, Color(1, 1, 1, ia))

# #sound: the speaker button (top left)
func _draw_sound(c: Control, k: float) -> void:
	var r := _sound_rect()
	D.box(c, r, 12.0 * k, D.PANEL, 2.0 * k, D.INK, 3.0 * k, Color(0, 0, 0, 0.4))
	# the 24 px SVG icon, centred
	var o := r.get_center() - Vector2(12.0, 12.0) * k
	var P := func(x: float, y: float) -> Vector2: return o + Vector2(x, y) * k
	var spk := PackedVector2Array([P.call(4, 9), P.call(8, 9), P.call(13, 5), P.call(13, 19), P.call(8, 15), P.call(4, 15)])
	c.draw_colored_polygon(spk, D.TEXT)
	var loop := spk.duplicate()
	loop.append(spk[0])
	c.draw_polyline(loop, D.TEXT, 2.0 * k, true)
	if _muted():
		c.draw_line(P.call(16, 9), P.call(22, 15), D.RED, 2.0 * k, true)
		c.draw_line(P.call(22, 9), P.call(16, 15), D.RED, 2.0 * k, true)
	else:
		c.draw_arc(P.call(12.43, 12), 5.0 * k, deg_to_rad(-44.4), deg_to_rad(44.4), 12, D.TEXT, 2.0 * k, true)
		c.draw_arc(P.call(12.48, 12), 8.5 * k, deg_to_rad(-44.9), deg_to_rad(44.9), 16, D.TEXT, 2.0 * k, true)

# pings: the icon over the spot for 4 s, kept inside the screen edges (hud.js edge(), pad 40)
func _draw_pings(c: Control, k: float, vs: Vector2) -> void:
	for p in _pings:
		var wp: Vector3 = p.p + Vector3(0, 1.2, 0)
		var behind := cam.is_position_behind(wp)
		var s := cam.unproject_position(wp)
		if behind:
			s = vs - s
		var pad := 40.0 * k
		var off := behind or s.x < pad or s.x > vs.x - pad or s.y < pad or s.y > vs.y - pad
		s = Vector2(clampf(s.x, pad, vs.x - pad), clampf(s.y, pad, vs.y - pad))
		var op := minf(1.0, p.t / 0.5)
		var sc := 1.0
		if p.age < 0.35:
			sc = D.back_out(p.age / 0.35)
		var kind: String = p.kind
		var fs := (22.0 if off else 30.0) * k
		var icon: String = PING_ICONS.get(kind, "")
		if icon != "" and D.has_emoji():
			var ef := D.emoji_font()
			c.draw_set_transform(s, 0.0, Vector2(sc, sc))
			D.text_c(c, Vector2(0, 3.0 * k), icon, ef, fs, Color(D.INK.r, D.INK.g, D.INK.b, op))
			D.text_c(c, Vector2.ZERO, icon, ef, fs, Color(1, 1, 1, op))
			c.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		else:
			var col: Color = PING_COL.get(kind, Color.WHITE)
			col.a = op
			D.text_xf(c, s, str(PING_TEXT.get(kind, "GO")), Fonts.display(), fs * 0.6, col, 3.0 * k, sc)

func _ink(a: float) -> Color:
	return Color(D.INK.r, D.INK.g, D.INK.b, a)

func _al(c: Color, a: float) -> Color:
	return Color(c.r, c.g, c.b, c.a * a)
