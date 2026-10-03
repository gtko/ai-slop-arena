extends RefCounted
# The COLLECTION page of the menu (src/metaui.js collection(), the .col-* rules of meta.css / home.css):
# everything you own or could get, by kind (skins per brawler, trails, K.O. effects, emotes, frames,
# titles, profile icons), counts on the tabs, a big preview on the side; click an owned item to wear it.
# Skins are previewed with the web's recolour of the portrait; wearing one restarts the live arena behind
# the menu with your new looks and tells the room (the `cos` string, Settings.cos_string()).

const MenuShop := preload("res://scripts/menu_shop.gd")
const MenuTap := preload("res://scripts/menu_tap.gd")
const AbilityPreview := preload("res://scripts/ability_preview.gd")

const KINDS := ["skin", "trail", "ko", "emote", "frame", "title", "icon"]

static var tab := "skin"
static var skin_of := ""

var m
var S: MenuShop          # the shared pieces (item pictures, tab rows, buttons)
var small := false
var _preview: VBoxContainer
var _tiles: Dictionary = {}   # id -> [tile, outline]
var _today: Array = []

func _init(menu) -> void:
	m = menu
	S = MenuShop.new(menu)
	small = bool(m.phone)

func _has(id: String) -> bool:
	var p := id.split(":")
	if p.size() == 3 and p[0] == "skin" and p[2] == "0":
		return true
	if p.size() == 2 and p[1] == "0" and (p[0] == "trail" or p[0] == "ko" or p[0] == "frame"):
		return true
	return MetaProfile.owns(id)

func _ids(kind: String, key: String) -> Array:
	var d := MetaProfile.D()
	var out: Array = []
	match kind:
		"skin":
			for n in (d.skins as Array).size():
				out.append("skin:%s:%d" % [key, n])
		"trail", "ko", "frame":
			var list: Array = d.trails if kind == "trail" else (d.kofx if kind == "ko" else d.frames)
			for n in list.size():
				out.append("%s:%d" % [kind, n])
		"emote":
			for e in d.emotes:
				out.append("emote:" + String(e))
		"title":
			for n in range(1, (d.titles as Array).size()):
				out.append("title:%d" % n)
		"icon":
			for n in (d.icons as Array).size():
				out.append("icon:%d" % n)
	return out

func _count(kind: String) -> String:
	if kind == "skin":
		var have := 0
		var total := 0
		for b in GameData.brawlers.keys():
			for id in _ids("skin", String(b)):
				total += 1
				if _has(id):
					have += 1
		return "%d/%d" % [have, total]
	var ids := _ids(kind, "")
	return "%d/%d" % [ids.filter(func(id): return _has(id)).size(), ids.size()]

# How to get an item you don't own (metaui.js how()).
func _how(id: String) -> String:
	var LR := MetaProfile.level_rewards()
	for k in LR:
		if String(LR[k]) == id:
			return I18n.t("col.atLevel", {"n": int(k)})
	for r in MetaProfile.road():
		if String(r[1]) == id:
			return I18n.t("col.onRoad", {"n": m._num(int(r[0]))})
	if id.begins_with("skin:") and id.ends_with(":3"):
		return I18n.t("col.gold", {"n": int(MetaProfile.D().get("goldAt", 10))})
	if id == "title:11":
		return I18n.t("col.weekly")
	if id == "title:10":
		return I18n.t("col.chaos")
	return I18n.t("shop.today") if _today.has(id) else I18n.t("col.inShop")

func _wearable() -> bool:
	return tab != "emote"

static var _args_read := false

