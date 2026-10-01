shader_type spatial;
// Pond surface (src/water.js surfaceMaterial): shallow to deep blue with the distance to the rounded
// shore (field texture, water.gd), foam lapping at the bank, two scrolling ripple layers, a fresnel
// sky reflection in the time of day's colour and slow caustic lines. `detail` 0 (Quality low) drops
// the ripple normals and caustics. The swamp of Misty Marsh is olive and murky.
render_mode blend_mix, depth_draw_never, cull_back;

#include "res://assets/shaders/toon.gdshaderinc"

uniform vec3 shallow : source_color = vec3(0.12, 0.72, 0.85);
uniform vec3 deep : source_color = vec3(0.04, 0.3, 0.59);
uniform float murk = 0.0;
uniform float detail = 1.0;
uniform sampler2D field_tex : filter_linear, repeat_disable;
uniform float field_half = 25.0;
uniform float field_step = 0.333;
uniform float field_size = 151.0;
global uniform vec4 g_sky;          // the time of day's sky colour (lighting.gd), linear

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wpos.xz;
	float t = TIME;
	vec2 fuv = ((p + field_half) / field_step + 0.5) / field_size;
	float sd = texture(field_tex, fuv).g * 1.5;         // distance to the bank, in tiles
	float nz = 0.5 + 0.25 * sin(p.x * 2.3 + t * 0.4) * sin(p.y * 1.9 - t * 0.3);
	float depth = smoothstep(0.05, 0.95, sd);
	vec3 col = mix(shallow, deep, depth);
	float a = mix(0.45, 0.8, depth);
	float lap = sin(t * 1.8 + sd * 18.0) * 0.035;
	float foam = 1.0 - smoothstep(0.02, 0.1, sd + (nz - 0.5) * 0.07 + lap * 0.6);
	col = mix(col, vec3(0.95, 0.98, 1.0), foam * (1.0 - murk * 0.4));
	a = mix(a, 0.95, foam);
	vec3 n = vec3(0.0, 1.0, 0.0);
	float cau = 0.0;
	if (detail > 0.5) {
		float dx = 0.5 * cos(p.x * 1.7 + t * 1.3 + p.y * 0.6) + 0.3 * cos((p.x + p.y) * 3.1 - t * 1.9) + 0.2 * cos(p.x * 5.3 + t * 2.7);
		float dz = 0.5 * cos(p.y * 1.5 - t * 1.1 + p.x * 0.4) + 0.3 * cos((p.x - p.y) * 2.9 + t * 1.7) + 0.2 * cos(p.y * 5.9 - t * 2.3);
		n = normalize(vec3(-dx * 0.12, 1.0, -dz * 0.12));
		n = normalize(mix(n, vec3(0.0, 1.0, 0.0), foam * 0.7));
		float ca = sin(p.x * 3.1 + sin(p.y * 2.3 + t * 0.7) * 1.7 + t * 0.9);
		float cb = sin(p.y * 3.7 + sin(p.x * 2.9 - t * 0.8) * 1.5 - t * 1.1);
		cau = pow(max(0.0, ca * cb), 6.0) * 0.35 * (1.0 - depth * 0.6) * (1.0 - murk) * (1.0 - foam);
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
	ALBEDO = col + vec3(cau);
	ALPHA = clamp(a + murk * 0.25, 0.0, 1.0);
	ROUGHNESS = mix(0.16, 0.85, max(foam, murk * 0.5));
	METALLIC = 0.0;
	// the cheap sky reflection of the web (uSky = sky colour * 0.25)
	EMISSION = g_sky.rgb * 0.25 * (0.04 + fres * 0.7) * (1.0 - foam);
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
}
