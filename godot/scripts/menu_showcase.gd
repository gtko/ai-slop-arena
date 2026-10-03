extends Node3D
# The live match behind the home screen (the web's attract mode: src/main.js attract(), game.js
# mode 'attract'). The web runs a bot match on the map you picked (a random one for "Random"),
# starring your brawler: it cannot be knocked out, hunts from the first second, wears your looks,
# and the camera stays close on it (menu zoom 0.8, the focus gliding at 2.2 /s). 3 s after the last
# K.O. a new match starts; picking another brawler or map starts one at once. Its sounds play at
# 35 % (game.js volumeAt), the HUD stays hidden (no plates, no damage numbers).
#
# The Godot client has no rules, so it replays recordings of those very matches (the server's own
# 'snap' / 'ev' streams, tools/record-attract.mjs -> data/attract/) through the same nodes as a live
# match: Arena (kit, weather), Fighter (snapshot interpolation, animations), Fx / FxCombat, GasRing.
# Without a recording for the pick, the brawler stands on the most open ground near the middle.
# Battery saver: main.gd turns the whole backdrop off.

const AttractReplay := preload("res://scripts/attract_replay.gd")
const MENU_ZOOM := 0.8                            # game.js menuZoom
const GAS := {"startAt": 18.0, "interval": 6.0}   # game.js newMatch: the attract match's gas

# Your brawler in the replay: snapshots move it like any remote fighter, but it wears the local
# player's colours (blue ring and outline, your bullets' colours), like the web's star.
class StarFighter extends Fighter:
	func apply_row(x: float, z: float, f: float, h: float, mh: float, am: float, sup: float, cb: int, fl: int) -> void:
		is_local = false
		super.apply_row(x, z, f, h, mh, am, sup, cb, fl)
		is_local = true

	func _motion(delta: float) -> void:
		is_local = false
		super._motion(delta)
		is_local = true

var active := false
var sun: DirectionalLight3D      # Arena / Lighting read these from their parent, like from main.gd
var fighters: Dictionary = {}    # Arena, Kit, Fx read these (like main.gd's)
var me: Fighter
var arena: Arena                 # Fighter reads its parent's `arena` (bushes, footsteps)
var _arena: Arena                # (quality.gd looks for this one)
var _cam: Camera3D
var _env: WorldEnvironment
var _star: Fighter
var _map := ""
var _brawler := ""
var _fx: Fx
var _gas: GasRing
var _feel := Feel.new()          # camera shake of the backdrop (not the match's Feel.current)
var _focus := Vector3.ZERO
var _rec = null                  # AttractReplay playing
var _t := 0.0                    # replay clock (s)
var _si := 0                     # next snapshot
var _ei := 0                     # next event batch
var _last_path := ""

func setup(cam: Camera3D, env: WorldEnvironment, light: DirectionalLight3D) -> void:
	_cam = cam
	_env = env
	sun = light

func set_active(on: bool) -> void:
	if on == active:
		if on:
			refresh()
		return
	active = on
	if AudioManager.current:
		AudioManager.current.attract = on
	if on:
		refresh()
	else:
		_clear()

# A new pick (brawler or map) starts a new match (main.js showcaseAgain); otherwise nothing changes.
func refresh() -> void:
	if not active:
		return
	var want_map := Settings.map if GameData.maps.has(Settings.map) else ""
	var same_map := want_map == "" or want_map == _map
	if Settings.brawler == _brawler and same_map and _arena != null:
		return
	_start()

# main.js showcaseMap: the map you picked, else a random one (each new match).
func _pick_map() -> String:
	for a in DebugArgs.list():   # screenshots: --attractmap=marsh (the saved pick stays)
		if a.begins_with("--attractmap=") and GameData.maps.has(a.substr(13)):
			return a.substr(13)
	if GameData.maps.has(Settings.map):
		return Settings.map
	var keys: Array = GameData.maps.keys()
	return String(keys[randi() % keys.size()])

