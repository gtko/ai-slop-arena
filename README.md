# AI SLOP ARENA

A top-down, Brawl Stars–style Showdown in three.js, built to show off real-time lighting and shadows.
Eight brawlers, five maps with live weather, bushes, destructible walls, power-cube crates and closing
poison gas. The last one standing wins. Play solo against bots or online with friends (bots fill empty slots).

The home page (`index.html`, "/") is an animated showcase site with a live 3D turntable of the figurines;
the game itself is `play.html` ("/play"), which opens on a loading screen while models and textures stream in.

```bash
npm install
npm run dev          # site on http://localhost:5173, game on http://localhost:5173/play.html
npm run dev:server   # multiplayer rooms (Cloudflare Worker + Durable Objects, local), on :8787
npm run deploy       # build and deploy everything to Cloudflare
```

## Maps

| Map | Weather | Look |
| --- | --- | --- |
| Oasis | Clear | Sand, brick walls, water pools |
| Dune Storm | Sandstorm: orange haze with gusts, blowing sand, dust clouds | Cracked clay, cacti |
| Rainy Grove | Rain with lightning bolts and thunder | Wet glossy forest floor, puddles, streams, mossy walls |
| Frost Peak | Snowfall | Snow-capped bushes and pines, boulders, frozen ponds you slide on |
| Misty Marsh | Fog with drifting mist sheets | Mud, swamp water, fireflies that light up the ground |

Weather is a per-frame modifier on top of the time of day (sun, sky, fog distance, shadow softness,
exposure). It dims at night, so a foggy or rainy night stays dark. Storms also make the foliage sway harder.

## Multiplayer

`worker/index.js` is a Cloudflare Worker. It serves the built game as static assets and routes `/ws/<CODE>` to one
Durable Object per room, using the WebSocket Hibernation API. The room is a relay:

- The first player in the room is the **host**. Their browser runs the full simulation: bots, damage, walls,
  crates, cubes and gas. It broadcasts 15 Hz snapshots and events (attacks, hits, knockouts...).
- Other players send their input and position at 20 Hz. Movement is client-authoritative, which keeps it smooth,
  and everything else is decided by the host.
- If the host leaves, the next player is promoted and the running match is cancelled. A client who leaves mid-match
  is replaced by a bot.

Create a room from **Multiplayer**, then share the code or the invite link (`?room=CODE`).

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| Hold left mouse | Attack (3 ammo, auto-reloads) |
| Right mouse (hold to preview, release to fire) / Space / E | Super, once the ring is full |
| T | Next time of day |
| Tab | Toggle the Lighting & Shadows panel |
| M | Mute / unmute (speaker button top-left opens the sound menu) |
| Esc | Close the result screen while spectating an online match |

Brawlers: **Blaster** (shotgun spread; the super smashes walls and knocks back), **Gunslinger** (long-range burst; the super pierces walls),
**Bomber** (lobs bombs over cover; the super is a wall-levelling barrel).

## Lighting and shadow techniques

- **Camera-fitted, texel-snapped sun shadows.** The orthographic shadow frustum follows the view instead of covering
  the whole map, which gives about 2 cm texels at 2048² instead of about 4 cm. Its origin snaps to whole shadow-map
  texels in light space, so edges don't shimmer while the camera moves. Both options can be toggled in the panel to compare.
- **Selectable filtering:** PCF (hardware 2×2 compare with 5 Vogel-disk taps rotated by interleaved gradient noise), VSM, or hard shadows, plus a softness slider.
- **Animated time of day.** Four keyframes (morning, noon, sunset, night) are interpolated in linear space: sun colour,
  intensity, elevation and azimuth, sky/ground hemisphere, IBL intensity, fog, exposure, bloom and rim light.
  The sun arcs across the far side of the arena, so shadows always fall toward the camera where you can see them.
- **Pooled dynamic point lights.** There are 12 fixed `PointLight`s (a fixed count, so shaders never recompile). Each frame they are
  handed to the most relevant emitters, scored by brightness and distance to the camera: projectiles, muzzle flashes,
  explosions, torches, glowing crates, power cubes and the poison wall. Lights fade out with distance before they could lose their slot, so there's no popping.
- **Shadow-casting head-lamp.** A spot light follows whoever the camera tracks and fades in after dusk. Walls and bushes
  throw long moving shadows ahead of you. Its shadow pass is skipped entirely in daylight.
