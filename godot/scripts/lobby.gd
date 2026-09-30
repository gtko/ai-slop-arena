class_name Lobby
extends Control
# The room screen (private rooms by 4-letter code, and the short wait of a matchmade room): players
# with their brawlers, the leader's controls (map, Showdown / Duo, Weekly Chaos, START), kick and
# report. Pure view: main.gd feeds it the server's {t:"room"} message and sends what it emits.

signal leave
signal start
signal map_picked(map: String)
signal mode_picked(mode: String)
signal chaos_toggled(on: bool)
signal kick(id: String)
signal report(id: String, reason: String)
signal brawler_picked(key: String)

const MAPS := ["random", "oasis", "dunes", "grove", "frost", "marsh", "isles"]

var my_id := ""
var _code: Label
var _count: Label
var _list: VBoxContainer
var _leader_box: Control
var _map_btns: Dictionary = {}
var _mode_btns: Dictionary = {}
var _chaos: CheckButton
var _start: Button
var _info: Label
var _roster: Dictionary = {}
var _report_dialog: Control
var _report_target := ""
var _report_name: Label
var _margin: MarginContainer
var _toast: Label
var _toast_t := 0.0
var _setting := false
var is_leader := false
var matchmade := false

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var bg := ColorRect.new()
	bg.color = UiKit.BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_margin = MarginContainer.new()
	_margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_margin)
	_apply_insets()
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	_margin.add_child(col)
	# header: code + copy + leave
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 14)
	col.add_child(head)
	var back := UiKit.button(I18n.t("g.leave"), "secondary", 60, 20)
	back.custom_minimum_size.x = 150
	back.pressed.connect(func(): leave.emit())
	head.add_child(back)
	head.add_child(UiKit.label(I18n.t("lobby.roomCode"), 20, UiKit.MUTED))
	_code = UiKit.label("----", 48, UiKit.ACCENT)
	head.add_child(_code)
	var copy := UiKit.button(I18n.t("g.copyCode"), "ghost", 56, 18)
	copy.pressed.connect(func():
		DisplayServer.clipboard_set(_code.text)
		toast(I18n.t("g.codeCopied")))
	head.add_child(copy)
	head.add_child(UiKit.spacer(0, true))
	_count = UiKit.label("", 22, UiKit.MUTED)
	head.add_child(_count)
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 18)
	col.add_child(body)
	# players
	var pp := UiKit.panel(UiKit.PANEL, 18, 12)
	pp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(pp)
	var pv := VBoxContainer.new()
	pv.add_theme_constant_override("separation", 8)
	pp.add_child(pv)
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	pv.add_child(sc)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 6)
	sc.add_child(_list)
	# my brawler: one row of small portraits
	pv.add_child(UiKit.label(I18n.t("lobby.yourBrawler"), 18, UiKit.MUTED))
	var pick := HBoxContainer.new()
	pick.add_theme_constant_override("separation", 6)
	pv.add_child(pick)
	for k in GameData.brawlers:
		var b := Button.new()
		b.toggle_mode = true
		b.icon = UiKit.portrait(String(k))
		b.expand_icon = true
		b.custom_minimum_size = Vector2(64, 64)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		UiKit.restyle(b, "secondary")
		b.pressed.connect(func():
			Settings.brawler = String(k)
			Settings.save()
			_mark_pick()
			brawler_picked.emit(String(k)))
		pick.add_child(b)
		_roster[k] = b
	_mark_pick()
	# leader controls
	var rp := UiKit.panel(UiKit.PANEL, 18, 12)
	rp.custom_minimum_size.x = 470
	body.add_child(rp)
	var rv := VBoxContainer.new()
	rv.add_theme_constant_override("separation", 8)
	rp.add_child(rv)
	_leader_box = VBoxContainer.new()
	_leader_box.add_theme_constant_override("separation", 8)
	rv.add_child(_leader_box)
	_leader_box.add_child(UiKit.label(I18n.t("g.mapPick"), 18, UiKit.MUTED))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 6)
	_leader_box.add_child(grid)
	for m in MAPS:
		var b := Button.new()
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(100, 82)
		b.clip_contents = true
		var path := "res://assets/ui/map_%s.jpg" % m
		if ResourceLoader.exists(path):
			b.icon = load(path) as Texture2D
			b.expand_icon = true
		b.text = ""
		UiKit.restyle(b, "secondary")
		var nm := UiKit.label(I18n.t("map." + m), 13, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
		nm.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
		nm.offset_top = -20
		nm.add_theme_stylebox_override("normal", UiKit.box(Color(0, 0, 0, 0.6), 4))
		nm.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(nm)
		b.pressed.connect(func(): map_picked.emit(m))
		grid.add_child(b)
		_map_btns[m] = b
	var mrow := HBoxContainer.new()
	mrow.add_theme_constant_override("separation", 8)
	_leader_box.add_child(mrow)
	for m in ["solo", "duo"]:
		var b := UiKit.button(I18n.t("menu.mode") if m == "solo" else I18n.t("menu.duo"), "secondary", 52, 20)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.toggle_mode = true
		b.pressed.connect(func(): mode_picked.emit(m))
		mrow.add_child(b)
		_mode_btns[m] = b
	_chaos = CheckButton.new()
	_chaos.text = I18n.t("chaos.name")
	_chaos.add_theme_font_size_override("font_size", 20)
	_chaos.custom_minimum_size.y = 50
	_chaos.toggled.connect(func(on: bool): if not _setting: chaos_toggled.emit(on))
	_leader_box.add_child(_chaos)
	_info = UiKit.label("", 17, UiKit.MUTED, HORIZONTAL_ALIGNMENT_CENTER)
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rv.add_child(_info)
	rv.add_child(UiKit.spacer(0, true))
	_start = UiKit.button(I18n.t("lobby.start"), "primary", 84, 34)
	_start.pressed.connect(func(): start.emit())
	rv.add_child(_start)
	# report dialog
	_report_dialog = _build_report()
	add_child(_report_dialog)
	_toast = UiKit.label("", 22, UiKit.ACCENT, HORIZONTAL_ALIGNMENT_CENTER)
	_toast.add_theme_stylebox_override("normal", UiKit.box(Color(0, 0, 0, 0.75), 12, Color(0, 0, 0, 0), 0, 10))
	_toast.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_toast.offset_top = -100
	_toast.visible = false
	add_child(_toast)

func _apply_insets() -> void:
	var ins := UiKit.safe_insets(get_viewport())
	_margin.add_theme_constant_override("margin_left", int(ins.x))
	_margin.add_theme_constant_override("margin_top", int(ins.y))
	_margin.add_theme_constant_override("margin_right", int(ins.z))
	_margin.add_theme_constant_override("margin_bottom", int(ins.w))

func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and _margin != null:
		_apply_insets()

func _mark_pick() -> void:
	for k in _roster:
		(_roster[k] as Button).set_pressed_no_signal(k == Settings.brawler)
		UiKit.restyle(_roster[k], "primary" if k == Settings.brawler else "secondary")

func _build_report() -> Control:
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.72)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.visible = false
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.add_child(center)
	var p := UiKit.panel(UiKit.PANEL, 20, 20)
	p.custom_minimum_size.x = 480
	center.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	p.add_child(v)
	v.add_child(UiKit.label(I18n.t("mod.report"), 28, UiKit.ACCENT, HORIZONTAL_ALIGNMENT_CENTER))
	_report_name = UiKit.label("", 22, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(_report_name)
	for r in [["cheating", "mod.reasonCheat"], ["offensive name", "mod.reasonName"], ["bad behaviour", "mod.reasonOther"]]:
		var b := UiKit.button(I18n.t(String(r[1])), "secondary", 56, 20)
		b.pressed.connect(func():
			dim.visible = false
			report.emit(_report_target, String(r[0]))
			toast(I18n.t("g.reportSent")))
		v.add_child(b)
	var c := UiKit.button(I18n.t("mm.cancel"), "ghost", 52, 20)
	c.pressed.connect(func(): dim.visible = false)
	v.add_child(c)
	return dim

func toast(msg: String, secs: float = 3.0) -> void:
	_toast.text = msg
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
	var players: Array = m.get("players", [])
	matchmade = bool(m.get("matchmade", false))
	_code.text = code
	_count.text = I18n.t("g.players", {"n": players.size()})
	is_leader = false
	for p in players:
		if String((p as Dictionary).get("id", "")) == my_id and bool((p as Dictionary).get("host", false)):
			is_leader = true
	for c in _list.get_children():
		c.queue_free()
	for p in players:
		_list.add_child(_player_row(p as Dictionary))
	_setting = true
	var map := String(m.get("map", "random"))
	for k in _map_btns:
		var b := _map_btns[k] as Button
		b.set_pressed_no_signal(k == map)
		UiKit.restyle(b, "primary" if k == map else "secondary")
		b.disabled = not is_leader
	var mode := String(m.get("mode", "solo"))
	for k in _mode_btns:
		var b := _mode_btns[k] as Button
		b.set_pressed_no_signal(k == mode)
		UiKit.restyle(b, "primary" if k == mode else "secondary")
		b.disabled = not is_leader
	_chaos.button_pressed = bool(m.get("chaos", false))
	_chaos.disabled = not is_leader
	_setting = false
	_leader_box.visible = not matchmade
	var in_match := bool(m.get("inMatch", false))
	_start.visible = is_leader and not matchmade and not in_match
	if matchmade:
		_info.text = I18n.t("mm.matchmade")
	elif in_match:
		_info.text = I18n.t("lobby.inProgress")
	elif is_leader:
		_info.text = ""
	else:
		_info.text = I18n.t("lobby.waiting")
	_mark_pick()

func _player_row(p: Dictionary) -> Control:
	var id := String(p.get("id", ""))
	var row := UiKit.panel(UiKit.PANEL_HI if id == my_id else Color(1, 1, 1, 0.04), 14, 8)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 12)
	row.add_child(h)
	var key := String(p.get("brawler", "blaster")).split(":")[0]
	var tex := TextureRect.new()
	tex.texture = UiKit.portrait(key)
	tex.custom_minimum_size = Vector2(56, 56)
	tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	h.add_child(tex)
	var nm := String(p.get("name", "?"))
	if id == my_id:
		nm = I18n.t("lobby.you", {"name": nm})
	var vb := VBoxContainer.new()
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	vb.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(vb)
	vb.add_child(UiKit.label(nm, 24, UiKit.TEXT))
	var bn: String = String((GameData.brawlers.get(key, {"name": key}) as Dictionary).get("name", key))
	vb.add_child(UiKit.label("%s · %s" % [bn, String(p.get("plat", "")).to_upper()], 15, UiKit.MUTED))
	if bool(p.get("host", false)):
		var tag := UiKit.label(I18n.t("g.leader"), 16, Color("1a1300"), HORIZONTAL_ALIGNMENT_CENTER)
		tag.add_theme_stylebox_override("normal", UiKit.box(UiKit.ACCENT, 8, Color(0, 0, 0, 0), 0, 6))
		h.add_child(tag)
	if id != my_id:
		var rb := UiKit.button(I18n.t("mod.report"), "ghost", 48, 15)
		rb.pressed.connect(func():
			_report_target = id
			_report_name.text = String(p.get("name", "?"))
			_report_dialog.visible = true)
		h.add_child(rb)
		if is_leader and not matchmade:
			var kb := UiKit.button("X", "danger", 48, 18)
			kb.custom_minimum_size.x = 52
			kb.tooltip_text = I18n.t("mod.kick")
			kb.pressed.connect(func(): kick.emit(id))
			h.add_child(kb)
	return row
