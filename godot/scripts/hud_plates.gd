class_name HudPlates
extends Control
# Overhead name plates, damage numbers, K.O. stamps and emote bubbles, drawn in 2D over the 3D
# view like the web's DOM overlay (src/hud.js setup/update/floater/koStamp/say, .ov* / .floater /
# .ko-stamp / .ov-bubble in style.css + meta.css). Positions come from the camera every frame.

const D := preload("res://scripts/hud_draw.gd")
const PLATE_Y := 3.05        # world height of a plate's bottom edge (hud.js update)
const FLOAT_LIFE := 0.9
const KO_LIFE := 1.1
const FLOAT_STYLE := {       # class -> [size px, colour]
	"dmg-in": [22.0, Color("ff4b4b")], "dmg-out": [23.0, Color.WHITE], "dmg-other": [15.0, Color("ffe0c8")],
	"heal": [20.0, Color("7dffa8")], "power": [22.0, Color("4bff86")], "immune": [19.0, Color("bfe8ff")]}

var cam: Camera3D
var fighters: Dictionary = {}
var me: Fighter
var arena: Arena
var _lag: Dictionary = {}     # fighter id -> white "lag" fraction (drains 0.6 / s)
var _floats: Array = []       # {p: Vector2, text, cls, age, key, total, hits}
var _kos: Array = []          # {p: Vector2, age}
var _bubbles: Dictionary = {} # fighter id -> {text, word, col, t}
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func begin(cam_: Camera3D, fighters_: Dictionary, me_: Fighter, arena_: Arena) -> void:
	cam = cam_
	fighters = fighters_
	me = me_
	arena = arena_
	_lag.clear()
	_floats.clear()
	_kos.clear()
	_bubbles.clear()

func clear() -> void:
	fighters = {}
	me = null
	_floats.clear()
	_kos.clear()
	_bubbles.clear()

func _screen(p: Vector3) -> Variant:
	if cam == null or cam.is_position_behind(p):
		return null
	return cam.unproject_position(p)

# A damage / heal number (hud.js floater): hits with the same key within 0.32 s add up.
func floater(world: Vector3, amount: float, cls: String, key := "", text := "") -> void:
	if key != "":
		for f in _floats:
			if f.key == key and f.since < 0.32:
				f.total += amount
				f.hits += 1
				f.text = str(int(round(f.total)))
				f.age = 0.0
				f.since = 0.0
				return
	var s: Variant = _screen(world)
	if s == null:
		return
	var k := D.css_scale(self)
	_floats.append({"p": (s as Vector2) + Vector2(_rng.randf_range(-15.0, 15.0) * k, 0), "text": text if text != "" else str(int(round(amount))),
		"cls": cls, "age": 0.0, "since": 0.0, "key": key, "total": amount, "hits": 1})
	if _floats.size() > 40:
		_floats.pop_front()

# The K.O. stamp where your victim fell.
func ko_stamp(world: Vector3) -> void:
	var s: Variant = _screen(world)
	if s != null:
		_kos.append({"p": s, "age": 0.0})

# An emote sticker over a plate for 2 s (icon: an emoji, word: the fallback without an emoji font).
func say(f: Fighter, icon: String, word: String, col: Color) -> void:
	if f:
		_bubbles[f.id] = {"text": icon, "word": word, "col": col, "t": 2.0, "age": 0.0}

func _process(delta: float) -> void:
	if not visible:
		return
	for f in _floats:
		f.age += delta
		f.since += delta
	_floats = _floats.filter(func(f): return f.age < FLOAT_LIFE)
	for s in _kos:
		s.age += delta
	_kos = _kos.filter(func(s): return s.age < KO_LIFE)
	for id in _bubbles.keys():
		var b: Dictionary = _bubbles[id]
		b.t -= delta
		b.age += delta
		if b.t <= -0.2:
			_bubbles.erase(id)
	for f in fighters.values():
		var fr := clampf(f.hp / maxf(f.max_hp, 1.0), 0.0, 1.0)
		var l: float = _lag.get(f.id, 1.0)
		l = maxf(fr, l - delta * 0.6)
		_lag[f.id] = l
	queue_redraw()

func _draw() -> void:
	if cam == null:
		return
	var k := D.css_scale(self)
	for f in fighters.values():
		if f != me:
			_plate(f, k)
	if me:
		_plate(me, k)
	_draw_floats(k)
	_draw_kos(k)

# ---------------------------------------------------------------- plates (.ov)

# The 2D plates replace the fighters' own 3D bar + name label (fighter.gd _hud).
func _hide_3d(f: Fighter) -> void:
	if f.has_meta("hud_2d"):
		return
	f.set_meta("hud_2d", true)
	for n in ["_bar", "_label"]:
		var v: Variant = f.get(n)
		if v is Node3D:
			(v as Node3D).visible = false

