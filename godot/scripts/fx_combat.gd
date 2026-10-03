class_name FxCombat
extends Node3D
# The look of every attack and super, a port of the visual half of src/combat.js. The server owns
# the rules (damage, K.O.s); like the web clients, this replays each 'atk' event locally: the same
# bullets (count, spread, speed, range, size, colour), stopped by walls, crates and brawlers, the
# lobbed fireballs / bubbles, the meteor, the storm, the nova, the wave, the pound, the bump.
#
# Colours (combat.js COL): your own shots wear your brawler's colour, everybody else's are red-orange
# (supers: gold), HDR so they bloom; a light from the light pool rides along each bullet.

const BULLET_Y := 1.15
const COL := {
	"player": Color(0.45, 2.6, 4.2), "enemy": Color(4.2, 0.9, 0.35), "super": Color(4.2, 3.1, 0.6),
	"ice": Color(1.6, 3.4, 4.6), "volt": Color(1.2, 4.2, 4.6), "seed": Color(0.75, 1.9, 0.3),
	"ray": Color(2.6, 1.5, 4.8), "bubble": Color(1.1, 2.6, 3.6),
}
const ICE_LIGHT := Color(0.55, 0.85, 1.0)
const BOLT := Color(3.2, 4.2, 5.2)
const WALL_SPARK := Color(2.5, 2.0, 1.4)
# gadgets.js colours
const YELLOW := Color(3.2, 2.6, 0.6)
const G_ICE := Color(1.4, 2.8, 3.6)
const ZAP := Color(2.2, 3.4, 4.6)
const LAVA := Color(3.4, 1.2, 0.2)
const BARK := Color(1.6, 1.1, 0.5)
const PINK := Color(3.4, 1.4, 2.4)
const WATER := Color(0.8, 2.2, 3.4)

var fx: Fx
var bullets: Array = []
var bombs: Array = []
var strikes: Array = []
var zones: Array = []
var windups: Array = []
var waves: Array = []
var marks: Array = []
var bursts: Array = []     # Gunslinger volleys [{f, t, a, sup}]
var later: Array = []      # [time, Callable]
var fuse_next: Dictionary = {}   # Bomber's Fuse Cut: the next fireball flies 40 % faster
# Seconds an attack is replayed late (fx.gd late_attack: main.gd held it while the server hid the
# shooter): its bullets start that much further along, its fireball / volley / wind-up that far in.
var lead := 0.0
var _pool: Dictionary = {}       # shape -> spare bullet meshes
var _mats: Dictionary = {}       # colour key -> bullet material
var _rng := RandomNumberGenerator.new()
var _rock_mat: StandardMaterial3D
var _flame_mat: ShaderMaterial
var _bubble_mat: StandardMaterial3D
var _shine_mat: ShaderMaterial

func setup(fx_: Fx) -> void:
	fx = fx_
	_rng.randomize()
	_rock_mat = StandardMaterial3D.new()
	_rock_mat.albedo_color = Color("3a2a24")
	_rock_mat.roughness = 0.85
	_rock_mat.emission_enabled = true
	_rock_mat.emission = Color("ff5a14")
	_rock_mat.emission_energy_multiplier = 0.8
	_flame_mat = FxLib.glow(Color(1.6, 0.6, 0.12), 0.3, "add")
	_bubble_mat = StandardMaterial3D.new()
	_bubble_mat.albedo_color = Color(Color("bfe9ff"), 0.55)
	_bubble_mat.roughness = 0.05
	_bubble_mat.metallic = 0.1
	_bubble_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_bubble_mat.emission_enabled = true
	_bubble_mat.emission = Color("2a6f9a")
	_bubble_mat.emission_energy_multiplier = 0.6
	_bubble_mat.rim_enabled = true
	_bubble_mat.rim = 0.8
	_shine_mat = FxLib.glow(Color(3, 3, 3))

func rnd(a: float, b: float) -> float:
	return a + _rng.randf() * (b - a)

func _now() -> float:
	return fx.time

func color_for(f: Fighter, sup: bool) -> Color:
	var k := String(f.type.key)
	if not sup:
		if not f.is_local and k in ["blaster", "gunslinger", "frostbite", "volt"]:
			return COL.enemy
		match k:
			"blaster": return COL.seed
			"gunslinger": return COL.ray
			"frostbite": return COL.ice
			"volt": return COL.volt
	return COL.super if sup else (COL.player if f.is_local else COL.enemy)

# ---------------------------------------------------------------- attack (combat.attack)

