# AI SLOP ARENA, Godot 4 client (comparison branch)

A Godot 4.4 client for the **existing** game server. Nothing of the rules is ported: the Cloudflare
room (`worker/index.js`) runs every match with the same `Game` code as the web build, and this
client only renders snapshots and sends inputs (protocol v6, see `scripts/net_client.gd`). So the
Godot build and the three.js builds can play in the same room (cross-play).

## Run

```bash
node godot/tools/export-data.mjs       # maps.json + brawlers.json from src/ (re-run when maps/stats change)
cd godot/tools && npm i && node convert-models.mjs && cd ..   # meshopt GLBs -> plain GLBs for Godot
godot --path godot                      # desktop (Godot 4.4+)
```

![Godot client, first render](../docs/godot-shot.png)

Server: leave the default (production) or run `npm run dev:server` and type `ws://localhost:8787`.
Headless end-to-end check against a running server:

```bash
godot --headless --path godot -- --autotest ws://localhost:8787
```

## What is in

Everything is a client of the existing server (protocol v6, cross-play with the three.js builds).

- **Flow:** main menu (brawler picker with 3D preview, loadout, profile icon, settings), quick play through the
  ranked party queue with bots, private rooms by code (leader: map, Solo/Duo, chaos, kick), loading,
  countdown, match, result screen, reconnect. 30 locales exported from `src/i18n` (EN/FR complete for the
  Godot-only strings, others fall back to EN).
- **World:** the 6 maps from the JS grids, sculpted props and brawlers (GLB, skeleton animations), map kit
  (jump pads, bridges, void, crumbling isles, barrels, mushrooms, traps, ice), water, weather (rain, snow,
  sandstorm, fog), times of day, foliage sway, fauna, skins/recolours/trails.
- **Combat feedback:** HUD (HP, ammo, super, gadget, cubes, alive, kill feed, damage numbers, hit flash,
  vignette), gas ring, fog of war visuals, emotes, pings, pause, result overlay.
- **Audio:** the web game's SFX and music (OGG), pooled voices, ducking, per-map ambience.
- **Input:** touch sticks + buttons; keyboard/mouse with the web's rebindable keys (`controls.gd`: InputMap
  actions `game_*`, physical keys so W A S D is Z Q S D on AZERTY); gamepad like the web (left stick walks, right
  stick aims, RT attack, RB / LT super, LB gadget, R3 emotes, X ping, Y time of day, Start pause, rumble) and
  console-like menu navigation (arrows / D-pad, Enter / A, Esc / B, focus ring).
- **Options** (`settings_view.gd`, the web's #options): General, Graphics (preset + custom values, window mode,
  vsync, fps cap, render scale, MSAA / FXAA, brightness, time of day, shadows, bloom, dynamic lights, weather),
  Audio, Controls (key rebinding), Gamepad (dead zone, vibration, aim assist). Shots: `--menushot=<png>
  --overlay=settings --tab=graphics [--capture] [--padnav=rb,down,right]`; `--autotest ... --keytest` presses
  every shortcut and prints KEYTEST lines.
- **Power:** Low/Medium/High/Ultra (`Quality`), battery saver (30 fps, 0.7 render scale, no shadow map, 25 % particles),
  5 fps in the background, menus stop 3D rendering.

## Verified vs not

Verified here (software GL renderer, llvmpipe): all 6 maps play against the local server with snapshots,
web export runs in Chromium against the server, Linux export runs, the menu, lobby, quick play with bots.
Also verified: the web export in a mobile-emulated Chromium (Android UA, touch, 844x390 landscape): real
touch events move the player (left stick), aim and fire (right stick), and a full match runs to the K.O.
result screen. That run found and fixed a real bug (the touch control had a zero size on web).
Test: `node` + playwright-core, page `?autotest&realinput&map=grove&server=ws://host:8787`.
**Not verified:** any real phone (touch, thermals, battery, Vulkan/Metal Mobile renderer), Android and iOS
exports (no SDK here: `.github/workflows/godot.yml` builds the APK on GitHub), audible sound, CJK/Arabic fonts,
gadget dashes and jump pads against the live server, Steam / Play Games hooks, cosmetics unlock rules.

## Android APK (built here, not run on a device)

An arm64 debug APK (85 MB, signed, verified with `apksigner`) is produced without the Google SDK
downloads: Ubuntu's `apksigner zipalign adb` packages provide build-tools, plus a debug keystore and
the editor settings `export/android/android_sdk_path`, `java_sdk_path`, `debug_keystore*`. Then:
`godot --headless --path godot --export-debug "Android" build/android/ai-slop-arena.apk`
(export templates 4.4.1 installed). Install with `adb install -r`. iOS needs a Mac with Xcode.

## Web hosting note

The exported `index.pck` (about 70 MB) and `index.wasm` (44 MB, 9 MB gzipped) exceed Cloudflare Workers
static assets' 25 MiB per-file limit, so the web export lives in the R2 bucket `ai-slop-arena-godot-web`
(binding `GODOT_WEB` in `wrangler.jsonc`) and the site's Worker serves it at **`/godot/`**
(`worker/godot-web.js`):

- every release uploads under its own prefix `godot/<version>/`, so a new release never mixes files;
  `/godot/` redirects to `/godot/<version of the deployed worker>/` (query string kept), so the Godot
  client always speaks the protocol of the rooms server it lands on (it connects to the page's own origin,
  `net_client.gd` `default_origin()`). `GODOT_WEB_VERSION` (a wrangler var) can pin another version;
- text and binary files are stored gzipped (`Content-Encoding` metadata) and sent as they are,
  `index.wasm` as `application/wasm` (streaming compile); versioned files are cached for a year
  (`immutable`), with ETag / 304 and ranges on the uncompressed files.

`npm run deploy:godot-web` exports the Web preset (local Godot, or the `GODOT` env var), gzips and
uploads to production R2 under the `package.json` version (it refuses to overwrite an uploaded version
without `--force`). `-- --local` uploads to the local R2 of `wrangler dev` instead, to test:
`npm run deploy:godot-web -- --local && npx wrangler dev --port 8789`, then open
`http://localhost:8789/godot/`. Web builds use the no-threads template so they work on iOS Safari without
cross-origin isolation headers.

## Fonts on phones and the web

Android and the web export cannot use the OS fonts, so the client bundles what the OS used to supply,
as fallbacks of Lilita One / Nunito (`scripts/fonts.gd`): Noto Color Emoji cut to the game's emoji
(`tools/subset-emoji.py`, 1.5 MB instead of 25; re-run it after adding an emoji), Noto Sans Symbols
1 + 2 (arrows, check marks), Inter (Greek, Cyrillic titles), Noto Sans Arabic and Thai (OFL, from
Blender's `datafiles/fonts`), their line metrics cut to Lilita's by `tools/fit-font-metrics.mjs`
(Godot sizes every line by the tallest font of the fallback chain). CJK is not bundled (Noto Sans CJK
is 11 MB): desktop and Android take it from the OS, the web export shows boxes. `--nosysfont` /
`?nosysfont` turns the OS fallback off on desktop to check a screen as a phone draws it.

## Export

`export_presets.cfg` has Web, Android, iOS, Linux and Windows presets (install the matching Godot
export templates first; Android needs the SDK + a keystore, iOS needs a Mac). Example:
`godot --headless --path godot --export-release "Web" build/web/index.html`.
The web preset uses the Compatibility (WebGL2) renderer automatically; native targets use Mobile
(Vulkan / Metal).
