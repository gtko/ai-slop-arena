# Fiche Steam : AI SLOP ARENA

Tout ce qu'il faut pour remplir la page Steam dans Steamworks. Les textes à coller sont dans :

| Langue | Fichier | Steamworks |
| --- | --- | --- |
| Anglais (par défaut) | [en.md](en.md) | English |
| Français | [fr.md](fr.md) | French |
| Allemand | [de.md](de.md) | German |
| Espagnol (Espagne) | [es.md](es.md) | Spanish - Spain |
| Espagnol (Amérique latine) | [es-419.md](es-419.md) | Spanish - Latin America |
| Italien | [it.md](it.md) | Italian |
| Portugais (Portugal) | [pt.md](pt.md) | Portuguese - Portugal |
| Portugais (Brésil) | [pt-BR.md](pt-BR.md) | Portuguese - Brazil |
| Néerlandais | [nl.md](nl.md) | Dutch |
| Suédois | [sv.md](sv.md) | Swedish |
| Danois | [da.md](da.md) | Danish |
| Norvégien | [no.md](no.md) | Norwegian |
| Finnois | [fi.md](fi.md) | Finnish |
| Polonais | [pl.md](pl.md) | Polish |
| Tchèque | [cs.md](cs.md) | Czech |
| Hongrois | [hu.md](hu.md) | Hungarian |
| Roumain | [ro.md](ro.md) | Romanian |
| Bulgare | [bg.md](bg.md) | Bulgarian |
| Grec | [el.md](el.md) | Greek |
| Turc | [tr.md](tr.md) | Turkish |
| Russe | [ru.md](ru.md) | Russian |
| Ukrainien | [uk.md](uk.md) | Ukrainian |
| Arabe | [ar.md](ar.md) | Arabic |
| Thaï | [th.md](th.md) | Thai |
| Vietnamien | [vi.md](vi.md) | Vietnamese |
| Indonésien | [id.md](id.md) | Indonesian |
| Japonais | [ja.md](ja.md) | Japanese |
| Coréen | [ko.md](ko.md) | Korean |
| Chinois simplifié | [zh-CN.md](zh-CN.md) | Simplified Chinese |
| Chinois traditionnel | [zh-TW.md](zh-TW.md) | Traditional Chinese |

Les 30 langues que Steam prend en charge. Chaque fichier contient : description courte (300 caractères max., vérifié), "À propos du jeu" en BBCode,
texte de divulgation IA, succès traduits et configuration requise.
Les images de la description sont dans [extras/](extras/) (616 px de large, la largeur de la colonne de description).

## 1. Réglages de base (Store Page Admin > Basic Info)

| Champ | Valeur |
| --- | --- |
| Nom | `AI SLOP ARENA` |
| Développeur / Éditeur | `gtko` |
| Genres | Action, Casual, Free to Play (si gratuit, voir §5), Indie |
| Catégories | Single-player, Online PvP, Steam Achievements, Steam Stats, Partial Controller Support (voir §7) |
| Langues | Interface cochée pour chaque langue réellement livrée dans `src/i18n/locales/` (en cours de traduction). Audio non (pas de voix), sous-titres non |
| Plateformes | Windows (+ Linux / Steam Deck si on livre `dist:steam:linux`) |
| Site web | `https://ai-slop-arena.gtux-prog.workers.dev` |

Ne cocher une langue qu'une fois sa traduction relue dans le jeu : Steam affiche la liste en haut à droite
de la page, et une langue cochée mais incomplète attire des évaluations négatives.
Pour les langues sans description traduite ici, Steam affiche la version anglaise : c'est accepté.

## 2. Tags (20 max., l'ordre compte : les premiers pèsent le plus)

1. Battle Royale
2. Top-Down Shooter
3. PvP
4. Online PvP
5. Arena Shooter
6. Multiplayer
7. Cute
8. Colorful
9. Cartoony
10. Action
11. Casual
12. Hero Shooter
13. Twin Stick Shooter
14. Free to Play (seulement si gratuit)
15. Top-Down
16. Stylized
17. 3D
18. Fast-Paced
19. Funny
20. Singleplayer

## 3. Visuels à produire

Aucun visuel existant n'a encore le bon format. Tailles exigées par Steam :

