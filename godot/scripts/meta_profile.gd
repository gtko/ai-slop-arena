class_name MetaProfile
extends RefCounted
# Your profile (src/profile.js), kept on this device like the web keeps it in localStorage
# ('iaslop-profile'): user://profile.json has the same JSON shape, so the rules read the same.
#  - account level and XP; Slop Coins (earned by playing) and Gems (bought: payment is not integrated
#    yet, only development builds can add test Gems, like the web's shop);
#  - the brawlers you own (the starters, all eight since v0.18.1, are free; a profile from before brawlers were owned keeps
#    the five of before), the cosmetics you own and the ones you wear (cosmetics.js);
#  - Bot League trophies per brawler and the Trophy Road.
# Plus the shop of the day (metaui.js shopItems): the same seeded pick as the web, so every player and
# both clients see the same shop.
#
# Static: any script reads it. MetaProfile.bus.changed fires after anything changed (wallet, owned, worn).

const PATH := "user://profile.json"

class Bus extends RefCounted:
	signal changed

static var bus := Bus.new()
static var P: Dictionary = {}
static var _loaded := false
static var _nosave := false     # screenshot / test runs (--wallet=): nothing is written

# cosmetics.json (exported from src/cosmetics.js + profile.js by godot/tools/export-data.mjs)
static func D() -> Dictionary:
	return Skins.data()

static func _blank() -> Dictionary:
	var owned: Array = (D().get("free", []) as Array).duplicate()
	for k in D().get("starters", ["blaster", "gunslinger", "bomber"]):
		owned.append("brawler:" + String(k))
	return {"v": 2, "xp": 0, "coins": 0, "gems": 0, "owned": owned, "trophies": {}, "road": 0,
		"wear": {"skins": {}, "trail": 0, "ko": 0, "frame": 0, "title": 1, "icon": 0}, "seen": []}

static func load_all() -> void:
	if _loaded:
		return
	_loaded = true
	P = _blank()
	_nosave = Settings.test_run()   # tests never write the player's coins / XP
	var raw: Variant = _read(PATH)
	if raw == null and FileAccess.file_exists(PATH):
		# cut short (the app was killed mid-write): the previous good copy, and the broken one kept aside
		raw = _read(PATH + ".bak")
		DirAccess.copy_absolute(ProjectSettings.globalize_path(PATH), ProjectSettings.globalize_path(PATH + ".broken"))
	if raw is Dictionary:
		var r := raw as Dictionary
		var wear: Dictionary = P.wear
		for k in r:
			if P.has(k) and typeof(r[k]) != typeof(P[k]) and not (r[k] is float and P[k] is int):
				continue   # a value of the wrong type keeps the blank one (owned must stay an Array...)
			P[k] = r[k]
		if r.get("wear") is Dictionary:
			for k in r.wear:
				wear[k] = r.wear[k]
		P.wear = wear
	# v0.13.1: brawlers are owned. Anyone who played before keeps the five of before (nothing is taken
	# away): a profile from before then, or no profile yet but a player who already used this client.
	var veteran := (not (raw as Dictionary).has("v")) if raw is Dictionary else (FileAccess.file_exists("user://settings.cfg") and not FileAccess.file_exists(PATH))
	if veteran:
		for k in ["blaster", "gunslinger", "bomber", "frostbite", "volt"]:
			if not owns("brawler:" + k):
				(P.owned as Array).append("brawler:" + k)
		P.v = 2
	for id in D().get("free", []):   # items made free later
		if not owns(String(id)):
			(P.owned as Array).append(String(id))
	for k in D().get("starters", []):   # brawlers made free later (v0.18.1: all eight) reach old profiles too
		if not owns("brawler:" + String(k)):
			(P.owned as Array).append("brawler:" + String(k))
	if not (P.wear.get("skins") is Dictionary):
		P.wear.skins = {}
	for a in DebugArgs.list():       # screenshots / tests: --wallet=coins,gems (never saved)
		if a.begins_with("--wallet="):
			var w := a.substr(9).split(",")
			P.coins = int(w[0])
			P.gems = int(w[1]) if w.size() > 1 else 0
			_nosave = true
		elif a.begins_with("--owned="):  # --owned=skin:blaster:1,brawler:volt
			for id in a.substr(8).split(","):
				if not owns(id):
					(P.owned as Array).append(id)
			_nosave = true
	if veteran and not _nosave:
		save()

