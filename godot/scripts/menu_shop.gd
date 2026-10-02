extends RefCounted
# The SHOP page of the menu (src/metaui.js shop(), the .shop / .sh-item / .sh-buy / .sh-two rules of
# meta.css and home.css): the shop of the day (one featured skin at -20 % and four other items, the same
# for everyone), every brawler (the starters are free, the others cost Slop Coins or Gems), skins per
# brawler, effects, emotes, profile looks, and the Gem packs (payment is not integrated yet: the packs
# show COMING SOON, development builds get the web's TEST buttons). Also the item pictures and the
# pieces the collection page (menu_collection.gd) shares.
#
# Built into the page view of menu.gd (_fill_page); a purchase or a tab re-fills the page.

const MenuTap := preload("res://scripts/menu_tap.gd")
const MenuW := preload("res://scripts/menu_widgets.gd")

const WEARABLE := ["skin", "trail", "ko", "frame", "title", "icon"]
const TABS := ["featured", "brawlers", "skins", "effects", "emotes", "profile", "gems"]
const GOLD_TOP := Color("ffe36b")
const GOLD_BOT := Color("ffbf1f")
const VIO_TOP := Color("d9a8ff")
const VIO_BOT := Color("9a5cf0")
const COIN_TXT := Color("ffe27a")
const GEM_TXT := Color("e6c4ff")
const SHORT_TXT := Color("ff9a9a")

static var tab := "featured"
static var skins_of := ""

var m      # MainMenu (untyped: its helpers are called dynamically)
var small := false   # phones held sideways (max-height: 520px)

func _init(menu) -> void:
	m = menu
	small = bool(m.phone)

# ------------------------------------------------------------------ shared pieces

static func cap(s: String) -> String:
	return s.substr(0, 1).to_upper() + s.substr(1) if s != "" else s

static func brawler_name(key: String) -> String:
	return String(GameData.brawlers[key].name) if GameData.brawlers.has(key) else cap(key)

func disp(t: String, size: int, col: Color = Color.WHITE) -> Label:
	return m._disp(t, size, col)

func body(t: String, size: int, col: Color = UiKit.WTEXT, w: int = 800) -> Label:
	return m._body(t, size, col, w)

func center(c: Control) -> CenterContainer:
	var cc := CenterContainer.new()
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cc.add_child(c)
	return cc

func hbox(sep: float) -> HBoxContainer:
	return m._hbox(sep)

func vbox(sep: float) -> VBoxContainer:
	return m._vbox(sep)

# A coin / gem amount: the drawn coin and the number (.coin-n / .gem-n).
func money(cur: String, n: Variant, size: int, col: Color) -> HBoxContainer:
	var h := hbox(maxi(2, int(size * 0.25)))
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	var ic: Control = MenuW.Coin.new(size * 0.95) if cur == "coins" else MenuW.Gem.new(size * 0.9)
	ic.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(ic)
	var l := disp(m._num(int(n)) if (n is int or n is float) else String(n), size, col)
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	h.add_child(l)
	return h

# The two wallets as one chip (#metaCoins.tn-chip): coins then gems.
func wallet_chip() -> Control:
	var p: PanelContainer = m._panel(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.06), 17, Color(1, 1, 1, 0.1), 1), 12, 0, 12, 0))
	p.custom_minimum_size.y = 28 if small else 34
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var h := hbox(12)
	h.add_child(money("coins", MetaProfile.coins(), 13 if small else 16, COIN_TXT))
	h.add_child(money("gems", MetaProfile.gems(), 13 if small else 16, GEM_TXT))
	p.add_child(h)
	return p

