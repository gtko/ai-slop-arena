class_name MatchLoad
extends CssView
# The pre-match loading screen, a port of the web's #matchload (play.html, src/style.css, main.js
# showMatchLoad / setLoadProgress / countdown): the map name and its tag line, one card per brawler of
# the roster (portrait on the brawler's colour, name, platform / bot persona, a loading bar, a green
# check once loaded; yours outlined in yellow), "n / total players ready", then the 3-2-1-FIGHT!
# countdown popping over it (mlPop). main.gd shows it on {t:"start"}, feeds {t:"lprog"} and the
# countdown, and fades it out when the match starts.

const PLAT_ICON := {"web": "🌐", "steam": "🎮", "epic": "🛒", "android": "🤖", "ios": "🍏"}

var _map := ""
var _roster: Array = []
var _me := ""
var _prog: Dictionary = {}       # id -> 0..100
var _count_s := ""
var _cards: Dictionary = {}      # id -> {card, bar, ok}
var _status: Label
var _count: Label
var _count_a: UiKit.Anim
var _bar_w := 100.0

func _ready() -> void:
	super._ready()
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false

func show_load(map_key: String, roster: Array, me: String) -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_map = map_key
	_roster = roster
	_me = me
	_prog.clear()
	for r in roster:
		_prog[String(r.id)] = 0.0 if r.get("human", false) else 100.0
	_count_s = ""
	modulate.a = 1.0
	_animate = true
	visible = true
	rebuild()

func set_progress(id: String, p: float) -> void:
	if not _prog.has(id):
		return
	_prog[id] = maxf(float(_prog[id]), clampf(p, 0.0, 100.0))
	_refresh_card(id, true)
	_refresh_status()

# 3, 2, 1 (n > 0) or FIGHT! (n == 0), with the web's mlPop.
func count(n: int) -> void:
	_count_s = str(n) if n > 0 else I18n.t("load.fight")
	if _status:
		_status.text = ""
	if _count:
		_count.text = _count_s
		_pop_count()

# The match runs: FIGHT! for a beat, then fade out.
func finish() -> void:
	if not visible:
		return
	mouse_filter = Control.MOUSE_FILTER_IGNORE   # FIGHT! fades over the match: the first touches reach the sticks
	count(0)
	var tw := create_tween()
	tw.tween_interval(0.45)
	tw.tween_property(self, "modulate:a", 0.0, 0.25)
	tw.tween_callback(func(): visible = false; modulate.a = 1.0)

func hide_load() -> void:
	visible = false

# ---------------------------------------------------------------- layout

func _build() -> void:
	_cards.clear()
	var narrow := W <= 760.0 or phone
	var bg := UiKit.grad_rect(UiKit.grad([[0.0, Color(58 / 255.0, 42 / 255.0, 110 / 255.0, 0.92)], [0.7, Color(12 / 255.0, 9 / 255.0, 24 / 255.0, 0.97)],
		[1.0, Color(12 / 255.0, 9 / 255.0, 24 / 255.0, 0.97)]], Vector2(0.5, 0.4), Vector2(1.21, 0.4), true))
	bg.set_anchors_preset(Control.PRESET_TOP_LEFT)
	bg.size = Vector2(W, H)
	_page.add_child(bg)
	var col := _box(8 if phone else (10 if narrow else 22), true)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	# head
	var head := _box(0 if phone else 4, true)
	var hs := 34 if phone else int(clampf(W * 0.06, 40.0, 72.0))
	var h2 := _title(I18n.t("map." + _map), hs, Color.WHITE, 4.0 if phone else 5.0, 4.0 if phone else 6.0)
	var ha := UiKit.anim(h2)
	head.add_child(ha)
	var tag := _body(I18n.t("map." + _map + ".tag"), 12 if phone else 16, UiKit.WMUTED, 800)
	tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	head.add_child(tag)
	col.add_child(head)
	if _animate:
		UiKit.pop_in(ha, 0.5, 0.0, 0.7)
	# cards
	var cols := 8 if phone else 4
	var gap := 6.0 if phone else (8.0 if narrow else 14.0)
	var cw := (minf(960.0, W - 28.0) - gap * 7.0) / 8.0 if phone else (110.0 if narrow else 170.0)
	var img_h := 64.0 if phone else (70.0 if narrow else 130.0)
	var grid := GridContainer.new()
	grid.columns = cols
	grid.add_theme_constant_override("h_separation", int(gap))
	grid.add_theme_constant_override("v_separation", int(gap))
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bar_w = cw - (4.0 if phone else 6.0)
	var i := 0
	for r in _roster:
		var a := UiKit.anim(_card(r, cw, img_h))
		grid.add_child(a)
		if _animate:
			UiKit.play_in(a, 0.45, 0.05 + i * 0.05, 24.0)
		i += 1
	col.add_child(_center(grid))
	_status = _body("", 13 if phone else 16, Color.WHITE, 900)
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_status.custom_minimum_size.y = 18
	col.add_child(_status)
	# count (phone: over the cards)
	var cs := 110 if phone else (70 if narrow else 120)
	_count = _title(_count_s, cs, UiKit.YELLOW, 6.0, 8.0)
	_count.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_count_a = UiKit.anim(_count)
	if not phone:
		_count.custom_minimum_size.y = 70.0 if narrow else 120.0
		col.add_child(_count_a)
	_refresh_status()
	if _count_s != "":
		_status.text = ""

	var holder := Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.add_child(holder)
	holder.add_child(col)
	col.reset_size()
	var ms := col.get_combined_minimum_size()
	var avail := Vector2(W - 28.0, H - (20.0 if phone else 48.0))
	var f := minf(1.0, minf(avail.y / maxf(ms.y, 1.0), avail.x / maxf(ms.x, 1.0)))
	col.size = ms
	holder.scale = Vector2(f, f)
	holder.position = (Vector2(W, H) - ms * f) / 2.0
	if phone:
		_count_a.size = Vector2(W, H)
		_page.add_child(_count_a)
		_count.size = Vector2(W, H)

