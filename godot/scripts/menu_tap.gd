extends PanelContainer
# A clickable box that sizes to its content, like an HTML <button> with markup inside: a hover style,
# a pointing-hand cursor, `pressed` on release inside. Its children never take the mouse.

signal pressed

var normal: StyleBox
var hover: StyleBox
var _in := false
var _down := false

func _init(n: StyleBox, h: StyleBox = null) -> void:
	normal = n
	hover = h if h else n
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	add_theme_stylebox_override("panel", normal)
	mouse_entered.connect(func(): _in = true; add_theme_stylebox_override("panel", hover))
	mouse_exited.connect(func(): _in = false; _down = false; add_theme_stylebox_override("panel", normal))
	child_entered_tree.connect(_quiet)

func set_styles(n: StyleBox, h: StyleBox = null) -> void:
	normal = n
	hover = h if h else n
	add_theme_stylebox_override("panel", hover if _in else normal)

func _quiet(n: Node) -> void:
	if n is Control:
		(n as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
	for c in n.get_children():
		_quiet(c)
	if not n.child_entered_tree.is_connected(_quiet):
		n.child_entered_tree.connect(_quiet)

func _gui_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton and (ev as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		var mb := ev as InputEventMouseButton
		if mb.pressed:
			_down = true
			accept_event()
		elif _down:
			_down = false
			accept_event()
			if Rect2(Vector2.ZERO, size).has_point(mb.position):
				pressed.emit()
