// The web build's "cartoon" lighting (src/cartoon.js + src/materials.js rimPatch), shared by the world
// shaders (ground, props, foliage, grass):
//  - direct light N.L goes through a soft two-step ramp (lit band, mid band, shadow band), 85 % mixed
//    in, for the diffuse and the GGX specular alike (three's patched `irradiance`);
//  - a fresnel rim in the time-of-day rim colour (g_rim, set by lighting.gd) on props.
// Units: Godot's LIGHT_COLOR is colour * energy * PI, i.e. three's colour * intensity when the light
// energy is three's intensity / PI (lighting.gd does that), so these formulas are three's own.

global uniform vec4 g_rim; // rgb rim colour, a strength

float toon_ramp(float x) {
	return smoothstep(0.0, 0.12, x) * 0.52 + smoothstep(0.3, 0.5, x) * 0.48;
}

// MeshStandardMaterial direct lighting (dielectric, F0 0.04) with the cartoon ramp.
void toon_direct(vec3 n, vec3 v, vec3 l, vec3 lc, float att, float rough, inout vec3 diff, inout vec3 spec) {
	float ndl = clamp(dot(n, l), 0.0, 1.0);
	vec3 irr = lc * (mix(ndl, toon_ramp(ndl), 0.85) * att);
	diff += irr / PI;
	vec3 h = normalize(l + v);
	float ndh = clamp(dot(n, h), 0.0, 1.0);
	float ndv = clamp(dot(n, v), 1e-3, 1.0);
	float a = max(rough * rough, 0.002);
	float a2 = a * a;
	float dd = ndh * ndh * (a2 - 1.0) + 1.0;
	float d = a2 / (PI * dd * dd);
	float vis = 0.5 / max(ndl * sqrt(ndv * ndv * (1.0 - a2) + a2) + ndv * sqrt(ndl * ndl * (1.0 - a2) + a2), 1e-5);
	float f = 0.04 + 0.96 * pow(1.0 - clamp(dot(v, h), 0.0, 1.0), 5.0);
	spec += irr * (d * vis * f);
}

// Fresnel rim (charMat / props): added light, not tinted by the albedo.
vec3 toon_rim(vec3 n, vec3 v) {
	float r = smoothstep(0.5, 1.0, 1.0 - clamp(dot(n, v), 0.0, 1.0));
	return g_rim.rgb * (r * g_rim.a);
}
