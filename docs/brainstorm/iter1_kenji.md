# Iteration 1 — KENJI (game feel & content) — DIVERGE

## (a) Diagnosis

### What already works (keep and build on)
- **A real rendering stack for a browser game.** HDR + MSAA -> GTAO -> line-of-sight pass -> vision fog -> bloom -> cartoon grade (`src/main.js:73-101`), a patched cel ramp on every PBR material (`src/cartoon.js`), a fixed-size dynamic light pool that projectiles and explosions feed (`src/effects.js` `LightPool`). Projectiles are HDR colours so they bloom (`src/combat.js` `COL`). This is a strong base: most juice ideas below are cheap because the plumbing exists.
- **Figurines that are alive.** Skinned GLBs with 16 clips, a layered animator (full-body base, upper-body Aim/Shoot/Cheer, additive Hit flinch; `src/animator.js`), blinking, soft-part sway, a Death fall then poof (`src/brawler.js` `die()`/`vanish()`). Cheer on a KO. This is above genre-average for an indie web brawler.
- **Weather that changes rules** (ice slide, sandstorm vision, fog radius) and **line of sight** (v0.10.0) give the arenas identity and a stealth layer.
- **Touch controls follow the Brawl Stars grammar** (floating move stick, attack button = aim stick, tap = auto-aim at nearest foe; `src/touch.js`), gamepad rumble exists (`src/input.js` `rumble`).
- Cohesive palette on Oasis (warm canyon, golden grass, stepping stones): it reads as a toy diorama.

### The 8 biggest weaknesses (feel / content / visual)
1. **Hits have no weight.** `damageFx` (`src/game.js:241`) = a DOM floater + a 1-frame emissive flash + an additive flinch clip. No hitstop, no knockback on normal hits (only Blaster super has `knock`), no per-hit squash on the victim beyond `flash*0.08`, no directional hit spark, no "kill confirm" beat. Shooting a bot feels like shooting a hitbox. The enemy HP bar lag (`ov-lag`) is the only good bit.
2. **Screen shake is crude.** `game.js:789-798`: random xyz jitter scaled by `shake²`, no direction, no frequency, no rotation/zoom kick, and the player's own shots produce zero camera response (only supers and explosions call `shakeAt`). There is no camera punch-in on supers, no look-ahead toward the aim direction, no dynamic zoom when few brawlers remain. Fixed offset `(0, 27.4, 25)`, FOV 40.
3. **Audio is thin and shared.** 20 SFX total (`src/audio.js` `SFX`): Frostbite, Volt and Gunslinger all fire the same `shot`; one generic `hit`, one `hurt`, one `death`. No footsteps, no ammo-empty click, no reload tick, no per-brawler voice barks, no hit-confirm pitch variation, no low-HP heartbeat, no gas-closing stinger per ring. Audio is 50% of game feel and it is at 15%.
4. **Readability of brawlers vs. world.** In `public/assets/site/feat_battle.jpg` the figurines are pastel (pink axolotl, pale-blue Frostbite) on a salmon floor, roughly the size of a crate, weapons tiny. Team ring colours are both reddish. No silhouette rim for "enemy" vs "me", no outline colour coding. In an 8-player brawl you must identify friend/foe/brawler in <200 ms; today you read the HP bar, not the character.
5. **Supers are not events.** A super = same projectile code with bigger numbers + `sfx('super')` + small shake (`combat.js` `attack`). No wind-up freeze, no camera zoom, no screen tint, no unique audio, no ground telegraph for enemies. Brawl Stars supers are the dopamine peak; here they are a stronger shot.
6. **Only 5 brawlers, 4 of them ranged pokers.** Blaster (short shotgun), Gunslinger (long burst), Bomber (thrower), Frostbite (slow shards), Volt (chain orb). No tank, no melee, no healer/support, no assassin/dash, no trap-setter, no mobility kit at all (nobody has a dash, jump or blink). Movement is identical across brawlers except speed 6.0-6.8. Content-wise that is 1/10th of what a Showdown player expects to "main".
7. **Arenas are one template reskinned.** Every map is a 13x13 quadrant mirrored 4 ways on a 25x25 grid of 2 m tiles (`src/maps.js`), same spawns, same vocabulary (wall, bush, water, crate, lantern, obstacle, ice). No verticality, no moving or interactive elements (jump pads, geysers, doors, conveyor, destructible big set-pieces), no "landmark" in the centre. Weather is the only differentiator.
8. **Moment-to-moment progression feedback is flat.** Power cube pickup = `dmgMul += 0.1` and a "◆n" suffix in the nameplate (`src/hud.js`). Brawler does not visibly grow/glow; there is no "last 3" drama beyond a music switch; the win is a Victory clip. Kill feed, killstreak callouts, "gas incoming" ring telegraphs are missing or minimal.

