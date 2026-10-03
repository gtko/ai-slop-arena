class_name SettingsView
extends CssView
# The options screen, a port of the web's #options (play.html .opt-card, src/menu.js Menus, the
# .opt-* rules of src/style.css): tabs General / Graphics / Audio / Controls / Gamepad, rows of
# label + control (◀ choice ▶ with dots, slider bars, key bindings, buttons, info), the hint line
# of the focused row, "Reset tab" and BACK. One instance lives in main.gd's UI, over everything:
# the menu's gear and the pause card open it.
#
# Console-like navigation (menu.js): ↑↓ / D-pad / left stick pick a row, ←→ change it, Enter / A
# activates (a key row then waits for the new key, Esc cancels), Q E / LB RB switch tabs, Esc / B
# goes back. Every change is applied at once (Quality, AudioManager, Feel, Lighting, InputMap) and
# saved; `changed(key)` tells main.gd about the ones it applies (language, fps cap, saver...).

signal changed(key: String)
signal closed

const TABS := ["general", "graphics", "audio", "controls", "gamepad"]

var tab := "general"
var _rows: Array = []          # [{spec, node}] of the current tab (sections excluded)
var _foot: Array = []          # the footer buttons (reset, back), after the rows in the focus order
var _list: VBoxContainer
var _scroll: ScrollContainer
var _hint: Label
var _tabs: Dictionary = {}
var _capture := ""             # the action waiting for its new key
var _info_t := 0.0
var _focus_i := 0              # focused row index (rows, then footer buttons), kept across re-renders
var _live: Array = []          # [Label, Callable]: info rows refreshed every second (the controller name)

func _ready() -> void:
	super._ready()
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false

func open(which: String = "") -> void:
	if which != "" and TABS.has(which):
		tab = which
	_capture = ""
	Controls.capturing = false
	_focus_i = 0
	visible = true
	_animate = true
	rebuild()
	_focus_row(0, false)

func close() -> void:
	if not visible:
		return
	UiKit.click()
	_capture = ""
	Controls.capturing = false
	Controls.eat()
	visible = false
	Settings.save()
	closed.emit()

# ---------------------------------------------------------------- the tabs (src/menu.js tabs())

func _off_on() -> Array:
	return [[false, I18n.t("opt.off")], [true, I18n.t("opt.on")]]

func _choice(label: String, opts: Array, getter: Callable, setter: Callable, hint := "") -> Dictionary:
	return {"type": "choice", "label": label, "opts": opts, "getter": getter, "setter": setter, "hint": hint}

func _toggle(label: String, getter: Callable, setter: Callable, hint := "") -> Dictionary:
	return _choice(label, _off_on(), getter, setter, hint)

func _slider(label: String, lo: float, hi: float, step: float, fmt: Callable, getter: Callable, setter: Callable, hint := "") -> Dictionary:
	return {"type": "slider", "label": label, "min": lo, "max": hi, "step": step, "fmt": fmt, "getter": getter, "setter": setter, "hint": hint}

func _info(label: String, text: Variant) -> Dictionary:
	return {"type": "info", "label": label, "text": text}

func _button(label: String, text: String, run: Callable, hint := "") -> Dictionary:
	return {"type": "button", "label": label, "text": text, "run": run, "hint": hint}

func _section(t: String) -> Dictionary:
	return {"section": t}

# Save, apply what the statics cannot, tell main.gd.
func _done(key: String) -> void:
	Settings.save()
	changed.emit(key)

func _audio() -> AudioManager:
	var a := AudioManager.current
	return a if a and is_instance_valid(a) else null

func _tier_name(t: String) -> String:
	return I18n.t("opt." + t)

# Quality values: the hand-tuned one, else the tier's (battery saver aside, like the web's rows).
func _q(k: String) -> Variant:
	if Settings.gfx == "custom" and Settings.custom.has(k):
		return Settings.custom[k]
	return (Quality.PRESETS.get(Quality.level, Quality.PRESETS["high"]) as Dictionary)[k]

# settings.js set(): a hand-tuned quality value leaves the presets for "custom".
func _set_q(k: String, v: Variant) -> void:
	if Settings.gfx != "custom":
		var base: Dictionary = Quality.PRESETS.get(Quality.level, Quality.PRESETS["high"])
		Settings.custom = {}
		for t in Quality.TUNABLE:
			Settings.custom[t] = base[t]
		Settings.gfx = "custom"
	Settings.custom[k] = v
	Settings.save()
	Quality.apply()
	changed.emit("gfx")

func _preset_row() -> Dictionary:
	var opts := [["auto", func(): return "%s · %s" % [I18n.t("opt.auto"), _tier_name(Quality.device_level())]],
		["low", _tier_name("low")], ["medium", _tier_name("medium")], ["high", _tier_name("high")], ["ultra", _tier_name("ultra")],
		["custom", I18n.t("opt.custom")]]
	return _choice(I18n.t("opt.preset"), opts, func(): return Settings.gfx, func(v):
		if v == "custom":
			return
		Settings.gfx = String(v)
		Settings.custom = {}
		Settings.save()
		Quality.set_level(String(v))
		changed.emit("gfx"), I18n.t("opt.preset.hint"))

