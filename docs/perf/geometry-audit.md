# Geometry and draw-call budget (2026-10)

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
