class_name Fonts
extends RefCounted
# The web build's two faces (play.html): Lilita One for titles, numbers and buttons (`--display`),
# Nunito 800/900 for body text. Both OFL, from github.com/google/fonts.

static var _display: Font
static var _body: Dictionary = {}

# Lilita One: titles, big numbers, button labels
static func display() -> Font:
	if _display == null:
		_display = load("res://assets/fonts/LilitaOne-Regular.ttf")
	return _display

# Nunito at a weight (the web uses 600..900; 800 is the default body weight)
static func body(weight: int = 800) -> Font:
	if not _body.has(weight):
		var f := FontVariation.new()
		f.base_font = load("res://assets/fonts/Nunito.ttf")
		f.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): weight}
		_body[weight] = f
	return _body[weight]

# Shorthand: give a control the display face
static func use_display(c: Control, size: int = -1) -> void:
	c.add_theme_font_override("font", display())
	if size > 0:
		c.add_theme_font_size_override("font_size", size)
