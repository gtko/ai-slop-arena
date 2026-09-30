extends Node3D
# Entry point and state machine: MENU -> (QUEUE) -> LOBBY -> LOADING -> COUNTDOWN -> PLAYING -> OVER
# -> back to the menu / lobby. Everything is built from code (no hand-edited scenes) so the port
# stays easy to diff. Rules run on the server; this is the renderer + input.
#
# Screens (all built from code): MainMenu (menu.gd), Lobby (lobby.gd), ResultView (result_view.gd).
# Network: NetClient (room socket), MatchmakingClient (quick play queue, /mm), Profile (rank).
#   MENU     main menu. QUICK PLAY -> QUEUE; PRIVATE ROOM create / join -> LOBBY.
#   QUEUE    matchmaking overlay on the menu; "matched" -> room socket -> LOBBY (a matchmade room
#            starts by itself).
#   LOBBY    the room: players, leader picks map / mode / chaos and starts. {t:"start"} -> LOADING.
#   LOADING  arena built, "loaded" sent. {t:"go"} -> COUNTDOWN (3-2-1) -> PLAYING.
#   OVER     I am out or somebody won: result screen (spectate / again / menu), ranked points arrive.
# Errors (outdated, full, banned, kicked) and lost connections return to the menu with a message.

const SEND_HZ := 20.0
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
var rank_label: Label             # ranked-points text under the HUD result overlay
var audio: AudioManager           # AUDIO HOOK: pooled SFX + music (scripts/audio_manager.gd)
var menu: MainMenu
var lobby: Lobby
var result: ResultView
var projectiles: Array = []       # [{node, dir, speed, left}]
var send_t := 0.0
var super_seq := 0
var fix_seen := -1
var count_left := 0.0
var aim_dir := Vector2(0, 1)
var aim_point := Vector3.ZERO
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
var _result_shown := false
var _last_count := 0
var _me_hp := -1.0
var _final_music := false

func _ready() -> void:
	Settings.load_all()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--lang="):
			Settings.lang = a.substr(7)      # (not saved) for screenshots
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
	var args := DebugArgs.list()
	if args.has("--autotest"):
		_autotest()
	else:
		for a in args:
			if a.begins_with("--menushot="):
				_menushot(a.substr(11), args)

# Screenshot of the menu (or one of its overlays) for layout checks:
#   godot --path godot -- --menushot=/tmp/menu.png [--overlay=settings|room|queue] [--brawler=volt]
func _menushot(path: String, args: PackedStringArray) -> void:
	for a in args:
		if a.begins_with("--brawler="):
			menu._select_brawler(a.substr(10), false)
		if a.begins_with("--overlay="):
			match a.substr(10):
				"settings": menu._settings.visible = true
				"room": menu._room_dialog.visible = true
				"result":
					result.show_result("#3", I18n.t("g.ko", {"rank": 3}), true)
					result.set_rank_text(I18n.t("rank.change", {"delta": "+12", "icon": "", "tier": I18n.t("rank.silver"), "rp": 212}))
				"queue":
					menu.show_queue(true)
					menu.update_queue({"n": 3, "need": 8, "waited": 12000, "botsIn": 18000, "plats": {"web": 2, "steam": 1}})
	for i in 90:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("MENUSHOT saved %s size=%s" % [path, get_viewport().get_visible_rect().size])
	get_tree().quit(0)

