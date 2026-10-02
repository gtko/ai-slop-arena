class_name Fonts
extends RefCounted
# The web build's two faces (play.html): Lilita One for titles, numbers and buttons (`--display`),
# Nunito 800/900 for body text. Both OFL, from github.com/google/fonts.
#
# Emoji (gadget / tab / quest / emote / shop icons, currencies...) come from a bundled Noto Color
# Emoji (OFL), cut down to the game's emoji by tools/subset-emoji.py (1.5 MB): Android and the web export
# have no usable system emoji font. It is a fallback of the two faces' FontFile resources (setup()),
# so every copy of them (the menus' oversampled duplicates, weight variations, letter-spacing
# variations, the project's default font) draws emoji the same on every platform.
# Debug: `--nosysfont` (or `?nosysfont` on web) turns the OS font fallback off, as on a phone.

const DISPLAY_PATH := "res://assets/fonts/LilitaOne-Regular.ttf"
const BODY_PATH := "res://assets/fonts/Nunito.ttf"
const EMOJI_PATH := "res://assets/fonts/NotoColorEmoji-game.ttf"
# OFL fallbacks for what neither face has (Blender's datafiles/fonts, OFL 1.1), their ascent /
# descent cut to Lilita One's by tools/fit-font-metrics.mjs: Font.get_height() is the tallest of a
# font AND all its fallbacks (untouched, Noto Sans Arabic made every label about 40 % taller).
# ← ↑ → ↓ ⚑ (Symbols), ▾ ◂ ✓ ✕ ✦ (Symbols2), Greek (Inter), Arabic, Thai. CJK is not bundled
# (Noto Sans CJK is 11 MB): desktop and Android take it from the OS.
const EXTRA_PATHS := ["res://assets/fonts/NotoSansSymbols.woff2", "res://assets/fonts/NotoSansSymbols2.woff2",
	"res://assets/fonts/Inter.woff2", "res://assets/fonts/NotoSansArabic.woff2", "res://assets/fonts/NotoSansThai.woff2"]

static var _display: Font
static var _body: Dictionary = {}
static var _emoji: FontFile
static var _files: Array = []   # the wired FontFiles, held so the resource cache keeps these instances

# Wire the emoji fallback into the shared font resources. Call before any copy of them is made
# (main._ready does it first; display() / body() / file() also do).
static func setup() -> void:
	if not _files.is_empty():
		return
	var no_sys := DebugArgs.has("nosysfont") or OS.has_feature("web")
	_emoji = load(EMOJI_PATH) as FontFile
	if _emoji:
		_emoji.allow_system_fallback = false
	# the rest of what the OS used to supply: symbols (arrows, check marks, flags), Greek, Arabic, Thai
	var extra: Array = []
	if _emoji:
		extra.append(_emoji)
	for p in EXTRA_PATHS:
		var f := load(p) as FontFile
		if f:
			if no_sys:
				f.allow_system_fallback = false
			extra.append(f)
			_files.append(f)
	var body_ff := load(BODY_PATH) as FontFile
	var disp_ff := load(DISPLAY_PATH) as FontFile
	if body_ff:
		body_ff.fallbacks = extra
	if disp_ff:
		# Lilita One has Latin only: Cyrillic, Greek, Vietnamese titles use Inter ExtraBold (Nunito's
		# own metrics are taller than Lilita's, see above), then the rest
		var inter: FontFile = null
		for f in extra:
			if (f as FontFile).resource_path.ends_with("Inter.woff2"):
				inter = f
		var heavy: Array = []
		if inter:
			var v := FontVariation.new()
			v.base_font = inter
			v.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): 800}
			heavy = [v]
		disp_ff.fallbacks = ([_emoji] if _emoji else []) + heavy + extra.filter(func(f): return f != _emoji and f != inter)
	for ff in [body_ff, disp_ff]:
		if ff:
			if no_sys:
				ff.allow_system_fallback = false
			_files.append(ff)
	# the project's default theme font (nunito_800.tres, a variation of the wired Nunito: it uses the
	# base font's fallbacks) and the engine's own default, if something still uses it
	for deff in [ThemeDB.fallback_font, ThemeDB.get_default_theme().default_font]:
		if deff == null or (deff is FontVariation and _files.has((deff as FontVariation).base_font)):
			continue
		if _emoji and not deff.fallbacks.has(_emoji):
			deff.fallbacks = deff.fallbacks + [_emoji]
		if no_sys and deff is FontFile:
			(deff as FontFile).allow_system_fallback = false

# The bundled colour emoji font (null only if the file is missing).
static func emoji() -> FontFile:
	setup()
	return _emoji

# One of the two faces' shared FontFile (with the emoji fallback): use it instead of load(path).
static func file(path: String) -> FontFile:
	setup()
	return load(path) as FontFile

# Lilita One: titles, big numbers, button labels
static func display() -> Font:
	if _display == null:
		_display = file(DISPLAY_PATH)
	return _display

# Nunito at a weight (the web uses 600..900; 800 is the default body weight)
static func body(weight: int = 800) -> Font:
	if not _body.has(weight):
		var f := FontVariation.new()
		f.base_font = file(BODY_PATH)
		f.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): weight}
		_body[weight] = f
	return _body[weight]

# Shorthand: give a control the display face
static func use_display(c: Control, size: int = -1) -> void:
	c.add_theme_font_override("font", display())
	if size > 0:
		c.add_theme_font_size_override("font_size", size)