(Honourable mentions: poison gas is instanced green icospheres (`src/poison.js`) — reads as "lumpy green", not dangerous; projectiles are spheres/boxes with MeshBasic colour (`combat.js` `meshFor`) except the seed and the fireball; no trails on bullets; the procedural fallback rig in `brawler.js` still ships code paths.)

---

## (b) Raw ideas (29), no self-censorship

Effort: S = < 1 day, M = 2-4 days, L = 1-2 weeks, XL = > 2 weeks.

### Game feel & juice
1. **Hitstop + victim squash (the "impact frame").** On every confirmed hit freeze the victim's animator and the bullet for 40-90 ms (scaled by damage), squash-stretch the victim 0.85/1.15 on the hit axis, push them 0.15 m. Supers and KOs get 120 ms global hitstop. *Why fun:* the single biggest lever for "my shot landed"; Nintendo/Smash/Hades all do it. **S-M** (local only for victim anim; global freeze must be client-side cosmetic so netcode stays authoritative).
2. **Trauma-based camera shake 2.0.** Replace random jitter with Perlin trauma (position + small roll + FOV kick), directional kick opposite to your own shot (Blaster: big, Gunslinger: micro per bolt), impacts push camera away from the source. Per-brawler "recoil profile". **S**
3. **Hit-confirm layer.** Directional hit sparks spraying out of the victim along the bullet vector, a white additive "hit disc" decal, rising-pitch hit SFX for consecutive hits within 1 s (combo pitch ladder), crit-style bigger floater on the last-bullet-of-a-burst. **S**
4. **KO moment.** On a kill by you: 0.15 s slowmo (timeScale 0.3), radial chromatic pulse, the figurine is launched ragdoll-ish in the shot direction (spin + arc, spline) before the poof, a "K.O.!" stamp, skull pop-up in a kill feed. On the last kill of the match: 1 s super-slowmo + camera orbit ("final smash" cam). **M**
5. **Bullet trails & shapes per brawler.** Ribbon trails (reuse `ribbon()`), Gunslinger rays as stretched capsules with afterimages, Frostbite shards as real crystal meshes that shatter into ice chips on impact, Volt orb crackling with mini arcs, Bomber fireball leaving ember trail + ground shadow telegraph circle. **M**
6. **Power-cube growth.** Each cube scales the figurine +3% and adds a green emissive pulse; at 5+ cubes a floating crown/aura; cube pickup pops with a spring, magnet pull, "+10% POWER" floater and a chime whose pitch rises with count. **S**
7. **Low-HP state.** Below 25%: desaturate edges, heartbeat SFX, brawler limps (Sneak clip at run speed) and sweats particles, HP bar blinks. Healing regen gets a green sparkle and "ahh" bark. **S**
8. **Footstep & movement juice.** Dust puffs per footstep keyed to the Run clip's contact frames, splash in water, snow prints that persist a few seconds on Frost Peak, grass parting (bend bush instances away from the brawler), ice skid sparks. **M**

