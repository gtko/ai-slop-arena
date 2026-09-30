shader_type spatial;
// Trees, bushes: wind sway (src/materials.js foliagePatch) and the "reveal" dissolve: the leaves
// around the local player fade out (dithered) while he hides in a bush, so he can see himself.
// One material per prop, MultiMesh friendly: everything is derived from the world position.

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform float use_tex = 1.0;
uniform float roughness = 0.85;
uniform float sway = 0.05;          // metres of sway per metre of height (squared)
uniform float reveal_on = 1.0;
global uniform vec4 g_reveal;       // x, z, radius, amount (0..1)
global uniform float g_wind;        // 1 = calm, 3+ = storm

varying vec3 wpos;
varying float wamt;

void vertex() {
	mat4 m = MODEL_MATRIX;
	vec3 w = (m * vec4(VERTEX, 1.0)).xyz;
	float h = max(w.y, 0.0);
	float ph = m[3].x * 0.7 + m[3].z * 1.3;
	float t = TIME;
	float gust = 0.6 + 0.4 * sin(t * 0.5 + ph * 0.2);
	vec3 d = vec3(sin(t * 1.6 + ph) + 0.5 * sin(t * 3.3 + ph * 1.7), 0.0, cos(t * 1.3 + ph * 0.8) * 0.6);
	d *= sway * h * h * 0.18 * g_wind * gust;
	VERTEX += inverse(mat3(m)) * d;
	wpos = w;
}

const mat4 BAYER = mat4(
	vec4(0.0, 8.0, 2.0, 10.0),
	vec4(12.0, 4.0, 14.0, 6.0),
	vec4(3.0, 11.0, 1.0, 9.0),
	vec4(15.0, 7.0, 13.0, 5.0));

void fragment() {
	if (reveal_on > 0.5 && g_reveal.w > 0.001) {
		float dist = length(wpos.xz - g_reveal.xy);
		float k = g_reveal.w * (1.0 - smoothstep(g_reveal.z * 0.5, g_reveal.z, dist));
		if (k > 0.001) {
			ivec2 p = ivec2(mod(FRAGCOORD.xy, 4.0));
			float b = (BAYER[p.x][p.y] + 0.5) / 16.0;
			if (b < k * 0.95) {
				discard;
			}
		}
	}
	vec4 c = albedo;
	if (use_tex > 0.5) {
		c *= texture(albedo_tex, UV);
	}
	ALBEDO = c.rgb;
	ROUGHNESS = roughness;
	SPECULAR = 0.25;
}
