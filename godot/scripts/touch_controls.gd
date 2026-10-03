class_name TouchControls
extends Control
# Touch controls with the look and layout of src/touch.js (+ #touch rules in style.css / meta.css):
#   left half      floating move stick, appears where the thumb lands
#   attack button  bottom right: drag to aim, release fires (a quick tap fires straight ahead)
#   super button   above it: lights up when charged, drag to aim, release fires
#   gadget button  left of the attack button, 3 charge pips
#   pause (top right) and the emote button under it; in Duo the ping button under that (.t-ping)
# A touch on the right half outside the buttons still works as a floating aim stick that fires
# while held (the older Godot control, kept for the real-input test). The Hud feeds the button
# state. Sizes are CSS px times HudDraw.css_scale(), so they match the web page on the same screen.

signal super_pressed
signal gadget_pressed
signal emote_pressed
signal pause_pressed
signal ping_pressed

const D := preload("res://scripts/hud_draw.gd")
const R := 58.0          # stick radius, CSS px (touch.js)
const DRAG := 0.22
const TAP_MS := 660

var super_frac := 0.0        # 0..1, 1 = charged
var gadget_cd := 0.0         # 0..1 fraction of the lockout still to wait
var gadget_charges := 3
var gadget_ready := true
var buttons_on := true       # false while the brawler is out
var ping_on := false         # Duo: the ping button shows (body.duo #touch .t-ping)

var move := Vector2.ZERO
var aim := Vector2.ZERO
var firing := false
var auto_aim := false        # touch.js autoAim: a quick tap aims at the nearest enemy (main.gd _control)
var _touch_move := -1
var _touch_aim := -1
var _aim_mode := ""          # "attack" | "super" | "free" (right-half floating stick)
var _aim_dragged := false
var _aim_t0 := 0
var _fire_until := 0
var _origin_move := Vector2.ZERO
var _origin_aim := Vector2.ZERO
var _cur_move := Vector2.ZERO
var _cur_aim := Vector2.ZERO
var _time := 0.0
var _dbg_hide := false     # --desktophud: screenshot of the keyboard / mouse HUD

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_dbg_hide = DebugArgs.has("desktophud")

func _k() -> float:
	return D.css_scale(self)

# The control can report a zero size when it is laid out under a CanvasLayer (seen on web), so the
# layout always comes from the viewport.
func _vs() -> Vector2: return get_viewport_rect().size
func _attack_c() -> Vector2: return _vs() - Vector2(34.0 + 59.0, 34.0 + 59.0) * _k()
func _super_c() -> Vector2: return _vs() - Vector2(168.0 + 43.0, 118.0 + 43.0) * _k()
func _gadget_c() -> Vector2: return _vs() - Vector2(172.0 + 32.0, 26.0 + 32.0) * _k()
func _pause_r() -> Rect2:
	var k := _k()
	return Rect2(_vs().x - (12.0 + 46.0) * k, 12.0 * k, 46.0 * k, 46.0 * k)
func _emote_c() -> Vector2:
	var k := _k()
	return Vector2(_vs().x - (12.0 + 23.0) * k, (70.0 + 23.0) * k)
func _ping_c() -> Vector2:   # meta.css #touch .t-ping: right 12, top 124, 46 px
	var k := _k()
	return Vector2(_vs().x - (12.0 + 23.0) * k, (124.0 + 23.0) * k)

func _input(ev: InputEvent) -> void:
	if not visible:
		return
	var k := _k()
	if ev is InputEventScreenTouch:
		var pos: Vector2 = ev.position
		if ev.pressed:
			if Rect2(Vector2.ZERO, Vector2(60.0, 60.0) * k).has_point(pos):
				pass   # the HUD's sound button (hud.gd) takes this tap
			elif _pause_r().grow(4.0 * k).has_point(pos):
				pause_pressed.emit()
			elif pos.distance_to(_emote_c()) <= 27.0 * k:
				emote_pressed.emit()
			elif ping_on and buttons_on and pos.distance_to(_ping_c()) <= 27.0 * k:
				ping_pressed.emit()
			elif buttons_on and pos.distance_to(_gadget_c()) <= 36.0 * k:
				gadget_pressed.emit()
			elif buttons_on and _touch_aim == -1 and pos.distance_to(_super_c()) <= 47.0 * k:
				if super_frac >= 1.0:
					_start_aim(ev.index, _super_c(), pos, "super")
			elif buttons_on and _touch_aim == -1 and pos.distance_to(_attack_c()) <= 64.0 * k:
				_start_aim(ev.index, _attack_c(), pos, "attack")
			elif pos.x < _vs().x * 0.5 and _touch_move == -1:
				_touch_move = ev.index; _origin_move = pos; _cur_move = pos
			elif pos.x >= _vs().x * 0.5 and _touch_aim == -1:
				_start_aim(ev.index, pos, pos, "free")
		else:
			if ev.index == _touch_move:
				_touch_move = -1; move = Vector2.ZERO
			elif ev.index == _touch_aim:
				_end_aim(ev.canceled)
		queue_redraw()
	elif ev is InputEventScreenDrag:
		if ev.index == _touch_move:
			_cur_move = ev.position
			move = ((_cur_move - _origin_move) / (R * k)).limit_length(1.0)
		elif ev.index == _touch_aim:
			_cur_aim = ev.position
			var v := ((_cur_aim - _origin_aim) / (R * k)).limit_length(1.0)
			if v.length() > DRAG:
				_aim_dragged = true
			if _aim_mode == "free":
				aim = v
				firing = v.length() > 0.25
			elif _aim_dragged:
				aim = v
		queue_redraw()

