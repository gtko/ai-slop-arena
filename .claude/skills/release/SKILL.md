---
name: release
description: Ship a new version of AI SLOP ARENA end to end - tests, version bump, graphic release notes, Cloudflare deploy (site, server, Godot web build), git tag, GitHub release with every Godot platform build (Steam, Epic, Android, iOS, web), then verification. Use when the user asks to release, publish a version, "faire une release", tag vX.Y.Z or ship to GitHub.
---

# Release AI SLOP ARENA

A release = the website/server and the Godot web build deployed on Cloudflare + a git tag `vX.Y.Z`
whose GitHub Actions run (`.github/workflows/release.yml`, the Godot jobs) exports every platform from
`godot/` and publishes the GitHub release with the hand-written notes of `docs/releases/vX.Y.Z.md`.
The game is the Godot client everywhere; the three.js client, Electron and Capacitor are gone.
Follow every step in order; stop and tell the user
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
- Stop any dev server you started (`preview_stop`): Vite and wrangler watchers lock files.

## 1. Tests and builds

```bash
npm test              # server rules headless, ranking, the 30 locales, the frozen OTA manifest
npm run build         # website (dist/) and the server bundle (worker/build/sim.js)
```

All green before going on. If a feature changed online play, also run a local end-to-end check
(`npm run deploy:godot-web -- --local`, `npm run dev:server`, two Godot clients on
`http://localhost:8787/play`) as in docs/moderation.md.

## 2. Version bump

```bash
# edit "version" in package.json, then
npm install --package-lock-only
```

The Godot project and its export presets get the version from the release workflow (see the Godot
jobs in `.github/workflows/release.yml`).

If the online protocol changed (`PROTOCOL` in worker/index.js and `godot/scripts/net_client.gd`), both
must be bumped together, and the notes must carry the "update required" warning (old apps are refused
online).

The old Capacitor apps (three.js, up to v0.17.1) get no more web bundles: `/app/latest.json` stays
frozen on 0.17.1 (`FROZEN_APP_BUNDLE` in `src/updates.js`, docs/ota-updates.md). Never change it.

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
npm run deploy:godot-web                      # Godot web export -> R2 godot/<version>/ (before the worker deploy)
op run --env-file=.env.op -- npm run deploy   # builds (source maps -> Sentry), then wrangler deploy
# site serves this build, /play redirects to the Godot client, rooms accept the protocol, refuse old
# ones, queue answers, /app/latest.json stays frozen, /godot/ serves this version (retried while the
# new version propagates; a plain `sleep 30` is blocked by the harness)
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
- Deploy **before** tagging: the apps built by the tag talk to the live server. `/play` (the site's
  Play buttons, invite links `?room=CODE`) redirects to `/godot/<deployed version>/`, so without the R2
  upload the game is down.
- Secrets (e.g. `ADMIN_TOKEN`) are the user's: never create or print them.
- Crash reports: `op run` (1Password CLI) fills `SENTRY_AUTH_TOKEN` from the reference in `.env.op`
  (the user approves the access; never print or copy the value). The apps get it from the GitHub
  secret of the same name. The website has no client code to report any more; the server reports to
  Sentry (`SENTRY_DSN` in wrangler.jsonc). After the deploy, check the Sentry project
  `ai-slop-arena-server` (org odykit) for new issues of this release.

## 5. Push, tag, build

```bash
git push origin main
git tag -a vX.Y.Z -m "AI SLOP ARENA X.Y.Z: <one-line summary>"
git push origin vX.Y.Z
```

Then watch the workflow in the background (the Godot exports; macOS/iOS is the slowest):

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

- The assets the Godot jobs of `release.yml` publish (Steam Windows / Linux, Epic Windows, Android,
  iOS simulator, web): compare with the previous release. No `-app-bundle.zip` any more: the old
  Capacitor apps stay on v0.17.1's (`curl -s https://ai-slop-arena.gtux-prog.workers.dev/app/latest.json`
  must still name 0.17.1).
- The description is the notes file (the workflow applies it; if not: `gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md`).
- Open the release page in the browser pane and look at it: banner and infographics load
  (raw.githubusercontent may take a few minutes to refresh an image that changed).

## 7. Report to the user (in French)

Link to the release, the assets with sizes, what was deployed, what was tested and what was not
(e.g. real devices, Steam P2P with two accounts), and anything left for them (store uploads,
signing keys, secrets). No push of other people's files, no auto-merge.
