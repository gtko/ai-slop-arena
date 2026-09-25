# Iteration 4 — MAYA — PRIORITIZE

Scoring: **Fun** 1-5 (moment-to-moment enjoyment), **Ret** 1-5 (reason to come back), **Effort** S (<1 d) / M (2-4 d) / L (1-2 wk) / XL (>2 wk), **Risk** 1-5 (tech + balance + mobile perf, 5 = worst). Deps = IDs.
ID prefixes: **F** fairness/foundation, **G** game feel, **V** visuals/3D, **U** audio, **K** kit & brawlers, **A** arenas & events, **M** modes, **P** progression, **B** bots, **S** social/UX, **T** tooling/telemetry.

## 1. Consolidated backlog (48 items)

| ID | Item | Owner lens | Fun | Ret | Effort | Risk | Deps |
|---|---|---|---|---|---|---|---|
| F01 | Damage fairness fix: `baseDmg` keyed on `human`, not `isPlayer` (host +15% on Steam lobbies; online humans at 0.85) + regression test | Maya | 2 | 2 | S | 1 | – |
| F02 | Matchmaking backfill: auto bot-fill at 60 s (45 s duo) instead of 5 min; late-human drop-in replaces a bot in the first 10 s | Maya | 2 | 5 | S-M | 2 | – |
| F03 | Hard-CC immunity (1.5 s after ≥0.5 s stun/root/freeze) | Maya | 3 | 2 | S | 2 | – |
| F04 | "If you can't see them, you can't see their juice" gate: `fxVisible(b)` for every brawler-spawned effect/sound | both | 2 | 1 | S | 1 | – |
| F05 | Match seed in `start` message + deterministic event RNG (enables Event Deck, killcam, tests) | Maya | 1 | 1 | S | 2 | – |
| G01 | Hitstop + victim squash, two-stage confirm (predicted graze / authoritative hit), lag-scaled | Kenji | 5 | 3 | M | 2 | F04 |
| G02 | Trauma camera shake + aim look-ahead + endgame zoom + smooth spectate slide | Kenji | 4 | 2 | S | 1 | – |
| G03 | Hit-confirm layer: directional sparks, merged/counting floaters, crit last bolt, pitch ladder | Kenji | 4 | 2 | S | 1 | G01 |
| G04 | KO beat (zoom punch, launch arc, K.O. stamp) + final-KO render slow-mo + orbit cam | Kenji | 5 | 3 | M | 2 | G01 |
| G05 | Input buffer (120/200 ms) + touch soft-snap aim + haptics (Capacitor/gamepad) | Kenji | 4 | 2 | S-M | 2 | – |
| G06 | Low-HP state + readable regen (3 s ring timer, heartbeat, limp/sweat) | both | 3 | 2 | S | 1 | F04 |
| G07 | Super cinematics: caster punch-in/portrait slash; server-real telegraphs for area supers only (nova 200 ms, storm 300 ms, meteor shadow) | both | 5 | 3 | M | 3 | F03 |
| G08 | Diegetic HUD: ammo snap, liquid super button, kill feed with portraits, "3 LEFT/FINAL DUEL", gas-ring floor telegraph, offscreen arrows (seen <2 s) | Kenji | 4 | 2 | M | 1 | – |
| G09 | Off-screen gunfire "noise arc" (server, 8 sectors, no distance) — playtest with kill switch | Kenji | 3 | 1 | S | 3 | F04 |
| V01 | Outline colour per brawler (me cyan / mate green / enemy dark + red rim), ground ring, colour-blind option | Kenji | 3 | 2 | S | 1 | – |
| V02 | Figurine LODs (18k/8k/3.5k, hull on LOD2) + 512 px mobile textures | Kenji | 2 | 3 | M | 2 | – |
| V03 | Hero-quality figurine pass for the 5 (remesh, 2048 bake, weapon ×1.25, recolours, eye-expression atlas) | Kenji | 3 | 3 | L | 3 | V02 |
| V04 | VFX library `vfx/` (trails, telegraphs, shockwave, decals layer, dissolve, crown aura, revive beam) | Kenji | 4 | 2 | M | 2 | – |
| V05 | Feel pass merged into the cartoon grade (CA, desat, vignette tint, speed lines) + per-map LUT-lite | Kenji | 3 | 1 | S-M | 1 | – |
| V06 | Stylised gas (edge line + swirl shader, tiered) | Kenji | 3 | 1 | M | 3 | – |
| V07 | Footsteps dust / prints / splash, own-bush parting, water ripples (all gated by F04) | Kenji | 3 | 1 | M | 2 | F04, V04 |
| V08 | Destruction 2.0: chunked walls, rubble decals, crate burst with cube spotlight | Kenji | 3 | 1 | M | 2 | V04 |
| U01 | Audio pass 1: per-brawler fire/hit/super sets, hit-confirm ladder, ammo/reload, cube scale, KO/gas/3-left stingers, mix rules | Kenji | 4 | 2 | M | 1 | – |
| U02 | Audio pass 2: surface footsteps (LoS-gated), gibberish voice barks per brawler (hurt/KO/win/super) | Kenji | 3 | 3 | M | 1 | F04, U01 |
| K01 | Gadget system (4th button, 3 charges, 5 s lockout, bush reveal, `in` bit + seq, server movement allowance for dashes) | both | 5 | 3 | M | 3 | F03 |
| K02 | Gadgets A (mobility) + B (utility) for the existing 5, with a clip + VFX + SFX each | both | 5 | 3 | L | 4 | K01, V04 |
| K03 | Star powers (2 per brawler, lobby pick, roster field) | Maya | 3 | 4 | M | 3 | K01 |
| K04 | New brawler: Pip & Chomp (melee assassin / trap-bush super) | both | 5 | 4 | L | 4 | K01, V02 |
| K05 | New brawler: Glitch (trickster mascot, decoys, Ctrl+Z) | both | 5 | 4 | L | 4 | K01, B02 |
| K06 | New brawler: Nurse Kappa (support, ally heals, tidal wave) | both | 4 | 3 | L | 3 | M01 |
| K07 | New brawler: Mochi (tank, leap-slam, no stun) | both | 4 | 3 | L | 3 | M01 or A03 |
| K08 | New brawler: Hopper (bank shots) + bullet bounce in `combat.js` | both | 4 | 3 | L | 3 | K01 |
| K09 | Later brawlers: Clawdia (turret), Nimbus (charge-shot sniper) | Kenji | 4 | 3 | L each | 3 | K01 |
| A01 | Cube rebalance (+300 HP, Mochi +250) + Bounty Crown (≥5 cubes, reveal 1 s/10 s, +2 cubes on KO) + visual growth, fixed hitbox | both | 4 | 2 | S-M | 3 | F04 |
| A02 | Arena Event Deck engine (server-authoritative, telegraphs, rejoin snapshot, max 2/match) + Supply Drop + 1 themed event per existing map | both | 4 | 3 | M | 3 | F05, V04 |
| A03 | Windmill Isles: void/ring-out, breakable bridges, jump pads, barrels, mushrooms, crumbling islands instead of gas | Kenji | 5 | 4 | L | 4 | A02, K01 |
| A04 | Interactive kit on existing maps (geysers, barrels, mushrooms) via Event Deck cards | Kenji | 4 | 2 | M | 3 | A02 |
| A05 | Weekly Chaos mutators (Big Head, Night Hunt, Moon Gravity, Cube Rain, Gas Breath) with title card + tell | both | 4 | 4 | S each | 2 | A02 |
| A06 | Caldera (elevation, rising lava) — needs height-aware LoS | Kenji | 4 | 3 | XL | 5 | A02 |
| A07 | 2-way-mirrored team maps (layoutMirror 'x'), 2 at launch | Maya | 2 | 2 | M | 2 | – |
| M01 | Duo Showdown + Buddy Revive (ghost 15 s, 3 s channel, 40% HP) + team HUD | both | 5 | 5 | L | 3 | V01, F02, T02 |
| M02 | Knockout 3v3 (Bo3, 90 s rounds) | Maya | 4 | 4 | L | 3 | A07, V01, T02 |
| M03 | Boss Raid "Slop Kaiju" PvE co-op (3 phases, minions, revive) | both | 5 | 4 | XL | 4 | M01, V04 |
| M04 | Slop Grab 3v3 (token mine) | Maya | 4 | 3 | L | 3 | M02 |
| M05 | Training Dojo (dummies with DPS readout, gadget tutorial, photo cam) | both | 2 | 2 | M | 1 | K01 |
| P01 | Account level (≈55 XP/match, 100+20(L−1)) + level-up event (chest, figurine bump), server `progress` table + capped solo posting | both | 3 | 5 | M | 2 | – |
| P02 | Brawler mastery 1-10 (gadget B @2, SP2 @4, then cosmetics; golden figurine @10) | both | 3 | 5 | M | 2 | P01, K02 |
| P03 | 3 daily quests + weekly (bounty-board UI with stamps, reroll) | both | 2 | 5 | M | 2 | P01 |
| P04 | Bot League: per-brawler trophies from bot matches + Trophy Road; bot level derived from it | Maya | 3 | 4 | M | 2 | P01 |
| P05 | Cosmetics: skins with VFX sets, trails, KO effects, emotes, titles, frames; Slop Coins (play-earned) + rotating shop | both | 3 | 5 | XL | 2 | P01, V03 |
| P06 | Seasons (RP soft reset, seasonal title/frame, seasonal mutator map) | Maya | 2 | 4 | M | 2 | P01, A05 |
| B01 | Bot 2.0 tree: dodge, disengage out of LoS, peek-shoot-hide, per-brawler super/gadget policy | Maya | 4 | 4 | L | 3 | K01 |
| B02 | Bot personas (Hunter/Camper/Looter/Vulture/Coward/Show-off) with icon, barks, emotes; duo-mate bot; decoy recognition | both | 4 | 4 | M | 2 | B01, U02 |
| S01 | Post-match stat cards + MVP awards (damage, cubes, Vulture, longest shot) + share image | both | 3 | 3 | M | 1 | – |
| S02 | Killcam (5 s from snapshot/event ring buffer, only what you received) + MVP best-moment clip on podium | both | 4 | 3 | L | 3 | F05 |
| S03 | Emote wheel (figurine clips, reveals you in a bush; bots answer); pings in team modes | both | 3 | 3 | M | 1 | F04 |
| T01 | Balance & fun dashboard in PostHog (placement/win by brawler × map × cubes; gadget/SP pick & win rates) + headless bot tournaments in `npm test` | Maya | 1 | 2 | S-M | 1 | – |
| T02 | Party matchmaking (party tickets from rooms, slot-based pickGroup, party MMR, 2 live queues) | Maya | 2 | 4 | M | 3 | F02 |

