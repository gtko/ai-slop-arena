shader_type spatial;
// Sculpted bushes (arena.js buildBushes, `sculpted`): the prop texture through foliageMaterials
// (no leaf pattern), swaying, dissolving around the hidden player, snow on top on snowy maps.
// See foliage.gdshaderinc. MultiMesh instance colours tint it.

#include "res://assets/shaders/foliage.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform float use_tex = 1.0;
uniform float roughness = 0.75;
uniform float sway = 1.0;
uniform float snow = 0.0;

varying vec3 wpos;
varying float fh;

void vertex() {
	vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 moved = w;
	fh = fol_sway(moved, MODEL_MATRIX[3].xz, w.y - MODEL_MATRIX[3].y);
	VERTEX += inverse(mat3(MODEL_MATRIX)) * ((moved - w) * sway);
	wpos = w;
}

void fragment() {
	if (fol_hidden(FRAGCOORD.xy, wpos)) {
		discard;
	}
	vec4 c = albedo * COLOR;
	if (use_tex > 0.5) {
		c *= texture(albedo_tex, UV);
	}
	vec3 col = fol_tint(c.rgb, 0.6, fh);
	if (snow > 0.5) {
		vec3 wn = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
		col = mix(col, vec3(0.9, 0.94, 1.0), smoothstep(0.3, 0.75, wn.y) * 0.9 * 0.85);
	}
	ALBEDO = col;
	ROUGHNESS = roughness;
	METALLIC = 0.0;
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
	if (LIGHT_IS_DIRECTIONAL) {
		fol_sun(NORMAL, VIEW, LIGHT, LIGHT_COLOR, 0.6, DIFFUSE_LIGHT);
	}
}
