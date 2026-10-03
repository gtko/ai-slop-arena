# Per-pixel cost at Low on phones / tablets (2026-10)

Low on phones / tablets (`Quality.low_shaders()`: mobile build, web phone or `--device=mobile`, tier Low or
the battery saver) now runs the `#ifdef LOW` variant of every world shader and no full-screen pass for the
line of sight. Medium and up, and every desktop tier, keep the full shaders.

What LOW drops (`godot/assets/shaders/`):

| shader | full | LOW |
|---|---|---|
| toon.gdshaderinc (all lit world shaders) | GGX + correlated Smith (2 sqrt) + `pow` Schlick per light | no specular when roughness >= 0.7 (ground, props, foliage, shore: under 2 % of their diffuse); else Smith approximation without sqrt, Schlick by multiplications |
| fighter | base GGX lobe + clear-coat GGX lobe | one lobe at the coat's roughness carrying both |
| ground / ground_field / ground_bank | `textureGrad` albedo + normal map, speckles | one `texture` fetch (same texel), no normal map, no speckles |
| prop / foliage / grass | `inverse(mat3(MODEL_MATRIX))` per vertex for the sway, `pow(x, 2.5)` rim | per-axis dot products, `x*x*sqrt(x)` |
| water | ripple loop (8 rings) + 2 normal-map layers (already off at Low by uniform) | compiled out |
| water_bed | caustics (2 x 9 cells, off at Low by uniform) + normal map | compiled out |
| ice | 3 cell patterns (27 cells per pixel) | 1 pattern (9 cells), frost tone at the full mean |
| all textures | anisotropic 4x | trilinear |

Line of sight (`sight.gd`): the full pass copies the frame (`hint_screen_texture`), then per pixel walks the view
ray, takes 9 mask taps and undoes / redoes the grade LUT. LOW: the 9-tap blur is drawn once into a 256 x 256
mask when the mask changes, and the world shaders shade their own hidden pixels from it (one lookup, before the
lighting; they draw the depth fog themselves to shade it too). No frame copy, no pass. The sandstorm dust, which
must also cover what those shaders do not draw (items, fauna, effects), is a blended quad (one lookup, no copy).
On the Compatibility renderer the pass stays for the grade.

## GPU time (desktop proxy)

No device measurement: AMD RX 7800 XT, Mobile renderer (Vulkan), the tablet emulated
(`--resolution 2560x1600 -- --device=mobile --quality=low --noautoq`: frame drawn at 1442x901).
Same build, `--shaders=full` for "before".

Matches (autotest against a local server, 24 s, median of the 2 s `--perf` windows):

| map | full | LOW | change |
|---|---:|---:|---:|
| grove | 0.63 ms | 0.49 ms | -22 % |
| oasis | 0.50 ms | 0.42 ms | -16 % |
| frost | 0.51 ms | 0.37 ms | -28 % |

`tools/shader_bench.gd` (fixed camera, 8 brawlers, variants alternated, 3 rounds x 240 frames, medians):

| map | full | full, no sight | LOW | LOW, no sight |
|---|---:|---:|---:|---:|
| grove | 0.543 | 0.480 | 0.468 | 0.443 |
| oasis | 0.492 | 0.434 | 0.338 | 0.304 |
| frost | 0.483 | 0.439 | 0.308 | 0.270 |

The desktop GPU idles most of the frame, so these are small and noisy; a tile-based phone GPU gains more from
the removed frame copy (a resolve and a reload of the whole frame) than this proxy shows.

## Look

`shaders-low-before-after.jpg`: left full, right LOW (grove, oasis, frost, dunes in the sandstorm), from the bench.
`shaders-high-unchanged.jpg`: High before (origin/main) and after, `tools/geometry_audit.gd` shots: only the
animated parts differ (rain, sway, water clock).

Known differences: the floor has no normal-map relief; the ice cracks have one scale; the hidden areas are
shaded in linear light before the tone mapping (as the web does), so bright saturated ground (Oasis at sunset)
no longer washes out to pale pink there (the full pass's inverse tone mapping amplifies near-white pixels).
What is drawn with other materials (StandardMaterial3D: items, fauna, effects) is not dimmed in hidden areas
(it is still covered by the dust in the sandstorm). Crossing into or out of Low recompiles the world shaders
(a hitch, once, at the tier change).

Reproduce: `godot --path godot --resolution 1442x901 -s res://tools/shader_bench.gd -- --device=mobile --quality=low [--stress] [--shots=dir]`.
