class_name Lobby
extends Control
# The room screen (private rooms by 4-letter code, and the short wait of a matchmade room), a copy of
# the web's #lobbyRoom (play.html, src/style.css): the online card over the live arena, room code bar,
# the 8 slots (players, then bots), your brawler, the leader's mode / map / Weekly Chaos and START,
# kick and report. Pure view: main.gd feeds it the server's {t:"room"} message and sends what it emits.
# Laid out in CSS pixels like the menu (UiKit.css_scale).

const MenuTap := preload("res://scripts/menu_tap.gd")

signal leave
signal start
signal map_picked(map: String)
signal mode_picked(mode: String)
signal chaos_toggled(on: bool)
signal kick(id: String)
signal report(id: String, reason: String)
signal brawler_picked(key: String)

const PLAT_ICON := {"web": "🌐", "steam": "🎮", "epic": "🛒", "android": "🤖", "ios": "🍏"}
const MUTATORS := ["cubeRain", "nightHunt", "gasBreath", "superRush", "gadgetFrenzy"]
const MUT_ICONS := {"cubeRain": "💎", "nightHunt": "🌙", "gasBreath": "☠️", "superRush": "🌟", "gadgetFrenzy": "🧰"}
const MAP_ICON := {"clear": "☀️", "sandstorm": "🌪️", "rain": "🌧️", "snow": "❄️", "fog": "🌫️"}

var my_id := ""
var is_leader := false
var matchmade := false
var _k := 1.0
var W := 1280.0
var H := 720.0
var phone := false
var _page: Control
var _code: Label
var _list: GridContainer
var _cards: Dictionary = {}
var _maps: Dictionary = {}
var _modes: Dictionary = {}
var _mode_row: Control
var _chaos: MenuTap
var _map_box: Control
var _start: MenuTap
var _info: Label
var _report_dialog: Control
var _report_target := ""
var _report_name: Label
var _toast: Label
var _toast_t := 0.0
var _last: Dictionary = {}
var _last_code := ""
var _built_for := Vector2.ZERO
static var _font_cache: Dictionary = {}

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	get_viewport().size_changed.connect(func(): call_deferred("_rebuild_if_needed"))
	_build()

func _rebuild_if_needed() -> void:
	if not is_inside_tree():
		return
	_measure()
	if Vector2(W, H) != _built_for:
		_build()
		if not _last.is_empty() or _last_code != "":
			show_room(_last_code, _last)

func _measure() -> void:
	_k = UiKit.css_scale(get_viewport())
	var vs := get_viewport().get_visible_rect().size
	W = vs.x / _k
	H = vs.y / _k
	phone = H <= 520.0 and W > H

# ---------------------------------------------------------------- helpers (the menu's, see menu.gd)

func _over() -> float:
	var vh := get_viewport().get_visible_rect().size.y
	return maxf(float(DisplayServer.window_get_size().y) / maxf(vh, 1.0), 0.25) * _k

func _font_file(path: String) -> FontFile:
	var key := "%s@%.3f" % [path, _over()]
	if not _font_cache.has(key):
		var ff := (load(path) as FontFile).duplicate() as FontFile
		ff.oversampling = _over()
		_font_cache[key] = ff
	return _font_cache[key]

func _fd() -> Font:
	return _font_file("res://assets/fonts/LilitaOne-Regular.ttf")

func _fb(weight: int = 800) -> Font:
	var key := "body%d@%.3f" % [weight, _over()]
	if not _font_cache.has(key):
		var f := FontVariation.new()
		f.base_font = _font_file("res://assets/fonts/Nunito.ttf")
		f.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): weight}
		_font_cache[key] = f
	return _font_cache[key]

func _disp(t: String, size: int, color: Color = Color.WHITE, stroke: int = 0, spacing: float = 0.0) -> Label:
	return UiKit.text(t, size, color, _fd(), stroke, spacing)

func _body(t: String, size: int, color: Color = UiKit.WTEXT, weight: int = 800, spacing: float = 0.0) -> Label:
	return UiKit.text(t, size, color, _fb(weight), 0, spacing)

