# Platforms

One game client, the Godot 4 project in `godot/` (see [godot/README.md](../godot/README.md)), exported
for every platform; one server, the Cloudflare Worker (`worker/index.js`) that runs every online match
with the shared rules of `src/` (`src/server/sim.js`).

| Platform | Build | Online play |
| --- | --- | --- |
| Web | Godot "Web" preset, uploaded to R2 by `npm run deploy:godot-web`, served at `/godot/<version>/` | Cloudflare rooms |
| Steam (Windows, Linux) | Godot "Windows (Steam)" / "Linux (Steam)" presets | Cloudflare rooms (cross-play) |
| Epic Games Store (Windows) | Godot "Windows (Epic)" preset | Cloudflare rooms (cross-play) |
| Android | Godot "Android" preset (Gradle build, `com.aislop.arena`) | Cloudflare rooms (cross-play) |
| iOS / iPadOS | Godot "iOS" preset (Xcode project, on a Mac) | Cloudflare rooms (cross-play) |

Every version meets every other one through matchmaking or in a room by code; the server runs those
matches, validates every move and sends each player only what they can see ([moderation.md](moderation.md)).

## Web

The site (`index.html`, `roadmap.html`, `src/site/`, `public/privacy.html`) is a Vite build served as
Worker static assets (`npm run deploy`). The game's URL is **`/play`**: the Worker redirects `/play`,
`/play.html` and `/play/...` to `/godot/<version of the deployed worker>/` with the query kept, so the
site's Play buttons and the old invite links (`/play?room=CODE`) land on the Godot client, which joins
the room of a `?room=` link at launch (`main.gd` `_join_invite`).

Players of the old three.js web client keep their progress: it ran on the same origin and kept
everything in `localStorage`; at its first launch the Godot web client imports those keys into its own
saves (`godot/scripts/legacy_import.gd`: profile, coins, gems, owned items, trophies, the `cid` the
server's rank and bans are keyed by, name, brawler, mode, settings, audio mix).

## Store builds

The release workflow (`.github/workflows/release.yml`, the Godot jobs) exports the presets of
`godot/export_presets.cfg` and attaches the builds to the GitHub release of the tag; the store uploads
(SteamPipe, Epic BuildPatchTool, Play Console, App Store Connect) are done from those builds. Store
metadata lives in `steam/`, `google-play/` and `play/` (Play Games achievements); the desktop icons
in `assets/app-icons/` (written by `art-src/make_app_art.py`).

The old Electron (Steam, Epic) and Capacitor (Android, iOS) shells of the three.js client are gone.
The Android app already on Google Play (Capacitor, up to v0.17.1) is replaced in place by the Godot
build (same package `com.aislop.arena`, same upload key, higher versionCode); until then it keeps
running its last web bundle ([ota-updates.md](ota-updates.md)).

## Releases

Pushing a tag `v*` (e.g. `git tag v0.2.0 && git push origin v0.2.0`) runs
`.github/workflows/release.yml`, which exports the **Godot client** (`godot/`, Godot 4.5.2 in the
`barichello/godot-ci` container) for every platform and attaches it to a GitHub release:

| File | What |
| --- | --- |
| `AISlopArena-steam-windows.zip` | preset "Windows (Steam)", Windows x64 (exe + pck) |
| `AISlopArena-steam-linux.tar.gz` | preset "Linux (Steam)", Linux x64 |
| `AISlopArena-epic-windows.zip` | preset "Windows (Epic)", Windows x64 |
| `AISlopArena-android.apk` | preset "Android" (arm64 + armv7), signed with the Play upload key, installable directly (debug-signed when the signing secrets are missing) |
| `AISlopArena-android.aab` | preset "Android (Play)" (+ x86_64), the bundle to upload by hand in the Play Console (only with the signing secrets) |
| `AISlopArena-ios-simulator.zip` | Godot's Xcode project built for the simulator on macOS (x86_64, the only simulator architecture Godot's library links, still in 4.5.2; Rosetta on Apple silicon; MetalFX left out; unsigned: a device / App Store build needs the Apple certificates) |
| `AISlopArena-web.zip` | the Godot web export alone, to self-host (the live one is uploaded to R2 by `npm run deploy:godot-web`) |

Versions come from `package.json` (`npm run godot:version`, run by the workflow too): Android
versionCode and iOS build number `(major*10000 + minor*100 + patch)*100 + 99` (`+N` for `-beta.N`),
above the Capacitor app's codes so Play takes the Godot build as an update of `com.aislop.arena`.
Android signing uses the GitHub secrets `ANDROID_UPLOAD_KEYSTORE_B64`, `ANDROID_UPLOAD_ALIAS`,
`ANDROID_UPLOAD_PASSWORD` (see `.claude/skills/release/SKILL.md`).

The workflow can also be started by hand: `gh workflow run release.yml --ref <branch>` is a dry run
(everything is built, the builds are the run's artifacts, no release); `-f tag=vX.Y.Z -f dry_run=false`
publishes.

**Release notes**: write `docs/releases/<tag>.md` before tagging (banner and infographics from
`art-src/make_release_art.py`, see [CHANGELOG.md](../CHANGELOG.md)); the workflow uses it as the
release description, or GitHub's generated notes when the file does not exist.