func _start() -> void:
	_clear()
	_brawler = Settings.brawler
	_map = _pick_map()
	var paths := AttractReplay.available(_map, _brawler)
	if paths.size() > 1:
		paths.erase(_last_path)   # not the same match twice in a row
	_rec = null
	if not paths.is_empty():
		var r = AttractReplay.new()
		var p: String = paths[randi() % paths.size()]
		if r.load_from(p) and not r.roster.is_empty():
			_rec = r
			_last_path = p
	var data: Dictionary = GameData.maps[_map]
	arena = Arena.new()
	_arena = arena
	add_child(arena)
	arena.build(data)
	if _env and _env.environment:
		_env.environment.background_color = Color(data.swatch[1]) if data.get("sky", false) else Color("87c4e8")
	if _rec == null:
		_static_star()
		return
	_fx = Fx.new()
	add_child(_fx)
	_fx.setup(arena, fighters, String(_rec.roster[0].id))
	var labels: Variant = _fx.get("_labels")   # no damage numbers: the menu has no HUD
	if labels is Array:
		for l in labels:
			if l is VisualInstance3D:
				(l as VisualInstance3D).layers = 0
	_gas = GasRing.new()
	add_child(_gas)
	_gas.setup(GAS)
	for k in _rec.roster.size():
		var row: Dictionary = (_rec.roster[k] as Dictionary).duplicate()
		var f: Fighter = StarFighter.new() if k == 0 else Fighter.new()
		if k == 0:
			row.cos = Settings.cos_string()   # your looks
			row.name = ""
		add_child(f)
		f.setup(row, GameData.brawlers)
		var sp: Vector3 = arena.spawns[int(row.get("spawn", k)) % arena.spawns.size()]
		f.position = sp
		f.target = sp
		_no_plates(f)
		fighters[String(row.id)] = f
		if k == 0:
			f.is_local = true
			_star = f
			me = f
	_t = float(_rec.snaps[0][0]) if not _rec.snaps.is_empty() else 0.0
	_si = 0
	_ei = 0
	_feel.reset()
	_feel.zoom = MENU_ZOOM
	_pump()   # the first snapshot: everyone where the match starts (stageStar put the star mid-map)
	for f in fighters.values():
		f.position = f.target
	_focus = _clamp_focus(_star.position)
	_place_camera(0.0)

func _no_plates(f: Fighter) -> void:
	for n in ["_bar", "_label"]:
		var c = f.get(n)
		if c is Node3D:
			(c as Node3D).visible = false

# No recording for this pick: your brawler stands on the most open '.' tile near the middle
# (5x5 neighbourhood), like stageStar, and nothing moves.
func _static_star() -> void:
	_star = Fighter.new()
	add_child(_star)
	_star.setup({"id": "showcase", "name": "", "type": _brawler, "cos": Settings.cos_string()}, GameData.brawlers)
	_star.is_local = true
	me = _star
	fighters = {"showcase": _star}
	_no_plates(_star)
	var best := Vector2i(12, 12)
	var bs := -1
	for j in range(6, 19):
		for i in range(6, 19):
			if arena.tile(i, j) != "." or _near(i, j, "M", 3):
				continue
			var open := 0
			for dj in range(-2, 3):
				for di in range(-2, 3):
					if arena.tile(i + di, j + dj) == ".":
						open += 1
			if open > bs:
				bs = open
				best = Vector2i(i, j)
	var p := arena.center(best.x, best.y)
	_star.position = p
	_star.target = p
	_star.rotation.y = 0.0
	_focus = p
	_feel.reset()
	_feel.zoom = MENU_ZOOM
	_place_camera(0.0)

func _near(i: int, j: int, ch: String, r: int) -> bool:
	for dj in range(-r, r + 1):
		for di in range(-r, r + 1):
			if arena.tile(i + di, j + dj) == ch:
				return true
	return false

func _clear() -> void:
	if _cam:
		_cam.v_offset = 0.0
	me = null
	_star = null
	for f in fighters.values():
		f.queue_free()
	fighters = {}
	if _fx:
		_fx.queue_free()
		_fx = null
	if _gas:
		_gas.queue_free()
		_gas = null
	if arena:
		arena.queue_free()
	arena = null
	_arena = null
	_rec = null
	_map = ""
	_brawler = ""

# ---------------------------------------------------------------- replay

# Everything the server sent up to the replay clock, in order (a batch of events goes out before
# the snapshot of the same tick, game.js netTick).
func _pump() -> void:
	var R = _rec
	while true:
		var te: float = R.evs[_ei][0] if _ei < R.evs.size() else INF
		var ts: float = R.snaps[_si][0] if _si < R.snaps.size() else INF
		if minf(te, ts) > _t:
			return
		if te <= ts:
			for e in R.evs[_ei][1]:
				_event(e)
			_ei += 1
		else:
			_snap(R.snaps[_si][1])
			_si += 1

# main.gd _apply_snap (the fog map's recording leaves out who the star cannot see)
func _snap(m: Dictionary) -> void:
	var seen := {}
	for r in m.b:
		var f: Fighter = fighters.get(r[0])
		if f == null:
			continue
		seen[r[0]] = true
		f.apply_row(r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9])
		f.hidden_by_server = false
	for id in fighters:
		if not seen.has(id) and fighters[id] != _star:
			fighters[id].hidden_by_server = true
	if _gas and (absf(_gas.timer - float(m.pt)) > 0.25):
		_gas.set_timer(float(m.pt))

