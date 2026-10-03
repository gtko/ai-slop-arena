extends PanelContainer
# Ability previews (like Brawl Stars'): a card with a short looping clip of what a gadget or a star
# power does, its name and its one-line description, over the home screen's loadout buttons and the
# Collection's ability chips. The clips (assets/abilities/<clip>.ogv, Ogg Theora 480x300, 3-4 s) are
# filmed with the game's own renderer from scenes played with the real rules
# (tools/record-abilities.mjs).
#   desktop: hover a button (0.3 s); touch: tap its ▶ badge or long-press it; keyboard / pad: focus it
#   (the card follows the focus ring). A card opened by a tap closes on the next tap anywhere or Esc.
# One card per menu build, made on first use under the menu's page (CSS px, like everything there);
# the clip loads when the card opens and stops (and is let go) when it closes: nothing is loaded at
# menu start.

const MenuTap := preload("res://scripts/menu_tap.gd")
const DIR := "res://assets/abilities/"
const STAR_ICONS := ["⭐", "🌟"]
const GADGET_ICONS := {"blasterA": "🐏", "blasterB": "🪵", "gunslingerA": "🌀", "gunslingerB": "🎆", "bomberA": "🦘", "bomberB": "🧨",
	"frostbiteA": "⛸️", "frostbiteB": "🧊", "voltA": "⚡", "voltB": "🔋", "kappaA": "🤿", "kappaB": "🥣",
	"pipchompA": "🍖", "pipchompB": "🍄", "mochiA": "🛷", "mochiB": "🍡"}
const HOVER_DELAY := 0.3
const LONG_PRESS := 0.45

# The ▶ badge in a button's top-right corner (drawn: no font needed for the glyph).
class Badge extends Control:
	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(18, 18)
		size = Vector2(18, 18)

	func _draw() -> void:
		var c := size / 2.0
		var r := minf(size.x, size.y) / 2.0
		draw_circle(c, r, UiKit.INK)
		draw_circle(c, r - 1.5, UiKit.YELLOW)
		var s := r * 0.42
		draw_colored_polygon(PackedVector2Array([c + Vector2(-s * 0.7, -s), c + Vector2(-s * 0.7, s), c + Vector2(s * 1.05, 0)]), UiKit.INK)

static var _touch_ms := -100000  # the last touch on a hooked button

var m                            # the menu (menu.gd): fonts, layout values
var _anchor: Control
var _spec: Dictionary = {}       # {key, gadget: bool, i}
var _pinned := false             # opened by a tap: stays until the next tap / Esc
var _video: VideoStreamPlayer
var _frame: Control
var _icon: Label
var _kind: Label
var _name: Label
var _desc: Label
var _vw := 320.0

# ---------------------------------------------------------------- hooks (menu.gd, menu_collection.gd)

# The clip of a brawler's gadget ("A" / "B") or star power (1 / 2).
static func clip_path(key: String, gadget: bool, i: int) -> String:
	if gadget:
		return DIR + "gad_%s%s.ogv" % [key, "AB"[i]]
	var stars: Array = Fighter.STARS.get(key, ["", ""])
	return DIR + "star_%s.ogv" % String(stars[i])

static func has_clip(key: String, gadget: bool, i: int) -> bool:
	return ResourceLoader.exists(clip_path(key, gadget, i))

