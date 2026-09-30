class_name TouchControls
extends Control
# Two floating sticks: left moves, right aims and fires while held (like src/touch.js), plus
# a big SUPER button (fills while charging, glows when ready), a gadget button (charges + cooldown
# sweep) and a small emote button. The Hud feeds the button state. Mouse is emulated as touch
# (project setting), so this also works on desktop.

signal super_pressed
signal gadget_pressed
signal emote_pressed

var super_frac := 0.0        # 0..1, 1 = charged
var gadget_cd := 0.0         # 0..1 fraction of the lockout still to wait
var gadget_charges := 3
var gadget_ready := true
var buttons_on := true       # false while the brawler is out

var move := Vector2.ZERO
var aim := Vector2.ZERO
var firing := false
var _touch_move := -1
var _touch_aim := -1
var _origin_move := Vector2.ZERO
var _origin_aim := Vector2.ZERO
var _cur_move := Vector2.ZERO
var _cur_aim := Vector2.ZERO
const RADIUS := 90.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	set_anchors_preset(Control.PRESET_FULL_RECT)

func _input(ev: InputEvent) -> void:
	if ev is InputEventScreenTouch:
		var pos: Vector2 = ev.position
		if ev.pressed:
			if buttons_on and pos.distance_to(_super_c()) <= 72.0:
				super_pressed.emit()
			elif buttons_on and pos.distance_to(_gadget_c()) <= 54.0:
				gadget_pressed.emit()
			elif pos.distance_to(_emote_c()) <= 38.0:
				emote_pressed.emit()
			elif pos.x < _vs().x * 0.5 and _touch_move == -1:
				_touch_move = ev.index; _origin_move = pos; _cur_move = pos
			elif pos.x >= _vs().x * 0.5 and _touch_aim == -1:
				_touch_aim = ev.index; _origin_aim = pos; _cur_aim = pos
		else:
			if ev.index == _touch_move:
				_touch_move = -1; move = Vector2.ZERO
			elif ev.index == _touch_aim:
				_touch_aim = -1; aim = Vector2.ZERO; firing = false
		queue_redraw()
	elif ev is InputEventScreenDrag:
		if ev.index == _touch_move:
			_cur_move = ev.position
			move = ((_cur_move - _origin_move) / RADIUS).limit_length(1.0)
		elif ev.index == _touch_aim:
			_cur_aim = ev.position
			aim = ((_cur_aim - _origin_aim) / RADIUS).limit_length(1.0)
			firing = aim.length() > 0.25
		queue_redraw()

func _draw() -> void:
	if _touch_move != -1:
		draw_arc(_origin_move, RADIUS, 0, TAU, 32, Color(1, 1, 1, 0.35), 3.0)
		draw_circle(_origin_move + (_cur_move - _origin_move).limit_length(RADIUS), 28, Color(1, 1, 1, 0.5))
	if _touch_aim != -1:
		draw_arc(_origin_aim, RADIUS, 0, TAU, 32, Color(1, 0.6, 0.3, 0.4), 3.0)
		draw_circle(_origin_aim + (_cur_aim - _origin_aim).limit_length(RADIUS), 28, Color(1, 0.6, 0.3, 0.6))
	if not buttons_on:
		return
	var font := ThemeDB.fallback_font
	# SUPER
	var c := _super_c()
	var ready := super_frac >= 1.0
	draw_circle(c, 66.0, Color(0, 0, 0, 0.35))
	draw_arc(c, 60.0, -PI / 2, -PI / 2 + TAU * clampf(super_frac, 0.0, 1.0), 40, Color(1.0, 0.85, 0.2, 0.95 if ready else 0.7), 10.0, true)
	if ready:
		var p := 0.5 + 0.5 * sin(Time.get_ticks_msec() * 0.008)
		draw_circle(c, 52.0, Color(1.0, 0.8, 0.15, 0.55 + 0.3 * p))
		draw_arc(c, 68.0 + 4.0 * p, 0, TAU, 40, Color(1, 0.95, 0.5, 0.6), 3.0)
	else:
		draw_circle(c, 52.0, Color(0.35, 0.3, 0.1, 0.55))
	draw_string(font, c + Vector2(-46, 9), "SUPER", HORIZONTAL_ALIGNMENT_CENTER, 92, 24, Color.WHITE if ready else Color(1, 1, 1, 0.6))
	# gadget
	var g := _gadget_c()
	var ok := gadget_ready and gadget_charges > 0
	draw_circle(g, 50.0, Color(0, 0, 0, 0.35))
	draw_circle(g, 42.0, Color(0.25, 0.75, 1.0, 0.65) if ok else Color(0.2, 0.25, 0.3, 0.6))
	if gadget_cd > 0.0:
		draw_arc(g, 46.0, -PI / 2, -PI / 2 + TAU * (1.0 - gadget_cd), 32, Color(0.7, 0.9, 1.0, 0.9), 6.0, true)
	draw_string(font, g + Vector2(-40, 8), "GADGET" if gadget_charges > 0 else "EMPTY", HORIZONTAL_ALIGNMENT_CENTER, 80, 17, Color.WHITE if ok else Color(1, 1, 1, 0.5))
	for k in 3:
		draw_circle(g + Vector2(-14 + 14 * k, 30), 4.5, Color(1, 1, 1, 0.95) if k < gadget_charges else Color(1, 1, 1, 0.25))
	# emote
	var e := _emote_c()
	draw_circle(e, 34.0, Color(0, 0, 0, 0.35))
	draw_string(font, e + Vector2(-30, 8), "EMOTE", HORIZONTAL_ALIGNMENT_CENTER, 60, 15, Color(1, 1, 1, 0.85))

# The control can report a zero size when it is laid out under a CanvasLayer (seen on web), so the
# layout always comes from the viewport. Buttons sit in the bottom-right corner on any landscape phone.
func _vs() -> Vector2: return get_viewport_rect().size
func _super_c() -> Vector2: return Vector2(_vs().x - 110.0, _vs().y - 120.0)
func _gadget_c() -> Vector2: return Vector2(_vs().x - 250.0, _vs().y - 70.0)
func _emote_c() -> Vector2: return Vector2(_vs().x - 50.0, maxf(_vs().y - 290.0, 50.0))

func _process(_delta: float) -> void:
	# the charge state changes over time (glow pulse, cooldown sweep): redraw only while visible
	if visible:
		queue_redraw()
