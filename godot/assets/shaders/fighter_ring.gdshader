shader_type spatial;
// The team ring under a brawler's feet (src/brawler.js `ring`): a flat annulus in an over-bright
// colour (it blooms), cyan for you, green for your Duo partner, red for enemies, 90 % opaque.
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec3 color = vec3(0.3, 1.6, 2.0); // linear, may exceed 1
uniform float opacity = 0.9;

void fragment() {
	ALBEDO = color;
	ALPHA = opacity;
}
