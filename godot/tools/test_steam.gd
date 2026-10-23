extends SceneTree
# Achievements + the Steam sink against a stand-in for the GodotSteam singleton (nothing is written to the
# player's profile, no Steam needed):  godot --headless --path godot --script tools/test_steam.gd
# Exit code 1 on a failed check.

class FakeSteam:
	extends RefCounted
	signal join_game_requested(friend: int, connect: String)
	var init_status := 0
	var achieved: Array = []
	var stats: Dictionary = {}
	var stored := 0
	var rich: Dictionary = {}
	var callbacks := 0
	func restartAppIfNecessary(_id: int) -> bool:
		return false
	func steamInitEx(_id: int) -> Dictionary:
		return {"status": init_status, "verbal": "fake"}
	func run_callbacks() -> void:
		callbacks += 1
	func setAchievement(id: String) -> bool:
		if not achieved.has(id):
			achieved.append(id)
		return true
	func setStatInt(k: String, v: int) -> bool:
		stats[k] = v
		return true
	func storeStats() -> bool:
		stored += 1
		return true
	func setRichPresence(k: String, v: String) -> bool:
		rich[k] = v
		return true
	func getCurrentGameLanguage() -> String:
		return "french"

var fails := 0

func check(ok: bool, what: String) -> void:
	if not ok:
		fails += 1
		printerr("FAIL: " + what)

func _init() -> void:
	MetaProfile.load_all()
	MetaProfile._nosave = true
	MetaProfile.P = MetaProfile._blank()
	Achievements.sinks.clear()

	# a Steam that is not running leaves everything off
	var down := FakeSteam.new()
	down.init_status = 2
	var s0 := SteamPlatform.new()
	check(not s0.start(down), "start() is false when Steam is not running")
	check(not s0.ready_ok and s0.language_code() == "", "no language without Steam")
	s0.achieve("FIRST_KO")   # no-ops
	s0.free()

	# Steam running: the sink receives what is earned
	var fake := FakeSteam.new()
	var s := SteamPlatform.new()
	root.add_child(s)
	check(s.start(fake), "start() with a running Steam")
	check(s.language_code() == "fr", "Steam 'french' -> fr (got '%s')" % s.language_code())
	var joined: Array = []
	s.join_room.connect(func(c: String): joined.append(c))
	fake.join_game_requested.emit(1, "-- --room=ab12")
	check(joined == ["AB12"], "join_game_requested -> join_room(AB12) (got %s)" % [joined])
	fake.join_game_requested.emit(1, "garbage")
	check(joined.size() == 1, "a connect string without a room is ignored")
	s.set_presence("lobby", "AB12")
	check(fake.rich.get("steam_display") == "#Status_Lobby" and fake.rich.get("connect") == "-- --room=AB12", "presence in a private room")
	s.set_presence("menu", "")
	check(fake.rich.get("connect") == "" and fake.rich.get("steam_display") == "#Status_Menu", "presence cleared")
	check(SteamPlatform._room_in(PackedStringArray(["--lang=fr", "--room=zz9x"])) == "ZZ9X", "launch room parsed from the command line")
	check(SteamPlatform._room_in(PackedStringArray(["--room=toolongcode"])) == "", "a bad room code is refused")

	# a full match: 3 K.O.s (one by super), crates, cubes, a win at night in a private room with a friend
	var me := "p1"
	var map_key: String = GameData.maps.keys()[0]
	var brawler: String = GameData.brawlers.keys()[0]
	Achievements.match_start(map_key, brawler, true, 2, true)
	check(fake.achieved.has("SQUAD_UP"), "SQUAD_UP: online match with a friend")
	check(int(fake.stats.get("MATCHES", 0)) == 1, "MATCHES pushed to Steam")
	Achievements.on_event({"e": "kill", "id": "p2", "by": me}, me)
	Achievements.on_event({"e": "kill", "id": "p3", "by": me, "sup": 1}, me)
	Achievements.on_event({"e": "kill", "id": "p4", "by": "p9"}, me)   # someone else's K.O.
	Achievements.on_event({"e": "kill", "id": me, "by": me}, me)       # your own fall
	check(fake.achieved.has("FIRST_KO") and fake.achieved.has("SUPER_KO"), "FIRST_KO + SUPER_KO")
	check(not fake.achieved.has("RAMPAGE"), "two K.O.s are no rampage (own fall / others do not count)")
	Achievements.on_event({"e": "kill", "id": "p5", "by": me}, me)
	check(fake.achieved.has("RAMPAGE"), "RAMPAGE at three K.O.s")
	for i in 3:
		Achievements.on_event({"e": "crate", "i": i, "j": 0, "by": me}, me)
	Achievements.cubes(7)
	check(not fake.achieved.has("POWER_HUNGRY"), "7 cubes are not enough")
	Achievements.cubes(8)
	check(fake.achieved.has("POWER_HUNGRY"), "POWER_HUNGRY at 8 cubes")
	Achievements.result(1, true, true)
	for id in ["FIRST_WIN", "PODIUM", "NIGHT_OWL", "ONLINE_WIN"]:
		check(fake.achieved.has(id), id)
	check(int(fake.stats.get("WINS", 0)) == 1, "WINS counted")
	check(int(fake.stats.get("KOS", 0)) == 3, "KOS counted (got %s)" % fake.stats.get("KOS"))
	check(int(fake.stats.get("CRATES", 0)) == 3, "CRATES counted")
	var wins_before: int = int(fake.stats.get("WINS", 0))
	Achievements.result(1, true, true)
	check(int(fake.stats.get("WINS", 0)) == wins_before, "a second result() of the same match counts once")
	Achievements.end()

	# the stats go to Steam in one batch after STORE_DELAY
	check(fake.stored == 0, "storeStats waits")
	s._process(SteamPlatform.STORE_DELAY + 0.1)
	check(fake.stored == 1 and fake.callbacks == 1, "storeStats once + run_callbacks each frame")

	# a sink that comes up later gets everything earned offline
	var late := FakeSteam.new()
	var s2 := SteamPlatform.new()
	root.add_child(s2)
	check(s2.start(late), "second sink")
	check(late.achieved.has("FIRST_WIN") and int(late.stats.get("WINS", 0)) == 1, "offline progress re-synced to a new sink")

	# unlocks a day-one 25-match veteran / world tour
	MetaProfile.P = MetaProfile._blank()
	Achievements.sinks.clear()
	for k in GameData.maps.keys():
		Achievements.match_start(String(k), brawler, false, 1, false)
		Achievements.end()
	check(Achievements.is_unlocked("WORLD_TOUR"), "WORLD_TOUR after every map")
	check(not Achievements.is_unlocked("SQUAD_UP"), "no SQUAD_UP solo")
	for k in GameData.brawlers.keys():
		Achievements.match_start(map_key, String(k), false, 1, false)
		Achievements.result(1, true, false)
		Achievements.end()
	check(Achievements.is_unlocked("JACK_OF_ALL"), "JACK_OF_ALL after a win with every brawler")
	check(not Achievements.is_unlocked("ONLINE_WIN") and not Achievements.is_unlocked("NIGHT_OWL"), "no online win / night owl solo by day")

	print("steam test: %s" % ("OK" if fails == 0 else "%d failed" % fails))
	quit(1 if fails > 0 else 0)