func _box(sep: float, vertical: bool) -> BoxContainer:
	var b: BoxContainer = VBoxContainer.new() if vertical else HBoxContainer.new()
	b.add_theme_constant_override("separation", int(sep))
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b

func _panel(s: StyleBox) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", s)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p

func _center(c: Control) -> CenterContainer:
	var cc := CenterContainer.new()
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cc.add_child(c)
	return cc

func _big(text: String, size: int, padv: float, padh: float = 44.0) -> MenuTap:
	var b := MenuTap.new(UiKit.pads(UiKit.sbox(Color("ffd545"), 14, UiKit.INK, 3, UiKit.INK, 6, 1), padh, padv, padh, padv),
		UiKit.pads(UiKit.sbox(Color("ffdc5c"), 14, UiKit.INK, 3, UiKit.INK, 6, 1), padh, padv, padh, padv))
	var l := _disp(text, size, UiKit.INK)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	b.add_child(l)
	return b

func _ghost(text: String, size: int, padv: float = 8.0, padh: float = 12.0) -> MenuTap:
	var b := MenuTap.new(UiKit.pads(UiKit.sbox(Color(40 / 255.0, 34 / 255.0, 62 / 255.0, 0.9), 14, UiKit.INK, 3, UiKit.INK, 4, 1), padh, padv, padh, padv),
		UiKit.pads(UiKit.sbox(Color(58 / 255.0, 48 / 255.0, 96 / 255.0, 0.95), 14, UiKit.INK, 3, UiKit.INK, 4, 1), padh, padv, padh, padv))
	var l := _disp(text, size, UiKit.WTEXT)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	b.add_child(l)
	return b

func _lbl_row(t: String) -> Label:
	return _body(t.to_upper(), 10 if phone else 11, UiKit.WMUTED, 800, 0.6)

func _weekly() -> String:
	var week := int(floor((Time.get_unix_time_from_system() / 86400.0 + 3.0) / 7.0))
	return MUTATORS[week % MUTATORS.size()]

# ---------------------------------------------------------------- build

func _build() -> void:
	for c in get_children():
		c.queue_free()
	_cards.clear()
	_maps.clear()
	_modes.clear()
	_measure()
	_built_for = Vector2(W, H)
	_page = Control.new()
	_page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.size = Vector2(W, H)
	_page.scale = Vector2(_k, _k)
	var th := Theme.new()
	th.default_font = _fb(800)
	_page.theme = th
	add_child(_page)
	var solid := ColorRect.new()      # no live arena behind (battery saver): the page background
	solid.color = Color("0b0d18")
	solid.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	solid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	solid.visible = Settings.saver
	_page.add_child(solid)
	var shade := ColorRect.new()      # #lobby.overlay
	shade.color = Color(8 / 255.0, 6 / 255.0, 18 / 255.0, 0.55)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.add_child(shade)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_page.add_child(scroll)
	var center := CenterContainer.new()
	center.custom_minimum_size = Vector2(W, H)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	scroll.add_child(center)
	var cw := minf(980.0 if phone else 900.0, W - (16.0 if phone else 48.0))
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UiKit.sbox(Color(0, 0, 0, 0), 18 if phone else 24, Color(0, 0, 0, 0), 0, Color(0, 0, 0, 0.35), 10, 1))
	card.custom_minimum_size.x = cw
	center.add_child(card)
	var clip := UiKit.clip_box(18 if phone else 24)
	clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color(38 / 255.0, 29 / 255.0, 72 / 255.0, 0.95)], [1.0, Color(18 / 255.0, 14 / 255.0, 34 / 255.0, 0.95)]])))
	card.add_child(clip)
	var border := Panel.new()
	var bs := UiKit.sbox(Color(0, 0, 0, 0), 18 if phone else 24, UiKit.INK, 3)
	bs.draw_center = false
	border.add_theme_stylebox_override("panel", bs)
	border.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(border)
	var mc := MarginContainer.new()
	mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mc.add_theme_constant_override("margin_left", 13 if phone else 23)
	mc.add_theme_constant_override("margin_right", 13 if phone else 23)
	mc.add_theme_constant_override("margin_top", 11 if phone else 19)
	mc.add_theme_constant_override("margin_bottom", 11 if phone else 19)
	card.add_child(mc)
	var col := _box(6 if phone else 10, true)
	mc.add_child(col)
	col.add_child(_head())
	if phone:
		var two := _box(10, false)
		col.add_child(two)
		var left := _box(6, true)
		left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		left.size_flags_stretch_ratio = 1.1
		var right := _box(4, true)
		right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		two.add_child(left)
		two.add_child(right)
		left.add_child(_room_head())
		left.add_child(_players())
		right.add_child(_lbl_row(I18n.t("lobby.yourBrawler")))
		right.add_child(_brawler_cards())
		right.add_child(_leader_rows())
		right.add_child(_start_row())
	else:
		col.add_child(_room_head())
		col.add_child(_players())
		col.add_child(_lbl_row(I18n.t("lobby.yourBrawler")))
		col.add_child(_brawler_cards())
		col.add_child(_leader_rows())
		col.add_child(_start_row())
	_info = _body("", 12 if phone else 14, Color("ffb3b3"), 800)
	_info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_info)
	_report_dialog = _build_report()
	_page.add_child(_report_dialog)
	_toast = _disp("", 18, UiKit.YELLOW)
	_toast.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color(0, 0, 0, 0.75), 12), 16, 10, 16, 10))
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.size = Vector2(minf(560, W - 40), 0)
	_toast.position = Vector2((W - _toast.size.x) / 2.0, H - 90)
	_toast.visible = false
	_page.add_child(_toast)
	_mark_pick()

