class_name Controls
extends RefCounted
# Keyboard, mouse and gamepad, a port of src/input.js + settings.binds (src/settings.js): the
# rebindable keys live in the InputMap ("game_<action>"), so Input.is_action_* works everywhere and
# the options' Controls tab rebinds them. Keys are physical (the web's KeyboardEvent.code): W A S D
# is Z Q S D on an AZERTY keyboard; the labels shown are the ones printed on the user's keyboard.
#
#   Controls.setup()                  once at start (main.gd), again after a rebind
#   Controls.note(ev)                 every input event (main.gd _input): pad / keyboard switch
#   Controls.poll(dt)                 once per frame, before anything reads the pad
#   Controls.just("gadget")           an action pressed this frame (false on a frame a UI ate the key)
#   Controls.move() / stick_r()       walk vector (keys + arrows + D-pad + left stick) / aim stick
#   Controls.pad_hit(JOY_BUTTON_A)    gamepad edges, for the menus
#
# Gamepad (standard layout, Xbox names): left stick / D-pad walk, right stick aims (its tilt = the
# throw distance), RT attacks (hold), RB fires the super (or hold LT to aim it, release to fire), LB
# gadget, R3 emote wheel, X ping, Y time of day, Start pause; menus: D-pad / stick, A, B, LB / RB tabs.

# Rebindable actions, in the options' order (src/menu.js ACTIONS; the web's Tab "panel" is a
# three.js lighting debug panel, not in this port).
const ACTIONS := ["up", "down", "left", "right", "super", "gadget", "emote", "ping", "tod", "mute", "pause"]
# Fixed gamepad buttons of each action (input.js PAD use in game.js / main.js / emotewheel.js).
const PAD := {"up": [JOY_BUTTON_DPAD_UP], "down": [JOY_BUTTON_DPAD_DOWN], "left": [JOY_BUTTON_DPAD_LEFT],
	"right": [JOY_BUTTON_DPAD_RIGHT], "super": [JOY_BUTTON_RIGHT_SHOULDER], "gadget": [JOY_BUTTON_LEFT_SHOULDER],
	"emote": [JOY_BUTTON_RIGHT_STICK], "ping": [JOY_BUTTON_X], "tod": [JOY_BUTTON_Y], "pause": [JOY_BUTTON_START]}
# Keys that always work besides the bound one (the web's arrows; Escape always pauses / goes back).
const EXTRA := {"up": [KEY_UP], "down": [KEY_DOWN], "left": [KEY_LEFT], "right": [KEY_RIGHT], "pause": [KEY_ESCAPE]}

static var using_pad := false      # the last input came from a gamepad (aim with the right stick, pad hints)
static var focus_visible := false  # keyboard / pad navigation in the menus: show the focus ring
static var pad_device := -1        # the gamepad that spoke last
static var capturing := false      # the options wait for a key to bind: no shortcut fires
static var _eat_frame := -1
static var _btn: Dictionary = {}   # JoyButton -> held this frame
static var _btn_prev: Dictionary = {}
static var _btn_ev: Dictionary = {}    # JoyButton -> held, from the events (whatever the device)
static var _btn_tap: Dictionary = {}   # pressed and released between two frames: still one press
static var _lt_prev := false
static var _lt := false
static var _tap_ms := -100000      # input.js tapT: a click still counts 120 ms after its release
static var _rmb_released := false
static var _rmb_prev := false
static var _nav_dir := ""
static var _nav_t := 0.0
static var _set_up := false

# ---------------------------------------------------------------- bindings

# Default physical key of an action. Movement keeps its place (W A S D = Z Q S D on AZERTY); the
# letter shortcuts follow their label (M mutes on any layout, like the HUD's "M to mute" says).
static func default_key(a: String) -> int:
	match a:
		"up": return KEY_W
		"down": return KEY_S
		"left": return KEY_A
		"right": return KEY_D
		"super": return KEY_SPACE
		"pause": return KEY_ESCAPE
	var label: int = {"gadget": KEY_E, "emote": KEY_B, "ping": KEY_G, "tod": KEY_T, "mute": KEY_M}.get(a, KEY_NONE)
	return _physical_of_label(label)