# Make a loadout / chip button show its ability's preview: hover, focus, its ▶ badge, a long press.
static func hook(menu, b: Control, key: String, gadget: bool, i: int) -> void:
	if not has_clip(key, gadget, i):
		return
	var spec := {"key": key, "gadget": gadget, "i": i}
	var over := Control.new()    # (a PanelContainer stretches its children: the badge sits in a plain Control)
	over.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(over)
	var badge := Badge.new()
	badge.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	over.add_child(badge)
	var place := func():
		var st := b.get_theme_stylebox("panel")
		var mr := st.content_margin_right if st else 0.0
		var mt := st.content_margin_top if st else 0.0
		badge.position = Vector2(over.size.x + mr - 12.0, -mt - 6.0)
	over.resized.connect(place)
	b.mouse_exited.connect(func():
		var c = _find(menu)
		if c and c._anchor == b and not c._pinned:
			c.close())
	b.focus_entered.connect(func(): _later(b, 0.15, func(bb: Control):
		if bb.has_focus() and Controls.focus_visible:
			_card(menu).open(bb, spec, false)))
	b.focus_exited.connect(func():
		var c = _find(menu)
		if c and c._anchor == b and not c._pinned:
			c.close())
	b.gui_input.connect(func(ev: InputEvent): _input_on(menu, b, badge, spec, ev))
	for a in DebugArgs.list():   # screenshots: --preview=B (gadget B's card) / --preview=2 (star power 2's)
		if a == "--preview=" + ("AB"[i] if gadget else str(i + 1)):
			_later(b, 0.6, func(bb: Control): _card(menu).open(bb, spec, true))

# A row of the brawler's 4 abilities (gadget A / B, star power 1 / 2) for the Collection page:
# chips that open their preview (hover, focus, tap).
static func chips(menu, key: String, small: bool) -> Control:
	var row: HBoxContainer = menu._hbox(6 if small else 8)
	var stars: Array = Fighter.STARS.get(key, ["", ""])
	for n in 4:
		var gadget := n < 2
		var i := n % 2
		if not has_clip(key, gadget, i):
			continue
		var b := MenuTap.new(UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.05), 10, Color(1, 1, 1, 0.12), 1), 9, 5, 12, 5),
			UiKit.pads(UiKit.sbox(Color(1, 1, 1, 0.1), 10, Color(1, 1, 1, 0.2), 1), 9, 5, 12, 5))
		b.custom_minimum_size.y = 30 if small else 36
		var h: HBoxContainer = menu._hbox(5)
		h.add_child(menu._emoji(String(GADGET_ICONS.get(key + "AB"[i], "?")) if gadget else String(STAR_ICONS[i]), 13 if small else 16))
		var nm: Label = menu._body(I18n.t("gad.%s%s.name" % [key, "AB"[i]]) if gadget else I18n.t("star.%s.name" % String(stars[i])),
			11 if small else 13, UiKit.WTEXT)
		nm.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		h.add_child(nm)
		b.add_child(h)
		var spec := {"key": key, "gadget": gadget, "i": i}
		b.pressed.connect(func(): _card(menu).open(b, spec, true))
		hook(menu, b, key, gadget, i)
		row.add_child(b)
	return row

static func _hovered(b: Control) -> bool:
	return is_instance_valid(b) and b.is_visible_in_tree() and b.get_global_rect().has_point(b.get_global_mouse_position())

# fn(b) in `secs` s, if b still exists then (the loadout is rebuilt on every pick: hold no reference).
static func _later(b: Control, secs: float, fn: Callable) -> void:
	var wb: WeakRef = weakref(b)
	(Engine.get_main_loop() as SceneTree).create_timer(secs).timeout.connect(func():
		var bb = wb.get_ref()
		if bb:
			fn.call(bb))

