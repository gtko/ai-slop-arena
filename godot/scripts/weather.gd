class_name Weather
extends Node3D
# Weather of the map (`weather`: clear, rain, snow, sandstorm, fog; src/weather.js): GPUParticles3D in a
# box that follows the player, plus a modifier that bends the time of day (sun, sky, fog, exposure),
# see lighting.gd. Particle counts follow the quality preset through `amount_ratio` (a phone on Low
# draws a quarter of them), all materials are unshaded.

const BOX_X := 24.0
const BOX_Z := 20.0
const BOX_Y := 14.0
const WIND := {"clear": 1.0, "rain": 1.8, "snow": 1.3, "sandstorm": 3.2, "fog": 0.7}

var kind := "clear"
var arena: Arena
var rig: Node3D                # follows the focus: emitters live in it
var fields: Array = []         # GPUParticles3D, scaled by quality
var t := 0.0
var gust := 0.0
var flash := 0.0
var flash_layer: CanvasLayer
var flash_rect: ColorRect
var next_bolt := 6.0
var bolt: MeshInstance3D
var bolt_life := 0.0
var mist: Array = []
var flies_mm: MultiMesh
var flies: Array = []
var fog_color := Color.WHITE
var storm := 0.0               # blizzard (Frostbite events): not used by the server yet

func setup(a: Arena, k: String) -> void:
	arena = a
	kind = k
	rig = Node3D.new()
	add_child(rig)
	Foliage.wind = float(WIND.get(kind, 1.0))
	if DebugArgs.list().has("--noweather"):
		return
	match kind:
		"rain":
			_build_rain()
		"snow":
			_build_snow()
		"sandstorm":
			_build_storm()
		"fog":
			_build_fog()
	apply_quality()

# ------------------------------------------------------------------ builders

func _pmat(dir: Vector3, vmin: float, vmax: float, spread := 0.0) -> ParticleProcessMaterial:
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(BOX_X, 0.2, BOX_Z)
	pm.direction = dir
	pm.spread = spread
	pm.initial_velocity_min = vmin
	pm.initial_velocity_max = vmax
	pm.gravity = Vector3.ZERO
	return pm

func _field(mesh: Mesh, pm: ParticleProcessMaterial, amount: int, life: float, y: float) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = life
	p.preprocess = life
	p.process_material = pm
	p.draw_pass_1 = mesh
	p.local_coords = false
	p.visibility_aabb = AABB(Vector3(-BOX_X - 10, -2, -BOX_Z - 10), Vector3(BOX_X * 2 + 20, BOX_Y + 8, BOX_Z * 2 + 20))
	p.position.y = y
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	rig.add_child(p)
	fields.append(p)
	return p

func _unshaded(col: Color, billboard := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = col
	m.disable_fog = true
	if billboard:
		m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		m.billboard_keep_scale = true
	return m

func _build_rain() -> void:
	var streak := BoxMesh.new()
	streak.size = Vector3(0.022, 0.75, 0.022)
	streak.material = _unshaded(Color(0.62, 0.72, 0.95, 0.45))
	var pm := _pmat(Vector3(0.16, -1, 0), 22.0, 28.0, 0.0)
	pm.particle_flag_align_y = true
	_field(streak, pm, 1700, 0.6, BOX_Y)
	# ground splashes: tiny expanding rings
	var ring := TorusMesh.new()
	ring.inner_radius = 0.6
	ring.outer_radius = 1.0
	ring.rings = 10
	ring.ring_segments = 3
	ring.material = _unshaded(Color(0.8, 0.88, 1.0, 0.5))
	var sm := _pmat(Vector3.UP, 0.0, 0.0)
	sm.emission_box_extents = Vector3(BOX_X * 0.8, 0.0, BOX_Z * 0.8)
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.05))
	curve.add_point(Vector2(1, 0.33))
	var ct := CurveTexture.new()
	ct.curve = curve
	sm.scale_curve = ct
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 0.6))
	ramp.set_color(1, Color(1, 1, 1, 0.0))
	var rt := GradientTexture1D.new()
	rt.gradient = ramp
	sm.color_ramp = rt
	_field(ring, sm, 150, 0.28, 0.05)
	# lightning flash: a white veil over the screen
	flash_layer = CanvasLayer.new()
	flash_layer.layer = 5
	add_child(flash_layer)
	flash_rect = ColorRect.new()
	flash_rect.color = Color(1, 1, 1, 0)
	flash_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	flash_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	flash_layer.add_child(flash_rect)
	next_bolt = 5.0 + randf() * 4.0

