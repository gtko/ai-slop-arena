@tool
extends EditorScenePostImport
# Post-import script of the fauna GLBs (assets/models/fauna/*.glb.import, import_script/path): their
# meshes step down the LODs Godot builds for them 2.5x sooner. An animal is 10-30 px tall at the game
# camera and was drawn with ~3k of its ~5.7k triangles; with this it takes the 0.5-1.4k levels there.
# (ambient.gd places them; the bias is baked in the imported scene, every tier.)

const LOD_BIAS := 0.4

func _post_import(scene: Node) -> Object:
	for n in scene.find_children("*", "GeometryInstance3D", true, false):
		(n as GeometryInstance3D).lod_bias = LOD_BIAS
	return scene