func _start_aim(index: int, origin: Vector2, pos: Vector2, mode: String) -> void:
	_touch_aim = index
	_origin_aim = origin
	_cur_aim = pos
	_aim_mode = mode
	_aim_dragged = false
	_aim_t0 = Time.get_ticks_msec()

func _end_aim(cancel: bool) -> void:
	var tap := not _aim_dragged and Time.get_ticks_msec() - _aim_t0 < TAP_MS
	if not cancel and (_aim_dragged or tap):
		if not _aim_dragged and _aim_mode != "free":
			auto_aim = true
		if _aim_mode == "super":
			super_pressed.emit()
		elif _aim_mode == "attack":
			_fire_until = Time.get_ticks_msec() + 200   # a release is a short press (touch.js)
	_touch_aim = -1
	_aim_mode = ""
	if Time.get_ticks_msec() >= _fire_until:
		firing = false
	# keep the last aim for the release shot; main keeps its aim_dir once this drops under 0.25
	aim = Vector2.ZERO

func _process(delta: float) -> void:
	_time += delta
	if _fire_until > 0:
		if Time.get_ticks_msec() < _fire_until:
			firing = true
		else:
			_fire_until = 0
			if _aim_mode != "free":
				firing = false
	# the charge state changes over time (glow pulse, cooldown sweep): redraw while visible, and only
	# when something drawn changed (every redraw rebuilds the buttons' polygons)
	if visible:
		var sig := _sig()
		if sig != _last_sig:
			_last_sig = sig
			queue_redraw()

var _last_sig: Array = []

func _sig() -> Array:
	var sig: Array = [_k(), size, buttons_on, _dbg_hide, _touch_move, _touch_aim, _aim_mode, I18n.lang,
		roundi(super_frac * 200.0), roundi(gadget_cd * 120.0), gadget_charges, gadget_ready, ping_on]
	if _touch_move != -1:
		sig.append_array([_origin_move.round(), _cur_move.round()])
	if _touch_aim != -1:
		sig.append_array([_origin_aim.round(), _cur_aim.round()])
	if super_frac >= 1.0 and buttons_on:
		sig.append(_time)   # the ready glow pulses
	return sig

# ---------------------------------------------------------------- drawing

func _draw() -> void:
	if _dbg_hide:
		return
	var k := _k()
	# floating move stick (.t-stick)
	if _touch_move != -1:
		_stick(_origin_move, _cur_move, k)
	if _touch_aim != -1 and _aim_mode == "free":
		_stick(_origin_aim, _cur_aim, k)
	_pause(k)
	_emote(k)
	if not buttons_on:
		return
	if ping_on:
		_ping(k)
	_gadget(k)
	_super(k)
	_attack(k)

func _stick(o: Vector2, cur: Vector2, k: float) -> void:
	draw_circle(o, 62.0 * k, Color(1, 1, 1, 0.1))
	# a thin ink ring outside the white one: the white ring alone disappeared over snow and sand
	draw_arc(o, 62.0 * k + 1.0 * k, 0, TAU, 48, Color(D.INK.r, D.INK.g, D.INK.b, 0.35), 2.0 * k, true)
	draw_arc(o, 62.0 * k - 1.5 * k, 0, TAU, 48, Color(1, 1, 1, 0.35), 3.0 * k, true)
	var kp := o + (cur - o).limit_length(R * k)
	_knob(kp, 27.0 * k, Color(1, 1, 1, 0.85), k)

func _knob(c: Vector2, r: float, col: Color, k: float, a := 1.0) -> void:
	draw_circle(c + Vector2(0, 3.0 * k), r, Color(0, 0, 0, 0.35 * a))
	draw_circle(c, r, Color(col.r, col.g, col.b, col.a * a))