## 2. Phasing (v0.11 → v0.16)

Principle: each release = **1 headline fun feature + 1 retention hook + polish**, with dependencies respected. No release is infra-only; infra (F05, T01, T02, V02) always ships inside a fun release.

### v0.11 "Punch!" — *"Every shot lands with a crunch, and you're in a match within a minute."*
F01, F02, F03, F04, G01, G02, G03, G05, G06, V01, U01, G08 (kill feed + 3 LEFT + gas telegraph part), T01.
Why first: all client-side or S, zero content risk, and the fairness bug fix + backfill protect everything after. Measurable before/after on the same content.

### v0.12 "Gear Up" — *"Pick a gadget, level up every match, and master your brawler."*
K01, K02, K03, G07, V04, V05, P01, P02, P03, B01 (dodge + disengage + super/gadget policy), V02, S01.
Gadgets give new fun; level/mastery/quests start retention. LODs (V02) land now to pay for the new brawlers to come.

### v0.13 "Buddy Up" — *"Grab a friend, queue together, and revive each other in Duo Showdown."*
M01, T02, K06 (Nurse Kappa), A01 (bounty crown + cube rebalance), U02 (barks), S03 (emotes; pings in Duo), B02 (personas + duo-mate bot).
First social mode. Kappa gives the reason to play Duo, and the bounty crown adds a mid-match hunt in both modes.

