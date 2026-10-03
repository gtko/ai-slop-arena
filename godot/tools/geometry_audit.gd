extends SceneTree
# Geometry / draw-call audit of the world and the fighters (no server, no menus). Builds each map's
# Arena under a host that looks like main.gd to it (sun, fighters, me, cam_focus, arena), puts the
# 8 brawlers around the camera focus, and prints, per map and per camera view, what the renderer
# drew (RenderingServer viewport render info: draw calls, objects, primitives, opaque/visible pass
# and shadow pass apart), then the same with each category hidden in turn (its cost = the
# difference). With --models it also lists every GLB: triangles, vertices, surfaces, LODs, bones,
# blend shapes.
#
#   godot --path godot --resolution 1280x720 -s res://tools/geometry_audit.gd -- --quality=low [--maps=dunes,grove] [--models] [--out=path.md] [--shots=dir]
#
# Needs a real renderer (not --headless: the dummy one counts nothing). Mobile renderer by default,
# add `--rendering-method gl_compatibility` before `-s` for the web's.

const VIEWS := {   # name -> [focus, distance multiplier]
	"game": [Vector3(0, 0, 4), 1.0],          # main.gd's starting focus
	"edge": [Vector3(0, 0, 19), 1.0],         # focus clamped at the near edge: the most outer decor
	"menu": [Vector3(0, 0, 2), 0.8],          # the home screen's attract camera (MENU_ZOOM)
}
const BRAWLERS := ["blaster", "bomber", "frostbite", "gunslinger", "kappa", "mochi", "pipchomp", "volt"]

class Host extends Node3D:
	var sun: DirectionalLight3D
	var env: WorldEnvironment
	var fighters: Dictionary = {}
	var me: Fighter
	var cam_focus := Vector3.ZERO
	var arena: Arena
	var cam: Camera3D
	func _process(delta: float) -> void:
		if arena:
			arena.update(delta)

var host: Host
var out: PackedStringArray = []
var _frames := 0
var _shots := ""   # --shots=<dir>: a PNG per map and view (before / after comparisons)

func _initialize() -> void:
	_run.call_deferred()

func _p(s: String) -> void:
	print(s)
	out.append(s)

func _wait(n: int) -> void:
	for k in n:
		await process_frame
	await RenderingServer.frame_post_draw

func _info() -> Dictionary:
	var vp := root.get_viewport_rid()
	var r := {}
	for pass_name in ["vis", "shadow"]:
		var t := RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE if pass_name == "vis" else RenderingServer.VIEWPORT_RENDER_INFO_TYPE_SHADOW
		r[pass_name + "_draws"] = RenderingServer.viewport_get_render_info(vp, t, RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME)
		r[pass_name + "_objs"] = RenderingServer.viewport_get_render_info(vp, t, RenderingServer.VIEWPORT_RENDER_INFO_OBJECTS_IN_FRAME)
		r[pass_name + "_prims"] = RenderingServer.viewport_get_render_info(vp, t, RenderingServer.VIEWPORT_RENDER_INFO_PRIMITIVES_IN_FRAME)
	return r

func _args() -> Dictionary:
	var a := {}
	for s in OS.get_cmdline_user_args():
		var kv := s.trim_prefix("--").split("=", true, 1)
		a[kv[0]] = kv[1] if kv.size() > 1 else "1"
	return a

func _run() -> void:
	var args := _args()
	_shots = String(args.get("shots", ""))
	if args.has("models"):
		_models()
	var maps: Array = GameData.maps.keys()
	if args.has("maps"):
		maps = Array(String(args.maps).split(","))
	_p("# Geometry audit: quality %s, renderer %s, %dx%d" % [Quality.level, RenderingServer.get_current_rendering_method(),
		root.get_visible_rect().size.x, root.get_visible_rect().size.y])
	for m in maps:
		await _audit_map(String(m))
	if args.has("out"):
		var f := FileAccess.open(String(args.out), FileAccess.WRITE)
		if f:
			f.store_string("\n".join(out) + "\n")
	quit()

