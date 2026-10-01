class_name ResultView
extends CssView
# The end-of-match screen, a port of the web's #result (play.html, src/style.css .result, meta.css
# .podium / .awards, main.js onResult / showStats / showPodium): over the dimmed arena, the big
# "#3" / "VICTORY!" title, the line under it, the ranked result (RP and tier, from the server's
# {t:"ranked"}), the podium of the top 3 once the match has a winner, your stat tiles (damage, K.O.,
# cubes, gadgets) and the match awards, then the next choices:
#   match still running (you are out): SPECTATE + "back when the match ends" (hides the screen)
#   match over: PLAY AGAIN + MENU
# Stats are counted from the server's events (track()), like the web's online clients do.
# Entrance like the web: the podium steps rise in (podiumIn, 2nd / 1st / 3rd staggered), the awards
# follow, a mastery-style pop on the title and on the ranked line when it arrives.

signal again
signal menu
signal spectate

const PERSONA_ICONS := {"hunter": "🎯", "camper": "⛺", "looter": "💰", "vulture": "🦅", "coward": "🐔", "showoff": "🕺"}
const AWARDS := [["kos", "💀", 2], ["cubes", "💎", 3], ["supers", "🌟", 2], ["gadgets", "🧰", 3], ["crates", "📦", 3], ["emotes", "💬", 2]]

var _title_s := ""
var _won := false
var _sub_s := ""
var _rank_s := ""
var _done := false
var _hint_s := ""
var _rank_pop := false

# match data
var my_id := ""
var duo := false
var _rows: Dictionary = {}      # id -> roster row
var _stats: Dictionary = {}     # id -> {dmg, kos, cubes, gadgets, supers, crates, emotes}
var _ranks: Dictionary = {}     # id -> final place (kill events, the winner)
var _ended := false

func _ready() -> void:
	super._ready()
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false

# ---------------------------------------------------------------- match bookkeeping

func begin_match(roster: Array, me: String) -> void:
	my_id = me
	_rows.clear()
	_stats.clear()
	_ranks.clear()
	_ended = false
	duo = false
	for r in roster:
		_rows[String(r.id)] = r
		_stats[String(r.id)] = {"dmg": 0.0, "kos": 0, "cubes": 0, "gadgets": 0, "supers": 0, "crates": 0, "emotes": 0}
		if r.has("team") and typeof(r.team) in [TYPE_INT, TYPE_FLOAT]:
			duo = true

func _add(id: Variant, k: String, v: float = 1.0) -> void:
	var s: Variant = _stats.get(String(id) if id != null else "", null)
	if s is Dictionary:
		(s as Dictionary)[k] = (s as Dictionary)[k] + v

# One server event (the same bookkeeping as game.js applies on the web's online clients).
func track(e: Dictionary) -> void:
	match String(e.get("e", "")):
		"dmg":
			if e.get("s") != null and String(e.get("s")) != String(e.get("id", "")):
				_add(e.get("s"), "dmg", float(e.get("a", 0.0)))
		"kill":
			_ranks[String(e.get("id", ""))] = int(e.get("rank", 0))
			if e.get("by") != null and String(e.get("by")) != String(e.get("id", "")):
				_add(e.get("by"), "kos")
		"win":
			_ended = true
			var w := String(e.get("id", ""))
			_ranks[w] = 1
			if duo and _rows.has(w):   # the partner of the winner shares the 1st place
				for id in _rows:
					if id != w and _rows[id].get("team", -1) == _rows[w].get("team", -2):
						_ranks[id] = 1
		"atk":
			if e.get("s", 0):
				_add(e.get("id"), "supers")
		"gad":
			_add(e.get("id"), "gadgets")
		"crate":
			_add(e.get("by"), "crates")
		"pick":
			_add(e.get("by"), "cubes")
		"emo":
			_add(e.get("id"), "emotes")

func match_ended() -> void:
	_ended = true

# ---------------------------------------------------------------- show

# place: your rank (team rank in Duo), won: you (your team) won, over: the whole match is over.
func show_result(place: int, won: bool, over: bool, hint: String = "") -> void:
	_won = won
	_title_s = I18n.t("result.victory") if won else I18n.t("result.rank", {"rank": place})
	var rank := place * 2 - 1 if duo else place
	if duo:
		_sub_s = I18n.t("result.wonDuo") if won else I18n.t("result.lostDuo", {"n": place - 1})
	else:
		_sub_s = I18n.t("result.won") if won else I18n.t("result.lost", {"n": rank - 1})
	_done = over
	_hint_s = hint if hint != "" else I18n.t("result.backSoon")
	_rank_pop = false
	_animate = true
	visible = true
	rebuild()

