# Ambient fauna: rigged, animated animals

The animals of the ambient life (`src/ambient/`) are figurines made like the brawlers: reference art
(`art-src/ai3d/fauna_images.py`, gpt-image sunburst) → Hunyuan3D (`make3d.py fauna` →
`art-src/glb/fauna/<key>.glb`, git-ignored) → rigged and animated in Blender (one script per body plan in
this folder) → `public/assets/models/fauna/<key>.glb` for the game.

## Body plans and species

| Plan | Species | Reference view |
|---|---|---|
| quad | fennec, arctic_fox, cat, hedgehog | three-quarter front-left |
| hopper | squirrel, frog, hare | three-quarter front-left, sitting |
| bird | penguin, duck, hen, sparrow | three-quarter front-left, standing |
| flyer | vulture, raven | front, wings spread flat |
| lizard | lizard | three-quarter front-left, sprawled |

## Game file contract (`public/assets/models/fauna/<key>.glb`)

- One skinned mesh (the Hunyuan texture baked in, webp), one armature, meshopt geometry, at most
  ~6k triangles and a 512 px texture. Bone count small (under ~24).
- Facing +Z in glTF (-Y in Blender), feet on y = 0, centred on x = z = 0 under the body.
- Real size in metres (the game may still scale it):

  | key | height | key | height | key | height |
  |---|---|---|---|---|---|
  | fennec | 0.55 | arctic_fox | 0.55 | cat | 0.5 |
  | hedgehog | 0.3 | squirrel | 0.4 | frog | 0.3 |
  | hare | 0.5 | penguin | 0.6 | duck | 0.5 |
  | hen | 0.55 | sparrow | 0.25 | lizard | 0.2 (0.7 long) |
  | vulture | 2.2 wingspan | raven | 1.2 wingspan | | |

- Clips (glTF animations, exact names; loops unless marked once). Every clip starts and ends on the
  same pose when it loops; locomotion is in place (the game moves the root).

  | Plan | Required | Optional extras |
  |---|---|---|
  | quad | Idle, Walk, Run | Look (turn head, once), Sit (once, ends seated), Sniff (once), Scratch (once) |
  | hopper | Idle, Hop (one hop cycle, loops) | Look, Groom (once), Ears / Croak (once) |
  | bird | Idle, Walk, Peck (once) | Look (once), Flap (wing flap in place, once), Hop (sparrow), Slide (penguin belly slide, loop), Swim (duck, loop) |
  | flyer | Fly (flap loop), Glide (loop) | Bank (once) |
  | lizard | Idle, Walk (scurry loop) | Look (once), TailFlick (once), Pushup (once) |

- Walk / Run / Hop cycles: note the ground speed they match (m/s) in the node `extras` of the armature
  (`{"speed": {"Walk": 0.6, "Run": 2.2}}`) so the game can scale the playback to the real speed.

## Check

Each rig script renders a contact sheet of a few frames of every clip to `art-src/fauna/work/preview/`
(`--preview`) so the rig can be judged without the game.