func _build_snow() -> void:
	var flake := QuadMesh.new()
	flake.size = Vector2(0.15, 0.15)
	flake.material = _unshaded(Color(1.0, 1.0, 1.0, 0.9), true)
	var pm := _pmat(Vector3(0.45, -1, 0.1), 1.2, 2.2, 12.0)
	pm.angle_min = 0.0
	pm.angle_max = 360.0
	pm.scale_min = 0.6
	pm.scale_max = 1.3
	_field(flake, pm, 1900, BOX_Y / 1.5, BOX_Y)

func _build_storm() -> void:
	var grain := BoxMesh.new()
	grain.size = Vector3(0.7, 0.02, 0.02)
	grain.material = _unshaded(Color(1.0, 0.72, 0.42, 0.5))
	var pm := _pmat(Vector3(1, 0, 0.05), 18.0, 32.0, 4.0)
	pm.emission_box_extents = Vector3(2.0, 2.5, BOX_Z)
	pm.particle_flag_align_y = false
	var f := _field(grain, pm, 1500, 2.4, 2.6)
	f.position.x = -BOX_X
	# billowing dust: big soft sprites drifting with the wind
	var gt := GradientTexture2D.new()
	var g := Gradient.new()
	g.set_color(0, Color(0.92, 0.63, 0.37, 0.55))
	g.set_color(1, Color(0.92, 0.63, 0.37, 0.0))
	gt.gradient = g
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.5)
	gt.fill_to = Vector2(1.0, 0.5)
	gt.width = 64
	gt.height = 64
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var qm := _unshaded(Color(1, 1, 1, 0.5), true)
	qm.albedo_texture = gt
	quad.material = qm
	var dm := _pmat(Vector3(1, 0, 0), 5.0, 10.0, 6.0)
	dm.emission_box_extents = Vector3(3.0, 1.8, BOX_Z + 4.0)
	dm.scale_min = 7.0
	dm.scale_max = 14.0
	var d := _field(quad, dm, 42, 9.0, 2.5)
	d.position.x = -BOX_X - 6.0