func _head() -> Control:
	var h := _box(12, false)
	var bd := 34.0 if phone else 44.0
	var back := MenuTap.new(UiKit.sbox(Color(1, 1, 1, 0.08), 10 if phone else 14, UiKit.INK, 3, UiKit.INK, 4, 1),
		UiKit.sbox(Color(1, 1, 1, 0.16), 10 if phone else 14, UiKit.INK, 3, UiKit.INK, 4, 1))
	back.custom_minimum_size = Vector2(bd, bd)
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	back.add_child(_center(_disp("←", 18 if phone else 24)))
	back.pressed.connect(func(): leave.emit())
	h.add_child(back)
	var t := _disp(I18n.t("lobby.title"), 24 if phone else 44, Color.WHITE, 8)
	t.add_theme_color_override("font_shadow_color", UiKit.INK)
	t.add_theme_constant_override("shadow_offset_x", 0)
	t.add_theme_constant_override("shadow_offset_y", 5)
	t.add_theme_constant_override("shadow_outline_size", 8)
	t.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	h.add_child(t)
	return h

# ROOM CODE ABCD .......... [Copy code]
func _room_head() -> Control:
	var p := _panel(UiKit.pads(UiKit.sbox(Color(30 / 255.0, 26 / 255.0, 48 / 255.0, 0.9), 14, UiKit.INK, 3), 13 if phone else 17, 7 if phone else 13, 13 if phone else 17, 7 if phone else 13))
	var h := _box(10, false)
	p.add_child(h)
	var v := _box(-4, true)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(_body(I18n.t("lobby.roomCode"), 11, UiKit.WMUTED, 800))
	_code = _disp("----", 24 if phone else 34, UiKit.YELLOW, 0, 4 if phone else 6)
	v.add_child(_code)
	h.add_child(v)
	var copy := _ghost(I18n.t("g.copyCode"), 14)
	copy.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	copy.pressed.connect(func():
		DisplayServer.clipboard_set(_code.text)
		toast(I18n.t("g.codeCopied")))
	h.add_child(copy)
	return p

func _players() -> Control:
	_list = GridContainer.new()
	_list.columns = 1 if (phone or W <= 900) else (4 if H <= 780 else 2)   # short screens: 2 rows of 4 so START stays in view
	_list.add_theme_constant_override("h_separation", 6)
	_list.add_theme_constant_override("v_separation", 4 if phone else 6)
	_list.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return _list

