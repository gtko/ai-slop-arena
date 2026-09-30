class_name Ambient
extends Node3D
# Ambient life (src/ambient/*.js): rigged, animated animals (assets/models/fauna, skeleton clips inside
# the GLBs) wandering the arena, flocks circling high above it, and tiny swarms (butterflies, bees,
# dragonflies, motes). Purely cosmetic and client-side. Which animals live on which map, and how they
# move, follows the per-map files of src/ambient/maps (species, counts, tiles, gait, shyness).
#
# Hide and seek: animals only react to brawlers the local player can see (Fighter.visible): a bird
# flying off a bush someone hides in would give them away.
# Quality "fauna" scales the counts (a phone on Low keeps 40 %).

const FLYERS := ["vulture", "raven"]
const WORLD := 1.9
# per-species size on top of the world scale (src/ambient/maps: scale x rigScale)
const SCALE := {"lizard": 1.1, "fennec": 1.2, "arctic_fox": 1.2, "cat": 1.1, "hedgehog": 1.3, "squirrel": 1.2, "hare": 1.0, "frog": 1.0,
	"duck": 1.0, "hen": 0.95, "penguin": 1.0, "sparrow": 1.3, "raven": 1.35, "vulture": 1.1}
const IDLES := ["Idle", "Idle", "Idle", "Look", "Sit", "Sniff", "Scratch", "Pushup", "TailFlick", "Groom", "Croak", "Peck", "Ears"]