# A button with the web's gradient, ink border and hard ink shadow (.sh-buy, .hu-buy, .cp-shop).
# top == bottom: a flat colour. Returns the MenuTap; `content` goes inside with the CSS padding.
func grad_button(content: Control, top: Color, bottom: Color, radius: int, pad: Vector2, shadow: float = 3.0, border := 2) -> MenuTap:
	var b := MenuTap.new(StyleBoxEmpty.new())
	var under := Panel.new()
	var flat := top == bottom
	under.add_theme_stylebox_override("panel", UiKit.sbox(top if flat else UiKit.INK, radius, Color(0, 0, 0, 0), 0, UiKit.INK if shadow > 0 else Color(0, 0, 0, 0), shadow, 1))
	under.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(under)
	if not flat:
		var clip := UiKit.clip_box(radius)
		clip.add_child(UiKit.grad_rect(pgrad([[0.0, top], [1.0, bottom]])))
		b.add_child(clip)
	if border > 0:
		var rim := Panel.new()
		var rs := UiKit.sbox(Color(0, 0, 0, 0), radius, UiKit.INK, border)
		rs.draw_center = false
		rim.add_theme_stylebox_override("panel", rs)
		rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(rim)
	var mc := MarginContainer.new()   # the padding (the background layers fill the whole button)
	mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mc.add_theme_constant_override("margin_left", int(pad.x))
	mc.add_theme_constant_override("margin_right", int(pad.x))
	mc.add_theme_constant_override("margin_top", int(pad.y))
	mc.add_theme_constant_override("margin_bottom", int(pad.y))
	mc.add_child(content)
	b.add_child(mc)
	if shadow > 0:
		b.sink = shadow - 1.0
		b.moved.connect(func(dy: float):
			under.add_theme_stylebox_override("panel", UiKit.sbox(top if flat else UiKit.INK, radius, Color(0, 0, 0, 0), 0, UiKit.INK, maxf(shadow - dy, 0.0), 1)))
	return b

# UiKit.grad with the browser's colour maths: CSS gradients interpolate premultiplied colours, so a
# transparent-to-dark stop does not wash through a bright mid tone (Gradient interpolates straight ones).
static func pgrad(stops: Array, from: Vector2 = Vector2(0, 0), to: Vector2 = Vector2(0, 1), radial: bool = false) -> GradientTexture2D:
	var dense: Array = []
	for i in stops.size():
		if i == 0:
			dense.append(stops[0])
			continue
		var a: Color = stops[i - 1][1]
		var b: Color = stops[i][1]
		for k in range(1, 9):
			var t := k / 8.0
			var al := lerpf(a.a, b.a, t)
			var pr := Vector3(a.r * a.a, a.g * a.a, a.b * a.a).lerp(Vector3(b.r * b.a, b.g * b.a, b.b * b.a), t)
			var c := Color(pr.x / al, pr.y / al, pr.z / al, al) if al > 0.0001 else Color(0, 0, 0, 0)
			dense.append([lerpf(float(stops[i - 1][0]), float(stops[i][0]), t), c])
	return UiKit.grad(dense, from, to, radial)

# A disabled look: no click, no sound, the arrow cursor.
static func inert(b: MenuTap, alpha: float = 1.0) -> void:
	b.silent = true
	b.sink = 0.0
	b.mouse_default_cursor_shape = Control.CURSOR_ARROW
	b.modulate.a = alpha

# The picture of a profile icon (cosmetics.js ICONS): a brawler portrait or a sticker.
func icon_pic(n: int, h: float) -> Control:
	var icons: Array = MetaProfile.D().get("icons", [])
	var I := String(icons[n] if n >= 0 and n < icons.size() else icons[0])
	if I.begins_with("p:"):
		return portrait(I.substr(2), h)
	return emo(I, int(h * 0.62))

func emo(t: String, size: int) -> Label:
	var l: Label = m._emoji(t, size)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return l

func portrait(key: String, h: float, mat: Material = null) -> TextureRect:
	var tr := TextureRect.new()
	tr.texture = UiKit.portrait(key)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	var asp := 1.0
	if tr.texture:
		asp = float(tr.texture.get_width()) / maxf(float(tr.texture.get_height()), 1.0)
	tr.custom_minimum_size = Vector2(h * asp, h)
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if mat:
		tr.material = mat
	return tr

# metaui.js skinFilter: the recolour of skin n on a portrait (dim < 1 for the locked look).
func skin_mat(key: String, n: int, dim: float = 1.0) -> ShaderMaterial:
	var skins: Array = MetaProfile.D().skins
	var s := String(skins[n]) if n < skins.size() else "default"
	return MenuW.recolour(s, m._skin_rec(key, s), dim)

