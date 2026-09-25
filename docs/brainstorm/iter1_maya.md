# Iteration 1 — MAYA (systems & gameplay depth) — DIVERGE

## (a) Diagnosis

### What works (keep and build on)
- **Solid Showdown skeleton**: 8 players, crates -> power cubes (+10% dmg, +400 HP each, `game.js pickItem`), cubes drop on KO (`kill` drops `max(1, cubes)`), shrinking gas (`poison.js`, starts 28 s, ring every 7 s, 9 rings). The snowball + third-party tension of Brawl Showdown is there.
- **Five readable, distinct archetypes** (`brawler.js TYPES`): close burst (Blaster), long burst (Gunslinger), lob over walls (Bomber), slow/freeze control (Frostbite), chain damage (Volt). Supers have real identity (wall-breaking, freeze, meteor).
- **Information game is newly real**: line of sight + bushes (`game.canSee`: walls block, bush hides unless < 3.6 m or `revealT` after firing/getting hit), 14 m sight / 11 m in sandstorm, fog vision radius on Marsh. This is the richest system in the game and is under-exploited.
- **Weather that changes rules** (ice slip, fog, sandstorm range) — a cheap, strong source of match-to-match variety.
- **Fair-ish plumbing**: server-authoritative sim, hidden MMR + visible RP (`worker/ranking.js`), bot level that follows the player (`skill.js`), spawn shield + calm bots (`SPAWN_SHIELD = 5`, bot `graceUntil` 7-11 s). Cross-platform single queue.

### Biggest weaknesses limiting fun & retention
1. **One mode, one mental model.** Only solo Showdown exists (`main.js` modes: solo / room / matchmaking / steam_lobby are all the same ruleset). No teams, no objective, no duo. After ~10 matches there is nothing new to learn or aim for. Every session feels identical.
2. **Zero meta progression / no reason to come back.** No account level, no unlocks, no brawler mastery, no quests, no currency, no cosmetics. The only persistent carrots are 15 one-shot achievements (`achievements.js`) and RP that only moves in matches with >= 2 humans (`ranking.js` comment). A solo/bot player (the majority, given population) literally has no visible progress beyond a hidden bot level.
3. **Brawler kits are one-dimensional.** Each brawler = one attack + one super, 3 ammo, fixed stats. No movement tool (dash), no gadget, no star power, no choice before or during a match. Skill ceiling = aim + positioning only; no "outplay moment" button. 5 brawlers is also thin for counter-picking (and bots pick randomly, `makeRoster`).
4. **Match arc is too flat and too short.** Gas fully closed around ~84 s to a 10x10 m box (`poison.js`, `safeHalf`); crates are static per map; no mid-match events. Opening = loot, middle = random bump-ins, end = gas squeeze. No comeback mechanic for the player who fell behind on cubes, and no rubber-band for the snowballing leader except third parties.
5. **Bots are "fair" but not interesting.** `ai.js` BotBrain: target = nearest/weakest seen, strafe at 70% range, retreat at < 30% HP, flee gas, loot nearest cube/crate. They never use bushes to ambush, never bait, never dodge projectiles deliberately, never third-party on purpose, never contest cubes after a KO, super use is `random() < 0.2 + skill*0.5`. They also all have `baseDmg 0.85` (`brawler.js:122`). Result: fights feel samey; no bot "personality".
6. **Thin post-death and social layer.** On death the camera follows your killer and there is a "spectate" that just closes the result panel (`main.js:777`). No emotes/pings, no duo with friend, no party queue, no post-match stats (damage dealt, cubes, time alive), no replays / killcam. Friends can play a room but there is nothing cooperative to do together.
7. **Matchmaking population risk.** `QUEUE_BOTS_AFTER = 5 min` (`worker/index.js:24`) with an MMR window growing 2.5/s. For a small indie population this means long waits or quiet "Bots" button presses; ranked RP freezes if you end up alone with bots. Needs a design answer (backfill, smaller lobbies, humans-first bot filling at 30-60 s, weekly ladders vs bots).
8. **Possible fairness bug (to verify)**: `baseDmg = isPlayer ? 1 : 0.85` — on a Steam P2P lobby host (`steamnet.js`), the host's own brawler is `isPlayer` and hits at 100% while remote humans are non-player brawlers at 85%. On the Cloudflare server sim everyone is non-player, so it's equal there. Human-vs-human damage should key on `human`, not `isPlayer`.