# The performance overlay (perf_probe.gd): frame time split, draw calls, quality step, renderer and
# the per-system script costs, for a screenshot that tells where the frame goes.
func _perf_row() -> Dictionary:
	return _toggle(I18n.t("g.opt.perf"), func(): return Settings.show_perf, func(v): Settings.show_perf = v; _done("show_perf"), I18n.t("g.opt.perf.hint"))

func _fullscreen_row() -> Dictionary:
	if OS.has_feature("web"):   # the page's fullscreen (the web game's option): asked from this tap, not saved
		return _toggle(I18n.t("opt.fullscreen"), func(): return DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN, func(v):
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if v else DisplayServer.WINDOW_MODE_WINDOWED))
	return _toggle(I18n.t("opt.fullscreen"), func(): return Settings.window != "windowed", func(v):
		Settings.window = "fullscreen" if v else "windowed"
		Settings.save()
		Settings.apply_display())

func _rows_of(t: String) -> Array:
	var desk := Settings.is_desktop_window()
	match t:
		"general":
			var langs := [["", I18n.t("opt.language.auto")]]
			for l in I18n.languages():
				langs.append([String(l.code), String(l.name)])
			var rows := [
				_choice(I18n.t("opt.language"), langs, func(): return Settings.lang, func(v): Settings.lang = String(v); _done("lang"), I18n.t("opt.language.hint")),
			]
			if desk or OS.has_feature("web"):
				rows.append(_fullscreen_row())
			rows.append_array([
				_toggle(I18n.t("opt.fps"), func(): return Settings.show_fps, func(v): Settings.show_fps = v; _done("show_fps")),
				_perf_row(),
				_toggle(I18n.t("opt.shake"), func(): return Settings.shake, func(v): Settings.shake = v; _done("shake")),
				_toggle(I18n.t("opt.colorblind"), func(): return Settings.colorblind, func(v): Settings.colorblind = v; _done("colorblind"), I18n.t("opt.colorblind.hint")),
				_preset_row(),
				_button(I18n.t("opt.privacy"), I18n.t("opt.privacy.open"), func(): OS.shell_open(NetClient.WEB_ORIGIN.replace("wss://", "https://") + "/privacy.html")),
				_section(I18n.t("meta.profile")),
				{"type": "custom", "label": I18n.t("g.looks"), "build": _icon_picker},
				_section(I18n.t("g.server")),
				{"type": "custom", "label": I18n.t("g.serverHint"), "build": _server_field},
			])
			return rows
		"graphics":
			var rows := [
				_preset_row(),
				_info(I18n.t("opt.gpu"), func(): var g := RenderingServer.get_video_adapter_name(); return g.left(48) if g != "" else I18n.t("opt.gpu.unknown")),
				_toggle(I18n.t("g.saver"), func(): return Settings.saver, func(v): Settings.saver = v; _done("saver"), I18n.t("g.saverDesc")),
				_section(I18n.t("opt.sec.display")),
			]
			if desk:
				rows.append(_choice(I18n.t("g.opt.window"), [["windowed", I18n.t("g.opt.window.windowed")], ["fullscreen", I18n.t("g.opt.window.fullscreen")],
					["exclusive", I18n.t("g.opt.window.exclusive")]], func(): return Settings.window, func(v):
						Settings.window = String(v)
						Settings.save()
						Settings.apply_display()))
				rows.append(_choice(I18n.t("g.opt.vsync"), [["off", I18n.t("opt.off")], ["on", I18n.t("opt.on")], ["adaptive", I18n.t("g.opt.vsync.adaptive")],
					["mailbox", I18n.t("g.opt.vsync.mailbox")]], func(): return Settings.vsync, func(v):
						Settings.vsync = String(v)
						Settings.save()
						Settings.apply_display(), I18n.t("g.opt.vsync.hint")))
			var caps := [[0, I18n.t("g.opt.fpsCap.none")]]
			for f in [30, 60, 90, 120, 144, 165, 240]:
				caps.append([f, "%d FPS" % f])
			rows.append_array([
				_choice(I18n.t("g.opt.fpsCap"), caps, func(): return Settings.fps_cap if Settings.fps_cap >= 0 else (Settings.MOBILE_FPS if Settings.is_mobile() else 0),
					func(v): Settings.fps_cap = int(v); _done("fps_cap"), I18n.t("g.opt.fpsCap.hint")),
				_choice(I18n.t("opt.renderScale"), [[0.5, "50%"], [0.7, "70%"], [0.85, "85%"], [1.0, "100%"], [1.25, "125%"], [1.5, "150%"]],
					func(): return float(_q("scale")), func(v): _set_q("scale", float(v)), I18n.t("opt.renderScale.hint")),
				_choice(I18n.t("opt.msaa"), [[0, I18n.t("opt.off")], [2, "MSAA 2x"], [4, "MSAA 4x"], [8, "MSAA 8x"]],
					func(): return int(_q("msaa")), func(v): _set_q("msaa", int(v))),
				_toggle(I18n.t("g.opt.fxaa"), func(): return Settings.fxaa, func(v): Settings.fxaa = v; Settings.save(); Quality.apply(), I18n.t("g.opt.fxaa.hint")),
				_slider(I18n.t("opt.brightness"), 0.5, 1.8, 0.05, func(v): return "%.2f" % v, func(): return Settings.brightness,
					func(v): Settings.brightness = v; Settings.save()),
				_choice(I18n.t("opt.tod"), [["0", I18n.t("opt.tod.morning")], ["1", I18n.t("opt.tod.noon")], ["2", I18n.t("opt.tod.sunset")],
					["3", I18n.t("opt.tod.night")], ["cycle", I18n.t("opt.tod.cycle")]], func(): return Settings.tod, func(v): Settings.tod = String(v); Settings.save()),
				_section(I18n.t("opt.sec.lighting")),
				_choice(I18n.t("opt.shadows"), [[0, I18n.t("opt.off")], [1024, I18n.t("opt.low")], [2048, I18n.t("opt.high")], [4096, I18n.t("opt.ultra")]],
					func(): return int(_q("shadow")), func(v): _set_q("shadow", int(v))),
				_choice(I18n.t("opt.shadowFilter"), [["soft", I18n.t("opt.shadowFilter.pcf")], ["softer", I18n.t("opt.shadowFilter.vsm")], ["hard", I18n.t("opt.shadowFilter.basic")]],
					func(): return Settings.shadow_filter, func(v): Settings.shadow_filter = String(v); Settings.save(); Quality.apply()),
				_slider(I18n.t("opt.softness"), 0.0, 8.0, 0.5, func(v): return "%.1f" % v, func(): return Settings.softness,
					func(v): Settings.softness = v; Settings.save(); Quality.apply()),
				_toggle(I18n.t("opt.bloom"), func(): return bool(_q("glow")), func(v): _set_q("glow", bool(v)), I18n.t("opt.bloom.hint")),
				_toggle(I18n.t("opt.dynLights"), func(): return int(_q("lights")) > 0, func(v): _set_q("lights", 4 if v else 0), I18n.t("opt.dynLights.hint")),
				_choice(I18n.t("opt.weather"), [[0.25, I18n.t("opt.low")], [0.5, I18n.t("opt.medium")], [1.0, I18n.t("opt.high")]],
					func(): return float(_q("weather")), func(v): _set_q("weather", float(v))),
			])
			return rows
		"audio":
			var vol := func(ch: String, label: String) -> Dictionary:
				return _slider(label, 0, 100, 5, func(v): return "%d%%" % roundi(v), func(): return roundf(Settings.volume(ch) * 100.0),
					func(v): Settings.set_volume(ch, v / 100.0))
			return [
				vol.call("master", I18n.t("opt.vol.master")),
				vol.call("music", I18n.t("opt.vol.music")),
				vol.call("sfx", I18n.t("opt.vol.sfx")),
				vol.call("amb", I18n.t("opt.vol.amb")),
				_choice(I18n.t("opt.track"), [["auto", I18n.t("sound.auto")], ["menu", I18n.t("sound.lobby")], ["battle", I18n.t("sound.battle")], ["off", I18n.t("opt.off")]],
					func(): return String(_audio().track) if _audio() else "auto", func(v): if _audio(): _audio().set_track(String(v))),
				_toggle(I18n.t("opt.muteAll"), func(): return _audio() != null and _audio().muted, func(v): if _audio(): _audio().muted = v),
				_button(I18n.t("opt.testSfx"), I18n.t("opt.play"), _test_sfx),
			]
		"controls":
			var rows := [_section(I18n.t("opt.sec.keyboard"))]
			for a in Controls.ACTIONS:
				rows.append({"type": "key", "action": a, "label": I18n.t("opt.act." + a)})
			rows.append_array([
				_section(I18n.t("opt.sec.mouse")),
				_info(I18n.t("opt.aim"), I18n.t("opt.mouse.aim")),
				_info(I18n.t("opt.attack"), I18n.t("opt.mouse.attack")),
				_info(I18n.t("opt.super"), I18n.t("opt.mouse.super")),
				_button(I18n.t("opt.resetKeys"), I18n.t("opt.reset"), func(): Controls.reset_binds()),
			])
			return rows
		"gamepad":
			return [
				_info(I18n.t("opt.controller"), func(): var n := Controls.pad_name(); return n if n != "" else I18n.t("opt.noController")),
				_slider(I18n.t("opt.deadzone"), 0.05, 0.4, 0.01, func(v): return "%d%%" % roundi(v * 100.0), func(): return Settings.deadzone,
					func(v): Settings.deadzone = v; Settings.save()),
				_toggle(I18n.t("opt.vibration"), func(): return Settings.vibration, func(v):
					Settings.vibration = v
					Settings.save()
					if v:
						Feel.rumble(0.5, 0.5, 120)),
				_toggle(I18n.t("g.opt.aimAssist"), func(): return Settings.aim_assist, func(v): Settings.aim_assist = v; Settings.save(), I18n.t("g.opt.aimAssist.hint")),
				_section(I18n.t("opt.sec.layout")),
				_info(I18n.t("opt.move"), I18n.t("opt.pad.move")),
				_info(I18n.t("opt.aim"), I18n.t("opt.pad.aim")),
				_info(I18n.t("opt.attack"), I18n.t("opt.pad.attack")),
				_info(I18n.t("opt.super"), I18n.t("opt.pad.super")),
				_info(I18n.t("opt.act.gadget"), "LB"),
				_info(I18n.t("opt.act.emote"), "R3"),
				_info(I18n.t("opt.act.ping"), "X"),
				_info(I18n.t("opt.tod"), "Y"),
				_info(I18n.t("opt.pause"), "Start"),
				_info(I18n.t("opt.menus"), I18n.t("opt.pad.menus")),
			]
	return []

