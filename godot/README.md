# AI SLOP ARENA, Godot 4 client (comparison branch)

A Godot 4.4 client for the **existing** game server. Nothing of the rules is ported: the Cloudflare
room (`worker/index.js`) runs every match with the same `Game` code as the web build, and this
client only renders snapshots and sends inputs (protocol v6, see `scripts/net_client.gd`). So the
Godot build and the three.js builds can play in the same room (cross-play).

## Run

```bash
node godot/tools/export-data.mjs       # maps.json + brawlers.json from src/ (re-run when maps/stats change)
cd godot/tools && npm i && node convert-models.mjs && cd ..   # meshopt GLBs -> plain GLBs for Godot
godot --path godot                      # desktop (Godot 4.4+)
```

Server: leave the default (production) or run `npm run dev:server` and type `ws://localhost:8787`.
Headless end-to-end check against a running server:

```bash
godot --headless --path godot -- --autotest ws://localhost:8787
```

## What is in

Room join, match start, arena from the map grid (one MultiMesh per tile kind = few draw calls),
local movement with the same tile collision as the server, snapshot interpolation (15 Hz), attack
events, wall/crate breaking, touch sticks + keyboard/mouse, and a battery profile (30 fps, 70 %
render scale, no MSAA/shadows, 5 fps in the background).

## Not yet (the honest list)

Gadgets and star powers UI, emotes, cosmetics, the poison gas ring, water/shore/weather shaders,
fauna, audio, menus/meta (quests, ranking, achievements), matchmaking, Steam / Play Games hooks,
export presets and store builds. `conversion` of decor and fauna models is not done either.

## Comparing with the three.js build

Same room, same server: measure frame time, battery drain over a 10-minute match, startup time,
export size and thermal behaviour on the same phone. See `../docs/godot-comparison.md`.

## Export

`export_presets.cfg` has Web, Android, iOS, Linux and Windows presets (install the matching Godot
export templates first; Android needs the SDK + a keystore, iOS needs a Mac). Example:
`godot --headless --path godot --export-release "Web" build/web/index.html`.
The web preset uses the Compatibility (WebGL2) renderer automatically; native targets use Mobile
(Vulkan / Metal).
