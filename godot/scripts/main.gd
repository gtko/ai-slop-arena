extends Node3D
# Entry point: menu -> room -> match. Everything is built from code (no hand-edited scenes) so the
# port stays easy to diff. Rules run on the server; this is the renderer + input.

const SEND_HZ := 20.0
enum State { MENU, LOBBY, LOADING, COUNTDOWN, PLAYING, OVER }

var net: NetClient
var state := State.MENU
var arena: Arena
var fighters: Dictionary = {}     # id -> Fighter
var me: Fighter
var cam: Camera3D
var sun: DirectionalLight3D
var env: WorldEnvironment
var touch: TouchControls
var ui: Control
var status: Label
var hud: Label
var hud_ui: Hud                    # HUD hook: in-match HUD + combat feedback (hud.gd)
var code_edit: LineEdit
var server_edit: LineEdit
var brawler_pick: OptionButton
var saver_check: CheckBox
var start_btn: Button
var menu_box: Control
var projectiles: Array = []       # [{node, dir, speed, left}]
var send_t := 0.0
var super_seq := 0
var fix_seen := -1
var count_left := 0.0
var aim_dir := Vector2(0, 1)
var aim_point := Vector3.ZERO
var last_move := Vector2.ZERO
var audio: AudioManager           # AUDIO HOOK: pooled SFX + music (scripts/audio_manager.gd)
var _last_count := 0
var _me_hp := -1.0
var _final_music := false

func _ready() -> void:
	audio = AudioManager.new()   # AUDIO HOOK
	add_child(audio)
	audio.play_music("menu")
	net = NetClient.new()
	add_child(net)
	net.message.connect(_on_message)
	net.closed.connect(func(): _to_menu("Disconnected from the server."))
	_build_scene()
	_build_ui()
	_apply_power_profile()
	if DebugArgs.has("autotest"):
		_autotest()

# Headless end-to-end check against a local server: godot --headless --path godot -- --autotest ws://localhost:8787
func _autotest() -> void:
	var args := DebugArgs.list()
	var url := NetClient.default_origin()
	for a in args:
		if a.begins_with("ws"):
			url = a
		elif a.begins_with("--server="):
			url = a.substr(9)
	server_edit.text = url
	if args.has("--noshadow"):
		sun.shadow_enabled = false
	code_edit.text = "T" + _random_code().substr(0, 3)
	_join()
	var t0 := Time.get_ticks_msec()
	var stats := {"snaps": 0, "hp_changes": 0}
	net.message.connect(func(m): stats.snaps += 1 if m.get("t") == "snap" else 0)
	while Time.get_ticks_msec() - t0 < 14000:
		await get_tree().create_timer(0.5).timeout
		if state == State.LOBBY and start_btn.visible:
			for a in args:
				if a.begins_with("--map="):
					net.send({"t": "map", "map": a.substr(6)})
			start_btn.pressed.emit()
		if state == State.PLAYING and me:
			last_move = Vector2(1, 0.3)
			touch.move = Vector2(0.7, 0.4)
			touch.visible = true
	for a in args:
		if a.begins_with("--shot="):
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png(a.substr(7))
	print("AUTOTEST state=%d snaps=%d me=%s hp=%s pos=%s fighters=%d arena=%s" % [state, stats.snaps, me != null, me.hp if me else -1, me.position if me else Vector3.ZERO, fighters.size(), arena != null])
	get_tree().quit(0 if stats.snaps > 20 and me != null else 1)

func _notification(what: int) -> void:
	# battery: a game nobody looks at should not keep the GPU busy
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_WM_WINDOW_FOCUS_OUT:
		Engine.max_fps = 5
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN or what == NOTIFICATION_WM_WINDOW_FOCUS_IN:
		_apply_power_profile()

