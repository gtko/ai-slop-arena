class_name MainMenu
extends Control
# The home screen, a copy of the web build's menu (play.html #menu, src/home.css): top navigation
# (logo, PLAY / COLLECTION / SHOP / QUESTS / TROPHY ROAD, currencies, level, options), the live arena
# behind (main.gd draws the picked map with your brawler on show), your brawler's name, mastery and
# loadout on the left, skins + roster at the bottom, quests and the PLAY panel on the right (mode, map,
# Weekly Chaos, ONLINE, SOLO, TRAINING). Overlays: online (find a match / rooms), queue, options,
# and the pages of the other tabs.
# Everything is laid out in CSS pixels (UiKit.css_scale) so the sizes and breakpoints are the web's.
# main.gd listens to the signals and owns the connections; this class only shows and edits Settings.

const MenuTap := preload("res://scripts/menu_tap.gd")
const MenuW := preload("res://scripts/menu_widgets.gd")

signal quick_play
signal create_room
signal join_room(code: String)
signal solo_play                 # SOLO: a room with bots that starts at once
signal training                  # TRAINING: a private room (no dojo in this client)
signal queue_bots
signal queue_cancel
signal settings_changed          # language / graphics / saver / volumes / server changed
signal profile_changed           # brawler, loadout, nickname or looks changed (a room learns it via "pick")
signal showcase_changed          # brawler or map changed: the arena behind the menu follows

# Star power ids of each brawler (src/gadgets.js STARS): index 0 = star 1, index 1 = star 2.
const STAR_IDS := {
	"blaster": ["sapRegen", "splinters"], "gunslinger": ["steadyAim", "axoRegen"], "bomber": ["magmaPuddle", "bigBang"],
	"frostbite": ["deepFreeze", "permafrost"], "volt": ["conductor", "surge"], "kappa": ["hydrotherapy", "undertow"],
	"pipchomp": ["huntersNose", "hungry"], "mochi": ["heavyweight", "secondHelping"]}
const GADGET_ICONS := {"blasterA": "🐏", "blasterB": "🪵", "gunslingerA": "🌀", "gunslingerB": "🎆", "bomberA": "🦘", "bomberB": "🧨",
	"frostbiteA": "⛸️", "frostbiteB": "🧊", "voltA": "⚡", "voltB": "🔋", "kappaA": "🤿", "kappaB": "🥣",
	"pipchompA": "🍖", "pipchompB": "🍄", "mochiA": "🛷", "mochiB": "🍡"}
const STAR_ICONS := ["⭐", "🌟"]
const MAP_ICON := {"clear": "☀️", "sandstorm": "🌪️", "rain": "🌧️", "snow": "❄️", "fog": "🌫️"}
const QUEST_ICONS := {"play": "🎮", "top4": "🏅", "win": "🏆", "kos": "💀", "dmg": "💥", "cubes": "💎", "gadgets": "🧰",
	"supers": "🌟", "crates": "📦", "brawler": "🎭", "emotes": "💬"}
const DAILY := {"play": [3, 4], "top4": [2, 3], "win": [1, 1], "kos": [6, 10], "dmg": [12000, 20000], "cubes": [8, 14],
	"gadgets": [5, 8], "supers": [4, 6], "crates": [6, 10], "brawler": [2, 3], "emotes": [3, 3]}
const MUTATORS := ["cubeRain", "nightHunt", "gasBreath", "superRush", "gadgetFrenzy"]
const MUT_ICONS := {"cubeRain": "💎", "nightHunt": "🌙", "gasBreath": "☠️", "superRush": "🌟", "gadgetFrenzy": "🧰"}
const SKINS := ["default", "candy", "shadow", "gold"]
const MASTERY_LEVELS := [0, 30, 80, 150, 250, 380, 540, 740, 980, 1260]
const TABS := [["play", "⚔️", "nav.play"], ["collection", "👕", "meta.collection"], ["shop", "🛒", "meta.shop"],
	["quests", "📜", "meta.quests"], ["road", "🏆", "meta.road"]]

var profile: Profile
var MAP_ORDER: Array = ["random"] + GameData.maps.keys()

# layout (CSS px)
var _k := 1.0
var W := 1280.0
var H := 720.0
var phone := false
var touch := false
var _nav := 64.0
var _g := 32.0
var _ins := Vector4.ZERO          # safe-area insets (left, top, right, bottom), CSS px
var _built_for := Vector2.ZERO
var _page: Control
var _home: Control

# home widgets
var _hero: VBoxContainer
var _role: Label
var _name: Label
var _desc: Label
var _stats: GridContainer
var _loadout: PanelContainer
var _fit := 0
var _picker: VBoxContainer
var _play_col: VBoxContainer
var _skin_track: HBoxContainer
var _skin_count: Label
var _skin_row: Control
var _roster_tiles: Dictionary = {}
var _mode_btns: Dictionary = {}
var _map_btn: Control
var _maps_pop: Control
var _map_tiles: Dictionary = {}
var _chaos_btn: Control
var _tabs: Dictionary = {}
var _page_view: Control
var _speaker: MenuW.Speaker
var _muted := false
var _toast: Label
var _toast_t := 0.0
# overlays
var _settings: Control
var _room_dialog: Control         # the online panel (find a match, create / join a room)
var _nick: LineEdit
var _code_edit: LineEdit
var _queue: Control
var _q_mode: Label
var _q_count: Label
var _q_fill: Panel
var _q_meta: Label
var _q_plats: Label

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	if not GameData.brawlers.has(Settings.brawler):
		Settings.brawler = GameData.brawlers.keys()[0]
	if not MAP_ORDER.has(Settings.map):
		Settings.map = "random"
	get_viewport().size_changed.connect(_on_resize)
	build()

func _on_resize() -> void:
	if is_inside_tree():
		call_deferred("_rebuild_if_needed")

func _rebuild_if_needed() -> void:
	_measure()
	if Vector2(W, H) != _built_for:
		var open := [_settings.visible, _room_dialog.visible, _queue.visible]
		build()
		_settings.visible = open[0]
		_room_dialog.visible = open[1]
		_queue.visible = open[2]

func _measure() -> void:
	_k = UiKit.css_scale(get_viewport())
	var vs := get_viewport().get_visible_rect().size
	W = vs.x / _k
	H = vs.y / _k
	phone = H <= 520.0 and W > H
	touch = DisplayServer.is_touchscreen_available()
	_nav = 44.0 if phone else 64.0
	_ins = Vector4.ZERO
	if OS.get_name() == "Android" or OS.get_name() == "iOS":
		var s := UiKit.safe_insets(get_viewport())
		_ins = Vector4(maxf(s.x - 16, 0), maxf(s.y - 12, 0), maxf(s.z - 16, 0), maxf(s.w - 12, 0)) / _k
	_g = (12.0 + _ins.x) if phone else 32.0

# (Re)builds every control; called again when the language or the screen size changes.
func build() -> void:
	for c in get_children():
		c.queue_free()
	_roster_tiles.clear()
	_mode_btns.clear()
	_map_tiles.clear()
	_tabs.clear()
	_fit = 0
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
	_home = Control.new()           # the home itself, hidden under the online / queue panels (like #menu)
	_home.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_home.size = Vector2(W, H)
	_build_backdrop()
	_page.add_child(_home)
	_build_hero()
	_build_picker()
	_build_play_panel()
	_page_view = _build_page_view()
	_home.add_child(_page_view)
	_build_topnav()
	_toast = UiKit.text("", 18, UiKit.YELLOW, _fd())
	_toast.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color(0, 0, 0, 0.75), 12), 16, 10, 16, 10))
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_toast.size = Vector2(minf(560, W - 40), 0)
	_toast.position = Vector2((W - _toast.size.x) / 2.0, H * 0.42)
	_toast.visible = false
	_page.add_child(_toast)
	_room_dialog = _build_online()
	_page.add_child(_room_dialog)
	_queue = _build_queue()
	_page.add_child(_queue)
	_settings = _build_settings()
	_page.add_child(_settings)
	for o in [_room_dialog, _queue]:
		(o as Control).visibility_changed.connect(func(): _home.visible = not (_room_dialog.visible or _queue.visible))
	_select_brawler(Settings.brawler, false)
	_refresh_mode()
	_refresh_map()
	if _page_key != "play":
		_open_page(_page_key)
	call_deferred("_fit_hero")

# ---------------------------------------------------------------- small helpers

# Anchors c to a corner of the page: h "l"/"r", v "t"/"b", x / y the CSS offsets from that corner.
func _corner(c: Control, h: String, v: String, x: float, y: float) -> void:
	c.anchor_left = 1.0 if h == "r" else 0.0
	c.anchor_right = c.anchor_left
	c.anchor_top = 1.0 if v == "b" else 0.0
	c.anchor_bottom = c.anchor_top
	c.grow_horizontal = Control.GROW_DIRECTION_BEGIN if h == "r" else Control.GROW_DIRECTION_END
	c.grow_vertical = Control.GROW_DIRECTION_BEGIN if v == "b" else Control.GROW_DIRECTION_END
	if h == "r":
		c.offset_right = -x
		c.offset_left = -x
	else:
		c.offset_left = x
		c.offset_right = x
	if v == "b":
		c.offset_bottom = -y
		c.offset_top = -y
	else:
		c.offset_top = y
		c.offset_bottom = y

func _hbox(sep: float) -> HBoxContainer:
	var b := HBoxContainer.new()
	b.add_theme_constant_override("separation", int(sep))
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b

func _vbox(sep: float) -> VBoxContainer:
	var b := VBoxContainer.new()
	b.add_theme_constant_override("separation", int(sep))
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b

func _panel(s: StyleBox) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", s)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p

# A clickable box (like a <button> with HTML inside): a PanelContainer that emits pressed.
func _tap(normal: StyleBox, hover: StyleBox = null) -> MenuTap:
	return MenuTap.new(normal, hover if hover else normal)

# The web fonts, rasterised for this page's scale: the page is a scaled node, which Godot's font
# oversampling ignores, so the menu has its own copies with the right oversampling (sharp on phones).
static var _font_cache: Dictionary = {}

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

func _emoji(t: String, size: int) -> Label:
	var l := UiKit.text(t, size, Color.WHITE)
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	return l

func _disp(t: String, size: int, color: Color = Color.WHITE, stroke: int = 0, spacing: float = 0.0) -> Label:
	return UiKit.text(t, size, color, _fd(), stroke, spacing)

func _body(t: String, size: int, color: Color = UiKit.WTEXT, weight: int = 800, spacing: float = 0.0) -> Label:
	return UiKit.text(t, size, color, _fb(weight), 0, spacing)

func _shadowed(l: Label, y: float, a: float = 0.8) -> Label:
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, a * 0.5))
	l.add_theme_constant_override("shadow_offset_x", 0)
	l.add_theme_constant_override("shadow_offset_y", int(y))
	l.add_theme_constant_override("shadow_outline_size", 2)
	return l

func _portrait_rect(key: String, h: float, box_w: float, box_h: float, bottom: float, mat: Material = null) -> TextureRect:
	var tr := TextureRect.new()
	tr.texture = UiKit.portrait(key)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var asp := 1.0
	if tr.texture:
		asp = float(tr.texture.get_width()) / maxf(float(tr.texture.get_height()), 1.0)
	var w := h * asp
	tr.position = Vector2((box_w - w) / 2.0, box_h - h - bottom)
	tr.size = Vector2(w, h)
	if mat:
		tr.material = mat
	return tr

static var _cos: Dictionary = {}

func _skin_rec(key: String, skin: String) -> Array:
	if _cos.is_empty():
		var f := FileAccess.open("res://data/cosmetics.json", FileAccess.READ)
		var v: Variant = JSON.parse_string(f.get_as_text()) if f else null
		_cos = v if v is Dictionary else {"recolours": {}}
	var rec: Dictionary = (_cos.get("recolours", {}) as Dictionary).get(key, {})
	return rec.get(skin, [])

func _color(key: String) -> Color:
	return GameData.color_of(GameData.brawlers[key].palette.main)

func _weekly() -> String:
	var week := int(floor((Time.get_unix_time_from_system() / 86400.0 + 3.0) / 7.0))
	return MUTATORS[week % MUTATORS.size()]