# kind: walkers wander on tiles ("on" = allowed tile chars, "near" = must be next to these chars);
# flock: circles above; swarm: tiny things around anchor tiles
const MAPS := {
	"oasis": [
		{"kind": "walk", "sp": "lizard", "n": 8, "on": ".", "near": "#X", "speed": 1.2, "run": 3.0, "pause": [2, 6], "range": 3.0, "shy": 3.0},
		{"kind": "walk", "sp": "fennec", "n": 2, "on": ".", "speed": 0.9, "run": 3.0, "pause": [4, 10], "range": 8.0, "shy": 4.0},
		{"kind": "flock", "sp": "vulture", "n": 5, "flocks": 2, "radius": [15, 24], "height": [10, 13], "speed": 0.13},
		{"kind": "swarm", "shape": "fly", "n": 8, "at": "W", "radius": 1.8, "height": [0.5, 1.3], "speed": 0.9, "colors": ["#31d8ff", "#ff4fc8", "#6cff5a", "#4a7bff"]},
		{"kind": "swarm", "shape": "wing", "n": 8, "at": "B", "radius": 1.8, "height": [0.8, 1.8], "speed": 0.45, "colors": ["#ff8a1c", "#fff4e0", "#ffd23a"]},
		{"kind": "swarm", "shape": "mote", "n": 26, "at": ".", "radius": 1.5, "height": [0.8, 4.0], "speed": 0.15, "colors": ["#fff0c8", "#ffe0a0"]},
	],
	"dunes": [
		{"kind": "walk", "sp": "fennec", "n": 3, "on": ".", "speed": 0.9, "run": 3.2, "pause": [4, 10], "range": 8.0, "shy": 4.0},
		{"kind": "flock", "sp": "vulture", "n": 4, "flocks": 2, "radius": [8, 18], "height": [10, 13], "speed": 0.14},
	],
	"frost": [
		{"kind": "walk", "sp": "penguin", "n": 6, "on": "I.", "slide": "I", "speed": 0.9, "run": 2.4, "pause": [2, 6], "range": 4.0, "shy": 3.0},
		{"kind": "walk", "sp": "hare", "n": 5, "on": ".", "hop": true, "speed": 1.3, "run": 3.5, "pause": [1, 4], "range": 5.0, "shy": 3.2},
		{"kind": "walk", "sp": "arctic_fox", "n": 2, "on": ".", "speed": 0.9, "run": 3.2, "pause": [2, 6], "range": 8.0, "shy": 4.0},
		{"kind": "flock", "sp": "raven", "n": 5, "flocks": 2, "radius": [12, 22], "height": [8, 11], "speed": 0.18},
		{"kind": "swarm", "shape": "mote", "n": 22, "at": ".I", "radius": 3.0, "height": [1.2, 3.5], "speed": 0.15, "colors": ["#ffffff", "#cfe8ff"]},
	],
	"grove": [
		{"kind": "walk", "sp": "frog", "n": 7, "on": ".", "near": "W", "hop": true, "speed": 1.2, "run": 2.2, "pause": [1.5, 5], "range": 2.0, "shy": 3.0},
		{"kind": "walk", "sp": "hedgehog", "n": 3, "on": ".", "speed": 0.45, "run": 1.1, "pause": [2, 6], "range": 5.0, "shy": 3.0},
		{"kind": "walk", "sp": "squirrel", "n": 3, "on": ".", "near": "B", "hop": true, "speed": 1.6, "run": 3.0, "pause": [0.8, 3], "range": 4.0, "shy": 3.5},
		{"kind": "walk", "sp": "duck", "n": 3, "on": "W", "swim": true, "speed": 0.5, "run": 1.4, "pause": [3, 8], "range": 4.0, "shy": 3.0},
	],
	"isles": [
		{"kind": "swarm", "shape": "wing", "n": 14, "at": ".B", "radius": 2.2, "height": [0.6, 1.8], "speed": 0.5, "colors": ["#ffd84a", "#ffffff", "#ff9ad0", "#9ad8ff", "#ff9a3c"]},
		{"kind": "swarm", "shape": "mote", "n": 24, "at": ".B", "radius": 1.2, "height": [1.2, 3.5], "speed": 0.25, "colors": ["#ffffff", "#f0ffd0"]},
		{"kind": "swarm", "shape": "fly", "n": 10, "at": "H", "radius": 0.9, "height": [0.85, 1.35], "speed": 1.1, "colors": ["#ffd23a"]},
		{"kind": "walk", "sp": "hen", "n": 4, "on": ".", "near": "M", "speed": 0.6, "run": 1.8, "pause": [1, 3.5], "range": 4.0, "shy": 2.5},
		{"kind": "walk", "sp": "cat", "n": 1, "on": ".", "near": "M", "speed": 0.7, "run": 2.6, "pause": [5, 12], "range": 6.0, "shy": 3.0},
		{"kind": "walk", "sp": "squirrel", "n": 3, "on": ".", "near": "K#", "hop": true, "speed": 1.8, "run": 3.0, "pause": [0.6, 2.5], "range": 3.0, "shy": 3.5},
		{"kind": "walk", "sp": "sparrow", "n": 6, "on": ".", "hop": true, "speed": 1.0, "run": 2.5, "pause": [1, 3], "range": 4.0, "shy": 3.0},
	],
	"marsh": [
		{"kind": "walk", "sp": "frog", "n": 6, "on": ".", "near": "W", "hop": true, "speed": 1.2, "run": 2.2, "pause": [1.5, 5], "range": 2.0, "shy": 3.0},
		{"kind": "walk", "sp": "duck", "n": 3, "on": "W", "swim": true, "speed": 0.5, "run": 1.4, "pause": [3, 8], "range": 4.0, "shy": 3.0},
	],
}

static var _scenes: Dictionary = {}
static var _fits: Dictionary = {}

var arena: Arena
var t := 0.0
var walkers: Array = []
var flocks: Array = []
var swarms: Array = []
var rng := RandomNumberGenerator.new()

func setup(a: Arena) -> void:
	arena = a
	rng.seed = 90210
	if OS.get_cmdline_user_args().has("--nofauna"):
		return
	for spec in MAPS.get(String(a.map.get("key", "")), []):
		match String(spec.kind):
			"walk":
				_walkers(spec)
			"flock":
				_flock(spec)
			"swarm":
				_swarm(spec)
	apply_quality()

# ------------------------------------------------------------------ helpers

func _tiles(chars: String, near := "") -> Array:
	var out: Array = []
	for j in range(1, GameData.N - 1):
		for i in range(1, GameData.N - 1):
			var ch := arena.tile(i, j)
			if not chars.contains(ch):
				continue
			if near != "":
				var ok := false
				for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1), Vector2i(1, 1), Vector2i(-1, -1), Vector2i(1, -1), Vector2i(-1, 1)]:
					if near.contains(arena.tile(i + d.x, j + d.y)):
						ok = true
						break
				if not ok:
					continue
			out.append(Vector2i(i, j))
	return out

