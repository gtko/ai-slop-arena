# AI SLOP ARENA — Final roadmap (v0.11 → v0.16, then Later)

Gameplay roadmap from a 5-iteration brainstorm between two gameplay specialists: MAYA (systems) and KENJI (feel, content, art).
The iterations are in [brainstorm/](brainstorm/); backlog IDs refer to [iter4_maya.md](brainstorm/iter4_maya.md) §1.
The public page is `/roadmap` (roadmap.html, data in src/site/roadmap.json).

## Vision (3 lines)
A cute, fair and loud little brawler where every hit crunches and every match earns you something.
Five minutes to learn and a season to master, alone against characterful bots or with a friend.
Built in the open by an AI pipeline, and proud of it: new brawlers, arenas and chaos arrive every release.

## Design pillars
1. **💥 Every hit is felt.** Hitstop, shake, sound and haptics on every confirmed hit; nothing important happens silently.
2. **⚖️ Fair by design.** The server decides everything. Line of sight is law ("if you can't see them, you can't see their juice"). No pay-to-win, ever; all brawlers are free.
3. **👀 Readable chaos.** You identify friend, foe and threat in under 200 ms. Every rule has one visual tell and one sound, and nothing is told by text only (30 languages, kids on phones).
4. **🎁 Always a reason to play again.** Every match advances something, and something new rotates in every week.
5. **🤝 Great with bots, better with friends.** Bots are a cast of characters, not filler; and friends get a mode made for them.

## Decisions (arbitration between the two phasings)

