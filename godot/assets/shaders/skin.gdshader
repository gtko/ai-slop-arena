shader_type spatial;
// Brawler skins (src/figurines.js RECOL_FRAG, cosmetics.js): a hue turn + saturation + brightness of the
// painted texture (candy, shadow), or the golden figurine. `recol` = (hue radians, saturation,
// brightness), exactly the numbers of RECOLOURS.

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform vec3 recol = vec3(0.0, 1.0, 1.0);
uniform float gold = 0.0;
uniform float roughness = 0.6;

void fragment() {
	vec3 c = (albedo * texture(albedo_tex, UV)).rgb;
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
	ROUGHNESS = mix(roughness, 0.3, gold);
	METALLIC = 0.5 * gold;
}