# the round button frame: shadow 0 5 0, 3 px ink border
func _btn_frame(c: Vector2, r: float, k: float, a: float) -> void:
	draw_circle(c + Vector2(0, 5.0 * k), r, Color(0, 0, 0, 0.45 * a))
	draw_circle(c, r, Color(D.INK.r, D.INK.g, D.INK.b, a))

func _knob_pos(c: Vector2, mode: String, k: float) -> Vector2:
	if _touch_aim != -1 and _aim_mode == mode:
		return c + (_cur_aim - _origin_aim).limit_length(R * k)
	return c

func _attack(k: float) -> void:
	var c := _attack_c()
	var held := _touch_aim != -1 and _aim_mode == "attack"
	var s := 1.08 if held else 1.0
	var r := 59.0 * k * s
	_btn_frame(c, r, k, 1.0)
	# radial-gradient(circle at 50% 35%, #ffe066, #ffb300 70%)
	var ir := r - 3.0 * k
	var f := c + Vector2(0, -0.15 * 2.0 * r)
	var reach := 0.7 * Vector2(0.5, 0.65).length() * 2.0 * r
	var c0 := Color("ffe066")
	var c1 := Color("ffb300")
	var n := 48
	# all the gradient's triangles go out as one triangle array (one draw instead of ~96 polygons)
	var tp := PackedVector2Array()
	var tc := PackedColorArray()
	var ti := PackedInt32Array()
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		var p0 := c + Vector2(cos(a0), sin(a0)) * ir
		var p1 := c + Vector2(cos(a1), sin(a1)) * ir
		var q0 := f + (p0 - f).limit_length(reach)
		var q1 := f + (p1 - f).limit_length(reach)
		var cq0 := c0.lerp(c1, f.distance_to(q0) / reach)
		var cq1 := c0.lerp(c1, f.distance_to(q1) / reach)
		var b0 := tp.size()
		tp.append_array(PackedVector2Array([f, q0, q1]))
		tc.append_array(PackedColorArray([c0, cq0, cq1]))
		ti.append_array(PackedInt32Array([b0, b0 + 1, b0 + 2]))
		# the outer band, where the gradient reached its end colour: none where the rim is within reach
		# (a zero-area quad: "triangulation failed" every frame on touch screens)
		var band := PackedVector2Array([q0])
		var band_c := PackedColorArray([cq0])
		for e in [[p0, c1], [p1, c1], [q1, cq1]]:
			if (e[0] as Vector2).distance_to(band[band.size() - 1]) > 0.5 and (e[0] as Vector2).distance_to(band[0]) > 0.5:
				band.append(e[0])
				band_c.append(e[1])
		if band.size() >= 3:   # convex (3 or 4 points): a fan
			var b1 := tp.size()
			tp.append_array(band)
			tc.append_array(band_c)
			for j in range(1, band.size() - 1):
				ti.append_array(PackedInt32Array([b1, b1 + j, b1 + j + 1]))
	RenderingServer.canvas_item_add_triangle_array(get_canvas_item(), ti, tp, tc)
	_knob(_knob_pos(c, "attack", k), 27.0 * k, Color(22 / 255.0, 18 / 255.0, 31 / 255.0, 0.55), k)

func _super(k: float) -> void:
	var c := _super_c()
	var ready := super_frac >= 1.0
	var held := _touch_aim != -1 and _aim_mode == "super"
	var a := 1.0 if ready else 0.6
	var gray := 0.0 if ready else 0.6
	var r := 43.0 * k * (1.08 if held else 1.0)
	if ready:   # superPulse 1.1 s: a yellow glow 26 px / spread 6 at 50 %
		var u := 0.5 - 0.5 * cos(_time * TAU / 1.1)
		D.glow(self, c, r + 6.0 * k * u, 26.0 * k * u + 1.0, Color(1.0, 210 / 255.0, 63 / 255.0, 0.7 * u))
	_btn_frame(c, r, k, a)
	var ir := r - 3.0 * k
	draw_circle(c, ir, _gray(Color(40 / 255.0, 32 / 255.0, 60 / 255.0, 0.85 * a), gray))
	if super_frac > 0.0:   # conic-gradient(#ffd23f charge*360deg, ...): a pie from 12 o'clock
		var pts := PackedVector2Array([c])
		var steps := maxi(2, int(48 * super_frac))
		for i in steps + 1:
			var ang := -PI / 2 + TAU * super_frac * i / steps
			pts.append(c + Vector2(cos(ang), sin(ang)) * ir)
		pts = D.clean_poly(pts)   # a sliver at a low charge: no triangulation error
		if pts.size() >= 3:
			draw_colored_polygon(pts, _gray(Color(1.0, 210 / 255.0, 63 / 255.0, a), gray))
	_knob(_knob_pos(c, "super", k), 20.0 * k, Color(22 / 255.0, 18 / 255.0, 31 / 255.0, 0.6), k, a)
	# the label, written inside the button (home.css `body.touch #touch .t-super b`: top 50 % + 12 px,
	# 9 px; style.css's 11 px under the button sat on the world and vanished over snow and sand): white,
	# letter-spacing 1, an ink stroke; all strokes first, then the fills (paint-order: stroke fill)
	var f := Fonts.body(900)
	var fs := 9.0 * k
	var txt := I18n.t("hud.super")
	var w := D.width(f, txt, fs) + (txt.length() - 1) * k
	var y := c.y + 12.0 * k
	var ink := Color(D.INK.r, D.INK.g, D.INK.b, a)
	for pass_ in 2:
		var x := c.x - w * 0.5
		for ch in txt:
			if pass_ == 0:
				x += D.text(self, Vector2(x, y), ch, f, fs, ink, 3.0 * k, ink) + 1.0 * k
			else:
				x += D.text(self, Vector2(x, y), ch, f, fs, Color(1, 1, 1, a)) + 1.0 * k