# The frames around a portrait (.fr-wood, .fr-gold ...): border, inner ring, glow.
const FRAME_LOOK := {
	"none": [Color("16121f"), Color(0, 0, 0, 0), Color(0, 0, 0, 0)],
	"wood": [Color("8a5a2e"), Color("c48a4e"), Color(0, 0, 0, 0)],
	"silver": [Color("c9d2e0"), Color("7d8799"), Color(0, 0, 0, 0)],
	"gold": [Color("ffd23f"), Color("b27d00"), Color(1, 0.824, 0.247, 0.6)],
	"slime": [Color("5cff6e"), Color(0, 0, 0, 0), Color(0.36, 1, 0.43, 0.6)],
	"neon": [Color("ff4bd8"), Color("39c6ff"), Color("ff4bd8")],
	"frost": [Color("bfe8ff"), Color("39c6ff"), Color(0.47, 0.78, 1, 0.7)],
	"flame": [Color("ff7a1c"), Color(1, 0.35, 0, 0.7), Color(1, 0.47, 0, 0.8)],
	"royal": [Color("9b5cff"), Color("ffd23f"), Color(0.61, 0.36, 1, 0.7)],
	"pixel": [Color("4bff86"), Color(0, 0, 0, 0), Color(0, 0, 0, 0)],
	"diamond": [Color("e6fbff"), Color("7fe0ff"), Color(0.63, 0.94, 1, 0.9)],
}

# Your profile icon in a frame (.pf.fr-*), d px square.
func framed(frame: int, d: float) -> Control:
	var frames: Array = MetaProfile.D().get("frames", ["none"])
	var name: String = String(frames[frame]) if frame < frames.size() else "none"
	var look: Array = FRAME_LOOK.get(name, FRAME_LOOK["none"])
	var r := 0 if name == "pixel" else (int(d * 0.45) if name == "slime" else int(d * 0.26))
	var box := Control.new()
	box.custom_minimum_size = Vector2(d, d)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bw := maxi(2, int(d / 16.0))
	var outer := Panel.new()
	var os := UiKit.sbox(Color(1, 1, 1, 0.08), r, look[0], bw, look[2] if (look[2] as Color).a > 0 else Color(0, 0, 0, 0), 0, int(d * 0.2))
	if name == "pixel":
		os.shadow_color = Color("1fc45a")
		os.shadow_offset = Vector2(3, 3)
		os.shadow_size = 1
	outer.add_theme_stylebox_override("panel", os)
	outer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	outer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if name != "none":
		var ink := Panel.new()
		var iks := UiKit.sbox(Color(0, 0, 0, 0), r + 2, UiKit.INK, 2)
		iks.draw_center = false
		for side in [SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM]:
			iks.set_expand_margin(side, 2)
		ink.add_theme_stylebox_override("panel", iks)
		ink.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		ink.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.add_child(ink)
	box.add_child(outer)
	var clip := UiKit.clip_box(maxi(r - bw, 0))
	clip.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	clip.offset_left = bw
	clip.offset_top = bw
	clip.offset_right = -bw
	clip.offset_bottom = -bw
	box.add_child(clip)
	var pic := icon_pic(Settings.icon, (d - 2 * bw) * 1.18)
	var cc := CenterContainer.new()
	cc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if pic is TextureRect:
		cc.offset_top = (d - 2 * bw) * 0.24
	cc.add_child(pic)
	clip.add_child(cc)
	if (look[1] as Color).a > 0:
		var inner := Panel.new()
		var ins := UiKit.sbox(Color(0, 0, 0, 0), maxi(r - bw, 0), look[1], 2)
		ins.draw_center = false
		inner.add_theme_stylebox_override("panel", ins)
		inner.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		inner.offset_left = bw
		inner.offset_top = bw
		inner.offset_right = -bw
		inner.offset_bottom = -bw
		inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.add_child(inner)
	return box

# A title as the chip it is on the podium (.title-chip).
func title_chip(n: int, size: int = 14) -> Control:
	var titles: Array = MetaProfile.D().get("titles", [])
	var l := body(I18n.t("cos.title." + String(titles[n])), size, UiKit.YELLOW, 900)
	l.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color(1, 0.824, 0.247, 0.15), 8, Color(1, 0.824, 0.247, 0.5), 1), 10, 4, 10, 4))
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return l

