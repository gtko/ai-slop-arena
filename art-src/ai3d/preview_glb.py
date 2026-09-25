"""Quick look at a generated GLB: front, three-quarter and back views side by side (Blender Workbench,
texture colours when the model has one, plain clay otherwise).
Usage: blender --background --factory-startup --python art-src/ai3d/preview_glb.py -- in.glb out.png"""
import math, sys
import bpy
from mathutils import Vector

src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre, size = (lo + hi) / 2, max(hi - lo)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'TEXTURE' if any(m.material_slots and m.material_slots[0].material for m in meshes) else 'MATERIAL'
shading.show_cavity = True
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.18, 0.18, 0.2)

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = size * 1.15
scene.collection.objects.link(cam)
scene.camera = cam
frames = []
# glTF +Z (model front) becomes Blender -Y
for i, yaw in enumerate((0, 40, 180)):
    a = math.radians(yaw)
    cam.location = centre + Vector((math.sin(a), -math.cos(a), 0.15)) * size * 3
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    path = f'{out}.{i}.png'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    frames.append(path)

# stitch
imgs = [bpy.data.images.load(p) for p in frames]
w, h = imgs[0].size
sheet = bpy.data.images.new('sheet', w * len(imgs), h)
px = [0.0] * (w * len(imgs) * h * 4)
for k, im in enumerate(imgs):
    src_px = im.pixels[:]
    for y in range(h):
        row = y * w * 4
        dst = (y * w * len(imgs) + k * w) * 4
        px[dst:dst + w * 4] = src_px[row:row + w * 4]
sheet.pixels = px
sheet.filepath_raw = out
sheet.file_format = 'PNG'
sheet.save()
import os
for p in frames:
    os.remove(p)
print('preview', out)
