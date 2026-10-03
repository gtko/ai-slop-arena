# Geometry and draw-call budget (2026-10)

## Second pass: Low tier LODs and model textures (after v0.18.1)

**Counting fix.** Godot 4.4 counts a MultiMesh whose mesh has LODs as a single instance (the LOD path of
`render_forward_mobile` `_fill_render_list` does not multiply by the instance count). The decor ring,
walls, boulders, crates and lanterns all have importer LODs, so the first pass under-reported them by
their instance count: Low really drew 220-680k triangles a frame, not 140-360k. `geometry_audit.gd`
now hides each such MultiMesh alone and multiplies its share; the "before" below is v0.18.1 measured
with the fixed tool (raw tables `lod-before-low.md`, `lod-after-low.md`, `lod-after-high.md`; shots
`lod-low-before-after.jpg`, left before, right after).

What changed (Medium / High / Ultra keep their meshes; only the ring blocks and textures apply to them):

- **Brawlers** (`fighter.gd` `_lod`): on Low, `lod_bias` 0.3 on the figurine and its outline hull, so
  Godot steps down the importer's LODs (meshoptimizer, down to ~1-3k triangles a body) 3x sooner. At
  the match camera a brawler is ~50-70 px tall: ~5k triangles each instead of ~12k, same look
  (compared at 2x zoom with bias 1.0 / 0.3 / 0.2). Close-ups still pick LOD 0 by size on screen.
