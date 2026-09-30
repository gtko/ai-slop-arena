class_name MainMenu
extends Control
# The main menu: brawler roster + 3D preview, loadout (gadget A/B x star power 1/2), map info, mode,
# QUICK PLAY (matchmaking queue), PRIVATE ROOM (create / join by code), settings, rank card.
# Built from code; laid out for a 1280x720 base and wider (canvas_items stretch, aspect expand).
# main.gd listens to the signals and owns the connections; this class only shows and edits Settings.

signal quick_play
signal create_room
signal join_room(code: String)
signal queue_bots
signal queue_cancel
signal settings_changed          # language / graphics / saver / volumes / server changed
signal profile_changed           # brawler, loadout, nickname or looks changed (a room learns it via "pick")

# Star power ids of each brawler (src/gadgets.js STARS): index 0 = star 1, index 1 = star 2.
const STAR_IDS := {
	"blaster": ["sapRegen", "splinters"], "gunslinger": ["steadyAim", "axoRegen"], "bomber": ["magmaPuddle", "bigBang"],
	"frostbite": ["deepFreeze", "permafrost"], "volt": ["conductor", "surge"], "kappa": ["hydrotherapy", "undertow"],
	"pipchomp": ["huntersNose", "hungry"], "mochi": ["heavyweight", "secondHelping"]}
const MAP_ORDER := ["random", "oasis", "dunes", "grove", "frost", "marsh", "isles"]

var profile: Profile
var preview: HeroPreview
var _keys: Array = []
var _roster_buttons: Dictionary = {}
var _hero_name: Label
var _hero_stats: Label
var _hero_desc: Label
var _gadget_buttons: Array[Button] = []
var _star_buttons: Array[Button] = []
var _loadout_desc: Label
var _nick: LineEdit
var _mode_buttons: Dictionary = {}
var _map_img: TextureRect
var _map_name: Label
var _map_tag: Label
var _quick_btn: Button
var _private_btn: Button
var _toast: Label
var _toast_t := 0.0
var _root_margin: MarginContainer
var _settings: Control
var _room_dialog: Control
var _code_edit: LineEdit
var _queue: Control
var _q_count: Label
var _q_time: Label
var _q_bots_in: Label
var _q_plats: Label
var _q_fill: ProgressBar
var _q_bots_btn: Button
var _build_done := false

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	_keys = GameData.brawlers.keys()
	if not _keys.has(Settings.brawler):
		Settings.brawler = _keys[0]
	build()

# (Re)builds every control; called again when the language changes.
func build() -> void:
	for c in get_children():
		c.queue_free()
	_roster_buttons.clear()
	_gadget_buttons.clear()
	_star_buttons.clear()
	_mode_buttons.clear()
	var bg := ColorRect.new()
	bg.color = UiKit.BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	var glow := TextureRect.new()      # a soft light behind the hero, tinted by the brawler
	glow.name = "Glow"
	glow.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 1, 1, 0.22))
	grad.set_color(1, Color(1, 1, 1, 0))
	var gt := GradientTexture2D.new()
	gt.gradient = grad
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.2, 0.42)
	gt.fill_to = Vector2(0.75, 0.42)
	gt.width = 256
	gt.height = 128
	glow.texture = gt
	glow.stretch_mode = TextureRect.STRETCH_SCALE
	glow.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	add_child(glow)
	_root_margin = MarginContainer.new()
	_root_margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_root_margin)
	_apply_insets()
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	_root_margin.add_child(col)
	col.add_child(_build_top_bar())
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 18)
	col.add_child(body)
	body.add_child(_build_hero_column())
	body.add_child(_build_center_column())
	body.add_child(_build_play_column())
	_toast = UiKit.label("", 22, UiKit.ACCENT, HORIZONTAL_ALIGNMENT_CENTER)
	_toast.add_theme_stylebox_override("normal", UiKit.box(Color(0, 0, 0, 0.75), 12, Color(0, 0, 0, 0), 0, 10))
	_toast.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_toast.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_toast.custom_minimum_size.x = 640
	_toast.visible = false
	add_child(_toast)
	_settings = _build_settings()
	add_child(_settings)
	_room_dialog = _build_room_dialog()
	add_child(_room_dialog)
	_queue = _build_queue()
	add_child(_queue)
	_select_brawler(Settings.brawler, false)
	_refresh_mode()
	_refresh_map()
	_build_done = true