func _instance(sp: String, mul := 1.0) -> Node3D:
	if not _scenes.has(sp):
		var path := "res://assets/models/fauna/%s.glb" % sp
		_scenes[sp] = load(path) if ResourceLoader.exists(path) else null
	var ps: PackedScene = _scenes[sp]
	if ps == null:
		return null
	var inst: Node3D = ps.instantiate()
	if not _fits.has(sp):
		_fits[sp] = _fit(inst)
		for mi in inst.find_children("*", "MeshInstance3D", true, false): # glTF default metallic 1 = black without an env map
			for s in (mi as MeshInstance3D).mesh.get_surface_count():
				var bm := (mi as MeshInstance3D).mesh.surface_get_material(s) as BaseMaterial3D
				if bm:
					bm.metallic = 0.0
		for ap in inst.find_children("*", "AnimationPlayer", true, false):
			for n in (ap as AnimationPlayer).get_animation_list():
				var loop := not String(n) in ["Sit", "Peck", "Scratch", "Look", "Groom", "Croak", "Pushup", "TailFlick", "Ears", "Sniff"]
				(ap as AnimationPlayer).get_animation(n).loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	# the models are real size, the arena is not: brawlers stand 1.9 m tall. Ground animals are scaled to
	# their world (a cat reaches a brawler's knee); the flyers stay real size, high up (fauna.js WORLD)
	var k: float = (1.0 if FLYERS.has(sp) else WORLD) * mul
	var fit: Dictionary = _fits[sp]
	inst.scale = Vector3.ONE * k
	inst.position = Vector3(-float(fit.cx) * k, -float(fit.y) * k, -float(fit.cz) * k)
	var holder := Node3D.new()
	holder.add_child(inst)
	return holder

# Real bounds of the skinned mesh in its rest pose: the GLB's vertices are stored normalised, the size
# lives in the skeleton (bone rest x inverse bind), so the mesh AABB says nothing about the size.
func _fit(inst: Node3D) -> Dictionary:
	var lo := Vector3(1e9, 1e9, 1e9)
	var hi := Vector3(-1e9, -1e9, -1e9)
	for sk in inst.find_children("*", "Skeleton3D", true, false):
		var skel := sk as Skeleton3D
		for mi in skel.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			if m.skin == null or m.mesh == null:
				continue
			var arr := m.mesh.surface_get_arrays(0)
			var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
			var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
			var per: int = bones.size() / maxi(verts.size(), 1)
			var xfs: Array = []
			for bi in m.skin.get_bind_count():
				var bone := m.skin.get_bind_bone(bi)
				if bone < 0:
					bone = skel.find_bone(m.skin.get_bind_name(bi))
				xfs.append(skel.get_bone_global_rest(bone) * m.skin.get_bind_pose(bi))
			for i in range(0, verts.size(), 5):
				var p := Vector3.ZERO
				for kk in per:
					var w: float = weights[i * per + kk]
					if w > 0.0:
						p += w * ((xfs[bones[i * per + kk]] as Transform3D) * verts[i])
				lo = lo.min(p)
				hi = hi.max(p)
	if lo.x > hi.x:
		return {"y": 0.0, "cx": 0.0, "cz": 0.0}
	return {"y": lo.y, "cx": (lo.x + hi.x) / 2.0, "cz": (lo.z + hi.z) / 2.0}

func _play(c: Dictionary, clip: String, speed := 1.0) -> void:
	var ap: AnimationPlayer = c.ap
	if ap == null or not ap.has_animation(clip):
		return
	if c.clip != clip:
		c.clip = clip
		ap.play(clip, 0.2)
	ap.speed_scale = speed

func _ap(holder: Node3D) -> AnimationPlayer:
	for ap in holder.find_children("*", "AnimationPlayer", true, false):
		return ap
	return null

# ------------------------------------------------------------------ walkers

