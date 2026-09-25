# Iteration 4 — KENJI — PRIORITIZE

## (1) Reactions to Maya's iteration 3 (feel / content angle)

Overall: her numbers are sane and her A (mobility) / B (utility) gadget split is better than my "the dash is the gadget". I adopt it. Her CC immunity, the event-deck scheduling rules and the persona weights are exactly the kind of rules that make juice *fair*. Below: what each piece needs in order to land, and what would feel bad.

### Kit 2.0
**Needs (per gadget):** 1 clip (or a reuse of Slide/Super halves), 1 VFX preset, 1 SFX + 1 voice bark, 1 icon (128 px), 1 enemy tell.
- **Gadget button:** a small round button above the attack stick, 3 charge pips and a radial 5 s lockout sweep. The pips pop with a sound when used, and a tiny icon of the chosen gadget is on the button.
- **Star powers:** a passive, so it needs a *passive tell* or players forget they exist: a star icon next to the nameplate that pulses when the passive triggers (Sap Regen starting early, Splinters on a wall hit, Deep Freeze on a slow).
- **CC immunity (1.5 s):** it must be visible or it will read as a bug ("my root didn't work!"). Show a white shimmering outline plus a small shield icon over the head, and an "IMMUNE" micro-floater when a CC bounces off, with a glassy "tink".
- **Airborne arcs (Lava Hop, Mochi Pound, Triple Hop):** they need a ground shadow that shrinks/grows with height (the blob already exists in `brawler.js`), a landing marker visible to enemies, squash on landing and a dust ring. Airtime is the most "new-feeling" thing in the release: stage it.