func _reset_tab() -> void:
	match tab:
		"general":
			Settings.lang = ""
			Settings.show_fps = false
			Settings.show_perf = false
			Settings.shake = true
			_done("lang")
		"graphics":
			Settings.gfx = "auto"
			Settings.custom = {}
			Settings.saver = false
			Settings.window = "windowed"
			Settings.vsync = "on"
			Settings.fps_cap = -1
			Settings.fxaa = false
			Settings.shadow_filter = "soft"
			Settings.softness = 3.0
			Settings.brightness = 1.0
			Settings.tod = "2"
			Settings.save()
			Quality.set_level("auto")
			Settings.apply_display()
			changed.emit("gfx")
			changed.emit("saver")
		"audio":
			var a := _audio()
			if a:
				a.master = 0.5
				a.music = 0.8
				a.sfx = 1.0
				a.amb = 0.8
				a.set_track("auto")
				a.muted = false
		"controls":
			Controls.reset_binds()
		"gamepad":
			Settings.deadzone = 0.18
			Settings.vibration = true
			Settings.aim_assist = true
			Settings.save()

func _test_sfx() -> void:
	var a := _audio()
	if a == null:
		return
	for i in 4:
		get_tree().create_timer(i * 0.28).timeout.connect(func(): if is_instance_valid(a): a.play(["shotgun", "shot", "boom", "pickup"][i]))

