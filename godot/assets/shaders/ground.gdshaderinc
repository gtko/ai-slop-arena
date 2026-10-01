// Arena floor and the land around it (src/arena.js buildGround, src/materials.js groundTexture /
// cartoonGround), drawn from the world position so every floor tile shares one material:
//  - painted maps: one copy of the ground picture per 2 m tile, every other tile tinted by the
//    map's `checker` colour, thin seams between tiles, the matching normal map (scale 0.8);
//  - cartoon maps (Oasis, Windmill Isles): two flat tones in a checker and faint speckles;
//  - outer land: the picture repeated every `period` metres, no checker.
// Colours are blended in sRGB like the web's canvas, then converted to linear.

#include "res://assets/shaders/toon.gdshaderinc"

uniform sampler2D albedo_tex : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float use_tex = 1.0;
uniform float use_normal = 1.0;
uniform float normal_scale = 0.8;
uniform vec4 checker = vec4(0.0);           // sRGB rgb + alpha (maps.js `checker`)
uniform vec4 seam = vec4(0.549, 0.373, 0.176, 0.28);
uniform float seam_w = 0.006;              // tile fraction on each side of a seam
uniform vec4 tone_a = vec4(0.94, 0.68, 0.49, 1.0);
uniform vec4 tone_b = vec4(0.92, 0.64, 0.45, 1.0);
uniform vec4 tint = vec4(1.0);             // sRGB multiplier (wet floors, the sand around Dunes)
uniform float period = 2.0;                // metres per picture
uniform float origin = 25.0;               // the arena's half size: tiles start at -origin
uniform float roughness = 0.93;
uniform float speckles = 0.0;
#ifdef USE_FIELD
// rounded shores (water.gd): no floor where the land field drops under `field_lip` (ponds, ice);
// a separate shader (ground_field.gdshader): a discard in the floor costs early depth tests on phones
uniform float field_lip = 0.5;
uniform sampler2D field_tex : filter_linear, repeat_disable;
uniform float field_half = 25.0;
uniform float field_step = 0.333;
uniform float field_size = 151.0;
#endif

varying vec3 wpos;

vec3 to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
#ifdef USE_FIELD
	if (texture(field_tex, ((wpos.xz + field_half) / field_step + 0.5) / field_size).r < field_lip) {
		discard;
	}
#endif
	vec2 g = (wpos.xz + origin) / period;
	vec2 cell = floor(g);
	vec2 f = g - cell;
	vec2 gx = dFdx(g);
	vec2 gy = dFdy(g); // continuous derivatives: no seam of tiny mips where fract() wraps
	float odd = mod(cell.x + cell.y, 2.0);
	vec3 c;
	if (use_tex > 0.5) {
		c = textureGrad(albedo_tex, f, gx, gy).rgb;
		c = mix(c, checker.rgb, checker.a * odd);
		float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
		c = mix(c, seam.rgb, seam.a * (1.0 - smoothstep(seam_w * 0.6, seam_w * 1.4, e)));
	} else {
		c = mix(tone_a.rgb, tone_b.rgb, odd);
		if (speckles > 0.0) {
			// faint round blotches, a few per tile
			vec2 sp = wpos.xz * 4.5;
			vec2 sc = floor(sp);
			float h = hash12(sc);
			vec2 o = vec2(hash12(sc + 17.0), hash12(sc + 41.0)) * 0.6 + 0.2;
			float r = 0.12 + 0.25 * hash12(sc + 7.0);
			float dot_ = (1.0 - smoothstep(r * 0.8, r, length(fract(sp) - o))) * step(0.55, h);
			vec3 sc_col = h > 0.78 ? vec3(1.0, 0.9, 0.78) : vec3(0.67, 0.31, 0.16);
			c = mix(c, sc_col, dot_ * (h > 0.78 ? 0.1 : 0.08) * speckles);
		}
	}
	ALBEDO = to_linear(c * tint.rgb);
	ROUGHNESS = roughness;
	METALLIC = 0.0;
	if (use_normal > 0.5) {
		vec2 nn = textureGrad(normal_tex, f, gx, gy).rg * 2.0 - 1.0;
		// picture right = +x, picture up = -z (the web's uv), z out of the floor
		vec3 wn = normalize(vec3(nn.x * normal_scale, 1.0, -nn.y * normal_scale));
		NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
	}
}

void light() {
	toon_direct(NORMAL, VIEW, LIGHT, LIGHT_COLOR, ATTENUATION, ROUGHNESS, DIFFUSE_LIGHT, SPECULAR_LIGHT);
}