**Would feel bad, and my fixes:**
- **Pip & Chomp, 2 ammo × 1100 melee lunge:** a whiffed melee lunge on 2 ammo feels awful (and it's worse at 100 ms RTT). Add **lunge magnetism** (a server-side ±15° steer toward the nearest visible enemy within 4.5 m), and on a whiff play a "miss" animation where Chomp bites air and Pip wobbles, so it's funny, not frustrating. Maybe 3 ammo × 800 instead of 2 × 1100: same DPS, less whiff punishment (Maya to decide).
- **Mochi: 0.8 s stun + Heavyweight (knockback immunity).** Getting stunned by a 7000 HP blob you can't push is the "unfun tank" pattern. Keep the stun, but make SP1 "Heavyweight" **−50% knockback**, not immunity, so the Sky Islands ring-out still works on Mochi. It's funnier to launch a big seal off a cliff.
- **Blaster Root Charge:** "rooted but can still shoot" is good. The root needs roots visibly wrapping the feet (a green ring + 3 small root meshes), or players will think it's lag.
- **Glitch decoys, "decoy flag hidden from enemies":** decoys must render **exactly** like the real one: same skin, same nameplate, same HP bar (decoys show fake HP drops), same footsteps. The *owner* sees them tinted. On death, all poof into pixel cubes so the tell comes only at the end.
- **Glitch Lag Spike (nameplate jitter):** love it. Add a chromatic-split jitter on the slowed brawlers' outlines too, and a "bzzt" sound.
- **Gunslinger Star Flare:** perfect bush counter. The VFX is a flare arcing up, bursting into a star; a 6 m circle on the ground lights up gold, and revealed brawlers get a gold eye icon.
- **Volt Blink:** needs a 0.15 s pixel dissolve at the origin and a reform at the destination. The zap trap is a small crackling decal (enemy-visible, fair).
- **Kappa Tidal Wave clearing gas for 2 s:** fine. The gas swirl-away effect must be local (only the swept lane), or it'll read as "the gas is broken".

### Mode lineup
- **Duo Showdown:** the spec is great. Feel additions:
  - partner HP bar + portrait in the corner;
  - a **tether line** (a thin dotted green line on the floor) when the partner is off-screen or more than 10 m away;
  - the ghost figurine (translucent, halo, the `Death` pose held in the air) with a ring timer (15 s);
  - a revive beam (a green ribbon);
  - on revive: hitstop, a "REVIVED!" stamp and a partner "Thanks!" bark.
- **Would feel bad:** "no revive once the team used 2". Players won't know the count, so show it as 2 heart pips on the partner portrait.
- **Knockout 3v3:** it needs a round-intro show (3 v 3 figurines lined up on a "VS" splash, 2 s), a round-won banner with team colour, and a match point sting. Two-way mirrored maps need a new visual language: blue/red half-tinted floors so the sides read at a glance.
- **Boss Raid "Slop Kaiju":** the biggest art ask:
  - one 4× scale boss model (Hunyuan at full res, custom rig with ~8 clips: Idle, Roar, Slam, Sweep, Breath, Stagger, Enrage, Death);
  - telegraph decals (ring, cone, line), crate goblin minions (1 model, 6 clips);
  - phase-change cinematics (camera pull-back, roar shake 0.6, screen tint);
  - its own music (a 3-phase adaptive Lyria track: layers added per phase).
- **Training Dojo:** straw dummy figurines (1 model, Hit/Death clips) plus a floating DPS board.

### Progression
- **The rule:** no reward without a ceremony.
  - A level-up gets a full-screen flash on the result screen, the figurine does `Cheer`, the XP bar bursts into confetti, and a reward card flips in (3D rotate, sparkle, "ta-da" jingle).
  - A mastery level up gets a gold star pop on the brawler card, with a unique brawler voice line.
- **Quest board:** a wooden cork board with 3 paper cards; the stamp animation "COMPLETE" slams in with a thud + shake 0.2.
- **Trophy Road:** a horizontal path of figurine pedestals (reuse of the diorama look), not a flat list.
- **Recolor skins at mastery 5:** cheap in production (a hue/value pass on the 1024 atlas, done in Python). But they must avoid the team-rim hues (cyan/green/red outlines) and keep the projectile colour coding (`combat.js colorFor`: enemy shots stay red, whatever the skin).
- **Golden figurine at mastery 10:** a material swap (metalness 0.9, a gold tint, an extra clearcoat) plus a sparkle particle when idle. Cheap, and it looks premium.
- **Would feel bad:** gating Ranked behind mastery 4 on *each* brawler. Fine. But gating Knockout behind account level 3 hides the new mode from returning players who haven't levelled yet. Suggestion: grandfather anyone with ≥ 20 matches played.

### Event deck
- **Supply Drop:** the crown jewel. A themed crate per map, which means **5 crate models**, or 1 model + 5 textures: a sand-bag cargo crate (Dunes), a moss chest (Grove), a gift sled (Frost), a bubble pod (Marsh), a canyon cargo balloon (Oasis).
- **Sand Gust pushing 2 m/s:** will feel bad if it pushes you into the gas or off-aim when you're fighting. Fixes: never push toward the next gas ring (the server picks the gust direction away from the gas edge, or cancels the gust), cap it at 1.5 m/s, and show a 2 s sand-wave telegraph + windsock HUD icon. Projectiles are unaffected (agree).
- **Blizzard at 8 m sight:** good drama. The screen edges frost over (the feel pass vignette in white), figurines get a snow crust (the emissive-white rim ramp), and the howl ambience ducks the music.
- **Bounty reveal out of LoS:** it needs a distinct render, an **x-ray silhouette** (gold outline drawn through walls, depth test off) for 1 s. Otherwise it looks like the line-of-sight system is broken.
- **Max 2 events per match, never at ≤ 3 alive:** agree; the endgame belongs to the players.

### Bots 2.0
Personas land only if visible:
- a persona icon on the nameplate (🎯 Hunter, 🌿 Camper, 💰 Looter, 🦅 Vulture, 🐔 Coward, 🎤 Show-off);
- 4-6 bark lines each, shown as speech bubbles + a gibberish voice;
- 1 signature emote each, so about 30 bubble lines + 6 icons.

Dodging bots also need a visible **sidestep** (a Slide clip) or they look like they're teleporting.

---

## (2) Phasing: 6 releases (v0.11 → v0.16), each visibly new

Principles: every release has **one thing you notice in the first 10 seconds** of a match, and one new "thing to own". The art pipeline (Nano Banana / gpt-image → Hunyuan3D-2 local → Blender rig → `optimize_models.py`) is the production line: it takes about 2-3 days of machine and cleanup time per new rigged character.

### v0.11 "IMPACT"
*Promise: every shot you land, every KO you score, you feel it in your hands and ears.*
- Game-feel core pack: two-stage hit confirm, hitstop, victim squash, trauma camera, aim look-ahead, endgame zoom, KO beat, final-KO slow-mo, input buffer, low-HP state, regen ring timer, haptics.
- Audio pass 2.0: per-brawler sets, footsteps (LoS-fair), hit-confirm ladder, stingers, mix rules.
- Readability: team/self outline colours, weapons ×1.25, key-colour texture pass, eye expressions, colour-blind option.
- HUD: kill feed, "3 LEFT" / "FINAL DUEL" banners, gas ring telegraph line, merged burst damage numbers.
- **Systems riders (Maya):** `baseDmg` fairness fix + test, bot backfill at 60 s.
- **Art/content production:**

| Asset | Count |
|---|---|
| SFX (ElevenLabs) | ~70 |
| Voice-bark sets (5 brawlers × 6 lines: fire, super, hurt, KO, win, taunt) | 30 |
| Eye-expression atlases (4 cells each) | 5 |
| Figurine texture re-passes (colour/contrast) + weapon rescale | 5 |
| VFX textures (hit disc, KO stamp, speed lines, glyphs, decal atlas) | 6 |
| UI art (KO stamp, kill-feed frames, banners, low-HP vignette) | ~10 |
| Music stingers (Lyria clip: KO, final duel, 3 left) | 3 |

### v0.12 "TOOLBELT"
*Promise: your brawler has a trick up its sleeve now: pick it, time it, outplay with it.*
- Kit 2.0: 10 gadgets (A/B) + 10 star powers on the 5 brawlers, CC immunity, telegraphed area supers (nova ring, storm circles).
- Arena Event Deck v1: Supply Drop on every map + 1 themed card per map (Meteor Shower, Lightning Rod, Blizzard, Fog Bank + Mushrooms, Geysers).
- Bounty crown + cube growth + cube rebalance.
- Bot 2.0 with personas.
- **Art/content production:**

| Asset | Count |
|---|---|
| New animation clips (gadgets; some reuse) | ~10 |
| VFX presets (gadgets 10, telegraphs 3, crown aura, x-ray silhouette, events 6) | ~21 |
| SFX | ~35 (gadgets 10, SPs 5, events 12, crown, immunity, lockout...) |
| Barks (gadget lines ×5 brawlers; persona lines ~30) | ~40 |
| Icons 128 px (gadgets + star powers) | 20 |
| Persona icons | 6 |
| 3D models: supply crates (1 base + 5 themed textures), bounty crown, healing mushroom, geyser vent, lightning rod | 5 |
| UI art (gadget button, loadout picker in the lobby with cards) | ~8 |

### v0.13 "LEVEL UP"
*Promise: every match earns you something: levels, mastery, quests, and looks everyone can see.*
- Account XP + levels, Brawler Mastery 1-10, 3 daily quests + weekly, Bot League trophies + Trophy Road, Slop Coins + a rotating cosmetic shop (cosmetics only).
- Cosmetics wave 1: 5 recolor skins, 5 projectile trails, 5 KO effects, 5 golden figurines, 12 emotes (clip + sticker), nameplate frames, titles.
- **Result screen show:** podium with the top-3 figurines, stat cards, MVP awards, level-up ceremony.
- **Art/content production:**

| Asset | Count |
|---|---|
| Recolor atlases | 5 |
| Golden material variants | 5 |
| Trails (ribbon presets + textures) | 5 |
| KO effects (confetti, sakura petals, pixel burst, bubbles, ember) | 5 |
| Emote clips (Laugh, Cry, ThumbsUp, GG bow, Dance, Facepalm; the 16 clips already have Wave/Cheer) | 6 new |
| Emote stickers (2D, Nano Banana) | 12 |
| UI art (quest board, stamps, Trophy Road pedestals, shop cards, reward card frames, 10 nameplate frames, ~30 profile icons) | ~60 |
| SFX (level up, reward flip, stamp, coin, shop) | ~10 |
| Music (Lyria: result/podium theme, shop loop) | 2 tracks |

### v0.14 "WILD ISLES"
*Promise: a new hunter lurks in the bushes, on a sky map where one push sends you flying.*
- New brawler **Pip & Chomp** (assassin/trapper, full kit).
- New map **Windmill Isles** (void ring-outs, breakable bridges, jump pads, explosive barrels, healing mushrooms, islands crumbling instead of gas).
- Interactive kit pieces also sprinkled on 2 existing maps (barrels on Dunes, jump pads on Oasis).
- Training **Dojo** (sandbox with dummies, gadget tutorials).
- **Art/content production:**

| Asset | Count |
|---|---|
| Rigged character (Pip & Chomp) | 1 |
| Clips (16 standard + Lunge, Plant, Gadget, special BushIdle, Miss) | ~21 |
| Portrait + store art | 2 |
| Decor models: windmill landmark, wooden bridge (whole + broken), jump pad, barrel, island cliff edges ×3, cloud props | ~9 |
| Ground/cliff textures (+ normals) | 2 |
| Straw dummy (rigged, 2 clips) | 1 |
| SFX | ~25 (Pip set 10, map pieces 10, crumble, wind) |
| Music (Lyria: Windmill Isles map theme, accordion + taiko) | 1 track |
| Skybox (cloud sea gradient) | 1 |
| Map preview art (menu card + site) | 2 |

### v0.15 "BETTER TOGETHER"
*Promise: bring a friend: team up, revive each other, and win as a duo.*
- **Duo Showdown** + parties (queue together from a room) + bot partners.
- Buddy Revive, team HUD, tether line.
- New brawlers **Nurse Kappa** (support) and **Mochi** (tank).
- Pings (team only) and an emote wheel.
- **Art/content production:**

| Asset | Count |
|---|---|
| Rigged characters (Kappa, Mochi with a jiggle bone) | 2 |
| Clips (~21 each incl. Lob, Tide, HealBeam, Bump, Leap/Land, Gadget) | ~42 |
| Ghost/revive VFX + halo model | 3 |
| Ping icons | 4 |
| Team HUD art | ~6 |
| SFX | ~25 |
| Barks (two brawler sets + revive lines ×7 brawlers) | ~30 |
| Portraits/store art | 4 |
| Music (Lyria: an upbeat "duo" battle variant) | 1 track |

### v0.16 "GLITCH IN THE SLOP"
*Promise: the game's own AI mascot breaks loose: weekly chaos, a giant boss to beat together, and replays of your best moments.*
- New brawler **Glitch** (trickster, mascot); he fronts the **Weekly Chaos mutators** (Night Hunt, Cube Rain, Big Head, Moon Gravity, Meteor Rain, Gas Breath).
- **Boss Raid: The Slop Kaiju** (co-op PvE, 1-3 humans + bots).
- **Killcam** + auto-captured MVP moment + export to GIF/MP4 (extends `trailer.js`).
- **Art/content production:**

| Asset | Count |
|---|---|
| Rigged Glitch | 1 |
| Clips (~21 incl. Glitch stutter, Decoy, VHS rewind) | ~21 |
| Glyph atlas | 1 |
| Kaiju boss (4× scale, custom rig, 8 clips) | 1 |
| Crate goblins (rigged, 6 clips) | 1 |
| Boss arena variant (textures + 4 props) | 1 |
| Mutator title cards (Glitch-hosted) | 6 |
| Adaptive boss music (3 layers) | 1 |
| Glitch music stinger pack | 1 |
| SFX | ~30 |
| Glitch voice set (vocoded) | 10 lines |
| Killcam UI | ~5 |

### After v0.16 (planned, not scheduled)
v0.17 "KNOCKOUT" (3v3 Knockout, 2 two-way mirrored maps, Hopper + bullet bounce); v0.18 "CALDERA" (elevation engine, rising lava, Slop Grab 3v3, the first Season).

**Total new rigged characters across v0.14-v0.16:** 4 brawlers + boss + goblin + dummy = 7. That's realistic with the local pipeline if each release has 3-4 weeks.

---

## (3) Visual identity for the roadmap page

| Release | Icon | Signature colour | Teaser line |
|---|---|---|---|
| v0.11 IMPACT | 💥 | `#ff4d4f` punch red | "Every hit lands. You'll feel it." |
| v0.12 TOOLBELT | 🧰 | `#fab005` tool yellow | "Pick your trick. Time it. Outplay." |
| v0.13 LEVEL UP | ⭐ | `#7b4dff` slop violet (brand) | "Every match earns something. Everyone sees it." |
| v0.14 WILD ISLES | 🌿 | `#2f9e44` chomp green | "Something bites in the bushes… and the islands are falling." |
| v0.15 BETTER TOGETHER | 🤝 | `#15aabf` duo cyan | "Bring a friend. Bring them back." |
| v0.16 GLITCH IN THE SLOP | 👾 | `#f03e3e` → `#15aabf` split (chromatic) | "The AI got loose. It brought a Kaiju." |
| Later: KNOCKOUT / CALDERA | 🥊 / 🌋 | `#e8590c` lava orange | "Three on three. Then the floor is lava." |

Page design notes: a vertical path (like the Trophy Road) of 6 pedestal cards on the site's dark violet background (`#16121f`, same as the README badges). Each card shows the release's hero figurine (Pip on WILD ISLES, Glitch on GLITCH…) or a key visual, has a coloured glow, and an unlocked/locked state (shipped releases in full colour, future ones as silhouettes, which builds the reveal hype). All teaser lines go into the 30 locales like the rest of the site.

---

## (4) Moonshots

1. **Slop Studio: level editor + UGC maps.** Maps are already ASCII grids (`maps.js`). A drag-and-drop tile editor in the browser, share by link, play in custom rooms, with a weekly "Community Map" in the rotation (curated). The balance checker is a 200-match headless bot sim that runs on submit. It turns players into content creators, and it fits the web-first platform perfectly.
2. **"Prompt-a-Brawler" community contest.** The pipeline *is* the product story: players submit a text concept; the winner is generated live on stream with the real pipeline (image → Hunyuan3D → Blender rig), balanced with Maya, and shipped as an official brawler credited to the player. It's the most on-brand marketing possible for "AI SLOP ARENA".
3. **Slop Shorts: animated micro-episodes.** The rigged figurines + Blender 5.2 + Lyria + ElevenLabs make 30-60 s cartoon shorts (Pip apologising after every bite, Glitch's origin, Mochi's lunch). One per release as the trailer. Shorts/TikTok/YouTube fuel, with story and lore at near-zero cost.
4. **Real figurines + AR.** The characters literally *are* designer-toy figurines. First, a WebXR/Quick Look "put your brawler on your desk" viewer on the site (the GLBs exist: add `usdz` exports). Then 3D-printed/resin figurines of the golden-mastery variants for a community event or merch. The digital → physical loop is the brand's natural endpoint.
5. **Slop Cup + Spectator mode with a "director" camera.** A server-side replay stream (sim events already exist) + a free-cam spectator + an automatic director (cuts to fights, KOs, the bounty). Monthly bot-assisted tournaments (humans + persona bots fill), casted with auto-generated highlight reels. Esports-lite for a small community.
