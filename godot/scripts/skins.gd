class_name Skins
extends Node3D
# Brawler cosmetics (src/cosmetics.js, figurines.js): the `cos` string of a roster row
# ('skin.trail.ko.frame.title.icon', e.g. '2.1.0.3.4.7') turned into looks. Skins re-colour the painted
# texture on the GLB (assets/shaders/skin.gdshader), trails are a small CPU particle pool behind a
# running brawler, K.O. effects burst when someone is knocked out. Looks only, never a rule.
#
#   Skins.apply(fighter, row)      once, when the fighter is created (hook in fighter.gd setup)
# The Arena keeps one Skins node: it draws the trails and runs the K.O. bursts.

const MAX_TRAIL := 160
static var _data: Dictionary = {}

static func data() -> Dictionary:
	if _data.is_empty():
		var f := FileAccess.open("res://data/cosmetics.json", FileAccess.READ)
		_data = JSON.parse_string(f.get_as_text()) if f else {"skins": ["default"], "recolours": {}, "trails": ["none"], "trailFx": {}, "kofx": ["none"], "cosDefault": "0.0.0.0.1.0"}
	return _data

# {skin, trail, ko, frame, title, icon} (indices), like parseCos of cosmetics.js.
static func parse(cos: String) -> Dictionary:
	var d := data()
	var parts := cos.split(".")
	var ok := parts.size() == 6
	if ok:
		for p in parts:
			if not p.is_valid_int():
				ok = false
	if not ok:
		parts = String(d.cosDefault).split(".")
	var v: Array = []
	for p in parts:
		v.append(int(p))
	return {
		"skin": v[0] if v[0] < d.skins.size() else 0,
		"trail": v[1] if v[1] < d.trails.size() else 0,
		"ko": v[2] if v[2] < d.kofx.size() else 0,
		"frame": v[3], "title": v[4], "icon": v[5],
	}

# Re-colour / gild the fighter's model and remember its trail for the pool below.
static func apply(f: Fighter, row: Dictionary) -> void:
	var cos_str := String(row.get("cos", ""))
	for a in OS.get_cmdline_user_args(): # test only: `--cos=2.1.0.0.1.0` dresses everybody
		if a.begins_with("--cos="):
			cos_str = a.substr(6)
	var c := parse(cos_str)
	f.set_meta("cos", c)
	var d := data()
	var name := String(d.skins[c.skin])
	if name == "default":
		return
	var key := String(row.type).split(":")[0]
	var rc: Array = d.recolours.get(key, {}).get(name, [0.0, 1.0, 1.0])
	var gold := name == "gold"
	var model = f.get("_model")
	if not (model is Node3D):
		var body = f.get("_body")
		if body is MeshInstance3D:
			var m := StandardMaterial3D.new()
			m.albedo_color = Color(1.0, 0.74, 0.22) if gold else Color.from_hsv(fposmod(0.6 + float(rc[0]) / TAU, 1.0), 0.6, 0.8)
			(body as MeshInstance3D).material_override = m
		return
	var shader: Shader = load("res://assets/shaders/skin.gdshader")
	var cache := {}
	for mi in (model as Node3D).find_children("*", "MeshInstance3D", true, false):
		var mesh := (mi as MeshInstance3D).mesh
		if mesh == null:
			continue
		for s in mesh.get_surface_count():
			var src := (mi as MeshInstance3D).get_active_material(s) as BaseMaterial3D
			if src == null:
				continue
			if not cache.has(src):
				var sm := ShaderMaterial.new()
				sm.shader = shader
				sm.set_shader_parameter("albedo", src.albedo_color)
				if src.albedo_texture:
					sm.set_shader_parameter("albedo_tex", src.albedo_texture)
				sm.set_shader_parameter("recol", Vector3(float(rc[0]), float(rc[1]), float(rc[2])))
				sm.set_shader_parameter("gold", 1.0 if gold else 0.0)
				sm.set_shader_parameter("roughness", src.roughness)
				cache[src] = sm
			(mi as MeshInstance3D).set_surface_override_material(s, cache[src])

# ------------------------------------------------------------------ trails

var mm: MultiMesh
var parts: Array = []      # {p, v, life, max, size, col, grav, drag, spin}
var acc: Dictionary = {}   # fighter id -> spawn timer
var last: Dictionary = {}  # fighter id -> last position
var rng := RandomNumberGenerator.new()

func _ready() -> void:
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.billboard_keep_scale = true
	m.disable_fog = true
	q.material = m
	mm = MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = q
	mm.instance_count = MAX_TRAIL
	mm.visible_instance_count = 0
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.custom_aabb = AABB(Vector3(-60, -2, -60), Vector3(120, 8, 120))
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	rng.randomize()