# Headless end-to-end check against a local server:
#   godot --headless --path godot -- --autotest ws://localhost:8787 [--quick] [--map=grove] [--shot=/tmp/x.png] [--lobbyshot=/tmp/l.png]
# Default: a private room, the leader starts. --quick: matchmaking queue, then "play now with bots".
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
			net.send({"t": "start"})
		if state == State.PLAYING and me:
			if DebugArgs.has("realinput"):   # real touch / mouse events drive the player (mobile emulation test)
				if touch.move != Vector2.ZERO:
					stats["touch_moved"] = true
				if touch.firing:
					stats["touch_fired"] = true
				if not stats.has("start_pos"):
					stats["start_pos"] = me.position
					print("AUTOTEST-PLAYING")
			else:
				last_move = Vector2(1, 0.3)
				touch.move = Vector2(0.7, 0.4)
				touch.visible = true
	for a in args:
		if a.begins_with("--shot="):
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png(a.substr(7))
	print("AUTOTEST-INPUT touchsize=%s touchscreen=%s touch_visible=%s touch_moved=%s touch_fired=%s start=%s end=%s" % [touch.size, DisplayServer.is_touchscreen_available(), touch.visible, stats.get("touch_moved", false), stats.get("touch_fired", false), stats.get("start_pos", Vector3.ZERO), me.position if me else Vector3.ZERO])
	print("AUTOTEST state=%d snaps=%d me=%s hp=%s pos=%s fighters=%d arena=%s matchmade=%s" % [state, stats.snaps, me != null, me.hp if me else -1, me.position if me else Vector3.ZERO, fighters.size(), arena != null, net.matchmade])
	get_tree().quit(0 if stats.snaps > 20 and me != null else 1)

func _notification(what: int) -> void:
	# battery: a game nobody looks at should not keep the GPU busy
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_WM_WINDOW_FOCUS_OUT:
		Engine.max_fps = 5
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN or what == NOTIFICATION_WM_WINDOW_FOCUS_IN:
		_apply_power_profile()

func _apply_power_profile() -> void:
	# fps cap here; render scale / MSAA / shadows / particle density live in Quality (world agent)
	Engine.max_fps = int(Settings.gfx_profile().fps)
	if Settings.gfx != "auto":
		Quality.set_level(Settings.gfx)
	Quality.set_saver(Settings.saver)  # WORLD hook

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
	touch.visible = false
	touch.super_pressed.connect(func(): super_seq += 1)
	ui.add_child(touch)
	hud_ui = Hud.new()   # HUD hook
	ui.add_child(hud_ui)
	hud_ui.setup(net, cam, self, touch)
	hud_ui.menu_requested.connect(_result_menu)
	hud_ui.play_again.connect(_result_again)
	hud = Label.new()
	hud.visible = false   # HUD hook: replaced by hud_ui
	hud.position = Vector2(20, 12)
	hud.add_theme_font_size_override("font_size", 22)
	ui.add_child(hud)
	status = Label.new()
	status.set_anchors_preset(Control.PRESET_CENTER_TOP)
	status.position.y = 60
	status.add_theme_font_size_override("font_size", 40)
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
	_build_screens()

# The three full screens; rebuilt when the language changes.
func _build_screens() -> void:
	for n in [menu, lobby, result]:
		if n != null:
			(n as Node).queue_free()
	menu = MainMenu.new()
	menu.profile = profile
	menu.quick_play.connect(func(): audio.play("click"); _quick_play())
	menu.create_room.connect(func(): audio.play("click"); _open_room(_random_code(), false))
	menu.join_room.connect(func(code: String): audio.play("click"); _open_room(code, false))
	menu.queue_bots.connect(func(): mm.bots())
	menu.queue_cancel.connect(_cancel_queue)
	menu.settings_changed.connect(_on_settings_changed)
	menu.profile_changed.connect(_send_pick)
	ui.add_child(menu)
	lobby = Lobby.new()
	lobby.leave.connect(_leave_room)
	lobby.start.connect(func(): audio.play("click"); net.send({"t": "start"}))
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
	result.spectate.connect(func(): result.visible = false)
	ui.add_child(result)
	_show_screen()

func _on_settings_changed() -> void:
	_apply_power_profile()
	Settings.apply_audio()
	var want := Settings.lang if Settings.lang != "" else I18n.detect()
	if want != I18n.lang:
		I18n.use(want)
		var was_open: bool = menu._settings.visible
		_build_screens()
		if was_open:
			menu._settings.visible = true
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
	_show_screen()

