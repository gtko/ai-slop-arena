extends PanelContainer
# A clickable box that sizes to its content, like an HTML <button> with markup inside: a hover style,
# a pointing-hand cursor, `pressed` on release inside. Its children never take the mouse.
# Feel (the web's CSS transitions): the box rises `lift` px under the mouse (.rt:hover, .pp-play:hover
# translateY(-2..-3px)) and sinks `sink` px while held (.big:active translateY(4px), its hard ink shadow
# shrinking by as much so its bottom stays put), both eased over `ease_s` (transition: transform 0.08s).
# A press plays the web's sfx('click') unless `silent`.

signal pressed
signal moved(dy: float)         # the hover / press offset changed (for drawn shadows that must stay put)

var normal: StyleBox
var hover: StyleBox
var lift := 0.0                 # px up on hover (negative of CSS translateY)
var sink := -1.0                # px down while pressed; -1 = auto (the hard shadow minus 2, else 1)
var ease_s := 0.08
var silent := false
var _in := false
var _down := false
var _dy := 0.0                  # current offset (px, + = down)
var _tw: Tween
var _base: Dictionary = {}      # child -> position given by the last sort

func _init(n: StyleBox, h: StyleBox = null) -> void:
	normal = n
	hover = h if h else n
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	add_theme_stylebox_override("panel", normal)
	mouse_entered.connect(func(): _in = true; _restyle(); _go())
	mouse_exited.connect(func(): _in = false; _down = false; _restyle(); _go())
	child_entered_tree.connect(_quiet)
	sort_children.connect(_on_sorted)

func set_styles(n: StyleBox, h: StyleBox = null) -> void:
	normal = n
	hover = h if h else n
	_restyle()

func _sink_px() -> float:
	if sink >= 0.0:
		return sink
	var s := normal as StyleBoxFlat
	if s and s.shadow_color.a > 0.0 and s.shadow_offset.y >= 3.0:
		return s.shadow_offset.y - 2.0
	return 1.0

# The style for the current state, moved down by _dy (and its hard shadow shortened by as much).
func _restyle() -> void:
	var base: StyleBox = hover if _in else normal
	if absf(_dy) < 0.01 or not (base is StyleBoxFlat):
		add_theme_stylebox_override("panel", base)
		return
	var s := (base as StyleBoxFlat).duplicate() as StyleBoxFlat
	s.expand_margin_top = (base as StyleBoxFlat).expand_margin_top - _dy
	s.expand_margin_bottom = (base as StyleBoxFlat).expand_margin_bottom + _dy
	if s.shadow_color.a > 0.0:
		s.shadow_offset.y = maxf((base as StyleBoxFlat).shadow_offset.y - _dy, 0.0)
	add_theme_stylebox_override("panel", s)

func _go() -> void:
	var to := (-lift if _in else 0.0) + (_sink_px() if _down else 0.0)
	if is_equal_approx(to, _dy):
		return
	if _tw:
		_tw.kill()
	_tw = create_tween()
	_tw.tween_method(_set_dy, _dy, to, ease_s).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)

func _set_dy(v: float) -> void:
	_dy = v
	_restyle()
	moved.emit(_dy)
	for c in get_children():
		if c is Control and _base.has(c):
			(c as Control).position = _base[c] + Vector2(0, _dy)

func _on_sorted() -> void:
	_base.clear()
	for c in get_children():
		if c is Control:
			_base[c] = (c as Control).position
			(c as Control).position += Vector2(0, _dy)

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
			_go()
			accept_event()
		elif _down:
			_down = false
			_go()
			accept_event()
			if Rect2(Vector2.ZERO, size).has_point(mb.position):
				if not silent:
					UiKit.click()
				pressed.emit()
