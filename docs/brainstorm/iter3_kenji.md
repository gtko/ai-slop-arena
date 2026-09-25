# Iteration 3 — KENJI — DEBATE + DEEP DIVE

Correction to my earlier claims, after re-reading the code: the figurines **already have an inverted-hull outline**. `figurines.js buildFigurine` adds a skinned hull (`figurineOutline(0.02)`, colour `0x1a1024` from `models.js outlineMaterial`) and a hull per weapon. So "toon outline + team colour" is not a new pass: it's a **per-brawler outline colour uniform + a width bump**. The effort drops from M to **S**. Good news.

Also confirmed: `baseDmg` bug (Maya is right, S fix, first in line). Figurine budget today: Blaster about 38k skinned tris for the body plus a separate weapon mesh, Volt about 26k. One 1024 px webp atlas each (`optimize_models.py`: `0.35` ratio, `--texture-size 1024`). 16 clips each: Aim, Bored, BushIdle, Cheer, Cough, Death, Fidget, Hit, Idle, Run, Shoot, Slide, Sneak, Super, Victory, Wave.

---

## (1) Answers to Maya

### Q1. Time effects and hitstop online: **yes, all client-cosmetic; the sim never pauses.** Concede fully on global slow-mo.
- **The rule:** hitstop is a *render* effect. It freezes the victim's `Animator` (`mixer.timeScale = 0`) and holds its drawn mesh position for N ms, while the sim position keeps updating underneath. On release, the mesh catches up over 60 ms with the normal net interpolation. The bullet mesh also freezes in place for the same N ms (it's already dead in the sim).
- **Two-stage confirm (the answer to the 50-100 ms lag):**
  - **Stage A: contact, predicted, instant.** Your client already runs cosmetic bullets from `atk` events. When your own cosmetic bullet overlaps a *visible* enemy's radius, play the light, non-committal layer immediately: a small spark, a "tick" SFX at −6 dB, and the attacker-side micro-shake. No number, no hitstop.
  - **Stage B: confirm, authoritative.** On the host/server `dmg` event you get the heavy layer: victim hitstop, squash, white flash, damage floater, hit-confirm SFX with the pitch ladder. If Stage A never gets confirmed (a miss by prediction), nothing else plays. The spark alone reads as a "graze", which is honest.
  - **Why it works:** people bind cause and effect up to about 150 ms. At 50-100 ms RTT, Stage B lands 60-130 ms after contact, inside that window. Above 150 ms (a bad connection), Stage B's hitstop is shortened linearly to 0 at 250 ms, so a late freeze never looks like a stutter.
- **Global slow-mo:** only on the **final KO of the match** (1.0 s at 0.35x, render + camera only; the match has ended in the sim anyway) and in solo/offline. For other KOs you get a **camera-only "KO beat"**: a 90 ms zoom punch, a vignette flash and the launch arc of the victim figurine. No time dilation.
- **Super wind-up:** I accept Maya's "server-real" wind-up, but short and only where counterplay matters: area supers (Frostbite nova 200 ms charge ring, Volt storm target circle 300 ms, Bomber meteor shadow = its flight time). Projectile supers (Blaster, Gunslinger) stay instant. They are dodgeable by nature, and adding delay makes them feel sluggish. On the caster's screen the wind-up is the cinematic (punch-in, portrait slash); enemies see the red telegraph.