func attack(f: Fighter, d: Vector3, point: Vector3, sup: bool) -> void:
	if not f.alive:
		return
	if d.length() < 1e-4:
		d = Vector3(sin(f.rotation.y), 0, cos(f.rotation.y))
	d = d.normalized()
	var T := String(f.type.key)
	var base := atan2(d.x, d.z)
	var col := color_for(f, sup)
	var m := f.position + d * 0.9
	var muzzle_p := Vector3(m.x, BULLET_Y, m.z)
	var vis := _shows(f)
	match T:
		"blaster":
			var n := 9 if sup else 5
			var spread := 0.72 if sup else 0.52
			for k in n:
				var a := base + (float(k) / (n - 1) - 0.5) * spread + rnd(-0.03, 0.03)
				_bullet(f, m.x, m.z, a, {"speed": rnd(24, 27), "range": 11.0 if sup else 9.5, "r": 0.25 if sup else 0.2,
					"big": sup, "emit": k % 2 == 0, "col": col, "shape": "seed"})
			if vis:
				fx.muzzle(muzzle_p, d, col)
		"gunslinger":
			var n := 12 if sup else 6
			for k in n:
				bursts.append({"f": f, "t": k * (0.055 if sup else 0.075) - lead, "a": base, "sup": sup})
		"frostbite":
			if sup:
				_windup(f, 0.2, 6.25 if f.has_star("permafrost") else 5.0, COL.ice, func(): _nova(f))   # Permafrost: +25 %
				return
			for k in [-1, 0, 1]:
				_bullet(f, m.x, m.z, base + k * 0.11, {"speed": 21.0, "range": 12.0, "r": 0.21, "big": false, "emit": k == 0, "col": col})
			if vis:
				fx.muzzle(muzzle_p, d, col)
		"pipchomp":
			if sup:
				return   # the trap: kit.gd draws it from the server's 'kit' event
			if vis:
				fx.dust(f.position.x, f.position.z, 6, Color("6a9a4a"), 0.8)
		"mochi":
			if sup:
				_pound(f, point)
			else:
				_bump(f, d)
		"volt":
			if sup:
				_storm(f, point)
				return
			_bullet(f, m.x, m.z, base, {"speed": 26.0, "range": 13.0, "r": 0.3, "big": false, "emit": true, "col": col})
			if vis:
				fx.muzzle(muzzle_p, d, col)
		_:
			if T == "kappa" and sup:
				_wave(f, d)
				return
			_lob(f, d, point, sup, T == "kappa")

# Is the shooter on screen: you, or a brawler the server shows us (up to date even before the
# fighter's own _process refreshes `visible`).
func _shows(f: Fighter) -> bool:
	return f.is_local or (f.alive and not f.hidden_by_server)

func _bullet(owner: Fighter, x: float, z: float, a: float, o: Dictionary) -> void:
	var go := 0.0
	if lead > 0.0:   # a late replay: the bullet is already that far along, unless a wall stopped it
		go = minf(float(o.speed) * lead, float(o.range))
		var A := fx.arena
		var s := 0.0
		while A and s < go:
			s = minf(s + 0.35, go)
			var ch := A.char_at(x + sin(a) * s, z + cos(a) * s)
			if ch == "X" or ch == "T" or ch == "G" or (ch == "#" and not o.get("big", false)) or _is_crate(ch):
				return
		if go >= float(o.range):
			return
		x += sin(a) * go
		z += cos(a) * go
	var shape: String = o.get("shape", "ball")
	var mi := _mesh_for(shape, o.col)
	var r: float = o.r
	match shape:
		"seed": mi.scale = Vector3.ONE * r * 1.15
		"ray": mi.scale = Vector3(r * 0.9, r * 0.9, r * 5.0)
		_: mi.scale = Vector3(r, r, r * 2.6)
	mi.rotation = Vector3(0, a, 0)
	mi.position = Vector3(x, BULLET_Y, z)
	var c: Color = o.col
	var mx := maxf(c.r, maxf(c.g, c.b))
	o.merge({"x": x, "z": z, "dx": sin(a), "dz": cos(a), "travel": go, "owner": owner, "mesh": mi, "shape": shape,
		"lcol": Color(c.r / mx, c.g / mx, c.b / mx)})
	bullets.append(o)

func _mesh_for(shape: String, col: Color) -> MeshInstance3D:
	var key := "%.2f_%.2f_%.2f" % [col.r, col.g, col.b]
	var mat: ShaderMaterial = _mats.get(key)
	if mat == null:
		mat = FxLib.glow(col)
		_mats[key] = mat
	var list: Array = _pool.get(shape, [])
	var mi: MeshInstance3D = list.pop_back() if list.size() else null
	if mi == null:
		mi = MeshInstance3D.new()
		mi.mesh = FxLib.seed_mesh() if shape == "seed" else FxLib.sphere(1.0, 12, 8)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		add_child(mi)
	mi.material_override = mat
	mi.visible = true
	return mi

