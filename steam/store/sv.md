# Steam-butikssida: svenska

Klistra in varje block i motsvarande fält i Steamworks (Store Page Admin > Description), språket "Swedish".

## Spelets namn

```
AI SLOP ARENA
```

## Kort beskrivning (max 300 tecken)

```
En gullig brawler i fågelperspektiv för åtta spelare. Välj en brawler, göm dig i det höga gräset, krossa lådor för kraftkuber och bli den siste kvar när giftgasen drar ihop sig. Fem arenor med levande väder och dygnscykel. Spela solo mot bottar eller online med vänner.
```

## Om spelet (BBCode)

```
[img]{STEAM_APP_IMAGE}/extras/battle.gif[/img]

[h2]Den siste kvar vinner[/h2]
Åtta brawlers släpps ner på arenan. Göm dig i det höga gräset, krossa lådor för kraftkuber som gör dig starkare och stanna aldrig upp: giftgasen drar ihop sig. Bara en tar sig därifrån.

[h2]Fem brawlers, fem sätt att slåss[/h2]
[list]
[*][b]Blaster[/b]: en hagelsvärm med fem hagel på nära håll. Super: en smäll som slår tillbaka fiender och krossar väggar.
[*][b]Gunslinger[/b]: en skur med sex kulor på långt håll. Super: en salva på tolv kulor som går rakt igenom väggar.
[*][b]Bomber[/b]: kastar bomber över skydd. Super: en jättetunna som jämnar allt runt omkring med marken.
[*][b]Frostbite[/b]: tre isskärvor som saktar ner. Super: en frostvåg som fryser alla i närheten.
[*][b]Volt[/b]: ett klot vars blixt hoppar vidare till två fiender. Super: en storm som kallar ner blixtar.
[/list]

[img]{STEAM_APP_IMAGE}/extras/weather.gif[/img]

[h2]Fem arenor, fem väder[/h2]
[list]
[*][b]Oasen[/b]: klar himmel och vattendammar.
[*][b]Dynstormen[/b]: en sandstorm sveper över dynerna.
[*][b]Regnlunden[/b]: regn, åska och blixtar.
[*][b]Frosttoppen[/b]: snöfall och hal is.
[*][b]Dimträsket[/b]: dimma som krymper din sikt till några få meter.
[/list]
Varje match slumpar också fram en tid på dygnet: morgon, middag, solnedgång eller natt. När skymningen faller tänds lyktorna och en pannlampa följer dig och kastar långa skuggor framför dig.

[h2]Spela med vänner[/h2]
Skapa en lobby och bjud in dina Steam-vänner, eller låt dem gå med direkt från vänlistan. Matcherna körs peer-to-peer via Steam: ingen server, ingen portvidarebefordran. Tomma platser fylls med bottar, och du kan alltid spela solo mot bottar.

[img]{STEAM_APP_IMAGE}/extras/daynight.gif[/img]

[h2]Gjort av en AI på två kvällar[/h2]
Namnet är ärligt. AI SLOP ARENA byggdes på två kvällar av Claude Opus 5.5, en AI som arbetade på egen hand i Claude Code: den skrev koden, skapade grafiken, spelade spelet för att testa det och lagade det som var trasigt. Illustrationerna, texturerna, musiken och ljudeffekterna är AI-genererade, och 3D-figurerna modellerades på en vanlig hemdator utifrån illustrationerna. Människan bakom skrev 35 prompter och sa "det där är fult" när det var fult. Total kostnad för alla assets: 2,61 USD.

[h2]Funktioner[/h2]
[list]
[*]Matcher för 8 spelare där den siste kvar vinner, solo mot bottar eller online.
[*]5 brawlers, alla med en huvudattack och en super.
[*]5 arenor med väder som ändrar hur du spelar: is, dimma, sandstorm, regn.
[*]Ljus och skuggor i realtid, dygnscykel, bloom och ambient occlusion.
[*]10 Steam-prestationer.
[*]Mus och tangentbord eller handkontroll, valfri tangentbindning.
[*]Grafikförval från Låg till Ultra: flyter på enklare datorer.
[/list]
```

## Redovisning av AI-genererat innehåll (innehållsenkät)

Förgenererat innehåll: **ja**. Livegenererat innehåll: **nej**.

```
Allt innehåll i spelet (kod, grafik, 3D-modeller, musik, ljudeffekter) genererades med AI före lanseringen, under ledning av en människa som testade och godkände det. Spelet genererar inget AI-innehåll medan du spelar.
```

## Prestationer

| API-namn | Namn | Beskrivning |
| --- | --- | --- |
| `FIRST_KO` | Första Blodet | Slå ut en brawler. |
| `FIRST_WIN` | Sist Kvar | Vinn en match. |
| `RAMPAGE` | Amok | Slå ut 3 brawlers i en och samma match. |
| `POWER_HUNGRY` | Krafthungrig | Ha 8 kraftkuber i en match. |
| `ONLINE_WIN` | Publikfavorit | Vinn en onlinematch mot en annan människa. |
| `SQUAD_UP` | Gänget Samlat | Spela en onlinematch med en vän. |
| `WORLD_TOUR` | Världsturné | Spela på alla fem arenor. |
| `JACK_OF_ALL` | Slop-Tusenkonstnär | Vinn en match med var och en av de fem brawlers. |
| `VETERAN` | Veteran | Spela 25 matcher. |
| `CENTURION` | Centurion | Slå ut 100 brawlers. |

## Systemkrav (Windows)

| | Minimum | Rekommenderat |
| --- | --- | --- |
| Operativsystem | Windows 10 64-bitars | Windows 10/11 64-bitars |
| Processor | Dubbelkärnig 2,5 GHz (Intel Core i3 / AMD Ryzen 3) | Fyrkärnig 3 GHz (Intel Core i5 / AMD Ryzen 5) |
| Minne | 4 GB RAM | 8 GB RAM |
| Grafik | Grafikkort med DirectX 11, t.ex. Intel UHD 620 (förvalet Låg) | GTX 1060 / RX 580 eller bättre (förvalet Ultra) |
| Nätverk | Bredbandsanslutning till internet (onlinespel) | Bredbandsanslutning till internet |
| Lagring | 1 GB ledigt utrymme | 1 GB ledigt utrymme |
| Övrigt | Solo mot bottar fungerar utan internetanslutning. | |
