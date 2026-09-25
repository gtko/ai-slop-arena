# Character rig and animations

Every brawler figurine ships rigged and animated: a standard humanoid armature with Mixamo bone
names, skinned, with 16 clips baked in. The same character is exported for the game (GLB) and for
other tools (`art-src/rigged/<key>.blend` and `.fbx`), so it can be opened in Blender, Unity,
Unreal, Godot... and retargeted with anything that knows the Mixamo skeleton.

## Skeleton

```
Hips
├─ Spine > Spine1 > Spine2
│                    ├─ Neck > Head
│                    ├─ LeftShoulder > LeftArm > LeftForeArm > LeftHand
│                    └─ RightShoulder > RightArm > RightForeArm > RightHand
├─ LeftUpLeg > LeftLeg > LeftFoot > LeftToeBase
└─ RightUpLeg > RightLeg > RightFoot > RightToeBase
```

Characters face -Y in Blender (+Z in glTF), 2.5 units tall, feet at 0. The weapon is part of the
hand's mesh and is skinned to the hand / forearm. `ToeBase` bones are there for retargeting and
carry no weights. Every bone's local X axis is its side axis (knees, elbows and spine bend about X).

## Clips

| Clip | Loop | Played when |
|---|---|---|
| Idle | ✓ | standing still: breathing, weight shift, looking around |
| Run | ✓ | moving (time scaled with the speed) |
| Sneak | ✓ | moving inside a bush: crouched, tiptoeing |
| BushIdle | ✓ | hiding in a bush: squatting, peeking left and right |
| Slide | ✓ | sliding on ice with no input: arms windmilling |
| Aim | ✓ | upper body, held while aiming |
| Shoot | | upper body, every shot (per weapon style: gun kick, overhead throw, staff thrust, palm push) |
| Super | | full body (upper body only while running), per style |
| Hit | | added on top of anything when hurt |
| Death | | knocked out: staggers, falls on the back, stays down, then vanishes in a puff |
| Victory | ✓ | last one standing: jumping, fists up |
| Wave | | hello, when some brawlers pop in |
| Bored | | idle for a while: sigh, foot tapping, checks the watch, head shake |
| Fidget | | idle for a while, one per brawler: shotgun on the shoulder (Blaster), revolver twirl (Gunslinger), fireball juggling (Bomber), staff taps and shivers (Frostbite), glitch and reboot (Volt) |
| Cough | | upper body, in the poison gas |
| Cheer | | upper body, fist pump after a knockout |

Frozen brawlers stop mid-pose (the mixer is paused); slowed ones animate at 60%.

## Build

```bash
node art-src/rig/export_rig.mjs                     # 1. static figurine -> mesh, weights, joints (art-src/rig/work/)
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P art-src/rig/rig_blender.py -- [keys] [--preview]
                                                    # 2. armature, skin, clips -> art-src/rig/out/*.glb, art-src/rigged/*
node art-src/rig/pack.mjs                           # 3. deduplicated keys + meshopt -> public/assets/models/
```

- `art-src/figurines/<key>.glb`: the static figurines (output of `art-src/optimize_models.py`).
- `autorig.mjs` finds the joints and skin weights on the generated mesh (crotch, neck, body edge,
  arms cut free from the hips they are fused to), `rig_blender.py` turns them into the humanoid
  armature, `clips.py` holds every animation (poses written in the armature frame, two-bone IK for
  planted feet). Edit a clip there and rerun steps 2 and 3.
- `--preview` renders four frames of every clip to `art-src/rig/work/preview/` (workbench, 300 px).
