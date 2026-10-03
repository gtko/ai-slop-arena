class_name Duo
extends Node3D
# Duo Showdown (game.js v0.14, "Buddy Revive") on the Godot client: 4 teams of 2 from the roster's
# `team`. The server runs the rules; this mirrors what the web's online client did with its events:
#   - teams: Fighter.team / Fighter.ally (green outline, ring and plate for your partner), no friendly
#     fire shown (fx_combat.gd lets a partner's shots through), "TEAMS LEFT" (hud.gd);
#   - knock-out with {gh: 1} (the partner still up, revives left): a ghost where it fell, for 15 s,
#     your team only (game.js duoKo / addGhost). The partner standing within 2.5 m of it for 3 s in all
#     brings it back (the server counts: {e:"rv", p} progress to the team, then {e:"revive"}, or the
#     brawler simply shows again in a snapshot); {e:"gone"} when time, the gas or the partner's own
#     K.O. ends it. Nothing to send for a revive: you walk there (main.gd sends your moves as usual);
#   - you knocked out: no result screen yet, the camera and the sight follow your partner and the
#     HUD says how long it has to revive you; revived, you play on (main.gd);
#   - the tether: a soft ribbon on the ground between you and your partner (green close, amber past
#     6 m), the partner card, the arrow to your partner (or its ghost) off screen, the ghost message
#     (hud_duo.gd), the touch ping button (touch_controls.gd).

const GHOST_TIME := 15.0
const REVIVE_TIME := 3.0
const REVIVE_R := 2.5
const REVIVES := 2
const GHOST_COL := Color(0.7, 2.4, 2.8)     # bright: it glows through fog and bloom (game.js addGhost)
const HALO_COL := Color(2.4, 2.0, 0.6)
const FILL_COL := Color(0.6, 3.0, 1.4)

var on := false
var ended := false
var fighters: Dictionary = {}
var me: Fighter
var mate: Fighter
var revives: Array = [REVIVES, REVIVES, REVIVES, REVIVES]   # left per team
var ghosts: Dictionary = {}   # fighter id -> {x, z, t, p, node, body, halo, fill, fill_n, mats}
var resync_me := false        # revived: take the server's position from the next snapshot
var main: Node
var audio: AudioManager
var arena: Arena
var _time := 0.0
var _tether: MeshInstance3D
var _tether_mat: ShaderMaterial
var log_events := false       # --duolog: print the Duo events (autotest)
var last_revive_ms := 0       # (autotest screenshots) when one of our team got back up

static func roster_is_duo(roster: Variant) -> bool:
	if not (roster is Array):
		return false
	for r in roster:
		if r is Dictionary and typeof(r.get("team", null)) in [TYPE_INT, TYPE_FLOAT]:
			return true
	return false

func _ready() -> void:
	log_events = DebugArgs.has("duolog")

func begin(roster: Array, fighters_: Dictionary, me_: Fighter, arena_: Arena) -> void:
	end()
	fighters = fighters_
	me = me_
	arena = arena_
	on = roster_is_duo(roster)
	if not on:
		return
	for r in roster:
		var f: Fighter = fighters.get(r.get("id", ""))
		var t = r.get("team", null)
		if f and typeof(t) in [TYPE_INT, TYPE_FLOAT]:
			f.team = int(t) & 3
	mate = mate_of(me)
	for f in fighters.values():
		f.ally = me != null and ally(f, me)
	revives = [REVIVES, REVIVES, REVIVES, REVIVES]
	_build_tether()
	if log_events:
		print("DUO begin me=%s team=%d mate=%s" % [me.id if me else "-", me.team if me else -1, mate.id if mate else "-"])

func end() -> void:
	for id in ghosts.keys():
		_remove_ghost(id)
	on = false
	ended = false
	mate = null
	me = null
	resync_me = false
	if _tether:
		_tether.queue_free()
		_tether = null
	var touch = main.get("touch") if main else null
	if touch:
		touch.ping_on = false

