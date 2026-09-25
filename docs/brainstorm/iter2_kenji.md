# Iteration 2 — KENJI — CROSS-POLLINATE

## (1) Critique of Maya's iteration 1 (feel / content / player-experience lens)

Overall: Maya's diagnosis is right, and it overlaps mine: one mode, no dash, no reason to come back. Her bug #8 (`baseDmg` keyed on `isPlayer`) and her backfill point (#39) are pure wins that cost nothing in fun. Where I push back: about a third of her list is **menus about fun** instead of **fun**. A quest or a level bar only works if each match already feels great. A reward screen with no juice is a spreadsheet.

### High leverage (would feel great; I back them)
- **Duo Showdown with revive (#1).** The best idea on her list for feel. Standing on a ghost for 3 s under fire is a clutch moment by design. To land it needs: a readable ghost (translucent figurine with a halo and a pulsing ring timer), a revive beam VFX, a "REVIVED!" stamp, teammate outline in green (my idea #14), and a distinct duo audio cue. Without the team-colour outline, duo is unreadable: that dependency is critical.
- **Gadgets (#9) and a universal dash (#11).** Same thing as my #12. These are the "outplay button" the game lacks. They must each have a bespoke 0.3 s VFX + SFX signature, or they feel like stat buffs. I prefer "dash is the gadget" for some brawlers (see §3) over giving everyone a generic roll plus a gadget: two buttons on mobile is already the limit (move, attack, super, +1). **The mobile button budget is the hard constraint: max 4 thumb targets.**
- **Supply drop / map events (#15, #16).** High leverage for the match arc. It is also a showcase: a parachute crate with a spotlight beam, a siren, a 5 s shadow on the ground growing = everyone reads it without UI.
- **Bot personalities (#22) with quips.** Love it IF personalities are *visible*: a name tag with a persona icon, speech bubbles ("mine!" when looting), distinct emotes, and each persona prefers one brawler + skin. Otherwise players will never perceive the AI difference. Bots are most players' opponents; bots with character are content.
- **Post-match stats card + MVP awards (#33) and killcam (#34).** Great if staged (podium, figurines, slow-mo). A killcam is also the best teaching tool we have.
- **Weekly Chaos mutators (#7).** Great cheap novelty, and many are pure feel ("big head", "low gravity knockback"). They need a strong title card when the match starts, plus one visual tell per mutator (tint, a HUD badge), so the player notices the rule.
- **Cube rebalance (#21) and a bounty crown on the leader (#20).** I strongly agree, and they combine with my "cubes make you grow" (#6): the leader physically looks like the target. Size = threat = readability.

### Would feel like chores or menus (need reshaping)
- **Daily/weekly quests (#26).** "Break 20 crates" is a chore unless it's framed as a playful bounty board with character (a shopkeeper NPC, stamps on a card). Keep them few (3 a day), always completable by playing normally, never "play brawler X you hate".
- **Brawler unlock path (#27).** With 5 brawlers, locking 2 behind a grind removes 40% of the content on day 1. No. Unlock *skins/gadgets*, never brawlers, until the roster is 10+.
- **Account level + mastery (#25).** Fine, but only if level-ups are an *event*: a figurine bump, a chest opening with a physical box, a new title shown on your nameplate in the next match. A progress bar alone does nothing.
- **Seasons, clubs, tournaments (#28, #37, #38).** Too early for the population. They're retention *multipliers*, not generators. Park them.
- **Slop Royale 16p stitched map (#5).** XL, perf risk on mobile (8 skinned figurines already cost), and it dilutes a small player base. Park it.
- **Procedural quadrant remix (#18).** It saves art cost, but it makes maps *more* samey visually, not less. The feel problem is "every map is the same template". A remix of the same template doesn't fix it. OK as "Map of the Day" only if every remix gets one handcrafted landmark or interactive piece.
- **Gem Grab 3v3 (#2).** Good mode, but needs team maps with symmetric lanes: a new arena layout system. Worth it later. Knockout (#3) gives more feel per effort.

### What her systems need visually and audibly to land (my asks)
- Every new rule needs **one visual tell and one sound**. Revive = halo + chime. Gadget = a coloured flash on the button + a character bark. Supply drop = siren + a light beam. Bounty = a crown mesh + a "wanted" jingle. Hypercharge = a flame aura + distorted music.
- **Nothing should be communicated by text only.** Target: 30 languages and kids on phones.

## (2) Combined ideas (Maya's systems x Kenji's feel/content)

1. **Duo Showdown "Buddy Revive" + team outlines.** Maya's duo + my team-colour toon outline + a ghost figurine you revive with a heal beam. The partner's footprints and pings show as green arrows off-screen. Revive = hitstop + "REVIVED!" + a partner voice bark. **M-L**
2. **Gadget = signature move with its own animation.** Maya's gadgets (#9) are delivered as *one new clip + one VFX + one SFX per brawler*. The rig pipeline already supports new clips (`art-src/rig/clips.py`). Button on mobile = a small round button above the attack stick with charges shown as pips. **M per brawler**
3. **Supply Drop as an arena landmark.** Maya's mid-match event (#15) + my destruction and lighting: a parachute crate falls in a 5 s spotlight, lands with a ground-pound shake, needs 3 hits to open and spills 5 cubes in a fountain. Per-arena theming: a meteor on Dunes, a gift sled on Frost, a bubble on Marsh. **M**
4. **Bounty crown + physical growth.** The cube leader (Maya #20) is scaled by cubes (my #6), wears a gold crown, and is briefly *outlined through walls* every 10 s. KOing them triggers a gold confetti KO, a big bonus-cube burst and a "BOUNTY!" stamp. The hunt becomes visible. **S-M**
5. **Chaos Mutators as visual "remixes".** Maya's weekly mutators (#7) each paired with a render/feel preset: "Big Head" (head bone scale 1.8), "Night Hunt" (night lighting, lanterns only, LightPool shine), "Moon Gravity" (knockback x3 + floaty jump arcs), "Meteor Rain" (Bomber meteors from the sky), "Slop Glitch" (random glitch tiles + chromatic aberration + my Glitch brawler's decoys everywhere). Title card + unique music stinger per mutator. **S each**
6. **Bot personas = cast of AI-slop characters.** Maya's personalities (#22) with persona names, persona skins/colour and quips as speech bubbles + gibberish voice (my #31). "Vulture" bots wear a buzzard hat and laugh when they third-party you. **M**
7. **Progression rewards are cosmetics you see in-match.** Maya's account level/mastery (#25) unlocks *my* content: skins, projectile trails, KO effects (confetti, sakura, pixel-burst), victory dances, emotes, nameplate titles. Every reward must be visible to other players in the match. Mastery max = a golden figurine variant. **L**
8. **Mode x arena playgrounds.** Maya's Hot Zone (#6) or Knockout (#3) on dedicated arenas with interactive kits: Hot Zone on "Candy Factory", where the zone rides a conveyor belt, and Knockout on "Sky Islands", where ring-out edges end rounds with falls. Each mode gets a signature map where its rule + the map mechanic multiply. **L per pair**
9. **Weather events as visual set-pieces.** Maya's mid-match weather shifts (#16) staged with my tech: Grove lightning telegraphs as a glowing rune on the tile 1.5 s before (existing `bolt()`), Frost blizzard whitens the screen edges and adds snow crust on figurines, Dunes gust pushes with visible sand waves and a wind SFX swell. **M**
10. **Killcam + MVP podium = shareable moments.** Maya's killcam (#34) + my result-screen show (#34) + `trailer.js` recorder: auto-capture of your best 5 s (highest damage burst or last kill), shown on the podium, one tap to export a GIF/MP4. That's virality from gameplay. **L**
11. **Hypercharge "Slop Mode" as a transformation.** Maya's hypercharge (#12) becomes a 5 s visual *transformation*: the figurine gets an emissive overlay, grows 15%, leaves afterimages, its music layer switches to a distorted remix, and its super gets a unique screen-space effect. It's the power fantasy moment. **M**
12. **Training Duel = "Figurine Dojo".** Maya's 1v1 training (#8) as a diorama arena with target dummies that show damage numbers, dash/gadget tutorial, and the photo-mode camera (my #36) unlocked there. Onboarding and a sandbox for feel testing. **M**
13. **Boss Brawl with a Hunyuan giant.** Maya's PvE (#4): a 4x-scale boss figurine (e.g. "The Slop Kaiju", a melted mashup of all 5 brawlers) with a telegraphed attack language (red ground decals, wind-ups, weak-point glow). A perfect stage for hitstop/shake/juice and for AI-art showcasing. **L-XL**
14. **Pings and emotes = figurine reactions.** Maya's emote wheel (#31) drives clips on the figurine (wave, laugh, cry, thumbs up) + a sticker bubble above the head. It works in solo with bots too: bots answer emotes with persona-flavoured ones. **M**

## (3) Re-think of my own list

- **Drop / park:** #35 killcam (merged into combined #10 with Maya), #36 standalone photo mode (merged into the Dojo, #12), #28 "5 new arenas" as one XL block (split: one playground arena per new mode instead), #16 interactive grass (nice but low gameplay value per effort; keep only the water ripples).
- **Merge:** #12 dash + Maya #9/#11 -> "signature mobility gadget" per brawler (below). #6 cube growth + Maya #20/#21 -> bounty/growth. #29 map events + Maya #15 -> supply drop. #32 HUD + #33 off-screen pings -> one HUD readability pass.
- **Upgrade:** #14 toon outline becomes a **prerequisite** for any team mode (team colours). #13 super cinematic becomes more important with Hypercharge. #30/#31 audio gets a per-mode/per-mutator stinger set. #25 hero-model pass now also targets a "silhouette-first" rule: each brawler must be recognisable as a 32 px black silhouette.

### Refined kits: 5 existing brawlers get a gadget (mobile: 1 extra button)
| Brawler | Gadget (3 charges) | Feel note |
|---|---|---|
| Blaster | **Root Charge**: 4 m shoulder dash, roots whoever it bumps for 0.6 s | heavy stomp dust, wooden crack SFX |
| Gunslinger | **Tail Roll**: quick combat roll with 0.2 s i-frames, auto-reloads 1 ammo | afterimage, spin whoosh |
| Bomber | **Lava Hop**: rocket jump over one wall, leaves a burning puddle | first real airtime in the game: shadow + landing squash |
| Frostbite | **Ice Wall**: a 3-tile ice wall for 3 s (blocks shots and sight) | crystal grow VFX, shatter on expiry |
| Volt | **Blink**: 5 m teleport, leaves a zap trap for 2 s | pixel dissolve / reform, a synth zip |

### Refined new brawler concepts (5)
1. **Mochi: Tank / wall-breaker.** Look: a squishy rice-cake seal in a sumo mawashi with a tiny chef hat; jiggle shader. *Attack:* belly-bump jelly shockwave, a short cone (3 m) with light knockback; 4 ammo, fast. *Super:* **Mochi Pound**, a real leap (1.1 s airtime, targeted like a thrower) landing in a 4 m radius: pancake-squash stun 1 s, breaks walls. *Gadget:* **Sticky Mochi**, turns into a sticky blob for 2 s (−60% damage taken, can't shoot; enemies touching it are slowed). *Role:* frontline, bush-clearer, counters Blaster/assassins. HP 7000, speed 5.6.
2. **Pip & Chomp: Melee assassin / trapper.** Look: a mushroom kid riding a carnivorous-plant pet. *Attack:* Chomp lunges 4 m and bites (the brawler moves with it: a melee dash-attack), 2 ammo, high damage. *Super:* **Venus Trap**, plants a hidden trap-bush that bites and roots anyone who walks in, reveals them for 3 s, and counts as a bush for hiding. *Gadget:* **Spore Puff**, a 3 m cloud of spores that hides everyone inside like a bush for 3 s. *Role:* bush ambusher, punishes campers and low-HP stragglers. HP 3800, speed 6.8.
3. **Glitch: Trickster / mascot of the game.** Look: a half-rendered chibi of corrupted voxels with floating UI windows and a cursor hand; its texture "melts" like bad AI art (extra fingers gag). *Attack:* "prompt tokens", glyph projectiles that split in 3 on a wall hit (bank shots), 3 ammo. *Super:* **Hallucinate**, 2 decoy clones that run and shoot harmlessly for 4 s while the real Glitch is 50% transparent. *Gadget:* **Ctrl+Z**, rewinds Glitch to where it was 2 s ago (position and HP), with a VHS rewind effect. *Role:* mind-games skirmisher, a marketing hero. HP 3300, speed 6.6.
4. **Nurse Kappa: Support / zone control.** Look: a kappa nurse with a water bowl on its head and a bubble-gun syringe. *Attack:* bubble lob (over walls) that damages, and heals Kappa (solo) or allies (duo/3v3) in the splash; 3 ammo. *Super:* **Tidal Wave**, a wall of water sweeping 10 m forward: it pushes enemies, puts out fire/lava puddles and clears gas from its path for 3 s. *Gadget:* **Bowl Splash**, spills the head bowl: a heal puddle for 3 s, and Kappa is weakened (−20% speed) while the bowl is empty. *Role:* sustain/support; the reason to play Duo. HP 3600, speed 6.2.
5. **Hopper: Mobility skirmisher / bank-shot specialist.** Look: a frog courier on roller skates with a messenger bag. *Attack:* a slingshot of 2 pebbles that bounce once off walls, 3 ammo, mid range. *Super:* **Triple Hop**, 3 chained hops over walls (untargetable in the air), each landing is a small shockwave. *Gadget:* **Skate Boost**, +60% speed for 2 s with momentum drift (ice-like handling). *Role:* hit-and-run, cube thief, gas-runner. HP 3200, speed 7.0.

(Counter web: Mochi > Blaster/Pip; Pip > Bomber/Kappa; Glitch > Gunslinger (decoys waste the burst); Kappa > Frostbite (cleanses slow in the splash); Hopper > Mochi (kite) and < Volt (chain on landing).)

## (4) My current top 15

1. **Hitstop + victim squash + hit-confirm pitch ladder**: the cheapest, biggest win for "my shots matter". (S-M)
2. **Trauma camera shake + aim look-ahead + endgame zoom**: the camera is half of game feel, and today it is static. (S)
3. **Audio pass 2.0 (per-brawler SFX, footsteps, reload, KO stinger, gibberish barks)**: audio is about 50% of feel and sits at about 15% now. (M)
4. **Toon outline + team colours + readability pass (bigger weapons, contrasting palettes)**: a prerequisite for any team mode and for 8-player chaos. (M)
5. **Signature gadget per brawler (mobility for most)**: the missing outplay button; merges Maya's gadget and dash. (M-L)
6. **Super cinematics (wind-up, punch-in, portrait slash, enemy telegraph)**: supers should be the dopamine peak. (M)
7. **KO moment (slow-mo, launch, K.O. stamp, kill feed; final-kill orbit cam)**: kills are the story beats of a match. (M)
8. **Duo Showdown with Buddy Revive (with Maya)**: turns "play with a friend" into shared clutch moments. (M-L)
9. **Cube growth + bounty crown + cube rebalance (with Maya)**: the leader looks like the target, which fixes both snowball and readability. (S-M)
10. **Supply drop / themed mid-match events (with Maya)**: gives the flat mid-game a magnet and a spectacle. (M)
11. **Two new brawlers first: Mochi (tank) and Glitch (mascot)**: they fill the biggest role hole, and Glitch sells the brand. (L each)
12. **Interactive arena kit (jump pads, explosive barrels, geysers), one or two per map**: turns reskins into playgrounds. (L)
13. **Visible cosmetic progression (skins, trails, KO effects, emotes) driven by Maya's levels**: rewards other players can see, which is the retention engine. (L)
14. **Bot personas with visible personality (with Maya)**: most matches are against bots, so bots must be characters. (M)
15. **Result podium + auto-captured best moment + stats card (with Maya's MVP awards)**: ends every match on a high and makes clips people share. (M-L)

## (5) Open questions for Maya

1. **Button budget on mobile.** Your list has a universal dash AND gadgets AND hypercharge. I say max 4 thumb targets: move, attack, super, gadget. For most brawlers the dash *is* the gadget, and hypercharge is automatic (no button). Can your balance model live with "mobility only for some brawlers, via gadget", instead of a universal roll?
2. **Unlocks: brawlers or cosmetics?** I push back on locking brawlers with a roster of 5 (#27). Would you accept "all brawlers free forever; progression unlocks gadget #2, skins, trails and titles", and brawler unlocks only once we have 10+?
3. **Which second mode first: Duo Showdown or a 3v3 (Knockout/Hot Zone)?** Duo reuses maps and gets the revive drama with little map work. 3v3 needs new symmetric maps but gives more feel per round. With the population risk you flagged, is Duo (which also queues faster with friends and fills with bots) the right first bet, and does your MMR/backfill design support 2-person parties?