# The day's three quests, picked from the date like the web's board (progress is not tracked here).
func _quests() -> Array:
	var d := Time.get_date_dict_from_system()
	var rng := RandomNumberGenerator.new()
	rng.seed = hash("%d-%d-%d" % [d.year, d.month, d.day])
	var kinds: Array = DAILY.keys()
	var out: Array = []
	for i in 3:
		var kind: String = kinds.pop_at(rng.randi() % kinds.size())
		var r: Array = DAILY[kind]
		var step := 1000 if kind == "dmg" else 1
		var n := int(round((r[0] + rng.randf() * (r[1] - r[0])) / step)) * step
		var q := {"kind": kind, "target": n, "n": 0}
		if kind == "brawler":
			q["brawler"] = String(GameData.brawlers[GameData.brawlers.keys()[rng.randi() % GameData.brawlers.size()]].name)
		out.append(q)
	return out

func _quest_text(q: Dictionary) -> String:
	return I18n.t("quest." + String(q.kind), {"n": q.target, "brawler": q.get("brawler", "")})

func _num(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.right(3) + out
		s = s.left(s.length() - 3)
	return ("-" if n < 0 else "") + s + out

# ---------------------------------------------------------------- backdrop (the arena darkened at the edges)

func _build_backdrop() -> void:
	var solid := ColorRect.new()     # only when there is no 3D behind (battery saver)
	solid.name = "Solid"
	solid.color = Color("0b0d18")
	solid.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	solid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	solid.visible = Settings.saver
	_page.add_child(solid)
	var n := Color(10 / 255.0, 8 / 255.0, 22 / 255.0)
	var a := func(x: float) -> Color: return Color(n, x)
	_home.add_child(UiKit.grad_rect(UiKit.grad([[0.0, a.call(0.88)], [0.22, a.call(0.55)], [0.38, a.call(0.0)], [0.64, a.call(0.0)], [0.82, a.call(0.85)], [1.0, a.call(0.85)]], Vector2(0, 0), Vector2(1, 0))))
	_home.add_child(UiKit.grad_rect(UiKit.grad([[0.0, a.call(0.85)], [0.30, a.call(0.0)], [1.0, a.call(0.0)]], Vector2(0, 1), Vector2(0, 0))))
	_home.add_child(UiKit.grad_rect(UiKit.grad([[0.0, a.call(0.0)], [0.40, a.call(0.0)], [1.0, a.call(0.35)]], Vector2(0.5, 0.55), Vector2(0.95, 0.55), true)))

# ---------------------------------------------------------------- top navigation

func _build_topnav() -> void:
	var bar := Control.new()
	bar.mouse_filter = Control.MOUSE_FILTER_STOP
	bar.position = Vector2.ZERO
	bar.size = Vector2(W, _nav)
	_home.add_child(bar)
	var shade := UiKit.grad_rect(UiKit.grad([[0.0, Color(0, 0, 0, 0.35)], [1.0, Color(0, 0, 0, 0)]]))
	shade.set_anchors_preset(Control.PRESET_TOP_LEFT)
	shade.position = Vector2(0, _nav)
	shade.size = Vector2(W, 24)
	bar.add_child(shade)
	bar.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color(UiKit.NIGHT, 0.97)], [1.0, Color(UiKit.NIGHT, 0.88)]])))
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.08)
	line.position = Vector2(0, _nav - 1)
	line.size = Vector2(W, 1)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.add_child(line)
	var glow := UiKit.grad_rect(UiKit.grad([[0.0, Color(UiKit.YELLOW, 0)], [0.5, Color(UiKit.YELLOW, 0.5)], [1.0, Color(UiKit.YELLOW, 0)]], Vector2(0, 0), Vector2(1, 0)))
	glow.set_anchors_preset(Control.PRESET_TOP_LEFT)
	glow.position = Vector2(0, _nav)
	glow.size = Vector2(W, 1)
	bar.add_child(glow)
	# the sound button, left in every language
	var snd := _tap(UiKit.sbox(Color(18 / 255.0, 16 / 255.0, 30 / 255.0, 0.82), 12, UiKit.INK, 2, Color(0, 0, 0, 0.4), 3),
		UiKit.sbox(Color(58 / 255.0, 48 / 255.0, 96 / 255.0, 0.95), 12, UiKit.INK, 2, Color(0, 0, 0, 0.4), 3))
	snd.custom_minimum_size = Vector2(44, 44)
	var cc := CenterContainer.new()
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_speaker = MenuW.Speaker.new()
	_speaker.muted = _muted
	cc.add_child(_speaker)
	snd.add_child(cc)
	snd.position = Vector2(12 + _ins.x, 4.0 if phone else 10.0)
	snd.size = Vector2(44, 44)
	snd.pressed.connect(func():
		_muted = not _muted
		AudioServer.set_bus_mute(0, _muted)
		_speaker.muted = _muted
		_speaker.queue_redraw())
	bar.add_child(snd)
	var row := _hbox(8 if phone else 18)
	row.position = Vector2((56.0 + _ins.x) if phone else 68.0, 0)
	row.size = Vector2(W - row.position.x - ((8.0 + _ins.z) if phone else 16.0), _nav)
	bar.add_child(row)
	if not phone:
		var logo := _vbox(-6)
		logo.alignment = BoxContainer.ALIGNMENT_CENTER
		var l1 := _disp("AI SLOP", 22, UiKit.YELLOW, 6)
		var l2 := _disp("ARENA", 17, Color.WHITE, 6, 2)
		logo.add_child(l1)
		logo.add_child(l2)
		row.add_child(logo)
	# tabs
	var tabs := _hbox(2)
	if not phone:
		var m := Control.new()
		m.custom_minimum_size.x = 8
		m.mouse_filter = Control.MOUSE_FILTER_IGNORE
		tabs.add_child(m)
	var labels := not phone and W >= 1100
	var tab_font := 16 if W >= 1450 else 14
	var icon_size := 18 if phone else (20 if not labels else (17 if W >= 1450 else 16))
	var padx := 10.0 if phone else (16.0 if W >= 1450 else (11.0 if labels else 14.0))
	for t in TABS:
		var key: String = t[0]
		var b := _tap(StyleBoxEmpty.new())
		b.custom_minimum_size.y = _nav
		var inner := _hbox(7)
		inner.alignment = BoxContainer.ALIGNMENT_CENTER
		var mc := MarginContainer.new()
		mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
		mc.add_theme_constant_override("margin_left", int(padx))
		mc.add_theme_constant_override("margin_right", int(padx))
		mc.add_child(inner)
		b.add_child(mc)
		var ic := _emoji(String(t[1]), icon_size)
		inner.add_child(ic)
		var lb := _disp(I18n.t(String(t[2])), tab_font, UiKit.WMUTED, 0, 0.6)
		lb.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		lb.visible = labels
		inner.add_child(lb)
		var under := Panel.new()
		var us := UiKit.sbox(UiKit.YELLOW, 0)
		us.corner_radius_top_left = 3
		us.corner_radius_top_right = 3
		under.add_theme_stylebox_override("panel", us)
		under.mouse_filter = Control.MOUSE_FILTER_IGNORE
		under.anchor_top = 1.0
		under.anchor_bottom = 1.0
		under.anchor_right = 1.0
		under.offset_left = 14
		under.offset_right = -14
		under.offset_top = -3
		under.size_flags_vertical = Control.SIZE_SHRINK_END
		var holder := Control.new()
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(under)
		b.add_child(holder)
		b.pressed.connect(func(): _open_page(key))
		b.mouse_entered.connect(func(): lb.add_theme_color_override("font_color", Color.WHITE))
		b.mouse_exited.connect(func(): _refresh_tabs())
		tabs.add_child(b)
		_tabs[key] = [b, lb, ic, under]
	row.add_child(tabs)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(sp)
	var right := _hbox(10)
	right.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_child(right)
	var chip := func(icon: Control, txt: String, col: Color) -> Control:
		var p := _panel(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.06), 17, Color(1, 1, 1, 0.1), 1), 9 if phone else 13, 0, 9 if phone else 13, 0))
		p.custom_minimum_size.y = 28 if phone else 34
		p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var h := _hbox(4)
		h.alignment = BoxContainer.ALIGNMENT_CENTER
		if icon:
			var c := CenterContainer.new()
			c.mouse_filter = Control.MOUSE_FILTER_IGNORE
			c.add_child(icon)
			h.add_child(c)
		var l := _disp(txt, 13 if phone else 16, col)
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		h.add_child(l)
		p.add_child(h)
		return p
	var fs := 13.0 if phone else 16.0
	right.add_child(chip.call(MenuW.Coin.new(fs), "0", Color("ffe27a")))
	if not phone:
		right.add_child(chip.call(MenuW.Gem.new(fs * 0.95), "0", Color("e6c4ff")))
	right.add_child(chip.call(null, "🏆 0", UiKit.WTEXT))
	# me: level ring + portrait, "Level 1" / title
	var me := _tap(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.05), 26, Color(1, 1, 1, 0.1), 1), 4 if not phone else 3, 4 if not phone else 3, 13 if not phone else 3, 4 if not phone else 3),
		UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.1), 26, Color(1, 1, 1, 0.1), 1), 4 if not phone else 3, 4 if not phone else 3, 13 if not phone else 3, 4 if not phone else 3))
	me.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var mh := _hbox(10)
	me.add_child(mh)
	var rd := 34.0 if phone else 46.0
	var ring := MenuW.Ring.new()
	ring.custom_minimum_size = Vector2(rd, rd)
	ring.frac = 0.0
	var pf_d := 28.0 if phone else 38.0
	var pf := UiKit.clip_box(int(pf_d / 2), Vector2(pf_d, pf_d))
	pf.position = Vector2((rd - pf_d) / 2.0, (rd - pf_d) / 2.0)
	pf.size = Vector2(pf_d, pf_d)
	var pf_bg := ColorRect.new()
	pf_bg.color = Color("2b2540")
	pf_bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	pf_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pf.add_child(pf_bg)
	var icon_key: String = ["blaster", "gunslinger", "bomber", "frostbite", "volt"][clampi(Settings.icon, 0, 4)]
	var pimg := _portrait_rect(icon_key, pf_d * 1.18, pf_d, pf_d, -pf_d * 0.3)
	pf.add_child(pimg)
	ring.add_child(pf)
	var pf_rim := Panel.new()
	var rim := UiKit.sbox(Color(0, 0, 0, 0), int(pf_d / 2), UiKit.INK, 2)
	rim.draw_center = false
	pf_rim.add_theme_stylebox_override("panel", rim)
	pf_rim.position = pf.position
	pf_rim.size = pf.size
	pf_rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ring.add_child(pf_rim)
	var lvl := _disp("1", 10 if phone else 12, Color.WHITE)
	lvl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lvl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lvl.add_theme_stylebox_override("normal", UiKit.sbox(UiKit.VIOLET, 10, UiKit.INK, 2))
	var bd := 16.0 if phone else 20.0
	lvl.position = Vector2(rd - bd + 4, rd - bd + 4)
	lvl.size = Vector2(bd, bd)
	ring.add_child(lvl)
	mh.add_child(ring)
	if not phone and W >= 1250:
		var who := _vbox(0)
		who.alignment = BoxContainer.ALIGNMENT_CENTER
		who.add_child(_disp(I18n.t("meta.level", {"n": 1}), 15))
		who.add_child(_body(I18n.t("cos.title.rookie"), 11, UiKit.WMUTED))
		mh.add_child(who)
	me.pressed.connect(func(): _settings.visible = true)
	right.add_child(me)
	var gear := _tap(UiKit.sbox(Color(1, 1, 1, 0.05), 20, Color(1, 1, 1, 0.1), 1), UiKit.sbox(Color(1, 1, 1, 0.14), 20, Color(1, 1, 1, 0.1), 1))
	var gd := 40.0 if phone else 38.0
	gear.custom_minimum_size = Vector2(gd, gd)
	gear.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var gc := CenterContainer.new()
	gc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	gc.add_child(_emoji("⚙️", 16 if phone else 17))
	gear.add_child(gc)
	gear.pressed.connect(func(): _settings.visible = true)
	right.add_child(gear)
	_refresh_tabs()

