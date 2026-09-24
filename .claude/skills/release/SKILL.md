---
name: release
description: Ship a new version of AI SLOP ARENA end to end - tests, version bump, graphic release notes, Cloudflare deploy, git tag, GitHub release with every platform build (Steam, Epic, Android, iOS, web), then verification. Use when the user asks to release, publish a version, "faire une release", tag vX.Y.Z or ship to GitHub.
---

# Release AI SLOP ARENA

A release = the website/server deployed on Cloudflare + a git tag `vX.Y.Z` whose GitHub Actions run
(`.github/workflows/release.yml`) builds every platform and publishes the GitHub release with the
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
- Stop any dev server you started (`preview_stop`): Vite and wrangler watchers lock files and make
  `electron-builder` fail with `EPERM ... rename win-unpacked.tmp`.

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
```

If the online protocol changed (worker/index.js + src/net.js `PROTOCOL`), both must be bumped
together, and the notes must carry the "update required" warning (old apps are refused online).

## 3. Graphic release notes

1. **Art**: add a `vXYZ()` function to `art-src/make_release_art.py` (a `banner(...)` + one or two
   infographics about the release's real features, using real numbers from the code), call it in
   `__main__`, then run `.ai3d/venv/Scripts/python.exe art-src/make_release_art.py`.
   **Look at every generated PNG** (Read tool) and fix overflow, hidden text, empty emoji
   (Nunito lacks arrows/ticks: use `sym()`; black emoji vanish on dark pills).
2. **Notes**: `docs/releases/vX.Y.Z.md`, in English like the repo: banner, one bold summary line,
   `## ✨ Highlights` with emoji sections and the infographics, then the `## ⬇️ Download` table
   copied from the previous notes with the version replaced in every link. Images use
   `https://raw.githubusercontent.com/gtko/ai-slop-arena/main/docs/releases/img/...` (pushed in step 5).
3. **CHANGELOG.md**: new entry at the top (banner + 3-4 bullets).
4. Commit: `Release vX.Y.Z: notes, art, version`.

## 4. Deploy the website + server (Cloudflare)

```bash
op run --env-file=.env.op -- npm run deploy   # builds (source maps -> Sentry), then wrangler deploy
# site serves this build, rooms accept the protocol, refuse old ones, queue answers (retried while
# the new version propagates; a plain `sleep 30` is blocked by the harness)
for i in 1 2 3 4 5 6; do if npm run check:prod > "$TEMP/prod.log" 2>&1; then break; fi; sleep 10; done; tail -7 "$TEMP/prod.log"
```

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

Then watch the workflow in the background (it takes ~6 minutes; macOS/iOS is the slowest):

```bash
ID=$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $ID --exit-status --interval 30 > /dev/null; echo "exit=$?"
gh run view $ID --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

If a job fails: `gh run view $ID --log-failed`, fix, commit, push, then re-run the failed jobs
(`gh run rerun $ID --failed`) - never move or delete a published tag.

## 6. Verify the release

```bash
gh release view vX.Y.Z --json url,assets --jq '.url, (.assets[] | "\(.name) \(.size/1048576|floor) MB")'
```

- Six assets: `AISlopArena-steam-windows.zip`, `-steam-linux.tar.gz`, `-epic-windows.zip`,
  `-android.apk`, `-ios-simulator.zip`, `-web.zip`.
- The description is the notes file (the workflow applies it; if not: `gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md`).
- Open the release page in the browser pane and look at it: banner and infographics load
  (raw.githubusercontent may take a few minutes to refresh an image that changed).

## 7. Report to the user (in French)

Link to the release, the assets with sizes, what was deployed, what was tested and what was not
(e.g. real devices, Steam P2P with two accounts), and anything left for them (store uploads,
signing keys, secrets). No push of other people's files, no auto-merge.
