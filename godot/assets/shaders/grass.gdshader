shader_type spatial;
render_mode cull_disabled;
// Tall grass tufts (maps with bushStyle "grass": src/foliage.js grassTuftGeometry + foliageMaterials
// with upNormal): vertex-coloured blades, both faces lit like one soft volume facing the sky,
// swaying and dissolving around the hidden player (foliage.gdshaderinc).

#include "res://assets/shaders/foliage.gdshaderinc"

uniform float roughness = 0.9;

varying vec3 wpos;
varying float fh;

void vertex() {
	vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 moved = w;
	fh = fol_sway(moved, MODEL_MATRIX[3].xz, VERTEX.y);
#ifdef LOW
	VERTEX += toon_to_local(mat3(MODEL_MATRIX), moved - w);
#else
	VERTEX += inverse(mat3(MODEL_MATRIX)) * (moved - w);
#endif
	wpos = w;
}

void fragment() {
	if (fol_hidden(FRAGCOORD.xy, wpos)) {
		discard;
	}
	ALBEDO = fol_tint(COLOR.rgb, 0.6, fh);
	ROUGHNESS = roughness;
	METALLIC = 0.0;
	NORMAL = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
	if (LIGHT_IS_DIRECTIONAL) {
		fol_sun(NORMAL, VIEW, LIGHT, LIGHT_COLOR, 0.6, DIFFUSE_LIGHT);
	}
}
