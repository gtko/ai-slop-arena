shader_type spatial;
// Shore reed clumps (src/shore.js reedGeometry), double-sided: see shore.gdshader.
render_mode cull_disabled;

#include "res://assets/shaders/toon.gdshaderinc"

uniform float roughness = 0.85;

void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = roughness;
	METALLIC = 0.0;
#ifdef LOW
	vec3 sh_wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	SIGHT_SHADE(sh_wp)
#endif
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
}
