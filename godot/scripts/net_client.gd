class_name NetClient
extends Node
# WebSocket client for the existing Cloudflare room server (worker/index.js, PROTOCOL 6).
# The server runs every match; this client only sends inputs and renders snapshots.

signal message(msg: Dictionary)
signal closed

const PROTOCOL := 6
const WEB_ORIGIN := "wss://ai-slop-arena.gtux-prog.workers.dev"

var ws := WebSocketPeer.new()
var id := ""
var code := ""
var connected := false
var welcomed := false
var rtt_ms := 0.0
var matchmade := false
var _opening := false
var _ping_t := 0.0

# Query string every connection carries (protocol, device id, platform, name, brawler, loadout, looks).
static func identity_query(player_name: String, brawler: String, lo: String = "A1", cos: String = "") -> String:
	var q := "v=%d&cid=%s&plat=%s&name=%s&b=%s&lo=%s&lvl=0.30" % [PROTOCOL, _client_id(), _platform(), player_name.uri_encode(), brawler, lo]
	return q + ("&cos=" + cos if cos != "" else "")

func connect_room(origin: String, room: String, player_name: String, brawler: String, lo: String = "A1", cos: String = "") -> Error:
	welcomed = false
	matchmade = false
	_opening = true
	ws = WebSocketPeer.new()
	return ws.connect_to_url("%s/ws/%s?%s" % [origin, room.uri_encode(), identity_query(player_name, brawler, lo, cos)])

func send(msg: Dictionary) -> void:
	if ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws.send_text(JSON.stringify(msg))

func close() -> void:
	ws.close()
	connected = false
	_opening = false

func _process(delta: float) -> void:
	ws.poll()
	var state := ws.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		connected = true
		_opening = false
		while ws.get_available_packet_count() > 0:
			var msg = JSON.parse_string(ws.get_packet().get_string_from_utf8())
			if typeof(msg) != TYPE_DICTIONARY:
				continue
			match msg.get("t", ""):
				"welcome":
					id = msg.id
					code = msg.code
					welcomed = true
					matchmade = bool(msg.get("matchmade", false))
				"pong":
					rtt_ms = Time.get_ticks_msec() - float(msg.at)
			message.emit(msg)
		_ping_t -= delta
		if _ping_t <= 0.0:
			_ping_t = 2.0
			send({"t": "ping", "at": Time.get_ticks_msec()})
	elif state == WebSocketPeer.STATE_CLOSED and (connected or _opening):
		# Godot drops the packets that arrive together with the close frame, and the server sends its
		# refusal ({t:"error"} / {t:"kicked"}) right before closing: rebuild it from the close code.
		var cc := ws.get_close_code()
		connected = false
		_opening = false
		if cc == 4003:
			message.emit({"t": "error", "code": "refused", "msg": ""})
		elif cc == 4004:
			message.emit({"t": "kicked", "code": "leader", "msg": ""})
		else:
			closed.emit()

static func _platform() -> String:
	match OS.get_name():
		"Android": return "android"
		"iOS": return "ios"
		"Web": return "web"
	return "steam"

static func _client_id() -> String:
	var path := "user://cid"
	if FileAccess.file_exists(path):
		return FileAccess.get_file_as_string(path).strip_edges()
	var cid := ""
	var crypto := Crypto.new()
	cid = crypto.generate_random_bytes(16).hex_encode()
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(cid)
	return cid
