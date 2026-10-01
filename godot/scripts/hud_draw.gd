class_name HudDraw
extends RefCounted
# Drawing helpers shared by the in-match HUD (hud.gd, hud_plates.gd, touch_controls.gd, emote_wheel.gd):
# the web HUD's look (src/style.css) as canvas_item calls. Sizes are given in the web's CSS px and
# multiplied by `k` (logical px per CSS px, see css_scale) so the HUD has the same size on screen as
# the web page at that window size.

const INK := Color("16121f")
const PANEL := Color(18 / 255.0, 16 / 255.0, 30 / 255.0, 0.82)
const TEXT := Color("f4f1ff")
const MUTED := Color("b9b3d1")
const YELLOW := Color("ffd23f")
const BLUE := Color("39c6ff")
const RED := Color("ff4b4b")
const GREEN := Color("4bff86")

static var _emoji: Font
static var _emoji_ok := -1
static var _css_h := -1.0
static var _css_t := -1.0

# Logical px per CSS px: the web HUD is laid out in CSS px, which do not scale with the window,
# while the Godot canvas is stretched to a 720 px tall logical viewport (canvas_items / expand).
static func css_scale(ci: CanvasItem) -> float:
	var vs := ci.get_viewport_rect().size
	return vs.y / maxf(css_height(ci), 1.0)

# The window height in CSS px (cached, re-read twice a second: rotation, resizes).
static func css_height(ci: CanvasItem) -> float:
	var now := Time.get_ticks_msec() / 1000.0
	if _css_h > 0.0 and now - _css_t < 0.5:
		return _css_h
	_css_t = now
	var h := float(DisplayServer.window_get_size().y)
	var os := OS.get_name()
	if os == "Android":
		h = h * 160.0 / maxf(float(DisplayServer.screen_get_dpi()), 160.0)
	elif os in ["iOS", "macOS", "Web"]:
		h = h / maxf(DisplayServer.screen_get_scale(), 1.0)
	if h <= 0.0:
		h = ci.get_viewport_rect().size.y
	_css_h = h
	return h

# Phones held sideways: the web's `@media (max-height: 520px)` rules.
static func short_screen(ci: CanvasItem) -> bool:
	return css_height(ci) <= 520.0

# A font for emoji (gadget icons, emotes): the OS colour-emoji font. Web exports have none; then
# has_emoji() is false and callers draw a plain fallback.
static func emoji_font() -> Font:
	if _emoji == null:
		var sf := SystemFont.new()
		sf.font_names = PackedStringArray(["Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji", "EmojiOne Color"])
		var fv := FontVariation.new()
		fv.base_font = Fonts.display()
		fv.fallbacks = [sf]
		_emoji = fv
		_emoji_ok = 1 if (OS.get_name() != "Web" and sf.has_char(0x1F600)) else 0
	return _emoji

static func has_emoji() -> bool:
	if _emoji_ok < 0:
		emoji_font()
	return _emoji_ok == 1

# ---------------------------------------------------------------- shapes

# A rounded rectangle as a polygon (corner radius r, n segments per corner).
static func rrect(r: Rect2, rad: float, n := 5) -> PackedVector2Array:
	rad = minf(rad, minf(r.size.x, r.size.y) * 0.5)
	var pts := PackedVector2Array()
	var cs := [Vector2(r.end.x - rad, r.position.y + rad), Vector2(r.end.x - rad, r.end.y - rad),
		Vector2(r.position.x + rad, r.end.y - rad), Vector2(r.position.x + rad, r.position.y + rad)]
	for c in 4:
		var a0 := -PI / 2 + c * PI / 2
		for s in n + 1:
			var a := a0 + PI / 2 * s / n
			pts.append(cs[c] + Vector2(cos(a), sin(a)) * rad)
	return pts