### v0.14 "Wild Arenas" — *"The arenas fight back: supply drops, meteors, geysers, and the new Windmill Isles with ring-outs."*
F05, A02, A04, A05 (weekly mutators start), A03 (Windmill Isles), K07 (Mochi, the ring-out king), K04 (Pip & Chomp), G04, V07, V08.
Match-arc fix + weekly novelty engine; two brawlers; the first template-breaking map.

### v0.15 "Slop Season 1" — *"Season 1: climb the Bot League or Ranked, unlock skins, and meet Glitch, the game's own mascot."*
P04, P06, P05 (first wave: 1 skin per brawler + trails + KO effects + shop), K05 (Glitch), V03 (hero pass), A07 + M02 (Knockout 3v3), S02 (killcam + MVP clip).
Long-term chase (season + cosmetics); Glitch as the season face; the first 3v3.

### v0.16 "Kaiju Raid" — *"Team up against the Slop Kaiju and bank-shot your way to victory with Hopper."*
M03, K08 (Hopper + bounce), M05 (Dojo), V06, G09 (only if playtests OK), M04 (Slop Grab) if the population supports a 3rd queue; otherwise parked.

Parked beyond v0.16: A06 Caldera (elevation engine), K09 Clawdia/Nimbus, more team maps.

Sequencing notes:
- K02 before any new brawler (so new brawlers ship "complete"). B01 in the same release as gadgets (bots must use them, or gadgets feel like a human-only win button).
- Balance gate: no release ships a brawler/gadget with a T01 bot-tournament placement outside 40-60% of the average.
- Mobile gate per release: `match_performance` p10 fps on mobile ≥ 30 at medium (Kenji's budget table).

## 3. Moonshots

1. **Arena Workshop (level editor + UGC maps)**: the grid tiles (`X # B W C T K I S V = J E H`) are perfect for a paint-on-grid editor. A **bot-sim fairness check** (500 headless bot matches, spawn placement within ±5%) acts as the publish gate. Players vote maps into a "Community Map of the Week". Infinite content from a 2D char grid.
2. **"Prompt Your Skin" (moderated UGC cosmetics)**: players describe a skin; our pipeline (Nano Banana image → recolour/texture on the existing rigged mesh, not new geometry) generates it. It's cosmetic only, goes through a moderation queue, and is shown in-match to others. It's the purest expression of "AI SLOP ARENA", and it gives the name a positive twist.
3. **Slop Story: PvE campaign**: 30 short hand-built challenge stages (bot scripts + mutators + a boss every 10), with narrated interludes by the brawlers (ElevenLabs voices, Lyria stingers). It works fully offline on mobile/Steam Deck and is a great onboarding path to PvP.
4. **Slop Cup + Spectator/Caster mode**: server-side replay recording in the Room DO (inputs + seed = tiny files), a free-cam spectator with the LoS toggle, auto-brackets every weekend, and a shareable replay link. It's the esports and creator layer, cross-platform.
5. **Your Bot Twin**: an opt-in "ghost" bot that learns your style (brawler mix, aggression, bush habits from your telemetry) and plays in *other* people's bot-filled matches under "<you>'s Twin" (clearly labelled). Your profile shows its wins. It's asynchronous multiplayer that makes the low-population game feel alive and personal.

## 4. Success metrics per phase (PostHog)

Existing events used: `app_opened`, `match_started` (mode, map, brawler, bot_level, humans), `match_ended` (rank, won, duration_s, kos), `match_abandoned`, `mm_search_started` / `mm_matched` / `mm_search_cancelled` / `mm_bots_requested`, `ranked_result`, `room_joined`, `lobby_opened`, `achievement_unlocked`, `match_performance` (fps per device), `quality_auto_changed`, `survey sent` ("Are you having fun?" rating). New events to add are marked **(new)**.

| Release | Primary metric (target) | Secondary / guardrails |
|---|---|---|
| v0.11 Punch! | Survey fun rating +0.4 vs v0.10 (same audience); **matches per session +15%** | mm: median time `mm_search_started → mm_matched` ≤ 60 s, `mm_search_cancelled` rate −50%; `match_abandoned` −20%; mobile p10 fps not below v0.10 |
| v0.12 Gear Up | **D7 retention +5 pts** (cohort on `app_opened`) | `gadget_used` (new) ≥ 2 per match on average; `level_up` (new), `quest_completed` (new) ≥ 1.5/day per DAU; brawler pick share: none > 35%; per-gadget placement delta within ±0.5 rank |
| v0.13 Buddy Up | **Share of matches with ≥ 2 humans +50%** (`match_started.humans`) | `party_queued` (new) / `room_joined` friend share; `revive` (new) per duo match ≥ 0.8; Duo queue time ≤ 45 s; D30 of players who did ≥ 1 party match vs. not |
| v0.14 Wild Arenas | **Average `duration_s` of mid-game (30-80 s) engagement: KOs in 30-80 s window +25%**; weekly returning users +10% | `event_triggered` (new) + share of KOs within 10 m of an event; Windmill Isles pick-rate when chosen explicitly; ring-out share of KOs 10-25%; mobile fps on Windmill Isles ≥ others |
| v0.15 Slop Season 1 | **D30 retention +3 pts**, sessions/week per WAU +20% | Bot League participation (share of solo players with trophy changes); cosmetic equip rate ≥ 40% of players with unlocks; Glitch pick share 15-30% in its first 2 weeks; Knockout queue ≤ 60 s or else rotate it off |
| v0.16 Kaiju Raid | **Co-op share of matches ≥ 15%**, raid clear rate 35-60% | Players whose first match is a raid/dojo → D7 vs. Showdown-first; Hopper bounce-hit share; survey rating stable or up |

Always-on guardrails: Sentry crash-free sessions ≥ 99.5%; `match_performance` p10 fps (mobile medium) ≥ 30; RP distribution stays healthy (no tier > 40% of ranked players); reports per match (`player_reported`) not rising.
