class_name CssView
extends Control
# Base of the full-screen overlays laid out in the web's CSS px like the menu (result screen, match
# loading): measures the window (UiKit.css_scale), builds into `_page` (a node scaled to CSS px) and
# rebuilds it when the window size changes, so it always matches the menu / HUD scale.
# Subclasses implement _build() (fill _page from their state) and set `_animate` while it is a fresh
# show (a relayout after a resize rebuilds without replaying the entrance animations).

const MenuTap := preload("res://scripts/menu_tap.gd")

static var _font_cache: Dictionary = {}

var _k := 1.0
var W := 1280.0
var H := 720.0
var phone := false               # the web's (max-height: 520px) landscape rules
var _page: Control
var _built_for := Vector2.ZERO
var _built_over := 0.0
var _rz := 0
var _animate := true

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	get_viewport().size_changed.connect(_on_resize)
	_measure()

func _measure() -> void:
	_k = UiKit.css_scale(get_viewport())
	var vs := get_viewport().get_visible_rect().size
	W = vs.x / _k
	H = vs.y / _k
	phone = H <= 520.0 and W > H

# Window resized: relayout once it settles (a drag-resize sends many events).
func _on_resize() -> void:
	if not is_inside_tree():
		return
	_rz += 1
	var n := _rz
	get_tree().create_timer(0.12).timeout.connect(func(): if n == _rz and is_inside_tree(): _relayout())

func _relayout() -> void:
	_measure()
	if visible and (Vector2(W, H) != _built_for or absf(_over() - _built_over) > 0.02):
		_animate = false
		rebuild()

func rebuild() -> void:
	_measure()
	if _page:
		_page.queue_free()
	_built_for = Vector2(W, H)
	_built_over = _over()
	_page = Control.new()
	_page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.size = Vector2(W, H)
	_page.scale = Vector2(_k, _k)
	var th := Theme.new()
	th.default_font = _fb(800)
	_page.theme = th
	add_child(_page)
	_build()

func _build() -> void:
	pass

# ---------------------------------------------------------------- fonts / pieces (the menu's look)

# physical px per CSS px: the fonts are rasterised at that size (the page is a scaled node, which
# Godot's own oversampling ignores)
func _over() -> float:
	var vh := get_viewport().get_visible_rect().size.y
	return maxf(float(DisplayServer.window_get_size().y) / maxf(vh, 1.0), 0.25) * _k

func _font_file(path: String) -> FontFile:
	var key := "%s@%.3f" % [path, _over()]
	if not _font_cache.has(key):
		var ff := Fonts.file(path).duplicate() as FontFile   # (with the emoji fallback, fonts.gd)
		ff.oversampling = _over()
		_font_cache[key] = ff
	return _font_cache[key]

func _fd() -> Font:
	return _font_file("res://assets/fonts/LilitaOne-Regular.ttf")

func _fb(weight: int = 800) -> Font:
	var key := "body%d@%.3f" % [weight, _over()]
	if not _font_cache.has(key):
		var f := FontVariation.new()
		f.base_font = _font_file("res://assets/fonts/Nunito.ttf")
		f.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): weight}
		_font_cache[key] = f
	return _font_cache[key]

func _disp(t: String, size: int, color: Color = Color.WHITE, stroke: int = 0, spacing: float = 0.0) -> Label:
	return UiKit.text(t, size, color, _fd(), stroke, spacing)

func _body(t: String, size: int, color: Color = UiKit.WTEXT, weight: int = 800, spacing: float = 0.0) -> Label:
	return UiKit.text(t, size, color, _fb(weight), 0, spacing)

# A display title with -webkit-text-stroke (ink, painted under the fill) and a hard ink text-shadow.
func _title(t: String, size: int, color: Color, stroke: float, shadow_y: float) -> Label:
	var l := _disp(t, size, color)
	l.add_theme_constant_override("outline_size", int(stroke * 2.0))
	l.add_theme_color_override("font_outline_color", UiKit.INK)
	l.add_theme_color_override("font_shadow_color", UiKit.INK)
	l.add_theme_constant_override("shadow_offset_x", 0)
	l.add_theme_constant_override("shadow_offset_y", int(shadow_y))
	l.add_theme_constant_override("shadow_outline_size", int(stroke * 2.0))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return l

func _box(sep: float, vertical: bool) -> BoxContainer:
	var b: BoxContainer = VBoxContainer.new() if vertical else HBoxContainer.new()
	b.add_theme_constant_override("separation", int(sep))
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b

func _panel(s: StyleBox) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", s)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p

func _center(c: Control) -> CenterContainer:
	var cc := CenterContainer.new()
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cc.add_child(c)
	return cc

# .big: display font, yellow gradient, 3 px ink border, hard 0 6px 0 ink shadow; sinks 4 px when held.
func _big(text: String, size: int, padv: float, padh: float, shadow: float = 6.0) -> MenuTap:
	var b := MenuTap.new(UiKit.pads(UiKit.sbox(Color("ffd545"), 14, UiKit.INK, 3, UiKit.INK, shadow, 1), padh, padv, padh, padv),
		UiKit.pads(UiKit.sbox(Color("ffdc5c"), 14, UiKit.INK, 3, UiKit.INK, shadow, 1), padh, padv, padh, padv))
	var l := _disp(text, size, UiKit.INK)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	b.add_child(l)
	return b

# .ghost: dark violet, same ink border and shadow.
func _ghost(text: String, size: int, padv: float, padh: float, shadow: float = 6.0) -> MenuTap:
	var b := MenuTap.new(UiKit.pads(UiKit.sbox(Color(40 / 255.0, 34 / 255.0, 62 / 255.0, 0.9), 14, UiKit.INK, 3, UiKit.INK, shadow, 1), padh, padv, padh, padv),
		UiKit.pads(UiKit.sbox(Color(58 / 255.0, 48 / 255.0, 96 / 255.0, 0.95), 14, UiKit.INK, 3, UiKit.INK, shadow, 1), padh, padv, padh, padv))
	var l := _disp(text, size, UiKit.WTEXT)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	b.add_child(l)
	return b

func _portrait(key: String, size: Vector2, cos: String = "") -> TextureRect:
	var tr := TextureRect.new()
	tr.texture = UiKit.portrait(key)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.custom_minimum_size = size
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if cos != "":
		var skin := int(Skins.parse(cos).skin)
		var skins: Array = Skins.data().get("skins", ["default"])
		var name := String(skins[skin]) if skin < skins.size() else "default"
		if name != "default":
			var rec: Variant = (Skins.data().get("recolours", {}) as Dictionary).get(key, {})
			var r: Array = (rec as Dictionary).get(name, []) if rec is Dictionary else []
			tr.material = preload("res://scripts/menu_widgets.gd").recolour(name, r)
	return tr