| Visuel | Taille | Remarques |
| --- | --- | --- |
| Header capsule | 920 x 430 | Le plus vu (haut de page, recherches). Logo lisible en petit. |
| Small capsule | 462 x 174 | Logo seul presque, doit rester lisible à 120 px de large. |
| Main capsule | 1232 x 706 | Carrousel de la page d'accueil. |
| Vertical capsule | 748 x 896 | Soldes et événements saisonniers. |
| Page background | 1438 x 810 | Facultatif, ambiance floutée/sombre. |
| Library capsule | 600 x 900 | Bibliothèque. |
| Library header | 920 x 430 | Bibliothèque. |
| Library hero | 3840 x 1240 | Sans texte ni logo (le logo est posé par-dessus). |
| Library logo | 1280 x 720 | PNG transparent : `docs/readme/logo.png` fait l'affaire une fois recadré. |
| Icône communauté | 184 x 184 | Depuis `electron/icon.png`. |
| Icône client | .ico + 32 x 32 | `electron/icon.ico`. |
| Icônes de succès | 256 x 256 x 10, en double (débloqué + grisé) | Faites : [../achievements/](../achievements/) (`python art-src/gen_achievements.py`). |
| Captures d'écran | 1920 x 1080, 5 min. (8 à 10 conseillé) | Les nôtres font 1600 x 900 et 1280 x 800 : à refaire en 1080p. |
| Bande-annonce | MP4 H.264, 1920 x 1080, 5000 kbit/s min. | Faite : `steam/store/trailer.mp4`, 25 s en 1080p avec musique et logo (`python art-src/make_steam_trailer.py`). |

Règles Valve sur les capsules : uniquement l'illustration et le logo. Pas de "GRATUIT", pas de note,
pas de récompense, pas de citation de presse. Idée : les 5 figurines en pose d'action (les portraits
`public/assets/ui/*.png` sont déjà détourés) devant l'Oasis au coucher du soleil, logo en haut.

Règles sur les captures : du vrai jeu uniquement, pas d'art conceptuel ni de texte marketing.
Ordre conseillé : 1) combat à 8 avec supers qui partent, 2) buisson avec le dithering,
3) nuit + lampe frontale, 4) tempête de sable, 5) brouillard, 6) neige/glace, 7) les 5 brawlers, 8) écran de victoire.
Les 4 premières apparaissent au survol dans les listes : ce sont elles qui vendent.

Bande-annonce : du gameplay dès la première seconde (lecture auto et sans son sur la page),
30 à 60 s, logo à la fin, pas d'écran titre au début. `src/trailer.js` peut réenregistrer en 1080p.

## 4. Divulgation IA (obligatoire)

Dans le questionnaire de contenu (Content Survey), section "AI Generated Content Disclosure" :