func _build(map_key: String) -> void:
	host = Host.new()
	host.name = "Main"
	root.add_child(host)
	current_scene = host
	host.cam = Camera3D.new()
	host.cam.fov = 40
	host.cam.near = 0.5
	host.cam.far = 260.0
	host.add_child(host.cam)
	host.cam.current = true
	host.sun = DirectionalLight3D.new()
	host.sun.rotation_degrees = Vector3(-55, -30, 0)
	host.sun.shadow_enabled = true
	host.sun.directional_shadow_max_distance = 40.0
	host.add_child(host.sun)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color("87c4e8")
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.75, 0.78, 0.85)
	env.environment = e
	host.add_child(env)
	host.env = env
	host.arena = Arena.new()
	host.add_child(host.arena)
	host.arena.build(GameData.maps[map_key])
	for k in BRAWLERS.size():
		var f := Fighter.new()
		host.add_child(f)
		f.setup({"id": "f%d" % k, "name": "", "type": BRAWLERS[k]}, GameData.brawlers)
		host.fighters[f.id] = f
		for nn in ["_bar", "_label"]:   # the HUD's 2D plates replace them in a match and in the menu
			var v: Variant = f.get(nn)
			if v is Node3D:
				(v as Node3D).visible = false
		if k == 0:
			f.is_local = true
			host.me = f
	Quality.apply()

func _place(view: String) -> void:
	var v: Array = VIEWS[view]
	var focus: Vector3 = v[0]
	host.cam_focus = focus
	host.cam.position = focus + Lighting.CAM_OFFSET * float(v[1])
	host.cam.look_at(Vector3(focus.x, 0.5, focus.z))
	var k := 0
	for id in host.fighters:
		var f: Fighter = host.fighters[id]
		var a := TAU * k / host.fighters.size()
		var p := focus + Vector3(cos(a) * 6.0, 0, sin(a) * 4.0)
		f.position = p
		f.target = p
		k += 1

# What a node belongs to, for the per-category costs.
func _category(n: Node) -> String:
	var a := host.arena
	var p := n
	while p != null and p != host:
		if p is Fighter:
			return "fighters"
		if p == a.ambient:
			return "fauna"
		if p == a.water:
			return "water+shore"
		if p == a.kit:
			return "map kit"
		if p == a.lighting or p == a.weather or p == a.skins or p == a.items:
			return "light/weather/fx"
		if p.get_parent() == a:
			break
		p = p.get_parent()
	if not (n is GeometryInstance3D):
		return ""
	for d in a._decor:
		if d[0] == n:
			return "tree ring"
	var mesh: Mesh = null
	if n is MultiMeshInstance3D and (n as MultiMeshInstance3D).multimesh:
		mesh = (n as MultiMeshInstance3D).multimesh.mesh
	elif n is MeshInstance3D:
		mesh = (n as MeshInstance3D).mesh
	var gi := n as GeometryInstance3D
	if (Foliage._grass != null and gi.material_override == Foliage._grass) or (gi.material_override is ShaderMaterial and String((gi.material_override as ShaderMaterial).shader.resource_path).ends_with("foliage.gdshader")):
		return "bushes"
	if mesh is QuadMesh:
		return "lantern halos"
	if mesh is PlaneMesh:
		return "ground" if n is MultiMeshInstance3D else "outer ground"
	for prop in PropLib._cache:
		if PropLib._cache[prop].get("mesh") == mesh and mesh != null:
			return "walls" if String(prop).begins_with("wall") else ("windmill" if String(prop).begins_with("windmill") else "props")
	if mesh is BoxMesh or mesh is CylinderMesh:
		return "props"
	return "other world"

func _cats() -> Dictionary:
	var by := {}
	for n in host.find_children("*", "GeometryInstance3D", true, false):
		var c := _category(n)
		if c == "":
			continue
		if not by.has(c):
			by[c] = []
		by[c].append(n)
	return by