# The free profile icons (cosmetics.js ICONS 0-4: the five starter brawlers).
func _icon_picker() -> Control:
	var row := _box(8, false)
	for i in 5:
		var on := i == Settings.icon
		var ib := MenuTap.new(UiKit.sbox(Color(1, 1, 1, 0.08), 12, UiKit.YELLOW if on else UiKit.INK, 3))
		ib.focus_mode = Control.FOCUS_NONE
		ib.custom_minimum_size = Vector2(46, 46)
		var clip := UiKit.clip_box(9, Vector2(40, 40))
		clip.add_child(_portrait(String(["blaster", "gunslinger", "bomber", "frostbite", "volt"][i]), Vector2(40, 40)))
		ib.add_child(clip)
		ib.pressed.connect(func():
			Settings.icon = i
			_done("icon")
			_render_body())
		row.add_child(ib)
	return row

func _server_field() -> Control:
	var e := LineEdit.new()
	e.text = Settings.server
	e.placeholder_text = "wss://…"
	e.custom_minimum_size = Vector2(300, 0)
	e.add_theme_font_override("font", _fb(800))
	e.add_theme_font_size_override("font_size", 15)
	e.add_theme_color_override("font_color", UiKit.WTEXT)
	e.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color("2d2742"), 10, UiKit.INK, 2), 10, 6, 10, 6))
	e.add_theme_stylebox_override("focus", UiKit.pads(UiKit.sbox(Color(0, 0, 0, 0), 10, UiKit.YELLOW, 2), 10, 6, 10, 6))
	e.text_changed.connect(func(s: String): Settings.server = s; Settings.server_override = false)   # typed here: saved
	e.focus_exited.connect(func(): _done("server"))
	e.text_submitted.connect(func(_s: String): e.release_focus())
	return e

# ---------------------------------------------------------------- layout (style.css .opt-*)

