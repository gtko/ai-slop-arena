class_name MatchmakingClient
extends Node
# Quick play through the server's cross-platform queue (worker/index.js Matchmaker).
#
# The web build's solo queue is the /mm socket (src/matchmaking.js): the server sends
# {t:"matched", code} and closes the socket in the same instant. Godot's WebSocketPeer drops the
# packets that arrive together with the close frame, so that message would be lost. Instead this
# client uses the party route of the same queue (what the web build does for friends who queue
# together): a throw-away room with one player is put in the queue ({t:"pq"}), the room socket stays
# open, and {t:"queue"} / {t:"matched", code} arrive on it. Same queue, same cross-platform
# matching, same ranked rooms, same "play now with bots" ({t:"pqBots"}).

signal queue(info: Dictionary)      # n, need, waited (ms), botsIn (ms), plats
signal matched(code: String)
signal failed(msg: String, code: String)   # refused (outdated, banned...) or unreachable

var ws := WebSocketPeer.new()
var searching := false
var _welcomed := false
var _tick := 2.0
var _mode := "solo"

func start(origin: String, player_name: String, brawler: String, lo: String, mode: String) -> Error:
	cancel()
	ws = WebSocketPeer.new()
	_mode = "duo" if mode == "duo" else "solo"
	var code := "W"
	var a := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for i in 5:
		code += a[randi() % a.length()]
	var err := ws.connect_to_url("%s/ws/%s?%s" % [origin, code, NetClient.identity_query(player_name, brawler, lo, "")])
	if err != OK:
		return err
	searching = true
	_welcomed = false
	_tick = 2.0
	return OK

# "Play now with bots": the queue's leader (us) asks for a match right away.
func bots() -> void:
	_send({"t": "pqBots"})

func cancel() -> void:
	if searching and _welcomed:
		_send({"t": "pqStop"})
	if ws.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		ws.close()
	searching = false

func _send(m: Dictionary) -> void:
	if ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws.send_text(JSON.stringify(m))

func _process(delta: float) -> void:
	if not searching:
		return
	ws.poll()
	var st := ws.get_ready_state()
	if st == WebSocketPeer.STATE_OPEN:
		while ws.get_available_packet_count() > 0:
			var msg: Variant = JSON.parse_string(ws.get_packet().get_string_from_utf8())
			if typeof(msg) != TYPE_DICTIONARY:
				continue
			var m: Dictionary = msg
			match String(m.get("t", "")):
				"welcome":
					_welcomed = true
					if _mode == "duo":
						_send({"t": "mode", "mode": "duo"})
					_send({"t": "pq"})
				"queue":
					queue.emit(m)
				"matched":
					searching = false
					ws.close()
					matched.emit(String(m.get("code", "")))
					return
				"error":
					searching = false
					ws.close()
					failed.emit(String(m.get("msg", "")), String(m.get("code", "")))
					return
		_tick -= delta
		if _tick <= 0.0 and _welcomed:
			_tick = 2.0
			_send({"t": "pqTick"})   # keeps the ticket alive
	elif st == WebSocketPeer.STATE_CLOSED:
		searching = false
		failed.emit("", "unreachable")