func _brawler_cards() -> Control:
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 4 if phone else 8)
	flow.add_theme_constant_override("v_separation", 4 if phone else 8)
	flow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for k in GameData.brawlers:
		var key := String(k)
		var b := MenuTap.new(StyleBoxEmpty.new())
		var h := _box(6, false)
		var img := TextureRect.new()
		img.texture = UiKit.portrait(key)
		img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		var d := 24.0 if phone else 34.0
		img.custom_minimum_size = Vector2(d, d)
		h.add_child(img)
		var nm := _disp(String(GameData.brawlers[key].name), 12 if phone else 15)
		nm.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		h.add_child(nm)
		b.add_child(h)
		b.pressed.connect(func():
			Settings.brawler = key
			Settings.save()
			_mark_pick()
			brawler_picked.emit(key))
		flow.add_child(b)
		_cards[key] = b
	return flow

func _mark_pick() -> void:
	for k in _cards:
		var on: bool = k == Settings.brawler
		var p := Vector4(2, 2, 8, 2) if phone else Vector4(7, 7, 15, 7)
		var s := UiKit.pads(UiKit.sbox(Color(30 / 255.0, 26 / 255.0, 48 / 255.0, 0.9), 12, UiKit.YELLOW if on else UiKit.INK, 3), p.x, p.y, p.z, p.w)
		var hs := UiKit.pads(UiKit.sbox(Color(58 / 255.0, 48 / 255.0, 96 / 255.0, 0.95), 12, UiKit.YELLOW if on else UiKit.INK, 3), p.x, p.y, p.z, p.w)
		(_cards[k] as MenuTap).set_styles(s, hs)

# Mode: [SHOWDOWN][DUO]   Map ......... [Weekly Chaos]   [map tiles]
func _leader_rows() -> Control:
	var v := _box(4 if phone else 6, true)
	_mode_row = _box(8, false)
	_mode_row.add_child(_lbl_row(I18n.t("menu.modeLbl")))
	for m in ["solo", "duo"]:
		var b := MenuTap.new(StyleBoxEmpty.new())
		var l := _disp(I18n.t("menu.mode") if m == "solo" else I18n.t("menu.duo"), 12)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		b.add_child(l)
		b.pressed.connect(func(): if is_leader and not matchmade: mode_picked.emit(m))
		_mode_row.add_child(b)
		_modes[m] = [b, l]
	var mm := MarginContainer.new()
	mm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mm.add_theme_constant_override("margin_top", 4 if phone else 14)
	mm.add_child(_mode_row)
	v.add_child(mm)
	_map_box = _box(4 if phone else 6, true)
	var mrow := _box(8, false)
	var ml := _lbl_row(I18n.t("menu.map"))
	ml.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ml.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	mrow.add_child(ml)
	_chaos = MenuTap.new(StyleBoxEmpty.new())
	_chaos.pressed.connect(func(): if is_leader and not matchmade: chaos_toggled.emit(not bool(_last.get("chaos", false))))
	mrow.add_child(_chaos)
	_map_box.add_child(mrow)
	var grid := GridContainer.new()
	grid.columns = 7 if (phone or W > 900) else 4
	grid.add_theme_constant_override("h_separation", 5 if phone else 6)
	grid.add_theme_constant_override("v_separation", 5 if phone else 6)
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_map_box.add_child(grid)
	var keys: Array = ["random"] + GameData.maps.keys()
	for key in keys:
		grid.add_child(_map_tile(String(key)))
	v.add_child(_map_box)
	_refresh_leader({})
	return v