func _plate(f: Fighter, k: float) -> void:
	_hide_3d(f)
	if not f.visible or not f.alive:
		return
	var s: Variant = _screen(f.position + Vector3(0, PLATE_Y, 0))
	if s == null:
		return
	var mine := f == me
	var a := 1.0
	var in_bush := mine and arena != null and arena.is_bush(f.position.x, f.position.z)
	if in_bush:
		a = 0.6                                   # .ov.hidden-bush
	var disp := Fonts.display()
	var w := 96.0 * k
	var bottom: float = (s as Vector2).y
	var x0: float = (s as Vector2).x - w * 0.5
	var y := bottom
	# ammo segments (local player only)
	if mine:
		var ah := 8.0 * k
		y -= ah
		var gap := 3.0 * k
		var cw := (w - gap * 2.0) / 3.0
		for i in 3:
			var r := Rect2(x0 + i * (cw + gap), y, cw, ah)
			D.box(self, r, 3.0 * k, Color(59 / 255.0, 42 / 255.0, 20 / 255.0, a), 2.0 * k, _ink(a))
			var inner := r.grow(-2.0 * k)
			D.grad_fill(self, inner, 1.0 * k, _al(Color("ffcf5a"), a), _al(Color("ff9a1f"), a), inner.size.x * clampf(f.ammo - i, 0.0, 1.0))
		y -= 3.0 * k
	# health bar
	var hh := 15.0 * k
	y -= hh
	var br := Rect2(x0, y, w, hh)
	D.box(self, br, 5.0 * k, Color(42 / 255.0, 14 / 255.0, 20 / 255.0, a), 2.0 * k, _ink(a), 2.0 * k, Color(0, 0, 0, 0.35 * a))
	var inner2 := br.grow(-2.0 * k)
	var fr := clampf(f.hp / maxf(f.max_hp, 1.0), 0.0, 1.0)
	var lag: float = _lag.get(f.id, 1.0)
	D.flat_fill(self, inner2, 3.0 * k, Color(1, 1, 1, 0.75 * a), inner2.size.x * lag)
	if mine:
		D.grad_fill(self, inner2, 3.0 * k, _al(Color("6dff9f"), a), _al(Color("1fc45a"), a), inner2.size.x * fr)
	else:
		D.grad_fill(self, inner2, 3.0 * k, _al(Color("ff7a6b"), a), _al(Color("e0342e"), a), inner2.size.x * fr)
	D.text_c(self, Vector2(inner2.get_center().x, inner2.position.y + 6.0 * k), str(ceili(maxf(f.hp, 0.0))), disp, 12.0 * k,
		Color(1, 1, 1, a), 2.5 * k, _ink(a))
	# name (+ cubes)
	y -= 2.0 * k
	var nfs := 13.0 * k
	var lh := D.line_h(disp, nfs)
	y -= lh
	var name := I18n.t("hud.you") if mine else f.fname
	var ncol := D.BLUE if mine else Color("ffb3b3")
	var nw := D.width(disp, name, nfs)
	var cub := ""
	var cw2 := 0.0
	if f.cubes > 0:
		cub = str(f.cubes)
		cw2 = nfs * 0.9 + D.width(disp, cub, nfs) + nfs * 0.25
	var nx: float = (s as Vector2).x - (nw + cw2) * 0.5
	D.text(self, Vector2(nx, y), name, disp, nfs, _al(ncol, a), 3.0 * k, _ink(a))
	if cub != "":
		var dc := Vector2(nx + nw + nfs * 0.25 + nfs * 0.3, y + lh * 0.5)
		var ds := nfs * 0.36
		var dia := PackedVector2Array([dc + Vector2(0, -ds - k), dc + Vector2(ds + k, 0), dc + Vector2(0, ds + k), dc + Vector2(-ds - k, 0)])
		draw_colored_polygon(dia, _ink(a))
		draw_colored_polygon(PackedVector2Array([dc + Vector2(0, -ds), dc + Vector2(ds, 0), dc + Vector2(0, ds), dc + Vector2(-ds, 0)]), _al(D.GREEN, a))
		D.text(self, Vector2(nx + nw + nfs * 0.9, y), cub, disp, nfs, _al(D.GREEN, a), 3.0 * k, _ink(a))
	var top := y
	# hidden in a bush: the closed eye over your own plate (.ov-eye.hid)
	if in_bush:
		var ec := Vector2((s as Vector2).x, top - 2.0 * k - 8.0 * k)
		_eye(ec, k)
		top = ec.y - 8.0 * k
	# emote bubble (.ov-bubble.emote): pops above the plate
	var b: Dictionary = _bubbles.get(f.id, {})
	if not b.is_empty():
		var sc := clampf(b.age / 0.18, 0.0, 1.0)
		sc = D.back_out(sc) if b.t > 0.0 else clampf(1.0 + b.t / 0.2, 0.0, 1.0)
		var bc := Vector2((s as Vector2).x, top - 4.0 * k - 20.0 * k)
		if D.has_emoji():
			var ef := D.emoji_font()
			draw_set_transform(bc, 0.0, Vector2(sc, sc))
			D.text_c(self, Vector2(0, 3.0 * k), b.text, ef, 40.0 * k, D.INK)
			D.text_c(self, Vector2.ZERO, b.text, ef, 40.0 * k, Color.WHITE)
			draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		else:
			D.text_xf(self, bc, b.word, disp, 26.0 * k, b.col, 4.0 * k, sc, 0.0, 3.0 * k)