func _release(B: Dictionary) -> void:
	var mi: MeshInstance3D = B.mesh
	mi.visible = false
	if not _pool.has(B.shape):
		_pool[B.shape] = []
	_pool[B.shape].append(mi)

# An attack whose shooter the server still hides from us (fx.gd late_attack), `late` seconds after
# it was thrown. Where the shooter stands is unknown here (its last seen spot, or its spawn), so its
# bullets, volleys, bumps, bites, nova and wave are left out: drawn from that spot they would fly out
# of empty ground, or give away a brawler hiding in a bush. What lands where it aimed still shows,
# since that comes to you: the meteor and the storm, the Pound mark, and a fireball or bubble on its
# way down (the aim point is the landing spot when it is in range, as the server's combat.js clamps).
func attack_blind(f: Fighter, d: Vector3, point: Vector3, sup: bool, late: float) -> void:
	if not f.alive:
		return
	if d.length() < 1e-4:
		return
	d = d.normalized()
	var T := String(f.type.key)
	var lob := T == "bomber" or (T == "kappa" and not sup)
	if not (lob or (sup and (T == "volt" or T == "mochi"))):
		return
	var R := float(f.type.range)
	lead = late
	if lob:   # thrown from 3/4 of its range back along the aim: the arc's way down lands on the point
		_lob(f, d, point, sup, T == "kappa", point - d * clampf(R * 0.75, 2.0, R))
	elif T == "volt":
		_storm(f, point, point - d * 0.5)
	else:
		_pound(f, point, point - d * 0.5)
	lead = 0.0

# Bomber fireball / meteor and Kappa's bubble: lobbed to the aim point (clamped 2 m .. range).
func _lob(f: Fighter, d: Vector3, point: Vector3, sup: bool, bubble: bool, at := Vector3.INF) -> void:
	var o := f.position if at == Vector3.INF else at
	var R := float(f.type.range)
	var t := point - o
	t.y = 0
	var dist := t.length()
	if dist < 1e-3:
		t = d
		dist = 1.0
	var cd := clampf(dist, 2.0, R)
	var tx := o.x + t.x / dist * cd
	var tz := o.z + t.z / dist * cd
	var ux := (tx - o.x) / cd
	var uz := (tz - o.z) / cd
	var mx := o.x + d.x * 0.9
	var mz := o.z + d.z * 0.9
	var g := Node3D.new()
	var core := MeshInstance3D.new()
	var flame: MeshInstance3D = null
	if bubble:
		core.mesh = FxLib.sphere(0.34, 18, 12)
		core.material_override = _bubble_mat
		core.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var shine := MeshInstance3D.new()
		shine.mesh = FxLib.sphere(1.0, 12, 8)
		shine.material_override = _shine_mat
		shine.scale = Vector3.ONE * 0.07
		shine.position = Vector3(-0.12, 0.14, 0.2)
		g.add_child(core)
		g.add_child(shine)
	else:
		core.mesh = FxLib.rock_mesh(0.62 if sup else 0.3, 0.35 if sup else 0.3)
		core.material_override = _rock_mat
		flame = MeshInstance3D.new()
		flame.mesh = FxLib.ico(2)
		flame.material_override = _flame_mat
		flame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		flame.scale = Vector3.ONE * (0.78 if sup else 0.4)
		g.add_child(core)
		g.add_child(flame)
	add_child(g)
	var fuse: bool = not sup and fuse_next.get(f.id, false)
	if not sup:
		fuse_next.erase(f.id)
	var B := {"sx": tx - ux * 4.0 if sup else mx, "sz": tz - uz * 4.0 if sup else mz, "sy": 12.0 if sup else 1.6,
		"tx": tx, "tz": tz, "t": 0.0, "dur": (0.5 + (cd / R) * 0.35) * (0.6 if fuse else 1.0), "h": 2.6 + cd * 0.22,
		"radius": 1.6 if bubble else (3.6 if sup else (2.4 if f.has_star("bigBang") else 2.0)), "owner": f, "sup": sup, "mesh": g, "core": core, "flame": flame,
		"spin": 1.0 if bubble else rnd(6, 12), "fx": Vector3(mx, 1.6, mz), "bubble": bubble, "shadow": null,
		"blind": at != Vector3.INF and not sup}
	B.t = lead / B.dur
	g.position = Vector3(B.sx, B.sy, B.sz)
	g.visible = not B.blind
	bombs.append(B)

# ---------------------------------------------------------------- per frame