- **Decor drawn by the dozen** (`PropLib.set_low`, `arena.gd` `apply_quality`): a MultiMesh chooses one
  LOD for all its instances from its whole bounding box, which reaches the camera, so Godot's LODs
  never applied. Decimated copies `decor/<prop>_low.glb` (Blender, `tools/decimate.py ... nomat`,
  committed; `convert-models.mjs` LOW keeps them when Blender is missing) are swapped into the
  MultiMeshes on Low: ring trees 1500 -> 300, rocks / boulders / stumps / crates / lanterns 25 %, wall
  blocks ~515 -> ~230, bush 1065 -> 425. Same material and placement (the instance transforms are
  corrected by the two GLBs' node transforms).
- **Ring of trees** (`arena.gd` `_decor_ring`): one MultiMesh per kind and per block of a 3 x 3 grid
  around the arena, so the blocks out of view are culled (all tiers; +6-12 draws, -40 to -130k
  triangles on High).
- **Fauna** (`tools/fauna_import.gd`, post-import script of the 14 animal GLBs): `lod_bias` 0.4 baked
  in (10-30 px tall animals kept ~3k of ~5.7k triangles).
- **Textures**: the textures Godot extracts from the GLBs (`<model>_<image>.webp`, 8 x 1024² brawlers,
  31 x 512² decor / fauna) were imported lossless, i.e. uncompressed RGBA in GPU memory (the "detect 3D"
  switch to VRAM only runs in the editor). They and their `.import` are now committed with
  `compress/mode=2` (ETC2/ASTC on phones, S3TC/BPTC on desktops) and mipmaps. Ground textures and
  normal maps (`assets/tex`) were already VRAM-compressed with mipmaps (1024² albedo, 512² normals);
  UI images stay lossless (4 Mpx in all). No per-tier size cap: Godot imports one size per platform,
  and with mipmaps the GPU only reads the small levels at the game camera.

### Low tier, triangles k (game view = match camera, menu = attract camera)

| map / view | draws | triangles k | fighters k | tree ring k | bushes k | walls k | props k | fauna k |
|---|---|---|---|---|---|---|---|---|
| oasis / game | 62 -> 74 | 453 -> 176 | 93 -> 43 | 142 -> 34 | 33 -> 33 | 67 -> 30 | 92 -> 23 | 17 -> 5 |
| oasis / menu | 59 -> 67 | 498 -> 167 | 151 -> 43 | 142 -> 26 | 33 -> 33 | 67 -> 30 | 92 -> 23 | 4 -> 4 |
| dunes / game | 56 -> 71 | 489 -> 180 | 93 -> 43 | 164 -> 34 | 17 -> 17 | 76 -> 34 | 106 -> 29 | 14 -> 4 |
| dunes / menu | 56 -> 64 | 547 -> 175 | 151 -> 43 | 164 -> 24 | 17 -> 17 | 76 -> 34 | 106 -> 29 | 14 -> 10 |
| grove / game | 63 -> 75 | 630 -> 241 | 93 -> 43 | 190 -> 37 | 124 -> 49 | 66 -> 29 | 89 -> 24 | 27 -> 16 |
| grove / menu | 61 -> 68 | 682 -> 228 | 151 -> 43 | 190 -> 27 | 124 -> 49 | 66 -> 29 | 89 -> 24 | 21 -> 13 |
| frost / game | 61 -> 67 | 523 -> 176 | 93 -> 43 | 200 -> 37 | 47 -> 19 | 62 -> 28 | 80 -> 20 | 26 -> 13 |
| frost / menu | 57 -> 61 | 570 -> 159 | 151 -> 43 | 200 -> 27 | 47 -> 19 | 62 -> 28 | 80 -> 20 | 15 -> 7 |
| isles / game | 68 -> 68 | 217 -> 120 | 93 -> 43 | 0 -> 0 | 34 -> 14 | 6 -> 3 | 25 -> 11 | 19 -> 10 |
| isles / menu | 65 -> 65 | 270 -> 117 | 151 -> 43 | 0 -> 0 | 34 -> 14 | 6 -> 3 | 25 -> 11 | 15 -> 8 |
| marsh / game | 63 -> 74 | 566 -> 192 | 93 -> 43 | 198 -> 36 | 95 -> 38 | 60 -> 27 | 96 -> 26 | 8 -> 6 |
| marsh / menu | 63 -> 70 | 624 -> 183 | 151 -> 43 | 198 -> 26 | 95 -> 38 | 60 -> 27 | 96 -> 26 | 8 -> 7 |

(fighters = 8 bodies + weapons + team rings + your outline hull; oasis / dunes bushes are grass tufts.)

### GPU memory with the map and the 8 brawlers loaded (desktop S3TC; ETC2 is the same 4 bpp)

| map | Low textures MB | Low video total MB | High textures MB | High video total MB |
|---|---|---|---|---|
| oasis | 64.3 -> 17.1 | 100.8 -> 49.8 | 140.8 -> 93.7 | 178.0 -> 126.8 |
| dunes | 66.0 -> 17.7 | 104.1 -> 52.1 | 142.5 -> 94.2 | 181.3 -> 128.9 |
| grove | 72.9 -> 19.7 | 113.4 -> 56.6 | 149.4 -> 96.2 | 190.6 -> 133.4 |
| frost | 76.3 -> 18.3 | 117.6 -> 56.0 | 152.9 -> 94.8 | 194.8 -> 132.8 |
| isles | 78.4 -> 18.0 | 120.0 -> 55.9 | 155.0 -> 94.5 | 197.2 -> 132.8 |
| marsh | 84.2 -> 21.4 | 125.7 -> 59.3 | 160.7 -> 97.9 | 202.9 -> 136.0 |

High: same meshes and look (screenshot diff = particles and animation phase only), ring blocks culled:
722-971k triangles instead of 784-1054k on the 5 ringed maps.

## First pass (v0.18.1)

Measured by `godot/tools/geometry_audit.gd` (Mobile renderer, 1280x720, 8 brawlers around the camera focus; game view = match camera, menu = attract camera at zoom 0.8). Raw per-category tables: `geometry-{before,after}-{low,high}.md`. Shots (left before, right after, game view, dunes / grove / frost / isles / marsh / oasis): `geometry-{low,high}-before-after.jpg`.

### Low tier (draws / objects / primitives k; "+ n" = shadow pass)

| map / view | draws before -> after | objects before -> after | primitives k before -> after |
|---|---|---|---|
| oasis / game | 90 + 0 -> 62 + 0 | 90 + 0 -> 62 + 0 | 221 + 0 -> 163 + 0 |
| oasis / menu | 83 + 0 -> 59 + 0 | 83 + 0 -> 59 + 0 | 330 + 0 -> 208 + 0 |
| dunes / game | 78 + 0 -> 56 + 0 | 78 + 0 -> 56 + 0 | 220 + 0 -> 161 + 0 |
| dunes / menu | 74 + 0 -> 56 + 0 | 74 + 0 -> 56 + 0 | 340 + 0 -> 219 + 0 |
| grove / game | 89 + 0 -> 63 + 0 | 89 + 0 -> 63 + 0 | 836 + 0 -> 364 + 0 |
| grove / menu | 85 + 0 -> 61 + 0 | 85 + 0 -> 61 + 0 | 951 + 0 -> 417 + 0 |
| frost / game | 83 + 0 -> 61 + 0 | 83 + 0 -> 61 + 0 | 368 + 0 -> 193 + 0 |
| frost / menu | 80 + 0 -> 59 + 0 | 80 + 0 -> 59 + 0 | 484 + 0 -> 248 + 0 |
| isles / game | 129 + 0 -> 68 + 0 | 129 + 0 -> 68 + 0 | 348 + 0 -> 200 + 0 |
| isles / menu | 120 + 0 -> 65 + 0 | 120 + 0 -> 65 + 0 | 463 + 0 -> 254 + 0 |
| marsh / game | 93 + 0 -> 63 + 0 | 93 + 0 -> 63 + 0 | 682 + 0 -> 288 + 0 |
| marsh / menu | 87 + 0 -> 63 + 0 | 87 + 0 -> 63 + 0 | 802 + 0 -> 346 + 0 |

### High tier (draws / objects / primitives k; "+ n" = shadow pass)

| map / view | draws before -> after | objects before -> after | primitives k before -> after |
|---|---|---|---|
| oasis / game | 87 + 17 -> 73 + 17 | 87 + 17 -> 73 + 17 | 232 + 252 -> 233 + 247 |
| oasis / menu | 78 + 18 -> 68 + 18 | 78 + 18 -> 68 + 18 | 334 + 346 -> 304 + 316 |
| dunes / game | 71 + 17 -> 63 + 17 | 71 + 17 -> 63 + 17 | 221 + 205 -> 222 + 200 |
| dunes / menu | 67 + 17 -> 63 + 17 | 67 + 17 -> 63 + 17 | 341 + 305 -> 313 + 278 |
| grove / game | 87 + 19 -> 75 + 19 | 87 + 19 -> 75 + 19 | 851 + 1407 -> 438 + 576 |
| grove / menu | 81 + 18 -> 71 + 18 | 81 + 18 -> 71 + 18 | 962 + 1492 -> 520 + 638 |
| frost / game | 84 + 18 -> 76 + 18 | 84 + 18 -> 76 + 18 | 397 + 542 -> 277 + 306 |
| frost / menu | 79 + 17 -> 74 + 17 | 79 + 17 -> 74 + 17 | 506 + 621 -> 363 + 368 |
| isles / game | 127 + 14 -> 80 + 15 | 127 + 14 -> 80 + 15 | 363 + 462 -> 274 + 282 |
| isles / menu | 116 + 13 -> 75 + 15 | 116 + 13 -> 75 + 15 | 474 + 549 -> 356 + 346 |
| marsh / game | 91 + 18 -> 75 + 18 | 91 + 18 -> 75 + 18 | 694 + 1166 -> 359 + 491 |
| marsh / menu | 85 + 20 -> 75 + 20 | 85 + 20 -> 75 + 20 | 814 + 1264 -> 450 + 565 |

### Models (triangles, vertices before -> after)

| model | tris | verts |
|---|---|---|
| blaster.glb | 43172 -> 43172 | 129516 -> 33154 |
| bomber.glb | 23107 -> 23107 | 69321 -> 16943 |
| frostbite.glb | 33238 -> 33238 | 99714 -> 25843 |
| gunslinger.glb | 23543 -> 23543 | 70629 -> 17807 |
| kappa.glb | 24246 -> 24246 | 72738 -> 19057 |
| mochi.glb | 20982 -> 20982 | 62946 -> 16321 |
| pipchomp.glb | 23702 -> 23702 | 71106 -> 17870 |
| volt.glb | 25958 -> 25958 | 77874 -> 20570 |
| decor/boulder_snow.glb | 1800 -> 1800 | 5400 -> 5395 |
| decor/bush.glb | 3582 -> 1065 | 10746 -> 3195 |
| decor/cactus.glb | 1500 -> 1500 | 4500 -> 4498 |
| decor/wall_canyon.glb | 1498 -> 516 | 4494 -> 1548 |
| decor/wall_ice.glb | 1500 -> 511 | 4500 -> 1523 |
| decor/wall_moss.glb | 1500 -> 521 | 4500 -> 1563 |
| fauna/arctic_fox.glb | 5742 -> 5742 | 17226 -> 5248 |
| fauna/cat.glb | 5742 -> 5742 | 17226 -> 4323 |
| fauna/duck.glb | 5942 -> 5942 | 17826 -> 4773 |
| fauna/fennec.glb | 5742 -> 5742 | 17226 -> 4516 |
| fauna/frog.glb | 5600 -> 5600 | 16800 -> 4390 |
| fauna/hare.glb | 5600 -> 5600 | 16800 -> 4223 |
| fauna/hedgehog.glb | 5742 -> 5742 | 17226 -> 8078 |
| fauna/hen.glb | 5294 -> 5294 | 15882 -> 4347 |
| fauna/lizard.glb | 5683 -> 5683 | 17049 -> 4399 |
| fauna/penguin.glb | 5600 -> 5600 | 16800 -> 4056 |
| fauna/raven.glb | 5683 -> 5683 | 17049 -> 4807 |
| fauna/sparrow.glb | 5192 -> 5192 | 15576 -> 4111 |
| fauna/squirrel.glb | 5600 -> 5600 | 16800 -> 4975 |
| fauna/vulture.glb | 5684 -> 5684 | 17052 -> 4199 |