# The ranked line (yellow), "" to hide it; pops when it arrives while the screen is up.
func set_rank_text(txt: String) -> void:
	if txt == _rank_s:
		return
	_rank_s = txt
	if visible:
		_rank_pop = true
		_animate = false
		rebuild()

func set_over(over: bool) -> void:
	if over == _done:
		return
	_done = over
	if visible:
		_animate = false
		rebuild()

func hide_result() -> void:
	visible = false

# ---------------------------------------------------------------- layout

func _build() -> void:
	var podium := _ended and _ranks.size() > 0
	var bg := ColorRect.new()
	bg.color = Color(10 / 255.0, 8 / 255.0, 22 / 255.0, 0.55)
	bg.size = Vector2(W, H)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.add_child(bg)
	if _animate:
		bg.modulate.a = 0.0
		bg.create_tween().tween_property(bg, "modulate:a", 1.0, 0.25)

	var col := _box(0, true)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	var cw := minf(780.0, W - (28.0 if phone else 80.0))
	col.custom_minimum_size.x = cw

	# title (.result h2, .podium-on h2)
	var ts := (40 if podium else 60) if phone else (64 if podium else 110)
	var stroke := 4.0 if phone else (5.0 if podium else 6.0)
	var sh := 5.0 if (phone or podium) else 8.0
	var title := _title(_title_s, ts, UiKit.YELLOW if _won else Color.WHITE, stroke, sh)
	var ta := UiKit.anim(title)
	col.add_child(ta)
	if _animate:
		UiKit.pop_in(ta, 0.6, 0.0, 0.5)
	# the line under it (.result p)
	var sub := _body(_sub_s, 13 if phone else 16, UiKit.WMUTED, 800)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	sub.custom_minimum_size.x = cw
	col.add_child(_gap(4 if phone else 10))
	col.add_child(sub)
	col.add_child(_gap(4 if phone else 10))
	# ranked result (.res-rank)
	if _rank_s != "":
		var rl := _disp(_rank_s, 18 if phone else 24, UiKit.YELLOW)
		rl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		rl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		rl.custom_minimum_size.x = cw
		var ra := UiKit.anim(rl)
		col.add_child(ra)
		if _rank_pop or _animate:
			UiKit.pop_in(ra, 0.9, 0.0 if _rank_pop else 0.3)
		_rank_pop = false
		col.add_child(_gap(4))
	# podium
	if podium:
		col.add_child(_center(_build_podium()))
		col.add_child(_gap(4))
	# stats + awards
	if _stats.has(my_id):
		col.add_child(_center(_build_stats()))
		var aw := _build_awards(cw)
		if aw:
			col.add_child(_gap(2))
			col.add_child(_center(aw))
	# buttons (.row-btns)
	col.add_child(_gap(8 if phone else 18))
	var row := _box(12, false)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	if _done:
		var a := _big(I18n.t("result.again"), 21 if phone else 30, 8 if phone else 12, 18 if phone else 44, 4 if phone else 6)
		a.pressed.connect(func(): again.emit())
		row.add_child(a)
		var m := _ghost(I18n.t("result.menu"), 15 if phone else 22, 7 if phone else 12, 14 if phone else 26, 4 if phone else 6)
		m.pressed.connect(func(): menu.emit())
		row.add_child(m)
	else:
		var s := _ghost(I18n.t("result.spectate"), 15 if phone else 22, 7 if phone else 12, 14 if phone else 26, 4 if phone else 6)
		s.pressed.connect(func(): spectate.emit())
		row.add_child(s)
		var hint := _body(_hint_s, 12, UiKit.WMUTED, 700)
		hint.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		row.add_child(hint)
	var ra2 := UiKit.anim(row)
	col.add_child(ra2)
	if _animate:
		UiKit.play_in(ra2, 0.4, 0.25, 16.0)

	# centred, scaled down if it does not fit (the web's overlay scrolls instead)
	var holder := Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.add_child(holder)
	holder.add_child(col)
	_fit(holder, col, cw)
	call_deferred("_fit", holder, col, cw)   # again once the wrapped lines know their width

