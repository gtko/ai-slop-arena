class_name DuoHud
extends Control
# The Duo part of the in-match HUD (hud.js setupTeam / updateTeam, meta.css "Duo (v0.14)"), over the
# Hud (a child of it, so it shows and hides with it), laid out in the web's CSS px:
#   #teamCard   top left under the sound button: your partner's portrait, name, health bar, what
#               happens to it ("Knocked out · 12 s to revive", "Reviving… 40 %", "Out") and the
#               revive hearts left to your team (2);
#   #mateArrow  at the screen edge toward your partner (or its ghost, cyan and blinking) when it is
#               off screen and you are up;
#   #ghostMsg   you are knocked out: how long your partner has to revive you, then its progress.

const D := preload("res://scripts/hud_draw.gd")

var duo: Duo
var hud: Hud
var cam: Camera3D
var _faces: Dictionary = {}
var _last: Array = []
var _time := 0.0

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _process(delta: float) -> void:
	_time += delta
	var sig := _sig()
	if sig != _last:
		_last = sig
		queue_redraw()

# What is drawn, rounded to what can be seen (redraw only when it changes).
func _sig() -> Array:
	if duo == null or not duo.on or duo.me == null or (hud and hud.result_open):
		return []
	var m := duo.mate
	var k := D.css_scale(self)
	var sig: Array = [k, size, I18n.lang, duo.revives.duplicate()]
	if m:
		var G := duo.ghost_of(m)
		sig.append_array([m.alive, roundi(clampf(m.hp / maxf(m.max_hp, 1.0), 0.0, 1.0) * 200.0), G.is_empty(),
			ceili(maxf(0.0, G.get("t", 0.0))), roundi(float(G.get("p", 0.0)) / Duo.REVIVE_TIME * 100.0)])
		var a: Variant = _arrow()
		if a != null:
			sig.append_array([(a[0] as Vector2).round(), snappedf(a[1], 0.02), a[2], snappedf(_time, 0.05) if a[2] else 0.0])
	var MG := duo.my_ghost()
	if not MG.is_empty() and not duo.me.alive:
		sig.append_array([ceili(maxf(0.0, MG.t)), roundi(float(MG.p) / Duo.REVIVE_TIME * 100.0)])
	return sig

func _face(key: String) -> Texture2D:
	if not _faces.has(key):
		var p := "res://assets/ui/%s.png" % key
		_faces[key] = load(p) if ResourceLoader.exists(p) else null
	return _faces[key]

func _draw() -> void:
	if _last.is_empty():
		return
	var k := D.css_scale(self)
	if duo.mate:
		_team_card(k)
		var a: Variant = _arrow()
		if a != null:
			_draw_arrow(a[0], a[1], a[2], k)
	_ghost_msg(k)

# #teamCard: left 14, top 62; 40 px portrait, the name, the health bar, the state line, the hearts.
func _team_card(k: float) -> void:
	var m := duo.mate
	var short := D.short_screen(self)
	var disp := Fonts.display()
	var body := Fonts.body(800)
	var img := (30.0 if short else 40.0) * k
	var pad := Vector4(3, 6, 3, 3) * k if short else Vector4(6, 10, 6, 6) * k   # top right bottom left
	var nfs := 14.0 * k
	var sfs := 11.0 * k
	var hfs := 14.0 * k
	var inner_h := D.line_h(disp, nfs) + 3.0 * k + 10.0 * k + 3.0 * k + maxf(13.0 * k, D.line_h(body, sfs))
	var h := maxf(img, inner_h) + pad.x + pad.z + 4.0 * k
	var w := (150.0 if short else 190.0) * k
	var G := duo.ghost_of(m)
	var st := ""
	if not m.alive:
		if G.is_empty():
			st = I18n.t("hud.mateOut")
		elif float(G.p) > 0.0:
			st = I18n.t("hud.reviving", {"n": roundi(float(G.p) / Duo.REVIVE_TIME * 100.0)})
		else:
			st = I18n.t("hud.ghost", {"n": ceili(maxf(0.0, G.t))})
	var name := m.fname
	var hearts_w := D.width(disp, "♥", hfs) + 2.0 * k
	w = maxf(w, pad.w + img + 8.0 * k + maxf(D.width(body, st, sfs), D.width(disp, name, nfs)) + 8.0 * k + hearts_w + pad.y + 4.0 * k)
	var r := Rect2(14.0 * k, 62.0 * k, w, h)
	D.box(self, r, 14.0 * k, D.PANEL, 2.0 * k, D.INK, 3.0 * k, Color(0, 0, 0, 0.4))
	# portrait (object-fit: contain, top) on its green tile; grey once down
	var ir := Rect2(r.position.x + 2.0 * k + pad.w, r.get_center().y - img * 0.5, img, img)
	D.flat_fill(self, ir, 10.0 * k, Color(47 / 255.0, 211 / 255.0, 107 / 255.0, 0.25))
	var tex := _face(String(m.type.get("key", "")))
	if tex:
		var ts := tex.get_size()
		var sc := minf(ir.size.x / ts.x, ir.size.y / ts.y)
		var ds := ts * sc
		var mod := Color(0.5, 0.5, 0.52) if not m.alive else Color.WHITE
		draw_texture_rect(tex, Rect2(ir.position.x + (ir.size.x - ds.x) * 0.5, ir.position.y, ds.x, ds.y), false, mod)
	# hearts column (right)
	var hx := r.end.x - 2.0 * k - pad.y - hearts_w
	var left := int(duo.revives[m.team]) if m.team >= 0 else 0
	var hl := D.line_h(disp, hfs)
	var hy := r.get_center().y - (hl * Duo.REVIVES + 1.0 * k) * 0.5
	for i in Duo.REVIVES:
		var on := i < left
		D.text(self, Vector2(hx, hy + i * (hl + 1.0 * k)), "♥", disp, hfs, Color("ff5c7a") if on else Color("3a2a3a"), 1.5 * k)
	# name, bar, state
	var x := ir.end.x + 8.0 * k
	var cw := hx - 8.0 * k - x
	var y := r.get_center().y - inner_h * 0.5
	D.text(self, Vector2(x, y), _fit(name, disp, nfs, cw), disp, nfs, Color("7dffa8"), 2.0 * k)
	y += D.line_h(disp, nfs) + 3.0 * k
	var br := Rect2(x, y, cw, 10.0 * k)
	D.box(self, br, 4.0 * k, Color("2a0e14"), 2.0 * k, D.INK)
	var f := clampf(m.hp / maxf(m.max_hp, 1.0), 0.0, 1.0) if m.alive else 0.0
	var bi := br.grow(-2.0 * k)
	if f < 0.3:
		D.grad_fill(self, bi, 2.0 * k, Color("ff7a6b"), Color("e0342e"), bi.size.x * f)
	else:
		D.grad_fill(self, bi, 2.0 * k, Color("8dffc0"), Color("22b86a"), bi.size.x * f)
	y += 10.0 * k + 3.0 * k
	if st != "":
		D.text(self, Vector2(x, y), _fit(st, body, sfs, cw + hearts_w), body, sfs, Color("bfe8ff"))

