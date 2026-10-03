extends Node3D
# Entry point and state machine: MENU -> (QUEUE) -> LOBBY -> LOADING -> COUNTDOWN -> PLAYING -> OVER
# -> back to the menu / lobby. Everything is built from code (no hand-edited scenes) so the port
# stays easy to diff. Rules run on the server; this is the renderer + input.
#
# Screens (all built from code): MainMenu (menu.gd), Lobby (lobby.gd), MatchLoad (match_load.gd: loading +
# 3-2-1), ResultView (result_view.gd), all laid out in the web's CSS px (UiKit.css_scale, css_view.gd).
# Network: NetClient (room socket), MatchmakingClient (quick play queue, /mm), Profile (rank).
#   MENU     main menu. QUICK PLAY -> QUEUE; PRIVATE ROOM create / join -> LOBBY.
#   QUEUE    matchmaking overlay on the menu; "matched" -> room socket -> LOBBY (a matchmade room
#            starts by itself).
#   LOBBY    the room: players, leader picks map / mode / chaos and starts. {t:"start"} -> LOADING.
#   LOADING  arena built, "loaded" sent. {t:"go"} -> COUNTDOWN (3-2-1) -> PLAYING.
#   OVER     I am out or somebody won: result screen (spectate / again / menu), ranked points arrive.
# Errors (outdated, full, banned, kicked) and lost connections return to the menu with a message.

const SEND_HZ := 20.0
const MenuShowcase := preload("res://scripts/menu_showcase.gd")
# QUEUE is last so the numbers of the older states stay the same (the autotest prints them)
enum State { MENU, LOBBY, LOADING, COUNTDOWN, PLAYING, OVER, QUEUE }

var net: NetClient
var mm: MatchmakingClient
var profile: Profile
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
var duo: Duo                       # Duo: teams, ghosts, revives, the tether (duo.gd, hud_duo.gd)
var rank_label: Label             # ranked-points text under the HUD result overlay
var audio: AudioManager           # AUDIO HOOK: pooled SFX + music (scripts/audio_manager.gd)
var menu: MainMenu
var lobby: Lobby
var result: ResultView
var matchload: MatchLoad           # pre-match loading screen + 3-2-1 (match_load.gd)
var showcase: MenuShowcase          # MENU hook: the live arena behind the home screen (menu_showcase.gd)
var _auto_start := false          # SOLO: start the new room as soon as we lead it
var _vs_bots := false             # this room is a SOLO one (bots only): its matches count for the Bot League
var projectiles: Array = []       # [{node, dir, speed, left}]
var send_t := 0.0
var super_seq := 0
var fix_seen := -1
var count_left := 0.0
var aim_dir := Vector2(0, 1)
var aim_point := Vector3.ZERO
var aim_dist := 0.0               # how far the attack is aimed (mouse distance / stick tilt; lobbed attacks land there)
var super_aiming := false         # the super is being aimed (right click / LT / super key held, charged): fx_aim.gd
var settings_view: SettingsView   # the options screen (settings_view.gd), over everything
var home_menu: PauseView          # Escape on the home screen (pause_view.gd in its home mode)
var _fps_label: Label             # the web's #fpsBadge (options: FPS counter)
var _fps_t := 0.0
var last_move := Vector2.ZERO
var _room_code := ""
var _room_matchmade := false
var _room_msg: Dictionary = {}
var _retries := 0
var _leaving := false
var _in_match_room := false       # the room socket is open (lobby or match)
var _my_place := 0
var _winner := ""
var _ranked_text := ""
var _match_done := false          # the room says the match is over (not only me)
var _result_shown := false
var _last_count := 0
var _me_hp := -1.0
var _final_music := false

func _ready() -> void:
	Fonts.setup()   # the bundled emoji font as a fallback of every UI font (before any copy is made)
	# the window / browser tab title (config/name keeps "(Godot)": it names the user:// folder). On the
	# root Window, not DisplayServer: the Window rewrites its title on every locale change.
	get_window().title = "AI SLOP ARENA"
	Settings.load_all()
	Quality.renderer_boot_check()   # Android: a renderer still on trial falls back by itself after a crash
	LegacyImport.run()   # web, first launch: the old three.js client's saves (localStorage) -> user://
	Controls.setup()   # the rebindable keys + gamepad buttons in the InputMap (controls.gd)
	if not DebugArgs.has("autotest") and not Array(DebugArgs.list()).any(func(a): return String(a).begins_with("--menushot")):
		Settings.apply_display()   # window mode + vsync (desktop)
	for a in DebugArgs.list():
		if a.begins_with("--lang="):
			Settings.lang = a.substr(7)      # (not saved) for screenshots
			Settings.lang_override = true
		elif a.begins_with("--server="):     # `-- --server=ws://...` / debug web `?server=ws://...`: a test server (not saved)
			Settings.server = a.substr(9).uri_decode()
			Settings.server_override = true
	I18n.use(Settings.lang if Settings.lang != "" else I18n.detect())
	Settings.apply_audio()
	audio = AudioManager.new()   # AUDIO HOOK
	add_child(audio)
	audio.play_music("menu")
	net = NetClient.new()
	add_child(net)
	net.message.connect(_on_message)
	net.closed.connect(_on_net_closed)
	mm = MatchmakingClient.new()
	add_child(mm)
	mm.queue.connect(func(m: Dictionary): menu.update_queue(m))
	mm.matched.connect(_on_matched)
	mm.failed.connect(_on_mm_failed)
	profile = Profile.new()
	add_child(profile)
	_build_scene()
	_build_ui()
	_apply_power_profile()
	_set_state(State.MENU)
	profile.fetch()
	# the boot intro (scripts/intro.gd) over the menu, once per launch; native builds only
	var intro_script: GDScript = load("res://scripts/intro.gd")
	if intro_script and intro_script.call("wanted"):
		add_child(intro_script.new(audio))
	var args := DebugArgs.list()
	if args.has("--autotest"):
		_autotest()
	else:
		for a in args:
			if a.begins_with("--menushot="):
				_menushot(a.substr(11), args)
		_join_invite()

# Web invite links (/play?room=CODE, redirected to /godot/<v>/?room=CODE): straight into that room.
# Release builds too (DebugArgs only reads the URL on debug ones): only a room code is taken from it.
func _join_invite() -> void:
	if not OS.has_feature("web"):
		return
	var q = JavaScriptBridge.eval("new URLSearchParams(location.search).get('room') || ''")
	var code := String(q).strip_edges().to_upper() if typeof(q) == TYPE_STRING else ""
	var re := RegEx.create_from_string("^[A-Z0-9]{4,6}$")
	if re.search(code) != null:
		# drop ?room= from the address bar: a reload (or the loader's Reload button) must not drag you back
		JavaScriptBridge.eval("history.replaceState(null, '', location.pathname)")
		_open_room(code, false)

# Screenshot of the menu (or one of its overlays) for layout checks:
#   godot --path godot -- --menushot=/tmp/menu.png [--overlay=settings|room|queue] [--brawler=volt]
func _menushot(path: String, args: PackedStringArray) -> void:
	for a in args:
		if a.begins_with("--brawler="):
			menu._select_brawler(a.substr(10), false)
			showcase.refresh()   # the backdrop stars it too
		if a.begins_with("--overlay="):
			match a.substr(10):
				"settings":
					var tab := ""
					for b in args:
						if b.begins_with("--tab="):
							tab = b.substr(6)
					settings_view.open(tab)
					if args.has("--capture"):   # the "press a key" state of the first key row
						settings_view.call("_activate", 0)
				"room": menu._room_dialog.visible = true
				"maps": menu._maps_pop.visible = true; menu._refresh_map()
				"quests", "collection", "shop", "road": menu._open_page(a.substr(10))
				"result", "result_win", "result_run":
					_fake_result(a.substr(10))
				"load", "count":
					_fake_load(a.substr(10) == "count")
				"home":
					home_menu.visible = true
				"pause":
					var pv := PauseView.new()
					ui.add_child(pv)
					pv.visible = true
				"queue":
					menu.show_queue(true)
					menu.update_queue({"n": 3, "need": 8, "waited": 12000, "botsIn": 18000, "plats": {"web": 2, "steam": 1}})
	var resize := Vector2i.ZERO   # --resize=WxH: resize the window mid-way (relayout check)
	for a in args:
		if a.begins_with("--resize="):
			var wh := a.substr(9).split("x")
			resize = Vector2i(int(wh[0]), int(wh[1]))
		if a.begins_with("--shotsecs="):   # --shotsecs=2,6,10: one shot at each time, <path>_<s>s.png (the live backdrop)
			var t0 := Time.get_ticks_msec()
			for v in a.substr(11).split(","):
				while Time.get_ticks_msec() - t0 < float(v) * 1000.0:
					await get_tree().process_frame
				await RenderingServer.frame_post_draw
				get_viewport().get_texture().get_image().save_png("%s_%ss.png" % [path.get_basename(), v])
				print("MENUSHOT saved %s_%ss.png" % [path.get_basename(), v])
			get_tree().quit(0)
			return
	for i in 90:
		if i == 30 and resize != Vector2i.ZERO:
			DisplayServer.window_set_size(resize)
		await get_tree().process_frame
	for a in args:   # --padnav=down,right,a: gamepad presses (D-pad, A, B...) before the shot (focus checks)
		if a.begins_with("--padnav="):
			var btns := {"up": JOY_BUTTON_DPAD_UP, "down": JOY_BUTTON_DPAD_DOWN, "left": JOY_BUTTON_DPAD_LEFT,
				"right": JOY_BUTTON_DPAD_RIGHT, "a": JOY_BUTTON_A, "b": JOY_BUTTON_B, "lb": JOY_BUTTON_LEFT_SHOULDER, "rb": JOY_BUTTON_RIGHT_SHOULDER}
			for step in a.substr(9).split(","):
				for down in [true, false]:
					var e := InputEventJoypadButton.new()
					e.button_index = btns.get(step, JOY_BUTTON_A)
					e.pressed = down
					Input.parse_input_event(e)
					for f in 3:
						await get_tree().process_frame
			for i in 20:
				await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("MENUSHOT saved %s size=%s window=%s" % [path, get_viewport().get_visible_rect().size, DisplayServer.window_get_size()])
	get_tree().quit(0)