func build(head: HBoxContainer, v: VBoxContainer, aw: float) -> void:
	if not _args_read:   # screenshots: --coltab=trail [--skinof=volt]
		_args_read = true
		for a in DebugArgs.list():
			if a.begins_with("--coltab="):
				tab = a.substr(9)
			elif a.begins_with("--skinof="):
				skin_of = a.substr(9)
	var key := skin_of if GameData.brawlers.has(skin_of) else Settings.brawler
	_today = MetaProfile.shop_items(GameData.brawlers.keys())
	var items: Array = []
	for k in KINDS:
		items.append([k, I18n.t("cos.tab." + k), _count(k)])
	v.add_child(S.tab_row(items, tab, func(k: String): tab = k; m._fill_page("collection")))
	if tab == "skin":
		v.add_child(S.brawler_pick(key, func(k: String): skin_of = k; m._fill_page("collection")))
		v.add_child(AbilityPreview.chips(m, key, small))   # its gadgets and star powers, with their preview clips
	var ids := _ids(tab, key)
	var show_preview := not small and aw >= 900.0 - 64.0
	var gap := 8.0 if small else 14.0
	var gw := aw - (280.0 + 18.0 if show_preview else 0.0)
	var c := MenuShop.cols(gw, 104.0 if small else 160.0, gap)
	var wrap: HBoxContainer = m._hbox(18)
	var g := S.grid(c[0], gap)
	g.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var unseen := MetaProfile.unseen()
	_tiles.clear()
	for id in ids:
		g.add_child(_tile(String(id), c[1], unseen.has(id)))
	wrap.add_child(g)
	if show_preview:
		var pv := PanelContainer.new()
		pv.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		pv.custom_minimum_size = Vector2(280, 300)
		pv.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		pv.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var clip := UiKit.clip_box(18)
		clip.add_child(UiKit.grad_rect(MenuShop.pgrad([[0.0, Color(143 / 255.0, 107 / 255.0, 1, 0.25)], [0.7, Color(20 / 255.0, 16 / 255.0, 38 / 255.0, 0.9)], [1.0, Color(20 / 255.0, 16 / 255.0, 38 / 255.0, 0.9)]],
			Vector2(0.5, 0.3), Vector2(0.5 + 1.0, 0.3), true)))
		pv.add_child(clip)
		var rim := Panel.new()
		var rs := UiKit.sbox(Color(0, 0, 0, 0), 18, Color(1, 1, 1, 0.12), 1)
		rs.draw_center = false
		rim.add_theme_stylebox_override("panel", rs)
		rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
		pv.add_child(rim)
		var mc := MarginContainer.new()
		mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for sd in [["left", 14], ["right", 14], ["top", 18], ["bottom", 18]]:
			mc.add_theme_constant_override("margin_" + String(sd[0]), int(sd[1]))
		pv.add_child(mc)
		_preview = m._vbox(6)
		_preview.alignment = BoxContainer.ALIGNMENT_BEGIN
		mc.add_child(_preview)
		wrap.add_child(pv)
	else:
		_preview = null
	v.add_child(wrap)
	if tab == "emote":
		v.add_child(S.foot(I18n.t("col.emoteHint")))
	var worn := ""
	for id in ids:
		if _wearable() and S.worn(String(id)):
			worn = String(id)
			break
	_show_preview(worn if worn != "" else String(ids[0]))