var _page_key := "play"

func _refresh_tabs() -> void:
	for k in _tabs:
		var on: bool = k == _page_key
		var lb: Label = _tabs[k][1]
		lb.add_theme_color_override("font_color", Color.WHITE if on else UiKit.WMUTED)
		(_tabs[k][2] as Label).modulate = Color.WHITE if on else Color(0.82, 0.82, 0.82, 1.0)
		(_tabs[k][3] as Panel).visible = on

func _open_page(key: String) -> void:
	_page_key = key
	_maps_pop.visible = false
	_refresh_tabs()
	_fill_page(key)
	_page_view.visible = key != "play"
	for c in [_hero, _picker, _play_col]:
		(c as Control).visible = key == "play"

# ---------------------------------------------------------------- left: the brawler on show

func _build_hero() -> void:
	var top := (_nav + 8.0) if phone else (_nav + (22.0 if H <= 780 else 36.0))
	var w := clampf(W * 0.27, 300.0, 400.0)
	if phone:
		w = minf(300.0, W - 236.0 - 3.0 * _g - 60.0)
	_hero = _vbox(4 if phone else (6 if H <= 780 else 8))
	_hero.position = Vector2(_g, top)
	_hero.custom_minimum_size.x = w
	_hero.size.x = w
	_home.add_child(_hero)
	_role = _shadowed(_body("", 10 if phone else 13, Color.WHITE, 900, 2), 1)
	_hero.add_child(_role)
	var name_size := 34 if phone else (50 if H <= 780 else 64)
	_name = _disp("", name_size, Color.WHITE, 8 if phone else 10)
	_name.add_theme_color_override("font_shadow_color", UiKit.INK)
	_name.add_theme_constant_override("shadow_offset_x", 0)
	_name.add_theme_constant_override("shadow_offset_y", 3 if phone else 6)
	_name.add_theme_constant_override("shadow_outline_size", 8 if phone else 10)
	var nbox := Control.new()
	nbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lh := name_size * 0.95
	nbox.custom_minimum_size = Vector2(w, lh - 4.0)
	_name.position = Vector2(0, (lh - name_size * 1.165) / 2.0 - 4.0)
	nbox.add_child(_name)
	_hero.add_child(nbox)
	# mastery: Mastery 1 [bar] 0 / 30 (no mastery progress in this client: level 1)
	var mrow := _hbox(10)
	mrow.add_child(_shadowed(_disp(I18n.t("menu.mastery", {"n": 1}), 12 if phone else 15, UiKit.YELLOW), 1))
	var bar := _panel(UiKit.sbox(Color(1, 1, 1, 0.12), 3))
	bar.custom_minimum_size = Vector2(minf(160.0, w * 0.45), 6)
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	mrow.add_child(bar)
	mrow.add_child(_shadowed(_body("0 / %d" % MASTERY_LEVELS[1], 11, UiKit.WMUTED), 1))
	_hero.add_child(mrow)
	_desc = _shadowed(_body("", 14, Color("d9d3f0"), 700), 1, 0.6)
	_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_desc.custom_minimum_size.x = w
	_desc.visible = H > 780 and not phone and not touch
	_hero.add_child(_desc)
	_stats = GridContainer.new()
	_stats.columns = 3
	_stats.add_theme_constant_override("h_separation", 10)
	_stats.add_theme_constant_override("v_separation", 5)
	_stats.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_stats.visible = H > 640 and not phone
	_hero.add_child(_stats)
	_loadout = _panel(StyleBoxEmpty.new())
	var lgap := Control.new()        # #loadout margin-top: 8px
	lgap.custom_minimum_size.y = 2 if phone else 8
	lgap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lwrap := _vbox(0)
	lwrap.add_child(lgap)
	lwrap.add_child(_loadout)
	_hero.add_child(lwrap)

# Gadget A / B and star power 1 / 2 of the chosen brawler (main.js renderLoadout).
func _render_loadout() -> void:
	for c in _loadout.get_children():
		c.queue_free()
	var key := Settings.brawler
	var lo := Settings.loadout_of(key)
	var stars: Array = STAR_IDS.get(key, ["", ""])
	var icons_only := touch or _fit >= 4
	var two_cols := phone or icons_only or W >= 1400
	var p := 6 if phone else 12
	_loadout.add_theme_stylebox_override("panel", UiKit.pads(UiKit.sbox(Color(16 / 255.0, 13 / 255.0, 32 / 255.0, 0.72), 14, Color(1, 1, 1, 0.1), 1),
		9 if phone else (11 if icons_only else 13), p + 1, 9 if phone else (11 if icons_only else 13), 9 if icons_only else p + 1))
	var col := _vbox(4 if phone else 8)
	_loadout.add_child(col)
	var grid := GridContainer.new()
	grid.columns = 2 if two_cols else 1
	grid.add_theme_constant_override("h_separation", 8 if phone else 12)
	grid.add_theme_constant_override("v_separation", 4 if (phone or icons_only) else 8)
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(grid)
	var groups := [
		[I18n.t("menu.gadget"), [[GADGET_ICONS.get(key + "A", "?"), I18n.t("gad.%sA.name" % key)], [GADGET_ICONS.get(key + "B", "?"), I18n.t("gad.%sB.name" % key)]], "AB".find(lo[0]), true],
		[I18n.t("menu.star"), [[STAR_ICONS[0], I18n.t("star.%s.name" % stars[0])], [STAR_ICONS[1], I18n.t("star.%s.name" % stars[1])]], "12".find(lo[1]), false]]
	for gr in groups:
		var gv := _vbox(3 if phone else 6)
		gv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var cur: int = gr[2]
		var title := String(gr[0])
		if icons_only:
			title += " · " + String(gr[1][cur][1])
		var em := _body(title, 10, UiKit.WMUTED if not icons_only else UiKit.WMUTED, 900, 1.2)
		em.clip_text = true
		em.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		gv.add_child(em)
		var opts: BoxContainer = _hbox(5) if icons_only else _vbox(3 if phone else 6)
		gv.add_child(opts)
		for i in 2:
			var on := i == cur
			var bg := Color(1, 0.824, 0.247, 0.14) if on else Color(1, 1, 1, 0.04)
			var bc := Color(1, 0.824, 0.247, 0.7) if on else Color(1, 1, 1, 0.1)
			var op := Vector2(0, 0) if icons_only else (Vector2(7, 4) if phone else Vector2(11, 7))
			var b := _tap(UiKit.pads(UiKit.sbox(bg, 10, bc, 1), op.x, op.y, op.x, op.y),
				UiKit.pads(UiKit.sbox(bg if on else Color(1, 1, 1, 0.09), 10, bc, 1), op.x, op.y, op.x, op.y))
			if icons_only:
				b.custom_minimum_size = Vector2(42, 36)
				var c := CenterContainer.new()
				c.mouse_filter = Control.MOUSE_FILTER_IGNORE
				c.add_child(_emoji(String(gr[1][i][0]), 19))
				b.add_child(c)
			else:
				b.custom_minimum_size.y = 34 if phone else 40
				var h := _hbox(5 if phone else 8)
				h.add_child(_emoji(String(gr[1][i][0]), 14 if phone else 18))
				var nm := _body(String(gr[1][i][1]), 11 if phone else 13, Color.WHITE if on else UiKit.WMUTED)
				nm.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
				nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				nm.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				nm.max_lines_visible = 2
				h.add_child(nm)
				b.add_child(h)
			if gr[3]:
				b.pressed.connect(_on_gadget.bind(i))
			else:
				b.pressed.connect(_on_star.bind(i))
			opts.add_child(b)
		grid.add_child(gv)
	if not icons_only and not phone and _fit < 2:
		var gi := "AB".find(lo[0])
		var si := "12".find(lo[1])
		var d := _body("%s %s\n%s %s" % [GADGET_ICONS.get(key + "AB"[gi], ""), I18n.t("gad.%s%s.desc" % [key, "AB"[gi]]),
			STAR_ICONS[si], I18n.t("star.%s.desc" % stars[si])], 12, UiKit.WMUTED, 800)
		d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		d.custom_minimum_size.x = _hero.custom_minimum_size.x - 26
		col.add_child(d)

func _render_stats(key: String) -> void:
	for c in _stats.get_children():
		c.queue_free()
	var t: Dictionary = GameData.brawlers[key]
	var c := UiKit.bright(_color(key), 1.2)
	for s in [[I18n.t("menu.hp"), float(t.hp), 5000.0], [I18n.t("menu.range"), float(t.range), 16.0], [I18n.t("menu.speed"), float(t.speed), 7.0]]:
		_stats.add_child(_shadowed(_body(String(s[0]).to_upper(), 11, UiKit.WMUTED, 900, 1), 1))
		var bar := _panel(UiKit.sbox(Color(1, 1, 1, 0.1), 3))
		bar.custom_minimum_size.y = 6
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var fill := Panel.new()
		fill.add_theme_stylebox_override("panel", UiKit.sbox(c, 3))
		fill.anchor_bottom = 1.0
		fill.anchor_right = clampf(float(s[1]) / float(s[2]), 0.0, 1.0)
		fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var holder := Control.new()
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(fill)
		bar.add_child(holder)
		_stats.add_child(bar)
		var v := float(s[1])
		var val := _disp(str(int(v)) if is_equal_approx(v, round(v)) else str(snappedf(v, 0.1)), 14)
		val.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		val.custom_minimum_size.x = 42
		_stats.add_child(val)

# The hero column must end above the picker: drop the blurb, the loadout texts, the stats, then show
# the gadgets as icons (main.js fit-1..4).
func _fit_hero() -> void:
	if _hero == null or _picker == null:
		return
	var limit := H - (8.0 if phone else 26.0) - _picker.get_combined_minimum_size().y - 12.0
	var bottom := func() -> float: return _hero.position.y + _hero.get_combined_minimum_size().y
	while bottom.call() > limit and _fit < 4:
		_fit += 1
		match _fit:
			1: _desc.visible = false
			2: _render_loadout()
			3: _stats.visible = false
			4: _render_loadout()
		await get_tree().process_frame
	if DebugArgs.has("menudump"):
		get_tree().create_timer(0.5).timeout.connect(_dump)

func _on_gadget(i: int) -> void:
	var lo := Settings.loadout_of(Settings.brawler)
	Settings.set_loadout(Settings.brawler, "AB"[i] + lo[1])
	_render_loadout()
	Settings.save()
	profile_changed.emit()

func _on_star(i: int) -> void:
	var lo := Settings.loadout_of(Settings.brawler)
	Settings.set_loadout(Settings.brawler, lo[0] + "12"[i])
	_render_loadout()
	Settings.save()
	profile_changed.emit()

# ---------------------------------------------------------------- bottom left: skins + roster

func _build_picker() -> void:
	_picker = _vbox(5 if phone else (8 if H <= 760 else 10))
	_corner(_picker, "l", "b", _g, (8.0 + _ins.w) if phone else 26.0)
	_home.add_child(_picker)
	var small := H <= 760
	var sp := Vector4(7, 5, 7, 6) if phone else (Vector4(9, 7, 9, 9) if small else Vector4(11, 9, 11, 11))
	var bar := _panel(UiKit.pads(UiKit.sbox(Color(UiKit.NIGHT, 0.72), 12 if phone else 16, Color(1, 1, 1, 0.1), 1), sp.x, sp.y, sp.z, sp.w))
	_picker.add_child(bar)
	var bv := _vbox(6)
	bar.add_child(bv)
	var head := _hbox(8)
	var hm := MarginContainer.new()
	hm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hm.add_theme_constant_override("margin_left", 2)
	hm.add_child(head)
	head.add_child(_disp(I18n.t("cos.tab.skin"), 14, Color.WHITE, 0, 0.8))
	_skin_count = _body("", 11, UiKit.WMUTED, 900)
	_skin_count.size_flags_vertical = Control.SIZE_SHRINK_END
	head.add_child(_skin_count)
	if not phone:
		bv.add_child(hm)
	_skin_track = _hbox(8)
	var tm := MarginContainer.new()
	tm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "right", "top", "bottom"]:
		tm.add_theme_constant_override("margin_" + side, 2)
	tm.add_child(_skin_track)
	bv.add_child(tm)
	_skin_row = bar
	if touch and not phone:
		# touch screens: the skin row starts folded to its title (main.js), a tap opens it
		var fold := _body("▾", 13, UiKit.WMUTED)
		fold.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		fold.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		head.add_child(fold)
		_skin_track.visible = false
		bar.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		bar.mouse_filter = Control.MOUSE_FILTER_STOP
		bar.gui_input.connect(func(ev: InputEvent):
			if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
				_skin_track.visible = not _skin_track.visible
				bar.size_flags_horizontal = Control.SIZE_FILL if _skin_track.visible else Control.SIZE_SHRINK_BEGIN
				call_deferred("_fit_hero"))
	var roster := _hbox(6 if (phone or W <= 1000) else 10)
	_picker.add_child(roster)
	for k in GameData.brawlers.keys():
		roster.add_child(_roster_tile(String(k)))