static func _physical_of_label(label: int) -> int:
	if label == KEY_NONE or not keymap_known():
		return label
	if DisplayServer.keyboard_get_keycode_from_physical(label) == label:
		return label
	for k in range(KEY_A, KEY_Z + 1) + [KEY_SEMICOLON, KEY_COMMA, KEY_PERIOD, KEY_APOSTROPHE, KEY_BRACKETLEFT,
			KEY_BRACKETRIGHT, KEY_SLASH, KEY_BACKSLASH, KEY_MINUS, KEY_EQUAL, KEY_QUOTELEFT]:
		if DisplayServer.keyboard_get_keycode_from_physical(k) == label:
			return k
	return label

# The OS keyboard layout can be read (Windows, Linux, macOS): the web and Android display servers
# have no layout API (each call logs "Not supported by this display server"); there the physical
# key is shown under its QWERTY name.
static func keymap_known() -> bool:
	return DisplayServer.get_name() in ["Windows", "X11", "Wayland", "macOS"]

static func key_of(a: String) -> int:
	return int(Settings.binds.get(a, default_key(a)))

# src/settings.js bind(): one key per action, the action that had it takes the old key of this one.
static func bind(a: String, phys: int) -> void:
	var old := key_of(a)
	for other in ACTIONS:
		if other != a and key_of(other) == phys:
			Settings.binds[other] = old
	Settings.binds[a] = phys
	_tidy()
	Settings.save()
	setup()

static func reset_binds() -> void:
	Settings.binds = {}
	Settings.save()
	setup()

# Only what differs from the defaults is saved (a later default change reaches everyone else).
static func _tidy() -> void:
	for a in Settings.binds.keys():
		if int(Settings.binds[a]) == default_key(a):
			Settings.binds.erase(a)

# The label printed on the key (AZERTY: the physical W shows "Z"), short names like settings.js keyName.
static func key_label(phys: int) -> String:
	if phys == KEY_NONE:
		return "—"
	var names := {KEY_SPACE: "Space", KEY_ESCAPE: "Esc", KEY_TAB: "Tab", KEY_ENTER: "Enter", KEY_BACKSPACE: "Backspace",
		KEY_SHIFT: "Shift", KEY_CTRL: "Ctrl", KEY_ALT: "Alt", KEY_UP: "↑", KEY_DOWN: "↓", KEY_LEFT: "←", KEY_RIGHT: "→",
		KEY_CAPSLOCK: "Caps"}
	if names.has(phys):
		return names[phys]
	var shown := phys
	if keymap_known():
		shown = DisplayServer.keyboard_get_label_from_physical(phys)
		if shown == KEY_NONE:
			shown = phys
	var s := OS.get_keycode_string(shown)
	if s.begins_with("Kp "):
		s = "Num " + s.substr(3)
	return s.to_upper() if s.length() == 1 else s

static func action_label(a: String) -> String:
	return key_label(key_of(a))