# metaui.js itemView: what an item id looks like ({icon} built at `h` px) and is called.
func item_view(id: String, h: float) -> Dictionary:
	var p := id.split(":")
	var d := MetaProfile.D()
	match p[0]:
		"skin":
			return {"icon": portrait(p[1], h, skin_mat(p[1], int(p[2]))), "name": I18n.t("cos.skin." + String(d.skins[int(p[2])])), "sub": I18n.t("cos.kind.skin", {"name": brawler_name(p[1])})}
		"trail":
			return {"icon": emo(String(d.trailIcons[int(p[1])]), int(h * 0.58)), "name": I18n.t("cos.trail." + String(d.trails[int(p[1])])), "sub": I18n.t("cos.kind.trail")}
		"ko":
			return {"icon": emo(String(d.kofxIcons[int(p[1])]), int(h * 0.58)), "name": I18n.t("cos.ko." + String(d.kofx[int(p[1])])), "sub": I18n.t("cos.kind.ko")}
		"emote":
			return {"icon": emo(String(d.emoteIcons[(d.emotes as Array).find(p[1])]), int(h * 0.58)), "name": I18n.t("cos.emote." + p[1]), "sub": I18n.t("cos.kind.emote")}
		"frame":
			return {"icon": framed(int(p[1]), h * 0.78), "name": I18n.t("cos.frame." + String(d.frames[int(p[1])])), "sub": I18n.t("cos.kind.frame")}
		"title":
			return {"icon": title_chip(int(p[1]), 14 if h < 150 else 22), "name": "", "sub": I18n.t("cos.kind.title")}
		"icon":
			return {"icon": icon_pic(int(p[1]), h * 0.9), "name": "", "sub": I18n.t("cos.kind.icon")}
	return {"icon": Control.new(), "name": id, "sub": ""}

func worn(id: String) -> bool:
	var p := id.split(":")
	var W := MetaProfile.wearing()
	if p[0] == "skin":
		return MetaProfile.skin_of(p[1]) == int(p[2])
	if p[0] == "icon":
		return Settings.icon == int(p[1])
	return int(W.get(p[0], -1)) == int(p[1])

func wear_item(id: String) -> void:
	var p := id.split(":")
	if p[0] == "skin":
		MetaProfile.wear("skin", int(p[2]), p[1])
	else:
		MetaProfile.wear(p[0], int(p[1]))
		if p[0] == "icon":    # the profile icon of the options panel is the same one
			Settings.icon = int(p[1])
			Settings.save()
	m._on_wear()

# The tab row (.col-tabs .col-tab): [key, label, count or ""] each; `on` the current key.
func tab_row(items: Array, on: String, pick: Callable) -> Control:
	var row: Control
	if small:   # phones: one scrolling row
		var sc := ScrollContainer.new()
		sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
		var h := hbox(6)
		sc.add_child(h)
		row = sc
	else:
		var f := HFlowContainer.new()
		f.add_theme_constant_override("h_separation", 6)
		f.add_theme_constant_override("v_separation", 6)
		f.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row = f
	var holder: Control = row.get_child(0) if small else row
	for it in items:
		var k := String(it[0])
		var is_on := k == on
		var bg := Color(1, 0.824, 0.247, 0.22) if is_on else Color(1, 1, 1, 0.06)
		var pd := Vector2(10, 6) if small else Vector2(16, 8)
		var b := MenuTap.new(UiKit.pads(UiKit.sbox(bg, 10, Color(1, 1, 1, 0.1), 1), pd.x, pd.y, pd.x, pd.y),
			UiKit.pads(UiKit.sbox(bg if is_on else Color(1, 1, 1, 0.12), 10, Color(1, 1, 1, 0.1), 1), pd.x, pd.y, pd.x, pd.y))
		if small:
			b.custom_minimum_size.y = 36
		var h := hbox(6)
		h.alignment = BoxContainer.ALIGNMENT_CENTER
		var l := body(String(it[1]), 11 if small else 14, UiKit.WTEXT, 900)
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		h.add_child(l)
		if String(it[2]) != "" and not small:
			var c := body(String(it[2]), 11, Color(UiKit.WTEXT, 0.7), 900)
			c.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			h.add_child(c)
		b.add_child(h)
		b.pressed.connect(func(): pick.call(k))
		holder.add_child(b)
	return row

# The brawler picker of the skins tabs (.col-brawlers): portrait squares, the chosen one framed yellow.
func brawler_pick(on: String, pick: Callable) -> Control:
	var row := hbox(6)
	var d := 42.0 if small else 64.0
	for k in GameData.brawlers.keys():
		var key := String(k)
		var is_on := key == on
		var b := MenuTap.new(UiKit.sbox(Color(1, 1, 1, 0.06), 12, UiKit.YELLOW if is_on else UiKit.INK, 2),
			UiKit.sbox(Color(1, 1, 1, 0.12), 12, UiKit.YELLOW if is_on else UiKit.INK, 2))
		b.custom_minimum_size = Vector2(d, d)
		var clip := UiKit.clip_box(10)
		clip.custom_minimum_size = Vector2(d, d)
		var img := portrait(key, d * 1.0)
		img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		img.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		img.offset_left = 2
		img.offset_top = 2
		img.offset_right = -2
		img.offset_bottom = d * 0.3
		clip.add_child(img)
		b.add_child(clip)
		var rim := Panel.new()
		var rs := UiKit.sbox(Color(0, 0, 0, 0), 12, UiKit.YELLOW if is_on else UiKit.INK, 2)
		rs.draw_center = false
		rim.add_theme_stylebox_override("panel", rs)
		b.add_child(rim)
		b.tooltip_text = brawler_name(key)
		b.pressed.connect(func(): pick.call(key))
		row.add_child(b)
	return row

