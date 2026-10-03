shader_type spatial;
// Pond basin (src/water.js bedMaterial): the sandy bank and bed, sun-dried on the lip, dark and wet
// under the waterline (vertex colours, water.gd), with the sand picture and its normal map. Under the
// water, animated caustics multiply only the DIRECT diffuse light, so they follow the sun and the
// torches and vanish in shadows like focused light would; the ambient light turns blue-green there.
// `caustics_on` 0 (Quality low) skips them; the LOW variant (quality.gd: Low on phones / tablets)
// compiles them and the normal map out.
render_mode cull_disabled;

#include "res://assets/shaders/toon.gdshaderinc"
#include "res://assets/shaders/caustics.gdshaderinc"

uniform sampler2D albedo_tex : source_color, TEX_FILTER, repeat_enable;
uniform sampler2D normal_tex : hint_normal, TEX_FILTER, repeat_enable;
uniform float use_tex = 1.0;
uniform float caustics_on = 1.0;
uniform float now = 0.0;
uniform float water_y = -0.16;

varying vec3 wpos;
varying float cau;      // 1 + caustics: the direct diffuse gain (fragment -> light)
varying vec3 amb_tint;  // the ambient tint, undone on the direct light

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 c = COLOR.rgb;
	if (use_tex > 0.5) {
		c *= texture(albedo_tex, UV).rgb;
#ifndef LOW
		NORMAL_MAP = texture(normal_tex, UV).rgb;
#endif
	}
	float under = smoothstep(water_y + 0.02, water_y - 0.12, wpos.y);
	cau = 1.0;
#ifndef LOW
	if (caustics_on > 0.5 && under > 0.0) {
		cau = 1.0 + caustics(wpos.xz * 0.9, now) * 1.3 * under;
	}
#endif
	amb_tint = mix(vec3(1.0), vec3(0.55, 0.78, 0.95), under * 0.6);
	ALBEDO = c * amb_tint;
	ROUGHNESS = 0.6;
	METALLIC = 0.0;
}

void light() {
	vec3 d = vec3(0.0);
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, d, SPECULAR_LIGHT);
	DIFFUSE_LIGHT += d * cau / amb_tint;
}
