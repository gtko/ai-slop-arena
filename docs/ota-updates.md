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
   - `notifyAppReady()` at once, so a bundle that boots is kept. A bundle that never gets there is
     rolled back by the plugin after `appReadyTimeout` (15 s, `capacitor.config.json`), and the app
     remembers that version as failed (localStorage) so it does not download it again.
   - If a newer bundle was downloaded during an earlier session, the app switches to it right away,
     at launch, while the menu is up (`CapacitorUpdater.set`, one quick reload). Never during a match.
   - Otherwise it reads the manifest in the background. When the version is newer than the running
     bundle (`package.json` version, compiled in), the shell is at least `minNative`, and it never
     failed here, it downloads the zip (skipped with the system's data saver) and shows a small
     toast "Update ready: restart the game to apply it". The update applies at the next launch.
   - Every failure (offline, 404, broken zip) is silent; the next launch retries.
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

The shell's own version: Android's `versionName` follows package.json (`android/app/build.gradle`); the
iOS release workflow passes `MARKETING_VERSION` from package.json. The app also records the version of
its built-in bundle while running it, which is the shell's version on both platforms.

## Privacy

The plugin runs in manual mode: `autoUpdate: false`, and `updateUrl`, `statsUrl`, `channelUrl` are empty,
so it never contacts Capgo's servers (no stats, no channels). The only requests are our manifest and
the GitHub release download.

## Limits

- The whole bundle (~60 MB, mostly 3D assets) is downloaded for each release; there are no deltas.
- Only apps built with the plugin update this way: players on an older APK install a new one once.
- The Play Store / App Store builds still need a store upload when the native side changes.
