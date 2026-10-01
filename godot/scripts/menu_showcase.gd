extends Node3D
# The live arena behind the home screen (the web's attract mode, game.js stageStar): the map you
# picked (a random one for "Random") with your brawler standing on the most open ground near the
# middle, the camera close on it (the game's 47-degree view at the menu zoom, 0.8).

const CAM_OFFSET := Vector3(0, 27.4, 25) * 0.8   # game.js camOffset x menuZoom

var active := false
var sun: DirectionalLight3D      # Arena / Lighting read these from their parent, like from main.gd
var fighters: Dictionary = {}
var me: Fighter
var _cam: Camera3D
var _env: WorldEnvironment
var _arena: Arena
var _star: Fighter
var _map := ""
var _brawler := ""
var _random_pick := ""

func setup(cam: Camera3D, env: WorldEnvironment, light: DirectionalLight3D) -> void:
	_cam = cam
	_env = env
	sun = light

func set_active(on: bool) -> void:
	active = on
	if on:
		refresh()
	else:
		_clear()

# Rebuilds what changed (map: the whole arena; brawler: only the figure).
func refresh() -> void:
	if not active:
		return
	var key := Settings.map
	if not GameData.maps.has(key):
		if _random_pick == "" or not GameData.maps.has(_random_pick):
			var keys: Array = GameData.maps.keys()
			_random_pick = String(keys[randi() % keys.size()])
		key = _random_pick
	else:
		_random_pick = ""
	if key != _map or _arena == null:
		_clear()
		_map = key
		var data: Dictionary = GameData.maps[key]
		_arena = Arena.new()
		add_child(_arena)
		_arena.build(data)
		if _env and _env.environment:
			_env.environment.background_color = Color(data.swatch[1]) if data.get("sky", false) else Color("87c4e8")
	if Settings.brawler != _brawler or _star == null:
		if _star:
			_star.queue_free()
		_brawler = Settings.brawler
		_star = Fighter.new()
		add_child(_star)
		_star.setup({"id": "showcase", "name": "", "type": _brawler, "cos": Settings.cos_string()}, GameData.brawlers)
		_star.is_local = true
		me = _star
		fighters = {"showcase": _star}
		for n in ["_bar", "_label"]:
			var c = _star.get(n)
			if c is Node3D:
				(c as Node3D).visible = false
		_stage()

# The most open '.' tile near the middle (5x5 neighbourhood), like stageStar.
func _stage() -> void:
	var best := Vector2i(12, 12)
	var bs := -1
	for j in range(6, 19):
		for i in range(6, 19):
			if _arena.tile(i, j) != "." or _near(i, j, "M", 3):
				continue
			var open := 0
			for dj in range(-2, 3):
				for di in range(-2, 3):
					if _arena.tile(i + di, j + dj) == ".":
						open += 1
			if open > bs:
				bs = open
				best = Vector2i(i, j)
	var p := _arena.center(best.x, best.y)
	_star.position = p
	_star.target = p
	_star.rotation.y = 0.0
	if _cam:
		_cam.position = p + CAM_OFFSET
		_cam.look_at(Vector3(p.x, 0.5, p.z))

func _near(i: int, j: int, ch: String, r: int) -> bool:
	for dj in range(-r, r + 1):
		for di in range(-r, r + 1):
			if _arena.tile(i + di, j + dj) == ch:
				return true
	return false

func _clear() -> void:
	me = null
	fighters = {}
	if _star:
		_star.queue_free()
		_star = null
	if _arena:
		_arena.queue_free()
		_arena = null
	_map = ""
	_brawler = ""

func _process(delta: float) -> void:
	if active and _arena:
		_arena.update(delta)