func _roster_tile(key: String) -> Control:
	var tw := 54.0 if phone else 78.0
	var th := 60.0 if phone else 86.0
	var r := 10 if phone else 14
	var wrap := Control.new()
	wrap.custom_minimum_size = Vector2(tw, th + 4)
	wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var tile := _tap(StyleBoxEmpty.new())
	tile.size = Vector2(tw, th)
	tile.position = Vector2(0, 4)
	wrap.add_child(tile)
	var ring := Panel.new()       # selected: an ink ring and a yellow glow around the yellow border
	var rs := UiKit.sbox(UiKit.INK, r + 2, Color(0, 0, 0, 0), 0, Color(1, 0.824, 0.247, 0.45), 0, 9)
	rs.expand_margin_left = 2
	rs.expand_margin_right = 2
	rs.expand_margin_top = 2
	rs.expand_margin_bottom = 2
	ring.add_theme_stylebox_override("panel", rs)
	ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ring.visible = false
	tile.add_child(ring)
	var c := _color(key)
	var clip := UiKit.clip_box(r)
	tile.add_child(clip)
	var bg := UiKit.grad_rect(UiKit.grad([[0.0, UiKit.mix(c, Color.WHITE, 0.6)], [0.55, c], [1.0, UiKit.mix(c, Color.BLACK, 0.45)]],
		Vector2(0.5, 0.3), Vector2(0.5 + 0.75, 0.3), true))
	clip.add_child(bg)
	clip.add_child(_portrait_rect(key, 66.0 if phone else 96.0, tw, th, -6.0))
	var strip := UiKit.grad_rect(UiKit.grad([[0.0, Color(0, 0, 0, 0)], [1.0, Color(0, 0, 0, 0.8)]]))
	strip.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	strip.offset_top = -(22.0 if phone else 30.0)
	strip.offset_bottom = 0
	clip.add_child(strip)
	var nm := _disp(String(GameData.brawlers[key].name), 10 if phone else 12, Color.WHITE, 4)
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nm.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	nm.offset_top = -(15.0 if phone else 18.0)
	nm.offset_bottom = -2
	nm.clip_text = true
	clip.add_child(nm)
	var bd := 15.0 if phone else 18.0
	var lv := _disp("1", 9 if phone else 11, UiKit.YELLOW)
	lv.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lv.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lv.add_theme_stylebox_override("normal", UiKit.sbox(Color(10 / 255.0, 8 / 255.0, 22 / 255.0, 0.8), int(bd / 2)))
	lv.position = Vector2(tw - bd - 4, 4)
	lv.size = Vector2(bd, bd)
	clip.add_child(lv)
	var border := Panel.new()
	var bs := UiKit.sbox(Color(0, 0, 0, 0), r, Color(1, 1, 1, 0.12), 2)
	bs.draw_center = false
	border.add_theme_stylebox_override("panel", bs)
	border.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tile.add_child(border)
	tile.pressed.connect(func(): _select_brawler(key, true))
	tile.mouse_entered.connect(func(): if key != Settings.brawler: tile.modulate = Color.WHITE; tile.position.y = 1)
	tile.mouse_exited.connect(func(): _mark_roster())
	_roster_tiles[key] = [tile, ring, border]
	return wrap

func _mark_roster() -> void:
	for k in _roster_tiles:
		var on: bool = k == Settings.brawler
		var tile: Control = _roster_tiles[k][0]
		(_roster_tiles[k][1] as Control).visible = on
		var bs := UiKit.sbox(Color(0, 0, 0, 0), 10 if phone else 14, UiKit.YELLOW if on else Color(1, 1, 1, 0.12), 2)
		bs.draw_center = false
		(_roster_tiles[k][2] as Panel).add_theme_stylebox_override("panel", bs)
		tile.position.y = 0.0 if on else 4.0
		tile.modulate = Color.WHITE if on else Color(0.9, 0.9, 0.93, 1.0)

# The chosen brawler's skins (only the classic one is free; the others are the web's shop / mastery).
func _render_skins() -> void:
	for c in _skin_track.get_children():
		c.queue_free()
	var key := Settings.brawler
	_skin_count.text = "1/%d" % SKINS.size()
	var small := H <= 760
	var tw := 46.0 if phone else (64.0 if small else 76.0)
	var ah := 34.0 if phone else (50.0 if small else 62.0)
	var ih := 40.0 if phone else (58.0 if small else 70.0)
	var c := _color(key)
	for n in SKINS.size():
		var have := n == 0
		var on := n == 0
		var bg := Color(1, 0.824, 0.247, 0.14) if on else Color(1, 1, 1, 0.04)
		var bc := UiKit.YELLOW if on else Color(1, 1, 1, 0.1)
		var s := UiKit.pads(UiKit.sbox(bg, 9 if phone else 12, bc, 2, Color(1, 0.824, 0.247, 0.35) if on else Color(0, 0, 0, 0), 0, 7 if on else 0), 2, 2, 2, 4 if phone else 5)
		var b := _tap(s, s)
		b.custom_minimum_size.x = tw
		var v := _vbox(3)
		b.add_child(v)
		var art := UiKit.clip_box(10)
		var st := art.get_theme_stylebox("panel") as StyleBoxFlat
		st.corner_radius_bottom_left = 6
		st.corner_radius_bottom_right = 6
		art.custom_minimum_size = Vector2(tw - 4, ah)
		art.size = art.custom_minimum_size
		art.add_child(UiKit.grad_rect(UiKit.grad([[0.0, UiKit.mix(c, Color.WHITE, 0.55)], [0.6, c], [1.0, UiKit.mix(c, Color.BLACK, 0.45)]],
			Vector2(0.5, 0.35), Vector2(0.5 + 0.75, 0.35), true)))
		art.add_child(_portrait_rect(key, ih, tw - 4, ah, -5.0, MenuW.recolour(SKINS[n], _skin_rec(key, SKINS[n])) if have else MenuW.recolour("default", [0.0, 0.8, 1.0], 0.55)))
		if not have:
			var lock := _emoji("🔒", 13 if phone else 18)
			lock.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			lock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			art.add_child(lock)
		var am := MarginContainer.new()
		am.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for side in ["left", "right", "top"]:
			am.add_theme_constant_override("margin_" + side, 0)
		am.add_child(art)
		v.add_child(am)
		var nm := _body(I18n.t("cos.skin." + SKINS[n]), 8 if phone else 11, UiKit.WTEXT if have else UiKit.WMUTED, 900)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		nm.clip_text = true
		v.add_child(nm)
		_skin_track.add_child(b)

# ---------------------------------------------------------------- right: quests + the PLAY panel

func _build_play_panel() -> void:
	var pw := 236.0 if phone else (290.0 if W <= 1000 else 340.0)
	var col := _vbox(6 if phone else 14)
	_play_col = col
	col.custom_minimum_size.x = pw
	_corner(col, "r", "b", (10.0 + _ins.z) if phone else _g, (8.0 + _ins.w) if phone else 24.0)
	_home.add_child(col)
	if not phone:
		col.add_child(_build_home_quests())
	var box := _panel(UiKit.pads(UiKit.sbox(Color(UiKit.NIGHT, 0.82), 14 if phone else 18, Color(1, 1, 1, 0.1), 1, Color(0, 0, 0, 0.45), 16, 20), 11 if phone else 17, 11 if phone else 17, 11 if phone else 17, 11 if phone else 17))
	col.add_child(box)
	var v := _vbox(6 if phone else 10)
	box.add_child(v)
	# mode
	var mrow := _hbox(6)
	v.add_child(mrow)
	for m in ["solo", "duo"]:
		var b := _tap(StyleBoxEmpty.new())
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var mv := _vbox(0)
		mv.add_child(_disp(I18n.t("menu.mode") if m == "solo" else I18n.t("menu.duo"), 14 if phone else 18, Color.WHITE, 0, 0.5))
		if not phone:
			var d := _body(I18n.t("menu.modeDesc") if m == "solo" else I18n.t("menu.duoDesc"), 11, UiKit.WMUTED)
			d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			d.custom_minimum_size.x = (pw - 34 - 6) / 2.0 - 24
			d.add_theme_constant_override("line_spacing", -2)
			mv.add_child(d)
		b.add_child(mv)
		b.pressed.connect(func(): Settings.mode = m; Settings.save(); _refresh_mode())
		mrow.add_child(b)
		_mode_btns[m] = b
	# map
	_map_btn = _tap(StyleBoxEmpty.new())
	v.add_child(_map_btn)
	_map_btn.pressed.connect(func(): _maps_pop.visible = not _maps_pop.visible; _refresh_map())
	# Weekly Chaos
	_chaos_btn = _tap(StyleBoxEmpty.new())
	v.add_child(_chaos_btn)
	_chaos_btn.pressed.connect(func(): Settings.chaos = not Settings.chaos; Settings.save(); _refresh_chaos())
	_refresh_chaos()
	# ONLINE
	var ink := UiKit.INK
	var online := _tap(StyleBoxEmpty.new())
	var bw := 2 if phone else 3
	var r := 14
	var glow := Panel.new()
	glow.add_theme_stylebox_override("panel", UiKit.sbox(ink, r, Color(0, 0, 0, 0), 0, ink, 4.0 if phone else 6.0, 1))
	glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	online.add_child(glow)
	var halo := Panel.new()
	halo.add_theme_stylebox_override("panel", UiKit.sbox(Color(0, 0, 0, 0), r, Color(0, 0, 0, 0), 0, Color(1, 0.745, 0.157, 0.3), 0, 18))
	halo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	online.add_child(halo)
	var oc := UiKit.clip_box(r)
	oc.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color("ffe36b")], [1.0, Color("ffb21f")]])))
	online.add_child(oc)
	var ob := Panel.new()
	var obs := UiKit.sbox(Color(0, 0, 0, 0), r, ink, bw)
	obs.draw_center = false
	ob.add_theme_stylebox_override("panel", obs)
	ob.mouse_filter = Control.MOUSE_FILTER_IGNORE
	online.add_child(ob)
	var om := MarginContainer.new()
	om.mouse_filter = Control.MOUSE_FILTER_IGNORE
	om.add_theme_constant_override("margin_top", 5 if phone else 10)
	om.add_theme_constant_override("margin_bottom", 5 if phone else 9)
	var ov := _vbox(0)
	ov.alignment = BoxContainer.ALIGNMENT_CENTER
	var ot := _disp(I18n.t("menu.online"), 26 if phone else 38, ink, 0, 1)
	ot.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ot.add_theme_constant_override("line_spacing", -8)
	ov.add_child(ot)
	var os := _body(I18n.t("lobby.ranked"), 10 if phone else 12, Color(ink, 0.75), 900)
	os.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ov.add_child(os)
	om.add_child(ov)
	online.add_child(om)
	online.pressed.connect(func(): _room_dialog.visible = true)
	online.mouse_entered.connect(func(): online.modulate = Color(1.06, 1.06, 1.06))
	online.mouse_exited.connect(func(): online.modulate = Color.WHITE)
	var opad := MarginContainer.new()   # room for the 6 px ink shadow under the button
	opad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	opad.add_theme_constant_override("margin_bottom", 4 if phone else 6)
	opad.add_child(online)
	v.add_child(opad)
	# SOLO / TRAINING
	var alt := _hbox(8)
	v.add_child(alt)
	for spec in [["🤖", I18n.t("menu.solo"), "solo"], ["🥋", I18n.t("menu.dojo"), "dojo"]]:
		var b := _tap(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.06), 12, Color(1, 1, 1, 0.14), 1), 5 if phone else 9, 11, 5 if phone else 9, 11),
			UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.13), 12, Color(1, 1, 1, 0.14), 1), 5 if phone else 9, 11, 5 if phone else 9, 11))
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var h := _hbox(4 if phone else 7)
		h.alignment = BoxContainer.ALIGNMENT_CENTER
		h.add_child(_emoji(String(spec[0]), 13 if phone else 16))
		var l := _disp(String(spec[1]), 11 if phone else 15, Color.WHITE, 0, 0.5)
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		h.add_child(l)
		b.add_child(h)
		if spec[2] == "solo":
			b.pressed.connect(func(): _commit_name(); solo_play.emit())
		else:
			b.pressed.connect(func(): _commit_name(); training.emit())
		alt.add_child(b)
	_maps_pop = _build_maps_pop(pw)
	_home.add_child(_maps_pop)

