shader_type spatial;
// Pond surface (src/water.js surfaceMaterial): shallow to deep with the distance to the rounded shore
// (field texture, water.gd), lapping foam at the bank and on ripple crests, two world-space scrolling
// layers of the web's wave normal map (assets/tex/water_n.png = materials.js waterNormalTexture) plus
// the ripple rings (shots, blasts, idle plops: water.gd ripple), roughness 0.16 for the sun glint and
// a fresnel sky reflection in the time of day's colour. Transparent: the sandy bed and its caustics
// (water_bed.gdshader) show through the shallows. Misty Marsh: olive swamp colours (water.gd).
// `detail` 0 (Quality low) keeps a flat surface (no normal map, no ripples); the LOW variant
// (quality.gd: Low on phones / tablets) compiles them out and lights it like `detail` 0.
render_mode blend_mix, depth_draw_never, cull_back;

#include "res://assets/shaders/toon.gdshaderinc"

uniform vec3 shallow : source_color = vec3(0.12, 0.72, 0.85);
uniform vec3 deep : source_color = vec3(0.04, 0.3, 0.59);
uniform float detail = 1.0;
uniform sampler2D water_n : filter_linear_mipmap, repeat_enable;
uniform sampler2D field_tex : filter_linear, repeat_disable;
uniform float field_half = 25.0;
uniform float field_step = 0.333;
uniform float field_size = 151.0;
uniform float now = 0.0;            // the ripples' clock (water.gd)
uniform vec4 rip[8];                // x, z, start time, amplitude
global uniform vec4 g_sky;          // the time of day's sky colour (lighting.gd), linear

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wpos.xz;
	float t = now;
	vec2 fuv = ((p + field_half) / field_step + 0.5) / field_size;
	float sd = texture(field_tex, fuv).g * 1.5;         // distance to the bank, in tiles
	float nz = texture(water_n, p * 0.35 + t * 0.02).r;
	float ripple = 0.0;
	vec2 rgrad = vec2(0.0);
#ifndef LOW
	if (detail > 0.5) {
		for (int k = 0; k < 8; k++) {
			vec4 R = rip[k];
			float age = t - R.z;
			if (age < 0.0 || age > 3.0) {
				continue;
			}
			vec2 d = p - R.xy;
			float r = length(d) + 1e-4;
			float front = r - age * 2.6;
			float ring = exp(-front * front * 9.0) * exp(-age * 1.4) * R.w;
			ripple += ring;
			rgrad += d / r * ring * sin(front * 14.0);
		}
	}
#endif
	float depth = smoothstep(0.05, 0.95, sd);
	vec3 col = mix(shallow, deep, depth);
	float a = mix(0.45, 0.8, depth);
	float lap = sin(t * 1.8 + sd * 18.0) * 0.035;
	float foam = 1.0 - smoothstep(0.02, 0.1, sd + (nz - 0.5) * 0.07 + lap * 0.6);
	foam = max(foam, smoothstep(0.45, 1.0, ripple) * 0.6);
	col = mix(col, vec3(0.95, 0.98, 1.0), foam);
	a = mix(a, 0.95, foam);
	vec3 n = vec3(0.0, 1.0, 0.0);
#ifndef LOW
	if (detail > 0.5) {
		vec3 n1 = texture(water_n, p * 0.21 + vec2(t * 0.031, t * 0.017)).xyz * 2.0 - 1.0;
		vec3 n2 = texture(water_n, p * 0.47 + vec2(-t * 0.024, t * 0.038)).xyz * 2.0 - 1.0;
		vec2 slope = (n1.xy * 0.6 + n2.xy * 0.4) * 0.38 + rgrad * 1.2;
		n = normalize(vec3(slope.x, 1.0, -slope.y));
		n = normalize(mix(n, vec3(0.0, 1.0, 0.0), foam * 0.7));
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
#else
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	float fr1 = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	fr1 *= fr1;
	float fres = fr1 * fr1;
#endif
	ALBEDO = col;
	ALPHA = a;
	ROUGHNESS = mix(0.16, 0.85, foam);
	METALLIC = 0.0;
	// the web's cheap sky reflection (uSky = sky colour * 0.25)
	EMISSION = g_sky.rgb * 0.25 * (0.04 + fres * 0.7) * (1.0 - foam);
#ifdef LOW
	SIGHT_SHADE(wpos)
#endif
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
}
