shader_type spatial;
// Frozen ponds (src/water.js IceField): glossy blue ice inside the rounded outline of the 'I' tiles
// (field texture, water.gd), white cracks from two scales of cell edges, frost where they crowd.
// LOW (quality.gd: Low on phones / tablets): one cell pattern instead of three (27 cells per pixel
// down to 9): the large cracks, the frost taken from the same cells (pale towards their centres).

#include "res://assets/shaders/toon.gdshaderinc"
#include "res://assets/shaders/caustics.gdshaderinc"

uniform sampler2D field_tex : filter_linear, repeat_disable;
uniform float field_half = 25.0;
uniform float field_step = 0.333;
uniform float field_size = 151.0;
global uniform vec4 g_sky;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 fuv = ((wpos.xz + field_half) / field_step + 0.5) / field_size;
	if (texture(field_tex, fuv).r >= 0.5) {
		discard;
	}
#ifdef LOW
	float e = c_edges(wpos.xz * 0.55, 0.0);
	float c1 = 1.0 - smoothstep(0.0, 0.05, e);
	vec3 col = mix(vec3(0.28, 0.55, 0.78), vec3(0.75, 0.9, 1.0), smoothstep(0.0, 0.6, e * 0.9));   // the full frost's mean
	col = mix(col, vec3(0.97, 0.99, 1.0), c1);
#else
	float c1 = 1.0 - smoothstep(0.0, 0.05, c_edges(wpos.xz * 0.55, 0.0));
	float c2 = 1.0 - smoothstep(0.0, 0.04, c_edges(wpos.xz * 1.6 + 7.0, 0.0));
	float frost = c_edges(wpos.xz * 0.9 + 3.0, 0.0);
	vec3 col = mix(vec3(0.28, 0.55, 0.78), vec3(0.75, 0.9, 1.0), smoothstep(0.0, 0.6, frost));
	col = mix(col, vec3(0.97, 0.99, 1.0), max(c1, c2 * 0.6));
#endif
	col *= vec3(0.52, 0.77, 1.0);   // the material colour 0xbfe3ff
	// a bit desaturated and brightened: what the web's studio env map (envMapIntensity 1.2) adds
	ALBEDO = min(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.8) * 1.3, vec3(1.0));
	ROUGHNESS = 0.06;
	METALLIC = 0.05;
	// the web's glossy ice mirrors its bright studio environment: a sky-tinted sheen
	EMISSION = g_sky.rgb * 0.05 + vec3(0.05);
#ifdef LOW
	SIGHT_SHADE(wpos)
#endif
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
}
