shader_type spatial;
// Frozen ponds (src/water.js IceField): glossy blue ice inside the rounded outline of the 'I' tiles
// (field texture, water.gd), white cracks from two scales of cell edges, frost where they crowd.

#include "res://assets/shaders/toon.gdshaderinc"

uniform sampler2D field_tex : filter_linear, repeat_disable;
uniform float field_half = 25.0;
uniform float field_step = 0.333;
uniform float field_size = 151.0;
global uniform vec4 g_sky;

varying vec3 wpos;

vec2 c_hash(vec2 p) {
	p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
	return fract(sin(p) * 43758.5453);
}

// distance between the two nearest cell centres: 0 on the cell edges
float c_edges(vec2 p) {
	vec2 g = floor(p);
	vec2 f = fract(p);
	float d1 = 8.0;
	float d2 = 8.0;
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 o = vec2(float(x), float(y));
			vec2 h = 0.5 + 0.42 * sin(6.2831 * c_hash(g + o));
			float d = length(o + h - f);
			if (d < d1) {
				d2 = d1;
				d1 = d;
			} else if (d < d2) {
				d2 = d;
			}
		}
	}
	return d2 - d1;
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 fuv = ((wpos.xz + field_half) / field_step + 0.5) / field_size;
	if (texture(field_tex, fuv).r >= 0.5) {
		discard;
	}
	float c1 = 1.0 - smoothstep(0.0, 0.05, c_edges(wpos.xz * 0.55));
	float c2 = 1.0 - smoothstep(0.0, 0.04, c_edges(wpos.xz * 1.6 + 7.0));
	float frost = c_edges(wpos.xz * 0.9 + 3.0);
	vec3 col = mix(vec3(0.28, 0.55, 0.78), vec3(0.75, 0.9, 1.0), smoothstep(0.0, 0.6, frost));
	col = mix(col, vec3(0.97, 0.99, 1.0), max(c1, c2 * 0.6));
	col *= vec3(0.52, 0.77, 1.0);   // the material colour 0xbfe3ff
	ALBEDO = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.65);
	ROUGHNESS = 0.06;
	METALLIC = 0.05;
	// the web's glossy ice mirrors its bright studio environment: a sky-tinted sheen
	EMISSION = g_sky.rgb * 0.05 + vec3(0.05);
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
}