func _fit(holder: Control, col: Control, cw: float) -> void:
	if not is_instance_valid(col):
		return
	col.size = Vector2(cw, 0)
	var ms := col.get_combined_minimum_size()
	var avail := H - (16.0 if phone else 48.0)
	var f := minf(1.0, avail / maxf(ms.y, 1.0))
	col.size = Vector2(cw, ms.y)
	holder.scale = Vector2(f, f)
	holder.position = Vector2((W - cw * f) / 2.0, (H - ms.y * f) / 2.0)

func _gap(h: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size.y = h
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

func _name_of(id: String) -> String:
	if id == my_id:
		return I18n.t("hud.you")
	var r: Variant = _rows.get(id, {})
	return String((r as Dictionary).get("name", "?")) if r is Dictionary else "?"

func _key_of(id: String) -> String:
	var r: Dictionary = _rows.get(id, {})
	return String(r.get("type", "blaster")).split(":")[0]

# .podium: 2nd - 1st - 3rd on steps (Duo: 2 - 1 1 - 2), rising in one after the other.
func _build_podium() -> Control:
	var top: Array = []
	for id in _ranks:
		var rk := int(_ranks[id])
		if rk >= 1 and rk <= (2 if duo else 3) and _rows.has(id):
			top.append([rk, id])
	top.sort_custom(func(a, b): return a[0] < b[0])
	var order: Array = []
	for i in ([2, 0, 3, 1] if duo else [1, 0, 2]):
		if i < top.size():
			order.append(top[i])
	var row := _box(8, false)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	var delays := [0.35, 0.15, 0.5, 0.6]
	var w := 86.0 if phone else 108.0
	var pf := 42.0 if phone else 60.0
	for n in order.size():
		var rk: int = order[n][0]
		var id: String = order[n][1]
		var r: Dictionary = _rows[id]
		var v := _box(0, true)
		v.custom_minimum_size.x = w
		v.size_flags_vertical = Control.SIZE_SHRINK_END
		# .pf frame: 8 % white, 3 px ink border, the portrait (118 %, from the top) clipped inside
		var frame := _panel(UiKit.sbox(Color(1, 1, 1, 0.08), 12, UiKit.INK, 3))
		frame.custom_minimum_size = Vector2(pf, pf)
		frame.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		var clip := UiKit.clip_box(9)
		var holder := Control.new()
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var img := _portrait(_key_of(id), Vector2(pf * 1.18, pf * 1.18), String(r.get("cos", "")))
		img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		img.size = Vector2(pf * 1.18, pf * 1.18)
		img.position = Vector2(-pf * 0.12, pf * 0.04)
		holder.add_child(img)
		clip.add_child(holder)
		frame.add_child(clip)
		v.add_child(frame)
		var nm := _disp(_name_of(id), 15, Color("39c6ff") if id == my_id else Color.WHITE)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		nm.clip_text = true
		nm.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		nm.custom_minimum_size.x = w
		v.add_child(_gap(3))
		v.add_child(nm)
		var per := String(r.get("per", ""))
		var tl := _body((String(PERSONA_ICONS.get(per, "")) + " " + I18n.t("persona." + per)) if (per != "" and not r.get("human", false)) else "", 10, UiKit.WMUTED, 800)
		tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		tl.custom_minimum_size.y = 12
		tl.clip_text = true
		v.add_child(tl)
		# the step
		var hs: float = ([36.0, 26.0, 18.0] if phone else [64.0, 44.0, 30.0])[clampi(rk - 1, 0, 2)]
		var grads := [[Color("ffe36b"), Color("e0a200")], [Color("e6ecf5"), Color("9aa6b8")], [Color("f0b27a"), Color("b86b2e")]]
		var gc: Array = grads[clampi(rk - 1, 0, 2)]
		var step := Panel.new()
		var ss := UiKit.sbox(Color.WHITE, 10, UiKit.INK, 3)
		ss.corner_radius_bottom_left = 0
		ss.corner_radius_bottom_right = 0
		ss.border_width_bottom = 0
		step.add_theme_stylebox_override("panel", ss)
		step.custom_minimum_size = Vector2(w, hs)
		step.clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
		step.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var g := UiKit.grad_rect(UiKit.grad([[0.0, gc[0]], [1.0, gc[1]]]))
		step.add_child(g)
		var border := Panel.new()   # the ink border drawn again over the gradient
		var bs := ss.duplicate() as StyleBoxFlat
		bs.draw_center = false
		border.add_theme_stylebox_override("panel", bs)
		border.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		border.mouse_filter = Control.MOUSE_FILTER_IGNORE
		step.add_child(border)
		var num := _disp(str(rk), 16 if phone else 26, UiKit.INK)
		num.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		num.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
		num.offset_top = 2
		step.add_child(num)
		v.add_child(_gap(4))
		v.add_child(step)
		var a := UiKit.anim(v)
		a.size_flags_vertical = Control.SIZE_SHRINK_END
		row.add_child(a)
		if _animate:
			UiKit.play_in(a, 0.5, delays[n] + 0.2, 30.0)
	return row

func _num(v: int) -> String:
	var s := str(absi(v))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if v < 0 else "") + s + out

