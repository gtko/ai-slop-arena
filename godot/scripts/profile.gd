class_name Profile
extends Node
# The player's visible ranking (tier + ranked points, kept by the server, never the hidden MMR):
# fetched from GET /api/rank?cid=..., refreshed by the {t:"rank"} message of the matchmaker and by
# {t:"ranked"} at the end of a matchmade match. Also builds the small rank card of the menu.

signal changed

const TIERS := [["bronze", 0], ["silver", 200], ["gold", 500], ["diamond", 900], ["mythic", 1400], ["legend", 2000]]

var rp := 0
var tier := "bronze"
var matches := 0
var wins := 0
var last_delta := 0          # RP gained / lost in the last ranked match
var last_visible := true
var _http: HTTPRequest

func _ready() -> void:
	_http = HTTPRequest.new()
	_http.timeout = 8.0
	add_child(_http)
	_http.request_completed.connect(_on_http)

func fetch() -> void:
	if _http == null or _http.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED:
		return
	var base := "http" + Settings.server_url().substr(2)   # ws -> http, wss -> https
	_http.request("%s/api/rank?cid=%s" % [base, NetClient._client_id()])

func _on_http(_result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if code != 200:
		return
	var v: Variant = JSON.parse_string(body.get_string_from_utf8())
	if v is Dictionary and (v as Dictionary).get("ok", false):
		apply_rank(v)

# {rp, tier, matches[, wins]} from /api/rank or the matchmaker's "rank" message.
func apply_rank(m: Dictionary) -> void:
	rp = int(m.get("rp", rp))
	tier = String(m.get("tier", tier))
	matches = int(m.get("matches", matches))
	wins = int(m.get("wins", wins))
	changed.emit()

# The "ranked" message: {rp, delta, tier, prevTier, visible}. Returns the text for the result screen.
func apply_ranked(m: Dictionary) -> String:
	last_visible = bool(m.get("visible", false))
	last_delta = int(m.get("delta", 0))
	var prev := String(m.get("prevTier", tier))
	if last_visible:
		rp = int(m.get("rp", rp))
		tier = String(m.get("tier", tier))
		matches += 1
	changed.emit()
	if not last_visible:
		return I18n.t("rank.practice")
	var txt := I18n.t("rank.change", {"delta": ("+" if last_delta > 0 else "") + str(last_delta), "icon": "", "tier": I18n.t("rank." + tier), "rp": rp}).strip_edges()
	if tier != prev:
		txt += "  " + I18n.t("rank.newTier")
	return txt

func tier_index() -> int:
	for i in TIERS.size():
		if TIERS[i][0] == tier:
			return i
	return 0

# 0..1 progress to the next tier, and the text under the tier name.
func progress() -> float:
	var i := tier_index()
	if matches <= 0 or i >= TIERS.size() - 1:
		return 0.0 if matches <= 0 else 1.0
	var lo: int = TIERS[i][1]
	var hi: int = TIERS[i + 1][1]
	return clampf(float(rp - lo) / float(hi - lo), 0.0, 1.0)

func sub_text() -> String:
	var i := tier_index()
	if matches <= 0:
		return I18n.t("rank.unranked")
	if i >= TIERS.size() - 1:
		return I18n.t("rank.top")
	return I18n.t("rank.toNext", {"rp": int(TIERS[i + 1][1]) - rp, "tier": I18n.t("rank." + String(TIERS[i + 1][0]))})

# The rank card (badge, "Gold · 620 RP", progress bar). Rebuilds itself when the rank changes.
func make_card() -> Control:
	var card := UiKit.panel(UiKit.PANEL, 16, 12)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	card.add_child(row)
	var holder := Control.new()
	holder.custom_minimum_size = Vector2(56, 56)
	row.add_child(holder)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 2)
	row.add_child(col)
	var title := UiKit.label("", 22, UiKit.TEXT)
	col.add_child(title)
	var bar := ProgressBar.new()
	bar.custom_minimum_size.y = 10
	bar.show_percentage = false
	bar.max_value = 1.0
	col.add_child(bar)
	var sub := UiKit.label("", 15, UiKit.MUTED)
	col.add_child(sub)
	var refresh := func() -> void:
		for c in holder.get_children():
			c.queue_free()
		var ranked := matches > 0
		holder.add_child(UiKit.tier_badge(tier if ranked else "", 56))
		title.text = ("%s · %d RP" % [I18n.t("rank." + tier), rp]) if ranked else I18n.t("rank.none")
		var col_t: Color = UiKit.TIER_COLORS.get(tier, UiKit.MUTED) if ranked else UiKit.MUTED
		title.add_theme_color_override("font_color", col_t)
		bar.value = progress()
		bar.add_theme_stylebox_override("fill", UiKit.box(col_t, 5))
		bar.add_theme_stylebox_override("background", UiKit.box(Color(1, 1, 1, 0.1), 5))
		sub.text = sub_text()
	refresh.call()
	changed.connect(refresh)
	card.tree_exited.connect(func(): if changed.is_connected(refresh): changed.disconnect(refresh))
	return card