# grid-template-columns: repeat(auto-fill, minmax(minw, 1fr)): [columns, column width].
static func cols(avail: float, minw: float, gap: float) -> Array:
	var n := maxi(1, int(floor((avail + gap) / (minw + gap))))
	return [n, (avail - gap * (n - 1)) / n]

func grid(n: int, gap: float) -> GridContainer:
	var g := GridContainer.new()
	g.columns = n
	g.add_theme_constant_override("h_separation", int(gap))
	g.add_theme_constant_override("v_separation", int(gap))
	g.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return g

func foot(t: String) -> Label:
	var l := body(t, 13, UiKit.WMUTED, 700)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l

func clock(ms: float) -> String:
	var mins := maxi(0, int(round(ms / 60000.0)))
	if mins >= 1440:
		return I18n.t("meta.days", {"n": mins / 1440})
	return "%dh %dm" % [mins / 60, mins % 60]

# ------------------------------------------------------------------ the page

# head: the page's title row (meta-head); v: the page body; aw: its width in CSS px.
static var _args_read := false

func build(head: HBoxContainer, v: VBoxContainer, aw: float) -> void:
	if not _args_read:   # screenshots: --shoptab=brawlers [--skinof=volt]
		_args_read = true
		for a in DebugArgs.list():
			if a.begins_with("--shoptab="):
				tab = a.substr(10)
			elif a.begins_with("--skinof="):
				skins_of = a.substr(9)
	var brawlers: Array = GameData.brawlers.keys()
	if tab == "featured":
		var sub := body(I18n.t("shop.refresh", {"time": clock(MetaProfile.reset_in_ms())}), 13, UiKit.WMUTED)
		sub.size_flags_vertical = Control.SIZE_SHRINK_END
		var sm := MarginContainer.new()
		sm.mouse_filter = Control.MOUSE_FILTER_IGNORE
		sm.add_theme_constant_override("margin_bottom", 4 if small else 8)
		sm.add_child(sub)
		sm.size_flags_vertical = Control.SIZE_SHRINK_END
		head.add_child(sm)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	head.add_child(sp)
	head.add_child(wallet_chip())
	var items: Array = []
	for k in TABS:
		items.append([k, I18n.t("shop.tab." + k), ""])
	v.add_child(tab_row(items, tab, func(k: String): tab = k; m._fill_page("shop")))
	var pool := MetaProfile.shop_pool(brawlers)
	var gap := 8.0 if small else 12.0
	var n3 := 4 if small else 3
	var cw := (aw - gap * (n3 - 1)) / n3
	match tab:
		"featured":
			var ids := MetaProfile.shop_items(brawlers)
			var row := hbox(gap)
			row.add_child(card(ids[0], cw, MetaProfile.price_of(ids[0]), 0.2, "featured"))
			var g := grid(n3 - 1, gap)
			for i in range(1, ids.size()):
				g.add_child(card(ids[i], cw, MetaProfile.price_of(ids[i])))
			row.add_child(g)
			v.add_child(row)
		"brawlers":
			var c := cols(aw, 190, gap)
			var g := grid(c[0], gap)
			for k in brawlers:
				g.add_child(brawler_card(String(k), c[1]))
			v.add_child(g)
		"skins":
			if skins_of == "" or not GameData.brawlers.has(skins_of):
				skins_of = Settings.brawler
			v.add_child(brawler_pick(skins_of, func(k: String): skins_of = k; m._fill_page("shop")))
			var g := grid(n3, gap)
			for id in pool:
				if String(id).begins_with("skin:%s:" % skins_of):
					g.add_child(card(id, cw, MetaProfile.price_of(id)))
			var gold := "skin:%s:3" % skins_of
			g.add_child(card(gold, cw, MetaProfile.price_of(gold), 0.0, "" if MetaProfile.owns(gold) else "earned"))
			v.add_child(g)
		"effects", "emotes", "profile":
			var g := grid(n3, gap)
			for id in pool:
				var kd := MetaProfile.kind_of(id)
				var ok := (tab == "effects" and (kd == "trail" or kd == "ko")) or (tab == "emotes" and kd == "emote") \
					or (tab == "profile" and (kd == "frame" or kd == "title" or kd == "icon"))
				if ok:
					g.add_child(card(id, cw, MetaProfile.price_of(id)))
			v.add_child(g)
		"gems":
			var lead := foot(I18n.t("shop.gemsLead"))
			lead.visible = not small
			v.add_child(lead)
			var c := cols(aw, 170, gap)
			var g := grid(c[0], gap)
			var packs: Array = MetaProfile.D().get("gemPacks", [])
			for i in packs.size():
				g.add_child(pack_card(i, int(packs[i][0]), float(packs[i][1]), c[1]))
			v.add_child(g)
	v.add_child(foot(I18n.t("shop.fair")))

