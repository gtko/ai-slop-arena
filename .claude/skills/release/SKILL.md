---
name: release
description: Ship a new version of AI SLOP ARENA end to end - tests, version bump, graphic release notes, Cloudflare deploy, git tag, GitHub release with every platform build (Steam, Epic, Android, iOS, web), then verification. Use when the user asks to release, publish a version, "faire une release", tag vX.Y.Z or ship to GitHub.
---

# Release AI SLOP ARENA

A release = the website/server deployed on Cloudflare + a git tag `vX.Y.Z` whose GitHub Actions run
(`.github/workflows/release.yml`) builds the Godot client (`godot/`) for every platform and publishes the GitHub release with the
hand-written notes of `docs/releases/vX.Y.Z.md`. Follow every step in order; stop and tell the user
when a step fails instead of pushing on.

Talk to the user in French. Commit after each step that changes files (see memory "commit-each-step").

## 0. Preflight

```bash
git fetch origin && git status -sb && git log --oneline origin/main..HEAD
```

- Be on `main`, up to date with `origin/main` (if behind: `git pull --rebase`, re-run tests).
- **Another developer may be working in this repo in parallel.** Never stage files you did not
  write (untracked art, `steam/store/`, `.claude/launch.json`, `release-epic/`...): stage paths
  explicitly, never `git add -A`. Mention leftovers to the user instead.
- Pick the version (semver): new features -> minor (`0.5.0` -> `0.6.0`), fixes only -> patch.
  Ask the user if it is not obvious. Previous tags: `git tag --sort=-v:refname | head`.
- Stop any dev server you started (`preview_stop`): Vite and wrangler watchers lock files, and a
  running Godot editor rewrites `godot/export_presets.cfg`.

## 1. Tests and builds

```bash
npm test              # server rules headless (tests/server.test.mjs) + the 30 locales (tests/i18n.test.mjs)
npm run build         # site + game (dist/) and the server bundle (worker/build/sim.js)
npx vite build --mode app   # mobile web bundle (dist-app/), must build too
```

All green before going on. If a feature changed online play, also run a local end-to-end check
(`npm run dev:server` + `npm run dev`, two clients) as in docs/moderation.md.

## 2. Version bump

```bash
# edit "version" in package.json, then
npm install --package-lock-only
npm run godot:version    # version into godot/project.godot + every export preset (npm test checks it)
```

`godot:version` (scripts/godot-version.mjs) sets the Android `version/code` and the iOS build number to
`(major*10000 + minor*100 + patch)*100 + 99` (`x.y.z-beta.N` -> `+N`, 1..98): `0.17.1` -> `170199`. It is
always above the old Capacitor app's codes (`1701` for 0.17.1), so Play installs the Godot build as an
update of `com.aislop.arena`. Play refuses a versionCode it has already seen: a re-upload needs a new
version (or a beta number).

If the online protocol changed (worker/index.js + src/net.js `PROTOCOL`), both must be bumped
together, and the notes must carry the "update required" warning (old apps are refused online).

Mobile apps are the Godot builds: they update through the stores only (the Capacitor apps' OTA
manifest `/app/latest.json` is frozen, there is no `AISlopArena-app-bundle.zip` any more).

## 3. Graphic release notes