# Touch / click on a hooked button: the badge opens the card (and doesn't pick the ability), a long
# press opens it too (and the release that follows doesn't pick either).
static func _input_on(menu, b: Control, _badge: Control, spec: Dictionary, ev: InputEvent) -> void:
	if ev is InputEventMouseButton and (ev as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		var mb := ev as InputEventMouseButton
		if mb.pressed and Rect2(b.size.x - 28.0, 0.0, 28.0, 24.0).has_point(mb.position):   # the badge corner (b's own px)
			b.accept_event()
			var c = _find(menu)
			if c and c.visible and c._anchor == b and c._pinned:
				c.close()
			else:
				_card(menu).open(b, spec, true)
			b.set_meta("ap_eat", true)
		elif not mb.pressed and b.get_meta("ap_eat", false):
			b.set_meta("ap_eat", false)
			b.accept_event()
	elif ev is InputEventScreenTouch:
		var st := ev as InputEventScreenTouch
		_touch_ms = Time.get_ticks_msec()   # (a phone's taps also move the mouse: no hover card then)
		if st.pressed:
			var n := int(b.get_meta("ap_touch", 0)) + 1
			b.set_meta("ap_touch", n)
			_later(b, LONG_PRESS, func(bb: Control):
				if int(bb.get_meta("ap_touch", 0)) == n and bb.get_meta("ap_held", false):
					bb.set_meta("ap_eat", true)
					_card(menu).open(bb, spec, true))
			b.set_meta("ap_held", true)
		else:
			b.set_meta("ap_held", false)
	elif ev is InputEventMouseMotion and ev.device != InputEvent.DEVICE_ID_EMULATION and Time.get_ticks_msec() - _touch_ms > 1500:
		var c = _find(menu)
		if c == null or not c.visible or c._anchor != b:
			if not b.has_meta("ap_wait") or not b.get_meta("ap_wait"):
				b.set_meta("ap_wait", true)
				_later(b, HOVER_DELAY, func(bb: Control):
					bb.set_meta("ap_wait", false)
					if _hovered(bb) and not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and Time.get_ticks_msec() - _touch_ms > 1500:
						_card(menu).open(bb, spec, false))

static func _find(menu):
	var page: Control = menu.get("_page")
	if page == null or not is_instance_valid(page):
		return null
	return page.get_node_or_null("AbilityPreview")

static func _card(menu):
	var c = _find(menu)
	if c == null:
		c = (load("res://scripts/ability_preview.gd") as GDScript).new()
		c.name = "AbilityPreview"
		c.m = menu
		(menu.get("_page") as Control).add_child(c)
		c._build()
	return c

# ---------------------------------------------------------------- the card

func _build() -> void:
	var phone: bool = bool(m.phone)
	_vw = 236.0 if phone else 320.0
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE   # hover passes through to the buttons under it
	z_index = 20
	var p := 8 if phone else 10
	add_theme_stylebox_override("panel", UiKit.pads(UiKit.sbox(Color(UiKit.NIGHT, 0.97), 16, UiKit.INK, 3, UiKit.INK, 6.0), p, p, p, p + 2))
	var col: VBoxContainer = m._vbox(6 if phone else 8)
	add_child(col)
	_frame = UiKit.clip_box(11, Vector2(_vw, round(_vw * 300.0 / 480.0)))
	_frame.add_theme_stylebox_override("panel", UiKit.sbox(Color("2a2140"), 11))
	col.add_child(_frame)
	var head: HBoxContainer = m._hbox(8)
	_icon = m._emoji("", 20 if phone else 24)
	head.add_child(_icon)
	var tv: VBoxContainer = m._vbox(0)
	tv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_kind = m._body("", 10 if phone else 11, UiKit.YELLOW, 900, 1.0)
	tv.add_child(_kind)
	_name = m._disp("", 17 if phone else 20, Color.WHITE)
	_name.clip_text = true
	_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	tv.add_child(_name)
	head.add_child(tv)
	col.add_child(head)
	_desc = m._body("", 12 if phone else 13, UiKit.WMUTED, 800)
	_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_desc.custom_minimum_size.x = _vw
	col.add_child(_desc)

func open(anchor: Control, spec: Dictionary, pinned: bool) -> void:
	if not is_instance_valid(anchor) or not anchor.is_visible_in_tree():
		return
	var same := visible and _anchor == anchor
	_anchor = anchor
	_pinned = pinned or (same and _pinned)
	if same and _spec == spec:
		_place()
		return
	_spec = spec
	var key := String(spec.key)
	var i := int(spec.i)
	var stars: Array = Fighter.STARS.get(key, ["", ""])
	if spec.gadget:
		_icon.text = String(GADGET_ICONS.get(key + "AB"[i], "🧰"))
		_kind.text = I18n.t("menu.gadget").to_upper()
		_name.text = I18n.t("gad.%s%s.name" % [key, "AB"[i]])
		_desc.text = I18n.t("gad.%s%s.desc" % [key, "AB"[i]])
	else:
		_icon.text = String(STAR_ICONS[i])
		_kind.text = I18n.t("menu.star").to_upper()
		_name.text = I18n.t("star.%s.name" % String(stars[i]))
		_desc.text = I18n.t("star.%s.desc" % String(stars[i]))
	_play(clip_path(key, bool(spec.gadget), i))
	visible = true
	size = Vector2.ZERO   # shrink to the new texts
	_place()
	modulate.a = 0.0
	scale = Vector2(0.96, 0.96)
	pivot_offset = size / 2.0
	var tw := create_tween().set_parallel(true).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(self, "modulate:a", 1.0, 0.12)
	tw.tween_property(self, "scale", Vector2.ONE, 0.12)

func close() -> void:
	visible = false
	_pinned = false
	_anchor = null
	_spec = {}
	if _video:   # stop decoding and let the clip go
		_video.stop()
		_video.queue_free()
		_video = null

# The clip: a new player each time (a Theora stream reopens cleanly), loaded only now.
func _play(path: String) -> void:
	if _video:
		_video.stop()
		_video.queue_free()
		_video = null
	var st := load(path) as VideoStream
	if st == null:
		return
	_video = VideoStreamPlayer.new()
	_video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_video.expand = true
	_video.loop = true
	_video.volume_db = -80.0
	_video.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_video.stream = st
	_frame.add_child(_video)
	_video.play()

# Next to the button: on its right if the card fits there, else on its left, else above / below;
# kept inside the page (CSS px).
func _place() -> void:
	if not is_instance_valid(_anchor):
		return
	var page := get_parent() as Control
	var inv := page.get_global_transform().affine_inverse()
	var r := _anchor.get_global_rect()
	var a0: Vector2 = inv * r.position
	var a1: Vector2 = inv * r.end
	var cs := get_combined_minimum_size()
	var W: float = page.size.x
	var H: float = page.size.y
	var gap := 12.0
	var top: float = float(m.get("_nav")) + 6.0
	var pos := Vector2(a1.x + gap, (a0.y + a1.y) / 2.0 - cs.y / 2.0)
	if pos.x + cs.x > W - 8.0:
		pos.x = a0.x - gap - cs.x
	if pos.x < 8.0:   # no room on either side: over or under it
		pos.x = clampf((a0.x + a1.x - cs.x) / 2.0, 8.0, W - cs.x - 8.0)
		pos.y = a0.y - gap - cs.y if a0.y - gap - cs.y >= top else a1.y + gap
	pos.y = clampf(pos.y, top, maxf(top, H - cs.y - 8.0))
	position = pos.round()

func _process(_delta: float) -> void:
	if not visible:
		return
	if not is_instance_valid(_anchor) or not _anchor.is_visible_in_tree():
		close()

func _input(ev: InputEvent) -> void:
	if not visible:
		return
	if ev.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()
		return
	if not _pinned:
		return
	var press: bool = (ev is InputEventMouseButton and (ev as InputEventMouseButton).pressed) or (ev is InputEventScreenTouch and (ev as InputEventScreenTouch).pressed)
	if press and is_instance_valid(_anchor):
		var at: Vector2 = (ev as InputEventMouseButton).position if ev is InputEventMouseButton else (ev as InputEventScreenTouch).position
		var on_anchor := _anchor.get_global_rect().has_point(at)
		if not on_anchor:   # a tap anywhere else closes it (the tap still does what it does)
			close()
