class_name Items
extends Node3D
# Power cubes on the ground (game.js spawnItem / updateItems / pickItem): the server's 'item' event
# drops one where a crate broke or a brawler fell; it hops 0.45 s from (x, z) to (tx, tz), then bobs
# and spins until a 'pick' event says who took it. A child of the arena, freed with it.

const SIZE := 0.55
const HOP := 0.45

var _items: Dictionary = {}   # id -> {mi, sx, sz, tx, tz, x, z, t, ph}
var _mesh: BoxMesh
var _mat: StandardMaterial3D
var _rng := RandomNumberGenerator.new()
var _time := 0.0

func _ready() -> void:
	_mesh = BoxMesh.new()
	_mesh.size = Vector3.ONE * SIZE
	_mat = StandardMaterial3D.new()   # 0x3dff7a, emissive 0x22ff66 x 2.2, roughness 0.3
	_mat.albedo_color = Color("3dff7a")
	_mat.emission_enabled = true
	_mat.emission = Color("22ff66")
	_mat.emission_energy_multiplier = 2.2
	_mat.roughness = 0.3

func spawn(id: int, x: float, z: float, tx: float, tz: float) -> void:
	if _items.has(id):
		return
	var mi := MeshInstance3D.new()
	mi.mesh = _mesh
	mi.material_override = _mat
	add_child(mi)
	_items[id] = {"mi": mi, "sx": x, "sz": z, "tx": tx, "tz": tz, "x": x, "z": z, "t": 0.0, "ph": _rng.randf() * 6.0}
	_place(_items[id])
	if DebugArgs.has("itemlog"):
		print("ITEM spawn %d at (%.1f, %.1f) -> (%.1f, %.1f), on the ground: %d" % [id, x, z, tx, tz, _items.size()])

# 'pick': the cube goes, with the web's green sparks and flash where it was
func pick(id: int) -> void:
	var it = _items.get(id)
	if it == null:
		return
	_items.erase(id)
	it.mi.queue_free()
	var fx := Fx.current
	if fx and is_instance_valid(fx):
		fx.spark_burst(Vector3(it.x, 1.0, it.z), Color(0.4, 2.2, 0.8), 14, 5.0, 0.5)
		fx.flash(Vector3(it.x, 1.2, it.z), Color(0.3, 1.0, 0.45), 20.0, 6.0, 0.3)

func clear() -> void:
	for id in _items:
		_items[id].mi.queue_free()
	_items.clear()

func _process(delta: float) -> void:
	_time += delta
	var fx := Fx.current
	var lit := fx != null and is_instance_valid(fx)
	for id in _items:
		var it: Dictionary = _items[id]
		it.t += delta
		_place(it)
		if lit:   # game.js lights: a small green glow on every cube, brighter at night
			fx.emit_light(Vector3(it.x, 1.1, it.z), Color(0.3, 1.0, 0.45), 3.0, 4.5)

func _place(it: Dictionary) -> void:
	var k := minf(1.0, it.t / HOP)
	it.x = lerpf(it.sx, it.tx, k)
	it.z = lerpf(it.sz, it.tz, k)
	var y := 0.75 + sin(k * PI) * 1.3 + (sin(_time * 3.0 + it.ph) * 0.12 if k >= 1.0 else 0.0)
	var mi: MeshInstance3D = it.mi
	mi.position = Vector3(it.x, y, it.z)
	mi.rotation = Vector3(0.6, _time * 1.8 + it.ph, 0.6)
