class_name FxLayer
extends RefCounted
# One instanced particle layer (port of `Layer` in src/effects.js): a MultiMesh updated on the CPU
# from preallocated arrays (structure of arrays, swap-remove), one draw call for all its particles.
# Particle options (like the web's particle()): grav, drag, spin, bounce, grow, shrink, fade, sy.

var mm: MultiMesh
var mmi: MultiMeshInstance3D
var max_n: int
var n := 0
var pos := PackedVector3Array()
var vel := PackedVector3Array()
var life := PackedFloat32Array()
var life_max := PackedFloat32Array()
var size := PackedFloat32Array()
var col := PackedColorArray()
var grav := PackedFloat32Array()
var drag := PackedFloat32Array()
var rot := PackedFloat32Array()
var spin := PackedFloat32Array()
var grow := PackedFloat32Array()
var shrink := PackedFloat32Array()
var sy := PackedFloat32Array()
var flags := PackedByteArray()   # 1 bounce, 2 fade

func _init(parent: Node3D, mesh: Mesh, mat: Material, max_count: int) -> void:
	max_n = max_count
	pos.resize(max_n); vel.resize(max_n)
	life.resize(max_n); life_max.resize(max_n); size.resize(max_n); grav.resize(max_n); drag.resize(max_n)
	rot.resize(max_n); spin.resize(max_n); grow.resize(max_n); shrink.resize(max_n); sy.resize(max_n)
	col.resize(max_n)
	flags.resize(max_n)
	mm = MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = max_n
	mm.visible_instance_count = 0
	mmi = MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-80, -20, -80), Vector3(160, 60, 160))
	parent.add_child(mmi)

func spawn(p: Vector3, v: Vector3, lf: float, sz: float, c: Color, o := {}) -> void:
	var i := n
	if n >= max_n:
		i = randi() % max_n   # full: replace one at random (the web drops the oldest)
	else:
		n += 1
	pos[i] = p
	vel[i] = v
	life[i] = lf
	life_max[i] = lf
	size[i] = sz
	col[i] = c
	grav[i] = float(o.get("grav", 0.0))
	drag[i] = float(o.get("drag", 0.0))
	rot[i] = randf() * 6.0
	spin[i] = float(o.get("spin", 0.0))
	grow[i] = float(o.get("grow", 0.0))
	shrink[i] = float(o.get("shrink", 1.0))
	sy[i] = float(o.get("sy", 1.0))
	flags[i] = (1 if o.get("bounce", false) else 0) | (2 if o.get("fade", false) else 0)

func _swap(i: int, j: int) -> void:
	pos[i] = pos[j]; vel[i] = vel[j]; life[i] = life[j]; life_max[i] = life_max[j]; size[i] = size[j]
	col[i] = col[j]; grav[i] = grav[j]; drag[i] = drag[j]; rot[i] = rot[j]; spin[i] = spin[j]
	grow[i] = grow[j]; shrink[i] = shrink[j]; sy[i] = sy[j]; flags[i] = flags[j]

func update(dt: float) -> void:
	var i := 0
	while i < n:
		life[i] -= dt
		if life[i] <= 0.0:
			n -= 1
			if i != n:
				_swap(i, n)
			continue
		var v := vel[i]
		v.y -= grav[i] * dt
		if drag[i] > 0.0:
			v *= exp(-drag[i] * dt)
		var p := pos[i] + v * dt
		var f := flags[i]
		if (f & 1) and p.y < size[i] * 0.5:
			p.y = size[i] * 0.5
			v = Vector3(v.x * 0.55, absf(v.y) * 0.3, v.z * 0.55)
			spin[i] *= 0.5
		vel[i] = v
		pos[i] = p
		rot[i] += spin[i] * dt
		var a := life[i] / life_max[i]
		var sc := size[i] * (1.0 + (1.0 - a) * grow[i])
		if a < shrink[i]:
			sc *= a / shrink[i]
		var r := rot[i]
		var b := Basis.from_euler(Vector3(r, r * 0.7, r * 0.3)) * Basis.from_scale(Vector3(sc, sc * sy[i], sc))
		mm.set_instance_transform(i, Transform3D(b, p))
		var c := col[i]
		if f & 2:
			mm.set_instance_color(i, Color(c.r * a, c.g * a, c.b * a, c.a))
		else:
			mm.set_instance_color(i, c)
		i += 1
	mm.visible_instance_count = n