# The web's room map chips: the map art, its name and weather icon, an ink border.
func _map_tile(key: String) -> Control:
	var t := MenuTap.new(StyleBoxEmpty.new())
	t.custom_minimum_size = Vector2(0, 42 if phone else 72)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var clip := UiKit.clip_box(10 if phone else 12)
	t.add_child(clip)
	if key == "random":
		clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color("6a5acd")], [1.0, Color("2b2244")]], Vector2(0, 0), Vector2(1, 1))))
	else:
		var sw: Array = GameData.maps[key].get("swatch", ["#555", "#333"])
		clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color(String(sw[0]))], [1.0, Color(String(sw[1]))]], Vector2(0, 0), Vector2(1, 1))))
		var img := TextureRect.new()
		var path := "res://assets/ui/map_%s.jpg" % key
		img.texture = load(path) as Texture2D if ResourceLoader.exists(path) else null
		img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		img.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		img.mouse_filter = Control.MOUSE_FILTER_IGNORE
		clip.add_child(img)
		clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color(0, 0, 0, 0)], [0.35, Color(0, 0, 0, 0)], [1.0, Color(0, 0, 0, 0.6)]])))
	var border := Panel.new()
	var bs := UiKit.sbox(Color(0, 0, 0, 0), 10 if phone else 12, UiKit.INK, 2 if phone else 3)
	bs.draw_center = false
	border.add_theme_stylebox_override("panel", bs)
	border.mouse_filter = Control.MOUSE_FILTER_IGNORE
	t.add_child(border)
	var on := Panel.new()
	on.name = "On"
	var os := UiKit.sbox(Color(0, 0, 0, 0), 14, UiKit.YELLOW, 3)
	os.draw_center = false
	for side in [SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM]:
		os.set_expand_margin(side, 3)
	on.add_theme_stylebox_override("panel", os)
	on.mouse_filter = Control.MOUSE_FILTER_IGNORE
	on.visible = false
	t.add_child(on)
	var mc := MarginContainer.new()
	mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mc.add_theme_constant_override("margin_left", 7)
	mc.add_theme_constant_override("margin_right", 5)
	mc.add_theme_constant_override("margin_bottom", 4)
	var v := _box(0, true)
	v.alignment = BoxContainer.ALIGNMENT_END
	var nm := _disp(I18n.t("map." + key), 11 if phone else 13, Color.WHITE, 5)
	nm.clip_text = true
	v.add_child(nm)
	if not phone:
		var tag := _body(I18n.t("map.%s.tag" % key), 9, Color.WHITE)
		tag.clip_text = true
		tag.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		v.add_child(tag)
	mc.add_child(v)
	t.add_child(mc)
	var icon: String = "🎲" if key == "random" else MAP_ICON.get(String(GameData.maps[key].get("weather", "clear")), "")
	var ic := UiKit.text(icon, 12 if phone else 16, Color.WHITE)
	ic.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	var icm := MarginContainer.new()
	icm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	icm.add_theme_constant_override("margin_right", 6)
	icm.add_theme_constant_override("margin_top", 3)
	icm.add_child(ic)
	t.add_child(icm)
	t.pressed.connect(func(): if is_leader and not matchmade: map_picked.emit(key))
	_maps[key] = t
	return t

func _start_row() -> Control:
	var h := _box(12, false)
	_start = _big(I18n.t("lobby.start"), 20 if phone else 30, 6 if phone else 12, 24 if phone else 44)
	_start.pressed.connect(func(): start.emit())
	var sm := MarginContainer.new()
	sm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sm.add_theme_constant_override("margin_top", 4 if phone else 14)
	sm.add_theme_constant_override("margin_bottom", 6)
	sm.add_child(_start)
	h.add_child(sm)
	return h