func _pop_count() -> void:
	if _count_a == null:
		return
	# mlPop 0.9s ease-out: scale 1.8 / opacity 0 -> 1 at 25 % -> 0.9 / 0.9
	_count_a.s = 1.8
	_count_a.modulate.a = 0.0
	var tw := _count_a.create_tween()
	tw.tween_property(_count_a, "s", 1.0, 0.225).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	tw.parallel().tween_property(_count_a, "modulate:a", 1.0, 0.225)
	tw.tween_property(_count_a, "s", 0.9, 0.675).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(_count_a, "modulate:a", 0.9, 0.675)

func _card(r: Dictionary, cw: float, img_h: float) -> Control:
	var id := String(r.id)
	var key := String(r.get("type", "blaster")).split(":")[0]
	var human := bool(r.get("human", false))
	var pal: Variant = GameData.brawlers.get(key, {}).get("palette", {}).get("main", 0x3a2a6e)
	var main_c := GameData.color_of(pal)
	var outer := Control.new()   # holds the card and the outline / check that stick out of it
	outer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var rad := 12 if phone else 16
	var bw := 2 if phone else 3
	var shadow := Panel.new()   # box-shadow: 0 6px 0 rgba(0,0,0,0.4)
	shadow.add_theme_stylebox_override("panel", UiKit.sbox(Color(0, 0, 0, 0.4), rad))
	shadow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	outer.add_child(shadow)
	var card := UiKit.clip_box(rad)   # the rounded card clips its gradient, portrait and bar
	outer.add_child(card)
	var g := UiKit.grad_rect(UiKit.grad([[0.0, main_c], [1.0, Color("1b1535")]]))
	card.add_child(g)
	var v := _box(0, true)
	card.add_child(v)
	v.add_child(_gap(4.0 if phone else 6.0))
	var img := _portrait(key, Vector2(cw, img_h), String(r.get("cos", "")))
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	v.add_child(img)
	var nm_s := I18n.t("lobby.you", {"name": String(r.get("name", ""))}) if id == _me else String(r.get("name", ""))
	var nm := _body(nm_s, 11 if phone else 16, Color.WHITE, 900)
	nm.clip_text = true
	nm.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	var bname := String(GameData.brawlers.get(key, {}).get("name", key))
	var per := String(r.get("per", ""))
	var sub_s := ("%s %s" % [PLAT_ICON.get(String(r.get("plat", "")), "🌐"), bname]) if human else \
		("%s · %s" % [(String(ResultView.PERSONA_ICONS.get(per, "")) + " " + I18n.t("persona." + per)) if per != "" else I18n.t("load.bot"), bname])
	var sub := _body(sub_s, 9 if phone else 12, UiKit.WMUTED, 800)
	sub.clip_text = true
	sub.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	var pad := 6.0 if phone else 10.0
	v.add_child(_pad_box(nm, pad, 3.0 if phone else 6.0, 0.0 if phone else 2.0))
	v.add_child(_pad_box(sub, pad, 0.0, 5.0 if phone else 8.0))
	var bar_bg := ColorRect.new()
	bar_bg.color = Color(0, 0, 0, 0.4)
	bar_bg.custom_minimum_size.y = 6
	bar_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bar := UiKit.grad_rect(UiKit.grad([[0.0, UiKit.YELLOW], [1.0, Color("ffb300")]], Vector2(0, 0), Vector2(1, 0)))
	bar.set_anchors_preset(Control.PRESET_TOP_LEFT)
	bar.size = Vector2(0, 6)
	bar_bg.add_child(bar)
	v.add_child(bar_bg)
	# size: the content's height (measured in the tree: theme overrides apply from there)
	_page.add_child(outer)
	var hgt := v.get_combined_minimum_size().y
	_page.remove_child(outer)
	outer.custom_minimum_size = Vector2(cw, hgt)
	card.size = Vector2(cw, hgt)
	v.size = Vector2(cw, hgt)
	shadow.size = Vector2(cw, hgt)
	shadow.position = Vector2(0, 6)
	var border := Panel.new()   # the 3 px ink border, over the clipped content
	var bs := UiKit.sbox(Color(0, 0, 0, 0), rad, UiKit.INK, bw)
	bs.draw_center = false
	border.add_theme_stylebox_override("panel", bs)
	border.size = Vector2(cw, hgt)
	border.mouse_filter = Control.MOUSE_FILTER_IGNORE
	outer.add_child(border)
	if id == _me:   # outline: 3px solid yellow
		var ol := Panel.new()
		var os := UiKit.sbox(Color(0, 0, 0, 0), (12 if phone else 16) + 3, UiKit.YELLOW, 3)
		os.draw_center = false
		ol.add_theme_stylebox_override("panel", os)
		ol.position = Vector2(-3, -3)
		ol.size = Vector2(cw + 6, hgt + 6)
		ol.mouse_filter = Control.MOUSE_FILTER_IGNORE
		outer.add_child(ol)
	var ok := _panel(UiKit.sbox(Color("3dcc6a"), 13, UiKit.INK, 2))
	var d := 18.0 if phone else 26.0
	ok.custom_minimum_size = Vector2(d, d)
	ok.size = Vector2(d, d)
	ok.position = Vector2(cw - d - (4.0 if phone else 8.0), 4.0 if phone else 8.0)
	var ck := _body("✓", 11 if phone else 15, UiKit.INK, 900)
	ck.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ck.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	ok.add_child(ck)
	outer.add_child(ok)
	_cards[id] = {"card": outer, "bar": bar, "ok": ok, "w": cw}
	_refresh_card(id, false)
	return outer

