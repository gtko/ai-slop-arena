// Cellular patterns of src/water.js (CAUSTICS): the distance between the two nearest moving cell
// centres is 0 on the cell edges. Pond beds: two layers of thin edges = an animated caustic network;
// frozen ponds: still edges = cracks.

vec2 c_hash(vec2 p) {
	p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
	return fract(sin(p) * 43758.5453);
}

float c_edges(vec2 p, float t) {
	vec2 g = floor(p);
	vec2 f = fract(p);
	float d1 = 8.0;
	float d2 = 8.0;
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 o = vec2(float(x), float(y));
			vec2 h = 0.5 + 0.42 * sin(t + 6.2831 * c_hash(g + o));
			float d = length(o + h - f);
			if (d < d1) {
				d2 = d1;
				d1 = d;
			} else if (d < d2) {
				d2 = d;
			}
		}
	}
	return d2 - d1;
}

float caustics(vec2 p, float t) {
	float a = 1.0 - smoothstep(0.0, 0.14, c_edges(p * 1.25, t * 0.9));
	float b = 1.0 - smoothstep(0.0, 0.11, c_edges(p * 2.1 + 3.7, t * 1.25));
	return a * a * 0.75 + b * b * 0.55;
}