- **Swaying foliage shadows.** Wind sway and "push-away" from nearby brawlers happen in world space in *both* the colour
  shader and a matching custom depth material, so bush and tree shadows move with the leaves.
- **Dithered bush reveal.** When you hide in a bush, the leaves around you dissolve with a 4×4 Bayer screen-door pattern.
  The pass stays opaque, so there are no transparency sorting problems, and the bush keeps casting its full shadow.
- **GTAO** ambient occlusion for contact shadows. Particles, decals and gas are excluded from its depth/normal pre-pass.
- **HDR pipeline:** half-float MSAA target → GTAO → Unreal bloom (emissive projectiles, fire and gems exceed 1.0) → ACES tone mapping.
- **Fresnel rim light** on characters, tinted per time of day, so brawlers stay readable in shade and at night.
- Baked vertex-colour gradients on walls, a PMREM room environment for speculars, a water shader with scrolling
  normals and shoreline foam, scorch decals, and shadow-casting debris.

## Sound menu

The speaker button (top-left, available in the lobby and in a match) opens master / music / effects / ambience
sliders, a music track picker (Auto follows the game, or force Lobby, Battle or Off), mute and a test button.
Settings are saved in `localStorage`. Ambience crossfades with the time of day: birds and wind by day,
crickets and torch crackle at night.

## Generated assets

Everything under `public/assets/` was generated, and the game falls back to procedural art or synth sounds if any file is missing.

- `tex/`: seamless painted textures (sand, brick, stone, wood, grass) from OpenRouter (Gemini 2.5 Flash Image),
  prompted as flat albedo with no baked lighting so the dynamic lights do the shading. Each `*_n.png` is a
  tileable normal map derived from it, so torches, projectiles and the head-lamp pick up the brick and plank relief.
- `ui/`: brawler portraits for the menu cards, action poses with the background removed (`art-src/ai3d/cutout.py`).
- `models/`: the brawler figurines and `models/decor/` the 15 decor props, generated on this machine's GPU from
  style-matched reference art (Hunyuan3D-2 shape + paint, see `art-src/ai3d/README.md`), then budgeted with
  `art-src/optimize_models.py`. The figurines are rigged at load time (`src/figurines.js`).
- `sfx/`, `music/`: ElevenLabs sound generation: 17 one-shots, day/night ambience loops, and lobby/battle loops.
  The ElevenLabs Music API needs a paid plan, so the two music tracks are 22 s loops from the sound-effect model.

Regenerate or reprocess them with the scripts in `art-src/` (raw sources are kept there):

```bash
python art-src/gen_audio.py        # skips files that already exist
python art-src/process_images.py   # resize, normal maps, portrait cut-outs
```

## Layout

```
src/
  main.js       renderer, post-processing chain, UI wiring, main loop
  lighting.js   sun/moon, hemisphere, IBL, head-lamp, time-of-day presets, shadow fitting
  materials.js  shader patches (rim, foliage sway + dither, water) and procedural textures
  arena.js      map layout, instanced walls/bushes/water, crates, torches, collision and line-of-sight
  effects.js    LightPool + instanced particles, flashes, shockwaves, scorch decals
  brawler.js    brawler types, movement and animation (figurine walk / aim, procedural rig fallback)
  figurines.js  GLB figurines: auto-rig (joint fit, arm cutting, skin weights), weapon axes, materials
  props.js      decor GLBs (walls, trees, rocks, crates, bushes, lanterns), instancing helpers
  devtools.js   dev-only console helpers (manual stepping, poses, weight view)
  site/         landing page script + styles (hero 3D turntable, cards, reveals)
  combat.js     bullets, bursts, lobbed bombs, explosions
  ai.js         A* pathfinding and bot behaviour
  poison.js     shrinking gas
  game.js       match flow, damage, items, visibility, camera
  hud.js        overhead bars, floaters, HUD
  assets.js     texture loading (shared GPU images, per-use repeat)
  audio.js      sampled SFX, music crossfades, day/night + weather ambience, mix settings (synth fallback)
  maps.js       the five map layouts and their themes
  weather.js    rain + lightning, snow, sandstorm, fog + fireflies
  water.js      water basins (clear / swamp) and the ice field
  foliage.js    bushes, trees, pines, cacti, dead trees, obstacles
  lantern.js    lantern model (procedural, or the sculpted prop with glowing windows)
  net.js        WebSocket client for the rooms
worker/
  index.js      Cloudflare Worker + Room Durable Object (multiplayer relay)
```
