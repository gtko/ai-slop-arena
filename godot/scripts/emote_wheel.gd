class_name EmoteWheel
extends Control
# Emote wheel like src/emotewheel.js (+ #emoteWheel in meta.css): the emotes on a circle over a dark
# disc, tap / click / number key to send. The server takes an index (0..11, em counter + ei in the
# input message). Icons are the web's emoji (OS colour-emoji font); without one (web export) the
# plain words below are drawn instead.

signal picked(index: int)

const D := preload("res://scripts/hud_draw.gd")
const ICONS: Array[String] = ["🤝", "👍", "👋", "😂", "😎", "😡", "😭", "😍", "😱", "😴", "🤡", "💀"]   # cosmetics.js EMOTE_ICONS
const NAMES: Array[String] = ["GG", "OK!", "HI", "LOL", "COOL", "GRR", "CRY", "LOVE", "WOW", "ZZZ", "CLOWN", "RIP"]
const COLORS: Array[Color] = [Color("5aa9ff"), Color("ffd24a"), Color("8be36a"), Color("ffb23c"), Color("52d6ff"), Color("ff5a4a"),
	Color("7aa0ff"), Color("ff7ab8"), Color("ffe14a"), Color("9a8cff"), Color("ff8a3c"), Color("c8c8d0")]

var _age := 0.0
var _hover := -1

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false

func _k() -> float:
	return D.css_scale(self)

func _center() -> Vector2:
	return get_viewport_rect().size * 0.5

func _btn_r() -> float:
	return (25.0 if D.short_screen(self) else 30.0) * _k()

func _pos(i: int) -> Vector2:
	var n := ICONS.size()
	var a := float(i) / n * TAU - PI / 2.0
	var r := (118.0 if n > 8 else 100.0) * _k()
	return _center() + Vector2(cos(a), sin(a)) * r

func _hit(p: Vector2) -> int:
	for i in ICONS.size():
		if p.distance_to(_pos(i)) <= _btn_r():
			return i
	return -1

func toggle() -> void:
	if visible:
		close()
	else:
		visible = true
		_age = 0.0
		_hover = -1

func close() -> void:
	visible = false

func pick(i: int) -> void:
	close()
	picked.emit(i)

func _process(delta: float) -> void:
	if visible:
		_age += delta
		queue_redraw()

func _gui_input(ev: InputEvent) -> void:
	if ev is InputEventMouseMotion:
		_hover = _hit(ev.position)
	elif ev is InputEventMouseButton and ev.pressed:
		var i := _hit(ev.position)
		if i >= 0:
			pick(i)
		else:
			close()   # a tap outside the buttons closes the wheel
		accept_event()

func _unhandled_key_input(ev: InputEvent) -> void:
	if not visible or not (ev is InputEventKey) or not ev.pressed or ev.echo:
		return
	var k := (ev as InputEventKey).keycode
	if k >= KEY_1 and k <= KEY_9:
		pick(k - KEY_1)
		get_viewport().set_input_as_handled()
	elif k == KEY_0:
		pick(9)
		get_viewport().set_input_as_handled()
	elif k == KEY_ESCAPE:
		close()
		get_viewport().set_input_as_handled()

func _draw() -> void:
	var k := _k()
	var c := _center()
	var short := D.short_screen(self)
	# the disc: radial-gradient(rgba(16,12,30,.75), rgba(16,12,30,.35) 70%, transparent 71%)
	var dr := (115.0 if short else 150.0) * k
	var ink := Color(16 / 255.0, 12 / 255.0, 30 / 255.0, 0.75)
	var edge := Color(ink.r, ink.g, ink.b, 0.35)
	var n := 64
	for s in n:
		var a0 := TAU * s / n
		var a1 := TAU * (s + 1) / n
		draw_polygon(PackedVector2Array([c, c + Vector2(cos(a0), sin(a0)) * dr, c + Vector2(cos(a1), sin(a1)) * dr]),
			PackedColorArray([ink, edge, edge]))
	var br := _btn_r()
	var fs := (26.0 if short else 32.0) * k
	var touch_mode := false
	var tc: Variant = get_parent().get("touch") if get_parent() else null
	if tc is Control:
		touch_mode = (tc as Control).visible
	for i in ICONS.size():
		var t := clampf((_age - i * 0.0) / 0.18, 0.0, 1.0)   # ewIn: scale 0.4 -> 1, fade in
		var sc := lerpf(0.4, 1.0, D.ease_out(t))
		var p := _pos(i)
		draw_set_transform(p, 0.0, Vector2(sc, sc))
		draw_circle(Vector2(0, 4.0 * k), br, Color(D.INK.r, D.INK.g, D.INK.b, t))
		draw_circle(Vector2.ZERO, br, Color(D.INK.r, D.INK.g, D.INK.b, t))
		var bg := D.YELLOW if i == _hover else Color(1, 1, 1, 0.92)
		bg.a *= t
		draw_circle(Vector2.ZERO, br - 3.0 * k, bg)
		if D.has_emoji():
			D.text_c(self, Vector2.ZERO, ICONS[i], D.emoji_font(), fs, Color(1, 1, 1, t))
		else:
			var col := COLORS[i]
			col.a = t
			D.text_c(self, Vector2.ZERO, NAMES[i], Fonts.display(), fs * (0.42 if NAMES[i].length() > 3 else 0.55), col, 3.0 * k)
		if i < 9 and not touch_mode:
			var nf := Fonts.display()
			var ns := 12.0 * k
			var lbl := str(i + 1)
			var w := D.width(nf, lbl, ns)
			D.text(self, Vector2(br + 2.0 * k - w, br + 4.0 * k - D.line_h(nf, ns)), lbl, nf, ns, Color(1, 1, 1, t), 2.0 * k)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	D.text_c(self, c, I18n.t("opt.act.emote"), Fonts.display(), 14.0 * k, Color.WHITE, 3.0 * k)