func _build_home_quests() -> Control:
	var p := _panel(UiKit.pads(UiKit.sbox(Color(UiKit.NIGHT, 0.72), 16, Color(1, 1, 1, 0.08), 1), 15, 13, 15, 13))
	var tap := _tap(StyleBoxEmpty.new())
	tap.add_child(p)
	tap.pressed.connect(func(): _open_page("quests"))
	var v := _vbox(7)
	p.add_child(v)
	var h := _hbox(8)
	var t := _disp(I18n.t("meta.quests"), 15, Color.WHITE, 0, 0.8)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(t)
	h.add_child(_body("0/3", 12, UiKit.WMUTED, 900))
	v.add_child(h)
	var mc := MarginContainer.new()
	mc.add_theme_constant_override("margin_top", 1)
	mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for q in _quests():
		var row := _hbox(8)
		var ic := _emoji(QUEST_ICONS.get(q.kind, "•"), 16)
		ic.custom_minimum_size.x = 22
		ic.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		row.add_child(ic)
		var rv := _vbox(3)
		rv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var top := _hbox(8)
		var txt := _body(_quest_text(q), 12, Color("e6e1f7"))
		txt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		txt.clip_text = true
		txt.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		top.add_child(txt)
		top.add_child(_disp("%s/%s" % [_num(int(q.n)), _num(int(q.target))], 12, UiKit.WMUTED))
		rv.add_child(top)
		var bar := _panel(UiKit.sbox(Color(1, 1, 1, 0.1), 2))
		bar.custom_minimum_size.y = 4
		rv.add_child(bar)
		row.add_child(rv)
		v.add_child(row)
	return tap

func _refresh_mode() -> void:
	for m in _mode_btns:
		var on: bool = m == Settings.mode
		var bc := Color(1, 1, 1, 0.1)
		var bg := Color(1, 1, 1, 0.04)
		if on:
			bc = UiKit.TEAL if m == "duo" else UiKit.YELLOW
			bg = Color(21 / 255.0, 170 / 255.0, 191 / 255.0, 0.16) if m == "duo" else Color(1, 0.824, 0.247, 0.1)
		var p := Vector4(10, 6, 10, 6) if phone else Vector4(12, 10, 12, 10)
		var tap: MenuTap = _mode_btns[m]
		tap.set_styles(UiKit.pads(UiKit.sbox(bg, 12, bc, 2), p.x, p.y, p.z, p.w),
			UiKit.pads(UiKit.sbox(bg, 12, bc if on else Color(1, 1, 1, 0.3), 2), p.x, p.y, p.z, p.w))

func _refresh_map() -> void:
	var m: String = Settings.map if MAP_ORDER.has(Settings.map) else "random"
	for c in _map_btn.get_children():
		c.queue_free()
	var open := _maps_pop != null and _maps_pop.visible
	var r := 12
	var clip := UiKit.clip_box(r)
	_map_btn.add_child(clip)
	if m == "random":
		clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color("3b2f6e")], [1.0, Color("1c1638")]], Vector2(0, 0), Vector2(1, 1))))
	else:
		var img := TextureRect.new()
		var path := "res://assets/ui/map_%s.jpg" % m
		img.texture = load(path) as Texture2D if ResourceLoader.exists(path) else null
		img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		img.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		img.mouse_filter = Control.MOUSE_FILTER_IGNORE
		clip.add_child(img)
		var n := Color(10 / 255.0, 8 / 255.0, 22 / 255.0)
		clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color(n, 0.85)], [0.3, Color(n, 0.85)], [1.0, Color(n, 0.2)]], Vector2(0, 0), Vector2(1, 0))))
	var border := Panel.new()
	var bs := UiKit.sbox(Color(0, 0, 0, 0), r, UiKit.YELLOW if open else Color(1, 1, 1, 0.14), 1)
	bs.draw_center = false
	border.add_theme_stylebox_override("panel", bs)
	border.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_map_btn.add_child(border)
	var mc := MarginContainer.new()
	mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mc.add_theme_constant_override("margin_left", 11 if phone else 15)
	mc.add_theme_constant_override("margin_right", 31 if phone else 41)
	mc.add_theme_constant_override("margin_top", 6 if phone else 11)
	mc.add_theme_constant_override("margin_bottom", 6 if phone else 11)
	var v := _vbox(1)
	v.add_child(_body(I18n.t("menu.map").to_upper(), 10, UiKit.WMUTED, 900, 1.2))
	var icon: String = "🎲" if m == "random" else MAP_ICON.get(String(GameData.maps[m].get("weather", "clear")), "")
	var nm := _hbox(6)
	nm.add_child(_emoji(icon, 13 if phone else 17))
	nm.add_child(_disp(I18n.t("map." + m), 14 if phone else 19))
	v.add_child(nm)
	if not phone:
		v.add_child(_body(I18n.t("map.%s.tag" % m), 12, Color("d9d3f0")))
	mc.add_child(v)
	_map_btn.add_child(mc)
	var arr := _body("◂", 16, UiKit.YELLOW if open else UiKit.WMUTED)
	arr.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	arr.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var ah := Control.new()
	ah.mouse_filter = Control.MOUSE_FILTER_IGNORE
	arr.anchor_left = 1.0
	arr.anchor_right = 1.0
	arr.anchor_top = 0.0
	arr.anchor_bottom = 1.0
	arr.offset_left = -28
	arr.offset_right = -12
	ah.add_child(arr)
	_map_btn.add_child(ah)
	for k in _map_tiles:
		(_map_tiles[k] as Control).get_node("On").visible = k == m

func _build_maps_pop(pw: float) -> Control:
	var wide := W >= 1400 and not phone
	var pop_w := 330.0 if phone else (540.0 if wide else 380.0)
	pop_w = minf(pop_w, W - pw - 3.0 * _g - 14.0)
	var cols := 3 if wide else 2
	var p := _panel(UiKit.pads(UiKit.sbox(Color(UiKit.NIGHT, 0.95), 16, Color(1, 1, 1, 0.12), 1, Color(0, 0, 0, 0.5), 16, 20), 8 if phone else 12, 8 if phone else 12, 8 if phone else 12, 8 if phone else 12))
	p.mouse_filter = Control.MOUSE_FILTER_STOP
	p.custom_minimum_size.x = pop_w
	_corner(p, "r", "b", ((10.0 + _ins.z + 10.0) if phone else (_g + 14.0)) + pw, (8.0 + _ins.w) if phone else _g)
	p.visible = false
	var v := _vbox(5 if phone else 8)
	p.add_child(v)
	v.add_child(_disp(I18n.t("menu.pickMap"), 13 if phone else 16, Color.WHITE, 0, 0.6))
	var grid := GridContainer.new()
	grid.columns = cols
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(grid)
	var th := 52.0 if phone else 86.0
	var tw := (pop_w - (16.0 if phone else 24.0) - 8.0 * (cols - 1)) / cols
	for key in MAP_ORDER:
		grid.add_child(_map_tile(String(key), Vector2(tw, th)))
	return p

func _map_tile(key: String, sz: Vector2) -> Control:
	var t := _tap(StyleBoxEmpty.new())
	t.custom_minimum_size = sz
	var on := Panel.new()
	on.name = "On"
	var os := UiKit.sbox(Color(0, 0, 0, 0), 15, UiKit.YELLOW, 3)
	os.draw_center = false
	os.expand_margin_left = 3
	os.expand_margin_right = 3
	os.expand_margin_top = 3
	os.expand_margin_bottom = 3
	on.add_theme_stylebox_override("panel", os)
	on.mouse_filter = Control.MOUSE_FILTER_IGNORE
	on.visible = false
	var clip := UiKit.clip_box(12)
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
	var bs := UiKit.sbox(Color(0, 0, 0, 0), 12, UiKit.INK, 2 if phone else 3)
	bs.draw_center = false
	border.add_theme_stylebox_override("panel", bs)
	border.mouse_filter = Control.MOUSE_FILTER_IGNORE
	t.add_child(border)
	t.add_child(on)
	var mc := MarginContainer.new()
	mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mc.add_theme_constant_override("margin_left", 8)
	mc.add_theme_constant_override("margin_right", 6)
	mc.add_theme_constant_override("margin_bottom", 5)
	var v := _vbox(0)
	v.alignment = BoxContainer.ALIGNMENT_END
	v.add_child(_disp(I18n.t("map." + key), 11 if phone else 13, Color.WHITE, 5))
	if not phone:
		var tag := _shadowed(_body(I18n.t("map.%s.tag" % key), 9, Color.WHITE), 1, 1.0)
		tag.clip_text = true
		tag.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		v.add_child(tag)
	mc.add_child(v)
	t.add_child(mc)
	var icon: String = "🎲" if key == "random" else MAP_ICON.get(String(GameData.maps[key].get("weather", "clear")), "")
	var ic := _emoji(icon, 12 if phone else 16)
	ic.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	ic.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	var icm := MarginContainer.new()
	icm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	icm.add_theme_constant_override("margin_right", 6)
	icm.add_theme_constant_override("margin_top", 3)
	icm.add_child(ic)
	t.add_child(icm)
	t.pressed.connect(func():
		Settings.map = key
		Settings.save()
		_maps_pop.visible = false
		_refresh_map()
		showcase_changed.emit())
	_map_tiles[key] = t
	return t

func _refresh_chaos() -> void:
	for c in _chaos_btn.get_children():
		c.queue_free()
	var on := Settings.chaos
	var p := Vector4(10, 6, 10, 6) if phone else Vector4(12, 8, 12, 8)
	if on:
		var clip := UiKit.clip_box(10)
		clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color(240 / 255.0, 62 / 255.0, 62 / 255.0, 0.35)], [1.0, Color(21 / 255.0, 170 / 255.0, 191 / 255.0, 0.35)]], Vector2(0, 0), Vector2(1, 0))))
		_chaos_btn.add_child(clip)
	_chaos_btn.set_styles(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.0 if on else 0.06), 10, Color("ff6bd8") if on else UiKit.INK, 2), 0, 0, 0, 0))
	var row := _hbox(8)
	var mc := MarginContainer.new()
	mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "right"]:
		mc.add_theme_constant_override("margin_" + side, int(p.x))
	mc.add_theme_constant_override("margin_top", int(p.y))
	mc.add_theme_constant_override("margin_bottom", int(p.w))
	mc.add_child(row)
	var l := _vbox(-4)                 # line-height 1.15
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var m := _weekly()
	l.add_child(_body("🌀 " + I18n.t("chaos.name"), 8 if phone else 9, Color.WHITE if on else UiKit.WMUTED, 800, 0.8))
	l.add_child(_body("%s %s" % [MUT_ICONS[m], I18n.t("mut." + m)], 11 if phone else 13, UiKit.WTEXT))
	row.add_child(l)
	var sw := MenuW.Switch.new()
	sw.on = on
	sw.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(sw)
	_chaos_btn.add_child(mc)

# ---------------------------------------------------------------- selection

