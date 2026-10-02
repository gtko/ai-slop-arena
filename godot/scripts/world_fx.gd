class_name WorldFx
extends RefCounted
# Small one-shot effects of the world (debris, dust, rings, sparks, explosions). CPUParticles3D and
# tweened meshes only, freed when done; counts follow the quality preset (particles are the first thing
# a phone GPU should not draw).

static var _cube: BoxMesh
static var _sphere: SphereMesh
static var _ring: Mesh

static func _k() -> float:
	return clampf(0.35 + float(Quality.preset().weather) * 0.65, 0.3, 1.0)

static func _unshaded(col: Color, alpha := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(col.r, col.g, col.b, alpha)
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m

static func _particles(parent: Node, pos: Vector3, mesh: Mesh, n: int, life: float, speed: Vector2, grav: float, spread: float, dir: Vector3) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.amount = maxi(1, n)
	p.lifetime = life
	p.explosiveness = 0.95
	p.mesh = mesh
	p.direction = dir
	p.spread = spread
	p.initial_velocity_min = speed.x
	p.initial_velocity_max = speed.y
	p.gravity = Vector3(0, -grav, 0)
	p.local_coords = false
	p.finished.connect(p.queue_free)
	parent.add_child(p)
	p.global_position = pos
	p.restart()
	p.emitting = true
	return p

# Tumbling cubes: wall / crate / bridge debris.
static func debris(parent: Node, pos: Vector3, col: Color, n := 10, size := 0.28, speed := 5.0) -> void:
	if _cube == null:
		_cube = BoxMesh.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3.ONE * size
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = 0.9
	mesh.material = m
	var p := _particles(parent, pos, mesh, int(ceilf(n * _k())), 1.1, Vector2(speed * 0.5, speed), 16.0, 60.0, Vector3.UP)
	p.angular_velocity_min = -360.0
	p.angular_velocity_max = 360.0
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.3

# Dust puff on the ground (soft round blobs rising and fading).
static func dust(parent: Node, x: float, z: float, n := 8, col := Color("d8c8a8"), spread := 1.0) -> void:
	var mesh := SphereMesh.new()
	mesh.radius = 0.28
	mesh.height = 0.56
	mesh.radial_segments = 6
	mesh.rings = 3
	var m := _unshaded(col, 0.55)
	mesh.material = m
	var p := _particles(parent, Vector3(x, 0.2, z), mesh, int(ceilf(n * _k())), 0.9, Vector2(0.6, 1.8 * spread), -0.4, 85.0, Vector3.UP)
	p.scale_amount_min = 0.7
	p.scale_amount_max = 1.6 * spread
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.5))
	curve.add_point(Vector2(1, 1.6))
	p.scale_amount_curve = curve
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 0.8))
	ramp.set_color(1, Color(1, 1, 1, 0))
	p.color_ramp = ramp

# Bright sparks (heals, trap snaps).
static func sparks(parent: Node, pos: Vector3, col: Color, n := 14, speed := 4.0, life := 0.5, size := 0.12) -> void:
	var mesh := SphereMesh.new()
	mesh.radius = size
	mesh.height = size * 2.0
	mesh.radial_segments = 6
	mesh.rings = 3
	mesh.material = _unshaded(col)
	_particles(parent, pos, mesh, int(ceilf(n * _k())), life, Vector2(speed * 0.4, speed), 6.0, 180.0, Vector3.UP)

# Expanding flat ring on the ground.
static func ring(parent: Node, x: float, z: float, radius: float, col: Color, life := 0.4) -> void:
	if _ring == null:
		var t := TorusMesh.new()
		t.inner_radius = 0.9
		t.outer_radius = 1.0
		t.rings = 20
		t.ring_segments = 3
		_ring = t
	var mi := MeshInstance3D.new()
	mi.mesh = _ring
	var m := _unshaded(col, 0.9)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	mi.global_position = Vector3(x, 0.12, z)
	mi.scale = Vector3(0.2, 1.0, 0.2)
	var tw := mi.create_tween()
	tw.set_parallel(true)
	tw.tween_property(mi, "scale", Vector3(radius, 1.0, radius), life).set_ease(Tween.EASE_OUT)
	tw.tween_property(m, "albedo_color:a", 0.0, life)
	tw.chain().tween_callback(mi.queue_free)

# Barrel blast: a flash sphere, fire and smoke, a ring.
static func explosion(parent: Node, x: float, z: float, radius: float) -> void:
	var fl := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radial_segments = 12
	sm.rings = 6
	fl.mesh = sm
	var m := _unshaded(Color(1.0, 0.72, 0.28), 0.85)
	fl.material_override = m
	fl.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(fl)
	fl.global_position = Vector3(x, 0.8, z)
	fl.scale = Vector3.ONE * 0.4
	var tw := fl.create_tween()
	tw.set_parallel(true)
	tw.tween_property(fl, "scale", Vector3.ONE * radius * 0.9, 0.3).set_ease(Tween.EASE_OUT)
	tw.tween_property(m, "albedo_color:a", 0.0, 0.35)
	tw.chain().tween_callback(fl.queue_free)
	ring(parent, x, z, radius * 1.05, Color(1.0, 0.6, 0.2), 0.45)
	sparks(parent, Vector3(x, 0.8, z), Color(1.0, 0.55, 0.15), 22, 7.0, 0.7, 0.16)
	dust(parent, x, z, 12, Color(0.28, 0.24, 0.22), 1.6)
	debris(parent, Vector3(x, 0.8, z), Color("5a3a26"), 8, 0.22, 7.0)