func _build_fog() -> void:
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.frequency = 0.012
	noise.fractal_octaves = 3
	var nt := NoiseTexture2D.new()
	nt.noise = noise
	nt.seamless = true
	nt.width = 256
	nt.height = 256
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 0))
	ramp.set_color(1, Color(1, 1, 1, 1))
	ramp.set_offset(0, 0.42)
	ramp.set_offset(1, 0.78)
	nt.color_ramp = ramp
	for k in 3:
		var pm := PlaneMesh.new()
		pm.size = Vector2(80, 70)
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_texture = nt
		m.albedo_color = Color(1, 1, 1, [0.38, 0.26, 0.17][k])
		m.uv1_scale = Vector3(3 + k, 3 + k, 1)
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.disable_fog = true
		m.no_depth_test = false
		var mi := MeshInstance3D.new()
		mi.mesh = pm
		mi.material_override = m
		mi.position.y = [0.3, 0.8, 1.35][k]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		rig.add_child(mi)
		mist.append({"mi": mi, "m": m, "sx": (-1.0 if k % 2 == 1 else 1.0) * (0.006 + k * 0.004), "sz": 0.004 + k * 0.002})
	# fireflies wander around bushes and water, blinking
	var spots: Array = []
	for j in range(1, GameData.N - 1):
		for i in range(1, GameData.N - 1):
			var ch := arena.tile(i, j)
			if ch == "B" or ch == "W" or (ch == "." and randf() < 0.08):
				spots.append(arena.center(i, j))
	if spots.is_empty():
		spots.append(Vector3.ZERO)
	var sm := SphereMesh.new()
	sm.radius = 0.06
	sm.height = 0.12
	sm.radial_segments = 6
	sm.rings = 3
	var fm := StandardMaterial3D.new()
	fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fm.vertex_color_use_as_albedo = true
	fm.disable_fog = true
	sm.material = fm
	flies_mm = MultiMesh.new()
	flies_mm.transform_format = MultiMesh.TRANSFORM_3D
	flies_mm.use_colors = true
	flies_mm.mesh = sm
	flies_mm.instance_count = 80
	for k in 80:
		var s: Vector3 = spots[randi() % spots.size()]
		flies.append({"x": s.x + randf_range(-1, 1), "z": s.z + randf_range(-1, 1), "y": randf_range(0.5, 2.4), "ph": randf_range(0, 20), "sp": randf_range(0.6, 1.4)})
		flies_mm.set_instance_color(k, Color(0.8, 1.0, 0.3))
	var fmi := MultiMeshInstance3D.new()
	fmi.multimesh = flies_mm
	fmi.custom_aabb = AABB(Vector3(-60, -2, -60), Vector3(120, 8, 120))
	fmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(fmi)

func apply_quality() -> void:
	var k := clampf(float(Quality.preset().weather), 0.05, 1.0)
	for f in fields:
		(f as GPUParticles3D).amount_ratio = k
	for i in mist.size():
		(mist[i].mi as MeshInstance3D).visible = i == 0 or k > 0.5
	if flies_mm:
		flies_mm.visible_instance_count = maxi(4, int(80 * k))

# ------------------------------------------------------------------ lighting

func _mix(S: Dictionary, key: String, r: float, g: float, b: float, amt: float) -> void:
	var k := 1.0 - 0.85 * float(S.night) if (key == "fog" or key == "sky") else 1.0
	S[key] = (S[key] as Color).lerp(Color(r * k, g * k, b * k), amt)

# Weather bends the time-of-day look (src/weather.js modify).
func modify(S: Dictionary) -> void:
	var f := flash
	match kind:
		"rain":
			S.sunI *= 0.32
			S.shadowI *= 0.55
			S.hemiI *= 0.95 + f * 5.0
			_mix(S, "sun", 0.7, 0.75, 0.85, 0.5)
			_mix(S, "sky", 0.45, 0.5, 0.6, 0.6)
			_mix(S, "fog", 0.3, 0.34, 0.42, 0.75)
			S.fogNear = 26.0
			S.fogFar = 62.0
			S.exposure *= 1.05 + f * 0.8
			S.bloom += 0.1
		"snow":
			S.sunI *= 0.75
			S.shadowI *= 0.8
			S.hemiI *= 1.2
			_mix(S, "sun", 0.85, 0.92, 1.0, 0.5)
			_mix(S, "sky", 0.85, 0.9, 1.0, 0.5)
			_mix(S, "fog", 0.8, 0.86, 0.95, 0.7)
			S.fogNear = 26.0
			S.fogFar = 72.0
			if storm > 0.01:
				_mix(S, "fog", 0.9, 0.94, 1.0, storm * 0.6)
				S.fogNear -= 16.0 * storm
				S.fogFar -= 38.0 * storm
				S.sunI *= 1.0 - 0.4 * storm
		"sandstorm":
			var g := gust
			S.sunI *= 0.55 - g * 0.15
			S.shadowI *= 0.55 - g * 0.2
			S.hemiI *= 1.25
			_mix(S, "sun", 1.0, 0.62, 0.32, 0.6)
			_mix(S, "sky", 0.95, 0.6, 0.32, 0.65)
			_mix(S, "ground", 0.6, 0.3, 0.12, 0.5)
			_mix(S, "fog", 0.78, 0.46, 0.22, 0.85)
			S.fogNear = 21.0 - g * 6.0
			S.fogFar = 50.0 - g * 14.0
			S.bloom *= 0.8
		"fog":
			S.sunI *= 0.5
			S.shadowI *= 0.6
			S.hemiI *= 0.9
			_mix(S, "sky", 0.55, 0.62, 0.6, 0.6)
			_mix(S, "fog", 0.5, 0.57, 0.54, 0.85)
			S.fogNear = 30.0
			S.fogFar = 75.0
	fog_color = S.fog