func _fit(s: String, font: Font, fs: float, w: float) -> String:
	if D.width(font, s, fs) <= w or s.length() < 2:
		return s
	var t := s
	while t.length() > 1 and D.width(font, t + "…", fs) > w:
		t = t.substr(0, t.length() - 1)
	return t + "…"

# hud.js edge(): the partner (or its ghost) off screen -> [screen point clamped inside pad 46, angle, ghost]
func _arrow() -> Variant:
	var m := duo.mate
	if m == null or cam == null or duo.me == null or not duo.me.alive:
		return null
	var G := duo.ghost_of(m)
	var p: Vector3
	if m.alive:
		p = m.position
	elif not G.is_empty():
		p = Vector3(G.x, 0, G.z)
	else:
		return null
	var wp := p + Vector3(0, 1.6, 0)
	var vs := size
	var k := D.css_scale(self)
	var behind := cam.is_position_behind(wp)
	var s := cam.unproject_position(wp)
	if behind:
		s = vs - s
	var pad := 46.0 * k
	var off := behind or s.x < pad or s.x > vs.x - pad or s.y < pad or s.y > vs.y - pad
	if not off:
		return null
	var c := Vector2(clampf(s.x, pad, vs.x - pad), clampf(s.y, pad, vs.y - pad))
	return [c, atan2(s.y - vs.y * 0.5, s.x - vs.x * 0.5), not m.alive]

# #mateArrow: a green disc with an ink border and a pointer (the ghost: cyan, blinking).
func _draw_arrow(c: Vector2, ang: float, ghost: bool, k: float) -> void:
	var a := 1.0
	if ghost:   # mateGhost 0.8 s alternate: opacity 1 -> 0.45
		var u := 0.5 - 0.5 * cos(_time * PI / 0.8)
		a = lerpf(1.0, 0.45, u)
	var col := Color("7ff0ff") if ghost else Color("2fd36b")
	var r := 20.0 * k
	D.glow(self, c, r, 14.0 * k, Color(col.r, col.g, col.b, 0.6 * a))
	var dir := Vector2(cos(ang), sin(ang))
	var nrm := Vector2(-dir.y, dir.x)
	var tip := c + dir * (r + 11.0 * k)
	var b0 := c + dir * (r - 3.0 * k) + nrm * 8.0 * k
	var b1 := c + dir * (r - 3.0 * k) - nrm * 8.0 * k
	draw_colored_polygon(PackedVector2Array([b0, tip, b1]), Color(D.INK.r, D.INK.g, D.INK.b, a))
	draw_circle(c, r, Color(D.INK.r, D.INK.g, D.INK.b, a))
	draw_circle(c, r - 3.0 * k, Color(col.r, col.g, col.b, a))

# #ghostMsg: top 24 %, centred, cyan border.
func _ghost_msg(k: float) -> void:
	var me := duo.me
	var MG := duo.my_ghost()
	if me.alive or MG.is_empty():
		return
	var s := I18n.t("hud.beingRevived", {"n": roundi(float(MG.p) / Duo.REVIVE_TIME * 100.0)}) if float(MG.p) > 0.0 \
		else I18n.t("hud.youGhost", {"n": ceili(maxf(0.0, MG.t))})
	var disp := Fonts.display()
	var fs := 20.0 * k
	var short := D.short_screen(self)
	if short:
		fs = 16.0 * k
	var tw := D.width(disp, s, fs)
	var maxw := size.x - 32.0 * k
	while tw + 36.0 * k > maxw and fs > 10.0 * k:
		fs -= 1.0 * k
		tw = D.width(disp, s, fs)
	var w := tw + 36.0 * k + 4.0 * k
	var h := D.line_h(disp, fs) + 16.0 * k + 4.0 * k
	var r := Rect2(size.x * 0.5 - w * 0.5, size.y * 0.24, w, h)
	D.box(self, r, 14.0 * k, Color(10 / 255.0, 30 / 255.0, 40 / 255.0, 0.75), 2.0 * k, Color("7ff0ff"))
	D.text_c(self, r.get_center(), s, disp, fs, Color("bff8ff"), 2.0 * k)
