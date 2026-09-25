# Iteration 2 — MAYA (systems) — CROSS-POLLINATE

## 0. Verdict on the `brawler.js:122` baseDmg bug — CONFIRMED (Steam lobbies), plus an inconsistency online

`this.baseDmg = isPlayer ? 1 : 0.85` and `isPlayer = r.id === localId` (`game.js:118`).
- **Steam P2P lobby**: the host runs the authoritative sim with `localId: net.id` and `role: 'host'` (`main.js:668`, `steamnet.js` "the lobby owner is the host"). So the host's brawler deals **100%** and every remote human **85%** (and cube bonus `dmgMul = baseDmg + 0.1*cubes`, `game.js:341`, keeps the gap). This is a real host advantage of about 15% damage. **Bug, fairness-critical.**
- **Cloudflare server sim**: `newMatch({ localId: null, headless: true })` (`src/server/sim.js:23`), so every brawler, humans included, is at 0.85. It's symmetric, but online humans hit 15% softer than in solo, which changes breakpoints (shots-to-kill) between solo and online.
- **Fix (S)**: key on `r.human` (humans 1.0, bots 0.85), never on `isPlayer`. Audit other `isPlayer` checks in authority code (e.g. `game.js` pickItem/feats are cosmetic, fine). Add a test in `npm test` (headless sim): two humans of the same brawler deal equal damage regardless of host.

## 1. Critique of Kenji's ideas (systems lens)

**High-leverage (do them, mostly client-side, zero balance risk):**
- #1 Hitstop/victim squash, #2 trauma shake, #3 hit-confirm, #6 cube growth, #7 low-HP state, #11 input buffer: cheap (S), purely cosmetic on the client, don't touch the authoritative sim. **Caveat**: hitstop must never freeze the sim, only the victim's animation/mesh. A global 120 ms freeze on KO is fine offline, but online it must be a client render effect with the sim running (otherwise desync vs. snapshots at 20 Hz, `worker/index.js:238`).
- #13 Super as event + **enemy ground telegraph**: the telegraph is a *systems* win too (counterplay), and pairs with a dodge. But a 250 ms wind-up changes super timing = balance change for Frostbite nova (instant freeze today). Wind-up only on the caster's screen, or apply it for real to everyone? I want it real (counterplay), which means a server change.
- #14 Outline + team rim: essential before any team mode. It is the prerequisite for Duo/3v3.
- #32 HUD (kill feed, "3 LEFT", gas telegraph on floor) and #33 offscreen indicators: high leverage for comprehension. **Trap in #33**: "heard gunfire outside vision" pings leak information and weaken bushes/LoS, the best system we have. It has to come from the server with a coarse direction and no distance, and never for someone sitting in a bush who isn't firing.
- #30 audio pass: high leverage and cheap with ElevenLabs. Footsteps are a hidden info channel, so the same LoS fairness caveat applies (footsteps of hidden enemies must be muted or occluded).
- #12 universal dash with per-brawler flavour: **agree, and it's the #1 systems change**. Bomber "rocket hop over walls" and Volt "blink" are risky (wall-crossing breaks the server's anti-cheat movement check `game.js` "through a wall ... refused" and LoS). Start with ground dashes only, and wall hops as a gadget later.

**Traps / careful:**
- #4 slow-mo on KO (timeScale 0.3): fine solo, **impossible online** as real time dilation, and it's disorienting mid-fight in an 8-player FFA (someone else is shooting you during your slow-mo). Keep it only for the *final* KO / match end, or make it cosmetic (camera + VFX, not time).
- #6 cube growth +3% scale per cube: 8 cubes = +24% size, so a bigger hitbox if hitbox follows mesh. Visual scale only, collision radius fixed (and say so). Otherwise it's a hidden nerf to the cube leader (which I might actually want as anti-snowball, but it must be deliberate).
- #9 dynamic zoom out when few remain: it changes how much you see = information balance. OK if sight range (14 m) is still the rule; zooming out must not reveal beyond LoS.
- #15 raymarched gas, #16 interactive grass, #18 fracture physics: **mobile perf traps** (Capacitor on low-end Android, `autoquality.js` exists for a reason). Ship them with quality tiers and keep the gameplay-relevant silhouette (gas edge line on the ground) on all tiers. #18 "dust briefly blocks vision" is a systems change, and only good if the server also knows it.
- #16/#8 grass parting and footprints: parting grass reveals bush campers visually. That's a gameplay rule change hidden in a VFX idea. Either it's a real mechanic (then design it) or bushes don't move for hidden enemies.
- #19-23 new brawlers: all great fantasies, but each is **L** and adds balance surface. Sequence them: tank (Mochi) and support (Kappa) only make sense *after* Duo/team modes. For Showdown-only, the best first additions are **assassin/melee (Pip & Chomp)** and **Glitch** (brand).
  - Mochi stun 1 s + 7000 HP + wall break + leap is an overloaded kit, so cut one element.
  - Glitch decoys: the bots must also be fooled sometimes (otherwise the super is dead vs. bots), so bot AI has to know about decoys.
  - Kappa "extinguish gas for 3 s" = a strong endgame tool in Showdown. Maybe just in its own path, short.
  - Hopper bank shots: needs bullet bounce in `combat.js` + server. Fine, M.