func _process(dt: float) -> void:
	var now := _now()
	var k := later.size() - 1
	while k >= 0:
		if later[k][0] <= now:
			var cb: Callable = later[k][1]
			later.remove_at(k)
			cb.call()
		k -= 1
	_update_bursts(dt)
	_update_bullets(dt)
	_update_bombs(dt)
	_update_strikes(dt)
	_update_zones(dt)
	_update_windups(dt)
	_update_waves(dt)
	for B in bullets:
		if B.emit:
			fx.emit_light(Vector3(B.x, BULLET_Y + 0.2, B.z), B.lcol, 12.0 if B.big else 8.0, 6.5)
	for B in bombs:
		if not (B.mesh as Node3D).visible:
			continue
		fx.emit_light(B.fx, Color(0.4, 0.8, 1.0) if B.bubble else Color(1.0, 0.55, 0.2), 7.0 if B.sup else 5.0, 6.0 if B.sup else 5.0)

func _update_bursts(dt: float) -> void:
	var k := 0
	while k < bursts.size():
		var s: Dictionary = bursts[k]
		var f: Fighter = s.f
		if not is_instance_valid(f) or not f.alive:
			bursts.remove_at(k)
			continue
		s.t -= dt
		if s.t > 0.0:
			k += 1
			continue
		bursts.remove_at(k)
		var still := f.has_star("steadyAim") and Vector2(f.vel.x, f.vel.z).length() < 0.8   # Steady Aim: half the spread
		var a: float = s.a + rnd(-0.035, 0.035) * (0.5 if still else 1.0)
		var dx := sin(a)
		var dz := cos(a)
		var col := color_for(f, s.sup)
		var mx := f.position.x + dx * 0.9
		var mz := f.position.z + dz * 0.9
		lead = -float(s.t)
		_bullet(f, mx, mz, a, {"speed": 32.0, "range": 20.0 if s.sup else 16.0, "r": 0.17, "big": s.sup, "emit": true, "col": col, "shape": "ray"})
		lead = 0.0
		f.aim_facing = a   # FEEL (combat.js volley): each bolt turns the arms, kicks your camera, has its sound
		f.aim_hold = 0.3
		if not s.sup:
			f.attacked(false)
		if f.is_local:
			Feel.kick(0.03)
		if f.visible:
			_sfx("shot_ray", f.position)
		if f.visible:
			fx.muzzle(Vector3(mx, BULLET_Y, mz), Vector3(dx, 0, dz), col)

func _is_crate(c: String) -> bool:
	return c == "C" or c == "E"

func _update_bullets(dt: float) -> void:
	var A := fx.arena
	var i := bullets.size() - 1
	while i >= 0:
		var B: Dictionary = bullets[i]
		var remaining: float = B.speed * dt
		var dead := false
		while remaining > 0.0 and not dead:
			var st := minf(0.35, remaining)
			remaining -= st
			B.x += B.dx * st
			B.z += B.dz * st
			B.travel += st
			var c := A.char_at(B.x, B.z) if A else "."
			var back := Vector3(B.x - B.dx * 0.3, BULLET_Y, B.z - B.dz * 0.3)
			if c == "X" or c == "T" or c == "G" or (c == "#" and not B.big):
				dead = true
				fx.spark_burst(back, WALL_SPARK, 5, 4, 0.25, 0.12)
				_splinter(B)
			elif c == "#":
				B.travel += 1.2   # a super goes through (the server breaks the wall)
			elif _is_crate(c):
				dead = true
				fx.hit(Vector3(B.x, BULLET_Y, B.z), B.col)
			if dead:
				break
			for o in fx.fighters.values():
				var fo: Fighter = o
				if fo == B.owner or not fo.alive or not fo.visible:
					continue
				if fo.team >= 0 and B.owner is Fighter and fo.team == (B.owner as Fighter).team:
					continue   # Duo: partners' shots fly through each other (game.js hits / ally)
				var rr: float = fo.radius + B.r
				var ddx: float = fo.position.x - B.x
				var ddz: float = fo.position.z - B.z
				if ddx * ddx + ddz * ddz < rr * rr:
					fx.hit(Vector3(B.x, BULLET_Y, B.z), B.col, Vector3(B.dx, 0, B.dz))
					dead = true
					break
			if not dead and B.travel >= B.range:
				dead = true
				if c == "W":
					fx.splash(B.x, B.z, 0.45)
				else:
					fx.spark_burst(Vector3(B.x, BULLET_Y, B.z), B.col, 3, 2, 0.2, 0.1)
		if dead:
			_release(B)
			bullets.remove_at(i)
		else:
			var mi: MeshInstance3D = B.mesh
			mi.position = Vector3(B.x, BULLET_Y, B.z)
			if B.shape == "seed":
				mi.rotate_object_local(Vector3.RIGHT, dt * 16.0)
		i -= 1