# Screenshot data for the result / loading screens (local only, nothing is sent to any server).
func _fake_roster() -> Array:
	var keys: Array = GameData.brawlers.keys()
	var names := ["You", "Zorglub", "Mia", "Tanuki", "Rex", "Pixel", "Nova", "Bobo"]
	var pers := ["hunter", "camper", "looter", "vulture", "coward", "showoff", "hunter"]
	var rows: Array = []
	for i in 8:
		rows.append({"id": "me" if i == 0 else "bot%d" % i, "name": names[i], "type": "%s:A1" % keys[i % keys.size()],
			"human": i < 2, "per": "" if i < 2 else pers[i - 1], "plat": "steam" if i == 1 else "web", "cos": "%d.0.0.0.1.0" % (i % 3)})
	return rows

func _fake_result(kind: String) -> void:
	menu.visible = false
	var rows := _fake_roster()
	result.begin_match(rows, "me")
	var evs := [{"e": "dmg", "id": "bot3", "a": 3400, "s": "me"}, {"e": "kill", "id": "bot3", "by": "me", "rank": 8},
		{"e": "kill", "id": "bot4", "by": "me", "rank": 7}, {"e": "pick", "by": "me"}, {"e": "pick", "by": "me"}, {"e": "pick", "by": "me"},
		{"e": "gad", "id": "me"}, {"e": "atk", "id": "bot1", "s": 1}, {"e": "atk", "id": "bot1", "s": 1}, {"e": "dmg", "id": "me", "a": 4100, "s": "bot1"},
		{"e": "emo", "id": "bot2"}, {"e": "emo", "id": "bot2"}, {"e": "kill", "id": "bot5", "by": "bot1", "rank": 6}, {"e": "kill", "id": "bot6", "by": "bot2", "rank": 5},
		{"e": "kill", "id": "bot7", "by": "bot1", "rank": 4}]
	if kind == "result_win":
		evs += [{"e": "kill", "id": "bot2", "by": "me", "rank": 3}, {"e": "kill", "id": "bot1", "by": "me", "rank": 2}, {"e": "win", "id": "me"}]
	elif kind == "result":
		evs += [{"e": "kill", "id": "me", "by": "bot1", "rank": 3}, {"e": "kill", "id": "bot2", "by": "bot1", "rank": 2}, {"e": "win", "id": "bot1"}]
	else:
		evs += [{"e": "kill", "id": "me", "by": "bot1", "rank": 3}]
	for e in evs:
		result.track(e)
	var won := kind == "result_win"
	result.show_result(1 if won else 3, won, kind != "result_run")
	if kind != "result_run":
		result.set_rank_text(I18n.t("rank.change", {"delta": "+12" if won else "-4", "icon": "🥈", "tier": I18n.t("rank.silver"), "rp": 212}))

func _fake_load(counting: bool) -> void:
	menu.visible = false
	var rows := _fake_roster()
	matchload.show_load("grove", rows, "me")
	matchload.set_progress("me", 60)
	if counting:
		matchload.set_progress("me", 100)
		matchload.set_progress("bot1", 100)
		await get_tree().create_timer(0.5).timeout
		matchload.count(3)

# Headless end-to-end check against a local server:
#   godot --headless --path godot -- --autotest ws://localhost:8787 [--quick] [--map=grove] [--shot=/tmp/x.png] [--lobbyshot=/tmp/l.png]
# Default: a private room, the leader starts. --quick: matchmaking queue, then "play now with bots".
# --mode=duo: a Duo match (you and a bot partner against 3 bot teams); the player walks (legit
# touch.move inputs) after its partner, to its ghost when it is knocked out (a revive), and
# --duoshots=<dir> saves tether.png, reviving.png, revived.png and ghost.png when they happen.
func _autotest() -> void:
	var args := DebugArgs.list()
	var url := NetClient.default_origin()
	for a in args:
		if a.begins_with("ws"):
			url = a
		elif a.begins_with("--server="):
			url = a.substr(9)
	Settings.server = url          # not saved
	if args.has("--noshadow"):
		sun.shadow_enabled = false
	var run_ms := 14000
	for a in args:
		if a.begins_with("--secs="):
			run_ms = int(a.substr(7)) * 1000
	var quick := args.has("--quick")
	if quick:
		_quick_play()
	else:
		_open_room("T" + _random_code().substr(0, 3), false)
	var t0 := Time.get_ticks_msec()
	var stats := {"snaps": 0, "hp_changes": 0}
	net.message.connect(func(m): stats.snaps += 1 if m.get("t") == "snap" else 0)
	var started := false
	var bots_sent := false
	var lobby_shot := false
	while Time.get_ticks_msec() - t0 < run_ms:
		await get_tree().create_timer(0.5).timeout
		if state == State.QUEUE and quick and not bots_sent and Time.get_ticks_msec() - t0 > 1500:
			bots_sent = true
			mm.bots()
		if state == State.LOBBY and lobby.is_leader and not started and not net.matchmade:
			for a in args:
				if a.begins_with("--lobbyshot=") and not lobby_shot:
					lobby_shot = true
					await get_tree().create_timer(1.0).timeout
					await RenderingServer.frame_post_draw
					get_viewport().get_texture().get_image().save_png(a.substr(12))
			started = true
			for a in args:
				if a.begins_with("--map="):
					net.send({"t": "map", "map": a.substr(6)})
				elif a.begins_with("--mode="):
					net.send({"t": "mode", "mode": a.substr(7)})
			net.send({"t": "start"})
		if state == State.PLAYING and me and DebugArgs.has("keytest") and not stats.has("keys"):
			stats["keys"] = true
			await _key_test()
		if state == State.PLAYING and me:
			if DebugArgs.has("keytest"):
				pass
			elif DebugArgs.has("realinput"):   # real touch / mouse events drive the player (mobile emulation test)
				if touch.move != Vector2.ZERO:
					stats["touch_moved"] = true
				if touch.firing:
					stats["touch_fired"] = true
				if not stats.has("start_pos"):
					stats["start_pos"] = me.position
			elif duo.on:
				touch.visible = true
				touch.move = _autotest_duo_move()
				last_move = touch.move
				var foe := _nearest_foe()   # fight back: aim at the nearest enemy in reach (a tap) and fire
				var shoot := foe != null and me.position.distance_to(foe.position) < float(me.type.range)
				touch.auto_aim = shoot
				touch.firing = shoot
			else:
				last_move = Vector2(1, 0.3)
				touch.move = Vector2(0.7, 0.4)
				touch.visible = true
		if duo.on:
			await _autotest_duo_shots(stats)
	for a in args:
		if a.begins_with("--shot="):
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png(a.substr(7))
	if DebugArgs.has("feellog"):   # FEEL: smoothness of the remote fighters (fighter.gd _log_motion)
		var tot := {"n": 0, "cv": 0.0, "stall": 0, "mean": 0.0, "jerk": 0.0}
		for f in fighters.values():
			if f != me:
				var st: Dictionary = f.motion_stats()
				tot.n += int(st.n); tot.stall += int(st.stall)
				tot.cv += float(st.cv) * int(st.n); tot.mean += float(st.mean) * int(st.n); tot.jerk += float(st.jerk) * int(st.n)
		print("FEELLOG interp=%s moving_frames=%d speed_mean=%.2f speed_cv=%.3f jerk=%.3f stalls=%d fps=%d" % ["glide" if Fighter.interp_glide else "buffer",
			tot.n, tot.mean / maxf(1, tot.n), tot.cv / maxf(1, tot.n), tot.jerk / maxf(1, tot.n), tot.stall, Engine.get_frames_per_second()])
	print("AUTOTEST-INPUT touchsize=%s touchscreen=%s touch_visible=%s touch_moved=%s touch_fired=%s start=%s end=%s" % [touch.size, DisplayServer.is_touchscreen_available(), touch.visible, stats.get("touch_moved", false), stats.get("touch_fired", false), stats.get("start_pos", Vector3.ZERO), me.position if me else Vector3.ZERO])
	print("AUTOTEST state=%d snaps=%d me=%s hp=%s pos=%s fighters=%d arena=%s matchmade=%s" % [state, stats.snaps, me != null, me.hp if me else -1, me.position if me else Vector3.ZERO, fighters.size(), arena != null, net.matchmade])
	get_tree().quit(0 if stats.snaps > 20 and me != null else 1)

# --mode=duo autotest: walk to the partner's ghost (a revive: stand within 2.5 m), else stay near the
# partner; a plain stick input like a thumb would give (the server checks every step).
func _autotest_duo_move() -> Vector2:
	if me == null or not me.alive or duo.mate == null:
		return Vector2.ZERO
	var G := duo.ghost_of(duo.mate)
	var to := Vector3.INF
	var near := 3.0
	if not G.is_empty():
		to = Vector3(G.x, 0, G.z)
		near = 0.8
	elif duo.mate.alive:
		to = duo.mate.position
	if to == Vector3.INF:
		return Vector2(0.7, 0.4)
	var d := Vector2(to.x - me.position.x, to.z - me.position.z)
	return d.normalized() if d.length() > near else Vector2.ZERO

