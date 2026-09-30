class_name UiKit
extends RefCounted
# Small helpers so every menu screen looks alike: colours, styled buttons/panels, safe-area margins.
# All UI is built from code (no theme resource), sized for a 1280x720 base (canvas_items stretch).

const BG := Color("0f1424")
const PANEL := Color("1b2340")
const PANEL_HI := Color("263056")
const ACCENT := Color("ffc933")
const ACCENT_DARK := Color("c98f00")
const GOOD := Color("4cd07d")
const BAD := Color("ee5a5a")
const TEXT := Color("f4f6ff")
const MUTED := Color("9aa6cf")
const TIER_COLORS := {"bronze": Color("c98a4b"), "silver": Color("c5ccd6"), "gold": Color("ffc933"),
	"diamond": Color("66d9ff"), "mythic": Color("c07bff"), "legend": Color("ff6b6b")}

static func box(bg: Color, radius: int = 14, border: Color = Color(0, 0, 0, 0), bw: int = 0, pad: int = 0) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.set_corner_radius_all(radius)
	s.set_border_width_all(bw)
	s.border_color = border
	if pad > 0:
		s.set_content_margin_all(pad)
	return s

# kind: "primary" (yellow), "secondary" (navy), "danger", "ghost" (transparent).
static func button(text: String, kind: String = "secondary", height: float = 64.0, font: int = 24) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size.y = height
	b.focus_mode = Control.FOCUS_ALL
	b.add_theme_font_size_override("font_size", font)
	restyle(b, kind)
	return b

static func restyle(b: Button, kind: String) -> void:
	var base := PANEL_HI
	var fg := TEXT
	match kind:
		"primary":
			base = ACCENT
			fg = Color("1a1300")
		"danger":
			base = Color("b23a48")
		"ghost":
			base = Color(1, 1, 1, 0.06)
	var pad := 14
	b.add_theme_stylebox_override("normal", box(base, 14, Color(0, 0, 0, 0.25), 0, pad))
	b.add_theme_stylebox_override("hover", box(base.lightened(0.12), 14, Color(1, 1, 1, 0.25), 2, pad))
	b.add_theme_stylebox_override("pressed", box(base.darkened(0.15), 14, Color(0, 0, 0, 0), 0, pad))
	b.add_theme_stylebox_override("focus", box(Color(0, 0, 0, 0), 14, ACCENT, 3, pad))
	b.add_theme_stylebox_override("disabled", box(base.darkened(0.4), 14, Color(0, 0, 0, 0), 0, pad))
	for c in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(c, fg)
	b.add_theme_color_override("font_disabled_color", fg.darkened(0.5))

static func label(text: String, size: int = 22, color: Color = TEXT, align: int = HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.horizontal_alignment = align as HorizontalAlignment
	return l

static func panel(bg: Color = PANEL, radius: int = 18, pad: int = 16) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", box(bg, radius, Color(1, 1, 1, 0.06), 1, pad))
	return p

static func spacer(h: float = 0.0, expand: bool = false) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	if expand:
		c.size_flags_vertical = Control.SIZE_EXPAND_FILL
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return c

static func line_edit(text: String, placeholder: String, max_len: int = 0) -> LineEdit:
	var e := LineEdit.new()
	e.text = text
	e.placeholder_text = placeholder
	e.custom_minimum_size.y = 56
	e.add_theme_font_size_override("font_size", 24)
	e.add_theme_stylebox_override("normal", box(Color("10162c"), 12, Color(1, 1, 1, 0.12), 1, 12))
	e.add_theme_stylebox_override("focus", box(Color("10162c"), 12, ACCENT, 2, 12))
	if max_len > 0:
		e.max_length = max_len
	return e

# Margins that keep controls out of the notch / rounded corners (logical UI pixels).
static func safe_insets(vp: Viewport) -> Vector4:
	if not (OS.get_name() == "Android" or OS.get_name() == "iOS"):
		return Vector4(24, 16, 24, 16)   # left, top, right, bottom: a plain comfortable margin
	var win := Vector2(DisplayServer.window_get_size())
	var safe := DisplayServer.get_display_safe_area()
	var k := vp.get_visible_rect().size / maxf(win.x, 1.0) if win.x > 0 else Vector2.ONE
	var s := Vector2(k.x, k.x)
	var l := float(safe.position.x) * s.x
	var t := float(safe.position.y) * s.y
	var r := maxf(win.x - float(safe.end.x), 0.0) * s.x
	var b := maxf(win.y - float(safe.end.y), 0.0) * s.y
	return Vector4(l + 16, t + 12, r + 16, b + 12)

static func tier_badge(tier: String, size: float = 56.0) -> Control:
	var p := PanelContainer.new()
	p.custom_minimum_size = Vector2(size, size)
	var col: Color = TIER_COLORS.get(tier, Color("4a5375"))
	p.add_theme_stylebox_override("panel", box(col.darkened(0.45), int(size / 2), col, 4))
	var l := label(tier.left(1).to_upper() if tier != "" else "?", int(size * 0.5), col, HORIZONTAL_ALIGNMENT_CENTER)
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	p.add_child(l)
	return p

static func portrait(key: String) -> Texture2D:
	var path := "res://assets/ui/%s.png" % key
	return load(path) as Texture2D if ResourceLoader.exists(path) else null
