# Migration: three.js client → Godot client

Goal: the Godot 4 client (`godot/`) replaces the three.js client on every platform (web, Windows /
Linux Steam, Windows Epic, Android, iOS). The release switches only once everything players have
today works in Godot. The shared game rules stay in JavaScript: the server runs `src/game.js` through
`worker/build/sim.js`.

## Facts that shape the plan

1. **The three.js client runs the rules locally in three cases, Godot in none**: solo vs bots
   (`src/main.js` `play()`), the dojo (`dojo()`), Steam P2P rooms (`src/steamnet.js`). Godot's SOLO is
   a server room with bots; TRAINING is a private room. Without a local simulation, offline play
   disappears (the Android and desktop apps play solo offline today) and the dojo is missing.
2. **All progression is local** (`iaslop-*` localStorage keys: profile, mastery, loadout, quests,
   achievements, bot level, cid, name...) and the server rank is keyed by the device `cid`. Godot uses
   `user://` files. Without a data migration a player switching to Godot loses coins, brawlers,
   mastery, quests, achievements and rank.
3. **Only web and Android are really in production** (Google Play `com.aislop.arena`, versionCode
   `maj*10000+min*100+patch`). Steam is still app 480 (Spacewar), Epic is manual, iOS is a simulator
   build: those start from scratch.
4. **SSO is not on main**: it lives on `claude/user-accounts-sso-integration-311995`
   (`worker/auth.js`, `src/account.js`, `docs/accounts.md`).
5. **The server imports a lot of "rendering" code**: `src/server/sim.js` pulls `three` and the whole
   `game.js` graph with a DOM polyfill. Only the pure client files can be deleted (see "Code removal").
6. **The Godot Android preset is not store-ready**: id `ch.gtko.aisloparena.godot`, no 32-bit ABI, no
   `version/code`, no Gradle build (needed for AAB and plugins).

## Decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | Offline solo and dojo | Local simulation: run the same `ServerMatch` bundle inside the client (browser JS VM on web via `JavaScriptBridge`, an embedded JS engine such as QuickJS on native). 2-3 day spike first. Fallback: server-side dojo, offline accepted as a loss. |
| D2 | SSO | Merge the server part of the SSO branch first; build the login UI in Godot web only. Store builds stay account-less. |
| D3 | Engine version | Stay on 4.4.1 for 0.18.0, but check Play's target SDK 35/36 and Sentry GDScript traces (complete only in 4.5+) during the spike. |
| D4 | Android versionCode | `(maj*10000+min*100+patch)*100+b` (`b=99` final, `1..98` betas): monotonic and allows Play test tracks. |
| D5 | three.js freeze | From now on, bug fixes only in the three.js client; new gameplay goes to `src/game.js` (shared) and Godot. |

## Feature inventory (✅ in Godot · 🟡 partial · ❌ missing)

| Feature | Godot | Port | Effort |
|---|---|---|---|
| Steam achievements / stats | ❌ | GodotSteam GDExtension, `platform/steam.gd`, sink of the achievements API | M |
| Steam overlay, rich presence, language | ❌ | GodotSteam | S |
| Steam lobbies / invites / P2P | ❌ | No P2P (Godot has no rules): a Steam lobby carries the server room code | M |
| Epic | ❌ | "Windows (Epic)" preset, `-epicusername` / `-epiclocale` args | S |
| Google Play Games | ❌ | godot-play-game-services plugin (Gradle build) | M |
| Native shell (orientation, immersive, back button) | ✅ | safe area in the HUD, OpenGL fallback | S |
| Mobile OTA updates | ❌ | PCK patches: `boot.gd` loads `user://ota/<v>.pck`, `/godot/latest.json`, `MAX_BOOTS` guard | L |
| Sentry | ❌ | sentry-godot GDExtension (native), `@sentry/browser` in the web loader | M |
| PostHog | ❌ | `telemetry.gd` posting to the batch API, same 26 event names, `client=godot` | M |
| Bug report, survey | ❌ | `bug_report.gd`, `survey_view.gd` | M / S |
| SSO login | ❌ | after the server merge (D2), web only | M |
| Matchmaking, rooms, spectate, emotes, pings, report | ✅ | `?room=` invite links | S |
| Offline solo vs bots | ❌ | D1 | L |
| Dojo / training | ❌ | server `dojo` room flag, or D1 | S-M |
| Hidden bot level (`skill.js`) | ❌ | `skill.gd` | S |
| Mastery + loadout locks | ❌ | `mastery.gd` | M |
| Quests progress | 🟡 | `quests.gd` | M |
| Level, coins, gems, trophy road, shop, collection | ✅ | — | — |
| Achievements (17) | ❌ | `achievements.gd` with sinks (Steam, Play) | M |
| 30 locales | 🟡 | Godot-only strings EN/FR only; CJK font as an on-demand pack on web | M |
| Settings, accessibility, input | ✅ | telemetry toggles | S |
| Auto quality from FPS | 🟡 | `quality.gd` | S-M |
| Trailer, store screenshots | 🟡 | Godot Movie Maker, `--menushot` | M |