func _autotest_duo_shots(stats: Dictionary) -> void:
	var dir := ""
	for a in DebugArgs.list():
		if a.begins_with("--duoshots="):
			dir = a.substr(11)
	var want := ""
	var mine_g := duo.ghost_of(duo.mate) if duo.mate else {}
	var my_g := duo.my_ghost()
	if state == State.PLAYING and duo.tether_shown() and not stats.has("shot_tether") and me.position.distance_to(duo.mate.position) > 4.0:
		want = "tether"
	elif (float(mine_g.get("p", 0.0)) > 1.0 or float(my_g.get("p", 0.0)) > 1.0) and not stats.has("shot_reviving"):
		want = "reviving"
	elif not my_g.is_empty() and float(my_g.p) == 0.0 and not stats.has("shot_ghost"):
		want = "ghost"
	elif duo.last_revive_ms > 0 and Time.get_ticks_msec() - duo.last_revive_ms > 400 and not stats.has("shot_revived"):
		want = "revived"
	if want == "":
		return
	stats["shot_" + want] = true
	print("DUOSHOT %s me_alive=%s mate_alive=%s ghosts=%s revives=%s" % [want, me.alive, duo.mate.alive if duo.mate else false, duo.ghosts.keys(), duo.revives])
	if dir != "":
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(dir.path_join(want + ".png"))

func _notification(what: int) -> void:
	# battery: a game nobody looks at should not keep the GPU busy
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_WM_WINDOW_FOCUS_OUT:
		Engine.max_fps = 5
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN or what == NOTIFICATION_WM_WINDOW_FOCUS_IN:
		_apply_power_profile()
	elif what == NOTIFICATION_WM_GO_BACK_REQUEST:
		# Android back (application/config/quit_on_go_back is off): Escape, so it closes the open
		# overlay, leaves the lobby or opens the pause card in a match, like the web's history back
		for pressed in [true, false]:
			var e := InputEventKey.new()
			e.keycode = KEY_ESCAPE
			e.physical_keycode = KEY_ESCAPE
			e.pressed = pressed
			Input.parse_input_event(e)

func _apply_power_profile() -> void:
	# fps cap here; render scale / MSAA / shadows / particle density live in Quality (world agent)
	Engine.max_fps = Settings.max_fps()
	if Settings.gfx != "auto" and Settings.gfx != "custom":
		Quality.set_level(Settings.gfx)
	Quality.set_saver(Settings.saver)  # WORLD hook

func _build_scene() -> void:
	cam = Camera3D.new()
	cam.fov = 40      # src/main.js PerspectiveCamera(40, aspect, 0.5, 260), vertical like three's
	cam.near = 0.5
	cam.far = 260.0
	cam.current = true
	add_child(cam)
	cam.position = Lighting.CAM_OFFSET
	cam.look_at(Vector3(0, 0.5, 0))
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
	add_child(Sight.new(self))   # line-of-sight dimming (sight.gd, src/sight.js)
	duo = Duo.new()
	duo.main = self
	duo.audio = audio
	add_child(duo)
	add_child(WebPerf.new())   # web: WebGL state filter, frame-rate keeper; ?perf probe (web_perf.gd)

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	ui = Control.new()
	ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(ui)
	touch = TouchControls.new()
	touch.visible = false
	touch.super_pressed.connect(func(): super_seq += 1)
	ui.add_child(touch)
	hud_ui = Hud.new()   # HUD hook
	ui.add_child(hud_ui)
	hud_ui.setup(net, cam, self, touch)
	hud_ui.menu_requested.connect(_result_menu)
	hud_ui.options_requested.connect(func(): settings_view.open())
	hud_ui.play_again.connect(_result_again)
	hud_ui.duo = duo
	var duo_hud := DuoHud.new()   # partner card, arrow, ghost message (over the Hud)
	duo_hud.duo = duo
	duo_hud.hud = hud_ui
	duo_hud.cam = cam
	hud_ui.add_child(duo_hud)
	hud = Label.new()
	hud.visible = false   # HUD hook: replaced by hud_ui
	hud.position = Vector2(20, 12)
	hud.add_theme_font_size_override("font_size", 22)
	ui.add_child(hud)
	status = Label.new()
	status.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	status.offset_top = 70
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status.mouse_filter = Control.MOUSE_FILTER_IGNORE
	Fonts.use_display(status, 44)
	status.add_theme_color_override("font_color", Color.WHITE)
	status.add_theme_constant_override("outline_size", 10)
	status.add_theme_color_override("font_outline_color", UiKit.INK)
	status.add_theme_color_override("font_shadow_color", UiKit.INK)
	status.add_theme_constant_override("shadow_offset_x", 0)
	status.add_theme_constant_override("shadow_offset_y", 5)
	status.add_theme_constant_override("shadow_outline_size", 10)
	ui.add_child(status)
	rank_label = Label.new()
	rank_label.set_anchors_preset(Control.PRESET_CENTER)
	rank_label.position = Vector2(-190, 190)
	rank_label.custom_minimum_size = Vector2(380, 0)
	rank_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rank_label.add_theme_font_size_override("font_size", 22)
	rank_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	rank_label.add_theme_constant_override("outline_size", 6)
	rank_label.visible = false
	ui.add_child(rank_label)
	showcase = MenuShowcase.new()
	add_child(showcase)
	showcase.setup(cam, env, sun)
	_build_screens()
	# the options screen and the FPS badge sit over every screen (a layer above the menus, which are
	# rebuilt when the language changes)
	var top := CanvasLayer.new()
	top.layer = 5
	add_child(top)
	_fps_label = Label.new()
	_fps_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fps_label.visible = false
	top.add_child(_fps_label)
	settings_view = SettingsView.new()
	settings_view.changed.connect(_on_setting)
	settings_view.closed.connect(func(): _nav_restore())
	# Escape on the home screen: resume, options, quit the game (native builds)
	home_menu = PauseView.new()
	home_menu.home = true
	home_menu.options.connect(func(): settings_view.open())
	home_menu.quit.connect(func(): get_tree().quit())
	top.add_child(home_menu)
	top.add_child(settings_view)

# The three full screens; rebuilt when the language changes.
func _build_screens() -> void:
	for n in [menu, lobby, result, matchload]:
		if n != null:
			(n as Node).queue_free()
	menu = MainMenu.new()
	menu.profile = profile
	menu.quick_play.connect(func(): UiKit.click(); _quick_play())   # (MenuTap presses click once)
	menu.create_room.connect(func(): UiKit.click(); _open_room(_random_code(), false))
	menu.join_room.connect(func(code: String): UiKit.click(); _open_room(code, false))
	menu.queue_bots.connect(func(): mm.bots())
	menu.queue_cancel.connect(_cancel_queue)
	menu.settings_changed.connect(_on_settings_changed)
	menu.open_settings.connect(func(): settings_view.open())
	menu.profile_changed.connect(_send_pick)
	menu.solo_play.connect(func(): UiKit.click(); _auto_start = true; _open_room(_random_code(), false))
	menu.training.connect(func(): UiKit.click(); _open_room(_random_code(), false))
	menu.showcase_changed.connect(func(): showcase.refresh())
	ui.add_child(menu)
	lobby = Lobby.new()
	lobby.leave.connect(_leave_room)
	lobby.start.connect(func(): UiKit.click(); net.send({"t": "start"}))
	lobby.map_picked.connect(func(m: String): net.send({"t": "map", "map": m}))
	lobby.mode_picked.connect(func(m: String): net.send({"t": "mode", "mode": m}))
	lobby.chaos_toggled.connect(func(on: bool): net.send({"t": "chaos", "on": on}))
	lobby.kick.connect(func(id: String): net.send({"t": "kick", "id": id}))
	lobby.report.connect(func(id: String, reason: String): net.send({"t": "report", "id": id, "reason": reason}))
	lobby.brawler_picked.connect(func(_k: String): _send_pick())
	lobby.my_id = net.id
	ui.add_child(lobby)
	result = ResultView.new()
	result.again.connect(_result_again)
	result.menu.connect(_result_menu)
	result.spectate.connect(func(): result.hide_result(); hud_ui.result_open = false)
	ui.add_child(result)
	matchload = MatchLoad.new()
	ui.add_child(matchload)
	_show_screen()

func _on_settings_changed() -> void:
	_apply_power_profile()
	Settings.apply_audio()
	_show_screen()   # the battery saver turns the menu's live arena off / on
	var want := Settings.lang if Settings.lang != "" else I18n.detect()
	if want != I18n.lang:
		I18n.use(want)
		_build_screens()
		if settings_view:
			settings_view.rebuild()
	profile.fetch()

# A change made on the options screen (settings_view.gd) that main.gd applies.
func _on_setting(key: String) -> void:
	match key:
		"lang":
			var want := Settings.lang if Settings.lang != "" else I18n.detect()
			if want != I18n.lang:
				I18n.use(want)
				_build_screens()
				settings_view.rebuild()
		"gfx", "saver", "fps_cap":
			_apply_power_profile()
			_show_screen()   # the battery saver turns the menu's live arena off / on
		"icon":
			_send_pick()
		"server":
			profile.fetch()

func _random_code() -> String:
	var a := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var s := ""
	for i in 4:
		s += a[randi() % a.length()]
	return s

# ---------------------------------------------------------------- state and screens