# ------------------------------------------------------------------ per frame

func update(delta: float, focus: Vector3) -> void:
	t += delta
	rig.position = Vector3(focus.x, 0, focus.z)
	match kind:
		"rain":
			next_bolt -= delta
			if next_bolt <= 0.0:
				_bolt(focus)
			if flash_rect:
				flash_rect.color.a = flash * 0.5
			flash = maxf(0.0, flash - delta * 3.2)
			if bolt:
				bolt_life -= delta
				(bolt.material_override as StandardMaterial3D).albedo_color.a = maxf(0.0, bolt_life / 0.25)
				if bolt_life <= 0.0:
					bolt.queue_free()
					bolt = null
		"sandstorm":
			gust = clampf(0.5 + 0.5 * sin(t * 0.33) * sin(t * 0.13 + 1.3), 0.0, 1.0)
			Foliage.wind = float(WIND.sandstorm) * (0.7 + gust * 0.6)
		"fog":
			_update_fog(delta)

func _bolt(focus: Vector3) -> void:
	next_bolt = randf_range(7.0, 16.0)
	flash = 1.0
	get_tree().create_timer(0.11).timeout.connect(func(): flash = maxf(flash, 0.7))
	var x := focus.x + randf_range(-14, 14)
	var z := focus.z - randf_range(4, 16)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var bx := x
	var bz := z
	var w := 0.18
	var y := 26.0
	while y > 0.0:
		var nx := bx + randf_range(-1.2, 1.2)
		var nz := bz + randf_range(-0.6, 0.6)
		var ny := y - 2.2
		for q in [Vector3(bx - w, y, bz), Vector3(bx + w, y, bz), Vector3(nx + w, ny, nz), Vector3(bx - w, y, bz), Vector3(nx + w, ny, nz), Vector3(nx - w, ny, nz)]:
			st.add_vertex(q)
		bx = nx
		bz = nz
		y = ny
	if bolt:
		bolt.queue_free()
	bolt = MeshInstance3D.new()
	bolt.mesh = st.commit()
	var m := _unshaded(Color(5, 5, 7, 1))
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	bolt.material_override = m
	bolt.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	bolt_life = 0.25
	add_child(bolt)

func _update_fog(delta: float) -> void:
	for L in mist:
		var m: StandardMaterial3D = L.m
		m.uv1_offset.x += float(L.sx) * delta * 6.0
		m.uv1_offset.y += float(L.sz) * delta * 6.0
		var c := fog_color * 1.25
		m.albedo_color = Color(c.r, c.g, c.b, m.albedo_color.a)
	var glow := 0.35 + 0.65 * float(arena.lighting.state.get("night", 0.0)) if arena.lighting else 0.35
	for k in flies.size():
		var f: Dictionary = flies[k]
		var x := float(f.x) + sin(t * 0.4 * f.sp + f.ph) * 1.2
		var z := float(f.z) + cos(t * 0.33 * f.sp + f.ph * 1.3) * 1.2
		var y := float(f.y) + sin(t * 0.9 * f.sp + f.ph) * 0.4
		var b := pow(maxf(0.0, sin(t * 1.3 * f.sp + f.ph)), 3.0) * glow
		flies_mm.set_instance_transform(k, Transform3D(Basis.from_scale(Vector3.ONE * (0.3 + b * 0.9)), Vector3(x, y, z)))
		flies_mm.set_instance_color(k, Color(0.8, 1.0, 0.3) * (0.3 + b * 2.5))
