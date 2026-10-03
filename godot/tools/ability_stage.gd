extends "res://scripts/menu_showcase.gd"
# The "ability stage" the preview clips are filmed on (record_abilities.gd): one scene staged by
# tools/stage-abilities.mjs (the real rules, offline) replayed through the match's own nodes, like
# the menu's backdrop (menu_showcase.gd): Arena (the stage's edits on Oasis), Fighter, Fx / FxCombat,
# with the damage and heal numbers and the health bars on, names off, and a fixed game camera.
# It owns its camera, sun and environment (main.gd _build_scene), since it runs as the whole scene.

const Showcase := preload("res://scripts/menu_showcase.gd")

var env: WorldEnvironment        # Lighting reads `sun` / `env` from the running scene
var state := 0                   # not a match (main.gd State): no aim indicator under the star
var data: Dictionary = {}
var zoom := 0.5
var playing := false             # false: the clock waits at 0 (warm-up frames: shaders, spawn pops)

func _ready() -> void:
	var cam := Camera3D.new()
	cam.fov = 40
	cam.near = 0.5
	cam.far = 260.0
	cam.current = true
	add_child(cam)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-55, -30, 0)
	light.shadow_enabled = true
	add_child(light)
	env = WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color("87c4e8")
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.75, 0.78, 0.85)
	e.ambient_light_energy = 0.7
	env.environment = e
	add_child(env)
	setup(cam, env, light)

# Load a staged scene (godot/build/abilities/<clip>.json) and set it up at its first snapshot.
func load_scene(path: String) -> bool:
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (d is Dictionary) or int(d.get("v", 0)) != 1:
		push_error("ability stage: cannot read " + path)
		return false
	data = d
	active = true
	Fighter.interp_glide = true   # the snapshot buffer times arrivals on the wall clock, which a movie doesn't follow
	var base: Dictionary = GameData.maps[String(data.map)]
	var map: Dictionary = base.duplicate()
	var grid: Array = (base.grid as Array).duplicate()
	for ed in data.edits:   # [i, j, ch]
		var j := int(ed[1])
		var row := String(grid[j])
		grid[j] = row.substr(0, int(ed[0])) + String(ed[2]) + row.substr(int(ed[0]) + 1)
	map.grid = grid
	arena = Arena.new()
	_arena = arena
	add_child(arena)
	arena.build(map)
	_fx = Fx.new()
	add_child(_fx)
	_fx.setup(arena, fighters, "star")
	for k in data.roster.size():
		var row: Dictionary = data.roster[k]
		var f: Fighter = Showcase.StarFighter.new() if k == 0 else Fighter.new()
		add_child(f)
		f.setup(row, GameData.brawlers)
		var lb = f.get("_label")   # no names: the clip is about the ability
		if lb is Node3D:
			(lb as Node3D).visible = false
		fighters[String(row.id)] = f
		if k == 0:
			f.is_local = true
			_star = f
			me = f
	_rec = {"snaps": data.snaps, "evs": data.evs, "dur": float(data.to) + 1.0, "roster": data.roster}
	_t = 0.0
	_si = 0
	_ei = 0
	_pump()
	for f in fighters.values():   # everyone where the first snapshot says, at once
		f.position = f.target
		f.rotation.y = f.facing
	_feel.reset()
	zoom = float(data.cam[2])
	_feel.zoom = zoom
	_focus = Vector3(float(data.cam[0]), 0.0, float(data.cam[1]))
	_place_camera(0.0)
	return true

func _frame_shift(_dist: float) -> float:
	return 0.0

func _place_camera(delta: float) -> void:
	if _cam == null:
		return
	_feel.update(delta, zoom)
	var sh := _feel.shake()
	_cam.position = _focus + Lighting.CAM_OFFSET * _feel.zoom * _feel.punch + Vector3(sh.x, sh.y, sh.z) * 0.5
	_cam.look_at(Vector3(_focus.x, 0.5, _focus.z))

func _process(delta: float) -> void:
	if arena == null or _rec == null:
		return
	if playing:
		_t += delta
		_pump()
	_place_camera(delta)
	arena.update(delta)
