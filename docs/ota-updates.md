# Over-the-air updates of the mobile apps

The Android and iOS apps are a native shell (Capacitor) around the game's web bundle (`dist-app/`,
`npx vite build --mode app`). Since the shell carries `@capgo/capacitor-updater`, a new release reaches
installed apps without a new APK: the apps download the new web bundle themselves. Browsers, Steam,
Epic and Electron never run this code.

## How an update flows

1. **Release** (`.claude/skills/release/SKILL.md`): `npm run deploy` puts the new Worker live, then the
   tag's workflow (`.github/workflows/release.yml`, android job) zips `dist-app/` (index.html at the
   root) as the GitHub release asset `AISlopArena-app-bundle.zip`.
2. **Manifest**: the Worker answers `GET /app/latest.json` (CORS open, cached 5 min):
   `{ "version": "<package.json version>", "url": "https://github.com/gtko/ai-slop-arena/releases/download/v<version>/AISlopArena-app-bundle.zip", "minNative": "<MIN_NATIVE>" }`.
   Between the deploy and the end of the release workflow the zip is still missing: apps get a 404
   and try again at their next launch.
3. **In the app** (`src/ota.js`, started by `src/main.js` on native only):
   - At launch, if a newer bundle was downloaded during an earlier session, the app switches to it
     right away, before the loader (`CapacitorUpdater.set`, one reload). Never during a match.
   - Once the loader is done (textures, figurines, menu shown) it calls `notifyAppReady()`, so a bundle
     that loads is kept. One that never gets there is rolled back by the plugin after `appReadyTimeout`
     (45 s, `capacitor.config.json`, for slow tablets).
   - Then it waits for the home screen (no match, room or matchmaking queue) and Wi-Fi
     (`@capacitor/network`), reads the manifest, and when the version is newer than the running bundle
     (`package.json` version, compiled in) and the shell is at least `minNative`, downloads the zip.
     The plugin cannot pause a download: it only *starts* on the home screen; a match started meanwhile
     does not stop it. A small toast "Update ready: restart the game to apply it" shows on the home
     screen; the update applies at the next launch.
   - Every failure (offline, 404, broken zip) is silent and retried at the next launch, with limits kept
     per version in localStorage (`iaslop-ota`): a download that never finishes (unzip error, full
     storage, app killed) is started at most twice; a bundle that does not boot after the switch gets a
     second chance (it may just have been backgrounded mid-reload), then is given up on. A newer release
     starts afresh.
4. **Online**: the server refuses outdated clients (`PROTOCOL` in `src/net.js` and `worker/index.js`).
   On mobile the message says an update is on its way and to restart, since the fix arrives by itself.

Version logic, manifest checks and the failed-bundle memory are in `src/updates.js`, tested by
`tests/updates.test.mjs` (part of `npm test`).

## minNative: when the native side changes

`MIN_NATIVE` in `src/updates.js` is the oldest native shell able to run the current web bundle. Raise
it **to the version being released** whenever that release adds, removes or upgrades a native plugin
(`@capacitor/*`, `@capgo/*` in package.json) or changes `android/` / `ios/` in a way the JS relies on.
Older shells then keep their current bundle, and their players need the new APK / store build (say so
in the release notes). JS, CSS, assets, translations and game rules never need it.

The shell's own version and build number follow package.json on both platforms: Android's
`versionName` / `versionCode` (`android/app/build.gradle`), iOS's `MARKETING_VERSION` /
`CURRENT_PROJECT_VERSION` written into the Xcode project by `scripts/native-version.mjs` (run by
`npm run app:build` and the release workflow; `npm test` fails when the project is out of sync, run
`npm run native:version` after a version bump). Build number = major*10000 + minor*100 + patch. It must
grow with every store build: the updater drops downloaded bundles when it changes, so a new store build
starts from its own bundle. The app uses the version the OS reports, or, when that is not x.y.z (an old
iOS build said "1.0"), the version it recorded while running its built-in bundle.

## Privacy

The plugin runs in manual mode: `autoUpdate: false`, and `updateUrl`, `statsUrl`, `channelUrl` are empty,
so it never contacts Capgo's servers (no stats, no channels). The only requests are our manifest and
the GitHub release download.

## Limits

- The whole bundle (~60 MB, mostly 3D assets) is downloaded for each release, on Wi-Fi only; no deltas.
- Only apps built with the plugin update this way: players on an older APK install a new one once.
- The Play Store / App Store builds still need a store upload when the native side changes.