# ---------------------------------------------------------------- teams (game.js ally / mateOf / teamsUp)

func ally(a: Fighter, b: Fighter) -> bool:
	return on and a != null and b != null and a != b and a.team >= 0 and a.team == b.team

func mate_of(f: Fighter) -> Fighter:
	if not on or f == null:
		return null
	for o in fighters.values():
		if o != f and o.team == f.team:
			return o
	return null

func teams_up() -> int:
	var t := {}
	for f in fighters.values():
		if f.alive:
			t[f.team] = true
	return t.size()

# game.js sightViewer: you while alive, else your partner while it stands (null: not Duo / nobody).
func sight_viewer() -> Fighter:
	if not on or me == null:
		return null
	if me.alive:
		return me
	return mate if mate and mate.alive else null

# Knocked out with your partner still up: the camera follows it (game.js duoKo camTarget).
func cam_target() -> Fighter:
	return mate if on and me and not me.alive and mate and mate.alive else null

# You are out but your team is not: no result yet, you watch (and maybe get revived).
func waiting() -> bool:
	return on and me != null and not me.alive and mate != null and mate.alive and not ended

func my_ghost() -> Dictionary:
	return ghosts.get(me.id, {}) if me else {}

func ghost_of(f: Fighter) -> Dictionary:
	return ghosts.get(f.id, {}) if f else {}

# ---------------------------------------------------------------- events

# A K.O. (main.gd, before the fighter starts falling): the whole team out takes the partner's ghost
# with it; a K.O. with a ghost {gh: 1} leaves one, for your team only.
func on_kill(e: Dictionary, f: Fighter) -> void:
	if not on or f == null:
		return
	var rank := int(e.get("rank", 0))
	var m := mate_of(f)
	if rank > 0 and m:
		_remove_ghost(m.id)
	if int(e.get("gh", 0)) == 1 and (f == me or ally(f, me)):
		_add_ghost(f, int(e.get("f", 0)) == 1)
	if log_events:
		print("DUO kill %s rank=%d gh=%s mine=%s teams_up=%d" % [f.id, rank, e.get("gh", 0), f == me or ally(f, me), teams_up()])

func on_event(e: Dictionary) -> void:
	if not on:
		return
	var f: Fighter = fighters.get(str(e.get("id", "")))
	match str(e.get("e", "")):
		"rv":   # revive progress (the team only)
			if f and ghosts.has(f.id):
				ghosts[f.id].p = float(e.get("p", 0.0))
				if log_events:
					print("DUO rv %s p=%.2f" % [f.id, float(e.get("p", 0.0))])
		"gone":
			if f:
				_remove_ghost(f.id)
				if log_events:
					print("DUO gone %s" % f.id)
		"revive":
			if f and not f.alive:
				revive(f)
		"ping":   # game.js pingFx: the sound (hud.gd draws the marker)
			if f and audio and (f == me or ally(f, me)):
				audio.play("ping", null, 0.6 if f == me else 1.0)
		"win":
			ended = true
			for id in ghosts.keys():
				_remove_ghost(id)
			var w := f
			if w:   # game.js winners: the partner shares the win, the standing one dances
				var m := mate_of(w)
				if m and m.alive:
					m.won = true

# A snapshot row for a brawler we have as knocked out: it was revived (game.js applySnap).
func revived_in_snap(f: Fighter, x: float, z: float) -> void:
	if on and not ended and not f.alive:
		revive(f, Vector3(x, 0, z))

# Our own row in a snapshot, after a revive: the server's position (we were frozen at the ghost).
func after_snap(m: Dictionary) -> void:
	if not resync_me or me == null or not me.alive:
		return
	for r in m.get("b", []):
		if r[0] == me.id:
			me.position = Vector3(float(r[1]), 0, float(r[2]))
			resync_me = false
			return