func _apply_power_profile() -> void:
	var saver := saver_check != null and saver_check.button_pressed
	Engine.max_fps = 30 if saver else 60
	var vp := get_viewport()
	vp.scaling_3d_scale = 0.7 if saver else 1.0
	vp.msaa_3d = Viewport.MSAA_DISABLED if saver else Viewport.MSAA_2X
	if sun:
		sun.shadow_enabled = not saver

func _build_scene() -> void:
	cam = Camera3D.new()
	cam.fov = 42
	cam.current = true
	add_child(cam)
	cam.position = Vector3(0, 18, 13)
	cam.look_at(Vector3.ZERO)
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -30, 0)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 40.0
	add_child(sun)
	env = WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color("87c4e8")
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.75, 0.78, 0.85)
	e.ambient_light_energy = 0.7
	env.environment = e
	add_child(env)

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	ui = Control.new()
	ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(ui)
	touch = TouchControls.new()
	touch.visible = DisplayServer.is_touchscreen_available()
	touch.super_pressed.connect(func(): super_seq += 1)
	ui.add_child(touch)
	hud_ui = Hud.new()   # HUD hook
	ui.add_child(hud_ui)   # HUD hook
	hud_ui.setup(net, cam, self, touch)   # HUD hook
	hud_ui.menu_requested.connect(func(): _to_menu(""))   # HUD hook
	hud_ui.play_again.connect(func(): _to_menu(""))   # HUD hook
	hud = Label.new()
	hud.position = Vector2(20, 12)
	hud.visible = false   # HUD hook: replaced by hud_ui
	hud.add_theme_font_size_override("font_size", 22)
	ui.add_child(hud)
	status = Label.new()
	status.set_anchors_preset(Control.PRESET_CENTER_TOP)
	status.position.y = 60
	status.add_theme_font_size_override("font_size", 40)
	ui.add_child(status)
	menu_box = VBoxContainer.new()
	menu_box.set_anchors_preset(Control.PRESET_CENTER)
	menu_box.custom_minimum_size = Vector2(420, 0)
	menu_box.position = Vector2(-210, -190)
	ui.add_child(menu_box)
	var title := Label.new()
	title.text = "AI SLOP ARENA  (Godot client)"
	title.add_theme_font_size_override("font_size", 30)
	menu_box.add_child(title)
	server_edit = LineEdit.new()
	server_edit.text = NetClient.default_origin()
	server_edit.placeholder_text = "server (wss://… or ws://localhost:8787)"
	menu_box.add_child(server_edit)
	code_edit = LineEdit.new()
	code_edit.text = _random_code()
	code_edit.placeholder_text = "room code"
	menu_box.add_child(code_edit)
	brawler_pick = OptionButton.new()
	for k in GameData.brawlers:
		brawler_pick.add_item(GameData.brawlers[k].name)
		brawler_pick.set_item_metadata(brawler_pick.item_count - 1, k)
	menu_box.add_child(brawler_pick)
	saver_check = CheckBox.new()
	saver_check.text = "Battery saver (30 fps, lower resolution, no shadows)"
	saver_check.toggled.connect(func(_on): _apply_power_profile())
	menu_box.add_child(saver_check)
	var play := Button.new()
	play.text = "Join room"
	play.custom_minimum_size.y = 56
	play.pressed.connect(_join)
	menu_box.add_child(play)
	start_btn = Button.new()
	start_btn.text = "START MATCH"
	start_btn.custom_minimum_size = Vector2(260, 64)
	start_btn.set_anchors_preset(Control.PRESET_CENTER)
	start_btn.position = Vector2(-130, 0)
	start_btn.visible = false
	start_btn.pressed.connect(func(): audio.play("click"); net.send({"t": "start"}); start_btn.visible = false)   # AUDIO HOOK
	ui.add_child(start_btn)

func _random_code() -> String:
	var a := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var s := ""
	for i in 4:
		s += a[randi() % a.length()]
	return s