- **Pre-Generated** : oui, coller le texte de divulgation de chaque fichier de langue.
- **Live-Generated** : non (rien n'est généré pendant la partie).

Ce texte est affiché publiquement sur la page. C'est cohérent avec le nom et l'histoire du jeu :
on assume à fond au lieu de subir. Valve vérifie cette section à la revue ; la laisser vide pour un
jeu qui s'appelle "AI SLOP" serait un refus assuré.

## 5. Prix : recommandation "gratuit"

Je recommande **Free** (sans microtransactions) :

- le jeu est déjà gratuit dans le navigateur : le vendre sur Steam serait mal vu ;
- un public méfiant envers l'IA pardonne beaucoup plus à un jeu gratuit ;
- un jeu à 8 joueurs a besoin de monde en ligne : la gratuité remplit les salons ;
- l'histoire des "2,61 $" fonctionne mieux gratuite.

Coût : 100 $ de frais Steam Direct, non remboursés pour un jeu gratuit.
Si tu préfères un prix, 1,99 $ / 1,99 € / 2 CHF au maximum, et retirer le tag "Free to Play".

## 6. Questionnaire de contenu (âge)

- Violence : **oui, occasionnelle, style cartoon** (K.-O., pas de sang, pas de mort montrée).
- Nudité, contenu sexuel, drogues, jeux d'argent, langage : **non**.
- Contenu généré par les joueurs : **non** (pas de chat, pas de pseudos libres). Si un chat ou des pseudos sont ajoutés un jour, le signaler.
- Si Steamworks propose le questionnaire IARC, le remplir : il donne les classifications PEGI/USK,
  utiles pour l'Allemagne.

## 7. Manette et Steam Deck

Le jeu se joue à la manette et les menus se naviguent au pad. Commencer par **Partial Controller Support**.
Passer à **Full** seulement après avoir vérifié qu'on peut tout faire sans clavier ni souris :
lancement, menus, options, invitation et rejoindre une partie (le panneau d'éclairage sous <kbd>Tab</kbd> est
un outil de debug, à cacher dans la version Steam).

Steam Deck : la build Windows tourne sous Proton. Pour viser "Vérifié" : Full Controller Support,
texte lisible en 1280 x 800, pas de lanceur externe, et un préréglage graphique par défaut adapté (Medium).

## 8. Avant la sortie : recommandations techniques

Par ordre d'importance :

1. **App ID réel** : remplacer 480 dans `package.json` et `steam/app_build.vdf` (+ l'ID de dépôt).
2. **Polices embarquées** : `play.html` charge Lilita One et Nunito depuis Google Fonts. Hors ligne, le jeu
   retombe sur une police système, et le chargement envoie l'adresse IP du joueur à Google
   (sujet RGPD sensible en Allemagne). Les deux polices sont sous licence OFL : les copier dans `public/`.
3. **Retirer les références à Brawl Stars** : le README dit "Brawl Stars-style Showdown". Les textes Steam
   n'en parlent pas volontairement (et évitent "Showdown") : ne pas les ajouter, ni sur la page ni en tag.
   Supercell protège activement sa marque.
4. **Succès traduits** : les tableaux des fichiers FR / DE / ES reprennent les traductions du jeu
   (`src/i18n/locales/*.json`, clés `ach.*`). À saisir dans Steamworks > Achievements, onglet de chaque langue.
   Si les traductions du jeu changent, reprendre les mêmes textes pour que Steam et le jeu disent la même chose.
5. **Steam Cloud** : la progression locale est dans le `localStorage` d'Electron. Activer l'Auto-Cloud sur
   `%APPDATA%/AI SLOP ARENA/Local Storage` pour la garder d'un PC à l'autre (les succès, eux, sont déjà sur Steam).
6. **Rich presence** : les chaînes (`presence.*`, "Solo on {map}"...) se déclarent aussi par langue dans Steamworks.

## 9. Calendrier

Valve impose des délais incompressibles :

1. Payer les frais Steam Direct (100 $), vérifier l'identité, remplir les infos bancaires et fiscales.
   **30 jours minimum** entre le paiement et la sortie.
2. Remplir la page (ce dossier) et la soumettre : revue Valve en ~3 à 5 jours ouvrés.
3. Passer la page en **"Coming Soon" le plus tôt possible** : obligatoire au moins 2 semaines avant la sortie,
   et chaque semaine visible accumule des listes de souhaits (les gens sont prévenus à la sortie, même pour un jeu gratuit).
4. Uploader une build et la soumettre à la revue : ~3 à 5 jours ouvrés.
5. Sortie.

En lançant tout cette semaine, une sortie est possible **fin octobre / début novembre 2026 au plus tôt**.
Un Steam Next Fest plus tard (le prochain dont l'inscription est encore ouverte) donnerait une vraie vague
de visibilité : dans ce cas, garder la page en "Coming Soon" jusque-là plutôt que sortir tout de suite.

## 10. Checklist

- [ ] Frais Steam Direct payés, App ID reçu
- [ ] App ID + ID de dépôt dans `package.json` et `app_build.vdf`
- [ ] Polices embarquées, panneau debug caché
- [ ] Succès + stats déclarés (voir [../README.md](../README.md)), noms traduits, 20 icônes (prêtes dans `steam/achievements/`)
- [ ] Textes EN / FR / DE / ES collés
- [ ] 3 GIF de [extras/](extras/) uploadés dans la description
- [ ] Divulgation IA + questionnaire de contenu remplis
- [ ] Tags, genres, catégories, langues, configuration requise
- [ ] Capsules (header, small, main, vertical), visuels de bibliothèque, icônes
- [ ] 8 à 10 captures 1920 x 1080, bande-annonce 1080p
- [ ] Page soumise puis passée en "Coming Soon"
- [ ] Build uploadée, testée depuis le client Steam (installation propre), soumise à la revue