func _show_screen() -> void:
	if menu == null:
		return
	var in_menu := state == State.MENU or state == State.QUEUE
	menu.visible = in_menu
	lobby.visible = state == State.LOBBY
	if state != State.OVER and state != State.LOBBY:
		result.visible = false
	var in_match := state == State.LOADING or state == State.COUNTDOWN or state == State.PLAYING or state == State.OVER
	touch.visible = in_match and DisplayServer.is_touchscreen_available()
	hud.visible = false   # HUD hook: hud_ui draws the in-match HUD
	if state != State.OVER:
		rank_label.visible = false
	status.visible = in_match or state == State.LOBBY
	get_viewport().disable_3d = not in_match   # nothing to draw behind the menus: save the battery

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

func _to_menu(msg: String) -> void:
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
	_result_shown = false
	hud_ui.end_match()   # HUD hook
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
	# HUD hook: the Hud draws the K.O. / victory overlay (with Play again / Menu); the ranked-points
	# text goes under it. result_view.gd is no longer shown at the end of a match.
	_result_shown = true
	hud_ui.show_result(1 if won else maxi(_my_place, 1), won)
	result.visible = false
	_update_rank_label()

func _update_rank_label() -> void:
	rank_label.text = _ranked_text
	rank_label.add_theme_color_override("font_color", UiKit.GOOD if profile.last_visible else UiKit.MUTED)
	rank_label.visible = _ranked_text != "" and state == State.OVER

func _winner_name() -> String:
	var f: Fighter = fighters.get(_winner)
	return f.fname if f else "?"

func _result_again() -> void:
	result.visible = false
	rank_label.visible = false
	audio.play("click")
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

# Escape: back out of the lobby / queue / settings, or leave a match (asks once).
func _unhandled_input(ev: InputEvent) -> void:
	if not (ev is InputEventKey and ev.pressed and (ev as InputEventKey).keycode == KEY_ESCAPE):
		return
	match state:
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
			elif in_match_now and not bool(m.get("inMatch", true)):
				_match_over()
		"start":
			_start_match(m)
		"go":
			_last_count = 0   # AUDIO HOOK
			count_left = float(m.get("in", 3000)) / 1000.0
			_set_state(State.COUNTDOWN)
		"snap":
			_apply_snap(m)
			hud_ui.on_snapshot(m)   # HUD hook
		"ev":
			for e in m.list:
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
			_leaving = true
			net.close()
			_to_menu(_error_text(m))
		"error":
			if state == State.LOBBY or state == State.MENU or state == State.QUEUE:
				_leaving = true
				net.close()
				_to_menu(_error_text(m))
			else:
				status.text = _error_text(m)

# The server ended the match (someone won, or the time ran out): show the result once.
func _match_over() -> void:
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
	hud_ui.begin_match(m, arena, fighters)   # HUD hook
	_final_music = false   # AUDIO HOOK: the map theme (+ weather bed) starts with the match
	_me_hp = -1.0
	audio.play_music("m_" + String(m.map))
	status.text = "%s: %s" % [map_data.name, I18n.t("g.get_ready")]
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
	if arena:
		arena.on_event(e)  # WORLD hook
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
				audio.set_danger(0.0)
				audio.play("lose")
			if f == me and state != State.OVER:
				_my_place = int(e.get("rank", 0))
				_set_state(State.OVER)
				status.text = I18n.t("g.ko", {"rank": _my_place})
				await get_tree().create_timer(1.2).timeout   # let the K.O. play before the result
				_show_result()
		"win":
			_winner = String(e.get("id", ""))
			if f == me:
				_my_place = 1
				audio.play("win")   # AUDIO HOOK
			if state != State.OVER:
				_set_state(State.OVER)
				status.text = I18n.t("result.victory") if f == me else I18n.t("g.wins", {"name": f.fname if f else "?"})
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
			_set_state(State.PLAYING)
			status.text = ""
	if me == null or arena == null:
		return
	audio.listener = me.position   # AUDIO HOOK
	if state == State.PLAYING and me.alive:
		_control(delta)
	_follow_camera(delta)

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
	if arena.world_step(me, mv, delta):  # WORLD hook (ice, jump pads: it moved me)
		mv = Vector2.ZERO
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
		firing = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and not result.visible
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