func _join() -> void:
	audio.play("click")   # AUDIO HOOK
	audio.play_music("lobby")
	var key: String = brawler_pick.get_item_metadata(brawler_pick.selected)
	var err := net.connect_room(server_edit.text.strip_edges().trim_suffix("/"), code_edit.text.strip_edges().to_upper(), "Godot", key)
	if err != OK:
		status.text = "Cannot connect (%d)" % err
		return
	menu_box.visible = false
	status.text = "Connecting…"
	state = State.LOBBY

func _to_menu(msg: String) -> void:
	_clear_match()
	state = State.MENU
	audio.stop_jingle()   # AUDIO HOOK
	audio.set_danger(0.0)
	audio.play_music("menu")
	menu_box.visible = true
	start_btn.visible = false
	status.text = msg
	hud.text = ""

func _clear_match() -> void:
	for f in fighters.values():
		f.queue_free()
	fighters.clear()
	for p in projectiles:
		p.node.queue_free()
	projectiles.clear()
	if arena:
		arena.queue_free()
		arena = null
	me = null
	hud_ui.end_match()   # HUD hook

# ---------------------------------------------------------------- network

func _on_message(m: Dictionary) -> void:
	match m.get("t", ""):
		"welcome":
			status.text = "Room %s: waiting for the leader…" % m.code
		"room":
			if state == State.LOBBY:
				status.text = "Room %s: %d player(s)" % [net.code, m.players.size()]
				var mine: Array = m.players.filter(func(p): return p.id == net.id)
				start_btn.visible = not m.inMatch and not mine.is_empty() and bool(mine[0].get("host", false))
		"start":
			_start_match(m)
		"go":
			count_left = float(m.get("in", 3000)) / 1000.0
			_last_count = 0   # AUDIO HOOK
			state = State.COUNTDOWN
		"snap":
			_apply_snap(m)
			hud_ui.on_snapshot(m)   # HUD hook
		"ev":
			for e in m.list:
				_apply_event(e)
				hud_ui.on_event(e)   # HUD hook
		"error", "kicked":
			_to_menu(String(m.get("msg", "Refused by the server")))

func _start_match(m: Dictionary) -> void:
	_clear_match()
	state = State.LOADING
	start_btn.visible = false
	var map_data: Dictionary = GameData.maps.get(m.map, GameData.maps.oasis)
	arena = Arena.new()
	add_child(arena)
	arena.build(map_data)
	(env.environment as Environment).background_color = Color(map_data.swatch[1]) if map_data.get("sky", false) else Color("87c4e8")
	for row in m.roster:
		var f := Fighter.new()
		add_child(f)
		f.setup(row, GameData.brawlers)
		var sp := arena.spawns[int(row.spawn) % arena.spawns.size()]
		f.position = sp
		f.target = sp
		f.is_local = row.id == net.id
		fighters[row.id] = f
		if f.is_local:
			me = f
	hud_ui.begin_match(m, arena, fighters)   # HUD hook
	status.text = "%s: get ready" % map_data.name
	_final_music = false   # AUDIO HOOK: the map theme (+ weather bed) starts with the match
	_me_hp = -1.0
	audio.play_music("m_" + String(m.map))
	net.send({"t": "lprog", "p": 100})
	net.send({"t": "loaded"})

func _apply_snap(m: Dictionary) -> void:
	var seen := {}
	for r in m.b:
		var f: Fighter = fighters.get(r[0])
		if f == null:
			continue
		seen[r[0]] = true
		f.hidden_by_server = false
		f.apply_row(r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9])
	for id in fighters:
		if not seen.has(id) and fighters[id] != me:
			fighters[id].hidden_by_server = true   # in a bush / fog: the server does not tell us
	_audio_snap()   # AUDIO HOOK
	if me and m.has("me") and int(m.me[2]) != fix_seen:
		# the server refused one of our moves: snap back to where it says
		fix_seen = int(m.me[2])
		me.position = Vector3(m.me[0], 0, m.me[1])