func _set_state(s: State) -> void:
	state = s
	if home_menu and s != State.MENU:
		home_menu.visible = false   # (a queue match, an invite) the home Escape menu never covers a room or a match
	_show_screen()

func _show_screen() -> void:
	if menu == null:
		return
	var in_menu := state == State.MENU or state == State.QUEUE
	menu.visible = in_menu
	lobby.visible = state == State.LOBBY
	if state != State.OVER and state != State.LOBBY:
		result.hide_result()
		hud_ui.result_open = false
	if not (state == State.LOADING or state == State.COUNTDOWN or state == State.PLAYING):
		matchload.hide_load()
	var in_match := state == State.LOADING or state == State.COUNTDOWN or state == State.PLAYING or state == State.OVER
	touch.visible = in_match and DisplayServer.is_touchscreen_available()
	hud.visible = false   # HUD hook: hud_ui draws the in-match HUD
	if state != State.OVER:
		rank_label.visible = false
	status.visible = (in_match or state == State.LOBBY) and state != State.LOADING and state != State.COUNTDOWN   # the loading screen says it
	showcase.set_active((in_menu or state == State.LOBBY) and not Settings.saver)   # MENU hook: the arena behind the home screen and the room
	menu.set_backdrop(showcase.active)
	get_viewport().disable_3d = not in_match and not showcase.active   # nothing to draw behind the lobby: save the battery

# ---------------------------------------------------------------- quick play (matchmaking)

func _quick_play() -> void:
	if state != State.MENU:
		return
	var key := Settings.brawler
	var err := mm.start(Settings.server_url(), Settings.display_name(), key, Settings.loadout_of(key), Settings.mode)
	if err != OK:
		menu.toast(I18n.t("err.unreachable"))
		return
	_set_state(State.QUEUE)
	menu.show_queue(true)

func _cancel_queue() -> void:
	mm.cancel()
	menu.show_queue(false)
	_set_state(State.MENU)

func _on_matched(code: String) -> void:
	menu.show_queue(false)
	menu.toast(I18n.t("mm.found"))
	_open_room(code, true)

func _on_mm_failed(msg: String, code: String) -> void:
	menu.show_queue(false)
	_set_state(State.MENU)
	menu.toast(_error_text({"msg": msg, "code": code}), 6.0)

# ---------------------------------------------------------------- rooms

func _open_room(code: String, matchmade: bool) -> void:
	_room_code = code
	_vs_bots = _auto_start
	_room_matchmade = matchmade
	_room_msg = {}
	_retries = 0
	_connect_room()

func _connect_room() -> void:
	var key := Settings.brawler
	var err := net.connect_room(Settings.server_url(), _room_code, Settings.display_name(), key, Settings.loadout_of(key), Settings.cos_string())
	if err != OK:
		_to_menu(I18n.t("err.unreachable"))
		return
	_leaving = false
	_in_match_room = true
	audio.play_music("lobby")   # AUDIO HOOK
	menu.close_overlays()
	lobby.my_id = ""
	lobby.show_room(_room_code, {"players": [], "matchmade": _room_matchmade})
	_set_state(State.LOBBY)
	status.text = I18n.t("g.connecting")

func _leave_room() -> void:
	_leaving = true
	_in_match_room = false
	net.close()
	_room_code = ""
	_to_menu("")

func _send_pick() -> void:
	if _in_match_room and net.connected:
		var key := Settings.brawler
		net.send({"t": "pick", "brawler": key, "lo": Settings.loadout_of(key), "cos": Settings.cos_string()})

func _on_net_closed() -> void:
	if _leaving or not _in_match_room:
		return
	if state == State.LOBBY and _retries < 3 and _room_code != "":
		# a room that is still alive takes us back (a new socket: same code, new id)
		_retries += 1
		lobby.toast(I18n.t("g.reconnecting", {"n": _retries}), 2.0)
		await get_tree().create_timer(1.5).timeout
		if state == State.LOBBY and not net.connected and not _leaving:
			_connect_room()
		return
	_in_match_room = false
	_to_menu(I18n.t("g.connLost"))

var _last_err: Dictionary = {}   # (autotest) the last {t:"error"} / {t:"kicked"}

func _to_menu(msg: String) -> void:
	if DebugArgs.has("autotest") and msg != "":
		print("AUTOTEST to menu: %s (state %d, last error %s)" % [msg, state, _last_err])
	_auto_start = false
	_clear_match()
	audio.stop_jingle()   # AUDIO HOOK
	audio.set_danger(0.0)
	audio.play_music("menu")
	_in_match_room = false
	mm.cancel()
	menu.show_queue(false)
	_set_state(State.MENU)
	status.text = ""
	menu.toast(msg, 6.0)
	profile.fetch()

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
	_my_place = 0
	_winner = ""
	_ranked_text = ""
	_match_done = false
	_result_shown = false
	hud_ui.end_match()   # HUD hook
	duo.end()
	rank_label.visible = false

func _error_text(m: Dictionary) -> String:
	match String(m.get("code", "")):
		"full": return I18n.t("err.full")
		"outdated": return I18n.t("err.outdatedApp" if OS.get_name() in ["Android", "iOS"] else "err.outdated")
		"refused": return I18n.t("g.refused")
		"kicked": return I18n.t("mod.kicked.leader")
		"cheat": return I18n.t("mod.kicked.cheat")
	if String(m.get("msg", "")) == "Room is full":
		return I18n.t("err.full")
	var s := String(m.get("msg", ""))
	return s if s != "" else I18n.t("err.unreachable")

# ---------------------------------------------------------------- result flow

func _show_result() -> void:
	if state != State.OVER:
		return
	var won := me != null and _winner == me.id
	if me != null and not won and _winner != "":   # Duo: the winner may be your partner (game.js ally())
		var rows: Dictionary = result._rows
		var mine = rows.get(String(me.id), {}).get("team", null)
		won = mine != null and rows.get(_winner, {}).get("team", null) == mine
	# HUD hook: the Hud draws the K.O. / victory overlay (with Play again / Menu); the ranked-points
	# text goes under it. result_view.gd is no longer shown at the end of a match.
	if not _result_shown and me != null:
		# XP, Slop Coins and Bot League trophies of this match (the web's awardMatch, meta_profile.gd)
		var st: Dictionary = result._stats.get(String(me.id), {})
		var place := 1 if won else maxi(_my_place, 1)
		# Duo: 1st-4th team; progression counts them like 1st, 3rd, 5th and 7th of 8 (main.js onResult)
		MetaProfile.award_match(place * 2 - 1 if result.duo else place, int(st.get("kos", 0)), won, Settings.brawler, _vs_bots)
	_result_shown = true
	# the web's #result: SPECTATE while the others still fight, PLAY AGAIN / MENU once it is over
	var over := _winner != "" or _match_done
	if over:
		result.match_ended()
	status.text = ""
	result.show_result(1 if won else maxi(_my_place, 1), won, over)
	hud_ui.result_open = true
	_update_rank_label()
	_debug_shot("resultshot", 1.6)

# Screenshot checks of the real flow: --resultshot=<png> / --countshot=<png> (saved once, after `wait` s).
var _shots_done: Dictionary = {}
func _debug_shot(flag: String, wait: float) -> void:
	for a in DebugArgs.list():
		if a.begins_with("--%s=" % flag) and not _shots_done.has(flag):
			_shots_done[flag] = true
			await get_tree().create_timer(wait).timeout
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png(a.substr(flag.length() + 3))
			print("DEBUGSHOT %s" % flag)

# The ranked line of the result screen (matchmade matches): pending until {t:"ranked"} arrives.
func _update_rank_label() -> void:
	rank_label.visible = false   # (old label, replaced by the result screen's .res-rank line)
	result.set_rank_text(_ranked_text if _ranked_text != "" else (I18n.t("rank.pending") if _room_matchmade else ""))

func _winner_name() -> String:
	var f: Fighter = fighters.get(_winner)
	return f.fname if f else "?"

func _result_again() -> void:
	result.hide_result()
	hud_ui.result_open = false
	rank_label.visible = false
	if _room_matchmade:
		# a matchmade room is over: queue again with the same choices
		_leave_room()
		_quick_play()
	else:
		_clear_match()
		_set_state(State.LOBBY)
		audio.stop_jingle()   # AUDIO HOOK
		audio.set_danger(0.0)
		audio.play_music("lobby")
		lobby.show_room(_room_code, _room_msg)

func _result_menu() -> void:
	_leave_room()

# Escape / gamepad B: back out of the lobby (the menu closes its own overlays; in a match the Hud's
# pause card answers the pause key).
func _unhandled_input(ev: InputEvent) -> void:
	if not ev.is_action_pressed("ui_cancel"):
		return
	match state:
		State.MENU:   # the menu closed its own overlays first (it handles them before us)
			if settings_view.visible:
				return
			home_menu.visible = not home_menu.visible
			get_viewport().set_input_as_handled()
		State.LOBBY:
			_leave_room()
		State.LOADING, State.COUNTDOWN, State.PLAYING:
			pass   # in a match the Hud's own pause box handles Escape / P

# ---------------------------------------------------------------- network