static func save() -> void:
	bus.changed.emit()
	if _nosave:
		return
	# never truncate the only copy: write a temp file, keep the last good one as .bak, then swap
	var tmp := PATH + ".tmp"
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify(P))
	f.close()
	var abs := ProjectSettings.globalize_path(PATH)
	if FileAccess.file_exists(PATH):
		DirAccess.remove_absolute(abs + ".bak")
		DirAccess.rename_absolute(abs, abs + ".bak")
	DirAccess.rename_absolute(ProjectSettings.globalize_path(tmp), abs)

static func _read(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var v: Variant = JSON.parse_string(f.get_as_text())
	return v if v is Dictionary else null

# ------------------------------------------------------------------ account level

static func xp_for(l: int) -> int:
	return 100 + 20 * (l - 1)

static func level_info(xp: int = -1) -> Dictionary:
	load_all()
	if xp < 0:
		xp = int(P.xp)
	var l := 1
	var rest := xp
	while rest >= xp_for(l):
		rest -= xp_for(l)
		l += 1
	return {"level": l, "into": rest, "need": xp_for(l), "frac": float(rest) / float(xp_for(l))}

static func coins() -> int:
	load_all()
	return int(P.coins)

static func gems() -> int:
	load_all()
	return int(P.get("gems", 0))

static func level_coins(l: int) -> int:
	return 50 + 10 * mini(l, 20)

static func level_rewards() -> Dictionary:
	return D().get("levelRewards", {})

static func road() -> Array:
	return D().get("road", [])

# ------------------------------------------------------------------ Bot League

const TROPHY_DELTA := [10, 7, 5, 3, 1, -1, -3, -5]

static func trophies(key: String) -> int:
	load_all()
	return int((P.trophies as Dictionary).get(key, 0))

static func total_trophies() -> int:
	load_all()
	var s := 0
	for k in P.trophies:
		s += int(P.trophies[k])
	return s

static func trophy_delta(key: String, rank: int) -> int:
	var d: int = TROPHY_DELTA[clampi(rank, 1, 8) - 1]
	var n := trophies(key)
	if d >= 0:
		return d
	return 0 if n < 50 else (ceili(d / 2.0) if n < 150 else d)

static func road_progress(total: int = -1) -> Dictionary:
	if total < 0:
		total = total_trophies()
	var R := road()
	for i in R.size():
		if total < int(R[i][0]):
			var from := int(R[i - 1][0]) if i > 0 else 0
			return {"next": R[i], "frac": float(total - from) / float(int(R[i][0]) - from), "reached": i}
	return {"next": null, "frac": 1.0, "reached": R.size()}

# ------------------------------------------------------------------ rewards

static func owns(id: String) -> bool:
	load_all()
	return (P.owned as Array).has(id)

static func _give(id: String) -> Dictionary:
	if id.begins_with("coins:"):
		var n := int(id.substr(6))
		P.coins = int(P.coins) + n
		return {"coins": n}
	if not owns(id):
		(P.owned as Array).append(id)
		return {"id": id}
	P.coins = int(P.coins) + 100   # already owned (bought before): coins instead
	return {"id": id, "dup": true, "coins": 100}

# After a match (profile.js awardMatch). vs_bots: a solo match against bots (Bot League).
static func award_match(rank: int, kos: int, won: bool, key: String, vs_bots: bool) -> Dictionary:
	load_all()
	var before := level_info()
	var xp := 30 + 5 * mini(kos, 7) + (10 if rank <= 4 else 0) + (15 if won else 0)
	var earned := 5 + (5 if rank <= 4 else 0) + (10 if won else 0) + 2 * mini(kos, 7)
	P.xp = int(P.xp) + xp
	P.coins = int(P.coins) + earned
	var after := level_info()
	var rewards: Array = []
	var LR := level_rewards()
	for l in range(int(before.level) + 1, int(after.level) + 1):
		var r := _give("coins:%d" % level_coins(l))
		r["level"] = l
		rewards.append(r)
		if LR.has(str(l)):
			var r2 := _give(String(LR[str(l)]))
			r2["level"] = l
			rewards.append(r2)
	var league: Variant = null
	if vs_bots and key != "":
		P.road = maxi(int(P.get("road", 0)), int(road_progress().reached))
		var d := trophy_delta(key, rank)
		P.trophies[key] = maxi(0, trophies(key) + d)
		var rp := road_progress()
		var R := road()
		for i in range(int(P.road), int(rp.reached)):
			var r := _give(String(R[i][1]))
			r["road"] = R[i][0]
			rewards.append(r)
		P.road = maxi(int(P.road), int(rp.reached))
		league = {"delta": d, "trophies": trophies(key), "total": total_trophies()}
	save()
	return {"xp": xp, "coins": earned, "before": before, "after": after, "rewards": rewards, "league": league}

# ------------------------------------------------------------------ shop and wardrobe

static func kind_of(id: String) -> String:
	return id.split(":")[0]

static func price_of(id: String) -> int:
	return int((D().get("price", {}) as Dictionary).get(kind_of(id), 0))

# Buy with "gems" (cosmetics, brawlers) or "coins" (brawlers and skins).
static func buy(id: String, price: int, currency: String = "gems") -> bool:
	load_all()
	var wallet := "coins" if currency == "coins" else "gems"
	if owns(id) or int(P.get(wallet, 0)) < price:
		return false
	if currency == "coins" and not (id.begins_with("brawler:") or id.begins_with("skin:")):
		return false   # coins buy no other looks
	P[wallet] = int(P.get(wallet, 0)) - price
	(P.owned as Array).append(id)
	save()
	return true

static func owns_brawler(key: String) -> bool:
	return owns("brawler:" + key)

# Gems from a pack (the store's purchase callback; development builds only, see menu_shop.gd).
static func add_gems(n: int) -> void:
	load_all()
	P.gems = int(P.get("gems", 0)) + n
	save()

static func add_coins(n: int) -> void:
	load_all()
	P.coins = int(P.coins) + n
	save()

static func wearing() -> Dictionary:
	load_all()
	return P.wear

static func skin_of(brawler: String) -> int:
	return int((wearing().skins as Dictionary).get(brawler, 0))

static func wear(kind: String, n: int, brawler: String = "") -> void:
	load_all()
	if kind == "skin":
		P.wear.skins[brawler] = n
	else:
		P.wear[kind] = n
	save()

# Can this be worn? Skin 0 and the "none" entries always.
static func can_wear(kind: String, n: int, brawler: String = "") -> bool:
	if n == 0 and kind != "title" and kind != "icon":
		return true
	return owns("skin:%s:%d" % [brawler, n] if kind == "skin" else "%s:%d" % [kind, n])

# What you show with this brawler, as the network string 'skin.trail.ko.frame.title.icon'.
static func cos_for(brawler: String, icon: int = -1) -> String:
	load_all()
	var W: Dictionary = P.wear
	var skin := skin_of(brawler)
	if skin >= (D().skins as Array).size() or not can_wear("skin", skin, brawler):
		skin = 0
	return "%d.%d.%d.%d.%d.%d" % [skin, int(W.trail), int(W.ko), int(W.frame), int(W.title), int(W.icon) if icon < 0 else icon]

# Items unlocked but not looked at yet (the red dot on the COLLECTION tab).
static func unseen() -> Array:
	load_all()
	var out: Array = []
	var free: Array = D().get("free", [])
	for id in P.owned:
		if not (P.seen as Array).has(id) and not free.has(id) and not String(id).begins_with("brawler:"):
			out.append(id)
	return out

static func mark_seen() -> void:
	load_all()
	P.seen = (P.owned as Array).duplicate()
	save()

# ------------------------------------------------------------------ the shop of the day

# Every item the shop may offer (cosmetics.js shopPool), minus what levels and the Trophy Road give.
static func shop_pool(brawlers: Array) -> Array:
	var d := D()
	var pool: Array = []
	for b in brawlers:
		for s in [1, 2]:
			pool.append("skin:%s:%d" % [b, s])
	for i in range(1, (d.trails as Array).size()):
		pool.append("trail:%d" % i)
	for i in range(1, (d.kofx as Array).size()):
		pool.append("ko:%d" % i)
	for e in d.emotes:
		if not (d.emoteFree as Array).has(e):
			pool.append("emote:" + String(e))
	for i in range(1, (d.frames as Array).size()):
		pool.append("frame:%d" % i)
	for i in range(2, (d.titles as Array).size()):
		pool.append("title:%d" % i)
	for i in range(5, (d.icons as Array).size()):
		pool.append("icon:%d" % i)
	var earned: Array = (d.earned as Array).duplicate()
	for k in level_rewards():
		earned.append(String(level_rewards()[k]))
	for r in road():
		earned.append(String(r[1]))
	return pool.filter(func(id): return not earned.has(id))

# metaui.js rng(seed): FNV-1a then a mulberry-style generator, in 32-bit integer maths like Math.imul.
static func _imul(a: int, b: int) -> int:
	a &= 0xFFFFFFFF
	b &= 0xFFFFFFFF
	var lo := (a & 0xFFFF) * b
	var hi := ((a >> 16) * b) & 0xFFFF
	return (lo + (hi << 16)) & 0xFFFFFFFF

class Rng extends RefCounted:
	var h := 2166136261
	func _init(seed: String) -> void:
		for i in seed.length():
			h = MetaProfile._imul(h ^ seed.unicode_at(i), 16777619)
	func next() -> float:
		h = (h + 0x6d2b79f5) & 0xFFFFFFFF
		var x := h
		x = MetaProfile._imul(x ^ (x >> 15), x | 1)
		x ^= (x + MetaProfile._imul(x ^ (x >> 7), x | 61)) & 0xFFFFFFFF
		return float((x ^ (x >> 14)) & 0xFFFFFFFF) / 4294967296.0

# 1 featured skin (one you don't have) and 4 other items, the same for everyone, new every day.
static func shop_items(brawlers: Array) -> Array:
	var t := Time.get_datetime_dict_from_system()
	var R := Rng.new("%d-%d-%d" % [t.year, t.month - 1, t.day])   # JS getMonth() is 0-based
	var out: Array = []
	var pool := shop_pool(brawlers)
	for kinds in [["skin"], ["trail", "ko"], ["emote"], ["frame", "title"], ["icon", "trail", "ko", "skin"]]:
		var a: Array = pool.filter(func(id): return kinds.has(kind_of(id)) and not out.has(id))
		if out.is_empty():
			var mine: Array = a.filter(func(id): return not owns(id))
			if not mine.is_empty():
				a = mine
		if not a.is_empty():
			out.append(a[int(floor(R.next() * a.size()))])
	return out

# Time to midnight (local), in ms, like quests.js resetIn().day.
static func reset_in_ms() -> float:
	var t := Time.get_datetime_dict_from_system()
	return float(((23 - int(t.hour)) * 3600 + (59 - int(t.minute)) * 60 + (60 - int(t.second))) * 1000)
