class_name Achievements
extends RefCounted
# Achievements + stats (the old client's src/achievements.js). Progress is always kept on this device
# (MetaProfile.P.ach, so it survives playing offline and nothing is lost before a store is connected)
# and mirrored to every sink: Steam (steam_platform.gd) today, Play Games later. A sink is any object
# with `achieve(id: String)` and `set_stats(stats: Dictionary)`; both must be idempotent. The ids and
# the stats are the API names declared on the Steamworks partner site (steam/README.md, src/achievements.json).
#
# main.gd feeds it: match_start() when the match is built, on_event() with every server event,
# cubes() with the local fighter's held cubes, result() when the result is shown.

const IDS := ["FIRST_KO", "FIRST_WIN", "RAMPAGE", "POWER_HUNGRY", "ONLINE_WIN", "SQUAD_UP", "WORLD_TOUR",
	"JACK_OF_ALL", "VETERAN", "CENTURION", "PODIUM", "SUPER_KO", "NIGHT_OWL", "CRATE_CRUSHER", "CHAMPION"]
# Int stats (same names on Steam). MAPS_MASK / WINS_MASK: one bit per map / brawler, in data order: the
# data files (maps.json, brawlers.json) are append-only (tests/steam.test.mjs pins the current order).
const STATS := ["MATCHES", "WINS", "KOS", "MAPS_MASK", "WINS_MASK", "CRATES"]

static var sinks: Array = []
static var _match: Dictionary = {}   # per-match counters, empty between matches

# Called by main.gd once the local player's real match is built (never the menu's attract mode).
static func match_start(map_key: String, brawler: String, online: bool, humans: int, with_friend: bool) -> void:
	var s := _stats()
	_match = {"map": map_key, "brawler": brawler, "online": online, "humans": humans, "kos": 0, "cubes": 0, "done": false}
	s.MATCHES = int(s.MATCHES) + 1
	var maps := _keys(GameData.maps)
	if maps.has(map_key):
		s.MAPS_MASK = int(s.MAPS_MASK) | (1 << maps.find(map_key))
	if online and humans > 1 and with_friend:
		unlock("SQUAD_UP")
	if int(s.MAPS_MASK) == _all(maps.size()):
		unlock("WORLD_TOUR")
	if int(s.MATCHES) >= 25:
		unlock("VETERAN")
	_push_stats()

# Every server event of the match (main.gd "ev"): the local player's K.O.s (and the super ones) and crates.
static func on_event(e: Dictionary, my_id: String) -> void:
	if _match.is_empty() or my_id == "" or str(e.get("by", "")) != my_id:   # `by` is null for a fall or the gas (str(), not String())
		return
	match str(e.get("e", "")):
		"kill":
			if str(e.get("id", "")) == my_id:
				return   # your own fall (gas, a mistake) is not a K.O.
			_ko(int(e.get("sup", 0)) != 0)
		"crate":
			var s := _stats()
			s.CRATES = int(s.CRATES) + 1
			if int(s.CRATES) >= 50:
				unlock("CRATE_CRUSHER")
			_save()   # sent with the other stats at the end of the match

static func _ko(by_super: bool) -> void:
	var s := _stats()
	_match.kos = int(_match.kos) + 1
	s.KOS = int(s.KOS) + 1
	unlock("FIRST_KO")
	if by_super:
		unlock("SUPER_KO")
	if int(_match.kos) >= 3:
		unlock("RAMPAGE")
	if int(s.KOS) >= 100:
		unlock("CENTURION")
	_save()

# The local fighter's held power cubes (every snapshot).
static func cubes(n: int) -> void:
	if _match.is_empty():
		return
	_match.cubes = maxi(int(_match.cubes), n)
	if n >= 8:
		unlock("POWER_HUNGRY")

# The match is over for the local player. rank: 1 = won, then the place (Duo: counted as 1st, 3rd, 5th, 7th
# of 8 like the progression does). night: the arena was dark.
static func result(rank: int, won: bool, night: bool) -> void:
	if _match.is_empty() or bool(_match.done):
		return
	_match.done = true
	var s := _stats()
	if rank >= 1 and rank <= 3:
		unlock("PODIUM")
	if won:
		s.WINS = int(s.WINS) + 1
		unlock("FIRST_WIN")
		if int(s.WINS) >= 10:
			unlock("CHAMPION")
		if night:
			unlock("NIGHT_OWL")
		if bool(_match.online) and int(_match.humans) > 1:
			unlock("ONLINE_WIN")
		var brawlers := _keys(GameData.brawlers)
		if brawlers.has(String(_match.brawler)):
			s.WINS_MASK = int(s.WINS_MASK) | (1 << brawlers.find(String(_match.brawler)))
		if int(s.WINS_MASK) == _all(brawlers.size()):
			unlock("JACK_OF_ALL")
	_push_stats()   # K.O.s and crates are batched here too

static func end() -> void:
	_match = {}

static func unlock(id: String) -> void:
	if not IDS.has(id):
		return
	var u: Dictionary = _data().unlocked
	if u.has(id):
		return   # (cubes() asks every snapshot) sinks already have it; a sink that comes up later gets sync()
	u[id] = int(Time.get_unix_time_from_system())
	_save()
	for s in sinks:
		s.achieve(id)

static func is_unlocked(id: String) -> bool:
	return _data().unlocked.has(id)

# Re-send everything earned so far to a sink that just came up (first launch with Steam, or after playing offline).
static func connect_sink(sink: Object) -> void:
	sinks.append(sink)
	sync(sink)

static func sync(sink: Object) -> void:
	for id in _data().unlocked:
		sink.achieve(String(id))
	sink.set_stats(_stats())

# What Steam already holds (another PC, a deleted profile): counters take the larger value, masks are or-ed,
# so pushing the local stats never lowers the progress Steam has. remote_unlocked: achievement ids it has.
static func merge_remote(remote_stats: Dictionary, remote_unlocked: Array) -> void:
	var s := _stats()
	for k in STATS:
		var r := int(remote_stats.get(k, 0))
		s[k] = (int(s[k]) | r) if k.ends_with("_MASK") else maxi(int(s[k]), r)
	var u: Dictionary = _data().unlocked
	for id in remote_unlocked:
		if IDS.has(id) and not u.has(id):
			u[id] = int(Time.get_unix_time_from_system())
	_save()

static func _push_stats() -> void:
	_save()
	for s in sinks:
		s.set_stats(_stats())

# user://profile.json "ach": {"stats": {...}, "unlocked": {id: unix time}}
static func _data() -> Dictionary:
	MetaProfile.load_all()
	var a: Variant = MetaProfile.P.get("ach")
	if not (a is Dictionary):
		a = {}
		MetaProfile.P["ach"] = a
	if not (a.get("stats") is Dictionary):
		a["stats"] = {}
	if not (a.get("unlocked") is Dictionary):
		a["unlocked"] = {}
	for k in STATS:
		if not a.stats.has(k):
			a.stats[k] = 0
	return a

static func _stats() -> Dictionary:
	return _data().stats

static func _save() -> void:
	MetaProfile.save()

static func _keys(d: Dictionary) -> Array:
	return d.keys()

static func _all(n: int) -> int:
	return (1 << n) - 1
