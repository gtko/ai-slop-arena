shader_type sky;
// Ambient light only (the background stays the flat fog colour): three's HemisphereLight (sky colour
// above, ground colour below) plus the faint white fill of the web build's studio environment.
// Godot convolves this sky into the ambient light; its cosine lobe softens the gradient, hence the
// 0.75 slope (an up-facing surface still gets the full sky colour, a wall the average, like three).
// Colours are linear and pre-multiplied by their intensities (lighting.gd).

uniform vec3 sky_col = vec3(0.3);
uniform vec3 ground_col = vec3(0.1);
uniform vec3 fill = vec3(0.0);

void sky() {
	COLOR = mix(ground_col, sky_col, clamp(0.5 + 0.75 * EYEDIR.y, 0.0, 1.0)) + fill;
}
