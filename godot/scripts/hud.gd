class_name Hud
extends Control
# In-match HUD and combat feedback (parity with src/hud.js, poison.js, visionfog.js, emotewheel.js).
# Pure presentation: the server owns every rule. main.gd only forwards data to the API below:
#   setup(net, cam, world, touch)   once, when the UI is built
#   begin_match(start_msg, arena, fighters)   after the roster is created
#   set_local(fighter)              the local brawler (begin_match does it too, from net.id)
#   on_snapshot(msg) / on_event(e)  every "snap" / every entry of an "ev" list
#   fill_input(msg) -> msg          adds g/gx/gz/em/ei/pg... to the outgoing "in" message
#   show_result(rank, won)          the result screen (also triggered by kill/win events)
#   end_match()                     frees the match visuals (main calls it from _clear_match)
# Signals: play_again, menu_requested.
# Keys (same defaults as the web game): Space super (main.gd), E gadget, B emote wheel,
# G ping, Esc pause.

signal play_again
signal menu_requested

const GADGET_LOCKOUT := 5.0
const GADGET_CHARGES := 3
# mobility gadgets (A): [distance m, seconds]; the server widens its move check for them
const DASH := {"blasterA": [4.0, 0.25], "gunslingerA": [3.5, 0.22], "bomberA": [5.0, 0.5], "frostbiteA": [5.0, 0.35],
	"voltA": [5.0, 0.15], "kappaA": [5.0, 0.3], "pipchompA": [6.0, 0.3], "mochiA": [5.0, 0.4]}
const PING_TEXT := {"attack": "ATTACK", "loot": "LOOT", "danger": "DANGER", "go": "GO"}
const PING_COL := {"attack": Color("ff5a4a"), "loot": Color("ffd24a"), "danger": Color("ff9a2a"), "go": Color("52e0e8")}

