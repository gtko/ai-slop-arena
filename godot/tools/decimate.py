# Blender (headless) decimation of one GLB, called by convert-models.mjs for the decor drawn by the
# hundred (bushes, wall blocks):
#   blender --background --factory-startup --python godot/tools/decimate.py -- in.glb out.glb 0.3
# Welds the corners by position (the UVs stay per corner, so the texture seams are kept as such), runs
# a collapse decimation to the given ratio of triangles, shades flat (the decor's faceted look in
# Godot: convert-models computes flat normals) and writes the GLB back with its texture.
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, ratio = argv[0], argv[1], float(argv[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
before = after = 0
for ob in meshes:
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(ob.data)
    bm.free()
    before += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in ob.data.polygons:
        p.use_smooth = False
    after += sum(len(p.vertices) - 2 for p in ob.data.polygons)

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_normals=True, export_texcoords=True,
                          export_materials="EXPORT", export_animations=False, export_yup=True)
print("DECIMATE %s: %d -> %d triangles" % (src, before, after))
