# Over-the-air updates of the old mobile apps (frozen)

Up to v0.17.1 the Android and iOS apps were a Capacitor shell around the three.js client's web bundle,
with `@capgo/capacitor-updater`: at each launch they read `GET /app/latest.json` and downloaded a newer
web bundle (the GitHub release asset `AISlopArena-app-bundle.zip`) by themselves.

The three.js client, Capacitor and the bundle build are gone: the game is the Godot client
([platforms.md](platforms.md)). No new web bundle will ever exist for those installed apps, so the
manifest is **frozen on the last one**:

```json
{ "version": "0.17.1", "url": "https://github.com/gtko/ai-slop-arena/releases/download/v0.17.1/AISlopArena-app-bundle.zip", "minNative": "0.16.1" }
```

- `FROZEN_APP_BUNDLE` in `src/updates.js`; the Worker serves `manifestFor(FROZEN_APP_BUNDLE)`, and
  `tests/updates.test.mjs` (part of `npm test`) and `scripts/check-prod.mjs` check it stays so.
- An app already on 0.17.1 sees nothing newer and keeps running; an older one still gets 0.17.1 (the zip
  is on that release). Without this, every launch would try a download that 404s.
- Never point it at a newer version: there is no bundle for it, and the apps would retry it forever
  (twice per version, then give up on it, `src/updates.js` `MAX_DOWNLOADS`).

## What the old apps still do

The update logic they run (compiled into them) is the one of `src/updates.js`: version order, manifest
checks (https, newer than the running bundle, shell at least `minNative`), at most two download starts
and two failed boots per version. It stays in this repo, unchanged, because those apps keep calling
the manifest until their players update.

Online, the server refuses clients of an older protocol (`PROTOCOL` in `worker/index.js`): the 0.17.1
bundle speaks protocol 6. The day the protocol changes, those apps can no longer play online and their
players need the Godot app from the store (same package `com.aislop.arena` on Google Play).

## Moving the old apps to the Godot app (to do)

Those apps need a message telling their players to install the new version from the store (the Play
Store updates the Capacitor app in place once the Godot build with a higher versionCode is published).
The frozen 0.17.1 bundle cannot show it: it has to come from a last "bridge" web bundle (a 0.17.x build
of the three.js client from the `v0.17.1` tag, with only that message added), published as a release
asset and pointed at by `FROZEN_APP_BUNDLE`, or from the server's `outdated` refusal message once the
protocol changes. That is a separate task.