func _on_message(m: Dictionary) -> void:
	match m.get("t", ""):
		"welcome":
			_retries = 0
			lobby.my_id = net.id
			status.text = ""
		"room":
			_room_msg = m
			var in_match_now := state == State.LOADING or state == State.COUNTDOWN or state == State.PLAYING or state == State.OVER
			if state == State.LOBBY:
				lobby.my_id = net.id
				lobby.show_room(net.code, m)
				# SOLO: decide once, on the first room message after welcome. Not the leader (the code
				# was taken): stay as a normal lobby, never start someone else's room later on.
				if _auto_start and net.id != "":
					var go := lobby.is_leader and not net.matchmade
					_auto_start = false
					if go:   # your picks, then go (bots fill the room)
						if Settings.map != "random":
							net.send({"t": "map", "map": Settings.map})
						net.send({"t": "mode", "mode": Settings.mode})
						net.send({"t": "chaos", "on": Settings.chaos})
						net.send({"t": "start"})
			elif in_match_now and not bool(m.get("inMatch", true)):
				_match_over()
		"start":
			_start_match(m)
			result.begin_match(m.get("roster", []), net.id)
			matchload.show_load(String(m.get("map", "")), m.get("roster", []), net.id)
		"lprog":
			matchload.set_progress(String(m.get("id", "")), float(m.get("p", 0)))
		"go":
			_last_count = 0   # AUDIO HOOK
			count_left = float(m.get("in", 3000)) / 1000.0
			_set_state(State.COUNTDOWN)
		"snap":
			_apply_snap(m)
			hud_ui.on_snapshot(m)   # HUD hook
		"ev":
			for e in m.list:
				result.track(e)   # the result screen's stats / podium
				if _hold_attack(e):
					continue
				_apply_event(e)
				hud_ui.on_event(e)   # HUD hook
		"ranked":
			_ranked_text = profile.apply_ranked(m)
			if state == State.OVER:
				if _result_shown:
					_update_rank_label()
				else:
					_show_result()
		"reported":
			lobby.toast(I18n.t("mod.reported") if bool(m.get("ok", false)) else I18n.t("err.unreachable"))
		"kicked":
			_last_err = m
			_leaving = true
			net.close()
			_to_menu(_error_text(m))
		"error":
			_last_err = m
			if state == State.LOBBY or state == State.MENU or state == State.QUEUE:
				_leaving = true
				net.close()
				_to_menu(_error_text(m))
			else:
				status.text = _error_text(m)

# Duo: our partner revived us (duo.gd revive): back in the match.
func _on_duo_revived() -> void:
	_knock = Vector2.ZERO
	_cam_target = null
	status.text = ""
	if state == State.OVER and _winner == "" and not _match_done:
		result.hide_result()
		hud_ui.result_open = false
		_result_shown = false
		_set_state(State.PLAYING)

# The server ended the match (someone won, or the time ran out): show the result once.
func _match_over() -> void:
	_match_done = true
	if state == State.OVER and _result_shown:
		_show_result()   # now PLAY AGAIN / MENU (and the podium)
		return
	if state == State.OVER:
		if not _result_shown and me != null and _winner != "":
			_show_result()
		return
	_set_state(State.OVER)
	_show_result()

func _start_match(m: Dictionary) -> void:
	_clear_match()
	_set_state(State.LOADING)
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
	_held_atk.clear()
	feel.reset()   # FEEL
	Feel.current = feel
	_cam_target = null
	_knock = Vector2.ZERO
	duo.begin(m.roster, fighters, me, arena)   # before the HUD: it counts the teams
	hud_ui.begin_match(m, arena, fighters)   # HUD hook
	_final_music = false   # AUDIO HOOK: the map theme (+ weather bed) starts with the match
	_me_hp = -1.0
	audio.play_music("m_" + String(m.map))
	status.text = "%s: %s" % [map_data.name, I18n.t("g.get_ready")]
	net.send({"t": "lprog", "p": 100})
	net.send({"t": "loaded"})

var _vislog := DebugArgs.has("vislog")   # debug: print who the server shows / hides, attacks from hidden shooters
# 'atk' events from brawlers the server hides from us [{e, at}]. The server sends each player only
# the brawlers it can see (game.js netTick: a bush, a wall or prop tile, the fog, sight range), but
# every attack to everyone; a hidden shooter's position here is where it was last seen (or its spawn),
# so replaying its attack at once draws shots out of empty ground, all over the map (bots fighting
# far away) and gives away roughly where a hidden enemy is. So the attack waits for the next snapshot:
# a shooter revealed by its own shot (out of a bush) is replayed from where it really is, the bullets
# that much further along; one still hidden after HOLD_ATK shows only what lands where it aimed
# (fx.gd late_attack), and makes no sound (combat.js: what you cannot see you do not hear).
const HOLD_ATK := 0.25
var _held_atk: Array = []

func _hold_attack(e: Dictionary) -> bool:
	if e.get("e", "") != "atk":
		return false
	var f: Fighter = fighters.get(e.get("id", ""))
	if f == null or f == me or not f.alive or not f.hidden_by_server:
		return false
	if _vislog:
		print("VIS t=%.2f atk-held %s d_me=%.1f" % [Time.get_ticks_msec() / 1000.0, f.id, me.position.distance_to(f.position) if me else -1.0])
	_held_atk.append({"e": e, "at": Time.get_ticks_msec() / 1000.0})
	return true

# After each snapshot: replay the held attacks whose shooter now shows, give up on the others.
func _flush_attacks() -> void:
	var now := Time.get_ticks_msec() / 1000.0
	var k := 0
	while k < _held_atk.size():
		var h: Dictionary = _held_atk[k]
		var e: Dictionary = h.e
		var f: Fighter = fighters.get(e.get("id", ""))
		var age: float = now - float(h.at)
		if f == null or not f.alive:
			_held_atk.remove_at(k)
		elif not f.hidden_by_server:
			_held_atk.remove_at(k)
			if _vislog:
				print("VIS t=%.2f atk-late %s lead=%.2f" % [now, f.id, age])
			_apply_event(e)
			if hud_ui.fx:
				hud_ui.fx.late_attack(e, age, false)
		elif age >= HOLD_ATK:
			_held_atk.remove_at(k)
			if _vislog:
				print("VIS t=%.2f atk-blind %s" % [now, f.id])
			if hud_ui.fx:
				hud_ui.fx.late_attack(e, age, true)
		else:
			k += 1

# --vislog: why the server probably hid that brawler from us (game.js canSee, from our own position).
func _vis_why(f: Fighter) -> String:
	if me == null or arena == null:
		return "?"
	var a := me.position
	var b := f.position
	if a.distance_to(b) > 14.0:
		return "range"
	var dx := b.x - a.x
	var dz := b.z - a.z
	var l := maxf(Vector2(dx, dz).length(), 1e-4)
	var out := ""
	for side in [0.0, 0.5, -0.5]:
		var tx: float = b.x - dz / l * side
		var tz: float = b.z + dx / l * side
		var n := ceili(Vector2(tx - a.x, tz - a.z).length() / 0.45)
		var hit := "-"
		for k in range(1, n):
			var c := arena.char_at(a.x + (tx - a.x) * k / n, a.z + (tz - a.z) * k / n)
			if GameData.SHOT_BLOCK.contains(c):
				hit = c
				break
		out += hit
	if not out.contains("-"):
		return "los:" + out
	return "bush" if arena.is_bush(b.x, b.z) else "open:" + out

func _apply_snap(m: Dictionary) -> void:
	var seen := {}
	for r in m.b:
		var f: Fighter = fighters.get(r[0])
		if f == null:
			continue
		if not f.alive:
			duo.revived_in_snap(f, float(r[1]), float(r[2]))   # Duo: back up (game.js applySnap)
		seen[r[0]] = true
		if _vislog and f.hidden_by_server and f != me:
			print("VIS t=%.2f show %s jump=%.2f d_me=%.1f" % [Time.get_ticks_msec() / 1000.0, f.id, f.position.distance_to(Vector3(r[1], 0, r[2])), me.position.distance_to(Vector3(r[1], 0, r[2])) if me else -1.0])
		f.apply_row(r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9])   # before the flag: a reappearing brawler snaps
		f.hidden_by_server = false
	for id in fighters:
		if not seen.has(id) and fighters[id] != me:
			if _vislog and not fighters[id].hidden_by_server and fighters[id].alive:
				print("VIS t=%.2f hide %s d_me=%.1f why=%s" % [Time.get_ticks_msec() / 1000.0, id, me.position.distance_to(fighters[id].position) if me else -1.0, _vis_why(fighters[id])])
			fighters[id].hidden_by_server = true   # in a bush / fog: the server does not tell us
	duo.after_snap(m)
	_flush_attacks()
	_audio_snap()   # AUDIO HOOK
	if me and m.has("me") and int(m.me[2]) != fix_seen:
		# the server refused one of our moves: snap back to where it says
		fix_seen = int(m.me[2])
		me.position = Vector3(m.me[0], 0, m.me[1])

