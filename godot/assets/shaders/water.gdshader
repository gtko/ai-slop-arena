shader_type spatial;
// Cheap animated water for the 'W' tiles (src/water.js, shore.js): a transparent lit surface with
// travelling ripples, a fresnel sky reflection, shallows near the bank, foam along the shore and slow
// caustic lines. The bank distance comes from per-tile edge flags (INSTANCE_CUSTOM: land on -x, +x,
// -z, +z), so no texture is needed. `detail` 0 (Quality low) drops the ripple normals and caustics.
render_mode blend_mix, depth_draw_never, cull_back;

uniform vec3 shallow : source_color = vec3(0.12, 0.72, 0.85);
uniform vec3 deep : source_color = vec3(0.04, 0.3, 0.59);
uniform vec3 sky_col : source_color = vec3(0.78, 0.88, 1.0);
uniform vec3 foam_col : source_color = vec3(1.0, 1.0, 1.0);
uniform float murk = 0.0;       // swamp: opaque olive water, less shine
uniform float detail = 1.0;

varying vec3 wpos;
varying vec4 edges;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	edges = INSTANCE_CUSTOM;
}

void fragment() {
	vec2 p = wpos.xz;
	float t = TIME;
	vec3 n = vec3(0.0, 1.0, 0.0);
	float cau = 0.0;
	if (detail > 0.5) {
		float dx = 0.5 * cos(p.x * 1.7 + t * 1.3 + p.y * 0.6) + 0.3 * cos((p.x + p.y) * 3.1 - t * 1.9) + 0.2 * cos(p.x * 5.3 + t * 2.7);
		float dz = 0.5 * cos(p.y * 1.5 - t * 1.1 + p.x * 0.4) + 0.3 * cos((p.x - p.y) * 2.9 + t * 1.7) + 0.2 * cos(p.y * 5.9 - t * 2.3);
		n = normalize(vec3(-dx * 0.09, 1.0, -dz * 0.09));
		float a = sin(p.x * 3.1 + sin(p.y * 2.3 + t * 0.7) * 1.7 + t * 0.9);
		float b = sin(p.y * 3.7 + sin(p.x * 2.9 - t * 0.8) * 1.5 - t * 1.1);
		cau = pow(max(0.0, a * b), 6.0) * 0.5;
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	// distance to the nearest bank of this tile (0 at the shore, 1 in the middle)
	vec2 uv = UV;
	float d = 1.0;
	if (edges.x > 0.5) d = min(d, uv.x);
	if (edges.y > 0.5) d = min(d, 1.0 - uv.x);
	if (edges.z > 0.5) d = min(d, uv.y);
	if (edges.w > 0.5) d = min(d, 1.0 - uv.y);
	float wob = 0.03 * sin(t * 2.0 + p.x * 3.0 + p.y * 2.0);
	float foam = 1.0 - smoothstep(0.02, 0.13 + wob, d);
	float depth = smoothstep(0.0, 0.55, d);
	vec3 col = mix(shallow, deep, depth);
	col += vec3(cau) * (1.0 - depth * 0.6) * (1.0 - murk);
	col = mix(col, sky_col, fres * (0.55 - 0.35 * murk));
	col = mix(col, foam_col, foam * 0.75 * (1.0 - murk * 0.4));
	ALBEDO = col;
	ALPHA = clamp(mix(0.55, 0.9, depth) + murk * 0.25 + foam * 0.3, 0.0, 1.0);
	ROUGHNESS = mix(0.1, 0.5, murk);
	SPECULAR = 0.8 - murk * 0.4;
}