# The card's frame (.sh-item / .featured): a gradient panel with a thin border.
func card_box(w: float, featured: bool, pad := Vector4(10, 14, 10, 10)) -> Array:
	var outer := PanelContainer.new()
	outer.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	outer.custom_minimum_size.x = w
	outer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var clip := UiKit.clip_box(16)
	var top := Color(1, 0.824, 0.247, 0.2) if featured else Color(143 / 255.0, 107 / 255.0, 1, 0.16)
	var bot := Color(20 / 255.0, 16 / 255.0, 38 / 255.0, 0.9)
	clip.add_child(UiKit.grad_rect(pgrad([[0.0, top], [1.0, bot]])))
	outer.add_child(clip)
	var rim := Panel.new()
	var rs := UiKit.sbox(Color(0, 0, 0, 0), 16, Color(1, 0.824, 0.247, 0.4) if featured else Color(1, 1, 1, 0.12), 1)
	rs.draw_center = false
	rim.add_theme_stylebox_override("panel", rs)
	rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	outer.add_child(rim)
	var mc := MarginContainer.new()
	mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mc.add_theme_constant_override("margin_left", int(pad.x))
	mc.add_theme_constant_override("margin_top", int(pad.y))
	mc.add_theme_constant_override("margin_right", int(pad.z))
	mc.add_theme_constant_override("margin_bottom", int(pad.w))
	outer.add_child(mc)
	var col := vbox(4)
	mc.add_child(col)
	var over := Control.new()   # absolute children (the deal badge)
	over.mouse_filter = Control.MOUSE_FILTER_IGNORE
	outer.add_child(over)
	return [outer, col, over]

# One buy button: the price in a currency, and what you are missing (.sh-buy[.short][.by-coins]).
func buy_btn(id: String, price: int, cur: String, two: bool) -> Control:
	var have := MetaProfile.coins() if cur == "coins" else MetaProfile.gems()
	var short := have < price
	var fs := (12 if small else 15) if two else (14 if small else 18)
	var col := UiKit.INK
	if short:
		col = COIN_TXT if cur == "coins" else GEM_TXT
	var inner := vbox(0)
	inner.alignment = BoxContainer.ALIGNMENT_CENTER
	inner.add_child(money(cur, price, fs, col))
	if short:
		var s := body(I18n.t("shop.missing", {"n": m._num(price - have)}), 11, SHORT_TXT, 900)
		s.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		inner.add_child(s)
	# a price you can't pay sits on the dark glass for both currencies (the pale yellow / pink text
	# was unreadable on the gold gradient)
	var top := GOLD_TOP if cur == "coins" else VIO_TOP
	var bot := GOLD_BOT if cur == "coins" else VIO_BOT
	if short:
		top = Color(1, 1, 1, 0.08)
		bot = Color(1, 1, 1, 0.08)
	var b := grad_button(inner, top, bot, 12, Vector2(10, 6) if two else Vector2(18, 6), 3.0)
	b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	if short:
		inert(b)
	else:
		b.silent = true
		b.pressed.connect(func(): _buy(id, price, cur))
	return b

func _buy(id: String, price: int, cur: String) -> void:
	if not MetaProfile.buy(id, price, cur):
		return
	UiKit.click("buy")
	if id.begins_with("brawler:"):
		m._on_brawler_bought(id.substr(8))
	m._fill_page("shop")
	m._refresh_meta()