func _spawn(pos: Vector3, kind: String) -> void:
	var fx: Dictionary = data().trailFx.get(kind, {})
	if fx.is_empty() or parts.size() >= MAX_TRAIL:
		return
	var cols: Array = fx.col
	var c: Array = cols[rng.randi() % cols.size()]
	var up := float(fx.up)
	var cube: bool = fx.get("cube", false)
	parts.append({
		"p": pos + Vector3(rng.randf_range(-0.3, 0.3), rng.randf_range(0.2, 0.9), rng.randf_range(-0.3, 0.3)),
		"v": Vector3(rng.randf_range(-0.4, 0.4), up, rng.randf_range(-0.4, 0.4)),
		"life": rng.randf_range(0.5, 0.8), "max": 0.8, "size": float(fx.size) * rng.randf_range(0.7, 1.2) * 1.4,
		"col": Color(float(c[0]) / 4.0, float(c[1]) / 4.0, float(c[2]) / 4.0) if not cube else Color(float(c[0]), float(c[1]), float(c[2])),
		"grav": 6.0 if cube else -up * 0.3, "drag": 0.0 if cube else 1.5,
	})

func update(delta: float, fighters: Dictionary, arena: Arena) -> void:
	var lvl := float(Quality.preset().weather)
	for id in fighters:
		var f: Fighter = fighters[id]
		var c: Dictionary = f.get_meta("cos", {})
		var trail := int(c.get("trail", 0))
		if trail == 0 or not f.visible or not f.alive:
			continue
		var moved: float = f.position.distance_to(last.get(id, f.position))
		last[id] = f.position
		# only while running in sight, never out of a bush (it would give you away)
		if moved / maxf(delta, 1e-4) < 1.5 or arena.is_bush(f.position.x, f.position.z):
			continue
		acc[id] = float(acc.get(id, 0.0)) - delta
		if float(acc[id]) <= 0.0:
			acc[id] = 0.05 / maxf(lvl, 0.3)
			_spawn(f.position, String(data().trails[trail]))
	for k in range(parts.size() - 1, -1, -1):
		var p: Dictionary = parts[k]
		p.life = float(p.life) - delta
		if float(p.life) <= 0.0:
			parts.remove_at(k)
			continue
		var v: Vector3 = p.v
		v.y -= float(p.grav) * delta
		v *= maxf(0.0, 1.0 - float(p.drag) * delta)
		p.v = v
		p.p = p.p + v * delta
	mm.visible_instance_count = parts.size()
	for k in parts.size():
		var p: Dictionary = parts[k]
		var u := float(p.life) / float(p.max)
		var s := float(p.size) * (0.4 + 0.6 * clampf(u * 1.6, 0.0, 1.0))
		mm.set_instance_transform(k, Transform3D(Basis.from_scale(Vector3.ONE * s), p.p))
		var col: Color = p.col
		mm.set_instance_color(k, Color(col.r, col.g, col.b, clampf(u * 1.8, 0.0, 1.0)))

# ------------------------------------------------------------------ K.O. effects

# `killer`'s K.O. effect bursts where `pos` fell (src/effects.js koBurst).
func ko_burst(pos: Vector3, killer: Fighter) -> void:
	if killer == null:
		return
	var c: Dictionary = killer.get_meta("cos", {})
	var ko := int(c.get("ko", 0))
	if ko == 0:
		return
	var kind := String(data().kofx[ko])
	match kind:
		"confetti":
			for col in [Color(1, 0.15, 0.2), Color(0.15, 0.75, 1), Color(1, 0.85, 0.1), Color(0.2, 1, 0.25)]:
				WorldFx.debris(self, pos + Vector3(0, 1.4, 0), col, 7, 0.16, 6.0)
			WorldFx.sparks(self, pos + Vector3(0, 1.6, 0), Color.WHITE, 16, 8.0, 0.5, 0.14)
		"pixels":
			for col in [Color(0.6, 0.2, 0.9), Color(0.2, 0.9, 0.5), Color(0.95, 0.3, 0.8)]:
				WorldFx.debris(self, pos + Vector3(0, 1.2, 0), col, 8, 0.28, 7.0)
		"fireworks":
			var cols := [Color(1, 0.2, 0.15), Color(0.15, 0.6, 1), Color(1, 0.85, 0.2)]
			for i in 3:
				get_tree().create_timer(i * 0.16).timeout.connect(func():
					WorldFx.sparks(self, pos + Vector3(rng.randf_range(-1.2, 1.2), 3.0 + i * 0.6, rng.randf_range(-1.2, 1.2)), cols[i], 24, 9.0, 0.7, 0.14))
		"slime":
			WorldFx.debris(self, pos + Vector3(0, 0.8, 0), Color(0.3, 0.95, 0.35), 16, 0.34, 6.0)
			WorldFx.ring(self, pos.x, pos.z, 1.8, Color(0.4, 1.0, 0.45), 0.5)
		"stars":
			WorldFx.sparks(self, pos + Vector3(0, 2.2, 0), Color(1, 0.85, 0.15), 8, 3.5, 0.9, 0.17)