# (Re)builds the InputMap actions from the bindings.
static func setup() -> void:
	for a in ACTIONS:
		var name: String = "game_" + a
		if InputMap.has_action(name):
			InputMap.action_erase_events(name)
		else:
			InputMap.add_action(name, 0.5)
		var keys: Array = [key_of(a)]
		keys.append_array(EXTRA.get(a, []))
		for k in keys:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(name, ev)
		for b in PAD.get(a, []):
			var jb := InputEventJoypadButton.new()
			jb.button_index = b
			jb.device = -1
			InputMap.action_add_event(name, jb)
	# fixed: attack (left click / RT held) and the aimed super (right click / LT held, fires on release)
	for spec in [["game_attack", MOUSE_BUTTON_LEFT, JOY_AXIS_TRIGGER_RIGHT], ["game_super_aim", MOUSE_BUTTON_RIGHT, JOY_AXIS_TRIGGER_LEFT]]:
		var name: String = spec[0]
		if InputMap.has_action(name):
			InputMap.action_erase_events(name)
		else:
			InputMap.add_action(name, 0.5)
		var mb := InputEventMouseButton.new()
		mb.button_index = spec[1]
		InputMap.action_add_event(name, mb)
		var jm := InputEventJoypadMotion.new()
		jm.axis = spec[2]
		jm.axis_value = 1.0
		jm.device = -1
		InputMap.action_add_event(name, jm)
	# the GUI's own ui_* actions keep the keyboard only: the pad drives the menus through main.gd /
	# settings_view.gd (spatial focus, repeat), and a D-pad press must not move the focus twice
	for act in InputMap.get_actions():
		if String(act).begins_with("ui_"):
			for e in InputMap.action_get_events(act):
				if e is InputEventJoypadButton or e is InputEventJoypadMotion:
					InputMap.action_erase_event(act, e)
	_set_up = true

# ---------------------------------------------------------------- per event / per frame

# Which device spoke last (input.js usingPad): a pad button or a stick past the dead zone switches to
# the pad; a key, a click or a real mouse move back to keyboard + mouse.
static func note(ev: InputEvent) -> void:
	if ev is InputEventJoypadButton:
		var jb := ev as InputEventJoypadButton
		_btn_ev[jb.button_index] = jb.pressed
		if jb.pressed:
			_btn_tap[jb.button_index] = true
			_to_pad(ev.device)
	elif ev is InputEventJoypadMotion:
		var jm := ev as InputEventJoypadMotion
		var trig := jm.axis == JOY_AXIS_TRIGGER_LEFT or jm.axis == JOY_AXIS_TRIGGER_RIGHT
		if absf(jm.axis_value) > (0.5 if trig else maxf(Settings.deadzone, 0.25)):
			_to_pad(jm.device)
	elif ev is InputEventKey and ev.pressed:
		using_pad = false
		var k := (ev as InputEventKey).keycode
		if k in [KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_TAB]:
			focus_visible = true
	elif ev is InputEventMouseButton and ev.pressed:
		using_pad = false
		focus_visible = false
	elif ev is InputEventMouseMotion and (ev as InputEventMouseMotion).relative.length() > 2.0:
		using_pad = false
		if focus_visible:
			focus_visible = false
			_redraw_focus()
	elif ev is InputEventScreenTouch:
		using_pad = false

static func _to_pad(device: int) -> void:
	pad_device = device
	if not using_pad:
		using_pad = true
	if not focus_visible:
		focus_visible = true
		_redraw_focus()

static func _redraw_focus() -> void:
	var tree := Engine.get_main_loop() as SceneTree
	var vp := tree.root if tree else null
	var f := vp.gui_get_focus_owner() if vp else null
	if f:
		f.queue_redraw()

static func poll(dt: float) -> void:
	if not _set_up:
		setup()
	_btn_prev = _btn.duplicate()
	_btn = _btn_ev.duplicate()
	var dev := device()
	if dev >= 0:
		for b in range(JOY_BUTTON_A, JOY_BUTTON_DPAD_RIGHT + 1):
			_btn[b] = bool(_btn.get(b, false)) or Input.is_joy_button_pressed(dev, b)
	for b in _btn_tap:   # a press shorter than a frame still counts
		if not bool(_btn_prev.get(b, false)):
			_btn[b] = true
	_btn_tap.clear()
	_lt_prev = _lt
	_lt = dev >= 0 and Input.get_joy_axis(dev, JOY_AXIS_TRIGGER_LEFT) > 0.5
	var rmb := Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT)
	_rmb_released = _rmb_prev and not rmb
	_rmb_prev = rmb
	if Input.is_action_just_released("game_attack"):
		_tap_ms = Time.get_ticks_msec()
	# menu repeat (menu.js update): first step at once, then after 0.38 s, then every 0.11 s
	var s := stick_l()
	var d := ""
	if held(JOY_BUTTON_DPAD_UP) or s.y < -0.6: d = "up"
	elif held(JOY_BUTTON_DPAD_DOWN) or s.y > 0.6: d = "down"
	elif held(JOY_BUTTON_DPAD_LEFT) or s.x < -0.6: d = "left"
	elif held(JOY_BUTTON_DPAD_RIGHT) or s.x > 0.6: d = "right"
	_nav_step = ""
	if d == "":
		_nav_dir = ""
	elif d != _nav_dir:
		_nav_dir = d
		_nav_t = 0.38
		_nav_step = d
	else:
		_nav_t -= dt
		if _nav_t <= 0.0:
			_nav_t = 0.11
			_nav_step = d

