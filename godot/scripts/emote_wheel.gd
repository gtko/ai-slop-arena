class_name EmoteWheel
extends Control
# Emote wheel like src/emotewheel.js: the emotes on a circle, tap / click / number key to send.
# The server takes an index (0..11, em counter + ei in the input message). Labels are plain
# words instead of emoji so they render on every export target without a font.

signal picked(index: int)

const NAMES: Array[String] = ["GG", "OK!", "HI", "LOL", "COOL", "GRR", "CRY", "LOVE", "WOW", "ZZZ", "CLOWN", "RIP"]
const COLORS: Array[Color] = [Color("5aa9ff"), Color("ffd24a"), Color("8be36a"), Color("ffb23c"), Color("52d6ff"), Color("ff5a4a"),
	Color("7aa0ff"), Color("ff7ab8"), Color("ffe14a"), Color("9a8cff"), Color("ff8a3c"), Color("c8c8d0")]

var _buttons: Array[Button] = []

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	var n := NAMES.size()
	var r := 128.0
	for i in n:
		var b := Button.new()
		b.text = NAMES[i]
		b.custom_minimum_size = Vector2(88, 60)
		b.size = Vector2(88, 60)
		b.add_theme_font_size_override("font_size", 22)
		b.add_theme_color_override("font_color", COLORS[i])
		b.add_theme_color_override("font_hover_color", Color.WHITE)
		b.focus_mode = Control.FOCUS_NONE
		var a := float(i) / n * TAU - PI / 2.0
		b.set_meta("off", Vector2(cos(a), sin(a)) * r - b.size * 0.5)
		b.pressed.connect(pick.bind(i))
		add_child(b)
		_buttons.append(b)
	resized.connect(_layout)
	_layout()

func _layout() -> void:
	var c := size * 0.5
	for b in _buttons:
		b.position = c + (b.get_meta("off") as Vector2)

func toggle() -> void:
	if visible:
		close()
	else:
		visible = true
		_layout()

func close() -> void:
	visible = false

func pick(i: int) -> void:
	close()
	picked.emit(i)

func _gui_input(ev: InputEvent) -> void:
	# a tap outside the buttons closes the wheel
	if ev is InputEventMouseButton and ev.pressed:
		close()
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