func _build() -> void:
	var veil := ColorRect.new()
	veil.color = Color(8 / 255.0, 6 / 255.0, 18 / 255.0, 0.72)
	veil.size = Vector2(W, H)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.add_child(veil)
	var cw := minf(880.0, W - (8.0 if phone else 24.0))
	var ch := minf(760.0, H - (16.0 if phone else 48.0))
	var card := _panel(UiKit.sbox(Color(22 / 255.0, 18 / 255.0, 36 / 255.0, 0.96), 18, UiKit.INK, 3, UiKit.INK, 8, 1))
	card.position = Vector2((W - cw) / 2.0, (H - ch) / 2.0 - 4.0)
	card.size = Vector2(cw, ch)
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.clip_contents = true
	_page.add_child(card)
	var col := _box(0, true)
	card.add_child(col)
	# head: OPTIONS + the tabs
	var head := MarginContainer.new()
	head.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for m in [["margin_left", 14 if phone else 22], ["margin_right", 14 if phone else 22], ["margin_top", 8 if phone else 18], ["margin_bottom", 0]]:
		head.add_theme_constant_override(m[0], m[1])
	var hb := _box(12 if phone else 22, false)
	hb.alignment = BoxContainer.ALIGNMENT_BEGIN
	var title := _disp(I18n.t("opt.title"), 26 if phone else 40, UiKit.YELLOW)
	title.add_theme_constant_override("outline_size", 6)
	title.add_theme_color_override("font_outline_color", UiKit.INK)
	title.add_theme_color_override("font_shadow_color", UiKit.INK)
	title.add_theme_constant_override("shadow_offset_x", 0)
	title.add_theme_constant_override("shadow_offset_y", 4)
	title.add_theme_constant_override("shadow_outline_size", 6)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	hb.add_child(title)
	var tscroll := ScrollContainer.new()
	tscroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	tscroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	tscroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tscroll.size_flags_vertical = Control.SIZE_SHRINK_END
	var tabs := _box(6, false)
	_tabs.clear()
	for k in TABS:
		var b := _tab_button(k)
		tabs.add_child(b)
		_tabs[k] = b
	tscroll.add_child(tabs)
	tscroll.custom_minimum_size.y = tabs.get_combined_minimum_size().y
	hb.add_child(tscroll)
	head.add_child(hb)
	col.add_child(head)
	# body: the rows of the tab
	var bodyp := _panel(UiKit.sbox(Color(10 / 255.0, 8 / 255.0, 20 / 255.0, 0.35), 0))
	var bs := bodyp.get_theme_stylebox("panel") as StyleBoxFlat
	bs.border_width_top = 3
	bs.border_color = UiKit.INK
	bodyp.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var bm := MarginContainer.new()
	bm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bm.mouse_filter = Control.MOUSE_FILTER_PASS
	for m in [["margin_left", 12 if phone else 22], ["margin_right", 12 if phone else 22], ["margin_top", 4 if phone else 10], ["margin_bottom", 4 if phone else 10]]:
		bm.add_theme_constant_override(m[0], m[1])
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 0)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.mouse_filter = Control.MOUSE_FILTER_PASS
	bm.add_child(_list)
	_scroll.add_child(bm)
	bodyp.add_child(_scroll)
	col.add_child(bodyp)
	# hint line
	var hp := _panel(UiKit.pads(UiKit.sbox(Color(0, 0, 0, 0), 0), 14 if phone else 22, 4 if phone else 8, 14 if phone else 22, 4 if phone else 8))
	var hs := hp.get_theme_stylebox("panel") as StyleBoxFlat
	hs.border_width_top = 1
	hs.border_color = Color(1, 1, 1, 0.12)
	_hint = _body_label("", 11 if phone else 13, UiKit.WMUTED, 700)
	_hint.custom_minimum_size.y = 16 if phone else 20
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hp.add_child(_hint)
	col.add_child(hp)
	# footer: key hints, Reset tab, BACK
	var foot := MarginContainer.new()
	foot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for m in [["margin_left", 14 if phone else 22], ["margin_right", 14 if phone else 22], ["margin_top", 6 if phone else 10], ["margin_bottom", 8 if phone else 16]]:
		foot.add_theme_constant_override(m[0], m[1])
	var fh := _box(10, false)
	var keys := _body_label(_footer_text(), 12, UiKit.WMUTED, 700)
	keys.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	keys.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	keys.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	keys.visible = not phone
	fh.add_child(keys)
	if phone:
		var sp := Control.new()
		sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sp.mouse_filter = Control.MOUSE_FILTER_IGNORE
		fh.add_child(sp)
	var reset := _ghost(I18n.t("opt.resetTab"), 14, 7, 14, 4)
	reset.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	reset.pressed.connect(func(): _reset_tab(); _render_body())
	var back := _big(I18n.t("opt.back"), 20, 8, 28, 6)
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	back.silent = true
	back.pressed.connect(close)
	fh.add_child(reset)
	fh.add_child(back)
	_foot = [reset, back]
	for b in _foot:
		(b as Control).focus_entered.connect(func(): _focus_i = _rows.size() + _foot.find(b); _hint.text = "")
	foot.add_child(fh)
	col.add_child(foot)
	_render_body()
	if _animate:   # the card drops in like the pause card
		veil.modulate.a = 0.0
		veil.create_tween().tween_property(veil, "modulate:a", 1.0, 0.15)
		card.modulate.a = 0.0
		var y := card.position.y
		card.position.y -= 14.0
		var tw := card.create_tween().set_parallel(true)
		tw.tween_property(card, "modulate:a", 1.0, 0.18)
		tw.tween_property(card, "position:y", y, 0.22).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

func _body_label(t: String, size: int, color: Color, weight: int) -> Label:
	return _body(t, size, color, weight)

func _footer_text() -> String:
	var t := I18n.t("opt.footer")
	t = t.replace("<kbd>Q</kbd><kbd>E</kbd>", "%s %s" % [Controls.key_label(KEY_Q), Controls.key_label(KEY_E)])
	var rx := RegEx.create_from_string("<[^>]+>")
	return rx.sub(t, " ", true).replace("  ", " ").strip_edges()

func _tab_button(k: String) -> MenuTap:
	var on := k == tab
	var st := func(hover: bool) -> StyleBox:
		var s := UiKit.sbox(UiKit.YELLOW if on else (Color("362f52") if hover else Color("2a2440")), 12, UiKit.INK, 3)
		s.corner_radius_bottom_left = 0
		s.corner_radius_bottom_right = 0
		return UiKit.pads(s, 10 if phone else 18, 6 if phone else 10, 10 if phone else 18, 5 if phone else 8)
	var b := MenuTap.new(st.call(false), st.call(true))
	b.focus_mode = Control.FOCUS_NONE
	b.add_child(_disp(I18n.t("opt.tab." + k), 13 if phone else 17, UiKit.INK if on else UiKit.WMUTED))
	b.pressed.connect(func(): _set_tab(k))
	return b

func _set_tab(k: String) -> void:
	if k == tab:
		return
	tab = k
	_capture = ""
	Controls.capturing = false
	_focus_i = 0
	_animate = false
	rebuild()
	_focus_row(0, false)

func _cycle_tab(d: int) -> void:
	UiKit.click()
	_set_tab(TABS[(TABS.find(tab) + d + TABS.size()) % TABS.size()])

