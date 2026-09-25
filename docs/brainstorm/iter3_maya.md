# Iteration 3 — MAYA — DEBATE + DEEP DIVE

Reference stats (today, `src/brawler.js TYPES`, `src/combat.js`): Blaster 4800 HP / 6.0 speed / 5x260 @9.5 m; Gunslinger 3600 / 6.6 / 6x250 @16 m; Bomber 3400 / 6.1 / 800 AoE r2.0 @13 m; Frostbite 3300 / 6.3 / 3x300 + slow(x0.55, 1.5 s) @12 m; Volt 3100 / 6.8 / 650 + 2 chains (60%, 40%) @13 m. All 3 ammo. Regen 13%/s after 3 s idle. Cube = +10% dmg, +400 HP. Gas 900+60*level per s. Sim at 20 Hz on the server (`worker/index.js:238`).

---

## 1. Answers to Kenji

### Q1 — Universal dash vs gadget-only mobility, button budget
**I concede the button budget: 4 thumb targets max (move, attack, super, gadget).** No separate roll button, and hypercharge stays parked (no button, too much power creep on a 5-brawler roster).
My counter-condition: **every brawler's gadget pair = one mobility gadget (A) + one utility gadget (B)**. The player picks one in the lobby. So "every brawler *can* have an escape/engage tool", but it costs the utility option. Mobility then becomes a build choice, not a given, and that's a better system than a universal roll anyway (no homogenisation, and the counter-web is preserved).
Global safety rules that make mobility fair and server-safe:
- Ground dashes never cross wall tiles (the server clamps the dash to the first blocking tile, same as `blocksMoveAt`). Only 3 airborne arcs may cross walls: Bomber Lava Hop, Mochi super, Hopper super. The server simulates the arc itself, so it isn't a client move (it extends the existing `guard.knock` allowance used for knockback, `game.js applyKnock`).
- Using a gadget reveals you from a bush for 1.2 s (same as firing, `revealT`).
- **Hard-CC immunity**: after any stun/root/freeze ≥ 0.5 s, 1.5 s immunity to new hard CC. This is a prerequisite once Mochi, Pip and Blaster roots exist next to Frostbite's nova.

### Q2 — All brawlers free, progression = cosmetics + 2nd gadget
**Agreed: all brawlers free forever** until the roster is 10+. Even then, new brawlers are unlocked by *play* (a Mastery-free "trial" plus an account-level gate), never by pay.
Nuance on gadget #2 / star power #2: these are power options, so the gates must be **short** (tutorial gates, not grind): gadget B at mastery 2 (~3 matches with that brawler), star power B at mastery 4 (~10 matches). They are designed as **sidegrades**, never strictly better. Ranked (human RP) requires mastery 4 on the chosen brawler, so nobody in ranked is missing options. Everything after mastery 4 is cosmetic.

### Q3 — Duo before 3v3, and parties in the matchmaker
**Duo first: agreed.** It reuses all 5 maps and 8 spawns, fits the 8-player sim, gives the friend hook, and bots fill it naturally.
What the code says today (`worker/index.js` MatchmakerObject, `worker/ranking.js pickGroup`):
- **No party concept.** One WebSocket = one queue entry (`serializeAttachment({ joined, name, mmr, ...who })`); `pickGroup` picks individuals by MMR around the oldest. Friends can only play together through private rooms (`RoomObject`) or Steam P2P lobbies, which are unranked.
- A "Play now with bots" button exists (`msg.t === 'bots'` -> `makeMatch([ws])`), but the automatic fill waits `QUEUE_BOTS_AFTER = 5 min`.
- Progression/rank is keyed on device/client id in `PlayersObject` (SQLite, `players(key, mmr, rp, matches, wins)`).