func _audit_map(map_key: String) -> void:
	_build(map_key)
	var cats := _cats()
	await _wait(8)
	if _args().has("dump"):
		for c in cats:
			for n in cats[c]:
				var mesh: Mesh = (n as MultiMeshInstance3D).multimesh.mesh if n is MultiMeshInstance3D else (n as MeshInstance3D).mesh if n is MeshInstance3D else null
				var cnt := (n as MultiMeshInstance3D).multimesh.visible_instance_count if n is MultiMeshInstance3D else 1
				if cnt < 0:
					cnt = (n as MultiMeshInstance3D).multimesh.instance_count
				print("DUMP %s | %s | %s | parent %s | mesh %s | n=%d | vis=%s | shadow=%d" % [c, n.name, n.get_class(), n.get_parent().name, mesh.get_class() if mesh else "-", cnt, (n as Node3D).is_visible_in_tree(), (n as GeometryInstance3D).cast_shadow])
	for view in VIEWS:
		_place(view)
		await _wait(6)
		var all := _info()
		if _shots != "":
			root.get_texture().get_image().save_png("%s/%s_%s.png" % [_shots, map_key, view])
		_p("\n## %s / %s view" % [map_key, view])
		_p("| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |")
		_p("|---|---:|---:|---:|---:|")
		_p("| **total** | %d | %d + %d | %d + %d | %.0f + %.0f |" % [_count_nodes(cats), all.vis_draws, all.shadow_draws, all.vis_objs, all.shadow_objs, all.vis_prims / 1000.0, all.shadow_prims / 1000.0])
		var keys := cats.keys()
		keys.sort()
		for c in keys:
			var was := {}
			for n in cats[c]:
				was[n] = (n as Node3D).visible
				(n as Node3D).visible = false
			await _wait(3)
			var w := _info()
			for n in cats[c]:
				(n as Node3D).visible = was[n]
			_p("| %s | %d | %d + %d | %d + %d | %.1f + %.1f |" % [c, cats[c].size(), all.vis_draws - w.vis_draws, all.shadow_draws - w.shadow_draws,
				all.vis_objs - w.vis_objs, all.shadow_objs - w.shadow_objs, (all.vis_prims - w.vis_prims) / 1000.0, (all.shadow_prims - w.shadow_prims) / 1000.0])
		await _wait(2)
	host.free()
	host = null
	PropLib._cache.clear()
	PropLib._mats.clear()
	await _wait(2)

func _count_nodes(cats: Dictionary) -> int:
	var n := 0
	for c in cats:
		n += cats[c].size()
	return n

# Every GLB: triangles (LOD 0), vertices, surfaces, LOD levels, bones, blend shapes.
func _models() -> void:
	_p("# Models\n\n| model | tris | verts | surfaces | lods (tris) | bones | blend shapes |\n|---|---:|---:|---:|---|---:|---:|")
	var paths: Array = []
	for dir in ["res://assets/models", "res://assets/models/decor", "res://assets/models/fauna"]:
		for f in DirAccess.get_files_at(dir):
			f = f.trim_suffix(".import")
			if f.ends_with(".glb") and not paths.has(dir + "/" + f):
				paths.append(dir + "/" + f)
	for path in paths:
		var inst := (load(path) as PackedScene).instantiate()
		var tris := 0
		var verts := 0
		var surfs := 0
		var lods: Array = []
		var blends := 0
		for mi in inst.find_children("*", "MeshInstance3D", true, false):
			var mesh := (mi as MeshInstance3D).mesh
			if mesh == null:
				continue
			if mesh is ArrayMesh:
				blends += (mesh as ArrayMesh).get_blend_shape_count()
			for s in mesh.get_surface_count():
				surfs += 1
				var sd := RenderingServer.mesh_get_surface(mesh.get_rid(), s)
				var ic: int = sd.get("index_count", 0)
				var vc: int = sd.get("vertex_count", 0)
				tris += ic / 3 if ic > 0 else vc / 3
				verts += vc
				var l: PackedStringArray = []
				var ld = sd.get("lods", [])
				for lod in ld:
					var data = lod.get("index_data") if lod is Dictionary else (lod[1] if lod is Array and lod.size() > 1 else null)
					if data is PackedByteArray:
						l.append("%d" % (int((data as PackedByteArray).size() / (4 if vc > 65535 else 2)) / 3))
				lods.append(",".join(l))
		var bones := 0
		for sk in inst.find_children("*", "Skeleton3D", true, false):
			bones += (sk as Skeleton3D).get_bone_count()
		_p("| %s | %d | %d | %d | %s | %d | %d |" % [path.trim_prefix("res://assets/models/"), tris, verts, surfs, " / ".join(lods), bones, blends])
		inst.free()