func _apply_insets() -> void:
	var ins := UiKit.safe_insets(get_viewport())
	_root_margin.add_theme_constant_override("margin_left", int(ins.x))
	_root_margin.add_theme_constant_override("margin_top", int(ins.y))
	_root_margin.add_theme_constant_override("margin_right", int(ins.z))
	_root_margin.add_theme_constant_override("margin_bottom", int(ins.w))

func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and _root_margin != null:
		_apply_insets()

# ---------------------------------------------------------------- top bar

func _build_top_bar() -> Control:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 16)
	var title := UiKit.label("AI SLOP ARENA", 38, UiKit.ACCENT)
	title.add_theme_constant_override("outline_size", 6)
	title.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.6))
	bar.add_child(title)
	bar.add_child(UiKit.spacer(0, true))
	if profile:
		var card := profile.make_card()
		card.custom_minimum_size.x = 360
		bar.add_child(card)
	var gear := UiKit.button(I18n.t("g.settings"), "secondary", 60, 20)
	gear.custom_minimum_size.x = 170
	gear.pressed.connect(func(): _settings.visible = true)
	bar.add_child(gear)
	return bar

# ---------------------------------------------------------------- left: hero

func _build_hero_column() -> Control:
	var p := UiKit.panel(UiKit.PANEL, 20, 14)
	p.custom_minimum_size.x = 350
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	p.add_child(v)
	preview = HeroPreview.new()
	preview.size_flags_vertical = Control.SIZE_EXPAND_FILL
	preview.custom_minimum_size = Vector2(300, 220)
	v.add_child(preview)
	_hero_name = UiKit.label("", 34, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(_hero_name)
	_hero_stats = UiKit.label("", 18, UiKit.ACCENT, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(_hero_stats)
	_hero_desc = UiKit.label("", 16, UiKit.MUTED)
	_hero_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_hero_desc.custom_minimum_size = Vector2(300, 96)
	_hero_desc.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	v.add_child(_hero_desc)
	return p

# ---------------------------------------------------------------- middle: roster + loadout

func _build_center_column() -> Control:
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_theme_constant_override("separation", 10)
	v.add_child(UiKit.label(I18n.t("g.brawlers"), 20, UiKit.MUTED))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(grid)
	for k in _keys:
		grid.add_child(_roster_tile(String(k)))
	v.add_child(UiKit.label(I18n.t("g.loadout"), 20, UiKit.MUTED))
	var lp := UiKit.panel(UiKit.PANEL, 18, 12)
	v.add_child(lp)
	var lv := VBoxContainer.new()
	lv.add_theme_constant_override("separation", 8)
	lp.add_child(lv)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	lv.add_child(row)
	for i in 2:
		var b := UiKit.button("", "secondary", 56, 17)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.clip_text = true
		b.toggle_mode = true
		b.pressed.connect(_on_gadget.bind(i))
		row.add_child(b)
		_gadget_buttons.append(b)
	var row2 := HBoxContainer.new()
	row2.add_theme_constant_override("separation", 10)
	lv.add_child(row2)
	for i in 2:
		var b := UiKit.button("", "secondary", 56, 17)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.clip_text = true
		b.toggle_mode = true
		b.pressed.connect(_on_star.bind(i))
		row2.add_child(b)
		_star_buttons.append(b)
	_loadout_desc = UiKit.label("", 15, UiKit.MUTED)
	_loadout_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_loadout_desc.custom_minimum_size.y = 0
	lv.add_child(_loadout_desc)
	return v

func _roster_tile(key: String) -> Control:
	var b := Button.new()
	b.toggle_mode = true
	b.custom_minimum_size = Vector2(0, 96)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.size_flags_vertical = Control.SIZE_EXPAND_FILL
	b.clip_contents = true
	b.text = ""
	var pal: Dictionary = GameData.brawlers[key].palette
	var c := GameData.color_of(pal.main)
	for st in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		var sel: bool = st == "pressed" or st == "hover_pressed"
		var s := UiKit.box(c.darkened(0.55).lerp(UiKit.PANEL, 0.4), 16, UiKit.ACCENT if sel else Color(1, 1, 1, 0.08), 4 if sel else 1)
		if st == "focus":
			s = UiKit.box(Color(0, 0, 0, 0), 16, UiKit.ACCENT, 3)
		b.add_theme_stylebox_override(st, s)
	var tex := TextureRect.new()
	tex.texture = UiKit.portrait(key)
	tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tex.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tex.offset_bottom = -26
	tex.offset_top = 4
	tex.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(tex)
	var nm := UiKit.label(String(GameData.brawlers[key].name), 17, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	nm.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	nm.offset_top = -28
	nm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(nm)
	b.pressed.connect(func(): _select_brawler(key, true))
	_roster_buttons[key] = b
	return b

func _select_brawler(key: String, user: bool) -> void:
	Settings.brawler = key
	for k in _roster_buttons:
		(_roster_buttons[k] as Button).set_pressed_no_signal(k == key)
	var t: Dictionary = GameData.brawlers[key]
	_hero_name.text = String(t.name).to_upper()
	_hero_stats.text = I18n.t("g.roleStats", {"role": I18n.t("brawler.%s.role" % key), "hp": int(t.hp), "range": snappedf(float(t.range), 0.1)})
	_hero_desc.text = I18n.t("brawler.%s.desc" % key)
	preview.show_brawler(key)
	var pal: Dictionary = t.palette
	var glow := get_node_or_null("Glow") as TextureRect
	if glow:
		glow.modulate = GameData.color_of(pal.main).lightened(0.2)
	_refresh_loadout()
	if user:
		Settings.save()
		profile_changed.emit()

func _on_gadget(i: int) -> void:
	var lo := Settings.loadout_of(Settings.brawler)
	Settings.set_loadout(Settings.brawler, "AB"[i] + lo[1])
	_refresh_loadout()
	Settings.save()
	profile_changed.emit()

func _on_star(i: int) -> void:
	var lo := Settings.loadout_of(Settings.brawler)
	Settings.set_loadout(Settings.brawler, lo[0] + "12"[i])
	_refresh_loadout()
	Settings.save()
	profile_changed.emit()

func _refresh_loadout() -> void:
	var key := Settings.brawler
	var lo := Settings.loadout_of(key)
	var gi := "AB".find(lo[0])
	var si := "12".find(lo[1])
	var stars: Array = STAR_IDS.get(key, ["", ""])
	for i in 2:
		var gk := "gad.%s%s" % [key, "AB"[i]]
		_gadget_buttons[i].text = "%s  %s" % ["AB"[i], I18n.t(gk + ".name")]
		_gadget_buttons[i].set_pressed_no_signal(i == gi)
		UiKit.restyle(_gadget_buttons[i], "primary" if i == gi else "secondary")
		_star_buttons[i].text = "%d  %s" % [i + 1, I18n.t("star.%s.name" % stars[i])]
		_star_buttons[i].set_pressed_no_signal(i == si)
		UiKit.restyle(_star_buttons[i], "primary" if i == si else "secondary")
	_loadout_desc.text = "%s: %s\n%s: %s" % [I18n.t("menu.gadget"), I18n.t("gad.%s%s.desc" % [key, "AB"[gi]]),
		I18n.t("menu.star"), I18n.t("star.%s.desc" % stars[si])]

# ---------------------------------------------------------------- right: play

func _build_play_column() -> Control:
	var v := VBoxContainer.new()
	v.custom_minimum_size.x = 370
	v.add_theme_constant_override("separation", 10)
	v.add_child(UiKit.label(I18n.t("g.nickname"), 20, UiKit.MUTED))
	_nick = UiKit.line_edit(Settings.nickname, I18n.t("lobby.namePlaceholder"), 14)
	_nick.text_changed.connect(func(s: String): Settings.nickname = s)
	_nick.text_submitted.connect(func(_s: String): _commit_name())
	_nick.focus_exited.connect(_commit_name)
	v.add_child(_nick)
	# mode
	var mrow := HBoxContainer.new()
	mrow.add_theme_constant_override("separation", 8)
	v.add_child(mrow)
	for m in ["solo", "duo"]:
		var b := UiKit.button(I18n.t("menu.mode") if m == "solo" else I18n.t("menu.duo"), "secondary", 56, 20)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.toggle_mode = true
		b.pressed.connect(func(): Settings.mode = m; Settings.save(); _refresh_mode())
		mrow.add_child(b)
		_mode_buttons[m] = b
	# map info
	var mp := UiKit.panel(UiKit.PANEL, 16, 10)
	v.add_child(mp)
	var mh := HBoxContainer.new()
	mh.add_theme_constant_override("separation", 10)
	mp.add_child(mh)
	var prev := UiKit.button("<", "ghost", 64, 26)
	prev.custom_minimum_size.x = 44
	prev.pressed.connect(func(): _step_map(-1))
	mh.add_child(prev)
	_map_img = TextureRect.new()
	_map_img.custom_minimum_size = Vector2(96, 96)
	_map_img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_map_img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	mh.add_child(_map_img)
	var mv := VBoxContainer.new()
	mv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mv.alignment = BoxContainer.ALIGNMENT_CENTER
	mh.add_child(mv)
	_map_name = UiKit.label("", 22, UiKit.TEXT)
	_map_name.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	mv.add_child(_map_name)
	_map_tag = UiKit.label("", 15, UiKit.MUTED)
	_map_tag.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	mv.add_child(_map_tag)
	var next := UiKit.button(">", "ghost", 64, 26)
	next.custom_minimum_size.x = 44
	next.pressed.connect(func(): _step_map(1))
	mh.add_child(next)
	v.add_child(UiKit.spacer(0, true))
	_quick_btn = UiKit.button(I18n.t("g.quick"), "primary", 88, 36)
	_quick_btn.pressed.connect(func(): _commit_name(); quick_play.emit())
	v.add_child(_quick_btn)
	var qs := UiKit.label(I18n.t("g.quickSub"), 14, UiKit.MUTED, HORIZONTAL_ALIGNMENT_CENTER)
	qs.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(qs)
	_private_btn = UiKit.button(I18n.t("g.private"), "secondary", 68, 24)
	_private_btn.pressed.connect(func(): _commit_name(); _room_dialog.visible = true)
	v.add_child(_private_btn)
	return v

func _commit_name() -> void:
	Settings.nickname = _nick.text.strip_edges()
	Settings.save()
	profile_changed.emit()

func _refresh_mode() -> void:
	for m in _mode_buttons:
		var b := _mode_buttons[m] as Button
		b.set_pressed_no_signal(m == Settings.mode)
		UiKit.restyle(b, "primary" if m == Settings.mode else "secondary")

func _step_map(d: int) -> void:
	var i := MAP_ORDER.find(Settings.map)
	Settings.map = MAP_ORDER[posmod(i + d, MAP_ORDER.size())]
	Settings.save()
	_refresh_map()

func _refresh_map() -> void:
	var m := Settings.map if MAP_ORDER.has(Settings.map) else "random"
	_map_name.text = I18n.t("map." + m)
	_map_tag.text = I18n.t("map.%s.tag" % m)
	var path := "res://assets/ui/map_%s.jpg" % m
	_map_img.texture = load(path) as Texture2D if ResourceLoader.exists(path) else null

# ---------------------------------------------------------------- overlays

func _overlay(title: String, width: float = 640.0) -> Array:
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.72)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.visible = false
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.add_child(center)
	var p := UiKit.panel(UiKit.PANEL, 22, 22)
	p.custom_minimum_size.x = width
	center.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	p.add_child(v)
	v.add_child(UiKit.label(title, 30, UiKit.ACCENT, HORIZONTAL_ALIGNMENT_CENTER))
	return [dim, v]

func _build_room_dialog() -> Control:
	var o := _overlay(I18n.t("g.private"), 560)
	var dim: Control = o[0]
	var v: VBoxContainer = o[1]
	var sub := UiKit.label(I18n.t("g.privateSub"), 18, UiKit.MUTED, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(sub)
	var create := UiKit.button(I18n.t("lobby.create"), "primary", 76, 30)
	create.pressed.connect(func(): dim.visible = false; create_room.emit())
	v.add_child(create)
	v.add_child(UiKit.label(I18n.t("lobby.joinDesc"), 18, UiKit.MUTED, HORIZONTAL_ALIGNMENT_CENTER))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	v.add_child(row)
	_code_edit = UiKit.line_edit("", I18n.t("g.joinCode"), 6)
	_code_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_code_edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
	_code_edit.text_changed.connect(func(s: String):
		var up := s.to_upper()
		if up != s:
			_code_edit.text = up
			_code_edit.caret_column = up.length())
	row.add_child(_code_edit)
	var join := UiKit.button(I18n.t("lobby.join"), "secondary", 56, 24)
	join.custom_minimum_size.x = 150
	var go := func() -> void:
		var c := _code_edit.text.strip_edges().to_upper()
		if c.length() < 4:
			toast(I18n.t("lobby.enterCode"))
			return
		dim.visible = false
		join_room.emit(c)
	join.pressed.connect(go)
	_code_edit.text_submitted.connect(func(_s: String): go.call())
	row.add_child(join)
	var back := UiKit.button(I18n.t("g.close"), "ghost", 56, 20)
	back.pressed.connect(func(): dim.visible = false)
	v.add_child(back)
	return dim

func _build_queue() -> Control:
	var o := _overlay(I18n.t("g.queueTitle"), 600)
	var dim: Control = o[0]
	var v: VBoxContainer = o[1]
	_q_count = UiKit.label("", 26, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(_q_count)
	_q_fill = ProgressBar.new()
	_q_fill.custom_minimum_size.y = 16
	_q_fill.show_percentage = false
	_q_fill.max_value = 1.0
	_q_fill.add_theme_stylebox_override("fill", UiKit.box(UiKit.ACCENT, 8))
	_q_fill.add_theme_stylebox_override("background", UiKit.box(Color(1, 1, 1, 0.1), 8))
	v.add_child(_q_fill)
	_q_time = UiKit.label("", 20, UiKit.MUTED, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(_q_time)
	_q_bots_in = UiKit.label("", 20, UiKit.MUTED, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(_q_bots_in)
	_q_plats = UiKit.label("", 18, UiKit.MUTED, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(_q_plats)
	_q_bots_btn = UiKit.button(I18n.t("mm.playNow"), "primary", 72, 26)
	_q_bots_btn.pressed.connect(func(): queue_bots.emit())
	v.add_child(_q_bots_btn)
	var cancel := UiKit.button(I18n.t("mm.cancel"), "secondary", 60, 22)
	cancel.pressed.connect(func(): queue_cancel.emit())
	v.add_child(cancel)
	return dim

func _build_settings() -> Control:
	var o := _overlay(I18n.t("g.settings"), 760)
	var dim: Control = o[0]
	var v: VBoxContainer = o[1]
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 470)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(scroll)
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 10)
	scroll.add_child(body)
	# language
	body.add_child(UiKit.label(I18n.t("g.language"), 20, UiKit.MUTED))
	var lang := OptionButton.new()
	lang.custom_minimum_size.y = 56
	lang.add_theme_font_size_override("font_size", 22)
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
	body.add_child(lang)
	# graphics
	body.add_child(UiKit.label(I18n.t("g.gfx"), 20, UiKit.MUTED))
	var grow := HBoxContainer.new()
	grow.add_theme_constant_override("separation", 8)
	body.add_child(grow)
	var gbtns: Dictionary = {}
	for g in Settings.GFX:
		var b := UiKit.button(I18n.t("g.gfx." + String(g)), "secondary", 52, 20)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.toggle_mode = true
		b.set_pressed_no_signal(g == Settings.gfx)
		UiKit.restyle(b, "primary" if g == Settings.gfx else "secondary")
		b.pressed.connect(func():
			Settings.gfx = String(g)
			Settings.save()
			for k in gbtns:
				(gbtns[k] as Button).set_pressed_no_signal(k == g)
				UiKit.restyle(gbtns[k], "primary" if k == g else "secondary")
			settings_changed.emit())
		grow.add_child(b)
		gbtns[g] = b
	var saver := CheckButton.new()
	saver.text = "%s  (%s)" % [I18n.t("g.saver"), I18n.t("g.saverDesc")]
	saver.add_theme_font_size_override("font_size", 20)
	saver.custom_minimum_size.y = 52
	saver.button_pressed = Settings.saver
	saver.toggled.connect(func(on: bool):
		Settings.saver = on
		Settings.save()
		settings_changed.emit())
	body.add_child(saver)
	# volumes
	for spec in [["opt.vol.master", "master"], ["opt.vol.music", "music"], ["opt.vol.sfx", "sfx"]]:
		var vrow := HBoxContainer.new()
		vrow.add_theme_constant_override("separation", 12)
		body.add_child(vrow)
		var lb := UiKit.label(I18n.t(String(spec[0])), 20, UiKit.TEXT)
		lb.custom_minimum_size.x = 250
		vrow.add_child(lb)
		var sl := HSlider.new()
		sl.min_value = 0.0
		sl.max_value = 1.0
		sl.step = 0.05
		sl.value = Settings.volume(String(spec[1]))
		sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sl.custom_minimum_size.y = 44
		sl.value_changed.connect(func(x: float):
			Settings.set_volume(String(spec[1]), x))
		sl.drag_ended.connect(func(_c: bool): Settings.save())
		vrow.add_child(sl)
	# profile icon
	body.add_child(UiKit.label(I18n.t("g.looks"), 20, UiKit.MUTED))
	var irow := HBoxContainer.new()
	irow.add_theme_constant_override("separation", 8)
	body.add_child(irow)
	var ibtns: Array[Button] = []
	for i in mini(5, _keys.size()):
		var ib := Button.new()
		ib.toggle_mode = true
		ib.icon = UiKit.portrait(String(["blaster", "gunslinger", "bomber", "frostbite", "volt"][i]))
		ib.expand_icon = true
		ib.custom_minimum_size = Vector2(76, 76)
		ib.set_pressed_no_signal(i == Settings.icon)
		UiKit.restyle(ib, "primary" if i == Settings.icon else "secondary")
		ib.pressed.connect(func():
			Settings.icon = i
			Settings.save()
			for j in ibtns.size():
				ibtns[j].set_pressed_no_signal(j == i)
				UiKit.restyle(ibtns[j], "primary" if j == i else "secondary")
			profile_changed.emit())
		irow.add_child(ib)
		ibtns.append(ib)
	# server
	body.add_child(UiKit.label(I18n.t("g.server"), 20, UiKit.MUTED))
	var srv := UiKit.line_edit(Settings.server, "wss://…", 120)
	srv.text_changed.connect(func(s: String): Settings.server = s)
	srv.focus_exited.connect(func(): Settings.save(); settings_changed.emit())
	srv.text_submitted.connect(func(_s: String): Settings.save(); settings_changed.emit())
	body.add_child(srv)
	body.add_child(UiKit.label(I18n.t("g.serverHint"), 14, UiKit.MUTED))
	var close := UiKit.button(I18n.t("g.close"), "primary", 60, 24)
	close.pressed.connect(func(): dim.visible = false; Settings.save())
	v.add_child(close)
	return dim

# ---------------------------------------------------------------- API used by main.gd

func toast(msg: String, secs: float = 4.0) -> void:
	if _toast == null:
		return
	_toast.text = msg
	_toast.visible = msg != ""
	_toast.offset_top = -110
	_toast_t = secs

func show_queue(on: bool) -> void:
	if _queue == null:
		return
	_queue.visible = on
	if on:
		_room_dialog.visible = false
		_settings.visible = false
		_q_count.text = I18n.t("lobby.connecting")
		_q_fill.value = 0.0
		_q_time.text = ""
		_q_bots_in.text = ""
		_q_plats.text = ""

func update_queue(m: Dictionary) -> void:
	var n := int(m.get("n", 0))
	var need := maxi(int(m.get("need", 8)), 1)
	_q_count.text = I18n.t("mm.inQueue", {"n": n, "need": need})
	_q_fill.value = clampf(float(n) / float(need), 0.0, 1.0)
	_q_time.text = I18n.t("mm.waited", {"time": _clock(float(m.get("waited", 0)))})
	_q_bots_in.text = I18n.t("mm.botsIn", {"time": _clock(float(m.get("botsIn", 0)))})
	var plats: Dictionary = m.get("plats", {})
	var parts: PackedStringArray = []
	for k in plats:
		parts.append("%s %d" % [String(k).to_upper(), int(plats[k])])
	_q_plats.text = "   ".join(parts)

func close_overlays() -> void:
	_settings.visible = false
	_room_dialog.visible = false
	_queue.visible = false

func is_overlay_open() -> bool:
	return _settings.visible or _room_dialog.visible or _queue.visible

func _clock(ms: float) -> String:
	var s := maxi(0, roundi(ms / 1000.0))
	return "%d:%02d" % [s / 60, s % 60]

func _process(delta: float) -> void:
	if _toast_t > 0.0:
		_toast_t -= delta
		if _toast_t <= 0.0 and _toast:
			_toast.visible = false

func _unhandled_input(ev: InputEvent) -> void:
	if visible and ev.is_action_pressed("ui_cancel") and is_overlay_open():
		if _queue.visible:
			queue_cancel.emit()
		else:
			close_overlays()
		get_viewport().set_input_as_handled()
