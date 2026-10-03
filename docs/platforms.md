# Platforms

One game, one codebase (`src/`), several shells:

| Platform | Shell | Build | Online play |
| --- | --- | --- | --- |
| Web | the site itself | `npm run deploy` | Cloudflare rooms |
| Steam (Windows, Linux) | Electron + steamworks.js | `npm run dist:steam` | Steam lobbies (P2P) + cross-play rooms |
| Epic Games Store (Windows) | Electron, Steam left out | `npm run dist:epic` | Cloudflare rooms (cross-play) |
| Android | Capacitor | `npm run android:apk` | Cloudflare rooms (cross-play) |
| iOS / iPadOS | Capacitor | `npm run ios` (on a Mac) | Cloudflare rooms (cross-play) |

Every version can meet every other one through matchmaking or in a room created on our server
(a "cross-play room" on Steam, a normal room everywhere else); the server runs those matches.
Steam lobbies are Steam-only and hosted by a player. See [moderation.md](moderation.md).

GitHub builds all of them: see [Releases](#releases) below.

## Android and iOS

`vite build --mode app` builds only the game (as `index.html`, without the showcase site) into
`dist-app/`; [Capacitor](https://capacitorjs.com) copies it into the native projects in `android/`
and `ios/` (`npm run app:build` = build + `cap sync`).

- Touch controls (`src/touch.js`): floating move stick, attack stick (tap = nearest enemy, drag =
  aim, release = fire), super button, pause button. Gamepads work too.
- Phones start on the Low graphics preset; landscape only, full screen, notch-safe HUD.
- Icons and splash screens come from `assets/` (`npx capacitor-assets generate`).
- Android: achievements on Google Play Games (sign-in, the Steam achievements, an *ACHIEVEMENTS*
  button in the menu): setup in [play/README.md](../play/README.md).

**Android**: needs JDK 21 and the Android SDK (Android Studio installs both).
`npm run android:apk` builds a debug APK in `android/app/build/outputs/apk/debug/`;
`npm run android` opens the project in Android Studio. For Google Play, build a signed App
Bundle (Build → Generate Signed App Bundle) with your upload key.

**iOS**: needs a Mac with Xcode. `npm run ios` opens the project in Xcode; set your team in
Signing & Capabilities, then Product → Archive to upload to App Store Connect / TestFlight.

## Epic Games Store

`npm run dist:epic` packages the desktop app flagged `"store": "epic"` (`electron/builder-epic.cjs`)
into `release/epic/win-unpacked`: Steam is never loaded and steamworks.js is not shipped.
The Epic launcher's `-epicusername` and `-epiclocale` arguments give the default nickname and the
game language. Upload the folder with Epic's BuildPatchTool from the Epic Developer Portal and set
the launch executable to `AISlopArena.exe`.

Not in yet: Epic Online Services (Epic achievements, friends, invites). The platform layer
(`src/platform.js`) is where an EOS bridge would plug in, like `steamnet.js` does for Steam.

## Releases

Pushing a tag `v*` (e.g. `git tag v0.2.0 && git push origin v0.2.0`) runs
`.github/workflows/release.yml`, which exports the **Godot client** (`godot/`, Godot 4.4.1 in the
`barichello/godot-ci` container) for every platform and attaches it to a GitHub release:

| File | What |
| --- | --- |
| `AISlopArena-steam-windows.zip` | preset "Windows (Steam)", Windows x64 (exe + pck) |
| `AISlopArena-steam-linux.tar.gz` | preset "Linux (Steam)", Linux x64 |
| `AISlopArena-epic-windows.zip` | preset "Windows (Epic)", Windows x64 |
| `AISlopArena-android.apk` | preset "Android" (arm64 + armv7), signed with the Play upload key, installable directly (debug-signed when the signing secrets are missing) |
| `AISlopArena-android.aab` | preset "Android (Play)" (+ x86_64), the bundle to upload by hand in the Play Console (only with the signing secrets) |
| `AISlopArena-ios-simulator.zip` | Godot's Xcode project built for the simulator on macOS (unsigned: a device / App Store build needs the Apple certificates) |
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
