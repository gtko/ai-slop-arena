extends RefCounted
# Small drawn pieces of the web menu that CSS makes with gradients / SVG: the sound icon, the coin and
# gem of the currency chips, the level ring of the profile button, the Weekly Chaos switch, the
# queue's bouncing dots and the skin recolour shader (CSS filter: hue-rotate / saturate / sepia...).

# The speaker of the sound button (play.html #soundBtn svg, 24x24 viewBox).
class Speaker extends Control:
	var muted := false
	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(24, 24)
	func _draw() -> void:
		var k := size.x / 24.0
		var c := UiKit.WTEXT
		var body := PackedVector2Array([Vector2(4, 9), Vector2(8, 9), Vector2(13, 5), Vector2(13, 19), Vector2(8, 15), Vector2(4, 15)])
		for i in body.size():
			body[i] *= k
		draw_colored_polygon(body, c)
		if muted:
			draw_line(Vector2(16, 9) * k, Vector2(22, 15) * k, Color("ff4b4b"), 2.0 * k, true)
			draw_line(Vector2(22, 9) * k, Vector2(16, 15) * k, Color("ff4b4b"), 2.0 * k, true)
		else:
			draw_arc(Vector2(12.5, 12) * k, 4.0 * k, -0.95, 0.95, 12, c, 2.0 * k, true)
			draw_arc(Vector2(12.5, 12) * k, 7.5 * k, -0.95, 0.95, 16, c, 2.0 * k, true)

# .coin: a gold disc with a highlight and an ink rim
class Coin extends Control:
	func _init(d: float = 16.0) -> void:
		custom_minimum_size = Vector2(d, d)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _draw() -> void:
		var r := size.x / 2.0
		var c := Vector2(r, r)
		draw_circle(c, r, UiKit.INK)
		draw_circle(c, r - 2.0, Color("d99a00"))
		draw_circle(c, (r - 2.0) * 0.82, Color("ffd23f"))
		draw_circle(c + Vector2(-0.2, -0.25) * r, r * 0.3, Color("fff6b0"))

# .gem: a violet square turned 45 degrees with an ink rim
class Gem extends Control:
	func _init(d: float = 16.0) -> void:
		custom_minimum_size = Vector2(d, d)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _draw() -> void:
		var r := size.x * 0.62
		var c := size / 2.0
		var pts := PackedVector2Array([c + Vector2(0, -r), c + Vector2(r, 0), c + Vector2(0, r), c + Vector2(-r, 0)])
		draw_colored_polygon(pts, UiKit.INK)
		var r2 := r - 2.6
		var inner := PackedVector2Array([c + Vector2(0, -r2), c + Vector2(r2, 0), c + Vector2(0, r2), c + Vector2(-r2, 0)])
		draw_polygon(inner, PackedColorArray([Color("f4c8ff"), Color("b56bff"), Color("6a2bd6"), Color("b56bff")]))

# .tn-ring: conic progress ring (violet) around the profile picture
class Ring extends Control:
	var frac := 0.0
	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _draw() -> void:
		var r := size.x / 2.0
		var c := size / 2.0
		draw_circle(c, r, Color(1, 1, 1, 0.25))
		if frac > 0.0:
			var pts := PackedVector2Array([c])
			var n := 48
			for i in n + 1:
				var a := -PI / 2.0 + TAU * frac * float(i) / float(n)
				pts.append(c + Vector2(cos(a), sin(a)) * r)
			draw_colored_polygon(pts, UiKit.VIOLET)

