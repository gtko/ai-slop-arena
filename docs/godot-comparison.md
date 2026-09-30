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