func _pad_box(c: Control, h: float, t: float, b: float) -> MarginContainer:
	var m := MarginContainer.new()
	m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	m.add_theme_constant_override("margin_left", int(h))
	m.add_theme_constant_override("margin_right", int(h))
	m.add_theme_constant_override("margin_top", int(t))
	m.add_theme_constant_override("margin_bottom", int(b))
	m.add_child(c)
	return m

func _gap(h: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size.y = h
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

# .ml-card: dim until loaded (opacity 0.55 -> 1, 0.3 s), the bar eases to its width (0.35 s)
func _refresh_card(id: String, ease: bool) -> void:
	var c: Variant = _cards.get(id)
	if not (c is Dictionary):
		return
	var p := float(_prog.get(id, 0.0))
	var ready := p >= 100.0
	var card: Control = c.card
	var bar: Control = c.bar
	var w := float(c.w) * p / 100.0
	(c.ok as Control).visible = ready
	if ease:
		var tw := card.create_tween().set_parallel(true)
		tw.tween_property(bar, "size:x", w, 0.35)
		tw.tween_property(card, "modulate:a", 1.0 if ready else 0.55, 0.3)
		if ready:   # a little pop of the check
			(c.ok as Control).pivot_offset = (c.ok as Control).size / 2.0
			(c.ok as Control).scale = Vector2(0.3, 0.3)
			tw.tween_property(c.ok, "scale", Vector2.ONE, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	else:
		bar.size.x = w
		card.modulate.a = 1.0 if ready else 0.55

func _refresh_status() -> void:
	if _status == null or _count_s != "":
		return
	var n := 0
	var total := 0
	for r in _roster:
		if r.get("human", false):
			total += 1
			if float(_prog.get(String(r.id), 0.0)) >= 100.0:
				n += 1
	_status.text = I18n.t("load.waiting", {"n": n, "total": total})
