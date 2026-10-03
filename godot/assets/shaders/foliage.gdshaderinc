// Bushes and tall grass (src/materials.js foliagePatch): wind sway of the upper part, the "reveal"
// dissolve (the leaves around the local player fade out, dithered, while he hides in a bush), the
// leaf tint and the sun-coloured rim / transmission glow. MultiMesh friendly: everything comes from
// the world position. Globals: g_reveal (x, z, radius, amount), g_wind (foliage.gd, weather.gd).

#include "res://assets/shaders/toon.gdshaderinc"

uniform float reveal_on = 1.0;
global uniform vec4 g_reveal;
global uniform float g_wind;

// w: world position (moved in place), h_local: height above the plant's base in metres.
// Returns the sway weight (0 at the base, 1 from 1.7 m up), kept by the shaders as `fol_h`.
float fol_sway(inout vec3 w, vec2 base, float h_local) {
	float fh = clamp(h_local * 0.6, 0.0, 1.0);
	float ph = base.x * 0.37 + base.y * 0.23;
	float wd = g_wind;
	float sw = sqrt(wd);
	w.x += (sin(TIME * 1.7 * sw + ph + w.z * 0.4) * 0.07 + (wd - 1.0) * 0.03) * fh * wd;
	w.z += cos(TIME * 1.3 * sw + ph + w.x * 0.3) * 0.05 * fh * wd;
	return fh;
}

const mat4 FOL_BAYER = mat4(
	vec4(0.0, 8.0, 2.0, 10.0),
	vec4(12.0, 4.0, 14.0, 6.0),
	vec4(3.0, 11.0, 1.0, 9.0),
	vec4(15.0, 7.0, 13.0, 5.0));

bool fol_hidden(vec2 frag, vec3 world) {
	if (reveal_on < 0.5 || g_reveal.w < 0.001) {
		return false;
	}
	float rd = distance(world.xz, g_reveal.xy);
	float ra = g_reveal.w * (1.0 - smoothstep(g_reveal.z * 0.55, g_reveal.z, rd));
	ivec2 p = ivec2(mod(frag, 4.0));
	return (FOL_BAYER[p.x][p.y] + 0.5) / 16.0 < ra * 0.72;
}

// leaf: 0.6 without the cellular leaf pattern (FOL_NO_LEAF)
vec3 fol_tint(vec3 c, float leaf, float h) {
	c *= mix(0.8, 1.08, leaf) * mix(0.85, 1.1, h);
	return mix(c, c * vec3(1.15, 1.2, 0.8), leaf * h * 0.35);
}

// FOL_LIGHT: sun-coloured rim where light grazes the foliage, and light shining through it
void fol_sun(vec3 n, vec3 v, vec3 l, vec3 lc, float leaf, inout vec3 diff) {
#ifdef LOW
	float e1 = 1.0 - clamp(dot(n, v), 0.0, 1.0);
	float edge = e1 * e1 * sqrt(e1);
#else
	float edge = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.5);
#endif
	float sun_side = clamp(dot(n, l) * 0.6 + 0.4, 0.0, 1.0);
	float toward = clamp(dot(-v, l) * 0.5 + 0.5, 0.0, 1.0);
	float through = clamp(-dot(n, l), 0.0, 1.0) * toward * toward;
	diff += lc / PI * (edge * sun_side * 0.9 + through * 0.45) * (0.6 + 0.4 * leaf);
}
