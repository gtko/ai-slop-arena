# Encodes a PNG frame sequence to Ogg Theora with Blender's own FFmpeg (tools/record-abilities.mjs).
# Some FFmpeg builds ship a libtheora whose inter frames neither FFmpeg's decoder nor Godot's can read
# ("error in unpack_block_qpis", blocky garbage after the first frame); Blender's encodes clean ones.
#   blender --background --factory-startup --python encode_theora_blender.py -- \
#     <frames dir> <first frame index> <frame count> <out .ogv> <width> <height> <kbit/s> [fps]
# The frames are already at the output size (the runner scales them with ffmpeg first).
import os
import sys

import bpy

a = sys.argv[sys.argv.index('--') + 1:]
src, first, count, out, w, h, kbps = a[0], int(a[1]), int(a[2]), a[3], int(a[4]), int(a[5]), int(a[6])
fps = int(a[7]) if len(a) > 7 else 30

s = bpy.context.scene
s.render.fps = fps
s.render.fps_base = 1.0
s.render.resolution_x = w
s.render.resolution_y = h
s.render.resolution_percentage = 100
s.render.use_sequencer = True
s.render.use_compositing = False
s.view_settings.view_transform = 'Standard'   # the frames are final sRGB pixels: no Filmic / AgX look
s.view_settings.look = 'None'
s.sequencer_colorspace_settings.name = 'sRGB'
s.frame_start = 1
s.frame_end = count
ed = s.sequence_editor_create()
names = ['f%08d.png' % (first + k) for k in range(count)]
strips = ed.strips if hasattr(ed, 'strips') else ed.sequences
st = strips.new_image(name='frames', filepath=os.path.join(src, names[0]), channel=1, frame_start=1)
for n in names[1:]:
    st.elements.append(n)
st.frame_final_duration = count
im = s.render.image_settings
if 'media_type' in im.bl_rna.properties:
    im.media_type = 'VIDEO'
im.file_format = 'FFMPEG'
ff = s.render.ffmpeg
ff.format = 'OGG'
ff.codec = 'THEORA'
ff.constant_rate_factor = 'NONE'
ff.video_bitrate = kbps
ff.minrate = 0
ff.maxrate = kbps * 2
ff.gopsize = fps
ff.audio_codec = 'NONE'
s.render.filepath = out
bpy.ops.render.render(animation=True)
# Blender appends the frame range to a path without one: move it to the asked name
d = os.path.dirname(out) or '.'
base = os.path.splitext(os.path.basename(out))[0]
if not os.path.exists(out):
    for f in os.listdir(d):
        if f.startswith(base) and f.endswith('.ogv') and f != os.path.basename(out):
            os.replace(os.path.join(d, f), out)
            break
print('ENCODED', out, os.path.getsize(out) if os.path.exists(out) else -1)