func _apply_event(e: Dictionary) -> void:
	if arena:
		arena.on_event(e)  # WORLD hook
	var f: Fighter = fighters.get(e.get("id", ""))
	if e.get("e", "") == "kill":
		duo.on_kill(e, f)   # Duo: ghost where it fell (before the fall moves it)
	duo.on_event(e)   # Duo: revive progress, revives, ghosts gone, pings
	_feel_event(e)   # FEEL: turning, Shoot / Super clips, kicks, punches, hit ladder, K.O. beat
	match e.get("e", ""):
		"atk":
			if f:
				audio.play(("super_" if e.get("s", false) else "atk_") + String(f.type.key), f.position)   # AUDIO HOOK
				if e.get("s", false) and f == me:
					audio.duck()
		"kill":
			if f:
				if f.visible or f == me:   # game.js killFx: no sound for a K.O. you cannot see
					audio.play("death", f.position)   # AUDIO HOOK
				f.alive = false
				if fighters.get(e.get("by", "")) == me and f != me:
					audio.play("kill")
					audio.duck()
			# Duo: knocked out while your partner stands, you wait for a revive (no result yet); your
			# partner's K.O. with a rank puts your whole team out (game.js duoKo)
			var waiting := f == me and duo.waiting()
			var team_out := f != null and f != me and duo.ally(f, me) and not me.alive and int(e.get("rank", 0)) > 0
			if f == me:
				audio.set_danger(0.0)
				if not waiting:
					audio.play("lose")
			elif team_out:
				audio.play("lose")
			if ((f == me and not waiting) or team_out) and state != State.OVER:
				_my_place = int(e.get("rank", 0))
				_set_state(State.OVER)
				status.text = I18n.t("g.ko", {"rank": _my_place})
				await get_tree().create_timer(1.2).timeout   # let the K.O. play before the result
				_show_result()
		"win":
			_winner = String(e.get("id", ""))
			var ours := f == me or duo.ally(f, me)   # Duo: your partner's win is yours
			if ours:
				_my_place = 1
				audio.play("win")   # AUDIO HOOK
			if state != State.OVER:
				_set_state(State.OVER)
				status.text = I18n.t("result.victory") if ours else I18n.t("g.wins", {"name": f.fname if f else "?"})
				await get_tree().create_timer(1.2).timeout
				_show_result()
			elif _result_shown:
				_show_result()   # already out: the panel now says who won
		"wall":
			if arena:
				arena.break_tile(int(e.i), int(e.j))
				audio.play("break", _tile_world(int(e.i), int(e.j)))   # AUDIO HOOK
		"crate":
			if arena:
				arena.break_tile(int(e.i), int(e.j))
				audio.play("crate", _tile_world(int(e.i), int(e.j)))   # AUDIO HOOK
		"pick":   # AUDIO HOOK
			if fighters.get(e.get("by", "")) == me:
				audio.play("pickup")

# ---------------------------------------------------------------- frame

func _process(delta: float) -> void:
	Controls.poll(delta)
	_global_keys()
	_pad_menus()
	_update_fps(delta)
	_update_projectiles(delta)
	if arena:
		arena.update(delta)
	if state == State.COUNTDOWN:
		count_left -= delta
		if ceili(maxf(count_left, 0.0)) != _last_count and count_left > 0.0:   # AUDIO HOOK
			_last_count = ceili(count_left)
			matchload.count(_last_count)   # 3-2-1 popping on the loading screen
			_debug_shot("countshot", 0.3)
			audio.play("tick")
		if count_left <= 0.0:
			audio.play("go")   # AUDIO HOOK
			if DebugArgs.has("realinput"):
				print("AUTOTEST-PLAYING")
			matchload.finish()   # FIGHT!, then the loading screen fades out
			_set_state(State.PLAYING)
			status.text = ""
	if me == null or arena == null:
		return
	feel.playing = state == State.PLAYING
	if state == State.PLAYING and me.alive:
		_control(delta)
	else:
		super_aiming = false
	if (state == State.COUNTDOWN or state == State.PLAYING or state == State.OVER) and not settings_view.visible:
		hud_ui.shortcuts(aim_point)   # gadget, emote wheel, ping, pause (bound keys + gamepad)
	_follow_camera(delta)   # also sets audio.listener (the camera focus, like the web)
	_heartbeat(delta)

func _control(delta: float) -> void:
	# a menu over the match (pause card, options) takes the keys / pad: stand still, hold fire
	var blocked := result.visible or hud_ui.pause_open() or settings_view.visible
	var mv := touch.move if touch.visible else Vector2.ZERO
	var kb := Controls.move()   # bound keys (W A S D = Z Q S D on AZERTY), arrows, D-pad, left stick
	if kb != Vector2.ZERO:
		mv = kb
	if blocked:
		mv = Vector2.ZERO
	last_move = mv
	# FEEL: walking like brawler.js on the client (the server checks every step: game.js checkMove).
	# Frozen / rooted / stunned stand still and slowed walks at 55 %, or the server refuses the moves
	# (and kicks after 25); kit.step_local eases the speed in and out (acceleration 16 /s, 2.4 on ice)
	# and moves us itself until we are at speed; a push from the server ('knock' event) slides us and
	# fades (e^-7t), the server allowing for it.
	var mul := 0.0 if (me.flags & (8 | 16 | 32)) != 0 else (0.55 if (me.flags & 4) != 0 else 1.0)
	var step := _knock
	if not arena.world_step(me, mv, delta):  # WORLD hook (ice, jump pads, easing: it moved me)
		step += mv * float(me.type.speed) * mul
	_knock *= exp(-7.0 * delta)
	if _knock.length_squared() < 0.01:
		_knock = Vector2.ZERO
	if step.length_squared() > 1e-6:
		me.position = arena.collide_circle(me.position + Vector3(step.x, 0, step.y) * delta, me.radius)
	var firing := false
	var R := float(me.type.range)
	if Controls.using_pad:
		# twin-stick (game.js controlPlayer): the right stick aims and its tilt sets the throw
		# distance; without it the aim follows the walk, or (aim assist) the nearest foe in reach
		firing = Controls.attack_held() and not blocked
		var r := Controls.stick_r()
		if r.length_squared() > 0.09:
			aim_dir = r.normalized()
			aim_dist = 2.0 + minf(1.0, r.length()) * (R - 2.0)
		elif firing and Settings.aim_assist and _assist_aim(R):
			pass
		elif mv.length_squared() > 0.05 and not firing:
			aim_dir = mv.normalized()
			aim_dist = R * 0.7
	elif touch.visible:
		# touch.js / game.js: a dragged stick aims; a quick tap aims at the nearest enemy you can see;
		# otherwise the aim follows the walk (so a released stick never leaves you facing backwards)
		if touch.auto_aim:
			touch.auto_aim = false
			var foe := _nearest_foe()
			if foe:
				var d := Vector2(foe.position.x - me.position.x, foe.position.z - me.position.z)
				aim_dir = d.normalized() if d.length() > 1e-3 else aim_dir
				aim_dist = minf(d.length(), R)
		elif touch.aim.length() > 0.25:
			aim_dir = touch.aim.normalized()
			aim_dist = 2.0 + minf(1.0, touch.aim.length()) * (R - 2.0)
		elif mv.length_squared() > 0.05 and not touch.firing:
			aim_dir = mv.normalized()
			aim_dist = R * 0.7
		firing = touch.firing and not blocked
	else:
		var hit = _mouse_ground()
		if hit != null:
			var d: Vector3 = hit - me.position
			var l := Vector2(d.x, d.z).length()
			if l > 0.3:
				aim_dir = Vector2(d.x, d.z).normalized()
			aim_dist = l
		firing = Controls.attack_held() and not blocked
	# the super (input.js superFired): its key / RB, or a released right click / LT, once it is charged
	var charged := me.super_charge >= 0.999
	if charged and not blocked and Controls.super_fired():
		super_seq += 1
	super_aiming = charged and not blocked and not touch.visible and Controls.super_aim_held()
	if aim_dir != Vector2.ZERO and firing:
		me.face(aim_dir.x, aim_dir.y)   # fighter.gd turns to it (the server's attack echo comes later)
	if aim_dist <= 0.0:
		aim_dist = R
	aim_point = me.position + Vector3(aim_dir.x, 0, aim_dir.y) * aim_dist
	send_t -= delta
	if send_t <= 0.0:
		send_t = 1.0 / SEND_HZ
		net.send(hud_ui.fill_input({"t": "in", "x": snappedf(me.position.x, 0.01), "z": snappedf(me.position.z, 0.01),
			"ax": snappedf(aim_dir.x, 0.01), "az": snappedf(aim_dir.y, 0.01),
			"px": snappedf(aim_point.x, 0.01), "pz": snappedf(aim_point.z, 0.01),
			"f": 1 if firing else 0, "s": super_seq, "g": 0, "gx": snappedf(aim_dir.x, 0.01), "gz": snappedf(aim_dir.y, 0.01),
			"em": 0, "ei": -1}))   # HUD hook (g/em/ei/ping come from hud_ui)

# Gamepad aim assist: firing without the right stick aims at the nearest foe you can see within reach
# (what a tap does on a touch screen). Help on the client side only: the server checks every attack.
func _assist_aim(R: float) -> bool:
	var foe := _nearest_foe()
	if foe == null:
		return false
	var d := Vector2(foe.position.x - me.position.x, foe.position.z - me.position.z)
	if d.length() < 1e-3 or d.length() > R + 1.0:
		return false
	aim_dir = d.normalized()
	aim_dist = minf(d.length(), R)
	return true

func _mouse_ground() -> Variant:
	var mp := get_viewport().get_mouse_position()
	var from := cam.project_ray_origin(mp)
	var dir := cam.project_ray_normal(mp)
	if absf(dir.y) < 1e-4:
		return null
	var t := -from.y / dir.y
	return from + dir * t if t > 0 else null

# src/game.js updateCamera: the focus glides to the player plus a look-ahead (toward the aim, else
# the walk), kept off the outer walls; the camera sits at Lighting.CAM_OFFSET from it (fov 40, ~47
# degree pitch), zoomed out a little for the last three and in while lurking in a bush.
var cam_focus := Vector3(0, 0, 4)
var _bush_idle := 0.0
# FEEL (feel.js + game.js updateCamera): trauma shake, zoom punches, the final-K.O. orbit; once you
# are out the camera follows your killer (else anyone still standing), slower (2.2 /s instead of 6).
var feel := Feel.new()
var _cam_target: Fighter
var _knock := Vector2.ZERO         # a push from the server ('knock' event), fading
var _heart_t := 0.0

