# Online play, anti-cheat and moderation

## Who runs the match

| Room | Runs the match | Players |
| --- | --- | --- |
| **Matchmaking** ("Find a match") | our server (Room Durable Object) | every platform, one queue |
| **Web room** (room code, cross-play room on Steam) | our server | every platform |
| **Steam lobby** (friends, invites) | the lobby owner, peer-to-peer | Steam only |

On the server, `worker/build/sim.js` is the game itself (`src/game.js` and friends) built headless
by `vite build --mode server` (`src/server/`): the same rules as the clients, no rendering. Players
only send inputs; the server plays every hit, knock-out and power cube.

## Anti-cheat

- **Movement**: players move themselves (smooth on their screen), but every step is checked
  (speed with a margin, walls, arena bounds, frozen, knockback allowance). A refused step snaps
  the player back. 25 refused steps in a match: kicked (`kicked: cheat`).
- **Attacks**: go through the host's rules like the bots' (ammo, cooldown, super charge).
- **Inputs**: rate-limited (45/s per player in the game, 60 messages/s per socket on the server)
  and sanitised (aim normalised, aim point within reach).
- **Wallhack**: each player receives only the brawlers they can see; bushes and fog are enforced
  by the server, not hidden on the client.
- **Old clients** (protocol < 2) are refused with an "update" message.
- Steam lobbies get the same movement checks and per-player snapshots from the host, but a host
  can still cheat there: it is a friends-only mode.

## Matchmaking

One global queue (Matchmaker Durable Object) for web, Steam, Epic, Android and iOS:
8 players -> match right away; otherwise, once the oldest player has waited **5 minutes**, whoever
is in the queue plays and **bots fill** the empty slots. "Play now with bots" skips the wait for one
player. Matched players get a room code and the room starts when everyone is in (or after 15 s).

## Ranking

Every player has two numbers, kept by the server only (`Players` object, maths in `worker/ranking.js`):

| | Hidden **MMR** | Visible **RP** + tier |
| --- | --- | --- |
| What for | matchmaking groups close MMRs; the bots of a match are tuned to it | what players see: 🥉 Bronze 0, 🥈 Silver 200, 🥇 Gold 500, 💎 Diamond 900, 🔮 Mythic 1400, 👑 Legend 2000 RP |
| Moves in | every matchmade match (Elo-style, vs the lobby average; faster for the first 10 matches) | matchmade matches with **2+ humans** only (1st +30 ... 8th -12, never below 0) |
| Shown | never (admin API only) | online menu, queue screen, result screen |

- Alone with bots ("play now with bots" or the 5-minute fallback), a match is practice: the MMR still
  adapts (so the bots stay right), the RP do not move, so nobody can farm bots.
- RP drift toward the MMR: underrated players (RP well below what their MMR suggests) gain 1.5x,
  overrated ones lose 1.5x.
- Matchmaking window: MMRs within 150, growing by 2.5 per second of the oldest player's wait; at 5 minutes
  the closest ones play and bots fill up.
- The bots' difficulty is never chosen by the player: matchmaking uses the group's MMR, solo and
  private rooms a hidden level kept on the device (`src/skill.js`) that follows the results.
- Private rooms and Steam lobbies are unranked.

## Moderation

- **Report** (⚑ next to a player in the room): cheating / offensive name / bad behaviour.
  Steam lobbies report through `POST /api/report`. At most 20 reports per player per day.
- **Remove** (✕, room leader only, not in matchmade rooms): the player cannot come back to that room.
- **Automatic bans**
  - **Reports are a share of the matches played**, so a few sore losers cannot ban a good player.
    Over the last 7 days, a player is banned when all of this holds:
    at least **10 matches** played on our server, reported in at least **30%** of them, by at least
    **4 different players**. A match counts once however many people report it, and one player
    reports someone once per match. First time: 24 h; again within 30 days: 7 days.
    The rule runs after every report and every match of a reported player.
  - **Cheating proven by the server**: kicked 3 times for impossible moves within 7 days -> device
    **and IP** banned for 7 days (only proven cheating bans an IP: IPs are often shared).
  - Steam lobby reports are only recorded (the server does not see those matches): review them in
    `/admin/reports` and ban by hand.
  - The thresholds are constants at the top of the Moderation class in `worker/index.js`.
- Players have no account: bans use a random id stored on the device (`cid:`) and, for cheating,
  a hash of the IP (`ip:`; the IP itself is never stored). Steam lobby reports use `steam:<id>`.

### Admin API

Create the token once (Cloudflare keeps it secret, the API does not exist without it):

```bash
npx wrangler secret put ADMIN_TOKEN
```

Then, with `Authorization: Bearer <token>`:

```bash
# top players (MMR + RP)
curl -H "Authorization: Bearer $TOKEN" https://ai-slop-arena.gtux-prog.workers.dev/admin/players
# reported players (grouped, with matches played / reported / reporters over 7 days), bans
curl -H "Authorization: Bearer $TOKEN" https://ai-slop-arena.gtux-prog.workers.dev/admin/reports
# ban a device (days: 0 = forever; add "ip": "<ip:...>" from the report to ban the IP too)
curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"key":"cid:...","days":7,"reason":"cheating"}' https://ai-slop-arena.gtux-prog.workers.dev/admin/ban
# lift a ban
curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"key":"cid:..."}' https://ai-slop-arena.gtux-prog.workers.dev/admin/unban
```

## Bug reports

Players send them from the pause menu, the result screen, **F8** anywhere, or the prompt that
appears when the game hits an error (once per session). A report holds what they wrote, a 640 px
screenshot of the game view (optional) and technical details: version, platform, language,
graphics card and quality, FPS, map, online room, the last errors. At most 10 per day per sender.

```bash
curl -H "Authorization: Bearer $TOKEN" https://ai-slop-arena.gtux-prog.workers.dev/admin/bugs            # all (or ?status=new)
curl -H "Authorization: Bearer $TOKEN" https://ai-slop-arena.gtux-prog.workers.dev/admin/bugs/12/shot -o bug12.jpg
curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"id":12,"status":"done"}' https://ai-slop-arena.gtux-prog.workers.dev/admin/bug
```

## Testing locally

```bash
npm run dev          # the game on :5173
npm run dev:server   # builds worker/build/sim.js, then the server on :8787
```

`npx wrangler dev --var QUEUE_BOTS_AFTER_MS:6000 --var ADMIN_TOKEN:test` shortens the matchmaking
wait to 6 s and enables the admin API with the token `test`, for tests only.