func _walkers(spec: Dictionary) -> void:
	var homes := _tiles(String(spec.on), String(spec.get("near", "")))
	if homes.is_empty():
		homes = _tiles(String(spec.on))
	if homes.is_empty():
		return
	for k in int(spec.n):
		var holder := _instance(String(spec.sp), float(SCALE.get(String(spec.sp), 1.0)))
		if holder == null:
			return
		add_child(holder)
		var h: Vector2i = homes[rng.randi() % homes.size()]
		var p := arena.center(h.x, h.y) + Vector3(rng.randf_range(-0.7, 0.7), 0, rng.randf_range(-0.7, 0.7))
		holder.position = p
		var c := {"node": holder, "ap": _ap(holder), "clip": "", "spec": spec, "home": p, "pos": p, "target": p, "yaw": rng.randf() * TAU,
			"state": "idle", "wait": rng.randf() * 3.0, "run": false, "scale": rng.randf_range(0.9, 1.1), "hop_t": 0.0, "idx": k}
		holder.rotation.y = c.yaw
		holder.scale = Vector3.ONE * float(c.scale)
		walkers.append(c)

func _allowed(spec: Dictionary, x: float, z: float) -> bool:
	var ch := arena.char_at(x, z)
	return String(spec.on).contains(ch) or (bool(spec.get("swim", false)) and ch == "W")

func _step_walkers(delta: float, fighters: Dictionary) -> void:
	var scared: Array = []
	for id in fighters:
		var f: Fighter = fighters[id]
		if f.visible and f.alive:
			scared.append(f.position)
	for c in walkers:
		var spec: Dictionary = c.spec
		var node: Node3D = c.node
		if not node.visible:
			continue
		var pos: Vector3 = c.pos
		if arena.char_at(pos.x, pos.z) == "V": # its ground crumbled away: gone with it
			node.visible = false
			c.idx = 999
			continue
		# shy: run from a brawler that gets too close
		var flee := Vector3.ZERO
		for sp in scared:
			var d: Vector3 = pos - sp
			d.y = 0
			if d.length() < float(spec.shy):
				flee += d.normalized() / maxf(d.length(), 0.3)
		if flee != Vector3.ZERO and (c.state != "flee" or c.target.distance_to(pos) < 0.4):
			var dir := flee.normalized()
			var goal: Vector3 = pos + dir * 3.0
			if _allowed(spec, goal.x, goal.z) and _clear(spec, pos, goal):
				c.target = goal
				c.state = "flee"
				c.run = true
		match String(c.state):
			"idle":
				c.wait = float(c.wait) - delta
				var idles: Array = []
				for n in IDLES:
					if c.ap != null and c.ap.has_animation(n):
						idles.append(n)
				if c.clip == "" or (c.clip != "" and c.ap != null and not c.ap.is_playing()):
					_play(c, idles[rng.randi() % idles.size()] if not idles.is_empty() else "Idle")
				if float(c.wait) <= 0.0:
					_pick(c)
			"move", "flee":
				var to: Vector3 = c.target - pos
				to.y = 0
				var dist := to.length()
				var sp := float(spec.run) if c.run else float(spec.speed)
				if bool(spec.get("slide", "") != "") and String(spec.slide).contains(arena.char_at(pos.x, pos.z)):
					sp = maxf(sp, 3.0)
				if dist < 0.15:
					c.state = "idle"
					c.run = false
					c.wait = rng.randf_range(float(spec.pause[0]), float(spec.pause[1]))
					c.clip = ""
				else:
					var dir := to / dist
					var hop_w := 1.0
					if bool(spec.get("hop", false)):
						c.hop_t = float(c.hop_t) + delta
						hop_w = 0.35 + 1.3 * maxf(0.0, sin(float(c.hop_t) * 6.5))
					var nxt: Vector3 = pos + dir * sp * hop_w * delta
					if not _clear(spec, pos, nxt):
						c.state = "idle"
						c.wait = 0.5
						c.clip = ""
					else:
						pos = nxt
						c.yaw = lerp_angle(float(c.yaw), atan2(dir.x, dir.z), clampf(delta * 9.0, 0, 1))
						var clip := "Walk"
						var rate := clampf(sp / 0.9, 0.6, 2.6)
						if bool(spec.get("swim", false)) and c.ap != null and c.ap.has_animation("Swim"):
							clip = "Swim"
						elif bool(spec.get("hop", false)):
							clip = "Hop"
							rate = 1.0
						elif String(spec.get("slide", "")).contains(arena.char_at(pos.x, pos.z)) and c.ap != null and c.ap.has_animation("Slide"):
							clip = "Slide"
						elif c.run and c.ap != null and c.ap.has_animation("Run"):
							clip = "Run"
						_play(c, clip, rate)
		c.pos = pos
		node.position = Vector3(pos.x, -0.1 if bool(spec.get("swim", false)) else 0.0, pos.z)
		node.rotation.y = float(c.yaw)

