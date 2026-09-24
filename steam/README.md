# Steam release

The desktop app is the same game as the website, wrapped in Electron (`electron/`) with
[steamworks.js](https://github.com/ceifa/steamworks.js) for the Steam features:

| Feature | How |
| --- | --- |
| **Achievements + stats** | `src/achievements.js`. Progress is kept locally and mirrored to Steam, so anything earned offline unlocks the next time Steam is running. |
| **Friends** | Online rooms are Steam lobbies: *Invite Steam friends* opens the overlay invite dialog, friends can *Join game* from their friends list (running or not: `+connect_lobby`), and rich presence shows what you are doing and groups you with your party. |
| **Networking** | `src/steamnet.js`: the lobby owner hosts the match and everyone talks to them over Steam P2P (relayed by Steam, no port forwarding, no server). Host leaves > Steam hands the lobby to someone else, who takes over. Room codes still work. |
| **Cross-play** | On Steam, *Cross-play room* creates a room on the website's relay instead of a Steam lobby: browser players join it with its code or link. Joining by code tries Steam lobbies first, then web rooms, so Steam players can also enter any browser room. |
| **Overlay** | Shift+Tab, enabled in `electron/main.cjs`. |
| **30 languages** | Every language Steam supports (`src/i18n/`). The game follows the language picked for it in Steam, else the system language; Options > Language overrides it. |

Without Steam running, the app still works: online play falls back to the Cloudflare rooms of
the website and achievements are only tracked locally.

## Run it

```
npm run desktop        # build, then open the desktop app (Steam must be running for Steam features)
npm run desktop:dev    # against `npm run dev` for live page reloads
npm run dist:steam     # packaged Windows build in release/win-unpacked (dist:steam:linux for Linux)
```

The app id is `steam.appId` in `package.json` (or the `STEAM_APP_ID` environment variable). The
website reads it too: once it is not 480, every Steam button on the site links to the store page.
It is **480 (Spacewar)**, Valve's public test app, until you have your own: lobbies, P2P, the
overlay and rich presence all work with 480, but our achievements do not exist there, so
`activate()` returns false (local progress is kept anyway). With a real app id, a packaged build
started outside Steam relaunches itself through Steam.

## Steamworks setup (partner.steamgames.com)

1. **Achievements** (Stats & Achievements > Achievements), API names must match exactly:

   | API name | Name | Description |
   | --- | --- | --- |
   | `FIRST_KO` | First Blood | Knock out a brawler. |
   | `FIRST_WIN` | Last One Standing | Win a match. |
   | `RAMPAGE` | Rampage | Knock out 3 brawlers in one match. |
   | `POWER_HUNGRY` | Power Hungry | Hold 8 power cubes in one match. |
   | `ONLINE_WIN` | Crowd Pleaser | Win an online match against another human. |
   | `SQUAD_UP` | Squad Up | Play an online match with a friend. |
   | `WORLD_TOUR` | World Tour | Play on all five arenas. |
   | `JACK_OF_ALL` | Jack of All Slops | Win a match with each of the five brawlers. |
   | `VETERAN` | Veteran | Play 25 matches. |
   | `CENTURION` | Centurion | Knock out 100 brawlers. |
   | `PODIUM` | Podium Finish | Finish a match in the top 3. |
   | `SUPER_KO` | Super Finish | Knock out a brawler with your super. |
   | `NIGHT_OWL` | Night Owl | Win a match at night. |
   | `CRATE_CRUSHER` | Crate Crusher | Break 50 crates. |
   | `CHAMPION` | Champion | Win 10 matches. |

2. **Stats** (INT, set by client): `MATCHES`, `WINS`, `KOS`, `MAPS_MASK`, `WINS_MASK`, `CRATES`.
   Optionally tie `VETERAN` to `MATCHES` (25), `CENTURION` to `KOS` (100), `CRATE_CRUSHER` to
   `CRATES` (50) and `CHAMPION` to `WINS` (10) to show progress bars.
3. **Achievement translations**: `node steam/gen-loc.mjs` writes `steam/achievements_loc.vdf` (all 30
   languages, from `src/i18n/locales`); import it on the Achievements page. Its tokens assume the
   achievements were created in the order of the table above (NEW_ACHIEVEMENT_1_0, 1_1...):
   export the localization file once from Steamworks to check.
4. **Supported languages**: tick all 30 languages (interface + subtitles) on the store page so
   Steam offers them in the game's Language property.
5. **Publish** the Stats & Achievements changes.
6. Put your app id in `package.json` (`steam.appId`) and in `steam/app_build.vdf` (with your depot id),
   set the launch option to `AISlopArena.exe`, then:

   ```
   npm run dist:steam
   steamcmd +login <builder account> +run_app_build %CD%\steam\app_build.vdf +quit
   ```

## Store page

Texts in the 30 Steam languages, tags, required images, AI disclosure, trailer, achievement icons and the launch checklist: [store/README.md](store/README.md).