func _select_brawler(key: String, user: bool) -> void:
	if not GameData.brawlers.has(key):
		return
	var changed := key != Settings.brawler
	Settings.brawler = key
	var t: Dictionary = GameData.brawlers[key]
	_role.text = I18n.t("brawler.%s.role" % key).to_upper()
	_role.add_theme_color_override("font_color", UiKit.bright(_color(key), 1.35))
	_name.text = String(t.name)
	_desc.text = I18n.t("brawler.%s.desc" % key)
	_render_stats(key)
	_render_loadout()
	_render_skins()
	_mark_roster()
	if user:
		Settings.save()
		profile_changed.emit()
		if changed:
			showcase_changed.emit()
		if _fit > 0:
			_fit = 0
			_desc.visible = H > 780 and not phone and not touch
			_stats.visible = H > 640 and not phone
			_render_loadout()
		call_deferred("_fit_hero")

func _commit_name() -> void:
	if _nick:
		Settings.nickname = _nick.text.strip_edges()
	Settings.save()
	profile_changed.emit()

# ---------------------------------------------------------------- pages of the other tabs

func _build_page_view() -> Control:
	var v := Control.new()
	v.position = Vector2(0, _nav)
	v.size = Vector2(W, H - _nav)
	v.mouse_filter = Control.MOUSE_FILTER_STOP
	v.visible = false
	v.add_child(UiKit.grad_rect(UiKit.grad([[0.0, Color(12 / 255.0, 9 / 255.0, 26 / 255.0, 0.96)], [1.0, Color(12 / 255.0, 9 / 255.0, 26 / 255.0, 0.9)]])))
	return v

func _fill_page(key: String) -> void:
	for i in range(_page_view.get_child_count() - 1, 0, -1):
		_page_view.get_child(i).queue_free()
	if key == "play":
		return
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_page_view.add_child(scroll)
	var mc := MarginContainer.new()
	mc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var px := 12 if phone else maxi(32, int((W - 1100) / 2))
	mc.add_theme_constant_override("margin_left", px)
	mc.add_theme_constant_override("margin_right", px)
	mc.add_theme_constant_override("margin_top", 10 if phone else 24)
	mc.add_theme_constant_override("margin_bottom", 20)
	scroll.add_child(mc)
	var v := _vbox(14)
	mc.add_child(v)
	var head := _hbox(16)
	var titles := {"collection": "meta.collection", "shop": "meta.shop", "quests": "meta.quests", "road": "meta.road"}
	head.add_child(_disp(I18n.t(titles[key]), 22 if phone else 40))
	v.add_child(head)
	match key:
		"quests":
			var row := _hbox(14)
			for q in _quests():
				var c := _panel(UiKit.pads(UiKit.sbox(Color("fff3c4"), 6, UiKit.INK, 0, Color(0, 0, 0, 0.35), 4, 6), 14, 16, 14, 14))
				c.custom_minimum_size = Vector2(200, 150)
				c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				var cv := _vbox(8)
				cv.add_child(_emoji(QUEST_ICONS.get(q.kind, "•"), 30))
				var tx := _body(_quest_text(q), 15, UiKit.INK, 900)
				tx.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				cv.add_child(tx)
				cv.add_child(_disp("0/%s" % _num(int(q.target)), 16, Color("9a6a00")))
				c.add_child(cv)
				row.add_child(c)
			v.add_child(row)
			v.add_child(_body(I18n.t("quest.rerollHint"), 13, UiKit.WMUTED))
		"collection":
			var grid := GridContainer.new()
			grid.columns = maxi(2, int((W - 2 * px) / 174))
			grid.add_theme_constant_override("h_separation", 14)
			grid.add_theme_constant_override("v_separation", 14)
			for k in GameData.brawlers.keys():
				var c := _tap(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.04), 14, UiKit.YELLOW if k == Settings.brawler else Color(1, 1, 1, 0.1), 1), 10, 16, 10, 12),
					UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.09), 14, UiKit.YELLOW if k == Settings.brawler else Color(1, 1, 1, 0.1), 1), 10, 16, 10, 12))
				c.custom_minimum_size.x = 160
				var cv := _vbox(6)
				var img := TextureRect.new()
				img.texture = UiKit.portrait(String(k))
				img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
				img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
				img.custom_minimum_size.y = 56 if phone else 104
				img.mouse_filter = Control.MOUSE_FILTER_IGNORE
				cv.add_child(img)
				var nm := _disp(String(GameData.brawlers[k].name), 15)
				nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
				cv.add_child(nm)
				var sk := _body("%s 1/%d" % [I18n.t("cos.tab.skin"), SKINS.size()], 12, Color("d9d3f0"))
				sk.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
				cv.add_child(sk)
				c.add_child(cv)
				var kk := String(k)
				c.pressed.connect(func(): _select_brawler(kk, true); _open_page("play"))
				grid.add_child(c)
			v.add_child(grid)
		"shop":
			var l := _body(I18n.t("shop.fair"), 14, UiKit.WMUTED)
			l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			v.add_child(l)
			v.add_child(_disp(I18n.t("shop.gemsSoon"), 22, UiKit.YELLOW))
		"road":
			var l := _body(I18n.t("road.lead"), 14, UiKit.WMUTED)
			l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			v.add_child(l)
			v.add_child(_disp(I18n.t("road.total", {"n": 0}), 22, UiKit.YELLOW))

# ---------------------------------------------------------------- overlays

# The dimmed backdrop + a centred card (web .overlay + .menu-card.lobby). Returns [dim, card body].
func _card(width: float, bg_top: Color, bg_bottom: Color, radius: int, dim_a: float) -> Array:
	var dim := Control.new()
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.visible = false
	var shade := ColorRect.new()
	shade.color = Color(8 / 255.0, 6 / 255.0, 18 / 255.0, dim_a)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim.add_child(shade)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim.add_child(center)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UiKit.sbox(Color(0, 0, 0, 0), radius, Color(0, 0, 0, 0), 0, Color(0, 0, 0, 0.35), 10, 1))
	card.custom_minimum_size.x = width
	center.add_child(card)
	var clip := UiKit.clip_box(radius)
	clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, bg_top], [1.0, bg_bottom]])))
	card.add_child(clip)
	var border := Panel.new()
	var bs := UiKit.sbox(Color(0, 0, 0, 0), radius, UiKit.INK, 3)
	bs.draw_center = false
	border.add_theme_stylebox_override("panel", bs)
	border.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(border)
	var mc := MarginContainer.new()
	var px := 10 if phone else 20
	mc.add_theme_constant_override("margin_left", px)
	mc.add_theme_constant_override("margin_right", px)
	mc.add_theme_constant_override("margin_top", 8 if phone else 16)
	mc.add_theme_constant_override("margin_bottom", 8 if phone else 16)
	card.add_child(mc)
	var v := _vbox(6 if phone else 12)
	mc.add_child(v)
	return [dim, v]

func _head(title: String, on_back: Callable) -> Control:
	var h := _hbox(12)
	var bd := 34.0 if phone else 44.0
	var back := _tap(UiKit.sbox(Color(1, 1, 1, 0.08), 10 if phone else 14, UiKit.INK, 3, UiKit.INK, 4, 1),
		UiKit.sbox(Color(1, 1, 1, 0.16), 10 if phone else 14, UiKit.INK, 3, UiKit.INK, 4, 1))
	back.custom_minimum_size = Vector2(bd, bd)
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var c := CenterContainer.new()
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.add_child(_disp("←", 18 if phone else 24))
	back.add_child(c)
	back.pressed.connect(on_back)
	h.add_child(back)
	var t := _disp(title, 24 if phone else 44, Color.WHITE, 8)
	t.add_theme_color_override("font_shadow_color", UiKit.INK)
	t.add_theme_constant_override("shadow_offset_y", 5)
	t.add_theme_constant_override("shadow_offset_x", 0)
	t.add_theme_constant_override("shadow_outline_size", 8)
	t.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	h.add_child(t)
	return h

func _lj_box(bg: StyleBox = null) -> PanelContainer:
	return _panel(bg if bg else UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.045), 14 if phone else 18, Color(1, 1, 1, 0.08), 2), 9 if phone else 14, 9 if phone else 14, 9 if phone else 14, 9 if phone else 14))

# The big yellow button (.big): display font, ink border, hard ink shadow.
func _big(text: String, size: int, padv: float = 14.0) -> MenuTap:
	var s := UiKit.pads(UiKit.sbox(Color("ffd545"), 14, UiKit.INK, 3, UiKit.INK, 6, 1), 18, padv, 18, padv)
	var hs := UiKit.pads(UiKit.sbox(Color("ffdc5c"), 14, UiKit.INK, 3, UiKit.INK, 6, 1), 18, padv, 18, padv)
	var b := _tap(s, hs)
	var l := _disp(text, size, UiKit.INK)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	b.add_child(l)
	return b

func _ghost(text: String, size: int) -> MenuTap:
	var s := UiKit.pads(UiKit.sbox(Color(40 / 255.0, 34 / 255.0, 62 / 255.0, 0.9), 14, UiKit.INK, 3, UiKit.INK, 4, 1), 14, 7, 14, 7)
	var hs := UiKit.pads(UiKit.sbox(Color(58 / 255.0, 48 / 255.0, 96 / 255.0, 0.95), 14, UiKit.INK, 3, UiKit.INK, 4, 1), 14, 7, 14, 7)
	var b := _tap(s, hs)
	var l := _disp(text, size, UiKit.WTEXT)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	b.add_child(l)
	return b

func _input_style(e: LineEdit, size: int) -> void:
	e.add_theme_font_override("font", _fd())
	e.add_theme_font_size_override("font_size", size)
	e.add_theme_color_override("font_color", UiKit.WTEXT)
	e.add_theme_color_override("font_placeholder_color", Color(UiKit.WMUTED, 0.6))
	e.add_theme_color_override("caret_color", UiKit.YELLOW)
	var p := Vector2(8, 5) if phone else Vector2(12, 10)
	e.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color("221d33"), 12, UiKit.INK, 3), p.x, p.y, p.x, p.y))
	e.add_theme_stylebox_override("focus", UiKit.pads(UiKit.sbox(Color(0, 0, 0, 0), 12, UiKit.YELLOW, 2), p.x, p.y, p.x, p.y))