1. **Art**: add a `vXYZ()` function to `art-src/make_release_art.py` (a `banner(...)` + one or two
   infographics about the release's real features, using real numbers from the code), call it in
   `__main__`, then run `.ai3d/venv/Scripts/python.exe art-src/make_release_art.py`.
   **Look at every generated PNG** (Read tool) and fix overflow, hidden text, empty emoji
   (Nunito lacks arrows/ticks: use `sym()`; black emoji vanish on dark pills).
2. **Notes**: `docs/releases/vX.Y.Z.md`, in English like the repo: banner, one bold summary line,
   `## ✨ Highlights` with emoji sections and the infographics, then the `## ⬇️ Download` table
   copied from the previous notes with the version replaced in every link (the line under the table
   says "debug-signed APK" only while the Android signing secrets are missing, see step 5). Images use
   `https://raw.githubusercontent.com/gtko/ai-slop-arena/main/docs/releases/img/...` (pushed in step 5).
3. **CHANGELOG.md**: new entry at the top (banner + 3-4 bullets).
4. Commit: `Release vX.Y.Z: notes, art, version`.

## 4. Deploy the website + server (Cloudflare)

```bash
npm run deploy:godot-web                      # Godot web export -> R2 godot/<version>/ (before the worker deploy)
op run --env-file=.env.op -- npm run deploy   # builds (source maps -> Sentry), then wrangler deploy
# site serves this build, rooms accept the protocol, refuse old ones, queue answers, the mobile
# update manifest (/app/latest.json) announces this version, /godot/ serves this version (retried while
# the new version propagates; a plain `sleep 30` is blocked by the harness)
for i in 1 2 3 4 5 6; do if npm run check:prod > "$TEMP/prod.log" 2>&1; then break; fi; sleep 10; done; tail -8 "$TEMP/prod.log"
```

- The Godot web client (`/godot/`, godot/README.md "Web hosting note") is served from the R2 bucket
  `ai-slop-arena-godot-web`; `/godot/` redirects to the deployed worker's version, so upload it first
  (it takes ~5 minutes: export + ~70 MB). `check:prod` checks its files and headers. An upload of an
  already published version is refused (browsers cache those files for a year): bump the version.
- A Cloudflare `500 / code 10013` is transient: run `npx wrangler deploy` again.
- The new version takes ~30 s to reach every edge: wait before `check:prod`, and re-run it once
  before investigating a failure (an old page bundle or a missing room welcome right after the
  deploy is just propagation).
- Deploy **before** tagging: the apps built by the tag talk to the live server.
- Secrets (e.g. `ADMIN_TOKEN`) are the user's: never create or print them.
- Crash reports: `op run` (1Password CLI) fills `SENTRY_AUTH_TOKEN` from the reference in `.env.op`
  (the user approves the access; never print or copy the value). The apps get it from the GitHub
  secret of the same name. With the token, the builds upload their source maps to Sentry for release `ai-slop-arena@X.Y.Z`. Without
  it everything still works, Sentry just shows minified stack traces. After the deploy, check the
  Sentry projects `ai-slop-arena` / `ai-slop-arena-server` (org odykit) for new issues of this release.

## 5. Push, tag, build

```bash
git push origin main
git tag -a vX.Y.Z -m "AI SLOP ARENA X.Y.Z: <one-line summary>"
git push origin vX.Y.Z
```

Then watch the workflow in the background (~15-20 minutes: each Godot job exports the data, converts
the models and imports the project; the Android Gradle build and the macOS/iOS simulator build are the
slowest):

```bash
ID=$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $ID --exit-status --interval 30 > /dev/null; echo "exit=$?"
gh run view $ID --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

If a job fails: `gh run view $ID --log-failed`, fix, commit, push, then re-run the failed jobs
(`gh run rerun $ID --failed`) - never move or delete a published tag. A failed iOS simulator build
does not hold the release back (it is published without `-ios-simulator.zip`, with a warning).

Dry run of the whole pipeline from a branch, without creating a release:
`gh workflow run release.yml --ref <branch>` (inputs: `tag`, `dry_run` = true by default; the builds
are the run's artifacts). `gh workflow run release.yml -f tag=vX.Y.Z -f dry_run=false` rebuilds and
re-uploads the assets of an existing tag.

### Android signing (GitHub secrets)

The Android job signs with the Play **upload key** of the Capacitor app
(`~/.android-keys/aisloparena-upload.jks`, certificate SHA-256 `5c7778cc...903357b`, checked by the job).
The secrets are the user's: never print, copy or set them yourself. Once, the user runs (Git Bash):

```bash
base64 -w0 ~/.android-keys/aisloparena-upload.jks > /tmp/upload.b64
gh secret set ANDROID_UPLOAD_KEYSTORE_B64 < /tmp/upload.b64 && rm /tmp/upload.b64
gh secret set ANDROID_UPLOAD_ALIAS       # paste keyAlias from aisloparena-upload.properties
gh secret set ANDROID_UPLOAD_PASSWORD    # paste storePassword (= keyPassword) from the .properties
```

Without them the release still ships, with a debug-signed APK and no AAB (warning in the run).
Optional: `APPLE_TEAM_ID` (the iOS project's team; a placeholder is used for the simulator build).

### Google Play (manual)

Download `AISlopArena-android.aab` from the release and upload it in the Play Console (production or a
test track; the console needs the user's clicks, and Chrome's file upload is capped at 10 MB: the user
drags the file in). Same package `com.aislop.arena` + same upload key + higher versionCode = in-place
update of the installed app, its data folder kept.

## 6. Verify the release

```bash
gh release view vX.Y.Z --json url,assets --jq '.url, (.assets[] | "\(.name) \(.size/1048576|floor) MB")'
```

- Seven assets, all Godot builds: `AISlopArena-steam-windows.zip`, `-steam-linux.tar.gz`,
  `-epic-windows.zip` (exe + pck), `-android.apk` (signed with the upload key, or debug-signed without
  the secrets), `-android.aab` (Play, only with the secrets), `-ios-simulator.zip` (unsigned .app),
  `-web.zip` (the Godot web export alone; the live web build is the R2 upload of step 4).
- The description is the notes file (the workflow applies it; if not: `gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md`).
- Open the release page in the browser pane and look at it: banner and infographics load
  (raw.githubusercontent may take a few minutes to refresh an image that changed).

## 7. Report to the user (in French)

Link to the release, the assets with sizes, what was deployed, what was tested and what was not
(e.g. real devices, Steam with two accounts), and anything left for them (the Play upload of the
AAB, signing keys, secrets). No push of other people's files, no auto-merge.