func _apply_event(e: Dictionary) -> void:
	var f: Fighter = fighters.get(e.get("id", ""))
	match e.get("e", ""):
		"atk":
			if f:
				audio.play(("super_" if e.get("s", false) else "atk_") + String(f.type.key), f.position)   # AUDIO HOOK
				if e.get("s", false) and f == me:
					audio.duck()
				f.play_once("super" if e.get("s", false) else "shoot")
				_spawn_projectile(f, e)
		"kill":
			if f:
				f.alive = false
				audio.play("death", f.position)   # AUDIO HOOK
				if fighters.get(e.get("by", "")) == me and f != me:
					audio.play("kill")
					audio.duck()
			if f == me:
				audio.set_danger(0.0)   # AUDIO HOOK
				audio.play("lose")
				state = State.OVER
				status.text = "Knocked out — rank #%d" % int(e.get("rank", 0))
		"win":
			state = State.OVER
			status.text = "YOU WIN!" if f == me else "%s wins" % (f.fname if f else "?")
			if f == me:   # AUDIO HOOK
				audio.play("win")
		"wall":
			if arena:
				arena.break_tile(int(e.i), int(e.j))
				audio.play("break", _tile_world(int(e.i), int(e.j)))   # AUDIO HOOK
		"crate":
			if arena:
				arena.break_tile(int(e.i), int(e.j))
				audio.play("crate", _tile_world(int(e.i), int(e.j)))   # AUDIO HOOK
		"dmg":   # AUDIO HOOK
			if f == me:
				audio.play("damage")
			elif fighters.get(e.get("s", "")) == me:
				audio.play("hit")
		"pick":   # AUDIO HOOK
			if fighters.get(e.get("by", "")) == me:
				audio.play("pickup")

func _spawn_projectile(f: Fighter, e: Dictionary) -> void:
	var mi := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.22 if not e.get("s", false) else 0.45
	s.height = s.radius * 2
	s.radial_segments = 8
	s.rings = 4
	mi.mesh = s
	var mat := StandardMaterial3D.new()
	mat.albedo_color = GameData.color_of(f.type.palette.accent)
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mi.material_override = mat
	add_child(mi)
	mi.position = f.position + Vector3(0, 1.1, 0)
	projectiles.append({"node": mi, "dir": Vector3(e.dx, 0, e.dz).normalized(),
		"speed": float(f.type.projSpeed), "left": float(f.type.range)})

# ---------------------------------------------------------------- frame

func _process(delta: float) -> void:
	_update_projectiles(delta)
	if arena:
		arena.update(delta)
	if state == State.COUNTDOWN:
		count_left -= delta
		status.text = str(ceili(maxf(count_left, 0.0)))
		if ceili(maxf(count_left, 0.0)) != _last_count and count_left > 0.0:   # AUDIO HOOK
			_last_count = ceili(count_left)
			audio.play("tick")
		if count_left <= 0.0:
			audio.play("go")   # AUDIO HOOK
			state = State.PLAYING
			status.text = ""
	if me == null or arena == null:
		return
	audio.listener = me.position   # AUDIO HOOK
	if state == State.PLAYING and me.alive:
		_control(delta)
	_follow_camera(delta)
	hud.text = "HP %d/%d   Ammo %.1f   Super %d%%   Cubes %d   %d ms" % [me.hp, me.max_hp, me.ammo,
		clampi(int(me.super_charge / float(me.type.superCost) * 100.0), 0, 100), me.cubes, int(net.rtt_ms)]