Needed for Duo + parties (M):
1. `/mm?mode=showdown|duo&party=<code>`: a party is created from a private room ("Queue together" button in the room lobby). The room DO hands the matchmaker **one ticket per party** `{ members:[cid...], mmr, size }`.
2. `pickGroup` becomes slot-based: a match needs 8 slots, a duo party takes 2 slots on the same team, and solo duo-queuers are paired by MMR (or get a bot partner at 30 s).
3. Party MMR = max(members) * 0.6 + avg * 0.4 (premades are stronger than their average).
4. **Backfill**: auto bot-fill at **45 s** (duo) / **60 s** (showdown) instead of 5 min. Keep the wait-window growth `mmrWindow`.
5. Only 2 public queues live at once (Showdown always + one "featured" mode, rotating weekly), so a small population isn't split.

---

## 2. Deep-dive specs

### (a) Kit 2.0 — gadgets and star powers

Global: **3 gadget charges per match, 5 s lockout between uses**, gadget input = new bit + sequence counter in the `in` message, like `superSeq` (`game.js` `I.s > b.superSeen`). Star powers: passive, 1 of 2 chosen in the lobby, sent in the roster (`makeRoster` gets `gadget`, `star`). Bots pick randomly weighted by persona. Every gadget gets one clip + one VFX + one SFX (Kenji) and one enemy-visible tell.

#### Existing five

