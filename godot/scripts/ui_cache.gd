class_name UiCache
extends Node
# Draws a CanvasLayer (the menus) into a texture and shows that texture, redrawing it only when
# something in the layer changed.
#
# Why: the Compatibility renderer turns every style box, label run, icon, clip and material switch
# of the menus into its own draw call, and draws them all again every frame because the live match
# behind the home screen changes every frame. The home screen is ~300 draw calls of 2D for ~110 of
# 3D; in a browser each draw call goes through WebGL validation and ANGLE (D3D11 on Windows) in
# the GPU process, which is what held the web build far under 60 fps. Cached, the menu costs one
# textured quad a frame and the full price only on the frames where it changes.
#
# On the web export and natively on phones / tablets (web_perf.gd): the Mobile and Compatibility
# renderers pay for each of those draw calls too (the home screen: ~405 draw calls -> ~105).
#
# How: CanvasLayer.custom_viewport sends the layer's canvas to a SubViewport (window-sized in
# physical pixels, the logical size as its 2D size, so text stays as sharp as before). The nodes do
# not move: input, focus and layout still happen in the main viewport exactly as before; only the
# pixels are drawn elsewhere. The SubViewport renders when:
#   - a CanvasItem of the layer redrew, moved, resized or changed visibility (its signals),
#   - an input event arrived or something changed in the last HOT seconds (hover, press and the
#     tweens they start, page transitions),
#   - and at REFRESH Hz anyway (a modulate changed by code, no signal for that).
# A layer that changes nearly every frame (the in-match HUD) is not worth caching: it goes back to
# drawing straight to the screen for a while (bypass), then the cache tries again.

const HOT := 0.7          # s of full-rate updates after an input event or a change
const REFRESH := 0.25     # s between safety refreshes while idle
const BUSY := 0.85        # share of dirty frames (over the last WINDOW) that switches to bypass
const WINDOW := 40
const BYPASS := 3.0       # s spent drawing directly before trying the cache again

var layer: CanvasLayer
var _vp: SubViewport
var _view_layer: CanvasLayer
var _view: TextureRect
var _on := false
var _dirty := true
var _hot := 0.0
var _since := 0.0
var _hist: PackedByteArray = []
var _bypass := 0.0
var _hooked := {}
static var _poked := -10

# Content that moves every frame without redrawing (the HUD's plates follow the fighters): call this
# each frame it is on screen, the layer is then drawn directly.
static func poke() -> void:
	_poked = Engine.get_process_frames()

func _init(target: CanvasLayer) -> void:
	layer = target
	name = "UiCache_%s" % target.name
	process_priority = 900   # after the scene updated: this frame's changes are known

func _ready() -> void:
	_vp = SubViewport.new()
	_vp.disable_3d = true
	_vp.transparent_bg = true
	_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	_vp.size_2d_override_stretch = true
	_vp.gui_disable_input = true
	add_child(_vp)
	_view_layer = CanvasLayer.new()
	_view_layer.layer = layer.layer
	add_child(_view_layer)
	_view = TextureRect.new()
	_view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_view.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_view.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_view.stretch_mode = TextureRect.STRETCH_SCALE
	_view.texture = _vp.get_texture()
	var m := CanvasItemMaterial.new()
	m.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA   # the layer was drawn over transparency
	_view.material = m
	_view.visible = false
	_view_layer.add_child(_view)
	_hook(layer)
	get_tree().node_added.connect(_on_node_added)
	get_viewport().size_changed.connect(_resize)
	_resize()

func _exit_tree() -> void:
	if _on and is_instance_valid(layer) and layer.is_inside_tree() and get_viewport() != null:
		layer.custom_viewport = get_viewport()   # (null is refused: the main viewport is the default)
		_on = false

func _resize() -> void:
	var logical := get_viewport().get_visible_rect().size
	var px := Vector2(DisplayServer.window_get_size())
	var w := get_window()
	if px.x < 1.0 or px.y < 1.0 or (w and w.content_scale_mode == Window.CONTENT_SCALE_MODE_VIEWPORT):
		px = logical   # (phones / tablets: the frame budget draws the whole frame at the logical size)
	_vp.size = Vector2i(maxi(1, int(px.x)), maxi(1, int(px.y)))
	_vp.size_2d_override = Vector2i(maxi(1, int(logical.x)), maxi(1, int(logical.y)))
	_mark()

func _on_node_added(n: Node) -> void:
	if n is CanvasItem and is_instance_valid(layer) and layer.is_ancestor_of(n):
		_hook(n)
		_mark()

func _hook(n: Node) -> void:
	if n is CanvasItem and not _hooked.has(n.get_instance_id()):
		_hooked[n.get_instance_id()] = true
		var ci := n as CanvasItem
		ci.draw.connect(_mark)
		ci.visibility_changed.connect(_mark)
		ci.tree_exiting.connect(_forget.bind(n.get_instance_id()))
		if ci is Control:
			(ci as Control).item_rect_changed.connect(_mark)
	for c in n.get_children():
		_hook(c)

func _forget(id: int) -> void:
	_hooked.erase(id)
	_mark()

func _mark() -> void:
	_dirty = true
	_hot = HOT

func _input(_e: InputEvent) -> void:
	_hot = HOT

# Something with no visible content in the layer: nothing to draw, neither cached nor direct.
func _empty() -> bool:
	for c in layer.get_children():
		if c is CanvasItem and (c as CanvasItem).visible:
			return false
	return true

func _process(delta: float) -> void:
	if not is_instance_valid(layer):
		queue_free()
		return
	_since += delta
	_hot = maxf(0.0, _hot - delta)
	if Engine.get_process_frames() - _poked <= 1:
		_bypass = maxf(_bypass, 0.5)   # live content on the layer: draw it directly
	var update := _dirty or _hot > 0.0 or _since >= REFRESH
	_hist.append(1 if (_dirty or _hot > 0.0) else 0)
	if _hist.size() > WINDOW:
		_hist.remove_at(0)
	var want := not _empty()
	if _bypass > 0.0:
		_bypass -= delta
		want = false
	elif _hist.size() >= WINDOW:
		var busy := 0
		for b in _hist:
			busy += b
		if busy >= int(WINDOW * BUSY) and _on:
			_bypass = BYPASS   # changes every frame: drawing it directly is cheaper
			_hist.clear()
			want = false
	if want != _on:
		_on = want
		layer.custom_viewport = _vp if _on else get_viewport()
		_view.visible = _on
		update = true
	if _on and update:
		_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		_since = 0.0
	_dirty = false
