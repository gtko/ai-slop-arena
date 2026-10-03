shader_type spatial;
// Sculpted decor props (walls, rocks, crates, trees, lanterns...): src/props.js `prepare`, i.e. a
// MeshStandardMaterial (texture, roughness 0.78, no metal) with the rim light, the cartoon ramp and,
// for trees and cacti, the gentle wind bend (swayPatch). MultiMesh instance colours tint it (walls).

#include "res://assets/shaders/toon.gdshaderinc"

uniform sampler2D albedo_tex : source_color, TEX_FILTER, repeat_enable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform float use_tex = 1.0;
uniform float roughness = 0.78;
uniform float sway = 0.0;       // 1 = the web's bend (h * h * 0.012 * wind)
global uniform float g_wind;    // 1 = calm, 3+ = storm

void vertex() {
	if (sway > 0.0) {
		vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
		float h = max(w.y - MODEL_MATRIX[3].y, 0.0);
		vec2 seed = MODEL_MATRIX[3].xz;
		float bend = h * h * 0.012 * g_wind * sway;
		vec3 d = vec3(sin(TIME * 1.3 + seed.x * 0.37 + seed.y * 0.21) * bend, 0.0, sin(TIME * 1.1 + seed.y * 0.41) * bend * 0.7);
#ifdef LOW
		VERTEX += toon_to_local(mat3(MODEL_MATRIX), d);
#else
		VERTEX += inverse(mat3(MODEL_MATRIX)) * d;
#endif
	}
}

void fragment() {
	vec4 c = albedo * COLOR;
	if (use_tex > 0.5) {
		c *= texture(albedo_tex, UV);
	}
	ALBEDO = c.rgb;
	ROUGHNESS = roughness;
	METALLIC = 0.0;
	EMISSION = toon_rim(NORMAL, VIEW);
#ifdef LOW
	vec3 sh_wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	SIGHT_SHADE(sh_wp)
#endif
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
}