| Brawler | Gadget A (mobility) | Gadget B (utility) | Star Power 1 | Star Power 2 | Balance notes |
|---|---|---|---|---|---|
| **Blaster** 4800 | **Root Charge**: 4 m ground dash in 0.25 s; first enemy bumped takes 400 and is rooted 0.6 s (can still shoot). | **Bark Skin**: 2.5 s of −35% damage taken, −20% speed. | **Sap Regen**: regen starts after 2 s instead of 3. | **Splinters**: seeds that hit a wall split into 2 shards of 110 (range 3 m). | Root + 5x260 point-blank is 1700 burst: fine vs. 3100-3600 HP, but root capped at 0.6 s and CC immunity applies. Dash doesn't cross walls. |
| **Gunslinger** 3600 | **Tail Roll**: 3.5 m roll, 0.2 s i-frames, +1 ammo. | **Star Flare**: a flare shot to 16 m that reveals everyone within 6 m of impact (bushes included) for 3 s. | **Steady Aim**: −50% burst spread while standing still. | **Axolotl Regen**: regen +40% (13 → 18%/s). | Flare is the first bush counter; it only reveals, no damage. Roll i-frames are short, so it dodges supers when timed, not spam. |
| **Bomber** 3400 | **Lava Hop**: server-simulated 5 m jump arc (0.6 s airtime) that may cross 1 wall tile; landing leaves a 2 m puddle, 300/s for 2 s. | **Fuse Cut**: next fireball flies 40% faster (0.5-0.85 s -> 0.3-0.5 s). | **Magma Puddle**: fireballs leave a 1.5 m puddle 2 s, 200/s. | **Big Bang**: explosion radius 2.0 → 2.4, damage 800 → 720. | Airborne = hittable only by AoE (can't dodge Volt storm). Puddles don't stack (one per tile, refresh). |
| **Frostbite** 3300 | **Ice Slide**: 5 m slide in 0.35 s leaving a 3 s ice trail (same physics as `I` tiles). | **Ice Wall**: 3 temporary wall tiles perpendicular to aim, 4 m ahead, 3 s, 1200 HP each; blocks shots *and* LoS. | **Deep Freeze**: slow ×0.55 → ×0.45. | **Permafrost**: nova radius +25%, freeze 1.4 → 1.0 s. | Ice Wall uses the arena tile grid (`arena.js` destroyWall inverse): temporary `#` tiles; LoS mask updates for free since sight.js walks the grid. Nova wind-up 0.25 s (telegraph ring) + CC immunity = counterplay. |
| **Volt** 3100 | **Blink**: 5 m teleport after a 0.15 s charge; destination must have LoS from start (never through walls); leaves a 2 s zap trap (500, 1 m). | **Overclock**: instant full reload, +30% reload speed for 3 s. | **Conductor**: +1 chain (60/40/25%). | **Surge**: storm 5 bolts × 600 → 7 bolts × 450. | Volt is the lowest HP, and Blink is its survival tool. Conductor helps in Duo/3v3 (clumps), so watch its win rate there. |

#### Kenji's five new brawlers (stats + kits)

| Brawler | Base stats | Attack / Super | Gadget A (mobility) | Gadget B (utility) | SP1 | SP2 | Balance notes |
|---|---|---|---|---|---|---|---|
| **Mochi** (tank) | HP 7000, speed 5.6, ammo 4, reload 1.4, superCost 2400, collision radius ×1.15 | Belly bump: 3.5 m cone, 3 jelly waves × 420, knock 2.5 m. Super **Mochi Pound**: targeted leap ≤ 9 m, 1.1 s airtime, lands r 4 m: 1000 dmg + stun **0.8 s** + breaks walls. | **Belly Slide**: 5 m slide, pushes enemies aside (200 dmg, knock 2 m). | **Sticky Mochi**: 2 s blob, −60% damage taken, can't shoot; touching enemies slowed ×0.6. | **Heavyweight**: immune to knockback. | **Second Helping**: picking a cube heals 800. | Kenji's 1 s stun cut to 0.8 s. The 7000 HP pool must not also scale +400/cube like others, so Mochi gets **+250 HP per cube**. Counters: Gunslinger/Bomber range, Frostbite slow. |
| **Pip & Chomp** (assassin/trapper) | HP 3800, speed 6.8, ammo 2, reload 1.8, superCost 2200 | Chomp lunge: 4 m dash-bite, 1100 dmg, moves the brawler (ground, wall-clamped). Super **Venus Trap**: placed ≤ 8 m, 1 active, 30 s; counts as a bush; first enemy entering: 800 + root 1.0 s + revealed 3 s. | **Leap Snack**: 6 m lunge; if it hits, heals 600 (no damage bonus). | **Spore Puff**: 3 m cloud for 3 s that works as a bush for everyone inside. | **Hunter's Nose**: sees enemies < 35% HP inside bushes within 8 m. | **Hungry**: bites on targets < 40% HP +25%. | 2 ammo × 1100 = 2200: two bites don't kill a full 3100 Volt. Trap root triggers CC immunity. Bots must avoid known traps (they saw it placed). |
| **Glitch** (trickster/mascot) | HP 3300, speed 6.6, ammo 3, reload 1.6, superCost 2700 | Prompt token: 1 glyph, 700 dmg, 12 m; on a wall hit splits into 3 × 250 fanning back. Super **Hallucinate**: 2 decoys (1000 HP each, 0 dmg, fire fake tokens) for 4 s; real Glitch 50% transparent to enemies. | **Ctrl+Z**: rewind to your position 2 s ago and restore up to 1000 of the HP lost in those 2 s. | **Lag Spike**: 5 m pulse, enemies slowed ×0.7 for 1.5 s, their nameplates jitter. | **Overfit**: splits 3 → 5 × 170. | **Buffer Overflow**: decoys explode for 600 (r 2 m) when destroyed or on expiry. | Ctrl+Z: the server keeps a 2 s position/HP ring buffer; destination must be walkable and not in gas at level > current. Decoys are real sim entities (net-synced as brawler-like with a `decoy` flag hidden from enemies' snapshots). |
| **Nurse Kappa** (support) | HP 3600, speed 6.2, ammo 3, reload 1.7, superCost 2600 | Bubble lob (over walls) ≤ 11 m, 700 splash r 1.6; hitting an enemy heals Kappa 350 (Showdown) / heals allies in the splash 500 (team modes). Super **Tidal Wave**: 10 m × 5 m sweep: 900 + push 5 m; gas on swept tiles is cleared for **2 s** (Kenji 3 s). | **River Dive**: 5 m dive, untargetable 0.3 s (8 m if starting in water). | **Bowl Splash**: heal puddle r 2 m, 400/s for 3 s; then −20% speed for 4 s (bowl empty). | **Hydrotherapy**: heals +30%. | **Undertow**: Tidal Wave pulls toward Kappa instead of pushing. | In solo Showdown the self-heal must stay below Blaster-level sustain (350/hit ≈ 11% of HP). Gas clear time is the balance lever in the endgame, so track "Kappa top-2 rate". |
| **Hopper** (skirmisher) | HP 3200, speed 7.0, ammo 3, reload 1.5, superCost 2500 | Slingshot: 2 pebbles × 450, 12 m, bounce once off walls (after a bounce, 70% dmg). Super **Triple Hop**: 3 server-simulated hops × 4 m, 0.4 s air each (untargetable in air), each landing 500 r 2 m, may cross walls. | **Skate Boost**: +60% speed for 2 s with drift (ice handling). | **Sticky Tongue**: pulls the nearest power cube within 7 m to you (LoS required). | **Ricochet**: pebbles bounce twice. | **Momentum**: after 1.5 s running, next shot +30%. | Bounce requires wall reflection in `combat.js updateBullets` (grid normal from the tile hit): M. Tongue = the cube-thief niche, a systems-level counter to the cube leader. |

Implementation order: Kit 2.0 on the existing 5 first (gadgets A/B + SPs), then **Pip & Chomp** (fills the melee/bush hole in Showdown), **Glitch** (brand), then Kappa and Mochi with Duo/3v3, and Hopper last.

### (b) Mode lineup (release order)

1. **Duo Showdown** (v0.12-ish)
   - 4 teams × 2 = 8 players, same 5 maps; team spawns = pairs of adjacent existing spawns (spawns are mirrored per quadrant, so the 2 spawns in one quadrant form a team).
   - Friendly fire off; teammates' projectiles pass through.
   - **Buddy Revive**: a KO'd teammate leaves a ghost for 15 s at the KO spot. The partner stands within 2.5 m for 3 s cumulative (progress pauses while the reviver takes damage) and the teammate revives at 40% HP, 0 cubes (cubes dropped at death as today). The ghost dies if gas covers its tile. No revive once the revive has been used 2 times by that team.
   - Gas: startAt 35 s, interval 8 s (slightly longer than solo's 28/7 for regrouping). Match length ~2.5-3 min.
   - Win: last team with a living member; placement 1-4. RP_BY_RANK for duo: [30, 12, -4, -10].
   - Needs: team rim outline (Kenji), team HUD (partner HP + offscreen arrow), `team` field in the roster, `damage()` team check, bot teammate AI (follow partner, revive priority).
2. **Weekly Chaos Mutator** on Showdown (from week 1 of Duo): 1 mutator/week through the Event Deck (below). Cheap novelty.
3. **Knockout 3v3** (before Gem Grab)
   - 2 teams × 3, best of 3 rounds, no respawn within a round. Round: 90 s max; gas starts closing from the edges at 45 s (reuse `Poison` with startAt 45, interval 4).
   - Round win: eliminate the other team, or have more total HP% when the gas finishes.
   - Match length ~3-4 min.
   - Needs: **2-way-mirrored team maps** (maps.js is 4-way-mirrored today, so a new `layoutMirror: 'x'` option and a 25×25 layout with 3 spawns per side), and 2 maps at launch (reskin existing themes).
   - Why before Gem Grab: no objective entity, and the bots' fight AI is enough.
4. **Slop Grab 3v3** (later): central token mine (1 token / 7 s), hold 10 tokens with the team for 15 s. A carrier KO drops all their tokens. 2:30 cap then sudden-death gas. Needs a token entity + bot objective logic.
5. **Boss Raid: "The Slop Kaiju"** (PvE co-op, 3 humans + bot fill, also solo with 2 bot allies)
   - Boss HP = 40 000 × players (bots count 0.7). 4 min timer.
   - 3 phases (100-66-33%). P1: slam (ring telegraph 1.2 s, 1500), sweep (90° cone telegraph 1 s, 1200). P2 adds a minion wave (4 "crate goblins" of 1500 HP that drop cubes) + gas breath (a line of poison tiles for 5 s). P3 enrages (attack speed +30%) and the arena gas closes from the edges.
   - Revive as in Duo. Win: boss KO; lose: all down or timer.
   - Rewards: account XP ×1.5, weekly raid chest (cosmetic).
   - Map: an open-centre variant of an existing theme.
   - Answers low population: it works with 1 human + bots.
6. **Training Dojo 1v1 / sandbox** (onboarding): dummies with a DPS readout, gadget tutorials.

### (c) Progression (no pay-to-win; cosmetic currency earned only by playing)

**Account XP per match** (every mode, bots included):
- 20 base + placement (Showdown 1st..8th: 40/30/22/15/10/6/3/0; team modes: win 35, loss 10) + 4 per KO (cap 20) + 1 per 1000 damage (cap 10).
- **First win of the day ×2.**
- A match of < 25 s alive and no damage dealt gives 5 XP only (anti-AFK).
- Average ≈ 55 XP per match.
- **XP to next level = 100 + 20 × (L − 1)**, soft cap 50, then prestige stars: level 10 ≈ 30 matches, level 30 ≈ 200, level 50 ≈ 520.

**Brawler Mastery** (per brawler, levels 1-10), points per match with that brawler = damage/150 + 8 × KOs + placement (Showdown 1st 25 … 8th 0).

Mastery thresholds (cumulative points):

| Level | Points |
|---|---|
| 2 | 60 |
| 3 | 150 |
| 4 | 300 |
| 5 | 520 |
| 6 | 800 |
| 7 | 1150 |
| 8 | 1600 |
| 9 | 2150 |
| 10 | 2800 |

**Rewards table:**

| Unlock | Source |
|---|---|
| All brawlers, gadget A, star power 1 | Free from the start |
| Gadget B | Mastery 2 (~3 matches) |
| Star power 2 | Mastery 4 (~10 matches) — also required for that brawler in human Ranked |
| Recolor skin 1 | Mastery 5 |
| Projectile trail | Mastery 6 |
| Title "<Brawler> Adept" | Mastery 7 |
| Full skin 2 (new VFX set) | Mastery 8 |
| KO effect | Mastery 9 |
| Golden figurine + title "<Brawler> Legend" | Mastery 10 |
| Emote per level (1 of a pool), 100 Slop Coins every level, nameplate frame every 10 levels, profile icons | Account levels |
| Knockout mode visible in the menu | Account level 3 (shorter queue for new players, fewer choices) |
| Boss Raid | Account level 5 |
| Ranked (human RP) | Account level 8 + mastery 4 on the brawler used |
| Rotating shop: 4 cosmetics/day, 150-800 coins | Slop Coins, earned only by playing: levels, quests, trophy road. **No purchase path for power**; a paid path, if ever, is cosmetics only. |

**3 daily quests** (refresh 00:00 UTC, 1 free reroll/day, always completable with any brawler in any mode):
- Slot 1 **"Play"** — e.g. "Play 3 matches", "Break 8 crates": 60 XP + 30 coins.
- Slot 2 **"Do"**, action-based and never brawler-locked — e.g. "Deal 15 000 damage", "Pick up 10 cubes", "Revive a partner", "Use 6 gadgets", "KO someone from a bush": 90 XP + 50 coins.
- Slot 3 **"Excel"** — e.g. "Finish top 3 twice", "Win 1 match", "KO the crowned leader": 120 XP + 80 coins.
- Presentation per Kenji: a bounty board with stamps.
- Weekly quest: "Complete 10 dailies" → a cosmetic chest.

**Trophies for solo/bot players ("Bot League")**, separate from human RP:
- Per-brawler trophies from bot matches (solo + bot-filled matchmaking with < 2 humans). Showdown deltas 1st..8th: +10/+7/+4/+2/0/−2/−4/−6. Losses are scaled down under 100 trophies.
- The hidden bot level (`skill.js rating`) is re-derived from total trophies plus the recent-results nudge, so the ladder and difficulty stay coherent.
- **Trophy Road** on the account total: coins, emotes, titles every 100 trophies.
- Human RP (`ranking.js`) stays the prestige ladder, and seasons reset RP softly (−30% above 500).
- Storage: new `progress` table in `PlayersObject` keyed by cid (SSO account merges devices). Server-run matches write directly; solo/offline matches are posted to `/api/progress` with sanity caps (max 120 XP and 40 mastery points per match, max 60 counted matches/day). That's acceptable because the rewards are cosmetic, and the XP of tampered solo matches never touches human RP.

### (d) Arena Event Deck

Server-authoritative design: a new `src/events.js` `EventDeck` owned by `Game`, driven only when `this.authority` (host/server) is set.
- Seeded RNG from a match seed chosen by the host and sent in the `start` message.
- Each event is emitted as `ev({ e: 'evt', k, id, t0, x, z, d })` with a **telegraph time before any effect**. Clients only render.
- Active events go in snapshots for rejoiners (`onRejoin`).
- Damage goes through `game.damage(target, amt, null)` (no super charge, no kill credit, like gas).
- Temporary tiles use the arena grid so LoS/pathfinding/bots see them.
- Scheduling rules:
  - Max 2 events per Showdown match, never before 30 s, never while ≤ 3 brawlers are alive.
  - Never on a tile the gas will reach within the event duration.
  - Each map has a 3-card deck (2 themed + Supply Drop). The weekly mutator swaps the deck.
- Covered by headless tests in `npm test` (the event schedule is deterministic from the seed).

| Event | Maps | Timing | Rules | Notes |
|---|---|---|---|---|
| **Supply Drop** | all | 40-55 s, 5 s telegraph (growing shadow + siren) | Crate 3000 HP at a walkable tile inside the next safe zone, spills 4 cubes on breaking. | Bots: Looter persona goes, others go if hp > 50% and ≤ 20 m. |
| **Meteor Shower** | Dunes | 55-75 s | 8 meteors over 6 s, each telegraphed 1.5 s, r 2.2, 700 dmg, break walls. | Reuse Bomber meteor render. |
| **Lightning Rod** | Grove | 50-70 s | A 3×3 tile zone for 15 s: +8% super/s while inside. 1 random bolt per 2 s on a 12 m-radius disc around it (telegraph 1.2 s, 600 dmg). | Reuse `combat.storm` bolt logic. |
| **Blizzard** | Frost | 45-70 s, 3 s warning | 15 s: sight range 14 → 8 m (server-side `sightRange`), speed ×0.9. | Blizzard sight must drive snapshot filtering too. |
| **Sand Gust** | Dunes | 45-70 s | 6 s: all brawlers pushed 2 m/s in the wind direction (server-applied, like knock). | Projectiles unaffected (keeps aim fair). |
| **Fog Bank + Mushrooms** | Marsh | 45-65 s | 20 s: vision radius −20%; 3 healing mushrooms sprout (1200 heal over 3 s, one-use). | |
| **Geysers** | Oasis | every 10 s from 40 s, for 30 s | Water-edge tiles erupt (1 s telegraph): knock 4 m + 300. | Kenji's first interactive prop, as an event first. |
| **Cube Rain** | mutator | 30 s | 10 cubes scattered on safe tiles. | |
| **Gas Breath** | mutator | 70 s | Gas retreats 1 ring for 10 s. | |
| **Night Hunt** | mutator | whole match | Sight 14 → 9 m; lanterns reveal brawlers in a 3 m radius. | |
| **Bounty Crown** | all (rule, not card) | continuous | Cube leader with ≥ 5 cubes wears the crown and is revealed to everyone for 1 s every 10 s; the crown KO drops +2 cubes. | Snapshot must include the crowned brawler during reveals even out of LoS. |

### (e) Bot 2.0 — `src/ai.js` behaviour tree

Today `decide()` is a flat if-chain: gas → target (nearest seen, `d + hp*4`) → retreat < 30% HP → chase/strafe → loot → crate → wander. Super on `random() < 0.2 + skill*0.5`.

New structure: a priority selector evaluated every think tick (0.22-0.37 s, keep), with persona weights:

```
Root (Selector)
 1. Survive
    a. Dodge       : scan g.combat.bullets/bombs within 7 m; if time-to-impact < 0.45 s and
                     predicted miss distance < radius+0.3 -> sidestep perpendicular for 0.3 s.
                     Chance per threat = 0.15 + 0.7*skill. Telegraphed events/super rings: leave area.
    b. Gas         : existing flee-gas (keep), + use mobility gadget if stuck in gas > 1 s.
    c. Disengage   : if hp < 35% and (enemy power ratio > 1.2 or 2+ enemies see me):
                     path to the nearest tile with NO LoS to threats (A.los), prefer bush; hold 3 s
                     to trigger regen; mobility gadget if threat within 5 m.
 2. Opportunity
    a. Vulture     : a visible enemy with lastHurt < 1.5 s by someone else and hp < 50% -> +score.
    b. Bounty      : crowned leader visible -> +score (Hunter persona x2).
    c. Contest cubes: cubes on the ground within 12 m after a KO -> go if hp > 50% or no threat.
    d. Event       : supply drop / lightning rod per persona weights.
 3. Fight (target chosen with the new score = d + hpFrac*4 - vultureBonus - bountyBonus - focus)
    a. Engage check: powerRatio = (my hp*dmgMul*dps) / (their hp*dmgMul*dps); skip if < 0.7
                     unless cornered.
    b. Range dance : keep T.range*0.7 (Blaster 4.5) as today, + peek-shoot-hide: after emptying
                     ammo, step back behind cover (tile that breaks LoS) until 2 ammo.
    c. Super policy (per brawler, replaces the random roll):
         Frostbite nova: ≥1 enemy ≤ 4 m, or 2 ≤ 5 m.  Bomber meteor: target behind a wall or 2+ in r 3.6.
         Gunslinger: target ≤ 14 m with LoS and not dashing.  Blaster: target ≤ 6 m or its cover wall ≤ 3 m.
         Volt storm: 2+ enemies in r 4 of the point, or target slowed/frozen.
    d. Gadget policy: mobility A to escape (hp < 35% + threat ≤ 6 m) or gap-close (Blaster/Pip ≤ 6 m);
                     utility B by per-gadget rule (Star Flare at a bush where a target vanished,
                     Ice Wall when hp < 50% and a threat has LoS, Overclock at 0 ammo in a fight).
 4. Ambush (Camper persona / skill > 0.5): when an unaware enemy (not targeting me) is heading
    toward a bush within 5 m of my path, sit in it until d < want, then fire.
 5. Loot: cubes, then crates (existing), + avoid crates that are in the open when enemies are near.
 6. Patrol: toward the centre of the next safe zone through bush-rich tiles (not random open tile).
```

**Personas** (visible name tag icon + bark lines; weights multiply the option scores):

| Persona | Weights |
|---|---|
| **Hunter** | fight 1.3, bounty 2, disengage 0.7 |
| **Camper** | ambush 2, patrol in bushes, fight 0.8 |
| **Looter** | loot/events 1.8, disengage 1.3 |
| **Vulture** | vulture 2.5, fight when target < 50% only |
| **Coward** | disengage at 50% HP, never starts a fight |
| **Show-off** | fight 1.2, emotes after KOs (0.5 s exposed) |

Duo bots: follow partner within 6 m, revive priority over everything but gas, focus partner's target.
Decoys (Glitch): a bot recognises a decoy with p = 0.2 + 0.6*skill per 1 s of looking.

Fairness: reaction time and aim error keep their skill scaling (`shoot()`), so persona ≠ difficulty. Keep bot damage ×0.85, but **keyed on `!human`** (bug fix). Cost: the bullet scan is O(bullets) per bot per think tick, which is negligible vs. A*. The LoS "hide tile" search reuses `A.los` on ~16 candidate tiles around the bot.

Tests: headless bot-vs-bot tournaments in `npm test` (win-rate per brawler within 40-60% at equal skill; no bot stuck > 3 s; bots never shoot during the spawn shield).