func _gadget(k: float) -> void:
	var c := _gadget_c()
	var off := not gadget_ready or gadget_charges <= 0
	var a := 0.4 if off else 1.0
	var gray := 1.0 if off else 0.0
	var r := 32.0 * k
	_btn_frame(c, r, k, a)
	draw_circle(c, r - 3.0 * k, _gray(Color(125 / 255.0, 227 / 255.0, 1.0, 0.35 * a), gray))
	if gadget_cd > 0.0:   # the lockout filling back up (the desktop ring's colour)
		D.arc(self, c, r - 6.0 * k, 1.0 - gadget_cd, Color(125 / 255.0, 227 / 255.0, 1.0, 0.9 * a), 4.0 * k)
	_knob(c, 15.0 * k, Color(22 / 255.0, 18 / 255.0, 31 / 255.0, 0.6), k, a)
	var py := c.y - r - 14.0 * k + 5.0 * k
	for i in 3:
		var pc := Vector2(c.x + (i - 1) * 14.0 * k, py)
		draw_circle(pc, 5.0 * k, Color(D.INK.r, D.INK.g, D.INK.b, a))
		draw_circle(pc, 3.0 * k, _gray(Color(125 / 255.0, 227 / 255.0, 1.0, a), gray) if i < gadget_charges else Color(20 / 255.0, 16 / 255.0, 30 / 255.0, 0.8 * a))

func _pause(k: float) -> void:
	var r := _pause_r()
	D.box(self, r, 14.0 * k, Color(40 / 255.0, 32 / 255.0, 60 / 255.0, 0.8), 3.0 * k, D.INK)
	var c := r.get_center()
	for sx in [-1.0, 1.0]:
		D.flat_fill(self, Rect2(c.x + sx * 6.5 * k - 3.0 * k, c.y - 9.0 * k, 6.0 * k, 18.0 * k), 2.0 * k, Color.WHITE)

func _emote(k: float) -> void:
	var c := _emote_c()
	draw_circle(c, 23.0 * k, D.INK)
	draw_circle(c, 20.0 * k, Color(1, 1, 1, 0.3))
	if D.has_emoji():
		D.text_c(self, c, "😀", D.emoji_font(), 24.0 * k, Color.WHITE)
	else:   # a drawn smiley without an emoji font
		draw_circle(c, 11.0 * k, Color("ffd23f"))
		draw_circle(c + Vector2(-4, -3) * k, 1.6 * k, D.INK)
		draw_circle(c + Vector2(4, -3) * k, 1.6 * k, D.INK)
		draw_arc(c + Vector2(0, 1) * k, 5.0 * k, 0.3, PI - 0.3, 10, D.INK, 1.6 * k, true)

# Duo ping (.t-ping): a 46 px green see-through disc, 3 px ink border, the pin.
func _ping(k: float) -> void:
	var c := _ping_c()
	draw_circle(c, 23.0 * k, D.INK)
	draw_circle(c, 20.0 * k, Color(47 / 255.0, 211 / 255.0, 107 / 255.0, 0.45))
	if D.has_emoji():
		D.text_c(self, c, "📍", D.emoji_font(), 22.0 * k, Color.WHITE)
	else:   # a drawn pin without an emoji font
		draw_circle(c + Vector2(0, -3) * k, 7.0 * k, D.RED)
		draw_colored_polygon(PackedVector2Array([c + Vector2(-5, -1) * k, c + Vector2(5, -1) * k, c + Vector2(0, 10) * k]), D.RED)
		draw_circle(c + Vector2(0, -3) * k, 2.5 * k, Color.WHITE)

static func _gray(c: Color, amount: float) -> Color:
	if amount <= 0.0:
		return c
	var l := 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
	return Color(lerpf(c.r, l, amount), lerpf(c.g, l, amount), lerpf(c.b, l, amount), c.a)
