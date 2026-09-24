# Google Play Games

The Android app uses [Play Games Services v2](https://developer.android.com/games/pgs/overview)
for the same 15 achievements as Steam. It gets the game into the Google Play Games app (achievements,
player profile) and makes it eligible for Play Points quests and Play Games promotions.

| Part | Where |
| --- | --- |
| Native bridge | `android/app/src/main/java/ch/gtko/aisloparena/PlayGamesPlugin.java` (Capacitor plugin, SDK `play-services-games-v2`, version in `android/variables.gradle`) |
| Ids | `android/app/src/main/res/values/games-ids.xml` |
| Game side | `src/playgames.js`, plugged into `src/achievements.js` like Steam |
| Menu | *ACHIEVEMENTS* button (Android only, when Play Games is set up): signs in if needed, then opens Play's achievements screen |

Sign-in is automatic at launch (Play Games v2): players with a Play Games profile get their
achievements with no button. Progress is still kept locally, so anything earned before signing in,
or before this was set up, is sent the next time Play Games answers.

**Until `app_id` is filled in `games-ids.xml`, Play Games stays off**: the app builds and runs as before,
the button stays hidden.

## Play Console setup

1. **Create the project**: Play Console > the app > *Grow users > Play Games Services > Setup and management >
   Configuration* > *No, my game doesn't use Google APIs* > create. It creates a Google Cloud project
   and asks for its **OAuth consent screen** (external, app name, support email, privacy policy
   `https://ai-slop-arena.gtux-prog.workers.dev/privacy.html`).
2. **Credentials** (same page, *Add credential > Android*), package `ch.gtko.aisloparena`, one per
   signing certificate SHA-1:
   - the **app signing key** (Play Console > *Test and release > App integrity > App signing*): builds installed from Play;
   - the **upload key** (same page, or `keytool -list -v -keystore <upload keystore>`): `npm run android:aab` builds side-loaded for testing;
   - optionally the debug key (`cd android && gradlew signingReport`): `npm run android:apk`.
3. **Achievements** (*Play Games Services > Achievements > Add achievement*). Use exactly these
   English names: the game finds each id from its name (`achievement_first_blood`...).
   Icons: `play/achievements/<API name>.png` (512 x 512; Play greys them out itself while locked).

   | API name (game) | Name | Description | Incremental | Points |
   | --- | --- | --- | --- | --- |
   | `FIRST_KO` | First Blood | Knock out a brawler. | no | 10 |
   | `FIRST_WIN` | Last One Standing | Win a match. | no | 25 |
   | `RAMPAGE` | Rampage | Knock out 3 brawlers in one match. | no | 50 |
   | `POWER_HUNGRY` | Power Hungry | Hold 8 power cubes in one match. | no | 40 |
   | `ONLINE_WIN` | Crowd Pleaser | Win an online match against another human. | no | 75 |
   | `SQUAD_UP` | Squad Up | Play an online match with a friend. | no | 40 |
   | `WORLD_TOUR` | World Tour | Play on all five arenas. | no | 50 |
   | `JACK_OF_ALL` | Jack of All Slops | Win a match with each of the five brawlers. | no | 125 |
   | `VETERAN` | Veteran | Play 25 matches. | **yes, 25 steps** | 75 |
   | `CENTURION` | Centurion | Knock out 100 brawlers. | **yes, 100 steps** | 150 |
   | `PODIUM` | Podium Finish | Finish a match in the top 3. | no | 15 |
   | `SUPER_KO` | Super Finish | Knock out a brawler with your super. | no | 20 |
   | `NIGHT_OWL` | Night Owl | Win a match at night. | no | 40 |
   | `CRATE_CRUSHER` | Crate Crusher | Break 50 crates. | **yes, 50 steps** | 50 |
   | `CHAMPION` | Champion | Win 10 matches. | **yes, 10 steps** | 100 |

   865 points of the 1000 allowed, leaving room for more achievements later. Seven of them come
   within the first hour or two (First Blood, Podium Finish, Super Finish, Last One Standing,
   Power Hungry, Rampage, Night Owl), as Google advises. **Translations**: the
   30 languages are in [achievements_translations.md](achievements_translations.md) (`node play/gen-loc.mjs`
   rebuilds it from `src/i18n`).
4. **Ids**: *Configuration > Get resources > Android (XML)*, and paste the result over
   `android/app/src/main/res/values/games-ids.xml` (it has `app_id`, `package_name` and one
   `achievement_*` per achievement). If a name in it does not match the file in the repo (an
   achievement named differently), fix the name in Play Console, not in the file.
5. **Testers** (*Play Games Services > Testers*): add your Google accounts; until the project is
   published, only testers can sign in.
6. **Publish** the Play Games project (*Review and publish*), then build and upload the new bundle:
   `npm run android:aab`.

## Check it on a phone

Install a build signed with a key from step 2, launch it: a *Welcome back* Play Games banner slides
in at the top. Knock out a brawler: *First Blood* pops up. *ACHIEVEMENTS* in the menu opens the list.
`adb logcat | grep -i games` shows what the SDK says when it does not work (usually a SHA-1 or
package mismatch in the credentials, or the account not being a tester).