Also minor systems notes: super charge only from non-super damage (fine), cubes give flat +400 HP (big: 8 cubes = +3200 HP on a 3100 HP Volt = ~2x) -> strong snowball; Frostbite nova freeze 1.4 s is the only hard CC and has no counterplay tool anywhere in the game.

## (b) Raw ideas (no self-censoring)

### Modes
1. **Duo Showdown** — 4 teams of 2, revive your partner by standing next to their ghost for 3 s before the gas. *Fun*: instant social hook ("play with a friend" becomes meaningful), clutch revives. Reuses Showdown. **M**
2. **Gem Grab 3v3 ("Slop Grab")** — central mine spawns AI-slop "tokens"; hold 10 for 15 s to win. *Fun*: objective play, carrying, comeback when the carrier dies and drops everything. Needs team spawns + symmetric team maps. **L**
3. **Knockout / Bounty (3v3 best-of-3 rounds, no respawn)** — short rounds, star on killstreakers worth more. *Fun*: tight, esports-able, fast to learn. **M**
4. **Boss Brawl (PvE co-op)** — 3 humans vs a giant AI-generated boss with phases (Hunyuan big model). *Fun*: cooperative mode for friend groups and low population; great showcase for AI art. **L**
5. **"Slop Royale" big mode** — 16 players, 2x map, map made of 4 existing arenas stitched, weather per quadrant. *Fun*: spectacle, weather strategy (which quadrant to fight in). **XL**
6. **Hot Zone / King of the Hill** — zone moves every 30 s; points per second inside. *Fun*: forced collisions, uses bushes around zone. **M**
7. **Weekly rotating "Chaos Event" mutators** on Showdown: low gravity knockback, all-Frostbite, meteor shower, double cubes, one-shot sniper night, "big head". *Fun*: novelty for near-zero content cost; drives weekly return. **S each**
8. **Training / Duel 1v1 arena** vs a bot or friend, with dummy stats readout. *Fun*: practice aim, settle friend arguments, onboarding. **S-M**

### Brawler kit depth
9. **Gadgets (1 of 2 per brawler, 3 charges/match, key/button)** — e.g. Blaster "Root Snare", Gunslinger "Tail Dash", Bomber "Lava Puddle", Frostbite "Ice Wall", Volt "Overclock" (instant reload). *Fun*: outplay moments, counterplay to freeze/burst, pre-match choice. **M**
10. **Star Powers / passive picks (choose 1 of 2 in lobby)** — e.g. Frostbite shards leave ice floor; Volt chain +1 target; Blaster heals on super hit. *Fun*: builds, experimentation, meta diversity. **M**
11. **Universal dodge-roll / short dash on a cooldown** — every brawler, 6 s CD, i-frames 0.15 s. *Fun*: skill expression, answers to projectile spam; big "feel" win (overlaps Kenji). Balance risk. **S-M**
12. **Hypercharge / "Slop Mode"**: after 2 supers, next super is overcharged (bigger, + speed/shield buff 5 s). *Fun*: dramatic spikes, readable threat. **M**
13. **New brawler archetypes missing today**: healer/support (heals in duo/3v3), assassin (dash-in, burst, bush stealth bonus), tank with shield front, trapper (mines that reveal bush campers), summoner (turret/pet). Each fills a hole in the counter web. **M each (L with art)**
14. **Ammo variety**: not everyone 3 ammo — charge-shot sniper, 1-ammo heavy hitter, 6-ammo pea shooter. *Fun*: rhythm diversity between brawlers. **S per brawler**

### Map & match systems
15. **Dynamic map events**: mid-match (45 s) supply drop in a random quadrant (5 cubes + a super charge), announced 5 s before. *Fun*: creates a mid-game hotspot, comeback for players behind, bait for third parties. **S-M**
16. **Weather events that shift mid-match**: grove lightning strikes random tiles (telegraphed), frost blizzard reduces sight for 15 s, sandstorm gusts push brawlers. *Fun*: turns weather from ambience into decisions. **M**
17. **Interactive props**: exploding barrels, jump pads, healing mushrooms, teleport pools on Oasis water, destructible bridges. *Fun*: map mastery layer, emergent kills. **M**
18. **Map rotation variants / procedural quadrant**: layout is a mirrored 13x13 quadrant (`maps.js`) -> generate/remix quadrants (seeded) for a "Map of the Day". *Fun*: freshness at no art cost; fairness preserved by 4-way symmetry. **M**
19. **Gas variants**: gas that closes toward a random off-center point; gas that "breathes" (retreats one ring for 10 s); poison mushrooms instead of rings. *Fun*: end-game variety, avoids the same 10x10 center brawl. **S-M**
20. **Comeback rules**: cubes from crates weigh more for low-cube players; KO of a much stronger target drops bonus cube; "bounty" crown on the cube leader (visible through LoS briefly every 10 s). *Fun*: reduces snowball, creates hunts. **S**
21. **Power cube rebalance**: cubes give +HP partially as a shield or lower HP (+250) and add a small speed/reload perk at 5+ cubes. *Fun*: keeps leader killable; more meaningful cube counts. **S**