func _clear(spec: Dictionary, a: Vector3, b: Vector3) -> bool:
	var d := a.distance_to(b)
	var n := maxi(1, int(ceil(d / 0.5)))
	for k in range(1, n + 1):
		var p := a.lerp(b, k / float(n))
		if not _allowed(spec, p.x, p.z):
			return false
	return true

func _pick(c: Dictionary) -> void:
	var spec: Dictionary = c.spec
	var pos: Vector3 = c.pos
	for tries in 8:
		var a := rng.randf() * TAU
		var d := rng.randf_range(1.0, float(spec.range) * 1.6)
		var goal: Vector3 = pos + Vector3(cos(a), 0, sin(a)) * d
		if goal.distance_to(c.home) > float(spec.range) * 2.0 + 2.0:
			goal = pos + (c.home - pos).normalized() * minf(d, 3.0)
		if _allowed(spec, goal.x, goal.z) and _clear(spec, pos, goal):
			c.target = goal
			c.state = "move"
			c.run = false
			c.clip = ""
			return
	c.wait = 1.0

# ------------------------------------------------------------------ flocks

func _flock(spec: Dictionary) -> void:
	var per := int(ceil(float(spec.n) / float(spec.flocks)))
	for f in int(spec.flocks):
		var F := {"r": rng.randf_range(float(spec.radius[0]), float(spec.radius[1])), "h": rng.randf_range(float(spec.height[0]), float(spec.height[1])),
			"w": float(spec.speed) * (1.0 if f % 2 == 0 else -1.0), "a": rng.randf() * TAU, "birds": []}
		for k in per:
			if F.birds.size() + flocks.size() * 0 >= per:
				break
			var holder := _instance(String(spec.sp), float(SCALE.get(String(spec.sp), 1.0)))
			if holder == null:
				return
			add_child(holder)
			var side := 1.0 if k % 2 == 1 else -1.0
			var row := ceilf(k / 2.0) * 2.4
			var B := {"node": holder, "ap": _ap(holder), "clip": "", "ox": side * row * 0.9, "oz": -row * 0.8, "ph": rng.randf() * TAU, "spec": spec, "s": rng.randf_range(0.9, 1.15)}
			holder.scale = Vector3.ONE * float(B.s)
			F.birds.append(B)
		flocks.append(F)

func _step_flocks(delta: float) -> void:
	for F in flocks:
		F.a = float(F.a) + float(F.w) * delta
		var dir := signf(F.w)
		for B in F.birds:
			var a: float = F.a
			var hx := -sin(a) * dir
			var hz := cos(a) * dir
			var yaw := atan2(hx, hz)
			var px: float = cos(a) * F.r + cos(yaw) * B.ox + hx * B.oz
			var pz: float = sin(a) * F.r - sin(yaw) * B.ox + hz * B.oz
			var node: Node3D = B.node
			node.position = Vector3(px, float(F.h) + sin(t * 0.7 + B.ph) * 0.4, pz)
			node.rotation = Vector3(0, yaw, -dir * 0.3)
			var cyc := fmod(t * 0.3 + float(B.ph), 2.0)
			_play(B, "Fly" if cyc < 1.1 else "Glide", 1.0)

# ------------------------------------------------------------------ swarms (tiny things)