# One item (.col-item): flag (EQUIPPED / NEW), picture, name, how to get it if locked.
func _tile(id: String, w: float, is_new: bool) -> Control:
	var own := _has(id)
	var on := _wearable() and S.worn(id)
	var bg := Color(1, 0.824, 0.247, 0.12) if on else Color(1, 1, 1, 0.04)
	var bc := UiKit.YELLOW if on else Color(1, 1, 1, 0.1)
	var pd := Vector4(6, 8, 6, 8) if small else Vector4(10, 16, 10, 12)
	var hover_bg := Color(1, 1, 1, 0.09) if not on else bg
	var b := MenuTap.new(UiKit.pads(UiKit.sbox(bg, 14, bc, 1), pd.x, pd.y, pd.z, pd.w),
		UiKit.pads(UiKit.sbox(hover_bg if own else bg, 14, bc, 1), pd.x, pd.y, pd.z, pd.w))
	b.custom_minimum_size.x = w
	b.silent = true
	if own and _wearable() and not on:
		b.lift = 3.0   # #meta .col-item:not(.locked):hover translateY(-3px)
	if not own or not _wearable():
		b.mouse_default_cursor_shape = Control.CURSOR_ARROW
	b.sink = 0.0
	var col: VBoxContainer = m._vbox(4)
	b.add_child(col)
	var ih := 56.0 if small else 104.0
	var v := S.item_view(id, ih)
	var ico := Control.new()
	ico.custom_minimum_size.y = ih
	ico.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var cc := CenterContainer.new()
	cc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var pic: Control = v.icon
	if not own:   # locked recolours keep their colours: saturate(0.6) brightness(0.8), a bit faded
		pic.modulate = Color(0.8, 0.8, 0.8, 0.75)
	cc.add_child(pic)
	ico.add_child(cc)
	col.add_child(ico)
	if String(v.name) != "":
		var nm := S.body(String(v.name), 12 if small else 15, UiKit.WTEXT if own else UiKit.WMUTED, 900)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		nm.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(nm)
	if not own:
		var hw := S.body("🔒 " + _how(id), 10 if small else 12, Color("d9d3f0"), 800)
		hw.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		hw.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(hw)
	var over := Control.new()   # flags and the preview outline, over the tile
	over.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(over)
	var flag_t := I18n.t("col.equipped") if on else (I18n.t("col.new") if is_new else "")
	if flag_t != "":
		var f := S.body(flag_t, 9 if small else 10, UiKit.INK if on else Color.WHITE, 900)
		f.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(UiKit.YELLOW if on else Color("f03e3e"), 6), 6, 1, 6, 2))
		f.set_anchors_preset(Control.PRESET_TOP_RIGHT)
		f.grow_horizontal = Control.GROW_DIRECTION_BEGIN
		f.offset_right = -6 + pd.z
		f.offset_left = f.offset_right
		f.offset_top = 6 - pd.y
		over.add_child(f)
	var sel := Panel.new()       # .col-item.sel: outline 2px rgba(255,255,255,.55), inset
	var ss := UiKit.sbox(Color(0, 0, 0, 0), 14, Color(1, 1, 1, 0.55), 2)
	ss.draw_center = false
	sel.add_theme_stylebox_override("panel", ss)
	sel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	sel.offset_left = -pd.x
	sel.offset_top = -pd.y
	sel.offset_right = pd.z
	sel.offset_bottom = pd.w
	sel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sel.visible = false
	over.add_child(sel)
	_tiles[id] = [b, sel]
	b.mouse_entered.connect(func(): _show_preview(id))
	b.pressed.connect(func():
		_show_preview(id)
		if not _wearable() or not own or S.worn(id):
			return
		UiKit.click()
		S.wear_item(id)
		m._fill_page("collection"))
	return b

# The big preview on the side (.col-preview): picture, name, kind, how to get it / equipped, a SHOP button.
func _show_preview(id: String) -> void:
	for k in _tiles:
		(_tiles[k][1] as Control).visible = k == id
	if _preview == null:
		return
	for c in _preview.get_children():
		c.queue_free()
	var own := _has(id)
	var v := S.item_view(id, 180.0)
	var ico := Control.new()
	ico.custom_minimum_size.y = 180
	ico.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var cc := CenterContainer.new()
	cc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cc.add_child(v.icon)
	ico.add_child(cc)
	_preview.add_child(ico)
	var nm := S.disp(String(v.name) if String(v.name) != "" else String(v.sub), 22)
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nm.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_preview.add_child(nm)
	var sb := S.body(String(v.sub) if String(v.name) != "" else "", 12, UiKit.WMUTED)
	sb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_preview.add_child(sb)
	var em_t := ""
	if not own:
		em_t = "🔒 " + _how(id)
	elif _wearable() and S.worn(id):
		em_t = "✓ " + I18n.t("col.equipped")
	var em := S.body(em_t, 13, UiKit.YELLOW, 900)
	em.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	em.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_preview.add_child(em)
	if not own and _today.has(id):
		var l := S.disp("🛒 " + I18n.t("meta.shop"), 15, UiKit.INK)
		var b := S.grad_button(l, MenuShop.GOLD_TOP, MenuShop.GOLD_BOT, 10, Vector2(16, 8), 3.0)
		b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		b.pressed.connect(func(): MenuShop.tab = "featured"; m._open_page("shop"))
		var bm := MarginContainer.new()
		bm.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bm.add_theme_constant_override("margin_top", 6)
		bm.add_child(b)
		_preview.add_child(bm)