func _eye(c: Vector2, k: float) -> void:
	var rx := 13.0 * k
	var ry := 8.0 * k
	var pts := PackedVector2Array()
	for i in 24:
		var a := TAU * i / 24.0
		pts.append(c + Vector2(cos(a) * rx, sin(a) * ry))
	var sh := PackedVector2Array()
	for p in pts:
		sh.append(p + Vector2(0, 2.0 * k))
	draw_colored_polygon(sh, Color(0, 0, 0, 0.35))
	draw_colored_polygon(pts, Color("7dffa8"))
	pts.append(pts[0])
	draw_polyline(pts, D.INK, 2.5 * k, true)
	draw_circle(c, 4.0 * k, D.INK)
	var d := Vector2(cos(deg_to_rad(-28.0)), sin(deg_to_rad(-28.0))) * (rx + 5.0 * k)
	draw_line(c - d, c + d, D.INK, 3.0 * k, true)

func _ink(a: float) -> Color:
	return Color(D.INK.r, D.INK.g, D.INK.b, a)

func _al(c: Color, a: float) -> Color:
	return Color(c.r, c.g, c.b, c.a * a)

# ---------------------------------------------------------------- damage numbers (.floater, floatUp 0.9 s)

func _draw_floats(k: float) -> void:
	var disp := Fonts.display()
	for f in _floats:
		var st: Array = FLOAT_STYLE.get(f.cls, [20.0, Color.WHITE])
		var size: float = st[0]
		var col: Color = st[1]
		if f.hits >= 3 and f.cls.begins_with("dmg"):
			size = 28.0                          # .floater.big
			if f.cls == "dmg-out":
				col = Color("fff3b0")
		size *= k
		var h := D.line_h(disp, size)
		var t: float = f.age / FLOAT_LIFE
		var op: float
		var dy: float
		var sc: float
		if t < 0.15:
			var u := D.ease_out(t / 0.15)
			op = u
			dy = lerpf(0.2, -0.3, u)
			sc = lerpf(0.6, 1.15, u)
		else:
			var u2 := D.ease_out((t - 0.15) / 0.85)
			op = 1.0 - u2
			dy = lerpf(-0.3, -2.1, u2)
			sc = lerpf(1.15, 0.95, u2)
		col.a = op
		if f.cls == "immune":   # .floater.immune: letter-spacing 1px
			_spaced(f.p + Vector2(0, dy * h), f.text, disp, size, col, 3.0 * k, sc, 1.0 * k)
		else:
			D.text_xf(self, f.p + Vector2(0, dy * h), f.text, disp, size, col, 3.0 * k, sc)

# Text centred on c with extra space between letters, scaled around its centre.
func _spaced(c: Vector2, s: String, font: Font, size: float, col: Color, stroke: float, sc: float, spacing: float) -> void:
	var w := 0.0
	for ch in s:
		w += D.width(font, ch, size) + spacing
	w -= spacing
	var ink := Color(D.INK.r, D.INK.g, D.INK.b, col.a)
	draw_set_transform(c, 0.0, Vector2(sc, sc))
	var y := -D.line_h(font, size) * 0.5
	for pass_ in 2:   # all strokes first, then the fills (paint-order: stroke fill)
		var x := -w * 0.5
		for ch in s:
			if pass_ == 0:
				x += D.text(self, Vector2(x, y), ch, font, size, ink, stroke, ink) + spacing
			else:
				x += D.text(self, Vector2(x, y), ch, font, size, col) + spacing
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

# ---------------------------------------------------------------- K.O. stamp (koStamp 1.1 s)

func _draw_kos(k: float) -> void:
	var disp := Fonts.display()
	var size := (32.0 if D.short_screen(self) else 46.0) * k
	var h := D.line_h(disp, size)
	# keyframes: [time, opacity, dy (x height), scale, rotation deg]
	var keys := [[0.0, 0.0, 0.0, 2.6, -4.0], [0.14, 1.0, 0.0, 0.92, -12.0], [0.24, 1.0, 0.0, 1.04, -10.0],
		[0.75, 1.0, -0.2, 1.0, -10.0], [1.0, 0.0, -0.6, 0.9, -10.0]]
	for s in _kos:
		var t: float = s.age / KO_LIFE
		var i := 0
		while i < keys.size() - 2 and t > keys[i + 1][0]:
			i += 1
		var a0: Array = keys[i]
		var a1: Array = keys[i + 1]
		var u := D.back_out((t - a0[0]) / (a1[0] - a0[0]))
		var op := clampf(lerpf(a0[1], a1[1], u), 0.0, 1.0)
		var col := D.YELLOW
		col.a = op
		D.text_xf(self, s.p + Vector2(0, lerpf(a0[2], a1[2], u) * h), I18n.t("hud.ko"), disp, size, col, 5.0 * k,
			lerpf(a0[3], a1[3], u), deg_to_rad(lerpf(a0[4], a1[4], u)), 5.0 * k)