# The Weekly Chaos switch (38x22 track, 16 px knob). Flipping `on` in the tree slides the knob like the
# web's `transition: transform 0.18s cubic-bezier(.3, 1.4, .5, 1)` (a little overshoot) and blends the
# track colour (background 0.15s).
class Switch extends Control:
	var knob := 0.0:
		set(v):
			knob = v
			queue_redraw()
	var on := false:
		set(v):
			if v != on and is_inside_tree():
				var tw := create_tween()
				tw.tween_property(self, "knob", 1.0 if v else 0.0, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
			else:
				knob = 1.0 if v else 0.0
			on = v
			queue_redraw()
	func _init() -> void:
		custom_minimum_size = Vector2(38, 22)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _draw() -> void:
		var c := Color(1, 1, 1, 0.15).lerp(Color("ff4bd8"), clampf(knob, 0.0, 1.0))
		draw_style_box(UiKit.sbox(c, 11), Rect2(Vector2.ZERO, size))
		draw_circle(Vector2(11 + 16.0 * knob, 11), 8, Color.WHITE)

# .q-spin: three yellow dots bouncing
class Dots extends Control:
	var t := 0.0
	func _init() -> void:
		custom_minimum_size = Vector2(58, 26)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _process(delta: float) -> void:
		t += delta
		queue_redraw()
	func _draw() -> void:
		for i in 3:
			var ph := fmod(t / 1.1 - i * 0.15 / 1.1, 1.0)
			var y := -sin(clampf(ph, 0.0, 0.5) * TAU) * 6.0
			var s := 1.0 + 0.2 * maxf(-y / 6.0, 0.0)
			draw_circle(Vector2(7 + i * 22, 16 + y), 7.0 * s, UiKit.YELLOW)

static var _recolour: Shader

# CSS filter on a portrait: hue-rotate(rad) saturate(s) brightness(b); gold = sepia(1) saturate(3.2)
# hue-rotate(-12deg) brightness(1.08) contrast(1.1) (metaui.js skinFilter); dim = locked tiles.
static func recolour(skin: String, rec: Array, dim: float = 1.0) -> ShaderMaterial:
	if _recolour == null:
		_recolour = Shader.new()
		_recolour.code = """shader_type canvas_item;
uniform float sepia = 0.0;
uniform float hue = 0.0;
uniform float sat = 1.0;
uniform float bri = 1.0;
uniform float con = 1.0;
uniform bool sat_first = false;
vec3 hue_rot(vec3 c, float a) {
	float co = cos(a), si = sin(a);
	mat3 m = mat3(
		vec3(0.213 + co * 0.787 - si * 0.213, 0.213 - co * 0.213 + si * 0.143, 0.213 - co * 0.213 - si * 0.787),
		vec3(0.715 - co * 0.715 - si * 0.715, 0.715 + co * 0.285 + si * 0.140, 0.715 - co * 0.715 + si * 0.715),
		vec3(0.072 - co * 0.072 + si * 0.928, 0.072 - co * 0.072 - si * 0.283, 0.072 + co * 0.928 + si * 0.072));
	return m * c;
}
vec3 satur(vec3 c, float s) {
	float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
	return mix(vec3(l), c, s);
}
void fragment() {
	vec4 t = texture(TEXTURE, UV);
	vec3 c = t.rgb;
	vec3 sp = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
	c = mix(c, sp, sepia);
	if (sat_first) { c = satur(c, sat); c = hue_rot(c, hue); }
	else { c = hue_rot(c, hue); c = satur(c, sat); }
	c = clamp(c * bri, 0.0, 1.0);
	c = clamp((c - 0.5) * con + 0.5, 0.0, 1.0);
	COLOR = vec4(c, t.a) * COLOR;
}
"""
	var m := ShaderMaterial.new()
	m.shader = _recolour
	if skin == "gold":
		m.set_shader_parameter("sepia", 1.0)
		m.set_shader_parameter("sat", 3.2)
		m.set_shader_parameter("hue", deg_to_rad(-12.0))
		m.set_shader_parameter("bri", 1.08 * dim)
		m.set_shader_parameter("con", 1.1)
		m.set_shader_parameter("sat_first", true)
	elif rec.size() == 3:
		m.set_shader_parameter("hue", float(rec[0]))
		m.set_shader_parameter("sat", float(rec[1]))
		m.set_shader_parameter("bri", float(rec[2]) * dim)
	else:
		m.set_shader_parameter("bri", dim)
	return m