# The rows of the tab (re-rendered after each change, like menu.js render()).
func _render_body() -> void:
	if _list == null:
		return
	var keep := _focus_i
	for c in _list.get_children():
		c.queue_free()
	_rows.clear()
	_live.clear()
	for spec in _rows_of(tab):
		var s: Dictionary = spec
		if s.has("section"):
			var l := _disp(String(s.section).to_upper(), 12 if phone else 14, Color(UiKit.YELLOW, 0.85), 0, 1)
			var m := MarginContainer.new()
			m.mouse_filter = Control.MOUSE_FILTER_IGNORE
			m.add_theme_constant_override("margin_top", 6 if phone else 14)
			m.add_theme_constant_override("margin_bottom", 2 if phone else 4)
			m.add_child(l)
			_list.add_child(m)
			continue
		var row := _row(s, _rows.size())
		_list.add_child(row)
		_rows.append({"spec": s, "node": row})
	var f := get_viewport().gui_get_focus_owner()
	if visible and (f == null or (is_ancestor_of(f) and f.is_queued_for_deletion())):
		_focus_row(keep, false)

func _row_style(on: bool) -> StyleBox:
	var s := UiKit.sbox(Color(1, 210 / 255.0, 63 / 255.0, 0.1) if on else Color(0, 0, 0, 0), 10, UiKit.YELLOW if on else Color(0, 0, 0, 0), 2)
	return UiKit.pads(s, 8 if phone else 12, 4 if phone else 9, 8 if phone else 12, 4 if phone else 9)

func _row(s: Dictionary, idx: int) -> PanelContainer:
	var row := PanelContainer.new()
	row.focus_mode = Control.FOCUS_ALL
	row.mouse_filter = Control.MOUSE_FILTER_STOP
	row.add_theme_stylebox_override("panel", _row_style(false))
	var h := _box(10 if phone else 16, false)
	h.mouse_filter = Control.MOUSE_FILTER_PASS
	var l := _body(String(s.get("label", "")), 13 if phone else 15, UiKit.WTEXT, 800)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 120
	h.add_child(l)
	var ctrl := _control_of(s, idx)
	ctrl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(ctrl)
	row.add_child(h)
	var hint := String(s.get("hint", ""))
	row.focus_entered.connect(func():
		_focus_i = idx
		row.add_theme_stylebox_override("panel", _row_style(true))
		_hint.text = hint
		_tint_arrows(row, true))
	row.focus_exited.connect(func():
		row.add_theme_stylebox_override("panel", _row_style(false))
		_tint_arrows(row, false))
	row.mouse_entered.connect(func(): if not Controls.focus_visible and visible and not (get_viewport().gui_get_focus_owner() is LineEdit): row.grab_focus())
	row.gui_input.connect(func(ev: InputEvent):
		if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
			row.grab_focus()
			if String(s.get("type", "")) in ["choice", "key"]:
				_activate(idx)
			row.accept_event())
	return row

# The ◀ ▶ of a focused choice row turn yellow (.opt-row:focus .arr).
func _tint_arrows(row: Control, on: bool) -> void:
	for a in row.find_children("*", "PanelContainer", true, false):
		if not a.has_meta("arr"):
			continue
		var t := a as MenuTap
		t.set_styles(_arr_style(on), _arr_style(true))
		var lab := t.get_child(0) as Label
		if lab:
			lab.add_theme_color_override("font_color", UiKit.INK if on else UiKit.WTEXT)

func _arr_style(on: bool) -> StyleBox:
	return UiKit.sbox(UiKit.YELLOW if on else Color("2d2742"), 8, UiKit.INK, 2)

func _opt_index(opts: Array, cur: Variant) -> int:
	for i in opts.size():
		if typeof(opts[i][0]) == typeof(cur) and opts[i][0] == cur:
			return i
	if cur is float or cur is int:   # the nearest value (a tier between two of the listed steps)
		var best := 0
		for i in opts.size():
			if (opts[i][0] is float or opts[i][0] is int) and absf(float(opts[i][0]) - float(cur)) < absf(float(opts[best][0]) - float(cur)):
				best = i
		return best
	return 0

