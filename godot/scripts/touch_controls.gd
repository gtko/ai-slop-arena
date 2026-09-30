class_name TouchControls
extends Control
# Two floating sticks: left moves, right aims and fires while held (like src/touch.js), plus
# a SUPER button. Mouse is emulated as touch (project setting), so this also works on desktop.

signal super_pressed

var move := Vector2.ZERO
var aim := Vector2.ZERO
var firing := false
var _touch_move := -1
var _touch_aim := -1
var _origin_move := Vector2.ZERO
var _origin_aim := Vector2.ZERO
var _cur_move := Vector2.ZERO
var _cur_aim := Vector2.ZERO
var _super_rect := Rect2()
const RADIUS := 90.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	set_anchors_preset(Control.PRESET_FULL_RECT)

func _input(ev: InputEvent) -> void:
	if ev is InputEventScreenTouch:
		var pos: Vector2 = ev.position
		if ev.pressed:
			_super_rect = Rect2(size.x - 190, size.y - 330, 130, 130)
			if _super_rect.has_point(pos):
				super_pressed.emit()
			elif pos.x < size.x * 0.5 and _touch_move == -1:
				_touch_move = ev.index; _origin_move = pos; _cur_move = pos
			elif pos.x >= size.x * 0.5 and _touch_aim == -1:
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
	_super_rect = Rect2(size.x - 190, size.y - 330, 130, 130)
	draw_circle(_super_rect.get_center(), 60, Color(1, 0.85, 0.2, 0.35))