const SCREEN_SHADER := """
shader_type canvas_item;
uniform float hurt = 0.0;
uniform float low = 0.0;
uniform float gas = 0.0;
uniform float fog_on = 0.0;
uniform vec2 fog_c = vec2(0.5);
uniform vec2 fog_r = vec2(0.3, 0.2);
uniform vec3 fog_col = vec3(0.6, 0.66, 0.72);
void fragment() {
	vec2 p = UV - 0.5;
	float vig = smoothstep(0.30, 0.78, length(p * vec2(1.0, 0.85)));
	vec3 col = vec3(0.0);
	float a = 0.0;
	float red = vig * (low * 0.65 + hurt * 0.55) + hurt * 0.10;
	col = vec3(0.85, 0.05, 0.05);
	a = red;
	float g = vig * gas * 0.55 + gas * 0.10;
	col = mix(col, vec3(0.15, 0.85, 0.3), clamp(g / max(g + a, 0.001), 0.0, 1.0) * step(a, g));
	a = max(a, g);
	if (fog_on > 0.5) {
		vec2 d = (UV - fog_c) / fog_r;
		float f = smoothstep(0.85, 1.25, length(d)) * 0.93;
		col = mix(col, fog_col, clamp(f / max(f + a, 0.001), 0.0, 1.0));
		a = max(a, f);
	}
	COLOR = vec4(col, clamp(a, 0.0, 1.0));
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
var last_pt := -1.0
var _gas_debug := false
var hurt := 0.0
var low_t := 0.0
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

# kill feed: 5 slots
var _feed_text: Array[String] = ["", "", "", "", ""]
var _feed_col: Array[Color] = [Color.WHITE, Color.WHITE, Color.WHITE, Color.WHITE, Color.WHITE]
var _feed_t := PackedFloat32Array([0, 0, 0, 0, 0])
var _feed_next := 0
# pings: 3 slots
var _pg_pos: Array[Vector3] = [Vector3.ZERO, Vector3.ZERO, Vector3.ZERO]
var _pg_kind: Array[String] = ["", "", ""]
var _pg_t := PackedFloat32Array([0, 0, 0])
var _pg_next := 0

var _screen: ColorRect
var _screen_mat: ShaderMaterial
var _pause_box: Control
var _result_box: Control
var _result_title: Label
var _result_sub: Label
var _result_left := -1.0
var _result_rank := 0
var _result_won := false
var _font: Font

func setup(net_: NetClient, cam_: Camera3D, world_: Node3D, touch_: TouchControls) -> void:
	net = net_
	cam = cam_
	world = world_
	touch = touch_
	_font = ThemeDB.fallback_font
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_screen = ColorRect.new()
	_screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_screen_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SCREEN_SHADER
	_screen_mat.shader = sh
	_screen.material = _screen_mat
	add_child(_screen)
	wheel = EmoteWheel.new()
	wheel.picked.connect(_on_emote_picked)
	add_child(wheel)
	touch.gadget_pressed.connect(use_gadget)
	touch.emote_pressed.connect(func(): if playing and me and me.alive: wheel.toggle())
	_build_pause()
	_build_result()
	visible = false

func _build_pause() -> void:
	_pause_box = ColorRect.new()
	(_pause_box as ColorRect).color = Color(0, 0, 0, 0.6)
	_pause_box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_pause_box.visible = false
	add_child(_pause_box)
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.custom_minimum_size = Vector2(320, 0)
	v.position = Vector2(-160, -110)
	v.add_theme_constant_override("separation", 12)
	_pause_box.add_child(v)
	var t := Label.new()
	t.text = "PAUSED"
	t.add_theme_font_size_override("font_size", 48)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	var note := Label.new()
	note.text = "The match keeps running online."
	note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(note)
	var r := Button.new()
	r.text = "Resume"
	r.custom_minimum_size.y = 56
	r.pressed.connect(func(): _pause_box.visible = false)
	v.add_child(r)
	var l := Button.new()
	l.text = "Leave match"
	l.custom_minimum_size.y = 56
	l.pressed.connect(func(): _pause_box.visible = false; menu_requested.emit())
	v.add_child(l)

func _build_result() -> void:
	_result_box = ColorRect.new()
	(_result_box as ColorRect).color = Color(0, 0, 0, 0.55)
	_result_box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_result_box.visible = false
	add_child(_result_box)
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.custom_minimum_size = Vector2(380, 0)
	v.position = Vector2(-190, -150)
	v.add_theme_constant_override("separation", 12)
	_result_box.add_child(v)
	_result_title = Label.new()
	_result_title.add_theme_font_size_override("font_size", 72)
	_result_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_result_title.add_theme_constant_override("outline_size", 12)
	_result_title.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	v.add_child(_result_title)
	_result_sub = Label.new()
	_result_sub.add_theme_font_size_override("font_size", 26)
	_result_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_result_sub)
	var again := Button.new()
	again.text = "Play again"
	again.custom_minimum_size.y = 60
	again.pressed.connect(func(): _result_box.visible = false; play_again.emit())
	v.add_child(again)
	var menu := Button.new()
	menu.text = "Menu"
	menu.custom_minimum_size.y = 60
	menu.pressed.connect(func(): _result_box.visible = false; menu_requested.emit())
	v.add_child(menu)

# ---------------------------------------------------------------- match lifecycle

func begin_match(start_msg: Dictionary, arena_: Arena, fighters_: Dictionary) -> void:
	end_match()
	arena = arena_
	fighters = fighters_
	alive_n = fighters.size()
	fx = Fx.new()
	world.add_child(fx)
	fx.setup(arena, fighters, net.id)
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
	_gas_debug = OS.get_cmdline_user_args().has("--gastest")   # screenshot check: pretend the gas clock is at 45 s
	if _gas_debug:
		gas.set_timer(45.0)
	vision = float(arena.map.get("vision", 0.0))
	if mut == "nightHunt":
		vision = vision * 0.8
	_screen_mat.set_shader_parameter("fog_on", 1.0 if vision > 0.0 else 0.0)
	me = fighters.get(net.id)
	gad_charges = GADGET_CHARGES
	gad_cd = 0.0
	hurt = 0.0
	_dash_t = 0.0
	last_pt = -1.0
	for k in 5:
		_feed_t[k] = 0.0
	for k in 3:
		_pg_t[k] = 0.0
	_result_box.visible = false
	_pause_box.visible = false
	_result_left = -1.0
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
	if wheel:
		wheel.close()
	if _result_box:
		_result_box.visible = false
	if _pause_box:
		_pause_box.visible = false

func set_local(f: Fighter) -> void:
	me = f

func show_result(rank: int, won: bool) -> void:
	_result_rank = rank
	_result_won = won
	_result_left = 0.0
	_result_title.text = "VICTORY!" if won else "#%d" % rank
	_result_title.add_theme_color_override("font_color", Color("ffd24a") if won else Color("ff8a6a"))
	_result_sub.text = "You are the last brawler standing" if won else "%s  |  %d brawlers left" % [_ordinal(rank), maxi(alive_n, 0)]
	_result_box.visible = true

static func _ordinal(n: int) -> String:
	var s := "th"
	if n % 100 < 11 or n % 100 > 13:
		match n % 10:
			1: s = "st"
			2: s = "nd"
			3: s = "rd"
	return "%d%s place" % [n, s]

# ---------------------------------------------------------------- data in

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
			if f == me and me:
				hurt = 1.0
		"kill":
			alive_n = maxi(alive_n - 1, 0)
			var victim: String = f.fname if f else "?"
			var by: Fighter = fighters.get(str(e.get("by", "")))
			var txt := ""
			var col := Color.WHITE
			if by and by != f:
				txt = "%s  >  %s" % [by.fname, victim]
				col = Color("ffd24a") if by == me else Color.WHITE
			elif bool(e.get("f", false)):
				txt = "%s fell" % victim
			else:
				txt = "%s was gassed" % victim
				col = Color("8be36a")
			if f == me:
				col = Color("ff6a5a")
			_feed_text[_feed_next] = txt
			_feed_col[_feed_next] = col
			_feed_t[_feed_next] = 6.0
			_feed_next = (_feed_next + 1) % 5
			if f == me and me:
				show_result_later(int(e.get("rank", 0)), false)
		"win":
			if f == me and me:
				show_result_later(1, true)
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
				f.show_emote(EmoteWheel.NAMES[i], EmoteWheel.COLORS[i])
		"ping":
			_add_ping(Vector3(float(e.get("x", 0)), 0, float(e.get("z", 0))), str(e.get("k", "go")))

func show_result_later(rank: int, won: bool) -> void:
	_result_rank = rank
	_result_won = won
	_result_left = 1.4      # a beat to see the last moments, like the web result delay

func _add_ping(p: Vector3, k: String) -> void:
	_pg_pos[_pg_next] = p
	_pg_kind[_pg_next] = k
	_pg_t[_pg_next] = 4.0
	_pg_next = (_pg_next + 1) % 3
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
	if Input.is_key_pressed(KEY_A): mv.x -= 1
	if Input.is_key_pressed(KEY_D): mv.x += 1
	if Input.is_key_pressed(KEY_W): mv.y -= 1
	if Input.is_key_pressed(KEY_S): mv.y += 1
	return mv

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

func send_ping() -> void:
	if not playing or me == null or not me.alive or _ping_cd > 0.0:
		return
	_ping_cd = 1.0
	var p := me.position + Vector3(sin(me.rotation.y), 0, cos(me.rotation.y)) * 8.0
	if not (touch and touch.visible):
		var mp := get_viewport().get_mouse_position()
		var from := cam.project_ray_origin(mp)
		var dir := cam.project_ray_normal(mp)
		if absf(dir.y) > 1e-4 and -from.y / dir.y > 0.0:
			p = from + dir * (-from.y / dir.y)
	ping_seq += 1
	ping_at = Vector2(p.x, p.z)
	_has_ping = true

func _unhandled_key_input(ev: InputEvent) -> void:
	if not (ev is InputEventKey) or not ev.pressed or ev.echo:
		return
	match (ev as InputEventKey).keycode:
		KEY_E:
			use_gadget()
		KEY_B:
			if playing and me and me.alive:
				wheel.toggle()
		KEY_G:
			send_ping()
		KEY_ESCAPE, KEY_P:
			if playing and not _result_box.visible:
				_pause_box.visible = not _pause_box.visible

# ---------------------------------------------------------------- frame

func _process(delta: float) -> void:
	if not visible:
		return
	if me == null and net:
		me = fighters.get(net.id)
	playing = me != null and me.alive and arena != null
	# result delay
	if _result_left > 0.0:
		_result_left -= delta
		if _result_left <= 0.0:
			show_result(_result_rank, _result_won)
	_emote_cd = maxf(_emote_cd - delta, 0.0)
	_ping_cd = maxf(_ping_cd - delta, 0.0)
	gad_cd = maxf(gad_cd - delta, 0.0)
	hurt = maxf(hurt - delta * 2.5, 0.0)
	for k in 5:
		if _feed_t[k] > 0.0:
			_feed_t[k] -= delta
	for k in 3:
		if _pg_t[k] > 0.0:
			_pg_t[k] -= delta
	if playing:
		_local_effects(delta)
	touch.buttons_on = playing
	touch.super_frac = clampf(me.super_charge / maxf(float(me.type.superCost), 1.0), 0.0, 1.0) if me else 0.0
	touch.gadget_cd = gad_cd / GADGET_LOCKOUT
	touch.gadget_charges = gad_charges
	touch.gadget_ready = gad_cd <= 0.0
	_update_screen(delta)
	queue_redraw()

func _local_effects(delta: float) -> void:
	# the dash of a mobility gadget: applied on top of main.gd's walking, with the same tile collision
	if _dash_t > 0.0:
		var dt := minf(delta, _dash_t)
		_dash_t -= delta
		var p := me.position + Vector3(_dash_v.x, 0, _dash_v.y) * dt
		me.position = arena.collide_circle(p, me.radius)
	me.set_faded(arena.is_bush(me.position.x, me.position.z))
	in_gas = gas != null and gas.in_gas(me.position.x, me.position.z)

func _update_screen(delta: float) -> void:
	var hp_frac := clampf(me.hp / maxf(me.max_hp, 1.0), 0.0, 1.0) if me and me.alive else 1.0
	low_t += delta * (9.0 if hp_frac < 0.15 else 5.0)
	var low := 0.0
	if hp_frac < 0.35:
		low = (0.35 - hp_frac) / 0.35 * (0.6 + 0.4 * sin(low_t))
	_screen_mat.set_shader_parameter("hurt", hurt)
	_screen_mat.set_shader_parameter("low", low)
	_screen_mat.set_shader_parameter("gas", (0.6 + 0.4 * sin(low_t * 0.6)) if in_gas and playing else 0.0)
	if vision > 0.0 and me and cam:
		var vs := get_viewport_rect().size
		var c := cam.unproject_position(me.position + Vector3(0, 1.0, 0))
		var rx := absf(cam.unproject_position(me.position + Vector3(vision, 1.0, 0)).x - c.x)
		var rz := absf(cam.unproject_position(me.position + Vector3(0, 1.0, vision)).y - c.y)
		_screen_mat.set_shader_parameter("fog_c", c / vs)
		_screen_mat.set_shader_parameter("fog_r", Vector2(rx / vs.x, rz / vs.y))

# ---------------------------------------------------------------- drawing

func _txt(pos: Vector2, s: String, size: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	draw_string_outline(_font, pos, s, align, width, size, maxi(size / 5, 3), Color(0, 0, 0, 0.85))
	draw_string(_font, pos, s, align, width, size, col)

func _draw() -> void:
	if arena == null:
		return
	var vs := size
	var touch_mode := touch != null and touch.visible
	# top: alive counter, gas clock
	var cx := vs.x * 0.5
	draw_rect(Rect2(cx - 78, 10, 156, 38), Color(0, 0, 0, 0.45), true)
	_txt(Vector2(cx - 78, 39), "%d ALIVE" % alive_n, 26, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, 156)
	if gas and gas.enabled:
		var soon := gas.next_in()
		var gt := ""
		var gc := Color("8be36a")
		if gas.level >= gas.max_level:
			gt = "GAS: FINAL RING"
			gc = Color("ff6a5a")
		elif soon < 1e5:
			gt = "GAS +%ds" % ceili(maxf(soon, 0.0)) if gas.level > 0 else "GAS in %ds" % ceili(maxf(soon, 0.0))
			if soon < 6.0:
				gc = Color("ffd24a") if fmod(Time.get_ticks_msec() / 250.0, 2.0) < 1.0 else Color("ff8a3c")
		_txt(Vector2(cx - 120, 76), gt, 20, gc, HORIZONTAL_ALIGNMENT_CENTER, 240)
	# top left: cubes + ping
	if me:
		_txt(Vector2(18, 34), "CUBES %d" % me.cubes, 24, Color("c48cff"))
		if net:
			_txt(Vector2(18, 60), "%d ms" % int(net.rtt_ms), 16, Color(1, 1, 1, 0.6))
	# kill feed, top right
	var y := 40.0
	for k in 5:
		var idx := (_feed_next + k) % 5
		if _feed_t[idx] > 0.0:
			var col := _feed_col[idx]
			col.a = clampf(_feed_t[idx], 0.0, 1.0)
			_txt(Vector2(vs.x - 340, y), _feed_text[idx], 20, col, HORIZONTAL_ALIGNMENT_RIGHT, 322)
			y += 26.0
	if me and me.alive:
		_draw_bars(vs, touch_mode)
	_draw_pings()
	if in_gas and playing:
		var a := 0.6 + 0.4 * sin(low_t)
		_txt(Vector2(cx - 200, vs.y * 0.28), "IN THE GAS! GET TO SAFETY", 32, Color(1, 0.35, 0.3, a), HORIZONTAL_ALIGNMENT_CENTER, 400)

func _draw_bars(vs: Vector2, touch_mode: bool) -> void:
	var w := 320.0
	var x := vs.x * 0.5 - w * 0.5
	var y := vs.y - 96.0
	# health
	var frac := clampf(me.hp / maxf(me.max_hp, 1.0), 0.0, 1.0)
	draw_rect(Rect2(x - 3, y - 3, w + 6, 32), Color(0, 0, 0, 0.55), true)
	var hc := Color("e94a3a").lerp(Color("5be05a"), frac)
	draw_rect(Rect2(x, y, w * frac, 26), hc, true)
	_txt(Vector2(x, y + 21), "%d / %d" % [int(me.hp), int(me.max_hp)], 20, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, w)
	# ammo pips
	var max_ammo := int(me.type.get("ammo", 3))
	for k in max_ammo:
		var px := x + 14.0 + k * 34.0
		var py := y + 50.0
		draw_circle(Vector2(px, py), 13.0, Color(0, 0, 0, 0.55))
		var fill := clampf(me.ammo - k, 0.0, 1.0)
		if fill >= 1.0:
			draw_circle(Vector2(px, py), 10.0, Color("ffb23c"))
		elif fill > 0.0:
			draw_arc(Vector2(px, py), 6.0, -PI / 2, -PI / 2 + TAU * fill, 20, Color("ffb23c", 0.8), 10.0, true)
	# super meter
	var sf := clampf(me.super_charge / maxf(float(me.type.superCost), 1.0), 0.0, 1.0)
	var sx := x + 14.0 + max_ammo * 34.0 + 6.0
	var sw := x + w - sx
	var ready := sf >= 1.0
	draw_rect(Rect2(sx, y + 40.0, sw, 20), Color(0, 0, 0, 0.55), true)
	var sc := Color("ffd24a") if ready else Color("b8801a")
	if ready:
		sc = sc.lerp(Color.WHITE, 0.3 + 0.3 * sin(Time.get_ticks_msec() * 0.01))
	draw_rect(Rect2(sx + 2, y + 42.0, (sw - 4) * sf, 16), sc, true)
	var label := "SUPER READY" if ready else "SUPER %d%%" % int(sf * 100.0)
	if ready and not touch_mode:
		label += "  [SPACE]"
	_txt(Vector2(sx, y + 57.0), label, 15, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, sw)
	# gadget (keyboard): a chip with charges and cooldown (touch draws its own button)
	if not touch_mode:
		var gx := x + w + 16.0
		var ok := gad_cd <= 0.0 and gad_charges > 0
		draw_rect(Rect2(gx, y, 104, 30), Color(0.2, 0.55, 0.8, 0.8) if ok else Color(0.2, 0.22, 0.26, 0.8), true)
		var gt := "[E] GADGET" if ok else ("%.1fs" % gad_cd if gad_charges > 0 else "EMPTY")
		_txt(Vector2(gx, y + 21), gt, 16, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, 104)
		for k in GADGET_CHARGES:
			draw_circle(Vector2(gx + 34 + k * 18, y + 44), 5.0, Color.WHITE if k < gad_charges else Color(1, 1, 1, 0.25))
		_txt(Vector2(gx, y + 76), "[B] emote  [G] ping", 13, Color(1, 1, 1, 0.55))

func _draw_pings() -> void:
	for k in 3:
		if _pg_t[k] <= 0.0:
			continue
		var p := _pg_pos[k] + Vector3(0, 1.2 + 0.2 * sin(Time.get_ticks_msec() * 0.008), 0)
		if cam.is_position_behind(p):
			continue
		var s := cam.unproject_position(p)
		var kind := _pg_kind[k]
		var col: Color = PING_COL.get(kind, Color.WHITE)
		col.a = clampf(_pg_t[k], 0.0, 1.0)
		draw_circle(s + Vector2(0, -26), 20.0, Color(0, 0, 0, 0.5 * col.a))
		_txt(s + Vector2(-50, -20), str(PING_TEXT.get(kind, "GO")), 16, col, HORIZONTAL_ALIGNMENT_CENTER, 100)
		draw_line(s + Vector2(0, -8), s, col, 3.0)