# Blaster's Splinters (combat.js splinter): a seed that hits a wall bursts into 2 shards bouncing back.
func _splinter(B: Dictionary) -> void:
	var o = B.owner
	if B.shape != "seed" or B.get("shard", false) or not is_instance_valid(o) or not (o as Fighter).has_star("splinters"):
		return
	var back := atan2(-float(B.dx), -float(B.dz))
	for s in [-0.5, 0.5]:
		_bullet(o, float(B.x) - float(B.dx) * 0.4, float(B.z) - float(B.dz) * 0.4, back + s + rnd(-0.1, 0.1),
			{"speed": 20.0, "range": 3.0, "r": 0.14, "big": false, "emit": false, "col": B.col, "shape": "seed", "shard": true})

func _update_bombs(dt: float) -> void:
	var i := bombs.size() - 1
	while i >= 0:
		var B: Dictionary = bombs[i]
		B.t += dt / B.dur
		var k := minf(B.t, 1.0)
		var x: float
		var y: float
		var z: float
		if B.sup:   # meteor: straight dive, accelerating
			var e := k * k
			x = B.sx + (B.tx - B.sx) * e
			z = B.sz + (B.tz - B.sz) * e
			y = B.sy + (0.35 - B.sy) * e
		else:       # lobbed arc
			x = B.sx + (B.tx - B.sx) * k
			z = B.sz + (B.tz - B.sz) * k
			y = B.sy + (0.35 - B.sy) * k + 4.0 * B.h * k * (1.0 - k)
		var g: Node3D = B.mesh
		g.position = Vector3(x, y, z)
		B.fx = Vector3(x, y + 0.4, z)
		if B.blind:   # thrown by a brawler we cannot see: only its way down shows, no trail before
			g.visible = k >= 0.5
			if not g.visible:
				if B.t >= 1.0:
					_explode(B)
					g.queue_free()
					bombs.remove_at(i)
				i -= 1
				continue
		var core: MeshInstance3D = B.core
		var size := 0.78 if B.sup else 0.4
		if B.bubble:   # a wobbling bubble, no fire
			var w := sin(B.t * 30.0) * 0.08
			core.scale = Vector3(1.0 + w, 1.0 - w, 1.0)
			if B.t >= 1.0:
				_explode(B)
				g.queue_free()
				bombs.remove_at(i)
			i -= 1
			continue
		core.rotation.x += B.spin * dt
		core.rotation.z += B.spin * 0.4 * dt
		(B.flame as MeshInstance3D).scale = Vector3.ONE * size * (1.0 + sin(B.t * 40.0) * 0.08)
		if B.sup:   # the meteor's shadow grows where it will land
			if B.shadow == null:
				var sh := MeshInstance3D.new()
				sh.mesh = FxLib.disc_mesh()
				sh.material_override = FxLib.glow(Color("1a0a06").srgb_to_linear(), 0.0, "mix", true, 1)
				sh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				sh.position = Vector3(B.tx, 0.06, B.tz)
				add_child(sh)
				B.shadow = sh
			B.shadow.scale = Vector3.ONE * B.radius * (0.3 + 0.7 * k)
			FxLib.set_alpha(B.shadow.material_override, 0.15 + 0.4 * k)
		# flame trail and a little smoke
		for n in (3 if B.sup else 1):
			var hot := _rng.randf()
			fx.fire.spawn(Vector3(x + rnd(-0.3, 0.3) * size, y + rnd(-0.3, 0.3) * size, z + rnd(-0.3, 0.3) * size),
				Vector3(rnd(-0.6, 0.6), rnd(0.4, 1.6), rnd(-0.6, 0.6)), rnd(0.15, 0.28), rnd(0.5, 0.8) * size,
				Color(1.6 + hot * 1.2, 0.45 + hot * 0.7, 0.08 + hot * 0.15), {"drag": 3.0, "grow": 0.3, "shrink": 0.9, "fade": true})
		if _rng.randf() < (0.5 if B.sup else 0.25) * FxLib.k():
			fx.smoke.spawn(Vector3(x, y + 0.2, z), Vector3(rnd(-0.4, 0.4), rnd(0.6, 1.4), rnd(-0.4, 0.4)), rnd(0.5, 0.8), size * 0.8,
				Color(0.3, 0.28, 0.27), {"drag": 2.0, "grow": 1.4, "shrink": 0.4})
		if B.t >= 1.0:
			_explode(B)
			g.queue_free()
			if B.shadow:
				B.shadow.queue_free()
			bombs.remove_at(i)
		i -= 1