# Online (web #lobby #lobbyJoin): who you are, FIND A MATCH, play with friends (create / join a room).
func _build_online() -> Control:
	var o := _card(minf(900.0, W - 24.0), Color(38 / 255.0, 29 / 255.0, 72 / 255.0, 0.95), Color(18 / 255.0, 14 / 255.0, 34 / 255.0, 0.95), 18 if phone else 24, 0.55)
	var dim: Control = o[0]
	var v: VBoxContainer = o[1]
	v.add_child(_head(I18n.t("lobby.title"), func(): _commit_name(); dim.visible = false))
	var grid := GridContainer.new()
	grid.columns = 3 if phone else 2
	grid.add_theme_constant_override("h_separation", 8 if phone else 12)
	grid.add_theme_constant_override("v_separation", 12)
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(grid)
	# profile
	var prof := _lj_box()
	prof.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_child(prof)
	var ph := _hbox(14)
	prof.add_child(ph)
	if not phone:
		var key := Settings.brawler
		var c := _color(key)
		var av := Control.new()
		av.custom_minimum_size = Vector2(92, 92)
		av.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		av.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var clip := UiKit.clip_box(20)
		clip.size = Vector2(92, 92)
		clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, UiKit.mix(c, Color.WHITE, 0.55)], [0.6, c], [1.0, UiKit.mix(c, Color.BLACK, 0.55)]], Vector2(0.5, 0.35), Vector2(1.25, 0.35), true)))
		clip.add_child(_portrait_rect(key, 106, 92, 92, -8))
		av.add_child(clip)
		var rim := Panel.new()
		var rs := UiKit.sbox(Color(0, 0, 0, 0), 20, UiKit.INK, 3)
		rs.draw_center = false
		rim.add_theme_stylebox_override("panel", rs)
		rim.size = Vector2(92, 92)
		rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
		av.add_child(rim)
		ph.add_child(av)
	var id := _vbox(6 if phone else 10)
	id.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ph.add_child(id)
	var field := _vbox(4)
	field.add_child(_body(I18n.t("lobby.name"), 12, UiKit.WMUTED))
	_nick = LineEdit.new()
	_nick.text = Settings.nickname
	_nick.placeholder_text = I18n.t("lobby.namePlaceholder")
	_nick.max_length = 14
	_input_style(_nick, 15 if phone else 20)
	_nick.text_changed.connect(func(s: String): Settings.nickname = s)
	_nick.text_submitted.connect(func(_s: String): _commit_name())
	_nick.focus_exited.connect(_commit_name)
	field.add_child(_nick)
	id.add_child(field)
	if profile:
		var holder := _vbox(0)
		holder.add_child(_rank_row())
		id.add_child(holder)
		var refresh := func() -> void:
			for c in holder.get_children():
				c.queue_free()
			holder.add_child(_rank_row())
		profile.changed.connect(refresh)
		holder.tree_exiting.connect(func(): if profile.changed.is_connected(refresh): profile.changed.disconnect(refresh))
	# ranked
	var rk := _lj_box(UiKit.pads(UiKit.sbox(Color(1, 0.85, 0.4, 0.09), 14 if phone else 18, Color(1, 0.824, 0.247, 0.35), 2), 9 if phone else 14, 9 if phone else 14, 9 if phone else 14, 9 if phone else 14))
	rk.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_child(rk)
	var rv := _vbox(6 if phone else 10)
	rv.alignment = BoxContainer.ALIGNMENT_CENTER
	rk.add_child(rv)
	var chip := _body(I18n.t("lobby.ranked"), 11, UiKit.INK, 900, 0.6)
	chip.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(UiKit.YELLOW, 99), 10, 3, 10, 3))
	chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	rv.add_child(chip)
	var quick := _big(I18n.t("mm.quick"), 22 if phone else 34, 10 if phone else 14)
	quick.pressed.connect(func(): _commit_name(); quick_play.emit())
	var qpad := MarginContainer.new()
	qpad.add_theme_constant_override("margin_bottom", 6)
	qpad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	qpad.add_child(quick)
	rv.add_child(qpad)
	if not phone:
		rv.add_child(_emoji("🌐   🎮   🛒   🤖   🍏", 22))
		var hint := _body(I18n.t("mm.quickHint"), 13, UiKit.WMUTED, 700)
		hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		rv.add_child(hint)
	# friends
	var fr := _lj_box()
	fr.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var fv := _vbox(6 if phone else 10)
	fr.add_child(fv)
	fv.add_child(_body(I18n.t("lobby.friends"), 12, UiKit.WMUTED, 900, 1))
	var tiles := GridContainer.new()
	tiles.columns = 1 if phone else 2
	tiles.add_theme_constant_override("h_separation", 10)
	tiles.add_theme_constant_override("v_separation", 6 if phone else 10)
	tiles.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fv.add_child(tiles)
	var tile_s := func(hov: bool) -> StyleBox:
		return UiKit.pads(UiKit.sbox(Color(58 / 255.0, 48 / 255.0, 96 / 255.0, 0.95) if hov else Color(30 / 255.0, 26 / 255.0, 48 / 255.0, 0.92), 16, UiKit.INK, 3, UiKit.INK, 4, 1),
			10 if phone else 14, 6 if phone else 12, 10 if phone else 14, 6 if phone else 12)
	var create := _tap(tile_s.call(false), tile_s.call(true))
	create.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var ch := _hbox(8 if phone else 12)
	ch.add_child(_emoji("🏠", 20 if phone else 30))
	var cv := _vbox(2)
	cv.add_child(_disp(I18n.t("lobby.create"), 16 if phone else 22))
	var cd := _body(I18n.t("lobby.createDesc"), 10 if phone else 12, UiKit.WMUTED, 700)
	cd.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	cd.custom_minimum_size.x = 140
	cv.add_child(cd)
	ch.add_child(cv)
	create.add_child(ch)
	create.pressed.connect(func(): _commit_name(); dim.visible = false; create_room.emit())
	tiles.add_child(create)
	var join := _panel(tile_s.call(false))
	join.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var jh := _hbox(8 if phone else 12)
	jh.add_child(_emoji("🔑", 20 if phone else 30))
	var jv := _vbox(4)
	jv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var jd := _body(I18n.t("lobby.joinDesc"), 10 if phone else 12, UiKit.WMUTED, 700)
	jd.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	jv.add_child(jd)
	var jr := _hbox(10)
	_code_edit = LineEdit.new()
	_code_edit.placeholder_text = I18n.t("lobby.code")
	_code_edit.max_length = 6
	_code_edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
	_code_edit.custom_minimum_size.x = 90
	_code_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input_style(_code_edit, 15 if phone else 18)
	_code_edit.add_theme_font_override("font", UiKit.spaced(_fd(), 3))
	_code_edit.text_changed.connect(func(s: String):
		var up := s.to_upper()
		if up != s:
			_code_edit.text = up
			_code_edit.caret_column = up.length())
	jr.add_child(_code_edit)
	var jb := _ghost(I18n.t("lobby.join"), 14 if phone else 16)
	var go := func() -> void:
		var c := _code_edit.text.strip_edges().to_upper()
		if c.length() < 4:
			toast(I18n.t("lobby.enterCode"))
			return
		_commit_name()
		dim.visible = false
		join_room.emit(c)
	jb.pressed.connect(go)
	_code_edit.text_submitted.connect(func(_s: String): go.call())
	jr.add_child(jb)
	jv.add_child(jr)
	jh.add_child(jv)
	join.add_child(jh)
	tiles.add_child(join)
	if not phone:
		var hint := _body(I18n.t("lobby.hint"), 13, UiKit.WMUTED, 700)
		fv.add_child(hint)
		v.add_child(fr)
	else:
		grid.add_child(fr)
	return dim

# Rank emblem + "Gold · 620 RP" + bar (web .lj-rank)
func _rank_row() -> Control:
	var row := _hbox(10)
	var ranked := profile.matches > 0
	var tiers := {"bronze": "b06e3c", "silver": "97a0b9", "gold": "e6b428", "diamond": "46aae6", "mythic": "a05adc", "legend": "f05a50"}
	var em := Panel.new()
	var ed := 34.0 if phone else 44.0
	em.custom_minimum_size = Vector2(ed, ed)
	em.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	em.add_theme_stylebox_override("panel", UiKit.sbox(Color(tiers.get(profile.tier, "4a4266")) if ranked else Color("4a4266"), int(ed / 2), UiKit.INK, 3, UiKit.INK, 3, 1))
	em.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var el := _disp(profile.tier.left(1).to_upper() if ranked else "?", 16 if phone else 22, Color.WHITE, 4)
	el.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	el.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	el.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	em.add_child(el)
	row.add_child(em)
	var tv := _vbox(3)
	tv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tv.add_child(_disp(("%s · %d RP" % [I18n.t("rank." + profile.tier), profile.rp]) if ranked else I18n.t("rank.none"), 16 if phone else 20, UiKit.YELLOW))
	var sub := _body(profile.sub_text(), 12, UiKit.WMUTED, 700)
	sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tv.add_child(sub)
	var bar := _panel(UiKit.sbox(Color(0, 0, 0, 0.4), 4))
	bar.custom_minimum_size.y = 8
	var fill := Panel.new()
	fill.add_theme_stylebox_override("panel", UiKit.sbox(UiKit.YELLOW, 4))
	fill.anchor_bottom = 1.0
	fill.anchor_right = profile.progress()
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var holder := Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(fill)
	bar.add_child(holder)
	tv.add_child(bar)
	row.add_child(tv)
	return row

# The matchmaking queue (web #queue in the lobby card).
func _build_queue() -> Control:
	var o := _card(minf(620.0, W - 24.0), Color(38 / 255.0, 29 / 255.0, 72 / 255.0, 0.95), Color(18 / 255.0, 14 / 255.0, 34 / 255.0, 0.95), 18 if phone else 24, 0.55)
	var dim: Control = o[0]
	var v: VBoxContainer = o[1]
	v.add_child(_head(I18n.t("lobby.title"), func(): queue_cancel.emit()))
	var c := _vbox(4 if phone else 6)
	v.add_child(c)
	var dc := CenterContainer.new()
	dc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dc.add_child(MenuW.Dots.new())
	c.add_child(dc)
	var h3 := _disp(I18n.t("mm.searching"), 24 if phone else 30)
	h3.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(h3)
	_q_mode = _disp("", 16 if phone else 18, UiKit.TEAL, 0, 0.5)
	_q_mode.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(_q_mode)
	_q_count = _body("", 13 if phone else 18, UiKit.WTEXT, 900)
	_q_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(_q_count)
	var bc := CenterContainer.new()
	bc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bar := _panel(UiKit.sbox(Color("221d33"), 99, UiKit.INK, 2))
	bar.custom_minimum_size = Vector2(minf(360.0, W - 80.0), 12)
	_q_fill = Panel.new()
	_q_fill.add_theme_stylebox_override("panel", UiKit.sbox(UiKit.YELLOW, 99))
	_q_fill.anchor_bottom = 1.0
	_q_fill.anchor_right = 0.0
	_q_fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var holder := Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(_q_fill)
	bar.add_child(holder)
	bc.add_child(bar)
	var bm := MarginContainer.new()
	bm.add_theme_constant_override("margin_top", 6 if phone else 12)
	bm.add_theme_constant_override("margin_bottom", 6 if phone else 12)
	bm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bm.add_child(bc)
	c.add_child(bm)
	_q_meta = _body("", 13 if phone else 15, UiKit.WMUTED, 700)
	_q_meta.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(_q_meta)
	_q_plats = _body("", 13 if phone else 15, UiKit.WMUTED, 700)
	_q_plats.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(_q_plats)
	var row := _hbox(14)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	var bots := _big(I18n.t("mm.playNow"), 18 if phone else 22, 8 if phone else 10)
	bots.pressed.connect(func(): queue_bots.emit())
	row.add_child(bots)
	var cancel := _ghost(I18n.t("mm.cancel"), 15 if phone else 20)
	cancel.pressed.connect(func(): queue_cancel.emit())
	row.add_child(cancel)
	var rm := MarginContainer.new()
	rm.add_theme_constant_override("margin_top", 4 if phone else 10)
	rm.add_theme_constant_override("margin_bottom", 6)
	rm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rm.add_child(row)
	c.add_child(rm)
	return dim

