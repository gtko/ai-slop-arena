class_name FxDemo
extends Node
# Debug only (never in a normal run): plays attacks of chosen brawlers from your own brawler,
# purely visual (no server message), and saves a screenshot of each one, for side-by-side checks
# against the three.js build.
#   godot --path godot -- --autotest ws://127.0.0.1:8787 --secs=30 --fxdemo=blaster,blaster:s,volt --fxshot=/tmp/fx
#   -> /tmp/fx_blaster.png, /tmp/fx_blaster_s.png, /tmp/fx_volt.png
# --fxdir=1,0 sets the firing direction (x, z), default (1, 0.25).

# seconds between the attack and its screenshot (projectiles in flight / the super's big moment)
const AT := {"blaster": 0.2, "gunslinger": 0.3, "frostbite": 0.2, "volt": 0.2, "bomber": 0.55, "kappa": 0.55,
	"pipchomp": 0.15, "mochi": 0.2, "blaster:s": 0.2, "gunslinger:s": 0.45, "frostbite:s": 0.32, "volt:s": 0.75,
	"bomber:s": 0.45, "kappa:s": 0.3, "pipchomp:s": 0.2, "mochi:s": 0.6}

var fx: Fx
var items: PackedStringArray = []
var prefix := ""
var dir := Vector3(1, 0, 0.25)
var _t := -2.0   # wait a little once playing
var _i := 0
var _busy := false
var _fixed_dir := false

# The direction with the longest open lane from here (up to 11 m), so the shots fly in the open.
func _open_dir(p: Vector3) -> Vector3:
	var best := dir
	var best_l := -1.0
	for k in 24:
		var a := TAU * k / 24.0
		var d := Vector3(sin(a), 0, cos(a))
		var l := 0.0
		while l < 11.0 and GameData.MOVE_BLOCK.find(fx.arena.char_at(p.x + d.x * l, p.z + d.z * l)) < 0 and not fx.arena.is_bush(p.x + d.x * l, p.z + d.z * l):
			l += 0.5
		var score := l + 2.0 * d.z   # prefer shots toward the camera (away from the name plate)
		if score > best_l + 0.01:
			best_l = score
			best = d
	return best

func setup(fx_: Fx) -> void:
	fx = fx_
	for a in DebugArgs.list():
		if a.begins_with("--fxdemo="):
			items = a.substr(9).split(",", false)
		elif a.begins_with("--fxshot="):
			prefix = a.substr(9)
		elif a.begins_with("--fxdir="):
			var p := a.substr(8).split(",")
			dir = Vector3(float(p[0]), 0, float(p[1]))
			_fixed_dir = true
	if items.is_empty():
		items = ["blaster", "gunslinger", "bomber", "frostbite", "volt", "kappa", "pipchomp", "mochi"]
	dir = dir.normalized()

func _process(delta: float) -> void:
	var m := Quality.main_node()
	if m == null or int(m.get("state")) != 4 or _i >= items.size():
		return
	var me: Fighter = m.get("me")
	if me == null or not me.alive:
		return
	var touch = m.get("touch")
	if touch != null:
		touch.move = Vector2.ZERO   # stand still (the autotest walks otherwise)
	_t += delta
	if _t < 0.0 or _busy:
		return
	_t = -1.6
	_busy = true
	var item := items[_i]
	_i += 1
	var parts := item.split(":")
	var key := parts[0]
	if not _fixed_dir:
		dir = _open_dir(me.position)
	me.type = GameData.brawlers.get(key, me.type)
	m.set("aim_dir", Vector2(dir.x, dir.z))
	if touch != null:
		touch.aim = Vector2(dir.x, dir.z)   # the aim indicator shows (touch: only while aiming)
	var sup := parts.size() > 1 and parts[1] == "s"
	if parts.size() > 1 and parts[1].begins_with("g"):   # "volt:gB": the gadget B look
		me.gadget = "B" if parts[1] == "gB" else "A"
		fx.on_event({"e": "gad", "id": me.id, "dx": dir.x, "dz": dir.z})
	else:
		var e := {"e": "atk", "id": me.id, "dx": dir.x, "dz": dir.z, "px": me.position.x + dir.x * 7.0, "pz": me.position.z + dir.z * 7.0, "s": 1 if sup else 0}
		fx.on_event(e)
		me.play_once("super" if sup else "shoot")
	await get_tree().create_timer(float(AT.get(item, 0.2)), true, false, true).timeout
	if prefix != "":
		await RenderingServer.frame_post_draw
		var path := "%s_%s.png" % [prefix, item.replace(":", "_")]
		get_viewport().get_texture().get_image().save_png(path)
		var lit := []
		for c in fx.get_children():
			if c is OmniLight3D and c.visible:
				lit.append("%.1f/%.1f" % [c.light_energy, c.omni_range])
		print("FXDEMO shot ", path, " bullets=", fx.combat.bullets.size(), " bombs=", fx.combat.bombs.size(), " lights=", lit, " q=", Quality.name_now(), " emit=", fx._emit.map(func(e): return "%.1f" % e.i), " flashes=", fx._flashes.size())
	_busy = false
