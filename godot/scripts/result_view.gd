class_name ResultView
extends Control
# A simple result screen (used when the HUD has no show_result of its own): placement, ranked points
# once the server sends them, and the next choices. Spectate hides it while the match goes on.

signal again
signal menu
signal spectate

var _title: Label
var _sub: Label
var _rank: Label
var _again: Button
var _spec: Button

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	var dim := ColorRect.new()
	dim.color = Color(0.04, 0.06, 0.12, 0.82)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var p := UiKit.panel(UiKit.PANEL, 24, 26)
	p.custom_minimum_size.x = 620
	center.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	p.add_child(v)
	_title = UiKit.label("", 54, UiKit.ACCENT, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(_title)
	_sub = UiKit.label("", 22, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	_sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_sub)
	_rank = UiKit.label("", 24, UiKit.GOOD, HORIZONTAL_ALIGNMENT_CENTER)
	_rank.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_rank)
	_again = UiKit.button(I18n.t("result.again"), "primary", 76, 30)
	_again.pressed.connect(func(): again.emit())
	v.add_child(_again)
	_spec = UiKit.button(I18n.t("result.spectate"), "secondary", 60, 22)
	_spec.pressed.connect(func(): spectate.emit())
	v.add_child(_spec)
	var m := UiKit.button(I18n.t("result.menu"), "secondary", 60, 22)
	m.pressed.connect(func(): menu.emit())
	v.add_child(m)

# title: "VICTORY!" / "#3"; sub: placement text; can_spectate: the match still runs.
func show_result(title: String, sub: String, can_spectate: bool, show_again: bool = true, spec_text: String = "") -> void:
	_title.text = title
	_sub.text = sub
	_rank.text = ""
	_spec.visible = can_spectate
	_spec.text = spec_text if spec_text != "" else I18n.t("result.spectate")
	_again.visible = show_again
	visible = true

func set_rank_text(txt: String, good: bool = true) -> void:
	_rank.text = txt
	_rank.add_theme_color_override("font_color", UiKit.GOOD if good else UiKit.MUTED)
