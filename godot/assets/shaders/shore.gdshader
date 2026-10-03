shader_type spatial;
// Shore pebbles and reed clumps (src/shore.js shoreDecor): a plain MeshStandardMaterial coloured by
// the instance colour (pebbles) or the vertex colours (reeds, double-sided), with the cartoon ramp.
render_mode cull_back;

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