# game.js revive: back where the ghost was (or where the server says), 40 % health; the ring, the
# sparks, the sound and "REVIVED!" for your team (an enemy you cannot see gets up unseen).
func revive(f: Fighter, at: Variant = null) -> void:
	if f == null or f.alive:
		return
	var G: Dictionary = ghosts.get(f.id, {})
	var mine := f == me or ally(f, me)
	var p: Vector3 = Vector3(G.x, 0, G.z) if not G.is_empty() else (at if at is Vector3 else f.position)
	_remove_ghost(f.id)
	if f.team >= 0:
		revives[f.team] = maxi(0, int(revives[f.team]) - 1)
	f.revive(p)
	if not mine:
		f.hidden_by_server = true   # shows when a snapshot does
	if f == me:
		resync_me = true
	if mine:
		last_revive_ms = Time.get_ticks_msec()
	if log_events:
		print("DUO revive %s at %s mine=%s revives_left=%s" % [f.id, p, mine, revives])
	if mine:
		var fx: Fx = Fx.current
		if fx:
			fx.ring(p, FILL_COL, 2.4, 0, 0.6)
			fx.spark_burst(p + Vector3(0, 1.2, 0), Color(0.8, 3.0, 1.6), 30, 7.0, 0.6)
		if audio:
			audio.play("revive")
		var hud = main.get("hud_ui") if main else null
		var plates = hud.get("_plates") if hud else null
		if plates:
			plates.floater(p + Vector3(0, 3.4, 0), 0.0, "power", "", I18n.t("hud.revived"))
	if f == me and main and main.has_method("_on_duo_revived"):
		main.call("_on_duo_revived")

# ---------------------------------------------------------------- ghosts (game.js addGhost / updateGhosts)

func _ghost_spot(f: Fighter, fell: bool) -> Vector3:
	var p := f.position
	if not fell or arena == null:
		return Vector3(p.x, 0, p.z)
	# a ring-out: the nearest ground (game.js groundNear)
	var i0 := arena.to_tile(p.x)
	var j0 := arena.to_tile(p.z)
	for r in range(0, 8):
		var best := Vector3.INF
		var bd := INF
		for j in range(j0 - r, j0 + r + 1):
			for i in range(i0 - r, i0 + r + 1):
				if maxi(absi(i - i0), absi(j - j0)) != r:
					continue
				if i < 0 or j < 0 or i >= GameData.N or j >= GameData.N:
					continue
				if not arena.is_land(i, j) or arena.blocks_move(i, j) or arena.tile(i, j) == "V":
					continue
				var c := arena.center(i, j)
				var d := Vector2(c.x - p.x, c.z - p.z).length()
				if d < bd:
					bd = d
					best = c
		if best != Vector3.INF:
			return best
	return Vector3(p.x, 0, p.z)

func _add_ghost(f: Fighter, fell: bool) -> void:
	_remove_ghost(f.id)
	var s := _ghost_spot(f, fell)
	var g := Node3D.new()
	g.position = s
	add_child(g)
	var body_m := FxLib.glow(GHOST_COL, 0.5)
	var body := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.42
	cap.height = 0.7 + 0.84
	body.mesh = cap
	body.material_override = body_m
	body.position.y = 1.5
	body.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(body)
	var halo_m := FxLib.glow(HALO_COL)
	var halo := MeshInstance3D.new()
	var tor := TorusMesh.new()   # TorusGeometry(0.34, 0.06)
	tor.inner_radius = 0.28
	tor.outer_radius = 0.40
	halo.mesh = tor
	halo.material_override = halo_m
	halo.position.y = 2.45
	halo.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(halo)
	var rim_m := FxLib.glow(GHOST_COL, 0.25, "mix", true)
	var rim := MeshInstance3D.new()
	rim.mesh = _arc_mesh(2.3, 2.5, 1.0)
	rim.material_override = rim_m
	rim.position.y = 0.07
	rim.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(rim)
	var fill_m := FxLib.glow(FILL_COL, 0.9, "mix", true, 1)
	var fill := MeshInstance3D.new()
	fill.material_override = fill_m
	fill.position.y = 0.075
	fill.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(fill)
	ghosts[f.id] = {"x": s.x, "z": s.z, "t": GHOST_TIME, "p": 0.0, "node": g, "body": body, "halo": halo, "fill": fill,
		"fill_n": -1, "body_m": body_m}
	if audio:
		audio.play("ghost", null, 0.8 if f == me else 1.0)