func _follow_camera(delta: float) -> void:
	var F := feel
	var tgt: Fighter = me
	if not me.alive:
		var mate_cam := duo.cam_target()   # Duo: watch your partner
		if mate_cam:
			_cam_target = mate_cam
		if _cam_target == null or not is_instance_valid(_cam_target) or not _cam_target.alive:
			_cam_target = null
			for f in fighters.values():
				if f.alive and f.visible:
					_cam_target = f
					break
		if _cam_target:
			tgt = _cam_target
	var look := Vector2.ZERO
	if tgt == me and me.alive:
		var aiming := not touch.visible or touch.aim.length() > 0.3
		if aiming and aim_dir != Vector2.ZERO:
			look = aim_dir.normalized() * minf(2.6, 0.18 * float(me.type.range))
		elif last_move.length_squared() > 0.05:
			look = last_move.normalized() * 1.2
	F.look += (look - F.look) * (1.0 - exp(-delta / 0.25))
	var lim := GameData.HALF
	var want := Vector3(clampf(tgt.position.x + F.look.x, -(lim - 9.0), lim - 9.0), 0.0,
		clampf(tgt.position.z + F.look.y, -(lim - 11.0), lim - 6.0))
	var speed := 6.0 if tgt == me else 2.2
	cam_focus = want if cam_focus.distance_to(want) > 30.0 else cam_focus.lerp(want, 1.0 - exp(-speed * delta)) # (a new match: cut)
	F.focus = cam_focus
	var zoom := 1.0
	if state == State.PLAYING or (state == State.OVER and _winner == ""):
		var alive := 0
		for id in fighters:
			alive += 1 if fighters[id].alive else 0
		zoom = 1.1 if alive == 2 else (1.06 if alive == 3 else 1.0)
	_bush_idle = _bush_idle + delta if me.alive and arena.is_bush(me.position.x, me.position.z) and last_move.length_squared() < 0.02 else 0.0
	if _bush_idle > 1.5:
		zoom *= 0.94
	F.update(delta, zoom)
	var dist := F.zoom * F.punch
	for a in DebugArgs.list():   # screenshots side by side with the web build: --camfocus=x,z[,zoom]
		if a.begins_with("--camfocus="):
			var v := a.substr(11).split(",")
			cam_focus = Vector3(float(v[0]), 0.0, float(v[1]))
			dist = float(v[2]) if v.size() > 2 else 1.0
			F.trauma = 0.0
	var o := Lighting.CAM_OFFSET
	var ca := cos(F.orbit)
	var sa := sin(F.orbit)
	var sh := F.shake()
	cam.position = cam_focus + Vector3((o.x * ca + o.z * sa) * dist + sh.x, o.y * dist + sh.y, (o.z * ca - o.x * sa) * dist + sh.z)
	cam.look_at(Vector3(cam_focus.x, 0.5, cam_focus.z))
	if sh.w != 0.0:
		cam.rotate_object_local(Vector3(0, 0, 1), sh.w)
	audio.listener = cam_focus   # game.js volumeAt: distances from the camera focus

# game.js nearestFoe: the closest enemy you can see (touch tap auto-aim).
func _nearest_foe() -> Fighter:
	var best: Fighter = null
	var bd := INF
	for f in fighters.values():
		if f == me or not f.alive or not f.visible or duo.ally(f, me):   # (Duo: never your partner)
			continue
		var d := Vector2(f.position.x - me.position.x, f.position.z - me.position.z).length()
		if d < bd:
			bd = d
			best = f
	return best

# FEEL: game feel of the server's events (game.js damageFx / killFx / applyEvents, combat.js attack):
# turning to the attack, the camera kick when you fire, the punch-in of your super, the hit-confirm
# pitch ladder, trauma when you land / take a hit, the K.O. beat, the cheer, the final-K.O. orbit.
func _feel_event(e: Dictionary) -> void:
	var f: Fighter = fighters.get(e.get("id", ""))
	var sup: bool = e.get("e", "") == "atk" and bool(e.get("s", false))   # (in "dmg", "s" is the source id)
	match e.get("e", ""):
		"atk":
			if f == null or not f.alive:
				return
			f.face(float(e.get("dx", 0.0)), float(e.get("dz", 0.0)))
			f.attacked(sup)
			if f == me:
				Feel.kick(float(Feel.FIRE_KICK.get(String(f.type.key) + ("S" if sup else ""), 0.05)))
				if sup:
					feel.punch_to(0.92, 0.3)
				if String(f.type.key) == "blaster" and sup:
					Feel.shake_at(f.position.x, f.position.z, 0.35)
		"dmg":
			if f == null:
				return
			var src: Fighter = fighters.get(e.get("s", ""))
			var w := Feel.weapon(String(src.type.key) if src else "", bool(e.get("u", false)))
			if f == me:
				audio.play("hurt")
				feel.add(float(w[2]))
				Feel.rumble(0.55, 0.35, 140)
			elif src == me and f.visible:
				audio.play("hit_confirm", null, 1.0, 1.0 + feel.next_hit() * 0.07)
				feel.add(float(w[1]))
				Feel.rumble(0.15, 0.3, 40, 80)
		"kill":
			if f == null:
				return
			var by: Fighter = fighters.get(e.get("by", ""))
			if by and by != f and by.alive:
				by.cheer()
				if by.visible:
					audio.play("bark_%s_cheer" % String(by.type.key), by.position, 0.8)
			if f.visible or f == me:
				Feel.shake_at(f.position.x, f.position.z, 0.3)
				if bool(e.get("f", false)):
					audio.play("fall", f.position)
			if by == me and f != me:
				feel.add(0.25)
				feel.punch_to(0.94, 0.25)
				Feel.rumble(0.9, 0.6, 180)
			if f == me:
				feel.add(0.4)
				if by and by != f:
					_cam_target = by
		"win":
			if f:
				f.won = true
			if feel.orbit_want == 0.0:
				audio.play("sting_finalko")
			feel.final_ko()
		"knock":
			if f == me and me.alive:
				_knock = Vector2(float(e.get("x", 0.0)), float(e.get("z", 0.0)))

# game.js lowHealth: under 30 % a heartbeat, faster under 15 % (the music low-pass is _audio_snap's).
func _heartbeat(delta: float) -> void:
	var frac := me.hp / maxf(me.max_hp, 1.0) if me.alive and state == State.PLAYING else 1.0
	if frac >= 0.3:
		_heart_t = 0.0
		return
	_heart_t -= delta
	if _heart_t <= 0.0:
		audio.play("heartbeat", null, 0.8)
		_heart_t = 0.6 if frac < 0.15 else 0.85

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

# ---------------------------------------------------------------- keys, gamepad and menus

# --keytest (with --autotest): real key / gamepad events through Input.parse_input_event, as a player
# would press them (walking stays the normal walk: the server checks it like any other), and what
# each shortcut did. Prints KEYTEST lines.
func _key_test() -> void:
	var press := func(phys: int, hold: float) -> void:
		for down in [true, false]:
			var e := InputEventKey.new()
			e.physical_keycode = phys
			e.keycode = DisplayServer.keyboard_get_keycode_from_physical(phys) if Controls.keymap_known() else phys
			e.pressed = down
			Input.parse_input_event(e)
			if down:
				await get_tree().create_timer(hold).timeout
		await get_tree().create_timer(0.15).timeout
	var pad := func(btn: int) -> void:
		for down in [true, false]:
			var e := InputEventJoypadButton.new()
			e.button_index = btn
			e.pressed = down
			e.device = 0
			Input.parse_input_event(e)
			await get_tree().process_frame
			await get_tree().process_frame
		await get_tree().create_timer(0.15).timeout
	var p0 := me.position
	await press.call(Controls.key_of("right"), 0.5)
	print("KEYTEST move right(%s) dx=%.2f" % [Controls.action_label("right"), me.position.x - p0.x])
	p0 = me.position
	await press.call(Controls.key_of("up"), 0.5)
	print("KEYTEST move up(%s) dz=%.2f" % [Controls.action_label("up"), me.position.z - p0.z])
	var g0 := hud_ui.gad_seq
	await press.call(Controls.key_of("gadget"), 0.05)
	print("KEYTEST gadget(%s) seq %d -> %d" % [Controls.action_label("gadget"), g0, hud_ui.gad_seq])
	await press.call(Controls.key_of("emote"), 0.05)
	print("KEYTEST emote(%s) wheel=%s" % [Controls.action_label("emote"), hud_ui.wheel.visible])
	var e0 := hud_ui.emote_seq
	await press.call(KEY_2, 0.05)
	print("KEYTEST emote pick 2 seq %d -> %d wheel=%s" % [e0, hud_ui.emote_seq, hud_ui.wheel.visible])
	var pg := hud_ui.ping_seq
	await press.call(Controls.key_of("ping"), 0.05)
	print("KEYTEST ping(%s) seq %d -> %d" % [Controls.action_label("ping"), pg, hud_ui.ping_seq])
	var m0 := audio.muted
	await press.call(Controls.key_of("mute"), 0.05)
	print("KEYTEST mute(%s) %s -> %s" % [Controls.action_label("mute"), m0, audio.muted])
	await press.call(Controls.key_of("mute"), 0.05)
	var t0 := Lighting.tod
	await press.call(Controls.key_of("tod"), 0.05)
	print("KEYTEST tod(%s) %.0f -> %.0f" % [Controls.action_label("tod"), t0, Lighting.tod])
	Settings.tod = str(roundi(t0))   # (leave the player's time of day as it was)
	Settings.save()
	await press.call(KEY_ESCAPE, 0.05)
	print("KEYTEST pause(Esc) open=%s" % hud_ui.pause_open())
	await press.call(KEY_ESCAPE, 0.05)
	print("KEYTEST pause(Esc) again open=%s" % hud_ui.pause_open())
	await pad.call(JOY_BUTTON_START)
	print("KEYTEST pad Start open=%s using_pad=%s" % [hud_ui.pause_open(), Controls.using_pad])
	await pad.call(JOY_BUTTON_B)
	print("KEYTEST pad B open=%s" % hud_ui.pause_open())
	g0 = hud_ui.gad_seq
	await pad.call(JOY_BUTTON_LEFT_SHOULDER)
	print("KEYTEST pad LB gadget seq %d -> %d" % [g0, hud_ui.gad_seq])
	pg = hud_ui.ping_seq
	await pad.call(JOY_BUTTON_X)
	print("KEYTEST pad X ping seq %d -> %d" % [pg, hud_ui.ping_seq])
	# options from the pause card, a rebind (gadget -> F), the new key, then the default back
	await press.call(KEY_ESCAPE, 0.05)
	settings_view.open("controls")
	await get_tree().process_frame
	settings_view.call("_activate", 5)   # the gadget row
	await press.call(KEY_F, 0.05)
	print("KEYTEST rebind gadget -> %s (capturing=%s)" % [Controls.action_label("gadget"), Controls.capturing])
	await press.call(KEY_ESCAPE, 0.05)
	print("KEYTEST options closed=%s pause open=%s" % [not settings_view.visible, hud_ui.pause_open()])
	await press.call(KEY_ESCAPE, 0.05)
	await get_tree().create_timer(4.0).timeout   # the gadget lockout
	g0 = hud_ui.gad_seq
	await press.call(KEY_F, 0.05)
	print("KEYTEST gadget(F) seq %d -> %d" % [g0, hud_ui.gad_seq])
	Controls.reset_binds()
	print("KEYTEST reset gadget=%s" % Controls.action_label("gadget"))