# A plain button: OWNED / EQUIPPED (flat), EQUIP (violet), the golden skin's lock.
func flat_btn(t: String, kind: String) -> MenuTap:
	var fs := 14 if small else 18
	var l := disp(t, 13 if kind == "earned" else fs, Color.WHITE if kind == "wear" else UiKit.WTEXT)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var b: MenuTap
	match kind:
		"wear":
			b = grad_button(l, Color("8f6bff"), Color("6a3fe6"), 12, Vector2(18, 6), 3.0)
		"earned":
			b = grad_button(l, Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.08), 12, Vector2(18, 7), 3.0)
			inert(b)
		_:
			b = grad_button(l, Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.12), 12, Vector2(18, 6), 3.0)
			inert(b)
	b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	return b

# metaui.js card(): picture, name, kind, the struck-out price of a deal, the button(s).
func card(id: String, w: float, price: int, deal: float = 0.0, cls: String = "") -> Control:
	var featured := cls == "featured"
	var earned := cls == "earned"
	var parts := card_box(w, featured)
	var col: VBoxContainer = parts[1]
	var own := MetaProfile.owns(id)
	var kind := MetaProfile.kind_of(id)
	var ico_h := (110.0 if featured else 54.0) if small else (190.0 if featured else 90.0)
	var img_h := (110.0 if featured else 54.0) if small else (170.0 if featured else 90.0)
	var v := item_view(id, img_h)
	var ico := Control.new()
	ico.custom_minimum_size.y = ico_h
	ico.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var cc := CenterContainer.new()
	cc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cc.add_child(v.icon)
	ico.add_child(cc)
	col.add_child(ico)
	var nm := disp(String(v.name) if String(v.name) != "" else String(v.sub), 14 if small else 18)
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nm.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(nm)
	var sb := body(String(v.sub) if String(v.name) != "" else "", 12, UiKit.WMUTED)
	sb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sb.custom_minimum_size.y = 16
	col.add_child(sb)
	var cost := int(round(price * (1.0 - deal)))
	if deal > 0.0 and not own:
		var was := body(m._num(price), 13, UiKit.WMUTED, 900)   # <s class="sh-was">
		var strike := ColorRect.new()
		strike.color = UiKit.WMUTED
		strike.mouse_filter = Control.MOUSE_FILTER_IGNORE
		strike.set_anchors_preset(Control.PRESET_CENTER_LEFT)
		strike.anchor_right = 1.0
		strike.offset_top = 0.5
		strike.offset_bottom = 2.0
		was.add_child(strike)
		col.add_child(center(was))
		var badge := disp("-%d%%" % int(round(deal * 100)), 15)
		badge.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color("f03e3e"), 8, UiKit.INK, 2), 8, 1, 8, 2))
		badge.position = Vector2(8, 8)
		badge.rotation = deg_to_rad(-8)
		(parts[2] as Control).add_child(badge)
	var btn: Control
	if not own:
		if kind == "skin" and not earned:   # skins: Slop Coins or Gems (the golden one is earned)
			btn = two_btns(id, int(MetaProfile.D().get("skinCoins", 1000)), cost)
		elif earned:
			btn = flat_btn("🔒 " + I18n.t("col.gold", {"n": int(MetaProfile.D().get("goldAt", 10))}), "earned")
		else:
			btn = buy_btn(id, cost, "gems", false)
	elif WEARABLE.has(kind) and not worn(id):
		var b := flat_btn(I18n.t("shop.equip"), "wear")
		b.pressed.connect(func(): wear_item(id); m._fill_page("shop"))
		btn = b
	else:
		btn = flat_btn(I18n.t("col.equipped") if WEARABLE.has(kind) else I18n.t("shop.owned"), "own")
	var bm := MarginContainer.new()
	bm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bm.add_theme_constant_override("margin_top", 4)
	bm.add_theme_constant_override("margin_bottom", 3)
	bm.add_child(btn)
	col.add_child(bm)
	if earned:
		parts[0].modulate.a = 0.8
	return parts[0]

# .sh-two: the coins price, "or", the gems price.
func two_btns(id: String, coins_price: int, gems_price: int) -> Control:
	var h := hbox(6)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(buy_btn(id, coins_price, "coins", true))
	var o := body(I18n.t("shop.or"), 11, UiKit.WMUTED, 900)
	o.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	h.add_child(o)
	h.add_child(buy_btn(id, gems_price, "gems", true))
	return h