func _explode(B: Dictionary) -> void:
	var x: float = B.tx
	var z: float = B.tz
	var wet := fx.arena != null and fx.arena.char_at(x, z) == "W"
	if B.bubble:   # Kappa's bubble pops
		fx.splash(x, z, 1.2)
		fx.ring(Vector3(x, 0, z), COL.bubble, B.radius, 0, 0.4)
		_sfx("bubble_pop", Vector3(x, 0, z))   # FEEL
		return
	fx.explosion(x, z, B.radius, B.sup, wet)
	Feel.shake_at(x, z, 0.9 if B.sup else 0.5)   # FEEL (combat.js explode)
	_sfx("boom_big" if B.sup else "boom", Vector3(x, 0, z))

# ---------------------------------------------------------------- supers and melee

# A ring grows under the caster for `time` seconds, then fn().
func _windup(f: Fighter, time: float, r: float, col: Color, fn: Callable) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = FxLib.disc_mesh()
	mi.material_override = FxLib.glow(col, 0.0, "add", true, 1)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = _shows(f)
	add_child(mi)
	windups.append({"f": f, "t": time - lead, "T": time, "r": r, "mesh": mi, "fn": fn})

func _update_windups(dt: float) -> void:
	var i := windups.size() - 1
	while i >= 0:
		var W: Dictionary = windups[i]
		var k: float = 1.0 - maxf(0.0, W.t) / W.T
		var f: Fighter = W.f
		var mi: MeshInstance3D = W.mesh
		if is_instance_valid(f):
			mi.position = Vector3(f.position.x, 0.08, f.position.z)
		mi.scale = Vector3.ONE * W.r * (0.25 + 0.75 * k)
		FxLib.set_alpha(mi.material_override, 0.2 + 0.35 * k)
		W.t -= dt
		if W.t <= 0.0:
			mi.queue_free()
			windups.remove_at(i)
			if is_instance_valid(f) and f.alive:
				(W.fn as Callable).call()
		i -= 1

# Frostbite super: ring of frost around him.
func _nova(f: Fighter) -> void:
	var R := 6.25 if f.has_star("permafrost") else 5.0
	var p := f.position
	fx.ring(p, Color(1.2, 2.6, 3.4), R, 0, 0.55)
	fx.ring(p, Color(2, 3.4, 4), R * 0.6, 0, 0.4)
	fx.spark_burst(p + Vector3(0, 1, 0), COL.ice, 60, 13, 0.7, 0.2)
	fx.flash(p + Vector3(0, 2, 0), ICE_LIGHT, 220, 18, 0.5)
	Feel.shake_at(p.x, p.z, 0.45)   # FEEL (combat.js nova)
	_sfx("super", p)
	_sfx("break", p, 0.6)

# Volt super: 5 bolts on a deterministic spiral around the target point.
func _storm(f: Fighter, point: Vector3, at := Vector3.INF) -> void:
	var o := f.position if at == Vector3.INF else at
	var R := float(f.type.range)
	var d := point - o
	d.y = 0
	var dl := maxf(d.length(), 1e-3)
	var cd := minf(dl, R)
	var cx := o.x + d.x / dl * cd
	var cz := o.z + d.z / dl * cd
	var n := 7 if f.has_star("surge") else 5   # Surge: 7 lighter bolts
	for k in n:
		var a := k * 2.39996
		var r := 2.8 * sqrt((k + 0.5) / n)
		strikes.append({"t": 0.18 + k * 0.2 - lead, "x": cx + cos(a) * r, "z": cz + sin(a) * r})
	fx.ring(Vector3(cx, 0, cz), Color(1.5, 3, 4), 3.2, 0, 1.1)

func _update_strikes(dt: float) -> void:
	var i := strikes.size() - 1
	while i >= 0:
		var S: Dictionary = strikes[i]
		S.t -= dt
		if S.t <= 0.0:
			strikes.remove_at(i)
			var x: float = S.x
			var z: float = S.z
			fx.bolt(x, z, BOLT)
			fx.spark_burst(Vector3(x, 0.3, z), BOLT, 26, 9, 0.5, 0.16)
			fx.flash(Vector3(x, 3, z), Color(0.75, 0.9, 1), 320, 16, 0.35)
			fx.ring(Vector3(x, 0, z), Color(2, 3.5, 4.5), 1.8, 0, 0.35)
			Feel.shake_at(x, z, 0.35)   # FEEL (combat.js storm strike)
			_sfx("boom", Vector3(x, 0, z), 0.7)
			_sfx("thunder2", Vector3(x, 0, z), 0.5)
			if fx.arena and fx.arena.char_at(x, z) == "W":
				fx.splash(x, z, 1.0)
			else:
				fx.scorch(x, z, 1.2)
		i -= 1