# Shortcuts that work on every screen (main.js keydown): M mutes, T (pad Y) changes the time of day.
func _global_keys() -> void:
	if settings_view == null or settings_view.visible or Controls.eaten():
		return
	var f := get_viewport().gui_get_focus_owner()
	if f is LineEdit or f is TextEdit:   # typing a nickname / room code
		return
	if Controls.just("mute"):
		audio.toggle_mute()
	if Controls.just("tod"):
		Settings.tod = str((roundi(Lighting.tod) + 1) % 4)   # main.js nextTimeOfDay
		Settings.save()

func _update_fps(delta: float) -> void:
	if _fps_label == null:
		return
	_fps_label.visible = Settings.show_fps
	if not Settings.show_fps:
		return
	_fps_t -= delta
	if _fps_t > 0.0:
		return
	_fps_t = 0.5
	var k := UiKit.css_scale(get_viewport())
	_fps_label.text = "%d FPS" % roundi(Engine.get_frames_per_second())
	_fps_label.add_theme_font_override("font", Fonts.display())
	_fps_label.add_theme_font_size_override("font_size", roundi(14.0 * k))
	_fps_label.add_theme_color_override("font_color", Color("4bff86"))
	_fps_label.add_theme_stylebox_override("normal", UiKit.pads(UiKit.sbox(Color(10 / 255.0, 8 / 255.0, 20 / 255.0, 0.6), roundi(8.0 * k)), 8.0 * k, 3.0 * k, 8.0 * k, 3.0 * k))
	_fps_label.position = Vector2(64.0, 18.0) * k
	_fps_label.reset_size()

# The screen the keyboard arrows / gamepad drive (menu.js activeOverlay), or null in play.
func _nav_root() -> Control:
	var root: Control = null
	if hud_ui.pause_open():
		root = hud_ui.pause_view()
	else:
		match state:
			State.MENU, State.QUEUE:
				root = menu
			State.LOBBY:
				root = lobby
			State.OVER:
				root = result if result.visible else null
	if root == null or not root.is_visible_in_tree():
		return null
	return _top_modal(root)

# The last full-screen blocker with something to focus (a dialog over the menu), else root itself.
func _top_modal(root: Control) -> Control:
	var area := get_viewport().get_visible_rect().get_area()
	var best: Control = root
	var stack: Array = [root]
	var order: Array = []
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		order.append(n)
		var kids := n.get_children()
		kids.reverse()
		for c in kids:
			if c is CanvasItem and not (c as CanvasItem).visible:
				continue
			stack.append(c)
	for n in order:
		if n != root and n is Control and (n as Control).mouse_filter == Control.MOUSE_FILTER_STOP \
				and (n as Control).get_global_rect().get_area() >= area * 0.85 and not _focusables(n).is_empty():
			best = n
	return best

func _focusables(root: Node) -> Array:
	var out: Array = []
	var vr := get_viewport().get_visible_rect()
	var stack: Array = [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		var kids := n.get_children()
		kids.reverse()
		for c in kids:
			if c is CanvasItem and not (c as CanvasItem).visible:
				continue
			stack.append(c)
		if n != root and n is Control:
			var c := n as Control
			if c.focus_mode == Control.FOCUS_ALL and not (c is BaseButton and (c as BaseButton).disabled):
				var r := c.get_global_rect()
				if r.size.x > 2.0 and r.size.y > 2.0 and vr.intersects(r):
					out.append(c)
	return out

func _nav_focus(c: Control) -> void:
	c.grab_focus()
	var p := c.get_parent()
	while p:
		if p is ScrollContainer:
			(p as ScrollContainer).ensure_control_visible(c)
		p = p.get_parent()

# Spatial navigation (menu.js move): the nearest focusable in that direction, the sideways distance
# counting 2.5 times.
func _nav_move(root: Control, dir: String) -> void:
	var items := _focusables(root)
	if items.is_empty():
		return
	var cur := get_viewport().gui_get_focus_owner()
	if cur == null or not items.has(cur):
		_nav_focus(items[0])
		return
	var dv: Vector2 = {"up": Vector2(0, -1), "down": Vector2(0, 1), "left": Vector2(-1, 0), "right": Vector2(1, 0)}[dir]
	var a := cur.get_global_rect().get_center()
	var best: Control = null
	var best_s := INF
	var k := UiKit.css_scale(get_viewport())
	for it in items:
		if it == cur:
			continue
		var d: Vector2 = (it as Control).get_global_rect().get_center() - a
		var along := d.dot(dv)
		if along <= 4.0 * k:
			continue
		var across := absf(d.x * dv.y) + absf(d.y * dv.x)
		var sc := along + across * 2.5
		if sc < best_s:
			best_s = sc
			best = it
	if best:
		_nav_focus(best)
		UiKit.click()

func _nav_confirm(root: Control) -> void:
	var f := get_viewport().gui_get_focus_owner()
	if f == null or not root.is_ancestor_of(f):
		var items := _focusables(root)
		if not items.is_empty():
			_nav_focus(items[0])
		return
	if f.has_method("activate"):
		f.call("activate")
	elif f is OptionButton:
		(f as OptionButton).show_popup()
	elif f is BaseButton:
		var b := f as BaseButton
		if b.toggle_mode:
			b.button_pressed = not b.button_pressed
		b.pressed.emit()

# Back on the screen under the options (pause card / menu): the focus on its first button when the
# keyboard or a pad drives it.
func _nav_restore() -> void:
	if not Controls.focus_visible:
		return
	var root := _nav_root()
	if root:
		var items := _focusables(root)
		if not items.is_empty():
			_nav_focus(items[0])

# Gamepad in the menus (menu.js update): D-pad / left stick move the focus (with repeat), A presses,
# B goes back (as Escape), Start plays from the home screen. The options screen runs its own.
func _pad_menus() -> void:
	if settings_view == null or settings_view.visible:
		return
	var d := Controls.nav_step()
	# nothing pressed this frame: skip the UI tree walk (_nav_root is two full walks, every frame)
	if d == "" and not Controls.pad_hit(JOY_BUTTON_A) and not Controls.pad_hit(JOY_BUTTON_B) and not Controls.pad_hit(JOY_BUTTON_START):
		return
	var root := _nav_root()
	if root == null:
		return
	if d != "":
		_nav_move(root, d)
	if Controls.pad_hit(JOY_BUTTON_A):
		_nav_confirm(root)
	if Controls.pad_hit(JOY_BUTTON_B) and not hud_ui.pause_open():
		for pressed in [true, false]:
			var e := InputEventAction.new()
			e.action = "ui_cancel"
			e.pressed = pressed
			Input.parse_input_event(e)
	if Controls.pad_hit(JOY_BUTTON_START) and state == State.MENU and not menu.is_overlay_open():
		UiKit.click()
		_quick_play()

# Keyboard arrows in the menus: the same spatial navigation (a text field or a slider keeps them).
func _input(ev: InputEvent) -> void:
	Controls.note(ev)
	if settings_view == null or settings_view.visible:
		return
	if not (ev is InputEventKey) or not ev.pressed:
		return
	var dir: String = {KEY_UP: "up", KEY_DOWN: "down", KEY_LEFT: "left", KEY_RIGHT: "right"}.get((ev as InputEventKey).physical_keycode, "")
	if dir == "":
		return
	var f := get_viewport().gui_get_focus_owner()
	if f is LineEdit or f is TextEdit or f is Range:
		return
	var root := _nav_root()
	if root == null:
		return
	_nav_move(root, dir)
	get_viewport().set_input_as_handled()
