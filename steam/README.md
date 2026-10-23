# Steam release

The game is the Godot client (`godot/`); the Steam builds are its "Windows (Steam)" and "Linux (Steam)"
presets (CI: `.github/workflows/release.yml`). Steam features come from the
[GodotSteam](https://codeberg.org/godotsteam/godotsteam) GDExtension over Steamworks SDK 1.65:

| Feature | How |
| --- | --- |
| **Achievements + stats** | `godot/scripts/achievements.gd` (the 15 achievements and 6 stats of `src/achievements.json`, fed by `main.gd` from the match events). Progress is kept in the profile and mirrored to Steam, so anything earned offline unlocks the next time Steam is running. |
| **Language** | The game follows the language picked in Steam (Properties > Language), else the system language; Options > Language overrides it. |
| **Rich presence + friends** | "In the menu / Looking for a match / In a lobby / In a match" (`rich_presence.vdf`). In a private room the friends list shows *Join game* and Steam's invite dialog works: the `connect` value starts the game with `-- --room=CODE`, or reaches the running game, which opens that room. |
| **Overlay** | Shift+Tab, works in the exported build (not in the editor). |
| **Online play** | Not Steam networking: matches run on the Cloudflare rooms server like on every platform (cross-play with web, Epic, Android, iOS). |

Everything lives in `godot/scripts/steam_platform.gd`, which talks to the extension through
`Engine.get_singleton("Steam")`: without the extension (web, mobile, Epic, a checkout that did not
install it) or without Steam running, the game plays the same and progress is only kept locally.

## Run it

The plugin and the Steamworks redistributables (`steam_api64.dll`, `libsteam_api.so`) are **not
committed** (the repository is public, the redistributables belong to Valve's SDK licence). Install the
plugin once per checkout, with the `sdk` folder of the Steamworks SDK zip:

```
npm run godot:steam -- --sdk C:\path\to\steamworks_sdk\sdk     # or set STEAMWORKS_SDK
```

It downloads GodotSteam 4.23.2 into `godot/addons/godotsteam/` (git-ignored) and copies the SDK's
redistributables over the plugin's. Then open `godot/` in Godot 4.5 with Steam running and the game
connects to Steam as app 480. Only the Steam presets pack the plugin (`addons/godotsteam/*` is excluded
from the others; Epic builds never start Steam). CI runs the same script without `--sdk`: the plugin zip's
own redistributables are used, and a warning says so when it has none. The plugin zip is pinned by its
sha256 (`SHA256` in `scripts/fetch-godotsteam.mjs`, empty until the first download was checked: the script
prints the hash and stops, `--allow-unpinned` goes on anyway for a local try). The release workflow fails
when the Steam exports lack the `steam_api` libraries, and ships the whole export folder.

Test checks: `node tests/steam.test.mjs` (in `npm test`) for the shared data, and
`godot --headless --path godot --script tools/test_steam.gd` for the achievements rules and the Steam
sink against a stand-in for the extension.

The app id is `steam.appId` in `package.json` (`node godot/tools/export-data.mjs` copies it to
`godot/data/steam.json`; the `STEAM_APP_ID` environment variable overrides it for a test run). It is
**480 (Spacewar)**, Valve's public test app, until you have your own: the overlay, rich presence and
friends all work with 480, but our achievements do not exist there, so they are only kept locally. With a
real app id a shipped build started outside Steam relaunches itself through Steam.

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

   `WORLD_TOUR` and `JACK_OF_ALL` count every arena (6) and every brawler (8) the game has today, read
   from the game data: their texts still say "five" (`src/achievements.json`, the locales and the
   Steamworks page).

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
6. Put your app id in `package.json` (`steam.appId`, then `node godot/tools/export-data.mjs`) and in
   `steam/app_build.vdf` (with your depot ids), set the launch option to `AISlopArena.exe`.
7. **Rich presence localization** (Community > Rich Presence): upload `steam/rich_presence.vdf`
   (English; other languages can be added there, the tokens are `#Status_Menu`, `#Status_Queue`,
   `#Status_Lobby`, `#Status_Match`).
8. **Build and upload**: the release workflow attaches `AISlopArena-steam-windows.zip` and
   `AISlopArena-steam-linux.tar.gz`; unzip them into `steam/build/windows` / `steam/build/linux` (they
   hold the exe or binary, the `.pck` and, with the plugin, the `addons` folder next to them: keep every
   file) and run:

   ```
   steamcmd +login <builder account> +run_app_build %CD%\steam\app_build.vdf +quit
   ```

   Ship no `steam_appid.txt`.

## Store page

Texts in the 30 Steam languages, tags, required images, AI disclosure, trailer, achievement icons and the launch checklist: [store/README.md](store/README.md).
