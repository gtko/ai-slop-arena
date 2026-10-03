shader_type spatial;
// Brawler figurines (src/figurines.js figurineMaterial + materials.js charMat + cartoon.js): the painted
// texture brought to a common exposure (textureGain), a little self-lighting so dark outfits read from
// the high camera and inside wall shadows, the skin re-colour (cosmetics.js RECOLOURS) or the golden
// figurine, a MeshPhysicalMaterial (roughness 0.6, clear coat 0.3 / 0.45) lit through the cartoon ramp,
// the fresnel rim, and `tint` (the emissive that brawler.js drives: white hit flash, frost tint).
// One material per fighter (the flash and the frost are per brawler), one shader for all of them.

#include "res://assets/shaders/toon.gdshaderinc"

uniform sampler2D albedo_tex : source_color, TEX_FILTER, repeat_enable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform float gain = 1.0;                  // figurines.js textureGain (per brawler)
uniform vec3 recol = vec3(0.0, 1.0, 1.0);  // skin: hue turn (radians), saturation, brightness
uniform float gold = 0.0;                  // golden skin: metal 0.5, roughness 0.3, clear coat 0.8
uniform vec3 tint = vec3(0.0);             // linear emissive: hit flash / frost
uniform float self_light = 0.28;           // totalEmissiveRadiance += diffuseColor * 0.28

const float CC_ROUGH = 0.45;

void fragment() {
	vec3 c = min((albedo * texture(albedo_tex, UV)).rgb * gain, vec3(0.95));
	if (recol.x != 0.0 || recol.y != 1.0 || recol.z != 1.0) {
		mat3 to_yiq = mat3(vec3(0.299, 0.596, 0.211), vec3(0.587, -0.274, -0.523), vec3(0.114, -0.322, 0.312));
		mat3 to_rgb = mat3(vec3(1.0, 1.0, 1.0), vec3(0.956, -0.272, -1.106), vec3(0.621, -0.647, 1.703));
		vec3 yiq = to_yiq * c;
		float hc = cos(recol.x);
		float hs = sin(recol.x);
		yiq.yz = vec2(yiq.y * hc + yiq.z * hs, yiq.z * hc - yiq.y * hs) * recol.y;
		c = max(to_rgb * yiq, vec3(0.0)) * recol.z;
	}
	if (gold > 0.0) {
		float gl = dot(c, vec3(0.299, 0.587, 0.114));
		c = mix(c, vec3(1.0, 0.74, 0.22) * (0.3 + gl * 1.25), gold);
	}
	ALBEDO = c;
	ROUGHNESS = mix(0.6, 0.3, gold);
	METALLIC = 0.5 * gold;
	EMISSION = c * self_light + tint + toon_rim(NORMAL, VIEW);
}

// toon_direct (MeshStandardMaterial with the cartoon ramp) plus what the figurine adds on top: the
// metal of the golden skin (F0 towards the albedo) and the clear coat (GGX, roughness 0.45, its N.L
// not ramped, like three's clearcoat), which also dims the base layer by its fresnel.
// LOW (quality.gd): one GGX lobe at the clear coat's roughness carries both layers (the base's broad
// 0.6 lobe is folded into it), approximate Smith visibility, Schlick by multiplications.
#ifdef LOW
void light() {
	float cc = mix(0.3, 0.8, gold);
	float ndl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0);
	float ndv = clamp(dot(NORMAL, VIEW), 1e-3, 1.0);
	vec3 h = normalize(LIGHT + VIEW);
	float ndh = clamp(dot(NORMAL, h), 0.0, 1.0);
	float fv = toon_pow5(1.0 - clamp(dot(VIEW, h), 0.0, 1.0));
	float cc_dim = 1.0 - cc * (0.04 + 0.96 * toon_pow5(1.0 - ndv));
	vec3 irr = LIGHT_COLOR * (mix(ndl, toon_ramp(ndl), 0.85) * ATTENUATION);
	DIFFUSE_LIGHT += irr / PI * cc_dim;
	float a = min(ROUGHNESS, CC_ROUGH);
	a *= a;
	float a2 = a * a;
	float dd = ndh * ndh * (a2 - 1.0) + 1.0;
	float dv = a2 / (PI * dd * dd) * 0.5 / max(ndl * (ndv * (1.0 - a) + a) + ndv * (ndl * (1.0 - a) + a), 1e-5);
	vec3 f0 = mix(vec3(0.04), ALBEDO, METALLIC);
	vec3 f = (f0 + (vec3(1.0) - f0) * fv) * cc_dim + vec3(cc * (0.04 + 0.96 * fv));
	SPECULAR_LIGHT += irr * dv * f;
}
#else
void light() {
	float cc = mix(0.3, 0.8, gold);
	float ndl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0);
	float ndv = clamp(dot(NORMAL, VIEW), 1e-3, 1.0);
	vec3 h = normalize(LIGHT + VIEW);
	float ndh = clamp(dot(NORMAL, h), 0.0, 1.0);
	float vdh = clamp(dot(VIEW, h), 0.0, 1.0);
	float fv = pow(1.0 - vdh, 5.0);
	float cc_dim = 1.0 - cc * (0.04 + 0.96 * pow(1.0 - ndv, 5.0));
	vec3 irr = LIGHT_COLOR * (mix(ndl, toon_ramp(ndl), 0.85) * ATTENUATION);
	DIFFUSE_LIGHT += irr / PI * cc_dim;
	// base specular (GGX, Smith correlated visibility, Schlick), F0 0.04 .. the albedo for metal
	float a = max(ROUGHNESS * ROUGHNESS, 0.002);
	float a2 = a * a;
	float dd = ndh * ndh * (a2 - 1.0) + 1.0;
	float d = a2 / (PI * dd * dd);
	float vis = 0.5 / max(ndl * sqrt(ndv * ndv * (1.0 - a2) + a2) + ndv * sqrt(ndl * ndl * (1.0 - a2) + a2), 1e-5);
	vec3 f0 = mix(vec3(0.04), ALBEDO, METALLIC);
	vec3 f = f0 + (vec3(1.0) - f0) * fv;
	SPECULAR_LIGHT += irr * (d * vis) * f * cc_dim;
	// clear coat
	float ca = CC_ROUGH * CC_ROUGH;
	float ca2 = ca * ca;
	float cdd = ndh * ndh * (ca2 - 1.0) + 1.0;
	float cd = ca2 / (PI * cdd * cdd);
	float cvis = 0.5 / max(ndl * sqrt(ndv * ndv * (1.0 - ca2) + ca2) + ndv * sqrt(ndl * ndl * (1.0 - ca2) + ca2), 1e-5);
	SPECULAR_LIGHT += LIGHT_COLOR * (ndl * ATTENUATION) * (cd * cvis * (0.04 + 0.96 * fv)) * cc;
}
#endif