# Mochi belly bump: 3 jelly rings in front.
func _bump(f: Fighter, d: Vector3) -> void:
	for k in 3:
		var cb := func():
			if not is_instance_valid(f) or not f.alive or not f.visible:
				return
			fx.ring(f.position + d * (1.2 + k * 0.8), Color(3.2, 1.6, 2.2), 1.1 + k * 0.5, 0, 0.3)
		later.append([_now() + k * 0.12, cb])

# Mochi Pound: a 4 m mark where it lands (up to 9 m, never on a wall / the void), the landing 1.1 s later.
func _pound(f: Fighter, point: Vector3, at := Vector3.INF) -> void:
	var o := f.position if at == Vector3.INF else at
	var t := point - o
	t.y = 0
	var d := t.length()
	if d > 9.0:
		t *= 9.0 / d
		d = 9.0
	var A := fx.arena
	var guard := 0
	while A and guard < 18 and d > 0.5 and A.blocks_move(A.to_tile(o.x + t.x), A.to_tile(o.z + t.z)):
		var s := (d - 0.5) / d
		t *= s
		d -= 0.5
		guard += 1
	var x := o.x + t.x
	var z := o.z + t.z
	var mark := MeshInstance3D.new()
	mark.mesh = FxLib.disc_mesh()
	mark.material_override = FxLib.glow(Color(3.2, 1.2, 1.8), 0.3, "add", true, 1)
	mark.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mark.position = Vector3(x, 0.08, z)
	mark.scale = Vector3.ONE * 4.0
	add_child(mark)
	marks.append(mark)
	var land := func():
		marks.erase(mark)
		mark.queue_free()
		if not is_instance_valid(f) or not f.alive:
			return
		fx.ring(Vector3(x, 0, z), Color(3.4, 1.6, 2.4), 4.0, 0, 0.5)
		fx.dust(x, z, 20, Color("ffd6e0"), 2.4)
		Feel.shake_at(x, z, 0.8)   # FEEL (combat.js pound landing)
		_sfx("pound_land", Vector3(x, 0, z))
	later.append([_now() + maxf(0.0, 1.1 - lead), land])

# Nurse Kappa's Tidal Wave: a crest 5 m wide rolls 10 m ahead in 0.6 s.
func _wave(f: Fighter, d: Vector3) -> void:
	var p := f.position + d * 0.6
	var g := Node3D.new()
	var sheet := MeshInstance3D.new()
	sheet.mesh = FxLib.wave_mesh()
	var m0 := FxLib.glow(Color(0.35, 1.3, 2.2), 0.7, "mix", true)
	sheet.material_override = m0
	sheet.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var foam := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.14
	cap.height = 4.6 + 0.28
	cap.radial_segments = 8
	cap.rings = 2
	foam.mesh = cap
	var m1 := FxLib.glow(Color(2.2, 2.6, 2.8), 0.9)
	foam.material_override = m1
	foam.rotation.z = PI / 2
	foam.position = Vector3(0, 1.55, -0.45)
	foam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(sheet)
	g.add_child(foam)
	g.rotation.y = atan2(d.x, d.z)
	g.position = Vector3(p.x, 0, p.z)
	add_child(g)
	waves.append({"x": p.x, "z": p.z, "dx": d.x, "dz": d.z, "t": 0.0, "T": 0.6, "len": 10.0, "mesh": g, "mats": [m0, m1]})
	Feel.shake_at(p.x, p.z, 0.3)   # FEEL (combat.js wave)

func _update_waves(dt: float) -> void:
	var i := waves.size() - 1
	while i >= 0:
		var W: Dictionary = waves[i]
		W.t += dt
		var k := minf(1.0, W.t / W.T)
		var front: float = k * W.len
		var g: Node3D = W.mesh
		g.position = Vector3(W.x + W.dx * front, 0, W.z + W.dz * front)
		g.scale = Vector3(1, 0.7 + 0.3 * sin(k * PI), 1)
		FxLib.set_alpha(W.mats[0], 0.7 * (1.0 - k * k))
		FxLib.set_alpha(W.mats[1], 0.9 * (1.0 - k * k))
		if _rng.randf() < 0.6:
			var s := _rng.randf() - 0.5
			fx.splash(g.position.x + s * 4.0 * W.dz, g.position.z - s * 4.0 * W.dx, 0.5)
		if k >= 1.0:
			g.queue_free()
			waves.remove_at(i)
		i -= 1

# ---------------------------------------------------------------- ground zones ('zone' events)