- #24 skins: great retention engine, but only once there is a **progression/economy to earn them** (my #25/#30). Skins that swap projectile colour must keep **enemy colour coding** (today `colorFor` makes enemy projectiles red; skins must not break "red = danger").
- #28 five new arenas: XL. Sky Islands ring-out and Volcano rising lava are the systems gems (new kill source, new closing mechanic). I would do **one** new arena that breaks the mirror template, plus a map-event kit reusable on the old 5.
- #34 result show + #35 killcam + #36 photo mode: killcam online needs server-side event history (sim already emits `ev()`, so doable). Photo mode is cheap marketing, low fun impact.

## 2. Combined ideas (feel x systems)

1. **Kit 2.0 = Dash + Gadget + Star Power, each with Kenji's feel.** Every brawler gets a flavoured dash (Kenji #12, ground-only v1), 1 of 2 gadgets (3 charges), 1 of 2 star powers, chosen in the lobby. Each gets a readable VFX/SFX signature (Kenji #5/#30) and an enemy-visible telegraph. It turns 5 brawlers into roughly 20 playstyles before any new model. **L**
2. **Supers with real counterplay.** Kenji #13 cinematic wind-up (≈200 ms, server-real) + red ground telegraph + my universal dash = "see it, dodge it". Frostbite nova gets a 0.25 s charge ring; Bomber meteor already has a flight time and gains a shadow circle. Hitstop on connect. **M**
3. **Cube power fantasy with anti-snowball.** Kenji #6 growth/crown/aura + my comeback rules: at 5+ cubes you get the crown aura *and* you are briefly revealed through LoS every 10 s ("bounty"). Killing the crowned drops +2 bonus cubes. Visual scale only, fixed hitbox. **S-M**
4. **Arena event deck** (Kenji #27 kit + #29 events + my mutators #7/#15/#16): one server-side "event scheduler" with a deck per map: supply drop at 45 s, meteor shower on Dunes, lightning rod on Grove, blizzard gust on Frost, geysers on Oasis. Each gets 5 s floor telegraphs and a HUD banner (Kenji #32). The weekly mutator = which cards are in the deck. **M** for the scheduler, **S** per card.
5. **Duo Showdown launch package**: my Duo mode + Kenji #14 green team rim + #22 Nurse Kappa (heal mate) + revive with a ghost figurine animation and bark (#31). Launch trailer-worthy. **L**
6. **Mastery & skin track.** My account/mastery progression + Kenji #24 skins generated by the pipeline: each brawler mastery track (levels from damage/KOs/wins with that brawler) unlocks gadget 2, star power 2, then 2 skins with VFX swaps, then a victory emote (#26). Free and cosmetic-only. **L**
7. **Killcam + MVP replay from one ring buffer.** Kenji #34/#35 + my #33/#34: the client keeps 8 s of snapshots + events (already received). On death it shows a killcam of the killer's last 5 s (only what the server sent you, so no leaks; accept holes). At match end it shows an MVP auto-clip + stat cards (damage, cubes, "Vulture" award) with a shareable image. **M-L**
8. **Bot personalities with voices and emotes.** My bot personas (Camper/Hunter/Vulture/Coward/Show-off) × Kenji #31 barks + #26 emote clips: the Show-off emotes after a KO, the Coward squeaks and runs at low HP, the Vulture "hehe" on a third-party KO. Their behaviour is readable through feel. It makes bot lobbies (the real population) feel alive. **M**
9. **Rising Lava Caldera = new closing mechanic.** Kenji #28 Volcano + my gas variants: lava rises by height bands instead of rings, so high ground (a new verticality layer) is the safe zone. Lava cracks erupt on a pattern (telegraphed). It's the first non-mirrored map. **L**
10. **Sky Islands ring-out mutator.** Kenji's fall-off edges + knockback on every brawler's super/gadget → knockback becomes a kill source. Mochi's belly bump shines. It's a weekly event map. **L**
11. **Emote/ping wheel with information fairness.** Kenji #26 emote clips + my pings: the emote plays on your figurine (it reveals you if in a bush, a risk/reward taunt). Pings only in team modes. **S-M**
12. **Low-HP & regen as a readable system.** Kenji #7 low-HP state + my regen (13%/s after 3 s, `brawler.js`): a visible "regen starting" ring timer so players learn the 3 s disengage rule, and enemies see the sweat/limp, which tells them a target is low (in LoS only). It teaches the core loop through feel. **S**
13. **Destructible map landmarks as objectives.** Kenji #18 destruction + #28 landmarks: a central landmark (crashed UFO, giant statue) with high HP. Breaking it releases a cube cluster / super charge for everyone near. It makes a mid-match fight magnet. **M**
14. **Glitch as the mutator host.** Kenji #21 mascot fronts the weekly "Chaos Event" (my #7): menu banner, voice lines, the event's rules "hallucinated" by Glitch. Brand + retention loop in one character. **S** (after Glitch exists; before that, a 2D portrait).

## 3. Re-think of my own list

- **Upgraded**: #11 dodge → merged with Kenji #12 into Kit 2.0 (combined #1); #15 supply drop + #16 weather events + #17 props + #19 gas variants → **one Arena Event Deck** (combined #4); #34 killcam + #33 stats card → combined #7; #22 + #23 bots → combined #8 plus a separate tactical-AI task.
- **Merged**: #9 gadgets + #10 star powers + #12 hypercharge → Kit 2.0 (hypercharge postponed; too much power creep with 5 brawlers). #25 account/mastery + #27 unlock path + #30 cosmetics → Mastery & skin track (combined #6). #28 seasons + #29 bot league → one "Season" wrapper with two ladders (human RP, bot league).
- **Dropped / parked**: #5 16-player Slop Royale (XL, perf on mobile, population). #38 clubs, #37 tournaments (need population). #40 ghost opponents (ethics/complexity). #27 locking brawlers (only 5; locking hurts). #14 ammo variety as a standalone (fold into new brawlers instead).
- **Kept as-is, prioritised up**: #39 backfill at 45-60 s (retention is dead if queues are empty), #41 damage fairness fix (now confirmed), #21 cube rebalance, #42 balance dashboard.
- **Re-sequenced modes**: Duo Showdown first (reuses everything, needs team rim + revive). 3v3 (Knockout, then Slop Grab) only after Duo shows traction. Boss Brawl co-op is a strong low-population answer and stays in the list.

## 4. Current top 15

1. **Fix human damage fairness (`baseDmg` by `human`, not `isPlayer`) + regression test.** Confirmed host advantage on Steam lobbies. It's S and a fairness blocker for any ranked claim.
2. **Matchmaking backfill at 45-60 s + drop-in for late humans.** A 5-min wait kills retention more than any missing feature.
3. **Game-feel core pack (Kenji #1/#2/#3/#11/#7): hitstop, shake, hit-confirm, input buffer, low-HP.** Cheapest large fun gain, client-only, and it makes every later feature land.
4. **Kit 2.0: universal flavoured dash (ground-only) + telegraphed supers.** Adds skill expression and counterplay to Frostbite freeze and meteor. It's the biggest depth gain per line of code.
5. **Account level + per-brawler mastery + daily/weekly quests.** Gives every match (bot matches included) visible progress, which is the missing reason to come back.
6. **Arena Event Deck (supply drop, per-weather events, weekly mutator deck).** Fixes the flat mid-match and gives weekly novelty from one server system.
7. **Cube rebalance + bounty/crown (visual growth, fixed hitbox).** Keeps the snowball exciting but killable, and gives a readable leader to hunt.
8. **Gadgets + star powers (2 each per brawler).** Build choice turns 5 brawlers into about 20 playstyles, and it plugs into the mastery unlocks.
9. **Duo Showdown with revive + team rim outline.** The first social mode that uses what already exists; friends finally have a reason to queue together.
10. **Smarter bots + personalities (tactics: bush ambush, dodge, cube contest, vulture; barks/emotes).** Bot matches are most players' game, so they must be interesting.
11. **Post-match stat cards + MVP awards + killcam.** Learning ("why did I die") and shareable stories, built from the existing event stream.
12. **Audio pass 2.0 (per-brawler sets, footsteps, KO/gas stingers) with LoS-fair occlusion.** Big feel gain and cheap. Footsteps have to follow line of sight so they don't reveal hidden brawlers.
13. **New brawler #6: assassin/melee (Pip & Chomp) with bush-trap super.** Fills the biggest counter-web hole in Showdown and deepens the bush/LoS system.
14. **Season wrapper: human RP ladder + visible Bot League, seasonal rewards.** The recurring chase for both populations.
15. **Balance telemetry dashboard (PostHog win/placement by brawler × map × cubes) + monthly balance patch.** Everything above adds balance surface, so we need the instrument first.

## 5. Open questions for Kenji

1. **Hitstop and slow-mo online**: do you accept that all time effects are client-cosmetic (the sim never pauses), and global KO slow-mo only on the final KO? If yes, can your hitstop still feel right when the snapshot arrives 50-100 ms late (server at 20 Hz)? Local prediction of the hit for your own shots, or only on confirm?
2. **Information vs. juice**: grass parting, footstep dust/prints, offscreen gunfire pings, cube growth and emotes all leak position. Which of these do you consider non-negotiable for feel, and would you accept them being *suppressed* for enemies hidden in bushes / out of LoS (i.e. the rule is "if you can't see them, you can't see their juice")?
3. **Content order**: I want the next brawlers to follow modes (assassin now; tank/healer only after Duo/3v3), and skins only after a progression system exists to earn them. You lead with 5 brawlers + 5 arenas + skins. Would you trade 2 new arenas for the **Arena Event Deck on the 5 existing arenas** plus **one** template-breaking map (Caldera or Sky Islands), and which one?