# main.gd _apply_event + _feel_event + hud.gd on_event, for what the menu shows: no HUD, no
# result, no local player (the star is a bot of the recording).
func _event(e: Dictionary) -> void:
	var f: Fighter = fighters.get(str(e.get("id", "")))
	var A := AudioManager.current
	var kind := str(e.get("e", ""))
	arena.on_event(e)
	match kind:
		"atk":
			if f == null or not f.alive:
				return
			var sup := bool(e.get("s", false))
			if f.hidden_by_server:   # a shot from the fog (marsh): only what lands, no sound
				_fx.late_attack(e, 0.0, true)
				return
			f.face(float(e.get("dx", 0.0)), float(e.get("dz", 0.0)))
			f.attacked(sup)
			if A:
				A.play(("super_" if sup else "atk_") + String(f.type.key), f.position)
			if sup and String(f.type.key) == "blaster":
				_shake_at(f.position, 0.35)
		"kill":
			if f:
				if f.visible and A:
					A.play("death", f.position)
				f.alive = false
				var by: Fighter = fighters.get(str(e.get("by", "")))
				if by and by != f and by.alive:
					by.cheer()
					if by.visible and A:
						A.play("bark_%s_cheer" % String(by.type.key), by.position, 0.8)
				if f.visible:
					_shake_at(f.position, 0.3)
					if bool(e.get("f", false)) and A:
						A.play("fall", f.position)
		"win":
			if f:
				f.won = true
		"wall", "crate":
			arena.break_tile(int(e.i), int(e.j))
			if A:
				A.play("break" if kind == "wall" else "crate", Vector3((int(e.i) + 0.5) * GameData.TILE - GameData.HALF, 0.0, (int(e.j) + 0.5) * GameData.TILE - GameData.HALF))
	_fx.on_event(e)

# game.js shakeAt, on the backdrop's own camera
func _shake_at(p: Vector3, amount: float) -> void:
	var d2 := (p.x - _focus.x) * (p.x - _focus.x) + (p.z - _focus.z) * (p.z - _focus.z)
	_feel.add(amount / (1.0 + d2 / 120.0))

# ---------------------------------------------------------------- frame

func _clamp_focus(p: Vector3) -> Vector3:
	var lim := GameData.HALF
	return Vector3(clampf(p.x, -(lim - 9.0), lim - 9.0), 0.0, clampf(p.z, -(lim - 11.0), lim - 6.0))

# game.js updateCamera in attract mode: always on the star, at the menu zoom.
func _place_camera(delta: float) -> void:
	if _cam == null:
		return
	_feel.update(delta, MENU_ZOOM)
	var dist := _feel.zoom * _feel.punch
	var sh := _feel.shake()
	_cam.position = _focus + Lighting.CAM_OFFSET * dist + Vector3(sh.x, sh.y, sh.z)
	_cam.look_at(Vector3(_focus.x, 0.5, _focus.z))
	if sh.w != 0.0:
		_cam.rotate_object_local(Vector3(0, 0, 1), sh.w)
	_cam.v_offset = _frame_shift(Lighting.CAM_OFFSET.length() * dist)

# main.js frameShowcase: on the home screen the picture moves down by half the top navigation, so
# your brawler stands in the middle of the free space under it (the side panels leave the middle
# free already). Not behind the room screen. The match camera gets its offset back to 0 (_clear).
func _frame_shift(dist: float) -> float:
	var menu = get_parent().get("menu") if get_parent() else null
	if menu == null or not (menu as CanvasItem).visible:
		return 0.0
	var nav = menu.get("_nav")
	var frac := (float(nav) / 2.0 if nav != null else 32.0) / UiKit.css_view_h()
	return frac * 2.0 * dist * tan(deg_to_rad(_cam.fov / 2.0))

func _process(delta: float) -> void:   # timed for the perf overlay (perf_probe.gd)
	var t0 := PerfProbe.now()
	_process_timed(delta)
	PerfProbe.add("showcase", t0)

func _process_timed(delta: float) -> void:
	if not active or arena == null:
		return
	if _rec != null:
		_t += delta
		_pump()
		if _t >= _rec.dur:
			_start()   # game.js: a new match 3 s after the last K.O.
			return
		_focus = _focus.lerp(_clamp_focus(_star.position), 1.0 - exp(-2.2 * delta))
		if AudioManager.current:
			AudioManager.current.listener = _focus
	_place_camera(delta)
	arena.update(delta)