func zone_event(z: Dictionary) -> void:
	var c: Array = z.get("col", [1, 1, 1])
	var col := Color(float(c[0]), float(c[1]), float(c[2]))
	var mi := MeshInstance3D.new()
	mi.mesh = FxLib.disc_mesh()
	mi.material_override = FxLib.glow(col, 0.45, "add", true, 1)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = Vector3(float(z.get("x", 0)), 0.07, float(z.get("z", 0)))
	mi.scale = Vector3.ONE * float(z.get("r", 1))
	add_child(mi)
	var owner: Fighter = fx.fighters.get(str(z.get("owner", "")))
	zones.append({"x": mi.position.x, "z": mi.position.z, "t": float(z.get("t", 1)), "once": bool(z.get("once", false)),
		"heal": z.get("heal") != null, "owner": owner, "mesh": mi})

func zone_off(x: float, z: float) -> void:
	for Z in zones:
		if Z.once and Vector2(Z.x - x, Z.z - z).length() < 0.1:
			Z.t = 0.0

func _update_zones(dt: float) -> void:
	var i := zones.size() - 1
	while i >= 0:
		var Z: Dictionary = zones[i]
		Z.t -= dt
		var mi: MeshInstance3D = Z.mesh
		FxLib.set_alpha(mi.material_override, 0.45 * minf(1.0, Z.t / 0.4) * (0.75 + 0.25 * sin(fx.time * 9.0)))
		if Z.heal:   # Bowl Splash: no marker on a hidden Kappa
			var o: Fighter = Z.owner
			mi.visible = o == null or not is_instance_valid(o) or o.visible or o.is_local
		if Z.t <= 0.0:
			mi.queue_free()
			zones.remove_at(i)
		i -= 1

# ---------------------------------------------------------------- gadgets (gadgets.js fx())

func gadget(f: Fighter, _d: Vector3) -> void:
	if not f.visible:
		return
	var p := f.position
	match String(f.type.key) + f.gadget:
		"blasterA": fx.dust(p.x, p.z, 10, Color("b58a5a"), 1.2)
		"blasterB":
			fx.ring(p, BARK, 1.3, 0, 0.6)
			fx.debris_burst(Vector3(p.x, 1, p.z), Color("8a5a2e").srgb_to_linear(), 8, 0.2, 3)
		"gunslingerA": fx.dust(p.x, p.z, 8, Color("f0b8d0"), 1.0)
		"bomberA": fx.dust(p.x, p.z, 8, Color("6a4a3a"), 1.0)
		"bomberB":
			fuse_next[f.id] = true
			fx.spark_burst(Vector3(p.x, 1.6, p.z), LAVA, 16, 5, 0.4, 0.14)
		"frostbiteA": fx.spark_burst(Vector3(p.x, 0.3, p.z), G_ICE, 18, 4, 0.5, 0.14)
		"frostbiteB": fx.spark_burst(Vector3(p.x, 1.2, p.z), G_ICE, 10, 3, 0.4, 0.12)
		"voltA":
			fx.ring(p, ZAP, 1.1, 0, 0.4)
			fx.spark_burst(Vector3(p.x, 1, p.z), ZAP, 16, 5, 0.3, 0.12)
		"voltB": fx.ring(p, ZAP, 1.2, 0, 0.5)
		"kappaA": fx.splash(p.x, p.z, 0.8)
		"kappaB":
			fx.splash(p.x, p.z, 0.6)
			fx.ring(p, WATER, 2.0, 0, 0.5)
		"pipchompA": fx.dust(p.x, p.z, 8, Color("6a9a4a"), 1.0)
		"pipchompB":
			if fx.arena and fx.arena.kit and fx.arena.kit.has_method("puff"):
				fx.arena.kit.puff(p.x, p.z)
		"mochiA": fx.dust(p.x, p.z, 10, Color("ffd6e0"), 1.3)
		"mochiB": fx.ring(p, PINK, 1.4, 0, 0.5)

func flare(x: float, z: float) -> void:
	fx.ring(Vector3(x, 0, z), YELLOW, 6.0, 0, 0.9)
	fx.flash(Vector3(x, 3, z), Color(1, 0.9, 0.5), 260, 14, 0.6)
	fx.spark_burst(Vector3(x, 2.5, z), YELLOW, 30, 6, 0.8, 0.16)

func bite_fx(x: float, z: float) -> void:
	fx.spark_burst(Vector3(x, 1.4, z), Color(3, 3, 3), 3, 5, 0.25, 0.14)       # teeth sparks
	fx.spark_burst(Vector3(x, 1.2, z), Color(0.6, 2.4, 0.6), 10, 4, 0.4, 0.12)  # leaves

# FEEL: a one-shot through the game's AudioManager (distance falloff from the camera focus).
func _sfx(sound: String, at: Vector3, vol := 1.0) -> void:
	if AudioManager.current:
		AudioManager.current.play(sound, at, vol)
