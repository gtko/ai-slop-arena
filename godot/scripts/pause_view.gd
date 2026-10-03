class_name PauseView
extends CssView
# The in-match pause box, a port of the web's #pause .pause-card (play.html, src/style.css): the dark
# blurred-looking veil, PAUSED in the display face, RESUME (.big), OPTIONS and QUIT TO MENU (.ghost)
# stretched to 360 px, the online note under them. With a keyboard / pad driving the menus the focus
# starts on RESUME. The match keeps running (online): it only covers the screen.

signal resume
signal quit
signal options

# The home screen's Escape menu reuses this card: the game's name instead of PAUSED, no online note,
# and QUIT GAME (native builds only: a browser tab is closed by the browser) instead of QUIT TO MENU.
var home := false

func _ready() -> void:
	super._ready()
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	visibility_changed.connect(func(): if visible: _animate = true; rebuild(); _focus_first())

func _build() -> void:
	var bg := ColorRect.new()
	bg.color = Color(8 / 255.0, 6 / 255.0, 18 / 255.0, 0.72)
	bg.size = Vector2(W, H)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.add_child(bg)
	var w := minf(320.0 if phone else 360.0, W - 28.0)
	var col := _box(7 if phone else 12, true)
	col.custom_minimum_size.x = w
	var t := _title("AI SLOP ARENA" if home else I18n.t("pause.title"), 40 if phone else 72, Color.WHITE, 4.0 if phone else 5.0, 4.0 if phone else 6.0)
	var ta := UiKit.anim(t)
	col.add_child(ta)
	col.add_child(_gap(2 if phone else 8))
	var r := _big(I18n.t("pause.resume"), 21 if phone else 30, 8 if phone else 12, 18, 4 if phone else 6)
	r.pressed.connect(func(): visible = false; resume.emit())
	col.add_child(r)
	_first = r
	var o := _ghost(I18n.t("pause.options"), 15 if phone else 22, 7 if phone else 12, 14, 4 if phone else 6)
	o.pressed.connect(func(): options.emit())
	col.add_child(o)
	if not (home and (OS.has_feature("web") or OS.has_feature("ios"))):   # iOS: apps never quit themselves
		var q := _ghost(I18n.t("home.quit" if home else "pause.quit"), 15 if phone else 22, 7 if phone else 12, 14, 4 if phone else 6)
		q.pressed.connect(func(): visible = false; quit.emit())
		col.add_child(q)
	if not home:
		var note := _body(I18n.t("pause.online"), 12, UiKit.WMUTED, 700)
		note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(note)
	_page.add_child(col)
	col.reset_size()
	var ms := col.get_combined_minimum_size()
	col.size = Vector2(w, ms.y)
	col.position = (Vector2(W, H) - col.size) / 2.0
	if _animate:   # the card drops in (0.18 s), the veil fades
		bg.modulate.a = 0.0
		bg.create_tween().tween_property(bg, "modulate:a", 1.0, 0.15)
		UiKit.pop_in(ta, 0.45, 0.0, 0.6)
		col.modulate.a = 0.0
		col.position.y -= 14.0
		var tw := col.create_tween().set_parallel(true)
		tw.tween_property(col, "modulate:a", 1.0, 0.18)
		tw.tween_property(col, "position:y", col.position.y + 14.0, 0.22).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

var _first: Control

func _focus_first() -> void:
	if Controls.focus_visible and is_instance_valid(_first):
		_first.grab_focus()

func _gap(h: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size.y = h
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c