func _control_of(s: Dictionary, idx: int) -> Control:
	match String(s.get("type", "")):
		"choice":
			var opts: Array = s.opts
			var i := _opt_index(opts, (s.getter as Callable).call())
			var v := _box(2, true)
			var hb := _box(6 if phone else 10, false)
			hb.alignment = BoxContainer.ALIGNMENT_END
			var prev := _arrow("◀", func(): _step(idx, -1))
			var next := _arrow("▶", func(): _step(idx, 1))
			var lbl: Variant = opts[i][1]
			var val := _disp(String(lbl.call() if lbl is Callable else lbl), 14 if phone else 17)
			val.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			val.custom_minimum_size.x = 120 if phone else 170
			val.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			val.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			hb.add_child(prev)
			hb.add_child(val)
			hb.add_child(next)
			v.add_child(hb)
			var dots := _box(3, false)
			dots.alignment = BoxContainer.ALIGNMENT_CENTER
			var shown := opts.size() if opts.size() <= 12 else 0   # 31 languages: no dots
			for k in shown:
				var d := Panel.new()
				d.mouse_filter = Control.MOUSE_FILTER_IGNORE
				d.custom_minimum_size = Vector2(14 if opts.size() <= 8 else 8, 3)
				d.add_theme_stylebox_override("panel", UiKit.sbox(UiKit.YELLOW if k == i else Color(1, 1, 1, 0.18), 2))
				dots.add_child(d)
			v.add_child(dots)
			v.custom_minimum_size.x = 0 if phone else 300
			return v
		"slider":
			var cur := float((s.getter as Callable).call())
			var f := clampf((cur - float(s.min)) / (float(s.max) - float(s.min)), 0.0, 1.0)
			var hb := _box(12, false)
			hb.alignment = BoxContainer.ALIGNMENT_END
			var bar := Panel.new()
			bar.custom_minimum_size = Vector2(150 if phone else 220, 14)
			bar.add_theme_stylebox_override("panel", UiKit.sbox(Color("2d2742"), 7, UiKit.INK, 2))
			bar.clip_contents = true
			bar.mouse_filter = Control.MOUSE_FILTER_STOP
			bar.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			var fill := UiKit.grad_rect(UiKit.grad([[0.0, Color("ffbf1f")], [1.0, Color("ffe36b")]], Vector2(0, 0), Vector2(1, 0)))
			fill.set_anchors_preset(Control.PRESET_TOP_LEFT)
			fill.position = Vector2(2, 2)
			fill.size = Vector2((bar.custom_minimum_size.x - 4) * f, 10)
			fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
			bar.add_child(fill)
			var val := _disp(String((s.fmt as Callable).call(cur)), 14 if phone else 16)
			val.custom_minimum_size.x = 54
			val.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			var drag := func(x: float) -> void:
				var k := clampf(x / maxf(bar.size.x, 1.0), 0.0, 1.0)
				var step := float(s.step)
				var nv := snappedf(float(s.min) + k * (float(s.max) - float(s.min)), step)
				(s.setter as Callable).call(nv)
				fill.size.x = (bar.size.x - 4) * clampf((nv - float(s.min)) / (float(s.max) - float(s.min)), 0.0, 1.0)
				val.text = String((s.fmt as Callable).call(nv))
			bar.gui_input.connect(func(ev: InputEvent):
				if ev is InputEventMouseButton and ev.button_index == MOUSE_BUTTON_LEFT and ev.pressed:
					drag.call(ev.position.x)
					bar.accept_event()
				elif ev is InputEventMouseMotion and (ev.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
					drag.call(ev.position.x)
					bar.accept_event())
			hb.add_child(bar)
			hb.add_child(val)
			hb.custom_minimum_size.x = 0 if phone else 300
			return hb
		"key":
			if _capture == String(s.action):
				var l := _body(I18n.t("opt.pressKey"), 13 if phone else 15, UiKit.YELLOW, 800)
				var tw := l.create_tween().set_loops()
				tw.tween_property(l, "modulate:a", 0.45, 0.6).set_trans(Tween.TRANS_SINE)
				tw.tween_property(l, "modulate:a", 1.0, 0.6).set_trans(Tween.TRANS_SINE)
				return l
			return _kbd(Controls.action_label(String(s.action)))
		"button":
			var b := MenuTap.new(UiKit.pads(UiKit.sbox(Color("2d2742"), 10, UiKit.INK, 2), 16, 6, 16, 6),
				UiKit.pads(UiKit.sbox(Color("3a3258"), 10, UiKit.INK, 2), 16, 6, 16, 6))
			b.focus_mode = Control.FOCUS_NONE
			b.add_child(_disp(String(s.text), 14))
			b.pressed.connect(func(): _activate(idx))
			b.silent = true
			return b
		"custom":
			return (s.build as Callable).call()
	var t: Variant = s.get("text", "")
	var info := _body(String(t.call() if t is Callable else t), 13 if phone else 15, UiKit.WMUTED, 700)
	if t is Callable:
		_live.append([info, t])
	info.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info.custom_minimum_size.x = 160 if phone else 300
	return info

func _arrow(t: String, run: Callable) -> MenuTap:
	var a := MenuTap.new(_arr_style(false), _arr_style(true))
	a.set_meta("arr", true)
	a.focus_mode = Control.FOCUS_NONE
	a.silent = true
	a.custom_minimum_size = Vector2(26, 26) if phone else Vector2(30, 30)
	var l := _body(t, 13, UiKit.WTEXT, 900)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	a.add_child(l)
	a.pressed.connect(run)
	return a

# <kbd>: display face, translucent white, a darker bottom edge.
func _kbd(t: String) -> Control:
	var s := UiKit.sbox(Color(1, 1, 1, 0.14), 5)
	s.border_width_bottom = 2
	s.border_color = Color(0, 0, 0, 0.4)
	var p := _panel(UiKit.pads(s, 14, 4, 14, 4))
	p.add_child(_disp(t, 15))
	p.size_flags_horizontal = Control.SIZE_SHRINK_END
	return p

# ---------------------------------------------------------------- actions

func _step(idx: int, d: int) -> void:
	if idx < 0 or idx >= _rows.size():
		return
	var s: Dictionary = _rows[idx].spec
	match String(s.get("type", "")):
		"choice":
			var opts: Array = s.opts
			var i := _opt_index(opts, (s.getter as Callable).call())
			var n := (i + d + opts.size()) % opts.size()
			if opts[n][0] is String and opts[n][0] == "custom":   # "custom" is a state, not a pick
				n = (n + d + opts.size()) % opts.size()
			(s.setter as Callable).call(opts[n][0])
		"slider":
			var nv := clampf(float((s.getter as Callable).call()) + d * float(s.step), float(s.min), float(s.max))
			(s.setter as Callable).call(snappedf(nv, float(s.step)))
		_:
			return
	UiKit.click()
	_render_body()

func _activate(idx: int) -> void:
	if idx < 0 or idx >= _rows.size():
		return
	var s: Dictionary = _rows[idx].spec
	match String(s.get("type", "")):
		"key":
			_capture = String(s.action)
			Controls.capturing = true
			UiKit.click()
			_render_body()
		"button":
			UiKit.click()
			(s.run as Callable).call()
			_render_body()
		"choice":
			_step(idx, 1)
		"custom":
			var c := (_rows[idx].node as Control).find_children("*", "LineEdit", true, false)
			if not c.is_empty():
				(c[0] as LineEdit).grab_focus()

func _focus_row(i: int, scroll := true) -> void:
	var n := _rows.size() + _foot.size()
	if n == 0:
		return
	i = clampi(i, 0, n - 1)
	_focus_i = i
	var c: Control = _rows[i].node if i < _rows.size() else _foot[i - _rows.size()]
	if not is_instance_valid(c):
		return
	c.grab_focus()
	if scroll and _scroll and i < _rows.size():
		_scroll.ensure_control_visible.call_deferred(c)

func _move(d: int) -> void:
	var n := _rows.size() + _foot.size()
	var f := get_viewport().gui_get_focus_owner()
	if f == null or not is_ancestor_of(f):
		_focus_row(_focus_i)
		return
	_focus_row(clampi(_focus_i + d, 0, n - 1))
	UiKit.click()

# Left / right: change the focused row's value, or move between the footer buttons.
func _side(d: int) -> void:
	if _focus_i < _rows.size():
		_step(_focus_i, d)
	else:
		_focus_row(clampi(_focus_i + d, _rows.size(), _rows.size() + _foot.size() - 1))

func _confirm() -> void:
	if _focus_i < _rows.size():
		_activate(_focus_i)
	else:
		var b: MenuTap = _foot[_focus_i - _rows.size()]
		b.activate()

func _input(ev: InputEvent) -> void:
	if not visible:
		return
	# rebinding: grab the next key, whatever it is (Esc cancels)
	if _capture != "":
		if ev is InputEventKey and ev.pressed and not ev.echo:
			var k := ev as InputEventKey
			var phys := k.physical_keycode if k.physical_keycode != KEY_NONE else k.keycode
			if phys != KEY_ESCAPE:
				Controls.bind(_capture, phys)
				UiKit.click()
			_capture = ""
			Controls.capturing = false
			Controls.eat()
			get_viewport().set_input_as_handled()
			_render_body()
		elif ev is InputEventJoypadButton and ev.pressed and ev.button_index == JOY_BUTTON_B:
			_capture = ""
			Controls.capturing = false
			Controls.eat()
			get_viewport().set_input_as_handled()
			_render_body()
		return
	if not (ev is InputEventKey) or not ev.pressed:
		return
	var key := ev as InputEventKey
	var f := get_viewport().gui_get_focus_owner()
	if f is LineEdit:   # typing (the server address): Esc / Enter leave the field
		if key.keycode == KEY_ESCAPE or key.physical_keycode == KEY_ESCAPE:
			f.release_focus()
			_focus_row(_focus_i, false)
			get_viewport().set_input_as_handled()
			Controls.eat()
		return
	var handled := true
	match key.keycode if key.keycode != KEY_NONE else key.physical_keycode:
		KEY_ESCAPE:
			if not key.echo:
				close()
		KEY_UP:
			_move(-1)
		KEY_DOWN:
			_move(1)
		KEY_LEFT:
			_side(-1)
		KEY_RIGHT:
			_side(1)
		KEY_ENTER, KEY_KP_ENTER, KEY_SPACE:
			if not key.echo:
				_confirm()
		_:
			handled = false
	if not handled and not key.echo:
		if key.physical_keycode == KEY_Q:
			_cycle_tab(-1)
			handled = true
		elif key.physical_keycode == KEY_E:
			_cycle_tab(1)
			handled = true
	if handled:
		get_viewport().set_input_as_handled()
		Controls.eat()

func _process(delta: float) -> void:
	if not visible:
		return
	# gamepad (menu.js update): D-pad / stick with repeat, A, B / Start back, LB / RB tabs
	if _capture == "":
		if Controls.pad_hit(JOY_BUTTON_B) or Controls.pad_hit(JOY_BUTTON_START):
			close()
			return
		if Controls.pad_hit(JOY_BUTTON_LEFT_SHOULDER):
			_cycle_tab(-1)
		elif Controls.pad_hit(JOY_BUTTON_RIGHT_SHOULDER):
			_cycle_tab(1)
		if Controls.pad_hit(JOY_BUTTON_A):
			_confirm()
		match Controls.nav_step():
			"up": _move(-1)
			"down": _move(1)
			"left": _side(-1)
			"right": _side(1)
	# the controller's name shows up when one is plugged in
	_info_t -= delta
	if _info_t <= 0.0:
		_info_t = 1.0
		for l in _live:
			if is_instance_valid(l[0]):
				(l[0] as Label).text = String((l[1] as Callable).call())
