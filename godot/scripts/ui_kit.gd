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

# The web menu's palette (src/style.css :root, src/home.css)
const INK := Color("16121f")
const YELLOW := Color("ffd23f")
const WTEXT := Color("f4f1ff")
const WMUTED := Color("b9b3d1")
const NIGHT := Color(14 / 255.0, 11 / 255.0, 30 / 255.0)
const VIOLET := Color("8f6bff")
const TEAL := Color("15aabf")

static var _spaced: Dictionary = {}

# StyleBoxFlat from CSS-like values: background, radius, border, a hard drop shadow ("0 6px 0 ink").
static func sbox(bg: Color, radius: int = 12, border: Color = Color(0, 0, 0, 0), bw: int = 0,
		shadow: Color = Color(0, 0, 0, 0), shadow_y: float = 0.0, shadow_blur: int = 0) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.set_corner_radius_all(radius)
	s.set_border_width_all(bw)
	s.border_color = border
	s.anti_aliasing = true
	s.corner_detail = 10
	if shadow.a > 0.0:
		s.shadow_color = shadow
		s.shadow_offset = Vector2(0, shadow_y)
		s.shadow_size = maxi(shadow_blur, 1)
	return s

static func pads(s: StyleBox, l: float, t: float, r: float, b: float) -> StyleBox:
	s.content_margin_left = l
	s.content_margin_top = t
	s.content_margin_right = r
	s.content_margin_bottom = b
	return s

# A label in CSS terms: font (null = Nunito 800), size, colour, -webkit-text-stroke (ink), letter-spacing.
static func text(t: String, size: int, color: Color = WTEXT, font: Font = null, stroke: int = 0, spacing: float = 0.0) -> Label:
	var l := Label.new()
	l.text = t
	var f: Font = font
	if spacing != 0.0:
		f = spaced(font if font else Fonts.body(800), spacing)
	if f:
		l.add_theme_font_override("font", f)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if stroke > 0:
		l.add_theme_constant_override("outline_size", stroke)
		l.add_theme_color_override("font_outline_color", INK)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

# A font with letter-spacing (CSS letter-spacing), cached.
static func spaced(f: Font, px: float) -> Font:
	var key := "%d:%.2f" % [f.get_instance_id(), px]
	if not _spaced.has(key):
		var v := FontVariation.new()
		if f is FontVariation:   # keep the weight (a variation of a variation drops the inner axes)
			v.base_font = (f as FontVariation).base_font
			v.variation_opentype = (f as FontVariation).variation_opentype
		else:
			v.base_font = f
		v.spacing_glyph = int(px)   # whole pixels only: sub-pixel CSS spacings (0.5) round to 0
		_spaced[key] = v
	return _spaced[key]

# Linear (from -> to, 0..1 UV) or radial gradient texture from [[offset, Color], ...] stops.
static func grad(stops: Array, from: Vector2 = Vector2(0, 0), to: Vector2 = Vector2(0, 1), radial: bool = false, res: int = 128) -> GradientTexture2D:
	var gr := Gradient.new()
	gr.offsets = PackedFloat32Array([])
	gr.colors = PackedColorArray([])
	for s in stops:
		gr.add_point(float(s[0]), s[1])
	var gt := GradientTexture2D.new()
	gt.gradient = gr
	gt.fill = GradientTexture2D.FILL_RADIAL if radial else GradientTexture2D.FILL_LINEAR
	gt.fill_from = from
	gt.fill_to = to
	gt.width = res
	gt.height = res
	return gt

static func grad_rect(tex: Texture2D) -> TextureRect:
	var r := TextureRect.new()
	r.texture = tex
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_SCALE
	r.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r

# A rounded shape whose children are clipped to it (gradients, portraits inside rounded tiles).
static func clip_box(radius: int, size: Vector2 = Vector2.ZERO) -> Panel:
	var p := Panel.new()
	p.add_theme_stylebox_override("panel", sbox(Color.WHITE, radius))
	p.clip_children = CanvasItem.CLIP_CHILDREN_ONLY
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if size != Vector2.ZERO:
		p.custom_minimum_size = size
	return p

# CSS colour helpers (color-mix in srgb, brightness())
static func mix(a: Color, b: Color, wa: float) -> Color:
	return Color(a.r * wa + b.r * (1.0 - wa), a.g * wa + b.g * (1.0 - wa), a.b * wa + b.b * (1.0 - wa), a.a * wa + b.a * (1.0 - wa))

static func bright(c: Color, k: float) -> Color:
	return Color(minf(c.r * k, 1.0), minf(c.g * k, 1.0), minf(c.b * k, 1.0), c.a)

# CSS pixels: the menus are laid out like the web page (1 unit = 1 CSS px). The returned factor maps
# CSS px to this viewport's canvas units (1 on a 1280x720 desktop window; ~1.85 on a 844x390 phone).
static func css_scale(vp: Viewport) -> float:
	var win := Vector2(DisplayServer.window_get_size())
	if win.y <= 0.0:
		return 1.0
	var dpr := 1.0
	if OS.get_name() == "Android":
		dpr = maxf(DisplayServer.screen_get_dpi() / 160.0, 1.0)
	elif OS.get_name() == "iOS" or OS.get_name() == "macOS":
		dpr = maxf(DisplayServer.screen_get_scale(), 1.0)
	elif OS.has_feature("web"):
		var r = JavaScriptBridge.eval("window.devicePixelRatio || 1")
		dpr = maxf(float(r) if r != null else 1.0, 1.0)
	var css_h := win.y / dpr
	return clampf(vp.get_visible_rect().size.y / css_h, 0.4, 4.0)

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