# A brawler of the BRAWLERS tab (.sh-brawler): the portrait on its colour, name, role, price or OWNED.
func brawler_card(key: String, w: float) -> Control:
	var parts := card_box(w, false)
	var col: VBoxContainer = parts[1]
	var own := MetaProfile.owns_brawler(key)
	var ih := 90.0 if small else 150.0
	var clip := UiKit.clip_box(12)
	clip.custom_minimum_size = Vector2(w - 20, ih)
	var c: Color = m._color(key)
	clip.add_child(UiKit.grad_rect(UiKit.grad([[0.0, UiKit.mix(c, Color.WHITE, 0.55)], [0.6, c], [1.0, UiKit.mix(c, Color.BLACK, 0.45)]],
		Vector2(0.5, 0.35), Vector2(0.5 + 0.8, 0.35), true)))
	var img := portrait(key, ih * 1.07)
	img.custom_minimum_size = Vector2.ZERO
	img.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	img.offset_top = -ih * 0.07 + 8
	img.offset_bottom = 8
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	clip.add_child(img)
	col.add_child(clip)
	var nm := disp(brawler_name(key), 14 if small else 18)
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(nm)
	var role := body(I18n.t("brawler.%s.role" % key), 12, UiKit.WMUTED)
	role.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(role)
	var bp: Dictionary = MetaProfile.D().get("brawlerPrice", {"coins": 1500, "gems": 240})
	var btn: Control = flat_btn(I18n.t("shop.owned"), "own") if own else two_btns("brawler:" + key, int(bp.coins), int(bp.gems))
	var bm := MarginContainer.new()
	bm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bm.add_theme_constant_override("margin_top", 4)
	bm.add_theme_constant_override("margin_bottom", 3)
	bm.add_child(btn)
	col.add_child(bm)
	return parts[0]

# A Gem pack (.sh-pack): the gem, the amount, the price in euros, TEST (development) or COMING SOON.
func pack_card(i: int, n: int, eur: float, w: float) -> Control:
	var parts := card_box(w, false)
	var outer: Control = parts[0]
	if i == 2:   # .sh-pack.featured: a violet border
		var rim: Panel = outer.get_child(1)
		var rs := UiKit.sbox(Color(0, 0, 0, 0), 16, Color(214 / 255.0, 160 / 255.0, 1, 0.6), 1)
		rs.draw_center = false
		rim.add_theme_stylebox_override("panel", rs)
		var clip: Panel = outer.get_child(0)
		(clip.get_child(0) as TextureRect).texture = pgrad([[0.0, Color(1, 0.824, 0.247, 0.2)], [1.0, Color(20 / 255.0, 16 / 255.0, 38 / 255.0, 0.9)]])
	var col: VBoxContainer = parts[1]
	var ico := Control.new()
	ico.custom_minimum_size.y = 60 if small else 100
	ico.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var g := MenuW.Gem.new(34.0 * (1.0 + i * 0.18) * (0.7 if small else 1.0))
	ico.add_child(center(g))
	(ico.get_child(0) as Control).set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	col.add_child(ico)
	col.add_child(center(money("gems", n, 16 if small else 22, GEM_TXT)))
	var price := body(_eur(eur), 13 if small else 15, Color.WHITE, 900)
	price.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(price)
	var test := OS.has_feature("editor")   # the web: import.meta.env.DEV (the dev server only)
	var l := disp(I18n.t("shop.gemsTest", {"n": m._num(n)}) if test else I18n.t("shop.gemsSoon"), 14 if small else (18 if test else 13), UiKit.INK if test else UiKit.WMUTED)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var b := grad_button(l, VIO_TOP if test else Color(1, 1, 1, 0.08), VIO_BOT if test else Color(1, 1, 1, 0.08), 12, Vector2(18, 6), 3.0)
	b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	if test:
		b.silent = true
		b.pressed.connect(func():
			MetaProfile.add_gems(n)   # development builds only (see above)
			UiKit.click("buy")
			m._fill_page("shop")
			m._refresh_meta())
	else:
		inert(b, 0.55)
	var bm := MarginContainer.new()
	bm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bm.add_theme_constant_override("margin_top", 4)
	bm.add_theme_constant_override("margin_bottom", 3)
	bm.add_child(b)
	col.add_child(bm)
	return outer

# Intl currency EUR in the game's language (the common forms).
func _eur(v: float) -> String:
	var s := "%.2f" % v
	var l := I18n.lang
	if l.begins_with("en") or l in ["ja", "ko", "zh-CN", "zh-TW", "th"]:
		return "€" + s
	return s.replace(".", ",") + " €"