### Controls & camera
9. **Aim look-ahead + dynamic zoom.** Camera leans 2-3 m toward the aim/move direction (more for long-range brawlers), zooms in slightly when idle in a bush, zooms out when 3 or fewer remain so the final duel is framed. **S**
10. **Touch aim quality pass.** Aim-stick with trajectory preview for throwers identical to PC, "sticky" auto-aim with soft snapping to the nearest visible target inside a 20° cone when dragging, haptic tick (Capacitor Haptics) on hit / super ready / KO, adjustable button size/position editor. **M**
11. **Input buffer & coyote.** Buffer a shot pressed up to 120 ms before ammo/cooldown is ready; when you release the aim stick while an enemy just ducked behind cover, fire anyway at last aim. Removes "I pressed and nothing happened". **S**
12. **A universal dodge/dash button (per-brawler flavour).** Every brawler gets a short cooldown mobility move (Blaster: shoulder charge, Gunslinger: combat roll, Bomber: rocket hop over walls, Frostbite: ice slide leaving slippery trail, Volt: 4 m blink). Biggest change to moment-to-moment skill expression. **L** (needs server rules + balance: Maya's territory too).

### VFX & graphics tech
13. **Super as a cinematic event.** 250 ms wind-up: world desaturates, a speed-line radial overlay, camera punch-in 10%, character-specific portrait slash (Brawl-Stars/Smash style) across the HUD, bespoke big SFX + voice shout, then release with hitstop. Enemies see a red ground telegraph during the wind-up. **M**
14. **Toon outline + team colour rim.** Screen-space outline pass (depth+normal Sobel) so everything reads as a figurine diorama; per-brawler outline colour: you = cyan, enemies = red, teammates (duo) = green. Fixes readability #4 in one pass. **M** (models.js already has inverted-hull outlines for sculpted models: extend to figurines or go screen-space).
15. **Stylised gas.** Replace green icospheres by a raymarched/volume-ish shader wall: animated noise, purple-green toxic swirl, skulls drifting, edge glowing line on the ground, screen-edge green tendrils when you are inside. **M**
16. **Water, grass and wind unify.** Interactive grass (brawler position texture pushing blades), wind gust waves visible across bushes, water ripples/rings on bullet impact and on walking. **M-L**
17. **Day-cycle drama shots.** Golden-hour default on Oasis, sunset with long shadows on the final phase (the sun drops as gas closes: time-of-day tied to match progress), night matches with lanterns and projectiles as main light sources (the LightPool is made for it). **S-M**
18. **Destruction 2.0.** Walls crumble in chunks (pre-fractured GLB pieces, physics-lite with bounce), leave rubble decals, dust clouds linger and briefly block vision; crates burst with confetti-wood and the cube shoots up with a spotlight. **M**

### New brawlers (full concepts)
19. **"Mochi" — the Tank.** Look: a giant squishy rice-cake seal wearing a sumo mawashi and a tiny chef hat; wobbly jelly body (vertex jiggle shader). Fantasy: the unstoppable cuddly bulldozer. Attack: short-range belly-bump shockwave cone (3 hits of a jelly wave), heavy knockback. Super: "Mochi Pound" — leaps (real airtime), lands in a 4 m radius, flattens enemies (they become pancake-squashed for 1 s, stunned) and breaks walls. HP 7000, speed slow. **L**
20. **"Pip & Chomp" — the Summoner/assassin.** Look: a tiny mushroom kid riding a carnivorous-plant pet. Attack: Chomp lunges 4 m forward and bites (melee dash-attack, the brawler moves with it). Super: plants a Venus-trap turret bush that hides, auto-bites anyone walking in and reveals them. Adds melee + traps + bush play. **L**
21. **"Glitch" — the AI-slop brawler (brand mascot).** Look: a half-rendered chibi made of corrupted voxels and floating UI windows, with a cursor for a hand; parts of its texture visibly "melt" like bad AI art, extra fingers as a joke. Fantasy: the game's name embodied, self-aware humour. Attack: fires "prompt tokens" (letter-glyph projectiles) that split into 3 on wall contact. Super: "Hallucinate" — spawns 2 decoy clones that run and shoot harmlessly; the real one is 50% invisible for 3 s. Marketing gold. **L**
22. **"Nurse Kappa" — the Support/healer.** Look: a kappa (Japanese river imp) nurse with a water bowl on its head, bubble-gun syringe. Attack: bubble lob that damages enemies and heals itself on hit (showdown-friendly); in Duo heals the mate. Super: "Tidal Wave" — a wall of water sweeping forward, pushing enemies and extinguishing gas for 3 s in its path. **L**
23. **"Hopper" — the Mobility skirmisher.** Look: a frog courier with a messenger bag and roller skates. Attack: slingshot 2 pebbles that bounce once off walls. Super: 3 chained hops over walls (air, untargetable), each landing a small shockwave. Teaches bank-shots. **L**
24. **Skins with gameplay-neutral VFX sets.** Per brawler 2-3 skins generated through the existing pipeline (Nano Banana sheet -> Hunyuan -> Blender rig reuse since the skeleton is standardised): e.g., "Cherry Blossom Blaster" (pink petal seeds), "Neon Gunslinger" (synthwave rays), "Lava-lamp Bomber", "Porcelain Frostbite", "Retro-CRT Volt". Each skin swaps projectile colour/trail/SFX. Skins are the content engine for retention. **M per skin** (pipeline exists).

### 3D model & animation upgrades
25. **Hero-quality figurine pass.** Re-generate the 5 figurines at higher texture res, bigger heads/weapons (+25% weapon scale for readability), hand-painted-look texture cleanup, stronger saturated key colours contrasting each biome floor; add facial expression swaps (eyes texture atlas: happy, angry, hurt, KO X-eyes) driven by events. **L**
26. **More clips = more personality.** Per-brawler signature idle, a "taunt/emote" button (pins over the head + emote clip: laugh, cry, thumbs-up, GG), spawn intro pose, run-start anticipation and stop skid, carrying-many-cubes proud walk, hit-reaction directional (front/back), wall-bump stagger. **M-L**

### Arenas as playgrounds
27. **Interactive map elements kit.** Jump pads (launch across walls, readable arc), geysers that toss you and bullets, launch cannons, rolling boulders on rails, destructible explosive barrels (chain reactions!), healing mushrooms that regrow, sliding doors that open on a timer, teleport pipes. Each map gets 1-2. **L** (server rules too)
28. **Five new arenas with a landmark.** "Candy Factory" (conveyor belts that move you, chocolate rivers that slow), "Haunted Temple" (night, lanterns you can shoot out to darken zones), "Sky Islands" (fall-off edges = ring-out knockback kills, huge feel payoff), "Volcano Caldera" (lava cracks erupting on a pattern, gas replaced by rising lava), "Neon Arcade" (glitch tiles flicker walls on/off, synthwave music). Break the mirrored-quadrant template: asymmetric centres, one landmark piece per map (giant statue, crashed UFO). **XL** total, **L** per map.
29. **Map events mid-match.** A meteor shower on Dunes, a supply drop crate with a big cube cluster parachuting in at 1:30 (everyone converges = fight magnet), a lightning rod that super-charges whoever holds its zone during the storm. **M**

### Audio
30. **Audio pass 2.0 with ElevenLabs.** Per-brawler fire/reload/super/hurt/death sets (~10 sounds x 5), footsteps per surface (sand, grass, snow, ice, mud, water), ammo-empty click, reload pips, hit-confirm "tink" layered with a pitch ladder, KO stinger, gas-ring warning horn, 3-left dramatic sting, cube chime scale. Add a low-pass duck of the music during supers and on low HP. **M**
31. **Voice barks.** Short cute gibberish voices (Animal-Crossing-like, generated) per brawler: "Hyah!" on super, giggle on KO, "ow" on hurt, catchphrase on win. Hugely increases character attachment. **M**

### UI / HUD
32. **Diegetic, juicy HUD.** Ammo bar segments under the brawler that "snap" when reloaded with a click, super button that charges with a liquid fill and explodes with particles when ready, damage numbers that scale with damage and stack/merge for bursts (Gunslinger 6 bolts -> one counting number), kill feed with brawler portraits, "3 LEFT" / "FINAL DUEL" banners, gas ring telegraph line on the floor 5 s ahead. **M**
33. **Offscreen indicators & sound pings.** Edge arrows for enemies you have seen in the last 2 s and for heard gunfire outside vision (grey ping), respecting line-of-sight fairness. Big readability win in 8-player. **S-M**
34. **Result screen as a show.** Winner figurine on a spinning podium with the Victory clip, confetti, top-3 figurines on steps, stat cards (damage, KOs, cubes) sliding in with sounds, "MVP moment" auto-replay of your best 5 seconds (we already have a trailer recorder: `src/trailer.js`). **M-L**

### Wild cards
35. **Replay killcam.** Deterministic snapshot buffer of the last 5 s; when you die, watch your killer's POV in slowmo with a "revenge" mark on them. **L**
36. **Photo mode / diorama cam.** Pause, free orbit with tilt-shift DOF, filters, figurine poses, share button — fits the "toy figurine" art direction and feeds social. **M**