func _remove_ghost(id: String) -> void:
	var G: Dictionary = ghosts.get(id, {})
	if G.is_empty():
		return
	ghosts.erase(id)
	if is_instance_valid(G.node):
		G.node.queue_free()

# A flat ring (RingGeometry(r0, r1, 48)) from angle 0 over `frac` of the turn (the revive fill).
static func _arc_mesh(r0: float, r1: float, frac: float) -> ArrayMesh:
	var n := maxi(1, int(round(48.0 * frac)))
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in n:
		var a0 := TAU * k / 48.0
		var a1 := TAU * (k + 1) / 48.0
		var i0 := Vector3(cos(a0), 0, -sin(a0)) * r0
		var o0 := Vector3(cos(a0), 0, -sin(a0)) * r1
		var i1 := Vector3(cos(a1), 0, -sin(a1)) * r0
		var o1 := Vector3(cos(a1), 0, -sin(a1)) * r1
		for p in [i0, o0, o1, i0, o1, i1]:
			st.set_normal(Vector3.UP)
			st.add_vertex(p)
	return st.commit()

func _process(delta: float) -> void:
	if not on:
		return
	_time += delta
	for id in ghosts.keys():
		var G: Dictionary = ghosts[id]
		G.t -= delta
		if G.t < -3.0:   # the server's "gone" never came
			_remove_ghost(id)
			continue
		var body: MeshInstance3D = G.body
		body.position.y = 1.5 + sin(_time * 2.6) * 0.12
		(G.halo as MeshInstance3D).rotation.y += delta * 2.0
		var a := 0.5
		if G.t < 4.0:   # flickers in its last seconds
			a = 0.2 + 0.3 * (1.0 if sin(_time * 14.0) > 0.0 else 0.0)
		FxLib.set_alpha(G.body_m, a)
		var n := int(floor(clampf(G.p / REVIVE_TIME, 0.0, 1.0) * 48.0))
		if n != G.fill_n:
			G.fill_n = n
			(G.fill as MeshInstance3D).mesh = _arc_mesh(2.25, 2.55, n / 48.0) if n > 0 else null
	_update_tether()
	var touch = main.get("touch") if main else null
	if touch:
		touch.ping_on = true

func _exit_tree() -> void:
	end()

# ---------------------------------------------------------------- tether (game.js buildTether / updateTether)

func _build_tether() -> void:
	_tether = MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(1.0, 0.14)
	_tether.mesh = pm
	_tether_mat = FxLib.glow(Color("2fd36b").srgb_to_linear(), 0.35, "mix", true, 1)
	_tether.material_override = _tether_mat
	_tether.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_tether.visible = false
	add_child(_tether)

func _update_tether() -> void:
	if _tether == null:
		return
	var show := me != null and me.alive and mate != null and mate.alive and mate.visible and not ended
	var d := 0.0
	var dx := 0.0
	var dz := 0.0
	if show:
		dx = mate.position.x - me.position.x
		dz = mate.position.z - me.position.z
		d = Vector2(dx, dz).length()
		show = d >= 1.4
	_tether.visible = show
	if not show:
		return
	_tether.position = Vector3((me.position.x + mate.position.x) * 0.5, 0.05, (me.position.z + mate.position.z) * 0.5)
	_tether.rotation = Vector3(0, atan2(-dz, dx), 0)
	_tether.scale = Vector3(d - 1.2, 1, 1)
	var col := Color("ffc23a") if d > 6.0 else Color("2fd36b")
	FxLib.set_col(_tether_mat, col.srgb_to_linear(), 0.2 + 0.15 * minf(1.0, d / 6.0))

func tether_shown() -> bool:
	return _tether != null and _tether.visible