static func _box(bg: Color, rad: float, bw: float, bc: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(int(round(rad)))
	sb.corner_detail = 6
	sb.anti_aliasing = true
	sb.anti_aliasing_size = 0.8
	if bw > 0.0:
		sb.set_border_width_all(int(round(bw)))
		sb.border_color = bc
	return sb

# A CSS box: background, border (inside the rect, box-sizing: border-box), hard drop shadow (0 sy 0).
static func box(ci: CanvasItem, r: Rect2, rad: float, bg: Color, bw := 0.0, bc := INK, sy := 0.0, sc := Color(0, 0, 0, 0.4)) -> void:
	if sy > 0.0:
		ci.draw_style_box(_box(sc, rad, 0.0, sc), Rect2(r.position + Vector2(0, sy), r.size))
	ci.draw_style_box(_box(bg, rad, bw, bc), r)

# A vertical linear gradient (top colour -> bottom colour) inside a rounded rect, cut at `clip_w`
# from the left (a bar's fill, overflow: hidden).
static func grad_fill(ci: CanvasItem, r: Rect2, rad: float, top: Color, bot: Color, clip_w := -1.0, mul := 1.0) -> void:
	if r.size.x <= 0.0 or r.size.y <= 0.0:
		return
	var poly := rrect(r, rad)
	if clip_w >= 0.0:
		if clip_w <= 0.01:
			return
		if clip_w < r.size.x:
			var cut := Geometry2D.intersect_polygons(poly, PackedVector2Array([r.position, Vector2(r.position.x + clip_w, r.position.y),
				Vector2(r.position.x + clip_w, r.end.y), Vector2(r.position.x, r.end.y)]))
			if cut.is_empty():
				return
			poly = cut[0]
	var cols := PackedColorArray()
	for p in poly:
		var c := top.lerp(bot, clampf((p.y - r.position.y) / r.size.y, 0.0, 1.0))
		if mul != 1.0:
			c = Color(c.r * mul, c.g * mul, c.b * mul, c.a)
		cols.append(c)
	ci.draw_polygon(poly, cols)

# A plain rounded fill cut at clip_w (no gradient).
static func flat_fill(ci: CanvasItem, r: Rect2, rad: float, col: Color, clip_w := -1.0) -> void:
	grad_fill(ci, r, rad, col, col, clip_w)

# An SVG-like arc stroke from 12 o'clock, clockwise, `frac` of the circle, round caps.
static func arc(ci: CanvasItem, c: Vector2, rad: float, frac: float, col: Color, w: float) -> void:
	if frac <= 0.001:
		return
	if frac >= 0.999:
		ci.draw_arc(c, rad, 0, TAU, 64, col, w, true)
		return
	# one polygon (outer arc, round cap, inner arc, round cap) so a translucent stroke has no seams
	var a0 := -PI / 2
	var a1 := a0 + TAU * frac
	var n := maxi(6, int(64 * frac))
	var ro := rad + w * 0.5
	var ri := maxf(rad - w * 0.5, 0.0)
	var pts := PackedVector2Array()
	for i in n + 1:
		var a := lerpf(a0, a1, float(i) / n)
		pts.append(c + Vector2(cos(a), sin(a)) * ro)
	var e1 := c + Vector2(cos(a1), sin(a1)) * rad
	for i in range(1, 8):
		var a := a1 + PI * i / 8.0
		pts.append(e1 + Vector2(cos(a), sin(a)) * w * 0.5)
	for i in n + 1:
		var a := lerpf(a1, a0, float(i) / n)
		pts.append(c + Vector2(cos(a), sin(a)) * ri)
	var e0 := c + Vector2(cos(a0), sin(a0)) * rad
	for i in range(1, 8):
		var a := a0 + PI + PI * i / 8.0
		pts.append(e0 + Vector2(cos(a), sin(a)) * w * 0.5)
	if frac > 0.93:   # the caps would overlap: fall back to a plain stroke
		ci.draw_arc(c, rad, a0, a1, n, col, w, true)
		return
	ci.draw_colored_polygon(pts, col)

# A four-point star (the web's ✦).
static func star4(ci: CanvasItem, c: Vector2, s: float, col: Color) -> void:
	var pts := PackedVector2Array()
	for k in 8:
		var a := -PI / 2 + k * PI / 4
		var rr := s if k % 2 == 0 else s * 0.4
		pts.append(c + Vector2(cos(a), sin(a)) * rr)
	ci.draw_colored_polygon(pts, col)

# A heavy multiplication sign (the web's ✖).
static func cross(ci: CanvasItem, c: Vector2, s: float, col: Color) -> void:
	ci.draw_line(c + Vector2(-s, -s), c + Vector2(s, s), col, s * 0.7, true)
	ci.draw_line(c + Vector2(-s, s), c + Vector2(s, -s), col, s * 0.7, true)

# Box-shadow-like soft glow around a circle (filter: drop-shadow / box-shadow 0 0 Npx).
static func glow(ci: CanvasItem, c: Vector2, rad: float, spread: float, col: Color) -> void:
	var steps := 8
	for k in steps:
		var f := float(k + 1) / steps
		var a := col.a * (1.0 - f) * 0.35
		ci.draw_arc(c, rad + spread * f, 0, TAU, 48, Color(col.r, col.g, col.b, a), spread / steps * 1.6, true)

# ---------------------------------------------------------------- text

# Text with the web's ink stroke (-webkit-text-stroke: `stroke`px, paint-order: stroke fill):
# half of the stroke shows outside the glyphs. `pos` is the top-left of the line box.
# Returns the advance width.
static func text(ci: CanvasItem, pos: Vector2, s: String, font: Font, size: float, col: Color, stroke := 0.0,
		stroke_col := INK, shadow_y := 0.0) -> float:
	var fs := maxi(1, int(round(size)))
	var base := pos + Vector2(0, line_top(font, fs))
	if shadow_y > 0.0:
		var sb := base + Vector2(0, shadow_y)
		if stroke > 0.0:
			ci.draw_string_outline(font, sb, s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, maxi(1, int(round(stroke))), stroke_col)
		ci.draw_string(font, sb, s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, stroke_col)
	if stroke > 0.0:
		ci.draw_string_outline(font, base, s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, maxi(1, int(round(stroke))), stroke_col)
	ci.draw_string(font, base, s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
	return font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x

# Centered on c (both axes, on the line box).
static func text_c(ci: CanvasItem, c: Vector2, s: String, font: Font, size: float, col: Color, stroke := 0.0,
		stroke_col := INK, shadow_y := 0.0) -> void:
	var fs := maxi(1, int(round(size)))
	var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	text(ci, c - Vector2(w * 0.5, line_h(font, fs) * 0.5), s, font, size, col, stroke, stroke_col, shadow_y)

static func width(font: Font, s: String, size: float) -> float:
	return font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, maxi(1, int(round(size)))).x

# CSS `line-height: normal` box height for a font size, and the baseline offset inside it.
static func line_h(font: Font, size: float) -> float:
	var fs := maxi(1, int(round(size)))
	return font.get_ascent(fs) + font.get_descent(fs)

static func line_top(font: Font, size: float) -> float:
	return font.get_ascent(maxi(1, int(round(size))))

# Text drawn with a transform (scale / rotation around its centre), for the pop animations.
static func text_xf(ci: CanvasItem, c: Vector2, s: String, font: Font, size: float, col: Color, stroke: float,
		scale: float, rot := 0.0, shadow_y := 0.0) -> void:
	ci.draw_set_transform(c, rot, Vector2(scale, scale))
	text_c(ci, Vector2.ZERO, s, font, size, col, stroke, Color(INK.r, INK.g, INK.b, col.a), shadow_y)
	ci.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

# Ease-out cubic-bezier approximations used by the CSS animations.
static func ease_out(t: float) -> float:
	t = clampf(t, 0.0, 1.0)
	return 1.0 - pow(1.0 - t, 2.2)

# cubic-bezier(.2, .9, .3, 1.2): fast, slight overshoot
static func back_out(t: float) -> float:
	t = clampf(t, 0.0, 1.0)
	var c1 := 1.4
	var c3 := c1 + 1.0
	return 1.0 + c3 * pow(t - 1.0, 3) + c1 * pow(t - 1.0, 2)