func _refresh_leader(m: Dictionary) -> void:
	var mode := String(m.get("mode", "solo"))
	for k in _modes:
		var on: bool = k == mode
		var bg := (UiKit.TEAL if k == "duo" else UiKit.YELLOW) if on else Color(1, 1, 1, 0.08)
		var bc := (UiKit.TEAL if k == "duo" else UiKit.YELLOW) if on else Color(1, 1, 1, 0.14)
		(_modes[k][0] as MenuTap).set_styles(UiKit.pads(UiKit.sbox(bg, 8, bc, 1), 11, 5, 11, 5))
		var fg := (Color.WHITE if k == "duo" else UiKit.INK) if on else UiKit.WMUTED
		(_modes[k][1] as Label).add_theme_color_override("font_color", fg)
	var map := String(m.get("map", "random"))
	for k in _maps:
		(_maps[k] as Control).get_node("On").visible = k == map
		(_maps[k] as Control).modulate = Color.WHITE if (is_leader or k == map) else Color(0.62, 0.62, 0.66)
	# Weekly Chaos chip (meta.css .chaos-chip)
	for c in _chaos.get_children():
		c.queue_free()
	var on := bool(m.get("chaos", false))
	_chaos.set_styles(UiKit.pads(UiKit.sbox(Color(1, 0.42, 0.85, 0.3) if on else Color(1, 1, 1, 0.06), 10, Color("ff6bd8") if on else UiKit.INK, 2), 12, 5, 12, 5))
	var h := _box(4, false)
	var mut := _weekly()
	h.add_child(_body("🌀 %s:" % I18n.t("chaos.name"), 11 if phone else 12, Color.WHITE if on else UiKit.WMUTED, 800))
	h.add_child(_body("%s %s" % [MUT_ICONS[mut], I18n.t("mut." + mut)], 11 if phone else 12, UiKit.WTEXT, 900))
	var st := _body(I18n.t("chaos.on") if on else I18n.t("chaos.off"), 11 if phone else 12, UiKit.INK if on else UiKit.WTEXT, 900)
	st.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color("ff4bd8") if on else Color(0, 0, 0, 0.35), 6), 6, 0, 6, 0))
	h.add_child(st)
	_chaos.add_child(h)

func _build_report() -> Control:
	var dim := Control.new()
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.visible = false
	var shade := ColorRect.new()
	shade.color = Color(8 / 255.0, 6 / 255.0, 18 / 255.0, 0.72)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim.add_child(shade)
	var c := CenterContainer.new()
	c.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim.add_child(c)
	var p := _panel(UiKit.pads(UiKit.sbox(Color(22 / 255.0, 18 / 255.0, 36 / 255.0, 0.96), 18, UiKit.INK, 3, UiKit.INK, 8, 1), 24, 18, 24, 22))
	p.custom_minimum_size.x = minf(420.0, W - 32.0)
	c.add_child(p)
	var v := _box(10, true)
	p.add_child(v)
	var t := _disp(I18n.t("mod.report"), 30, UiKit.YELLOW, 6)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	_report_name = _body("", 15, UiKit.WMUTED, 800)
	_report_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_report_name)
	for r in [["cheating", "mod.reasonCheat"], ["offensive name", "mod.reasonName"], ["bad behaviour", "mod.reasonOther"]]:
		var b := _ghost(I18n.t(String(r[1])), 18, 9)
		b.pressed.connect(func():
			dim.visible = false
			report.emit(_report_target, String(r[0]))
			toast(I18n.t("g.reportSent")))
		v.add_child(b)
	var cancel := _big(I18n.t("mm.cancel"), 20, 8)
	cancel.pressed.connect(func(): dim.visible = false)
	var cm := MarginContainer.new()
	cm.add_theme_constant_override("margin_top", 6)
	cm.add_theme_constant_override("margin_bottom", 6)
	cm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cm.add_child(cancel)
	v.add_child(cm)
	return dim

func toast(msg: String, secs: float = 3.0) -> void:
	_toast.text = msg
	_toast.size.y = 0
	_toast.visible = true
	_toast_t = secs

func _process(delta: float) -> void:
	if _toast_t > 0.0:
		_toast_t -= delta
		if _toast_t <= 0.0:
			_toast.visible = false

# ---------------------------------------------------------------- room state