### Q2. Information vs juice: **I accept "if you can't see them, you can't see their juice"** as the law, with one exception I'd playtest.
- Already true by construction for most of it: brawlers out of LoS or in a bush are not rendered (`visibleToPlayer`), so their growth, sweat, crown, emotes and grass parting are invisible too. Codify it: every effect spawned *by* or *on* a brawler goes through one gate, `fxVisible(b) = b === me || b.visibleToPlayer`.
- **Grass parting:** only around *me* and visible brawlers. A hidden camper's bush stays still. Non-negotiable for me: *my own* bush parts, because that's the "I'm hidden" feedback.
- **Footsteps:** mine always. Visible enemies spatialised. Hidden enemies silent, **except within the 3.6 m bush-reveal radius** (same rule as the eye). That's fair, and it makes getting close tense.
- **Footprints and dust:** only from visible brawlers; prints of a brawler that becomes hidden fade in 0.5 s.
- **Off-screen gunfire:** the one exception to test. Firing already sets `revealT = 1.2` (the shooter is revealed *within LoS*). I'd like a **server-sent, coarse, direction-only "noise" arc** on the screen edge (one of 8 sectors, no distance, grey), only for shots fired within 20 m, and never for bush campers who don't fire. If playtests show it kills bush play, cut it. Maya can own the kill switch.
- **Cube growth:** visual only, hitbox fixed (agreed, deliberate). **Emote in a bush reveals you** (agreed, it's a great taunt risk).

### Q3. Content order: **yes, I trade 2 new arenas for the Arena Event Deck on the 5 existing maps + 1 template-breaking map. My pick is Sky Islands ("Windmill Isles"), not Caldera.**
- **Why Sky Islands first:** tech-cheap and gameplay-dramatic. Void is just a new tile type (`V`: not walkable, doesn't block bullets or LoS, and anyone pushed onto it falls). The engine stays a flat 2D grid (`arena.js` N=25, TILE=2 m). A ring-out is the most shareable kill in the genre. It also gives Kit 2.0 knockback (dash bumps, Blaster super, Mochi) a purpose.
- **Why not Caldera first:** rising lava by height bands needs real elevation (LoS, movement and projectiles are all 2D today). That's an engine change, so it goes second.
- **Concede on content order too:** next brawlers are **Pip & Chomp** (assassin, Showdown-native) and **Glitch** (brand, trickster). **Mochi** (tank) and **Nurse Kappa** (support) come with Duo. **Hopper** comes when bullet bounce exists. Skins only once mastery exists. I keep the art bible for all of them below, so art production can start ahead of code.

---

## (2a) New brawlers: art bible

The prompts below are **entries for `CHARS` in `art-src/ai3d/char_images.py`**, in the format `(look, weapon, A-pose, action pose)`. They respect the pipeline rules: matte vinyl/clay, nothing glowing or flying, gaps under the arms and between the legs, weapon to the side. Every brawler needs the 16 standard clips (`clips.py`: Aim, Bored, BushIdle, Cheer, Cough, Death, Fidget, Hit, Idle, Run, Shoot, Slide, Sneak, Super, Victory, Wave) plus the **new clips** listed below: a `Gadget` for all, and some specials.

**Readability rules for all new designs:** a recognisable 32 px silhouette (one big shape feature on top of the head); key colour saturated and distinct from the 5 floors (no salmon/sand main colours); the weapon at least 35% of body height; a dominant main colour not already used by an existing brawler (existing: green/brown Blaster, pink Gunslinger, orange/charcoal Bomber, ice blue Frostbite, cyan Volt).

### 1. PIP & CHOMP: melee assassin / trapper (Showdown, first to ship)
- **Silhouette:** small kid on a big round plant head. The signature shape is the huge open Venus-trap jaw with teeth on top. It's the only brawler wider than it is tall.
- **Palette:** Chomp deep leaf-green `#2f9e44` with a magenta-red mouth `#d6336c`; Pip white mushroom cap with red dots `#e03131`, cream skin, a teal scarf `#12b886`.
- **Materials:** matte vinyl leaves with sculpted veins, a glossier inner mouth (clearcoat 0.5), felt-like cap dots.
- **Personality:** Pip is shy and polite; Chomp is a feral, happy dog. Pip apologises after every bite.
- **New clips:** `Lunge` (the attack: Chomp snaps forward 4 m and Pip holds on), `Gadget` (Pip shakes a spore pouch), `Plant` (super: Pip crouches and plants a seed), a special `BushIdle` (Chomp pretends to be a bush, jaws closed, leaves perked).
- **Attack VFX:** a green motion smear along the lunge path, a bite "chomp" stamp (two white arcs closing), leaf particles, 3 teeth sparks on hit.
- **Super VFX:** a seed thrown to a spot; a trap-bush grows in 0.4 s (scale pop with overshoot). On trigger, a jaw rises from the ground, a root ring holds the victim, and a reveal eye icon shows over the victim for 3 s.
- **Gadget VFX:** a purple-grey spore cloud (smoke layer, slow, 3 m), with floating mushroom-glyph sparks.
- **SFX/barks:** bite = a wet crunch + a wooden clack; lunge = a whoosh with a leaf rustle; barks (gibberish, childlike): "Sorry!" (after a KO), "Chomp, no!", a Chomp growl-giggle; trap trigger = a snap + a grumble.
- **Prompt (CHARS entry):**
  - look: `a shy little MUSHROOM KID riding a big friendly CARNIVOROUS PLANT pet. The kid: a round white mushroom cap with big red dots as a hat, cream skin, big dark round eyes with a shy smile, a knitted teal scarf, a leaf-green tunic, brown boots. The pet, which the kid sits on: a big round leaf-green venus-flytrap head as wide as the kid is tall, the jaws open in a happy grin with a magenta-red inside and rows of short rounded white teeth, two small leaf ears, short stubby root legs, a curly vine tail with a small leaf.`
  - weapon: `no weapon: the pet's jaws are the weapon; the kid holds a small brown leather spore pouch tied with string.`
  - apose: `the kid seated on top of the plant, both arms held out to the sides away from the body, the spore pouch in the right hand; the plant's four root legs apart with gaps between them`
  - action: `the plant lunging forward mid-bite with the jaws wide open, the kid leaning forward holding on to a leaf with one hand, the other arm up, an apologetic face`

### 2. GLITCH: trickster / game mascot (Showdown, second)
- **Silhouette:** a cube head with a floating cursor arrow over it (a sculpted solid arrow on a thin stem, fused so Hunyuan keeps it). Stepped, "pixel-stair" shoulders.
- **Palette:** off-white `#f1f3f5` body, "error" magenta `#f03e3e` and chroma cyan `#15aabf` offset stripes (a painted chromatic aberration), black screen face with white pixel eyes.
- **Materials:** matte vinyl with painted pixel-stair edges. One arm has a "melted" drip texture painted on (the AI-slop gag), with **six fingers** on that hand.
- **Personality:** overconfident, chaotic, self-aware. It glitches between emotions mid-sentence.
- **New clips:** `Gadget` (a VHS rewind pose: arms jerk backwards), `Decoy` (a super snap pose), `Glitch` (a 0.3 s idle stutter: the pose freezes and jumps, driven by stepping the animator time), `Taunt` (it types in the air).
- **Attack VFX:** 3 letter-glyph projectiles (instanced planes with a glyph atlas: A, I, ?, #, ✓) with an RGB-split trail. On a wall hit, each splits into 3 smaller glyphs. On a brawler hit, a "404" pop sticker.
- **Super VFX:** 2 decoys spawn with a scanline dissolve-in; the real Glitch goes 50% transparent with an animated dithering pattern. The decoys pop into pixel cubes (debris layer) when their time runs out or they are hit.
- **Gadget VFX (Ctrl+Z):** a VHS rewind effect: horizontal tearing lines on Glitch, a ghost trail replaying its last 2 s path backwards (a sampled position ring buffer), a "◀◀" sticker.
- **SFX/barks:** dial-up modem chirps, a keyboard clack burst on fire, an error "bonk" on hit, a Windows-like ding on KO (made original); barks use vocoded gibberish: "Hallucinating!", "Ctrl-Zeee!", "As a large language brawler…"
- **Prompt (CHARS entry):**
  - look: `a cheeky little GLITCH ROBOT made of off-white vinyl. A big cube-shaped head whose front is a black screen showing two simple white square pixel eyes and a pixel grin; above the head a chunky white computer-cursor arrow on a short thin stem attached to the top of the head. The body is small and boxy with stepped pixel-stair edges on the shoulders and feet, magenta and cyan offset paint stripes along the edges like a misprint, one arm painted as if melting with drips, and that hand has six stubby fingers. Small rectangular floating-window shaped panels are sculpted onto the chest and back like stickers.`
  - weapon: `a chunky retro KEYBOARD-BLASTER: a short keyboard-shaped gun with big square keys, a thick cable coiled around the arm and a square nozzle.`
  - apose: `the keyboard-blaster in the right hand, held out to the side pointing down (not in front of the body)`
  - action: `leaning back cockily with one leg raised, firing pose with the keyboard-blaster pointed forward, the other hand doing a peace sign with its six fingers, big pixel grin, nothing flying out of the weapon`

### 3. MOCHI: tank / bush-clearer (ships with Duo)
Maya's "overloaded" note is accepted: **the stun is cut**. The super is a leap + slam that breaks walls and knocks back (a ring-out enabler on Sky Islands), with no stun. HP 6800.
- **Silhouette:** a big pear-shaped blob, twice the width of the others, with a tiny chef hat on top. It reads as a "big friendly boss".
- **Palette:** pastel strawberry-mochi pink body `#ffd6e0` with a darker rose belly band `#e64980` (the mawashi), a white hat, a brown sesame-seed pattern on the cheeks.
- **Materials:** very soft-looking matte "powdered" surface (a subtle flour-dust texture). In engine it gets a **jiggle vertex shader** (a spring on the body driven by velocity, extending the existing `swayPatch`).
- **Personality:** a gentle giant, food-obsessed, says "itadakimasu" before the super.
- **New clips:** `Bump` (a belly bump attack), `Leap` (super: crouch 0.2 s, jump, a 1.1 s airtime loop, then `Land`), `Gadget` (squish into a flat sticky puddle and back), a `Victory` belly-drum.
- **Attack VFX:** a translucent pink jelly shockwave cone (an expanding arc mesh, 3 pulses) with flour-dust puffs.
- **Super VFX:** a growing shadow circle at the landing point (the telegraph, visible to all), a flour-dust ring, a crack decal, a big shake, wall debris.
- **Gadget VFX:** a sticky goo puddle with strands linking enemies that touch it (the `ribbon()` reused as goo strands).
- **SFX/barks:** a squishy "boing" plus a taiko hit on the bump, a whistle rising for the leap, a huge "DOSUN" thud on landing, a happy "mmm!", "Itadakimasu!"
- **Prompt:**
  - look: `a big round gentle SUMO SEAL made of soft pastel pink strawberry mochi. Pear-shaped body much wider than tall, a matte powdery surface, a thick rose-red sumo belt tied around the belly with a big knot at the back, small flipper arms, short stubby feet, a tiny white chef hat on top of the head, closed happy curved eyes, rosy cheeks with a few brown sesame seed dots, small whiskers.`
  - weapon: `no weapon: it fights with its belly; it holds a small wooden rice paddle.`
  - apose: `flipper arms held out to the sides away from the body, the wooden rice paddle in the right flipper pointing down, feet apart`
  - action: `sumo stance with knees bent, one foot raised high to stomp, flippers spread wide, determined happy face`

### 4. NURSE KAPPA: support / zone control (ships with Duo)
Maya's note accepted: Tidal Wave clears gas only in a **2 m wide lane, for 1.5 s**.
- **Silhouette:** the dish of water on the head (a flat sculpted disc of blue water) and a giant syringe-bubble gun.
- **Palette:** kappa green `#94d82d`, a nurse outfit in white with a coral red cross-plus `#ff6b6b` (not a real medical cross: a rounded "+" in coral), a turtle shell in teal `#0ca678`, and a yellow beak.
- **Materials:** matte vinyl skin, a glossier shell, the water dish as a solid sculpted light-blue resin disc.
- **Personality:** a bossy caring nurse, fusses over everyone, very competitive.
- **New clips:** `Lob` (the attack: underarm bubble throw), `Wave` is taken, so the super clip is `Tide` (a surfing pose), `Gadget` (bows to spill the head dish), `HealBeam` (for the Duo revive).
- **Attack VFX:** soap bubbles (a transparent fresnel shader) arcing over walls; they pop into a splash disc (damage + green "+" sparkles on allies/self).
- **Super VFX:** a stylised cartoon wave (a scrolling-UV curved sheet with a foam line) sweeping forward 10 m; wet decals on the floor; the gas in the lane swirls away.
- **Gadget VFX:** a glowing blue puddle with rising "+" bubbles; the head dish becomes empty (swap to the empty-dish morph).
- **SFX/barks:** bubble "bloop", pop, wave roar with surf hiss, a nurse whistle; barks: "Say ahh!", "Hold still!", "You're welcome!"
- **Prompt:**
  - look: `a bossy little KAPPA NURSE, a Japanese river-imp creature with smooth lime-green skin, a short yellow duck-like beak with a confident smile, big round black eyes, a flat round dish of light-blue water sculpted as a solid resin disc sitting on top of the head surrounded by a ring of short green hair, a teal turtle shell on the back, webbed hands and feet. Wears a white nurse dress with a rounded coral-red plus sign on the chest, a small white nurse cap pinned next to the water dish, coral belt.`
  - weapon: `a big chunky BUBBLE SYRINGE LAUNCHER: a toy-like oversized syringe with a clear light-blue tank filled with solid sculpted bubbles, a coral plunger and a round nozzle.`
  - apose: `the bubble syringe held in the right hand out to the side pointing down, the left arm out to the side, feet apart`
  - action: `leaning forward on one foot, lobbing underarm with the bubble syringe, the other hand on the hip, a bossy wink`

### 5. HOPPER: mobility skirmisher / bank shots (ships with bullet bounce)
- **Silhouette:** big frog eyes on top plus a big messenger bag plus skates. It reads as "fast".
- **Palette:** frog yellow-orange `#fab005` (the only yellow-dominant brawler), a navy courier cap and bag `#364fc7`, red skates `#fa5252`.
- **Materials:** matte vinyl, a canvas-like bag texture, glossy rubber skate wheels.
- **Personality:** a hyper, chatty delivery-rush courier; everything is "express".
- **New clips:** `Skate` (a run variant: gliding strides, replaces Run), `Hop` (super: 3 hops; air pose + a squash landing), `Gadget` (crouch boost), `Sling` (the slingshot attack).
- **Attack VFX:** 2 pebbles with a short dotted trail; a spark plus a "tink" ring on the wall bounce; a dashed ghost preview of the bounce path in the aim indicator (it's critical that bank shots are readable).
- **Super VFX:** a landing shockwave ring each hop, a cartoon speed trail, a "!" parcel stamp on the last landing.
- **Gadget VFX:** skate sparks and a comic speed-lines cone.
- **SFX/barks:** rubber-band twang, pebble ricochet "ptink", skate rolling loop, a ribbit on each hop; barks: "Express delivery!", "Signed, sealed!", "Ribbit-bye!"
- **Prompt:**
  - look: `a hyper little FROG COURIER on roller skates. Warm yellow-orange smooth frog skin, very big round bulging eyes on top of the head with a cheeky grin, a navy blue courier cap worn backwards, a navy messenger bag with a big buckle across the chest, a white t-shirt with a navy stripe, knee pads, chunky red quad roller skates with white wheels.`
  - weapon: `a big wooden Y-shaped SLINGSHOT with a thick red rubber band and a leather pouch.`
  - apose: `the slingshot in the right hand held out to the side pointing down, the left arm out to the side, skates apart`
  - action: `skating fast leaning forward on one skate, pulling the slingshot band back to aim forward, tongue out in concentration`

### Bonus 6. CLAWDIA: turret builder / area denial (a later Showdown brawler)
- A hermit crab whose shell is a tiny tea-house. **Attack:** a bubble-shot claw burst of 3 short shots. **Super:** "Open House", she leaves her shell as an auto-turret (1800 HP) that shoots the nearest visible enemy for 8 s, while she is naked and 25% faster (a comedy blush). **Gadget:** "Clamp", pulls the closest enemy within 5 m 2 m toward her. **Role:** holds a bush corner and denies cube crates.
- Prompt look: `a small feisty HERMIT CRAB whose shell is a tiny red-roofed Japanese tea-house with round paper lanterns sculpted on the corners, coral-orange crab body, one big claw and one small claw, eyes on short stalks with a sassy look, a little green headband.` Weapon: `her big coral claw with a small brass bubble nozzle built into it.`

### Bonus 7. NIMBUS: charge-shot sniper
- A cloud-sheep with a lightning-rod horn. **Attack:** hold to charge (0.8 s): damage and range scale 40-100%. It's the game's first charge mechanic (Maya's ammo-variety idea). **Super:** "Downpour", a rain cloud that follows the targeted enemy for 4 s, raining (DoT) and making them visible through bushes. **Gadget:** "Fluff Up", doubles in size, becomes a 1-tile wall-shaped cover for 2 s. **Role:** long-range pressure, anti-camper.
- Prompt look: `a sleepy fluffy CLOUD SHEEP: a round body of puffy white sculpted cloud wool, a small slate-grey face and legs, droopy half-closed eyes, a thin golden lightning-bolt shaped horn on top of the head, a tiny yellow raincoat hood.` Weapon: `a long brass umbrella-rifle: a closed yellow umbrella with a brass barrel at its tip.`

---

## (2b) 3D model and graphics upgrade plan

### Figurine hero-quality pass (existing 5 + every new one)
1. **Source quality.** Regenerate the reference with `char_images.py` (A-pose), then Hunyuan3D-2 at the full octree resolution (not turbo) for the shape. Paint at 2048, keep the raw GLB in `art-src/glb/` as the master.
2. **Cleanup in Blender 5.2 (scripted, headless):**
   - Voxel remesh at 0.008 then QuadriFlow to about 12k quads, so the topology deforms cleanly at the shoulders, hips and knees.
   - Project the Hunyuan paint onto a new UV (Smart UV at 0.02 island margin), then bake 2048 diffuse and a baked AO multiply at 30%.
   - Fix hands: separate fingers where they are fused (six for Glitch, deliberately).
   - Separate the weapon mesh (already done by the rig pipeline).
3. **Readability edits:** weapon scale ×1.25 on all 5, head/eye paint contrast +15%. Recolour the main colours of Frostbite and Gunslinger in the texture (hue/saturation pass in Python PIL on the atlas) so they don't melt into the salmon/sand floors.
4. **Rig:** keep the Mixamo-named skeleton (`art-src/rig/`). Add 2 bones: `Jiggle` (the body spring for Mochi and Chomp) and `Prop` (the second weapon slot, for skins and gadgets). New clips go through `clips.py`.
5. **LODs (via `optimize_models.py`, a new `--lod` flag):**
   - LOD0 about 18k tris (desktop high/ultra).
   - LOD1 about 8k (medium, and mobile high).
   - LOD2 about 3.5k (mobile low/medium, and every brawler farther than 18 m).
   - Chosen by tier plus distance to `camFocus`, switched only when the brawler is off-screen or in the same frame as a poof, to avoid pops.
   - The **outline hull uses LOD2 always** (it's a silhouette; half the skinned cost).
6. **Textures:**
   - 1024 webp desktop, 512 on mobile low (a second file, `*_m.glb`, picked by `ASSET_BASE`).
   - Expression **eye decals**: a 4-cell atlas (normal, angry, hurt, KO X-eyes) swapped by a uniform offset in the existing `EYE_FRAG` patch. It's cheap, and huge for personality.

### Toon outline and team colour (S, re-scoped)
- Give `outlineMaterial` a colour uniform (a per-brawler material instead of the shared one): **me = `#15aabf` cyan (width 0.028), teammate = `#40c057` green, enemy = the default dark `#1a1024` with a red inner rim** (the existing `charMat` rim → red at 0.35 when the brawler is an enemy and visible).
- The ground ring (`brawler.js this.ring`) follows the same colours. A setting "Colour-blind: enemy = orange / me = blue".

### VFX library (one module, `vfx/`, data-driven presets)
Presets on top of the existing `Effects` layers (sparks, debris, smoke, fire, rings, ribbons, scorches, flashes):
`hitSpark(dir, col, size)`, `hitDisc`, `koLaunch`, `koStamp`, `muzzle(type)`, `trail(type)` (a ribbon following a projectile, 8 points), `groundTelegraph(shape, radius, time)` (a red decal fill-up), `shockwave(radius)`, `dustStep(surface)`, `splash`, `speedLines`, `dissolve(pattern)` (scanline, pixel, petals), `crownAura`, `reviveBeam`.
Budget:
- Particles: max 800 sparks, 360 debris, 320 smoke, 260 fire (as today). On mobile medium and below, the spawn count ×0.5 through the existing `weather` quality scalar, reused as `fxScale`.
- **New layer: "decals".** An instanced quad with a texture atlas: scorch, crack, wet, footprint, telegraph. One draw call.

### Post-processing (per tier)
Current chain: Render (MSAA) → GTAO → sight → visionFog → bloom → cartoon grade → Output.
- **Add one "feel pass"**, merged into the existing `cartoonGradePass` shader so it costs 0 extra passes. It adds uniforms for: radial chromatic aberration (KO/hurt pulse), a desaturation amount (low HP edges, super wind-up), a vignette tint (red when hit, green gas, gold bounty), and a radial speed-lines overlay (procedural, super cinematic).
- **Colour grade per map** (a LUT-lite: lift/gamma/gain in the same pass) so the maps get distinct moods.
- No DOF in play (bad for readability). DOF only in the result podium / photo view.

### Mobile performance budget (target: 60 fps on a Snapdragon 7-gen Android at "medium" mobile; 30 fps floor on "low")
| Item | Budget (mobile medium) | Today (estimate) |
|---|---|---|
| Draw calls per frame | ≤ 180 | figurines 8 × (mesh + hull + weapon + weapon hull) × (color + shadow) ≈ 64, props instanced, so OK |
| Skinned tris per frame | ≤ 160k (8 × LOD1 8k × 2 with hull on LOD2) | ≈ 8 × (30k + 30k hull) ≈ 480k: **the #1 mobile cost** |
| Static tris | ≤ 250k | instanced props at 1-2k each: OK |
| Texture memory | ≤ 96 MB | 5 × 1024 figurines + tex/: OK; new brawlers + skins need 512 mobile variants |
| Dynamic lights | 6 (as `LightPool(MOBILE ? 6 : 12)`) | keep |
| Shadow map | 1024 (as mobile presets) | keep; figurines cast, particles never |
| Post passes | render, sight, fog, (bloom on high), grade+feel, output | the feel pass merged into grade: +0 |
| Particles alive | ≤ 600 total | scaled by `fxScale` |

---

## (2c) Arenas

### Windmill Isles: the template-breaking map (not mirrored; balanced by resources)
New tiles: `V` void (fall = KO, the knocker gets credit), `=` wooden bridge (walkable, **breakable**: 1200 HP, it becomes `V`), `J` jump pad (launches 7 m along its arrow, 0.8 s airtime, lands with a shockwave; always toward the island centre), `E` explosive barrel (600 HP, 2.5 m blast 900 dmg + knockback 9, chain reaction), `H` healing mushroom (+1200 HP over 2 s, regrows in 20 s), `M` windmill landmark (a 2×2 block, impassable; its shadow sweeps, cosmetic).
Blockout 25×25 (row 0 = north). Spawns `S` ×8, 4 islands + a centre island. Every spawn is 1 bridge or 1 jump pad from the centre and has 2 crates within 6 tiles.
```
     0         1         2
     0123456789012345678901234
 0   VVVVVVVVVVVVVVVVVVVVVVVVV
 1   V.S..BB.VVVVVVVVVVV.BB.SV
 2   V..C.BB.VVVVVVVVVVV.BB..V
 3   V.....#.=========..#..C.V
 4   V.B..H#.VVVVVVVVVV.#....V
 5   V.B.....VVVVJVVVVV.....EV
 6   V..E..S.VVVVVVVVVV..S...V
 7   VV..J..VVVVV=VVVVVV..J.VV
 8   VVVVVVVVVVVV=VVVVVVVVVVVV
 9   VVVVVVVVB...=...BVVVVVVVV
10   VVVVVVV..#.....#..VVVVVVV
11   V.S.==...C..MM.......VVVV
12   V....V..BB..MM..BB..==S.V
13   V.C..V.......H.....C..V.V
14   V....==..#...E...#....V.V
15   VVVVVVVVB.........BVV...V
16   VVVVVVVVVVVV=VVVVVVVVVVVV
17   VV..J.VVVVVV=VVVVV..J..VV
18   V.......VVVV=VVVVV.....EV
19   V.S..BB.VVVVVVVVVV.BB.S.V
20   V..C.BB.=========..BB...V
21   V.E....#VVVVVVVVVV#...C.V
22   V....H.#VVVVVVVVVV#..H..V
23   V.......VVVVVVVVVV......V
24   VVVVVVVVVVVVVVVVVVVVVVVVV
```
(A blockout for the level editor; exact balance comes from a bot-sim heatmap: run 500 headless bot matches in `npm test`'s sim and compare placement per spawn, within ±5%.)
- **Gas on Windmill Isles:** instead of rings, **islands "crumble" in order**. Outer islands break off (their tiles become `V`, with a 5 s crack telegraph and wobble) at 40/60/80 s, and the centre island is last. It's the same systems role as the gas, and far more dramatic. The server just flips tiles.
- **Weather:** high wind. Brawlers drift 0.4 m/s eastward on bridges only (visible windsock and cloud streaks). The music theme is a whimsical accordion-and-taiko mix.

### Caldera (next; needs elevation, listed for planning)
3 terraces (h0 lava edge, h1 ring, h2 summit). Rising lava replaces the gas: h0 at 40 s, h1 at 75 s. Ramps are chokepoints. Cracks erupt on a telegraph. Needs height-aware LoS (a wall blocks if higher than both viewer and target): an engine story for later.

### Interactive kit (usable on the 5 existing maps through the Event Deck)
| Piece | Rule | Telegraph (visual + audio) | Maps |
|---|---|---|---|
| Jump pad `J` | 7 m arc along the arrow, 0.8 s, no attacks in the air, shockwave 150 dmg on landing | chevrons pulse, a "boing" charge-up | Windmill Isles, Oasis variant |
| Explosive barrel `E` | 600 HP, 2.5 m / 900 dmg / knock 9, chains | red stripes, a hiss fuse when below 30% | Dunes, Grove, Windmill |
| Healing mushroom `H` | +1200 over 2 s, regrows in 20 s | sparkle when ready, a "pop" pickup | Grove, Marsh, Windmill |
| Geyser `G` | every 8 s launches anyone on it 3 m up (untargetable 1 s) and **deflects projectiles** | steam puffs 1 s before, a rising whistle | Oasis (water edges), Frost (hot springs) |
| Breakable bridge `=` | 1200 HP, becomes water/void | cracks at 50% | Windmill, Marsh |
| Lightning rod (event) | holding the zone 5 s during a storm charges the super 100% | a copper glow, a crackle loop | Grove |
| Supply drop (event) | 45 s: a crate lands (5 s shadow), 3 hits, 5 cubes | spotlight beam, siren, parachute; themed per map | all |
| Meteor shower (event) | 6 meteors in 10 s on random tiles, 700 dmg | growing red circles 1.5 s | Dunes |
| Blizzard gust (event) | 15 s: sight −30%, ice floor spreads 2 tiles | the screen edge frosts, a howl | Frost |

---

## (2d) Game-feel core pack: tuning sheet

All values are client-side and cosmetic unless marked [SIM]. "Trauma" is 0..1; shake = trauma². Max offset 0.55 m, max roll 1.2°, noise frequency 16 Hz, decay 1.7/s. It respects the existing "camera shake" setting (0 = off, and a new 50% step).

### Per weapon
| Weapon | Hitstop, victim (ms) | Hitstop, bullet/attacker (ms) | Trauma on fire (self) | Trauma on hit dealt | Trauma on hit taken | Floater | Notes |
|---|---|---|---|---|---|---|---|
| Blaster seed (per pellet) | 25 (max 70 for all 5 pellets) | 0 | 0.14 + a kick back 0.25 m | 0.04/pellet | 0.18 | pellets merge into 1 number | knockback 0.4 m on a 3+ pellet hit (cosmetic mesh nudge) |
| Blaster super | 90 | 50 | 0.40 | 0.12 | 0.35 | big | walls: debris ×1.5 |
| Gunslinger bolt | 20 | 0 | 0.03 per bolt | 0.02 | 0.10 | a counting number (burst total) | last bolt of the burst: 45 ms + a crit-yellow floater |
| Gunslinger super bolt | 30 | 0 | 0.05 per bolt | 0.03 | 0.12 | counting | |
| Bomber fireball | 60 (per victim) | – | 0.06 (throw) | 0.20 at impact (distance-scaled) | 0.30 | big | shadow circle during the flight |
| Bomber meteor | 110 | – | 0.10 | 0.55 | 0.55 | huge | a 70 ms white frame flash at 10% opacity |
| Frostbite shard | 35 | 0 | 0.06 | 0.05 | 0.15 | normal | ice chips on shatter |
| Frostbite nova | 120 | 80 (caster) | 0.35 | – | 0.40 | – | [SIM] 200 ms charge ring |
| Volt orb | 45 (first), 30 (chains) | 0 | 0.07 | 0.06 | 0.18 | normal | a 60 ms arc freeze-frame on the chain |
| Volt storm strike | 70 | – | – | 0.30 | 0.35 | big | [SIM] 300 ms target circle |
| Melee bite (Pip) | 80 | 60 (attacker too) | 0.12 | 0.15 | 0.25 | big | the melee needs attacker hitstop to feel solid |
| Mochi bump | 70 | 50 | 0.15 | 0.18 | 0.30 | normal | |
| Mochi landing | 120 | 80 | 0.60 | – | 0.50 | big | |
| KO (any) | 150 on the victim | – | – | +0.25 | – | K.O. stamp | a camera zoom punch of −6% over 90 ms, back in 250 ms |
| Final KO | global 1.0 s at 0.35x [render only] | | | 0.5 | | | orbit cam 200° around the winner |

### Victim squash (on confirm)
Scale on the hit axis 0.86, perpendicular 1.10; springs back with k=320, damping 18 (the existing `flash*0.08` squash is replaced). Flash: white emissive 0.9 → 0 over 120 ms (as today, but white instead of tinted, and 2 frames at full).

### Camera
| Parameter | Value |
|---|---|
| Base offset | (0, 27.4, 25), FOV 40 (as today) |
| Aim look-ahead | toward the aim direction, `min(2.6 m, 0.18 × range)` while aiming; toward movement 1.2 m; smoothing τ = 0.25 s |
| Zoom in a bush while idle for 1.5 s | distance ×0.94 (τ 0.6 s) |
| Zoom at 3 left | ×1.06; at 2 left (final duel) ×1.10 and frame both duelists if both are visible, clamped so the frame never exceeds the 14 m sight radius + 3 m |
| Super cast (own) | punch-in ×0.92 over 120 ms, hold for the wind-up, back out over 300 ms |
| KO punch | ×0.94 over 90 ms |
| Spectate after death | the camera slides to the killer over 0.6 s with ease-in-out (today it cuts) |

### Input feel
- Shot input buffer: 120 ms (cooldown/ammo). Super buffer: 200 ms.
- Touch auto-aim tap: nearest *visible* foe within range, else the facing direction (as today). While dragging: a soft snap within 12° when a target sits inside the range (disable in settings).
- Haptics (Capacitor Haptics, Android/iOS):
  - light impact on a dealt-hit confirm, max 1 per 80 ms;
  - medium when you take a hit;
  - heavy on a KO;
  - a success pattern when the super is ready.
  - Gamepad: the existing `rumble` with the same mapping.

### SFX list (ElevenLabs, via the `genere-sons` skill; about 70 files, mp3, ≤ 40 KB each)
- **Per brawler (×5 now, ×2 for each new one):** `fire_<b>`, `fire_<b>_tail`, `super_<b>_windup`, `super_<b>_release`, `hit_<b>` (the impact sound of that weapon), `hurt_<b>` (voice), `ko_<b>` (voice), `win_<b>` (voice), `gadget_<b>`, `step_<b>` (weight: light/medium/heavy).
- **Hit confirm:** `hitconfirm_1..5` (a rising pitch ladder, resets after 1 s without a hit), `hit_graze` (Stage A tick), `crit_ding` (last bolt/pellet).
- **Feedback:** `ammo_empty_click`, `reload_pip`, `reload_full`, `super_ready` (exists as `ready`), `cube_pickup_1..5` (a rising scale), `regen_start`, `lowhp_heartbeat_loop`, `bush_enter_rustle`, `bush_exit_rustle`.
- **Surfaces:** `step_sand`, `step_grass`, `step_snow`, `step_ice`, `step_mud`, `step_water`, `step_wood` (bridges), `slide_ice`.
- **Match:** `ko_stinger`, `final_ko_stinger`, `three_left_sting`, `gas_ring_warn`, `gas_ring_close`, `supply_siren`, `supply_land`, `island_crumble`, `jumppad_boing`, `barrel_fuse`, `barrel_boom`, `geyser_whistle`, `mushroom_pop`, `revive_chime`, `bounty_crown`.
- **Mix rules:** a music duck of −6 dB over 150 ms during your own super and at your KO; a low-pass on music at 1200 Hz under 25% HP; the own-weapon bus is +2 dB over others; the ±8% pitch random on every shot is already partly in `audio.js`: extend it to all.