# .res-stats: your damage, K.O.s, cubes and gadgets (numbers count up)
func _build_stats() -> Control:
	var st: Dictionary = _stats[my_id]
	var lo := String(_rows.get(my_id, {}).get("type", "blaster:A1"))
	var parts := lo.split(":")
	var gl := parts[1].left(1) if parts.size() > 1 and parts[1] != "" else Settings.loadout_of(parts[0]).left(1)
	var gicon := String(MainMenu.GADGET_ICONS.get(parts[0] + gl, "🧰"))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var tiles := [["💥", int(round(float(st.dmg))), I18n.t("result.dmg"), true], ["💀", int(st.kos), I18n.t("result.kos"), false],
		["💎", int(st.cubes), I18n.t("result.cubes"), false], [gicon, int(st.gadgets), I18n.t("result.gadgets"), false]]
	var tw := (minf(420.0, W - 40.0) - 24.0) / 4.0
	for t in tiles:
		var p := _panel(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.06), 12, UiKit.INK, 2), 4, 6, 4, 6))
		p.custom_minimum_size.x = tw
		var v := _box(0, true)
		var ic := UiKit.text(t[0], 18, Color.WHITE)
		ic.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(ic)
		var b := _disp(_num(t[1]) if not _animate else "0", 22, Color.WHITE)
		b.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(b)
		var sm := _body(String(t[2]).to_upper(), 10, UiKit.WMUTED, 900, 0.5)
		sm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(sm)
		p.add_child(v)
		grid.add_child(p)
		if _animate and int(t[1]) > 0:   # number pop: counts up, then a little bump
			var target: int = t[1]
			var big: bool = t[3]
			var twn := b.create_tween()
			twn.tween_interval(0.35)
			twn.tween_method(func(x: float): b.text = _num(int(round(x)) if big else int(x)), 0.0, float(target), 0.7).set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT)
			twn.tween_callback(func(): b.text = _num(target))
	return grid

# .awards: the MVP (most damage) and the best at K.O.s, cubes, supers, gadgets, crates, emotes
func _build_awards(cw: float) -> Control:
	if not _stats.has(my_id):
		return null
	var best := func(k: String) -> String:
		var who := my_id
		for id in _stats:
			if float(_stats[id][k]) > float(_stats[who][k]):
				who = id
		return who
	var list: Array = [{"id": best.call("dmg"), "icon": "👑", "text": I18n.t("award.mvp")}]
	for a in AWARDS:
		var id: String = best.call(a[0])
		var n := int(_stats[id][a[0]])
		if n >= int(a[2]):
			list.append({"id": id, "icon": a[1], "text": I18n.t("award." + String(a[0]), {"n": n})})
	var mine := list.filter(func(x): return x.id == my_id)
	var others := list.filter(func(x): return x.id != my_id)
	list = (mine + others).slice(0, 5)
	var flow := HFlowContainer.new()
	flow.alignment = FlowContainer.ALIGNMENT_CENTER
	flow.add_theme_constant_override("h_separation", 6)
	flow.add_theme_constant_override("v_separation", 6)
	flow.custom_minimum_size.x = minf(520.0, cw)
	flow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for i in list.size():
		var x: Dictionary = list[i]
		var me: bool = x.id == my_id
		var p := _panel(UiKit.pads(UiKit.sbox(Color(1, 0.82, 0.25, 0.18) if me else Color(1, 1, 1, 0.07), 12,
			UiKit.YELLOW if me else UiKit.INK, 2), 4, 3, 10, 3))
		var h := _box(6, false)
		h.add_child(UiKit.text(x.icon, 18, Color.WHITE))
		var t := _body(String(x.text), 12, UiKit.WTEXT, 800)
		t.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		h.add_child(t)
		var nm := _body(_name_of(x.id), 12, Color.WHITE, 900)
		nm.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		h.add_child(nm)
		p.add_child(h)
		var a := UiKit.anim(p)
		flow.add_child(a)
		if _animate:
			UiKit.play_in(a, 0.4, 0.5 + i * 0.06, 30.0)
	return flow