func _control(delta: float) -> void:
	var mv := touch.move if touch.visible else Vector2.ZERO
	var kb := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if Input.is_key_pressed(KEY_A): kb.x -= 1
	if Input.is_key_pressed(KEY_D): kb.x += 1
	if Input.is_key_pressed(KEY_W): kb.y -= 1
	if Input.is_key_pressed(KEY_S): kb.y += 1
	if kb != Vector2.ZERO:
		mv = kb.limit_length(1.0)
	last_move = mv
	if mv != Vector2.ZERO:
		var p := me.position + Vector3(mv.x, 0, mv.y) * float(me.type.speed) * delta
		me.position = arena.collide_circle(p, me.radius)
		me.rotation.y = lerp_angle(me.rotation.y, atan2(mv.x, mv.y), clampf(delta * 14.0, 0, 1))
	var firing := false
	if touch.visible:
		if touch.aim.length() > 0.25:
			aim_dir = touch.aim.normalized()
		firing = touch.firing
	else:
		var hit = _mouse_ground()
		if hit != null:
			var d: Vector3 = hit - me.position
			if Vector2(d.x, d.z).length() > 0.3:
				aim_dir = Vector2(d.x, d.z).normalized()
		firing = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
		if Input.is_action_just_pressed("ui_accept"):
			super_seq += 1
	if aim_dir != Vector2.ZERO and (firing or touch.visible):
		me.rotation.y = lerp_angle(me.rotation.y, atan2(aim_dir.x, aim_dir.y), clampf(delta * 20.0, 0, 1))
	aim_point = me.position + Vector3(aim_dir.x, 0, aim_dir.y) * float(me.type.range)
	send_t -= delta
	if send_t <= 0.0:
		send_t = 1.0 / SEND_HZ
		net.send(hud_ui.fill_input({"t": "in", "x": snappedf(me.position.x, 0.01), "z": snappedf(me.position.z, 0.01),
			"ax": snappedf(aim_dir.x, 0.01), "az": snappedf(aim_dir.y, 0.01),
			"px": snappedf(aim_point.x, 0.01), "pz": snappedf(aim_point.z, 0.01),
			"f": 1 if firing else 0, "s": super_seq, "g": 0, "gx": snappedf(aim_dir.x, 0.01), "gz": snappedf(aim_dir.y, 0.01),
			"em": 0, "ei": -1}))   # HUD hook (g/em/ei/ping come from hud_ui)

func _mouse_ground() -> Variant:
	var mp := get_viewport().get_mouse_position()
	var from := cam.project_ray_origin(mp)
	var dir := cam.project_ray_normal(mp)
	if absf(dir.y) < 1e-4:
		return null
	var t := -from.y / dir.y
	return from + dir * t if t > 0 else null

func _follow_camera(delta: float) -> void:
	var want := me.position + Vector3(0, 18, 13)
	cam.position = cam.position.lerp(want, clampf(delta * 6.0, 0.0, 1.0))
	cam.look_at(cam.position - Vector3(0, 18, 13) + Vector3(0, 0, 0))

func _update_projectiles(delta: float) -> void:
	for k in range(projectiles.size() - 1, -1, -1):
		var p = projectiles[k]
		var step: float = p.speed * delta
		p.node.position += p.dir * step
		p.left -= step
		if p.left <= 0.0 or (arena and GameData.SHOT_BLOCK.contains(arena.char_at(p.node.position.x, p.node.position.z))):
			p.node.queue_free()
			projectiles.remove_at(k)

# AUDIO HOOK: low-health low-pass + heartbeat, and the final-phase song (last 3 standing).
func _audio_snap() -> void:
	if me == null or state != State.PLAYING:
		return
	var frac := clampf(me.hp / maxf(me.max_hp, 1.0), 0.0, 1.0)
	var low := clampf((0.35 - frac) / 0.35, 0.0, 1.0) if me.alive else 0.0
	audio.set_danger(low)
	if low > 0.0 and _me_hp != me.hp:
		audio.play("low_health")
	_me_hp = me.hp
	if not _final_music:
		var alive := 0
		for f in fighters.values():
			if f.alive:
				alive += 1
		if alive <= 3 and alive > 1:
			_final_music = true
			audio.play_music("final")

func _tile_world(i: int, j: int) -> Vector3:   # AUDIO HOOK
	return Vector3((i + 0.5) * GameData.TILE - GameData.HALF, 0.0, (j + 0.5) * GameData.TILE - GameData.HALF)