## Release pipeline

New Godot jobs in `.github/workflows/release.yml` (image `barichello/godot-ci:4.4.1`), first next to
the three.js jobs with `-godot` assets, then replacing them:

- **prepare**: data, i18n and model export, `scripts/godot-version.mjs` (new: writes the version into
  `project.godot` and every preset), import.
- **web**: export, upload to R2 under `godot/<version>/`.
- **desktop**: "Windows (Steam)", "Windows (Epic)", "Linux (Steam)" presets with GodotSteam
  redistributables; Steam depots point at the Godot builds.
- **android**: Gradle build, `com.aislop.arena`, `armeabi-v7a` + `arm64-v8a` (+ `x86_64`), target SDK
  36, signed with the same upload key as the Capacitor app (GitHub secrets), AAB for Play + APK for
  GitHub, OTA PCK.
- **ios**: export to Xcode on macOS, simulator build (signed archive later).

Installed apps: same package, same upload key and a higher versionCode, so Play updates the Capacitor
app in place and keeps its data folder (the migration reads the old WebView storage). Old Capacitor
apps get a last "bridge" OTA bundle pointing them to the store, and `/app/latest.json` is frozen.
The web keeps `/classic/` (three.js) for two weeks behind a Worker switch for instant rollback.

## Code removal (phase 3)

**Shared with the server, keep**: `game.js, ai.js, arena.js, assets.js, foliage.js, lantern.js, maps.js,
materials.js, props.js, shore.js, water.js, brawler.js, cosmetics.js, figurines.js, animator.js,
models.js, gadgets.js, combat.js, effects.js, events.js, feel.js, kit.js, mutators.js, poison.js,
weather.js`, `src/server/*`; also `src/updates.js` (until old apps are gone), `src/profile.js`
constants (move to `src/economy.js`), `src/i18n/en.js` + locales (until i18n moves to `godot/`), the
site (`index.html`, `roadmap.html`, `src/site/*`, `public/`).

**Client only, delete**: `main.js, menu.js, metaui.js, hud.js, input.js, touch.js, emotewheel.js,
lighting.js, cartoon.js, sight.js, visionfog.js, autoquality.js, settings.js, telemetry.js,
bugreport.js, survey.js, achievements.js, mastery.js, quests.js, skill.js, matchmaking.js, net.js,
steamnet.js, platform.js, native.js, ota.js, playgames.js, devtools.js, trailer.js, audio.js,
i18n/index.js, ambient/`, the client CSS, `play.html`, `electron/`, `android/`, `ios/`,
`capacitor.config.json`, Electron/Capacitor scripts and dependencies.

## Phases

| Phase | Version | Content | Done when |
|---|---|---|---|
| 0 Foundations | 0.17.x | version script, store-ready presets, Godot jobs in the release, R2 web at `/godot/` + loader, spikes (local sim, Sentry, WebView storage read), three.js freeze, SSO server merge | a tag also produces signed Godot builds; spikes concluded |
| 1 Parity | 0.18.0-beta.N | parallel work packages: A progression, B data migration, C telemetry, D Steam/Epic, E Android/Play Games, F dojo, G local simulation, I web (SSO, invite links, CJK), J OTA PCK, K tools, then H translations | every ❌/🟡 is ✅ or accepted; Play closed track beta; a real Android upgrade keeps coins, mastery, quests, achievements, settings and rank |
| 2 Switch | 0.18.0 | `/play` → Godot (rollback switch), Play staged rollout 10→50→100 %, Godot builds are the only store builds | 100 % on Play, 7 days without major regression |
| 3 Cleanup | 0.18.1+ | delete the client code, Electron/Capacitor jobs, `/classic/`; rewrite docs and skills | tests, build and deploy green; no electron/capacitor left |
| 4 Later | — | store identity checks, cloud save, EOS achievements, Game Center, signed iOS | — |

Conflict rules for parallel work: each package adds its own files and touches `main.gd` / `menu.gd`
only through small hooks, merged one PR at a time; `export_presets.cfg` / `project.godot` belong to
the pipeline package; new strings in EN + FR only until the translation package.

## Main risks

1. Progress loss if the Android data migration fails: prove the WebView storage read on a device first.
2. Offline play lost if D1 is not done.
3. Play requirements (target SDK, 32-bit ABI, AAB size).
4. A broken OTA PCK at boot: `MAX_BOOTS` guard, internal track first.
5. Conflicts on `main.gd` / `menu.gd`.