func _swarm(spec: Dictionary) -> void:
	var tiles := _tiles(String(spec.at))
	if tiles.is_empty():
		return
	var mesh: Mesh
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	match String(spec.shape):
		"wing": # a butterfly: two wings that flap (scaled in x)
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			for q in [Vector3(0, 0, 0.12), Vector3(0.24, 0, 0.16), Vector3(0.2, 0, -0.14), Vector3(0, 0, 0.12), Vector3(0.2, 0, -0.14), Vector3(0, 0, -0.1),
					Vector3(0, 0, 0.12), Vector3(-0.2, 0, -0.14), Vector3(-0.24, 0, 0.16), Vector3(0, 0, 0.12), Vector3(0, 0, -0.1), Vector3(-0.2, 0, -0.14)]:
				st.add_vertex(q)
			mesh = st.commit()
		"fly": # dragonfly / bee: a small bar
			var bm := BoxMesh.new()
			bm.size = Vector3(0.05, 0.05, 0.3)
			mesh = bm
		_:
			var bm := BoxMesh.new()
			bm.size = Vector3(0.06, 0.06, 0.06)
			mesh = bm
	if mesh is ArrayMesh:
		mesh.surface_set_material(0, m)
	else:
		(mesh as PrimitiveMesh).material = m
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = int(spec.n)
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.custom_aabb = AABB(Vector3(-60, -2, -60), Vector3(120, 12, 120))
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	var items: Array = []
	var cols: Array = spec.colors
	for k in int(spec.n):
		var tl: Vector2i = tiles[rng.randi() % tiles.size()]
		var c := arena.center(tl.x, tl.y)
		mm.set_instance_color(k, Color(cols[k % cols.size()]))
		items.append({"a": c + Vector3(rng.randf_range(-1, 1), 0, rng.randf_range(-1, 1)), "ph": rng.randf() * TAU, "r": rng.randf_range(0.4, 1.0) * float(spec.radius),
			"h": rng.randf_range(float(spec.height[0]), float(spec.height[1])), "sp": rng.randf_range(0.7, 1.3) * float(spec.speed), "s": rng.randf_range(0.8, 1.3)})
	swarms.append({"mm": mm, "items": items, "spec": spec, "n": int(spec.n)})

func _step_swarms() -> void:
	for S in swarms:
		var spec: Dictionary = S.spec
		var mm: MultiMesh = S.mm
		var shape := String(spec.shape)
		for k in S.items.size():
			var it: Dictionary = S.items[k]
			var a: float = float(it.ph) + t * float(it.sp)
			var x := float(it.a.x) + cos(a) * float(it.r) + sin(a * 0.37) * 0.4
			var z := float(it.a.z) + sin(a * 1.3) * float(it.r) * 0.8
			var y := float(it.h) + sin(a * 1.9) * 0.25
			var yaw := a + PI / 2.0
			var b := Basis(Vector3.UP, yaw)
			if shape == "wing":
				b = b * Basis.from_scale(Vector3(0.25 + absf(sin(t * 14.0 + float(it.ph))) * 0.75, 1, 1))
			elif shape == "mote":
				b = Basis(Vector3.UP, t + float(it.ph)) * Basis(Vector3.RIGHT, t * 0.7)
			b = b.scaled(Vector3.ONE * float(it.s))
			mm.set_instance_transform(k, Transform3D(b, Vector3(x, y, z)))

# ------------------------------------------------------------------ frame

func update(delta: float, fighters: Dictionary) -> void:
	t += delta
	_step_walkers(delta, fighters)
	_step_flocks(delta)
	_step_swarms()

func apply_quality() -> void:
	var k := float(Quality.preset().fauna)
	for c in walkers:
		var spec: Dictionary = c.spec
		(c.node as Node3D).visible = int(c.idx) < int(ceil(int(spec.n) * k))
	for F in flocks:
		var n: int = F.birds.size()
		for i in n:
			(F.birds[i].node as Node3D).visible = i < int(ceil(n * clampf(k * 1.4, 0.0, 1.0)))
	for S in swarms:
		(S.mm as MultiMesh).visible_instance_count = maxi(1, int(ceil(int(S.n) * k)))
