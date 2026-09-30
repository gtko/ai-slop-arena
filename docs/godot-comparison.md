# Godot 4 vs three.js: comparison protocol

Branch: the Godot client lives in `godot/`; the three.js game is untouched.

| Measure | How | three.js | Godot |
| --- | --- | --- | --- |
| Time to first frame (cold start, phone) | stopwatch from tap to arena visible | | |
| Frame time p95, 8 brawlers, oasis | Godot: Monitors; web: `devtools.js` / Chrome perf | | |
| Battery: 10 min match at full brightness | Android battery historian / iOS Xcode energy gauge | | |
| Device temperature after 10 min | thermal state API / by hand | | |
| Download size | web: `dist-app/`; Godot: exported APK/AAB/IPA/web | | |
| Web load (mobile Safari) | Lighthouse / stopwatch | | |
| Dev cost of a new brawler / arena | hours | | |

Rules of the test: same phone, same room code, same server, same graphics ambition (the Godot
client is far less dressed than the web one for now: compare like for like, or finish the port
of the visuals first).

## Measured so far (software renderer, no phone)

| | three.js (current) | Godot 4.4 client |
| --- | --- | --- |
| Web download | about 9.5 MB models + JS bundle | `index.pck` 58 MB + `index.wasm` 44 MB (about 9 MB gzipped) |
| Cloudflare static assets (25 MiB per file) | fits | does not fit (R2 or split needed) |
| Linux desktop build | Electron | 70 MB binary + 58 MB pck |
| Runs against the same server | yes | yes (cross-play) |
| All 6 maps play end to end | yes | yes (headless autotest, llvmpipe) |

Still to measure on real phones: frame time, battery drain, thermals, startup time, Android/iOS exports
(CI workflow `.github/workflows/godot.yml`).