# Options (web #options .opt-card): sections of rows, label on the left, control on the right.
func _build_settings() -> Control:
	var dim := Control.new()
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.visible = false
	var shade := ColorRect.new()
	shade.color = Color(8 / 255.0, 6 / 255.0, 18 / 255.0, 0.72)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim.add_child(shade)
	var cw := minf(880.0, W - 24.0)
	var chh := minf(760.0, H - (16.0 if phone else 48.0))
	var card := _panel(UiKit.sbox(Color(22 / 255.0, 18 / 255.0, 36 / 255.0, 0.96), 18, UiKit.INK, 3, UiKit.INK, 8, 1))
	card.position = Vector2((W - cw) / 2.0, (H - chh) / 2.0)
	card.size = Vector2(cw, chh)
	card.custom_minimum_size = Vector2(cw, chh)
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.add_child(card)
	var col := _vbox(0)
	card.add_child(col)
	var head := MarginContainer.new()
	head.mouse_filter = Control.MOUSE_FILTER_IGNORE
	head.add_theme_constant_override("margin_left", 22)
	head.add_theme_constant_override("margin_right", 22)
	head.add_theme_constant_override("margin_top", 8 if phone else 18)
	head.add_theme_constant_override("margin_bottom", 8 if phone else 12)
	var title := _disp(I18n.t("opt.title"), 24 if phone else 40, UiKit.YELLOW, 6)
	title.add_theme_color_override("font_shadow_color", UiKit.INK)
	title.add_theme_constant_override("shadow_offset_y", 4)
	title.add_theme_constant_override("shadow_offset_x", 0)
	title.add_theme_constant_override("shadow_outline_size", 6)
	head.add_child(title)
	col.add_child(head)
	var line := ColorRect.new()
	line.color = UiKit.INK
	line.custom_minimum_size.y = 3
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(line)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(scroll)
	var bm := MarginContainer.new()
	bm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bm.add_theme_constant_override("margin_left", 22)
	bm.add_theme_constant_override("margin_right", 22)
	bm.add_theme_constant_override("margin_top", 4)
	bm.add_theme_constant_override("margin_bottom", 10)
	scroll.add_child(bm)
	var body := _vbox(2)
	bm.add_child(body)
	var section := func(t: String) -> void:
		var l := _disp(t.to_upper(), 14, Color(UiKit.YELLOW, 0.85), 0, 1)
		var m := MarginContainer.new()
		m.add_theme_constant_override("margin_top", 14)
		m.add_theme_constant_override("margin_bottom", 4)
		m.mouse_filter = Control.MOUSE_FILTER_IGNORE
		m.add_child(l)
		body.add_child(m)
	var opt_row := func(label: String, ctrl: Control) -> void:
		var p := _panel(UiKit.pads(UiKit.sbox(Color(0, 0, 0, 0), 10), 12, 7, 12, 7))
		var h := _hbox(16)
		var l := _body(label, 15, UiKit.WTEXT, 800)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		h.add_child(l)
		ctrl.custom_minimum_size.x = maxf(ctrl.custom_minimum_size.x, minf(300.0, cw * 0.45))
		h.add_child(ctrl)
		p.add_child(h)
		body.add_child(p)
	var seg_style := func(on: bool) -> StyleBox:
		return UiKit.pads(UiKit.sbox(UiKit.YELLOW if on else Color("2d2742"), 8, UiKit.INK, 2), 6, 6, 6, 6)
	# general
	section.call(I18n.t("opt.tab.general"))
	var lang := OptionButton.new()
	lang.add_theme_font_override("font", _fd())
	lang.add_theme_font_size_override("font_size", 17)
	lang.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color("2d2742"), 8, UiKit.INK, 2), 10, 6, 10, 6))
	lang.add_theme_stylebox_override("hover", UiKit.pads(UiKit.sbox(Color("3a3258"), 8, UiKit.INK, 2), 10, 6, 10, 6))
	lang.add_theme_stylebox_override("pressed", UiKit.pads(UiKit.sbox(Color("3a3258"), 8, UiKit.YELLOW, 2), 10, 6, 10, 6))
	lang.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	lang.add_item(I18n.t("opt.language.auto"))
	lang.set_item_metadata(0, "")
	var sel := 0
	for l in I18n.languages():
		var d: Dictionary = l
		lang.add_item(String(d.name))
		lang.set_item_metadata(lang.item_count - 1, String(d.code))
		if String(d.code) == Settings.lang:
			sel = lang.item_count - 1
	lang.select(sel)
	lang.item_selected.connect(func(i: int):
		Settings.lang = String(lang.get_item_metadata(i))
		Settings.save()
		settings_changed.emit())
	opt_row.call(I18n.t("g.language"), lang)
	# graphics
	section.call(I18n.t("opt.tab.graphics"))
	var grow := _hbox(6)
	var gbtns: Dictionary = {}
	for gq in Settings.GFX:
		var b := _tap(seg_style.call(gq == Settings.gfx))
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var gl := _disp(I18n.t("g.gfx." + String(gq)), 13, UiKit.INK if gq == Settings.gfx else UiKit.WTEXT)
		gl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		b.add_child(gl)
		b.pressed.connect(func():
			Settings.gfx = String(gq)
			Settings.save()
			for k in gbtns:
				(gbtns[k][0] as MenuTap).set_styles(seg_style.call(k == gq))
				(gbtns[k][1] as Label).add_theme_color_override("font_color", UiKit.INK if k == gq else UiKit.WTEXT)
			settings_changed.emit())
		grow.add_child(b)
		gbtns[gq] = [b, gl]
	opt_row.call(I18n.t("g.gfx"), grow)
	var saver := MenuW.Switch.new()
	saver.on = Settings.saver
	var saver_tap := _tap(StyleBoxEmpty.new())
	var sc := _hbox(0)
	sc.alignment = BoxContainer.ALIGNMENT_END
	sc.add_child(saver)
	saver_tap.add_child(sc)
	saver_tap.pressed.connect(func():
		Settings.saver = not Settings.saver
		saver.on = Settings.saver
		saver.queue_redraw()
		Settings.save()
		settings_changed.emit())
	opt_row.call("%s  (%s)" % [I18n.t("g.saver"), I18n.t("g.saverDesc")], saver_tap)
	# audio
	section.call(I18n.t("opt.tab.audio"))
	for spec in [["opt.vol.master", "master"], ["opt.vol.music", "music"], ["opt.vol.sfx", "sfx"]]:
		var vrow := _hbox(12)
		var sl := HSlider.new()
		sl.min_value = 0.0
		sl.max_value = 1.0
		sl.step = 0.05
		sl.value = Settings.volume(String(spec[1]))
		sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		sl.custom_minimum_size.y = 24
		sl.add_theme_stylebox_override("slider", UiKit.pads(UiKit.sbox(Color("2d2742"), 7, UiKit.INK, 2), 0, 7, 0, 7))
		sl.add_theme_stylebox_override("grabber_area", UiKit.pads(UiKit.sbox(Color("ffbf1f"), 7, UiKit.INK, 2), 0, 7, 0, 7))
		sl.add_theme_stylebox_override("grabber_area_highlight", UiKit.pads(UiKit.sbox(Color("ffe36b"), 7, UiKit.INK, 2), 0, 7, 0, 7))
		var img := Image.create(4, 14, false, Image.FORMAT_RGBA8)   # the web's bar has no knob
		img.fill(Color(0, 0, 0, 0))
		var knob := ImageTexture.create_from_image(img)
		sl.add_theme_icon_override("grabber", knob)
		sl.add_theme_icon_override("grabber_highlight", knob)
		var val := _disp("%d%%" % roundi(sl.value * 100), 15)
		val.custom_minimum_size.x = 54
		val.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		sl.value_changed.connect(func(x: float):
			Settings.set_volume(String(spec[1]), x)
			val.text = "%d%%" % roundi(x * 100))
		sl.drag_ended.connect(func(_c: bool): Settings.save())
		vrow.add_child(sl)
		vrow.add_child(val)
		opt_row.call(I18n.t(String(spec[0])), vrow)
	# profile icon
	section.call(I18n.t("g.looks"))
	var irow := _hbox(8)
	var ibtns: Array = []
	for i in 5:
		var on := i == Settings.icon
		var ib := _tap(UiKit.sbox(Color(1, 1, 1, 0.08), 12, UiKit.YELLOW if on else UiKit.INK, 3))
		ib.custom_minimum_size = Vector2(52, 52)
		var clip := UiKit.clip_box(10)
		clip.add_child(_portrait_rect(String(["blaster", "gunslinger", "bomber", "frostbite", "volt"][i]), 60, 52, 52, -14))
		ib.add_child(clip)
		ib.pressed.connect(func():
			Settings.icon = i
			Settings.save()
			for j in ibtns.size():
				(ibtns[j] as MenuTap).set_styles(UiKit.sbox(Color(1, 1, 1, 0.08), 12, UiKit.YELLOW if j == i else UiKit.INK, 3))
			profile_changed.emit())
		irow.add_child(ib)
		ibtns.append(ib)
	opt_row.call(I18n.t("meta.profile"), irow)
	# server
	section.call(I18n.t("g.server"))
	var srv := LineEdit.new()
	srv.text = Settings.server
	srv.placeholder_text = "wss://…"
	_input_style(srv, 15)
	srv.add_theme_font_override("font", _fb(800))
	srv.text_changed.connect(func(s: String): Settings.server = s)
	srv.focus_exited.connect(func(): Settings.save(); settings_changed.emit())
	srv.text_submitted.connect(func(_s: String): Settings.save(); settings_changed.emit())
	opt_row.call(I18n.t("g.serverHint"), srv)
	# foot
	var foot := MarginContainer.new()
	foot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	foot.add_theme_constant_override("margin_left", 22)
	foot.add_theme_constant_override("margin_right", 22)
	foot.add_theme_constant_override("margin_top", 8)
	foot.add_theme_constant_override("margin_bottom", 10 if phone else 16)
	var fh := _hbox(10)
	fh.alignment = BoxContainer.ALIGNMENT_END
	var close := _big(I18n.t("g.close"), 16 if phone else 20, 6 if phone else 8)
	close.pressed.connect(func(): dim.visible = false; Settings.save())
	fh.add_child(close)
	foot.add_child(fh)
	col.add_child(foot)
	return dim

# ---------------------------------------------------------------- API used by main.gd

func toast(msg: String, secs: float = 4.0) -> void:
	if _toast == null:
		return
	_toast.text = msg
	_toast.visible = msg != ""
	_toast.size.y = 0
	_toast_t = secs

func show_queue(on: bool) -> void:
	if _queue == null:
		return
	_queue.visible = on
	if on:
		_room_dialog.visible = false
		_settings.visible = false
		_q_mode.text = I18n.t("menu.duo") if Settings.mode == "duo" else I18n.t("menu.mode")
		_q_count.text = I18n.t("lobby.connecting")
		_q_fill.anchor_right = 0.0
		_q_meta.text = ""
		_q_plats.text = ""

func update_queue(m: Dictionary) -> void:
	var n := int(m.get("n", 0))
	var need := maxi(int(m.get("need", 8)), 1)
	_q_count.text = I18n.t("mm.inQueue", {"n": n, "need": need})
	_q_fill.anchor_right = clampf(float(n) / float(need), 0.0, 1.0)
	_q_fill.offset_right = 0
	_q_meta.text = "%s · %s" % [I18n.t("mm.waited", {"time": _clock(float(m.get("waited", 0)))}), I18n.t("mm.botsIn", {"time": _clock(float(m.get("botsIn", 0)))})]
	var plats: Dictionary = m.get("plats", {})
	var parts: PackedStringArray = []
	for k in plats:
		parts.append("%s %d" % [String(k).to_upper(), int(plats[k])])
	_q_plats.text = "   ".join(parts)

func close_overlays() -> void:
	_settings.visible = false
	_room_dialog.visible = false
	_queue.visible = false
	_maps_pop.visible = false

func is_overlay_open() -> bool:
	return _settings.visible or _room_dialog.visible or _queue.visible or _maps_pop.visible or _page_view.visible

func set_backdrop(live: bool) -> void:
	var s := _page.get_node_or_null("Solid") if _page else null
	if s:
		(s as CanvasItem).visible = not live

func _clock(ms: float) -> String:
	var s := maxi(0, roundi(ms / 1000.0))
	return "%d:%02d" % [s / 60, s % 60]

func _process(delta: float) -> void:
	if _toast_t > 0.0:
		_toast_t -= delta
		if _toast_t <= 0.0 and _toast:
			_toast.visible = false

func _unhandled_input(ev: InputEvent) -> void:
	if not visible:
		return
	if ev is InputEventMouseButton and ev.pressed and _maps_pop and _maps_pop.visible:
		_maps_pop.visible = false
		_refresh_map()
	if ev.is_action_pressed("ui_cancel") and is_overlay_open():
		if _queue.visible:
			queue_cancel.emit()
		elif _page_view.visible:
			_open_page("play")
		else:
			close_overlays()
			_refresh_map()
		get_viewport().set_input_as_handled()

# Layout check (`-- --menushot=... --menudump`): CSS rects of the main blocks, to compare with the web.
func _dump() -> void:
	var r := func(c: Control) -> String:
		if c == null or not c.is_visible_in_tree():
			return "-"
		var g := c.get_global_rect()
		return "%d,%d,%d,%d" % [roundi(g.position.x / _k), roundi(g.position.y / _k), roundi(g.size.x / _k), roundi(g.size.y / _k)]
	var o := {"hero": r.call(_hero), "role": r.call(_role), "name": r.call(_name), "loadout": r.call(_loadout), "picker": r.call(_picker),
		"skinbar": r.call(_skin_row), "hs": r.call(_skin_track.get_child(0) if _skin_track.get_child_count() > 0 else null),
		"rt": r.call(_roster_tiles[Settings.brawler][0]), "mode": r.call(_mode_btns["solo"]), "map": r.call(_map_btn), "chaos": r.call(_chaos_btn)}
	print("MENUDUMP ", o)