# The server's {t:"room", players, inMatch, map, chaos, matchmade, mode, pq} message.
func show_room(code: String, m: Dictionary) -> void:
	_last = m
	_last_code = code
	var players: Array = m.get("players", [])
	matchmade = bool(m.get("matchmade", false))
	_code.text = code
	is_leader = false
	for p in players:
		if String((p as Dictionary).get("id", "")) == my_id and bool((p as Dictionary).get("host", false)):
			is_leader = true
	for c in _list.get_children():
		c.queue_free()
	for p in players:
		_list.add_child(_player_row(p as Dictionary))
	for i in range(players.size(), 8):
		var e := _panel(UiKit.pads(UiKit.sbox(Color(30 / 255.0, 26 / 255.0, 48 / 255.0, 0.9), 10, UiKit.INK, 2), 10 if phone else 12, 3 if phone else 6, 10 if phone else 12, 3 if phone else 6))
		e.modulate = Color(1, 1, 1, 0.4)
		e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var l := _body(I18n.t("lobby.bot"), 13 if phone else 16, UiKit.WTEXT, 700)
		l.custom_minimum_size.y = 22 if phone else 30
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		e.add_child(l)
		_list.add_child(e)
	_refresh_leader(m)
	_mode_row.visible = not matchmade
	_map_box.visible = not matchmade
	var in_match := bool(m.get("inMatch", false))
	_start.get_parent().visible = is_leader and not matchmade and not in_match
	if matchmade:
		_info.text = I18n.t("mm.matchmade")
	elif in_match:
		_info.text = I18n.t("lobby.inProgress")
	elif is_leader:
		_info.text = ""
	else:
		_info.text = I18n.t("lobby.waiting")
	_info.add_theme_color_override("font_color", UiKit.WMUTED if not in_match else Color("ffb3b3"))
	_info.visible = _info.text != ""
	_mark_pick()

func _player_row(p: Dictionary) -> Control:
	var id := String(p.get("id", ""))
	var me := id == my_id
	var row := _panel(UiKit.pads(UiKit.sbox(Color(30 / 255.0, 26 / 255.0, 48 / 255.0, 0.9), 10, UiKit.INK, 2), 10 if phone else 12, 3 if phone else 6, 10 if phone else 12, 3 if phone else 6))
	row.mouse_filter = Control.MOUSE_FILTER_PASS
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var h := _box(8, false)
	row.add_child(h)
	var key := String(p.get("brawler", "blaster")).split(":")[0]
	var d := 26.0 if phone else 34.0
	var pf := UiKit.clip_box(9)
	pf.custom_minimum_size = Vector2(d, d)
	var bg := ColorRect.new()
	bg.color = Color(1, 1, 1, 0.08)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pf.add_child(bg)
	var img := TextureRect.new()
	img.texture = UiKit.portrait(key)
	img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	img.position = Vector2(-d * 0.1, 0)
	img.size = Vector2(d * 1.2, d * 1.2)
	img.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pf.add_child(img)
	h.add_child(pf)
	var nm := String(p.get("name", "?"))
	if me:
		nm = I18n.t("lobby.you", {"name": nm})
	var plat := String(p.get("plat", ""))
	if PLAT_ICON.has(plat):
		nm = PLAT_ICON[plat] + " " + nm
	var nl := _body(nm, 13 if phone else 16, Color("39c6ff") if me else UiKit.WTEXT, 800)
	nl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	nl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	nl.clip_text = true
	nl.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	h.add_child(nl)
	if bool(p.get("host", false)):
		var tag := _disp(I18n.t("lobby.host"), 12, UiKit.YELLOW)
		tag.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		h.add_child(tag)
	if not me:
		var act := func(txt: String, hover: Color) -> MenuTap:
			var b := MenuTap.new(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.08), 8, UiKit.INK, 2), 6, 4, 6, 4), UiKit.pads(UiKit.sbox(hover, 8, UiKit.INK, 2), 6, 4, 6, 4))
			b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			var l := _body(txt, 13, UiKit.WTEXT, 800)
			l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			b.add_child(l)
			return b
		var rb: MenuTap = act.call("⚑", Color(1, 1, 1, 0.2))
		rb.tooltip_text = I18n.t("mod.report")
		rb.pressed.connect(func():
			_report_target = id
			_report_name.text = String(p.get("name", "?"))
			_report_dialog.visible = true)
		h.add_child(rb)
		if is_leader and not matchmade:
			var kb: MenuTap = act.call("✕", Color("bb3333"))
			kb.tooltip_text = I18n.t("mod.kick")
			kb.pressed.connect(func(): kick.emit(id))
			h.add_child(kb)
	return row