| # | Topic | Maya | Kenji | Decision and why |
|---|---|---|---|---|
| D1 | v0.11 content | Feel + fairness + backfill | Feel + audio + readability + riders | **Same release, merged: IMPACT.** Both agree; the fairness fix (F01) and the 60 s backfill (F02) ride along because they protect every later metric. |
| D2 | Where progression goes | v0.12 with gadgets | v0.13 LEVEL UP | **Split.** The *mastery core* (mastery points + levels + ceremony) ships in v0.12 because it gates gadget B and star power 2. Shipping them all unlocked and gating them later would take something away from players. The *rest* (account levels, quests, Bot League, cosmetics, shop, podium) is v0.13 LEVEL UP, where Kenji's "no reward without a ceremony" gets a full release. |
| D3 | Event Deck timing | v0.14 | v0.12 (Supply Drop + 5 themed cards) | **Engine + Supply Drop + Bounty Crown in v0.12** (Kenji's "something you notice in the first 10 s" and the mid-game fix). **Themed map cards + weekly mutators in v0.13**, because they're the weekly retention engine that pairs with quests. Glitch becomes the host of new mutators in v0.16 rather than the start of them. |
| D4 | Duo timing | v0.13 | v0.15 | **v0.14, before WILD ISLES.** Duo reuses the 5 maps and is the cheapest new mode. It's also the social multiplier for a small population (a party = 2 guaranteed humans per match). WILD ISLES carries the heaviest art load (1 map + ~9 decor models + 2 characters) and gets the extra pipeline lead time. |
| D5 | Which brawlers with which release | Pip, Glitch first; Kappa/Mochi with Duo | Pip v0.14, Kappa + Mochi v0.15, Glitch v0.16 | **Kappa with Duo (v0.14)**, since she's the reason to play Duo. **Pip & Chomp + Mochi with WILD ISLES (v0.15)**: Mochi is the ring-out king and Pip the bush hunter, both Showdown-native. **Glitch v0.16** as the face of the chaos release. One or two characters per release, pipeline-paced. |
| D6 | Pip & Chomp numbers | 2 ammo × 1100 | lunge magnetism, maybe 3 × 800 | **3 ammo × 800 + server-side ±15° lunge magnetism within 4.5 m + a funny "Miss" animation.** Same DPS, less whiff frustration at 100 ms ping. |
| D7 | Mochi | stun 0.8 s, Heavyweight = knockback immunity | Heavyweight −50% knockback | **Stun 0.8 s kept; Heavyweight = −50% knockback** (launching the seal off a cliff must stay possible). HP 6800, +250 HP per cube. |
| D8 | Gadget model | Mobility A / utility B | adopted A/B | **A/B, 4 thumb targets max.** Every CC-immunity bounce shows an "IMMUNE" tell; star powers get a pulsing star icon when they trigger. |
| D9 | Mode gating | Knockout at account level 3 | grandfather veterans | **Gate new modes at a low level, but grandfather anyone with ≥ 20 matches.** Ranked needs account level 8 + mastery 4 on the brawler used. |
| D10 | Sand Gust | 2 m/s push | never toward gas, cap, telegraph | **1.5 m/s, never toward the next gas ring, 2 s sand-wave telegraph.** |
| D11 | Knockout / Slop Grab / Seasons / Hopper / Caldera | v0.15-v0.16 | after v0.16 | **Later.** Knockout needs new two-way maps, Caldera needs an elevation engine, and seasons need a ranked population. Six releases stay each "visibly new" and within pipeline capacity. |
| D12 | Off-screen gunfire arc (G09) | kill switch | playtest | **Playtest in v0.11 behind a server flag; cut if bush KOs drop > 20%.** |

## Releases

### v0.11 💥 IMPACT — colour `#ff4d4f`
**Teaser:** "Every hit lands. You'll feel it."
**Promise:** Every shot you land and every KO you score, you feel it in your hands and ears, and you're in a match within a minute.
**Headline features:** two-stage hit confirm + hitstop + squash; trauma camera + look-ahead + endgame zoom; KO beat + final-KO slow-mo; per-brawler audio and barks; team/self outline colours + readability pass; kill feed and "3 LEFT"; bots fill matchmaking after 60 s.
**Items:** F01, F02, F03, F04, G01, G02, G03, G04, G05, G06, G08, G09 (flagged), V01, V04 (core presets: hit spark/disc, KO stamp, launch arc, decal layer), V05, U01, U02 (barks + surface footsteps, both LoS-gated), T01.
**New brawlers / maps:** none (polish release on the same content, so we can measure the before/after).

**Art/content production:**

| Asset | Count |
|---|---|
| SFX | ~70 |
| Voice-bark sets (5 brawlers × 6 lines) | 30 |
| Eye-expression atlases | 5 |
| Texture recolour/contrast passes + weapon ×1.25 | 5 |
| VFX textures | 6 |
| UI art (KO stamp, kill feed, banners, vignette) | ~10 |
| Lyria stingers | 3 |

**Success metrics:**
- Survey fun rating +0.4 vs v0.10.
- Matches per session +15%.
- Median queue time ≤ 60 s; `mm_search_cancelled` −50%.
- `match_abandoned` −20%.
- Mobile p10 fps not below v0.10.

### v0.12 🧰 GADGETS — colour `#fab005`
**Teaser:** "Pick your trick. Time it. Outplay."
**Promise:** Your brawler has a trick up its sleeve now: pick it, time it, and outplay. Crates are no longer the only loot: supply drops fall from the sky.
**Headline features:**
- 10 gadgets (mobility or utility) + 10 star powers on the 5 brawlers.
- Telegraphed area supers + CC immunity.
- Mastery 1-10 per brawler with a ceremony (it unlocks gadget B at 2 and star power 2 at 4).
- Bots 2.0 (dodge, retreat to heal, use gadgets and supers smartly).
- **Training Dojo** (moved from v0.15 in review): dummies + DPS readout + a try-out of every gadget, since gadgets launch here.
- Supply Drop + Bounty Crown + cube rebalance.
- Mobile LODs.

**Items:** K01, K02, K03, G07, V04 (gadget/telegraph presets), P02 (core), B01, A01, A02 (engine + Supply Drop), F05, V02, S01 (stat cards), M05.
**New brawlers / maps:** none. It's the same 5 brawlers, now with ~20 playstyles.

**Art/content production:**

| Asset | Count |
|---|---|
| Animation clips | ~10 |
| VFX presets (gadgets, telegraphs, crown aura, x-ray bounty silhouette, supply drop) | ~16 |
| SFX | ~30 |
| Gadget barks | ~10 |
| Gadget/SP icons | 20 |
| 3D models: supply crate (1 base + 5 themed textures), crown, straw dummy (static mesh, procedural wobble on hit: no rig) | 3 |
| Super cinematic art: 5 portrait-slash cut-ins (reuse the portrait renders) | 5 |
| UI (gadget button with pips and lockout, lobby loadout cards, mastery card) | ~10 |

**Success metrics:**
- D7 retention +5 pts.
- `gadget_used` (new) ≥ 2 per match.
- No brawler > 35% pick share.
- Every gadget/SP within ±0.5 average rank of its sibling.
- `mastery_up` (new) ≥ 1 per 4 matches for new players.

### v0.13 ⭐ LEVEL UP — colour `#7b4dff`
**Teaser:** "Every match earns something. Everyone sees it."
**Promise:** Every match earns you something: levels, quests, trophies, and looks everyone can see, plus a new twist on the arenas every week.
**Headline features:**
- Account levels with a ceremony.
- 3 daily quests on a cork board + a weekly quest.
- Bot League trophies + Trophy Road, for players who play against bots.
- Slop Coins (earned only by playing) + a rotating cosmetic shop.
- Cosmetics wave 1: recolours, trails, KO effects, golden figurines, 12 emotes, frames, titles.
- Result podium with MVP awards.
- **The original 5 remastered** (V03 hero pass: remesh, 2048 bakes, eye atlas), produced with the recolour skins.
- Themed arena events on the 5 maps: meteor shower, lightning rod, blizzard, fog bank + mushrooms, geysers.
- **Weekly Chaos mutators** begin.
- Bot personas with icons and speech bubbles.

**Items:** P01, P03, P04, P05 (wave 1), A02 (themed cards), A04 (geysers/mushrooms as cards), A05, B02, S03 (emote wheel; pings come with Duo).
**New brawlers / maps:** none. The world gets livelier.

**Art/content production:**

| Asset | Count |
|---|---|
| Hero remaster of the original 5 (remesh + 2048 bakes) | 5 |
| Recolour atlases | 5 |
| Golden variants | 5 |
| Trails | 5 |
| KO effects | 5 |
| Emote clips | 6 new |
| Emote stickers | 12 |
| UI (quest board, stamps, Trophy Road pedestals, shop, reward cards, 10 frames, ~30 profile icons) | ~60 |
| Event props (mushroom, geyser vent, lightning rod) | 3 |
| Event VFX | 5 |
| Persona icons | 6 |
| Persona barks | ~30 |
| SFX | ~20 |
| Lyria tracks (podium, shop) | 2 |
| Mutator title cards | 5 |

**Success metrics:**
- Weekly returning users +10%.
- `quest_completed` (new) ≥ 1.5/day per DAU.
- Cosmetic equip rate ≥ 40% of players with an unlock.
- Share of solo players with Bot League changes ≥ 60%.
- KOs in the 30-80 s window +25% (events work).

### v0.14 🤝 BETTER TOGETHER — colour `#15aabf`
**Teaser:** "Bring a friend. Bring them back."
**Promise:** Bring a friend: queue together, revive each other, and win as a duo, with a nurse who keeps you both alive.
**Headline features:**
- **Duo Showdown** (4 teams of 2) with Buddy Revive: a ghost for 15 s, a 3 s channel, 2 heart pips per team.
- Queue with a friend (parties).
- Bot partners.
- Team HUD + tether line.
- Pings.
- New brawler **Nurse Kappa**.

**Items:** M01, T02, K06, S03 (pings), duo-mate bot behaviour (B02), RP_BY_RANK for duo.
**New brawlers:** Nurse Kappa. **New maps:** none (Duo runs on the 5 arenas with paired spawns).

**Art/content production:**

| Asset | Count |
|---|---|
| Rigged character (Kappa) | 1 |
| Clips | ~21 |
| Ghost/halo/revive-beam VFX | 3 |
| Ping icons | 4 |
| Team HUD art | ~6 |
| SFX | ~15 |
| Barks (Kappa set + "Thanks!" revive lines ×6) | ~20 |
| Portrait + store art | 2 |
| Lyria duo battle variant | 1 |

**Success metrics:**
- Share of matches with ≥ 2 humans +50%.
- Duo queue ≤ 45 s.
- `revive` (new) ≥ 0.8 per duo match.
- D30 of players with ≥ 1 party match vs. none.
- Kappa pick share 10-25%.

### v0.15 🌿 WILD ISLES — colour `#2f9e44`
**Teaser:** "Something bites in the bushes… and the islands are falling."
**Promise:** A new hunter lurks in the bushes, a sumo seal crashes the party, and on a sky map one push sends you flying.
**Headline features:**
- New brawlers **Pip & Chomp** (melee assassin / trap-bush) and **Mochi** (tank, leap-slam).
- New map **Windmill Isles**: void ring-outs, breakable bridges, jump pads, explosive barrels, healing mushrooms, and islands that crumble instead of gas.
- Interactive pieces on 2 existing maps (barrels on Dunes, jump pads on Oasis).
- Footstep dust/prints, own-bush parting, water ripples, chunked wall destruction (V07, V08).

**Items:** K04, K07, A03, A04 (barrels/jump pads), V07, V08.
**New brawlers:** Pip & Chomp, Mochi. **New maps:** Windmill Isles.

**Art/content production:**

| Asset | Count |
|---|---|
| Rigged characters (Pip & Chomp, Mochi with a jiggle bone) | 2 |
| Clips | ~42 |
| Portraits/store art | 4 |
| Decor models (windmill, bridge whole/broken, jump pad, barrel, 3 cliff edges, clouds) | ~9 |
| Ground/cliff textures | 2 |
| Skybox | 1 |
| SFX | ~35 |
| Lyria map theme (accordion + taiko) | 1 |
| Map preview art | 2 |

**Success metrics:**
- Ring-out share of KOs on Isles 10-25%.
- Isles mobile fps ≥ other maps.
- Pip/Mochi pick share 10-30% and placement within 40-60% (T01 gate).
- Pip/Mochi produced at hero spec (2048 bake, LOD0-2) from day one: no "old vs new" quality gap.

### v0.16 👾 GLITCH IN THE SLOP — colours `#f03e3e` → `#15aabf`
**Teaser:** "The AI got loose. It brought a Kaiju."
**Promise:** The game's own AI mascot breaks loose: new chaos every week, a giant boss to beat together, and replays of your best moments.
**Headline features:**
- New brawler **Glitch** (decoys, Ctrl+Z, bank-shot glyphs).
- Glitch hosts the Chaos mutators, with new ones: Big Head, Moon Gravity, Slop Glitch.
- **Boss Raid: The Slop Kaiju** (co-op PvE for 1-3 humans + bots, 3 phases, crate-goblin minions).
- **Killcam** + auto-captured MVP moment + GIF/MP4 export.

**Items:** K05, M03, S02, A05 (new cards), V06 (stylised gas).
**New brawlers:** Glitch. **New maps:** Kaiju arena (a variant with an open centre).

**Art/content production:**

| Asset | Count |
|---|---|
| Rigged Glitch | 1 |
| Clips | ~21 |
| Glyph atlas | 1 |
| Kaiju (4×, custom rig, 8 clips), **pre-produced during the v0.15 cycle** (model + rig start one release ahead) | 1 |
| Crate goblins: the existing crate prop + eyes/legs decal, procedural hop/wobble animation (no rig) | 1 |
| Boss arena variant (textures + 4 props) | 1 |
| Mutator title cards | 3 |
| Adaptive 3-layer boss music | 1 |
| Glitch stinger pack | 1 |
| SFX | ~30 |
| Glitch voice lines | 10 |
| Killcam UI | ~5 |

**Success metrics:**
- Co-op ≥ 15% of matches.
- Raid clear rate 35-60%.
- Killcam watch-through ≥ 50%.
- Exported clips per 100 matches ≥ 2.
- Survey rating stable or up.

## Later (planned, not scheduled)
- 🥊 **KNOCKOUT**: 3v3 best-of-3 rounds on two new two-way-mirrored maps, and **Hopper** (frog courier, bank shots with bullet bounce).
- 🌋 **CALDERA**: an elevation engine (height-aware LoS), rising lava instead of gas, **Slop Grab** 3v3.
- 🏆 **Seasons**: ranked soft reset, seasonal titles/frames, a seasonal mutator map.
- 🦀 **Clawdia** (hermit crab turret builder) and ☁️ **Nimbus** (charge-shot cloud sheep).

## Moonshots (merged, 6)
1. **Slop Studio**: a tile level editor in the browser, share by link. A headless bot-sim fairness check (200-500 matches) gates publishing, and a curated "Community Map of the Week" joins the rotation.
2. **Prompt-a-Brawler / Prompt-your-Skin**: a community contest where the winning concept is generated live with the real pipeline and shipped credited. Later, moderated AI skins (cosmetic, on existing rigs).
3. **Slop Story**: a 30-stage offline PvE campaign (scripted bots + mutators, a boss every 10), narrated by the brawlers.
4. **Slop Cup + Director Cam**: server replays from the sim's events, a spectator free-cam with an automatic "director", monthly tournaments with bot fill, auto highlight reels.
5. **Your Bot Twin**: an opt-in, clearly labelled bot that learns your style and plays in other people's bot-filled matches. Your profile shows its wins.
6. **Figurines IRL + AR**: "put your brawler on your desk" (WebXR / Quick Look from the existing GLBs), then resin prints of golden-mastery figurines.

## Risks & guardrails
- **Balance surface explodes** (10 gadgets, 10 SPs, 4 brawlers): T01 bot tournaments in `npm test` + a PostHog dashboard. A release gate is that every brawler/gadget places within 40-60%; there's a monthly balance patch.
- **Mobile performance** (new skinned characters, VFX, events): the LODs (V02) land before the first new brawler. Budget: ≤ 160k skinned tris, ≤ 600 particles, p10 fps ≥ 30 at mobile medium, checked each release via `match_performance`.
- **Netcode fairness**: all time effects are client-cosmetic; the sim never pauses. Airborne arcs and dashes are server-simulated; gadget/event effects are authoritative with telegraphs. Late-join snapshots include active events.
- **Information leaks**: the `fxVisible` gate (F04) for every effect/sound; the noise arc (G09) behind a flag.
- **Population split**: at most 2 public queues (Showdown + one featured mode), bot backfill at 45-60 s, parties guaranteeing humans.
- **Pay-to-win drift**: power unlocks only by play and short (mastery 2/4); coins earned only by play; any paid offer is cosmetic only.
- **Pipeline capacity**: at most 2 new rigged characters per release (~2-3 days machine + cleanup each); art production starts one release ahead.
- **Crash/quality**: Sentry crash-free sessions ≥ 99.5%; reports per match not rising.

## Sign-off — KENJI (feel / content / art lead)

**Verdict: approved, with the edits below.** The phasing order is right: feel first, then depth, then progression, then content. I concede that Duo comes before WILD ISLES and that Kappa ships with Duo. None of my core items were lost: G01-G08, V01-V08 and U01-U02 are all placed.

**What I changed (roadmap_final.md):**
1. **v0.11**
   - Added V04 *core presets* (hit spark/disc, KO stamp, launch arc, decal layer). G03/G04 cannot ship without them, and v0.12 was the first release to carry V04.
   - U02 is now in full: surface footsteps join the barks. Footstep audio is cheap, LoS-gated, and half of "you'll feel it".
2. **Training Dojo (M05) moved from v0.15 to v0.12.** Gadgets launch in v0.12, and that is when players need somewhere to try them. It also lightens v0.15, the heaviest art release. The straw dummy becomes a **static mesh with a procedural wobble** (no rig).
3. **v0.12 art:** added the 5 super-cinematic cut-ins (portrait slash, from the existing portrait renders). G07 was listed without its art.
4. **v0.15**
   - The V07/V08 world-reaction items (footsteps, prints, ripples, chunked walls) are listed as headline features, so the art load is explicit.
   - Replaced the Dojo metric with a hero-spec rule: new brawlers are produced at 2048 bake + LOD0-2 from day one, so there is no quality gap next to the originals.
5. **v0.16 had 3 rigged characters** (Glitch + Kaiju + goblins), which breaks our own "≤ 2 per release" guardrail.
   - The Kaiju is now **pre-produced during the v0.15 cycle**.
   - The crate goblins reuse the crate prop with a procedural hop (no rig).

**What I changed (roadmap.json, French player texts):** validated with `JSON.parse`. The file is re-serialised at 2-space indent, and a new optional field `color2` was added on v0.16 for the red→cyan gradient.
- **Terms aligned with the shipped French locale** (`src/i18n/locales/fr.json`): "Showdown" → **"Survivant"**. The map names are now "Tempête des dunes", "Bosquet pluvieux", "Pic gelé" and "Marais brumeux", instead of "les Dunes", "le pic"…
- **Accuracy**
  - Kappa's wave "balaie tout, même le gaz" became "chasse le gaz un court instant" (the real rule: a 2 s lane).
  - The revive text states "deux fois par partie".
  - The raid text states that it works solo with 2 bots.
  - CC immunity now mentions roots too.
- **Jargon removed:** "Killcam" → "Revois ton K.O."
- **Tone**
  - The vision said "juste et bruyant" ("bruyant" reads as a flaw in French); it is now "loyal et explosif".
  - The fairness pillar said "ce que tu ne vois pas ne te trahit pas" (unclear); it is now "personne ne voit à travers les murs : ce qui est caché reste caché".
  - v0.12 teaser: "Choisis ton gadget. Sors-le au bon moment. Renverse le combat."
- **Tutoiement:** "faites la queue ensemble" (it sounded like waiting in line) became "lancez la partie ensemble / relève-le". "vous" is kept only where it addresses the duo as a pair.
- **Roles**
  - Hopper "Harceleur" (it means harasser/stalker in French) → "Voltigeur".
  - Nimbus "Tireur d'élite" collided with Gunslinger's existing role → "Sniper".
- **Highlights:** Dojo highlight moved to v0.12. v0.15 gained "Des arènes qui réagissent" (V07/V08). Pip's text now says who does what: Chomp bites, Pip apologises and plants traps. The footsteps are mentioned in v0.11 audio.

**Remaining dissent (for the user to arbitrate):**
1. **The V03 hero pass on the original 5 is in "Later",** but P05 cosmetics (v0.13) lists V03 as a dependency, and the new brawlers from v0.14 onwards will look better than the originals. I'd pull at least the **eye-expression atlas + weapon ×1.25 + recolour into v0.11** (already in its art list) and the **full remesh/2048 bake of the original 5 into v0.13**, alongside the recolour skins (they're produced from the same atlases).
2. **The v0.12 English name is GADGETS but the page says GADGETS.** GADGETS is clearer for French players; I'd use GADGETS everywhere (one name, one release).
3. **Mochi keeps a 0.8 s stun.** I accept it with CC immunity and the −50% knockback Heavyweight. I still believe a no-stun Mochi is more fun to play against; revisit if the T01 data shows Mochi above 55% top-4.

## Final arbitration (orchestrator)
1. **Hero pass on the original 5 → v0.13 LEVEL UP.** Kenji is right: the v0.13 cosmetics depend on it and the new brawlers would outshine the originals. The eye atlas, weapons ×1.25 and readability recolours stay in v0.11.
2. **v0.12 is GADGETS everywhere** (markdown, page, release notes).
3. **Mochi's 0.8 s stun stays**, with CC immunity and the −50% knockback Heavyweight; revisit if Mochi finishes top 4 in more than 55% of matches (T01 dashboard).
4. **Concept art for the 7 new brawlers** was generated with the existing pipeline (`art-src/ai3d/char_images.py`, action pose) for the public roadmap page; Pip's cap was changed to a lavender bell cap because the first render read too close to an existing mushroom character.
