shader_type spatial;
// Cartoon outline of the figurines (src/models.js outlineMaterial, figurines.js figurineOutline): an
// inverted hull, the mesh pushed out along its normals and drawn back faces only, in the team colour
// (brawler.js LINE: you, your Duo partner, enemies). Drawn by a second MeshInstance3D sharing the
// figurine's mesh and skin; it casts no shadow.
render_mode unshaded, cull_front, shadows_disabled;

uniform vec4 color : source_color = vec4(0.102, 0.063, 0.141, 1.0); // 0x1a1024
uniform float width = 0.02; // in the model's own units, like the web's (the same dequantised mesh)

void vertex() {
	VERTEX += normalize(NORMAL) * width;
}

void fragment() {
	ALBEDO = color.rgb;
}