static var _nav_step := ""
# The menu direction to step this frame from the D-pad / left stick ("" = none), with key repeat.
static func nav_step() -> String:
	return _nav_step

static func device() -> int:
	if pad_device >= 0 and Input.get_connected_joypads().has(pad_device):
		return pad_device
	var pads := Input.get_connected_joypads()
	return pads[0] if not pads.is_empty() else -1

static func pad_name() -> String:
	var d := device()
	if d < 0:
		return ""
	var n := Input.get_joy_name(d)
	var rx := RegEx.create_from_string("\\(.*?\\)")
	return rx.sub(n, "", true).strip_edges().left(40)

static func held(b: int) -> bool:
	return bool(_btn.get(b, false))

static func pad_hit(b: int) -> bool:
	return bool(_btn.get(b, false)) and not bool(_btn_prev.get(b, false))

# A UI (options, emote wheel...) used this frame's key: the game's shortcuts skip the frame.
static func eat() -> void:
	_eat_frame = Engine.get_process_frames()

static func eaten() -> bool:
	return _eat_frame == Engine.get_process_frames() or capturing

static func just(a: String) -> bool:
	return not eaten() and Input.is_action_just_pressed("game_" + a)

# ---------------------------------------------------------------- sticks and combined

static func _stick(x_axis: int, y_axis: int) -> Vector2:
	var dev := device()
	if dev < 0:
		return Vector2.ZERO
	var v := Vector2(Input.get_joy_axis(dev, x_axis), Input.get_joy_axis(dev, y_axis))
	var l := v.length()
	var dz := clampf(Settings.deadzone, 0.0, 0.9)
	if l < dz:   # radial dead zone, rescaled so movement starts smoothly just outside it
		return Vector2.ZERO
	return v * (minf(1.0, (l - dz) / (1.0 - dz)) / l)

static func stick_l() -> Vector2:
	return _stick(JOY_AXIS_LEFT_X, JOY_AXIS_LEFT_Y)

static func stick_r() -> Vector2:
	return _stick(JOY_AXIS_RIGHT_X, JOY_AXIS_RIGHT_Y)

# Walk from the bound keys, the arrows, the D-pad and the left stick (length <= 1), input.js move().
static func move() -> Vector2:
	if capturing:
		return Vector2.ZERO
	var v := Vector2(Input.get_action_strength("game_right") - Input.get_action_strength("game_left"),
		Input.get_action_strength("game_down") - Input.get_action_strength("game_up"))
	v += stick_l()
	return v.limit_length(1.0)

# Attack held (left click / RT), plus the 120 ms input buffer after a click.
static func attack_held() -> bool:
	return Input.is_action_pressed("game_attack") or Time.get_ticks_msec() - _tap_ms < 120

# The super being aimed (right click / LT held, or the super key held, like game.js superAiming).
static func super_aim_held() -> bool:
	return Input.is_action_pressed("game_super_aim") or Input.is_action_pressed("game_super")

# Fire the super this frame: its key / RB pressed, the right click or LT released (input.js superFired).
static func super_fired() -> bool:
	if eaten():
		return false
	return Input.is_action_just_pressed("game_super") or _rmb_released or (_lt_prev and not _lt)