### Bots
22. **Bot personalities** (Camper, Hunter, Looter, Third-Party Vulture, Coward, Show-off) with named AI-slop personas and chat-bubble quips. *Fun*: matches with bots feel like a cast of characters; fills low-population lobbies with drama. **M**
23. **Smarter bot tactics**: bush ambush, projectile dodge (sample incoming bullets), cube contest after KOs, hide behind walls to reload, gas-edge pressure, counter-pick. *Fun*: deeper bot matches = the core experience for most players. **M-L**
24. **Bot difficulty tiers visible + "Challenge ladder"**: climb 20 hand-crafted bot matches (fixed seeds, mutators, boss bots). *Fun*: solo campaign-like progression, great for mobile/offline. **M**

### Progression & retention
25. **Account level + brawler mastery tracks** (XP per match from placement, KOs, damage; mastery badges/titles per brawler; unlock gadgets/star powers/skins). Free, no pay-to-win. *Fun*: every match progresses something. **M-L**
26. **Daily/weekly quests** ("Win with Bomber", "Break 20 crates", "KO someone from a bush"). *Fun*: direction for sessions, pushes variety in brawlers/maps. **M** (needs server storage per account; SSO accounts exist).
27. **Brawler unlock path**: start with 3, unlock others by play (not pay). *Fun*: early goals, gradual complexity for new players. **S-M** (risky: small roster).
28. **Seasons (6-8 weeks)**: RP soft reset, season rewards (cosmetic border/title, trail), seasonal mutator map. *Fun*: recurring ranked chase. **M**
29. **Ranked for solo/bot players**: separate "Bot League" rating visible with tiers, since RP only moves with >= 2 humans. *Fun*: gives the majority a visible ladder. **S**
30. **Cosmetics-only economy**: coins from matches -> skins, trails, KO effects, victory dances (16 anims exist), emotes. *Fun*: expression, collection. **L** (art-heavy; Kenji overlap).

### Social, spectate, competitive
31. **Pings & emotes wheel** (4 emotes + "Help!/Here/Careful"), plus Frieren-style silly voice lines. *Fun*: expression in a no-chat game, taunts. **S-M**
32. **Party queue** into matchmaking (2-3 friends, duo/trio modes). **M**
33. **Post-match stats card + MVP awards** (damage, cubes, time in bush, longest shot, "Vulture" award for third-party KOs). Shareable image. *Fun*: stories + virality. **S-M**
34. **Killcam / 5-s death replay** from the server event stream (sim is already event-based, `ev({...})`). *Fun*: learn why you died; salt/fun. **M**
35. **Full replays + spectator mode** (record inputs/snapshots from Durable Object; free-cam or follow any player; shareable link). *Fun*: content creation, tournaments. **L**
36. **Custom rooms with rules**: pick mode, mutators, gas speed, bot count/level, brawler bans. *Fun*: friend groups & streamers create their own fun. **M**
37. **Weekend tournaments / "Slop Cup"**: bracket of 8-player lobbies, auto-run on the worker. **L**
38. **Clubs / crews** with shared weekly goal. **L** (only with population).

### Low-population specific
39. **Humans-first backfill at 45 s**: start the match with humans + bots after 45-60 s (not 5 min), let late humans replace a bot in the first 10 s ("drop-in"). *Fun*: no waiting = retention. **S-M**
40. **Asynchronous "ghost" opponents**: bots driven by recorded human play patterns/names (clearly labeled). *Fun*: feels populated. **L** (ethical labeling needed).

### Fairness / quality
41. **Fix host damage asymmetry** (`isPlayer` vs `human` for `baseDmg`) and audit all `isPlayer`-dependent rules in authority code. **S**
42. **Telemetry-driven balance loop**: PostHog already collects brawler/map/rank; build a win-rate/placement dashboard per brawler & map and a quarterly balance patch. **S**
