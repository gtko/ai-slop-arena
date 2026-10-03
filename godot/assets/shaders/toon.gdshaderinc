// The web build's "cartoon" lighting (src/cartoon.js + src/materials.js rimPatch), shared by the world
// shaders (ground, props, foliage, grass):
//  - direct light N.L goes through a soft two-step ramp (lit band, mid band, shadow band), 85 % mixed
//    in, for the diffuse and the GGX specular alike (three's patched `irradiance`);
//  - a fresnel rim in the time-of-day rim colour (g_rim, set by lighting.gd) on props.
// Units: Godot's LIGHT_COLOR is colour * energy * PI, i.e. three's colour * intensity when the light
// energy is three's intensity / PI (lighting.gd does that), so these formulas are three's own.

global uniform vec4 g_rim; // rgb rim colour, a strength

// the world textures' filter: anisotropic (4x by default), plain trilinear in the LOW variant
#ifdef LOW
#define TEX_FILTER filter_linear_mipmap
#else
#define TEX_FILTER filter_linear_mipmap_anisotropic
#endif

float toon_ramp(float x) {
	return smoothstep(0.0, 0.12, x) * 0.52 + smoothstep(0.3, 0.5, x) * 0.48;
}

// LOW (Quality.low_shaders: Low on phones / tablets, set by quality.gd before `shader_type`'s next
// line): the cheap variant of every world shader. Here: rough surfaces (roughness >= 0.7: ground,
// props, foliage, shore) skip the specular lobe (2 % of their diffuse at most), the others get the
// GGX lobe with the approximate Smith visibility (no square roots) and Schlick by multiplications.
#ifdef LOW
float toon_pow5(float x) {
	float x2 = x * x;
	return x2 * x2 * x;
}

void toon_direct(vec3 n, vec3 v, vec3 l, vec3 lc, float att, float rough, inout vec3 diff, inout vec3 spec) {
	float ndl = clamp(dot(n, l), 0.0, 1.0);
	vec3 irr = lc * (mix(ndl, toon_ramp(ndl), 0.85) * att);
	diff += irr / PI;
	if (rough < 0.7) {
		vec3 h = normalize(l + v);
		float ndh = clamp(dot(n, h), 0.0, 1.0);
		float ndv = clamp(dot(n, v), 1e-3, 1.0);
		float a = max(rough * rough, 0.002);
		float a2 = a * a;
		float dd = ndh * ndh * (a2 - 1.0) + 1.0;
		float d = a2 / (PI * dd * dd);
		float vis = 0.5 / max(ndl * (ndv * (1.0 - a) + a) + ndv * (ndl * (1.0 - a) + a), 1e-5);
		float f = 0.04 + 0.96 * toon_pow5(1.0 - clamp(dot(v, h), 0.0, 1.0));
		spec += irr * (d * vis * f);
	}
}
#else
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
#endif

// A world-space offset into the model's space: inverse(mat3(MODEL_MATRIX)) * d, exact for rotations with
// a scale per axis (the decor's transforms), without the 3x3 inverse per vertex (sway, LOW variant).
vec3 toon_to_local(mat3 m, vec3 d) {
	return vec3(dot(m[0], d) / dot(m[0], m[0]), dot(m[1], d) / dot(m[1], m[1]), dot(m[2], d) / dot(m[2], m[2]));
}

// Fresnel rim (charMat / props): added light, not tinted by the albedo.
vec3 toon_rim(vec3 n, vec3 v) {
	float r = smoothstep(0.5, 1.0, 1.0 - clamp(dot(n, v), 0.0, 1.0));
	return g_rim.rgb * (r * g_rim.a);
}
