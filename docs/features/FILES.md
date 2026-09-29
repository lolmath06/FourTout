# Fichiers, dossiers et archives

[← Documentation](../README.md)

## Sommaire

- [Pourquoi le natif, et pas la WebView](#pourquoi-le-natif-et-pas-la-webview)
- [Progression et annulation](#progression-et-annulation)
- [Sécurité des archives](#sécurité-des-archives)
- [Formats d'archive](#formats-darchive)
- [Empreintes](#empreintes)
- [Doublons](#doublons)
- [Découpage et réassemblage](#découpage-et-réassemblage)
- [Renommage par lot](#renommage-par-lot)
- [Analyse de dossier et arborescence](#analyse-de-dossier-et-arborescence)
- [Comparaison de dossiers](#comparaison-de-dossiers)
- [Synchronisation](#synchronisation)
- [Recherche](#recherche)
- [Inspection, aperçu, hexadécimal](#inspection-aperçu-hexadécimal)
- [Sauvegarde et restauration](#sauvegarde-et-restauration)
- [Manifestes d'empreintes et HMAC](#manifestes-dempreintes-et-hmac)
- [Politique des liens symboliques](#politique-des-liens-symboliques)
- [Unités et précision](#unités-et-précision)
- [Portabilité Windows / Fedora](#portabilité-windows--fedora)
- [Tests](#tests)

---

Les outils Fichiers manipulent des **chemins**, pas des octets. C'est la
différence structurante avec les autres familles d'outils de FourTout.

## Pourquoi le natif, et pas la WebView

Trois raisons, dans cet ordre.

1. **Volume.** Hacher une image disque de 20 Go, créer une archive de 4 Go ou
   découper un fichier de 40 Go est impossible si les octets doivent traverser
   le pont IPC. Côté Rust, tout se fait par blocs de 256 Kio à 1 Mio : le coût
   mémoire est constant, quelle que soit la taille.
2. **Sécurité.** Extraire une archive demande de valider chaque chemin produit.
   Cette validation doit être unique, testée, et impossible à contourner depuis
   l'interface. Elle vit dans `safe_relative_path` / `resolve_inside`.
3. **Annulation.** Une analyse de dossier ou un hachage doivent pouvoir être
   réellement interrompus, pas simplement ignorés à leur retour.

```
src-tauri/src/files/
├── mod.rs        # état des jobs, progression, gardes de chemin
├── command.rs    # commandes Tauri (le seul point d'entrée du frontend)
├── archive.rs    # ZIP / 7z / TAR / TAR.GZ / TAR.XZ : création, inspection, extraction, test
├── compress.rs   # GZ et XZ : compression d'un fichier seul, en flux
├── hash.rs       # MD5, SHA-1, SHA-256, SHA-512 en flux
├── magic.rs      # reconnaissance de format par signature (autorité unique)
├── textscan.rs   # détection d'encodage côté natif, pour la recherche de contenu
├── walk.rs       # parcours d'arborescence : clés relatives, symlinks, erreurs
├── compare.rs    # comparaison de deux dossiers (rapide / fiable)
├── sync.rs       # plan de synchronisation, puis exécution de ce plan
├── search.rs     # recherche à la demande, résultats publiés par lots
├── hex.rs        # lecture par fenêtre, recherche en flux, écriture d'octets
├── backup.rs     # sauvegarde, manifeste, vérification, restauration
├── manifest.rs   # manifestes d'empreintes (format sha256sum) et HMAC
├── scan.rs       # taille de dossier, arborescence, doublons
├── split.rs      # découpage, manifeste, réassemblage vérifié
├── rename.rs     # plan de renommage (pur) et application en deux temps
└── docx.rs       # lecture des documents Word
```

Côté interface, `src/core/files/native.ts` est le client typé,
`PathPicker` la sélection (boîtes de dialogue natives **et** glisser-déposer
Tauri, qui fournit de vrais chemins) et `NativeToolShell` l'ossature commune.

## Progression et annulation

Chaque opération longue reçoit un `jobId`. Le socle natif émet
`files://progress` (`ratio`, `label`, `done`, `total`) et surveille un drapeau
d'annulation vérifié à chaque bloc lu. `files_cancel` lève ce drapeau ;
l'opération s'arrête et renvoie `cancelled`, que le client traduit en
`JobCancelledError`.

Conséquence concrète : une annulation ne laisse jamais de résultat trompeur.
Un réassemblage dont l'empreinte ne correspond pas au manifeste **supprime** le
fichier produit plutôt que de le livrer.

## Sécurité des archives

### À l'extraction

`safe_relative_path` refuse, avant toute écriture :

| Cas | Exemple |
| --- | --- |
| Remontée de dossier | `../../evil.txt`, `a/../../evil.txt` |
| Chemin absolu POSIX | `/etc/passwd` |
| Chemin UNC | `//serveur/partage/x` |
| Racine Windows | `C:\Windows\system32\evil.dll` |
| Séparateurs Windows inversés | `..\..\evil.txt` |
| Octet nul dans le nom | — |

`resolve_inside` ajoute une seconde garde : après normalisation, le chemin final
doit toujours commencer par le dossier de destination **canonicalisé**.

Les entrées TAR de type lien symbolique ou lien physique sont ignorées et
listées : suivre un lien reviendrait à écrire où il pointe.

Les entrées refusées ne font pas échouer l'extraction — elles sont **listées**
dans le résultat. L'utilisateur voit ce qui a été écarté et pourquoi.

### Avant l'extraction

L'archive est inspectée sans rien écrire : format, nombre de fichiers, taille
compressée, taille décompressée annoncée, entrées refusées. Deux garde-fous :

- au-delà de **200 000 entrées**, l'extraction est refusée ;
- un rapport de compression supérieur à **200×** pour plus de **64 Mio**
  décompressés déclenche un avertissement visible (bombe de décompression
  probable). En deçà de ce volume, un fort taux est banal — un journal fait de
  lignes répétées le dépasse sans rien avoir de suspect.

### À la création

Les noms écrits dans l'archive passent par la **même** validation que ceux
acceptés à l'extraction : FourTout ne fabrique pas d'archive piégée, même par
accident. Les liens symboliques rencontrés lors du parcours ne sont pas suivis.

### Écrasement

Jamais silencieux. Sans l'option explicite « écraser », un fichier déjà présent
fait écrire le nouveau **à côté**, sous un nom libre (`a (2).txt`).

## Formats d'archive

| Format | Création | Extraction | Inspection | Test d'intégrité | Moteur |
| --- | --- | --- | --- | --- | --- |
| ZIP | oui | oui | oui | CRC-32 par entrée | `zip` |
| 7z | oui | oui | oui | oui | `sevenz-rust2` |
| TAR | oui | oui | oui | structure et en-têtes seulement | `tar` |
| TAR.GZ | oui | oui | oui | oui | `tar` + `flate2` |
| TAR.XZ | oui | oui | oui | oui | `tar` + `lzma-rust2` |
| GZ (fichier seul) | oui | oui | — | oui | `flate2` |
| XZ (fichier seul) | oui | oui | — | oui | `lzma-rust2` |
| RAR | non | non | non | non | format fermé, décompresseur non redistribuable |

Tous ces moteurs sont des **bibliothèques Rust embarquées**. FourTout ne
dépend d'aucun `7z`, `xz` ou `tar` installé sur la machine : une fonction
essentielle doit marcher sur une installation propre.

### `.gz` n'est pas une archive

`.gz` et `.xz` ne contiennent qu'un **flux** : un seul fichier, sans nom de
dossier, sans arborescence, sans permissions. `archive.tar.gz` est autre chose
— un TAR, qui porte l'arborescence, ensuite compressé. Les deux outils sont
donc distincts (`file-compress` / `archive-create`), et chacun renvoie vers
l'autre quand l'utilisateur s'est trompé de porte.

### Ce qu'un test d'intégrité prouve, format par format

Le test décompresse **réellement** tout le contenu et jette les octets — lister
une archive ne prouverait rien, seul son en-tête serait lu.

- **ZIP** : le CRC-32 de chaque entrée est vérifié en la lisant jusqu'au bout.
- **7z** : vérification par le moteur, entrée par entrée.
- **GZ / XZ / TAR.GZ / TAR.XZ** : la somme de contrôle de l'enveloppe se trouve
  *à la fin* du flux. Le parcours des entrées s'arrêtant à la marque de fin du
  TAR, une lecture complète supplémentaire est faite : sans elle, un `.tar.gz`
  abîmé passerait pour sain.
- **TAR nu** : le format ne porte **aucune** somme de contrôle du contenu. Une
  altération des données d'un fichier y est indétectable, et le verdict le dit
  explicitement plutôt que d'annoncer une garantie que le format ne donne pas.
  Seules la structure (multiple de 512, marque de fin présente) et les sommes
  de contrôle d'en-tête sont vérifiables.

### Chiffrement 7z

Non proposé. Le ZIP AES-256 de l'outil « Archive protégée » couvre déjà le
besoin et s'ouvre avec 7-Zip, WinRAR, Keka et l'Explorateur Windows ; ajouter
un second format chiffré dont la compatibilité serait plus incertaine
n'apporterait rien à l'utilisateur.

**Archive chiffrée** (`archive-encrypted`) : **WinZip AES-256**. Le chiffrement
historique du ZIP (ZipCrypto) se casse en quelques secondes à partir de
quelques octets de clair connu ; il n'est jamais employé, car une « archive
protégée » qui ne protège pas serait trompeuse.

L'interopérabilité est vérifiée en relisant l'archive avec **7-Zip**, pas avec
le code qui l'a écrite (`src-tauri/tests/files_integration.rs`) : le test
contrôle que l'outil externe annonce bien « AES-256 », qu'il refuse un mauvais
mot de passe, et qu'avec le bon il restitue les octets exacts — sous-dossier et
nom accentué compris.

Limite du format ZIP, dite dans la note de l'outil : les **noms de fichiers**
restent lisibles sans le mot de passe. Seul le contenu est chiffré. Pour cacher
aussi les noms, il faut chiffrer l'archive elle-même avec `file-encrypt`.

## Empreintes

Lecture par blocs de 1 Mio, plusieurs algorithmes cumulés en **une seule
lecture** du fichier. Progression exprimée en octets réellement parcourus.

MD5 et SHA-1 sont proposés parce que ce sont les sommes de contrôle publiées
par beaucoup de sites de téléchargement — accompagnés partout d'un
avertissement : ils ne conviennent plus à un usage cryptographique.

Le champ « empreinte attendue » compare automatiquement et affiche
« correspond » ou « diffère », sans que l'utilisateur ait à lire 64 caractères
hexadécimaux.

## Doublons

Trois passes, de la moins chère à la plus chère :

1. regroupement par **taille** (une seule lecture des métadonnées) ;
2. empreinte **partielle** : SHA-256 de la taille + trois fenêtres de 64 Kio
   (début, milieu, fin) — élimine les faux candidats sans lire des gigaoctets ;
3. SHA-256 **complet** sur ce qui reste.

FourTout **ne supprime rien**, et ne propose aucun bouton pour le faire. Le
rapport donne les groupes, l'espace récupérable et un bouton « ouvrir
l'emplacement ». Un effacement de fichiers ne se rattrape pas : c'est une
décision de l'utilisateur, dans son explorateur.

## Découpage et réassemblage

Le découpage écrit `fichier.bin.part001`, `part002`, … et un manifeste
`fichier.bin.fourtout-parts.json` contenant le nom d'origine, la taille totale,
le SHA-256 de l'original, le nombre de morceaux et la taille de chacun.

Le réassemblage part de **n'importe quel** morceau, retrouve les autres, refuse
une séquence à trou, concatène en flux et compare au manifeste. Sans manifeste,
il reconstruit et le dit clairement : l'intégrité n'a pas pu être vérifiée.

## Renommage par lot

Le calcul du plan (`rename::plan`) est une fonction **pure** : elle prend des
chemins et des règles, rend des noms et des problèmes. C'est ce qui permet
d'afficher un aperçu fidèle avant d'écrire quoi que ce soit, et de le tester
sans toucher au disque.

Sont détectés avant toute écriture :

- deux fichiers qui deviendraient le même nom ;
- un nom déjà pris par un fichier hors du lot ;
- les caractères interdits sous Windows (`< > : " / \ | ? *`), les noms
  réservés (`CON`, `PRN`, `LPT1`…), un nom finissant par un espace ou un point,
  un nom de plus de 255 octets.

Le moindre conflit **bloque** l'application : mieux vaut ne rien faire que
renommer à moitié. L'application se fait en deux temps (noms temporaires puis
noms définitifs) pour autoriser les permutations `a → b` / `b → a`.

## Analyse de dossier et arborescence

Parcours récursif qui **ne suit jamais** les liens symboliques (un lien vers
`/` ferait tourner l'analyse indéfiniment ; il est compté à part). Les dossiers
illisibles sont listés au lieu d'être comptés à zéro en silence.

L'arborescence ignore par défaut `node_modules`, `.git`, `target`, `dist` et
les fichiers cachés, avec profondeur maximale réglable ; l'atteindre est
signalé plutôt que masqué.


## Comparaison de dossiers

Deux modes, et la différence entre eux est une question d'honnêteté plus que de
vitesse.

| Mode | Ce qui est comparé | Ce qui est affirmé |
| --- | --- | --- |
| Rapide | Type et taille | « Probablement identique » — aucun octet n'a été lu |
| Fiable | Empreinte SHA-256 du contenu | « Identique », confirmé |

Une taille différente conclut sans aucune lecture : le mode fiable ne calcule
d'empreinte que pour les fichiers de **même taille**. Les dates sont affichées
comme indice, jamais utilisées comme preuve — un `cp` sans `-p` change la date
sans changer un octet, et une restauration d'archive fait l'inverse.

Les entrées sont rapprochées par **chemin relatif normalisé** (`/`). Sous
Windows, la clé est insensible à la casse (`A.txt` et `a.txt` y sont le même
fichier) ; sous Linux, elle ne l'est pas. Forcer l'une ou l'autre sémantique
partout produirait de faux « identiques » d'un côté et de faux « manquants » de
l'autre. Les chemins qui ne diffèrent que par la casse sont listés à part.

## Synchronisation

À sens unique : la source fait foi, la destination la suit. Il n'y a **pas** de
synchronisation bidirectionnelle, et il n'y en aura pas dans cette phase.

| Mode | Copie | Remplace | Supprime |
| --- | --- | --- | --- |
| Mettre à jour | oui | oui | non |
| Miroir | oui | oui | **oui** |

**Le plan est un objet, pas une intention.** `build_plan` produit la liste
exacte des opérations, `execute` n'exécute que cette liste. Rien n'est
recalculé entre l'affichage et la confirmation — ce que l'utilisateur a lu est
ce qui se produit. Un appel automatisé futur peut donc demander le plan,
l'afficher, obtenir un accord, puis exécuter exactement ce plan.

**Ce qui a bougé entre-temps n'est jamais écrasé.** Chaque opération retient la
taille et la date de la source au moment du plan. Si le fichier a changé
depuis, l'opération est refusée et rapportée dans `changedSincePlan`.

**Une copie interrompue ne laisse pas de fichier tronqué.** Toute copie passe
par un temporaire `.fourtout-sync-*` dans le dossier de destination, suivi d'un
renommage atomique (`fs::rename` remplace l'existant sur Unix comme sur
Windows). Une annulation supprime le temporaire et laisse l'ancien fichier
intact. Le bilan annonce alors « X opérations sur Y terminées » : une
synchronisation partielle n'est jamais présentée comme réussie.

Deux configurations sont **refusées** plutôt qu'averties : une destination
contenant la source (le miroir détruirait la source) et une destination à
l'intérieur de la source (la copie se nourrirait d'elle-même).

Le mode miroir exige, en plus de la lecture du plan, la saisie du mot
`SUPPRIMER` — mais seulement lorsqu'il y a réellement quelque chose à effacer.

## Recherche

À la demande, jamais indexée : rien ne tourne en fond, rien n'est conservé
entre deux recherches, aucun fichier caché ne grossit dans le dossier
personnel.

Les critères se cumulent — nom, extensions, taille, dates, contenu — et sont
évalués du moins cher au plus cher : un fichier écarté par son nom n'est jamais
ouvert.

La recherche de contenu n'ouvre que ce qui **ressemble vraiment** à du texte.
La décision est celle du moteur d'encodage de la phase 8, transposée en Rust
(`textscan.rs`) : mêmes indices, dans le même ordre (BOM, motif UTF-16 sans
BOM, validité UTF-8, plage 0x80–0x9F). Cette duplication est assumée — faire
transiter des milliers de fichiers par la WebView pour réutiliser le moteur
TypeScript coûterait bien plus cher — et des tests croisés vérifient que les
deux moteurs ne divergent pas. Un binaire n'est jamais interprété comme du
texte : la recherche par nom, taille et date continue de le trouver.

Les résultats sont publiés **par lots de 25** sur `files://partial` pendant le
parcours. Sur une arborescence de cinquante mille fichiers, la différence entre
« une barre qui avance » et « des résultats qui tombent » est celle entre un
outil qu'on attend et un outil qu'on utilise.

Limite assumée : au-delà de 64 Mo, un fichier n'est pas ouvert pour la
recherche de contenu. Il reste trouvable par son nom, sa taille ou sa date, et
le rapport le compte à part.

## Inspection, aperçu, hexadécimal

`magic.rs` est l'**autorité unique** de FourTout sur « ce que ce fichier est
réellement ». Une trentaine de signatures — PDF, PNG, JPEG, GIF, WEBP, BMP,
TIFF, ZIP, 7z, GZIP, XZ, BZIP2, Zstandard, RAR, SQLite, ELF, PE, WASM, MP3,
WAV, FLAC, Ogg, MP4, MOV, AVI, Matroska, OLE2, RTF, plus les trois marques
d'ordre des octets — pas une base de milliers d'entrées dont personne ne
vérifie jamais l'exactitude.

### Deux pièges, et comment ils sont traités

**`FF FE` n'est pas un MP3.** Ces deux octets sont la marque d'ordre d'un
fichier UTF-16 petit-boutien ; ce sont aussi, bit pour bit, un mot de
synchronisation MPEG plausible. Un fichier texte s'est ainsi retrouvé annoncé
comme « Audio MP3 ». Deux corrections, pas une :

1. les marques d'ordre des octets sont examinées **avant** tout le reste ;
2. le mot de synchronisation ne suffit plus à conclure au MP3 — la version, la
   couche, l'index de débit et l'index de fréquence sont validés, et chacun a
   des valeurs réservées ou interdites qui écartent les coïncidences.

**Une marque d'ordre n'est pas une preuve.** Deux octets ne font pas un fichier
texte : n'importe quel binaire peut commencer par `FF FE`. Le contenu qui suit
est donc décodé, et rejeté s'il produit des caractères de remplacement (paires
de substitution orphelines) ou trop de codes de contrôle. Un fichier texte bien
formé n'en produit aucun.

Conséquence pour le reste de l'application : `looks_like_text` ne repose plus
sur « contient un octet nul, donc binaire » — règle qui déclarait binaire tout
fichier UTF-16, dont un octet sur deux est nul par construction. La décision
est déléguée à `textscan`, le même moteur que la recherche de contenu.

L'inspecteur croise trois sources, et le contraste entre elles est tout
l'intérêt de l'outil : ce que le **nom** prétend, ce que les **premiers octets**
révèlent, ce que le **contenu** dit quand c'est du texte (encodage, BOM, fins
de ligne — via le moteur de la phase 8, appliqué à la fenêtre déjà lue).

Un `.jpg` contenant un PNG est signalé. **Rien n'est renommé automatiquement** :
sur une bibliothèque de photos entière, une correction fondée sur une
supposition fait plus de dégâts qu'un nom trompeur.

L'aperçu suit le **contenu**, pas l'extension, et ne développe aucun nouveau
décodeur : images, audio et vidéo passent par les lecteurs déjà présents dans
la WebView, le PDF par `usePdfPage` — le moteur de rendu des outils PDF
visuels, avec navigation page à page —, le texte par le moteur d'encodage, les
archives par le moteur de listage natif, le reste par l'affichage hexadécimal.

Le type employé pour construire l'objet binaire vient du **type détecté**,
jamais de l'extension : étiqueter des octets PNG en `image/jpeg` parce que le
fichier s'appelle `.jpg` annulerait le travail de détection, et l'image ne
s'afficherait pas. Le panneau affiche les dimensions réelles sur fond en
damier, et signale explicitement un contenu que le moteur d'affichage a refusé
— sans quoi « image minuscule » et « aperçu en échec » se ressemblent trop.

### Passages de relais

Regarder un fichier donne presque toujours envie d'en faire quelque chose.
L'inspecteur, l'aperçu, l'inspection d'archive, l'éditeur hexadécimal et la
compression proposent donc les outils pertinents **avec le fichier déjà
transmis** — un chemin pour les outils Fichiers, un fichier chargé pour les
outils PDF, image et média, qui n'en acceptent pas d'autre.

Les identifiants visés sont rassemblés dans `src/features/handoff/targets.ts`,
et un test vérifie que chacun existe au registre et porte une implémentation :
un lien mort fait échouer la suite plutôt que d'attendre une recette manuelle.
L'outil spécialisé proposé dérive de la **famille détectée** — un `.jpg`
contenant un PNG mène au convertisseur d'image, et un `.gz` mène au
décompresseur plutôt qu'à un inspecteur d'archive qui n'aurait rien à lister.

L'éditeur hexadécimal est volontairement **borné** : ni modèles binaires, ni
script, ni désassemblage, ni insertion ou suppression d'octets. Ce qu'il fait,
il le fait entièrement :

- lecture par fenêtres de 512 octets (plafond du moteur : 64 Kio) — un fichier
  de 20 Go se parcourt sans que rien ne soit chargé en mémoire ;
- la recherche porte sur **tout le fichier**, jamais sur la fenêtre affichée :
  une seule passe en flux rend toutes les occurrences, ce qui permet d'annoncer
  « occurrence 3 sur 17 » et de naviguer d'avant en arrière — un « suivante »
  qui relit le fichier à chaque fois ne connaît jamais le total ;
- la séquence trouvée est surlignée **en entier**, y compris à cheval sur deux
  lignes, et la fenêtre qui la contient est chargée au besoin ;
- les occurrences qui se chevauchent sont comptées comme telles : « aa »
  apparaît trois fois dans « aaaa » ;
- l'éditeur d'octet se tient **au-dessus** de la table, à portée immédiate de
  ce qu'on vient de cliquer, et une invite le dit tant que rien n'est
  sélectionné ;
- **la taille du fichier ne change jamais** : une insertion décalerait toutes
  les structures du fichier et produirait, neuf fois sur dix, un fichier cassé ;
- l'enregistrement produit par défaut un **nouveau fichier** ; écraser
  l'original est un choix distinct, suivi d'un avertissement.

## Sauvegarde et restauration

Format délibérément **transparent**, pas propriétaire :

```
ma-sauvegarde/
├── donnees/          # copie fidèle de l'arborescence, lisible sans FourTout
└── manifeste.json    # inventaire : chemins relatifs, tailles, dates, SHA-256
```

Le coût est connu — la sauvegarde occupe autant que la source — et il achète
quelque chose qu'aucun conteneur opaque ne donne : si FourTout disparaît, les
fichiers restent accessibles avec un explorateur de fichiers.

Le manifeste ne contient **aucun chemin absolu** : une sauvegarde faite sous
`C:\Users\…` se restaure sous `/home/…` sans rien réécrire.

Ce n'est **pas** un système de versions. Pas d'instantanés incrémentaux, pas de
déduplication par blocs, pas d'historique, pas de montage virtuel : une
sauvegarde est une photo complète, datée, vérifiable.

Le chemin complet est `sauvegarder → vérifier → restaurer` :

- la vérification recalcule le SHA-256 de chaque fichier et classe le résultat
  en `intact / manquant / modifié / illisible` ;
- la restauration lit d'abord le manifeste, annonce les collisions, puis écrit.
  Un fichier dont l'empreinte ne correspond plus est restauré **et nommé** :
  le taire serait remettre en place un fichier abîmé en laissant croire que
  tout va bien ;
- restaurer ne supprime **jamais** rien : ce que la destination contient en
  plus, elle le garde.

Une sauvegarde interrompue écrit un manifeste qui ne décrit que les fichiers
réellement copiés, et le dit dans ses avertissements.

Une destination non vide qui ne contient pas déjà une sauvegarde FourTout est
refusée : écraser le dossier personnel de quelqu'un par mégarde ne doit pas
être à un clic.

## Manifestes d'empreintes et HMAC

L'écran se lit en deux temps numérotés — le fichier de checksums, puis la
racine —, avec l'exemple qui montre comment les deux se combinent. Créer un
manifeste propose ensuite de le vérifier, manifeste et racine déjà en place :
resélectionner à la main le fichier qu'on vient d'écrire n'aurait aucun sens.

Le format texte produit est celui de `sha256sum` : `<empreinte>  <chemin>`,
avec l'échappement GNU des chemins contenant `\` ou un saut de ligne. Il se
relit avec les outils du système, sur n'importe quelle machine, même sans
FourTout. Un format JSON plus riche (tailles incluses) est aussi proposé ;
la vérification lit les deux.

L'algorithme est déduit de la **longueur** de l'empreinte : 32 → MD5, 40 →
SHA-1, 64 → SHA-256, 128 → SHA-512.

**MD5 et SHA-1 restent proposés, jamais recommandés.** On les trouve encore sur
des pages de téléchargement anciennes, et vérifier un fichier avec eux a du
sens ; s'en servir pour prouver qu'un fichier n'a pas été modifié
*volontairement* n'en a plus depuis 2004 et 2017 respectivement. L'interface le
dit à chaque fois, à la création comme à la vérification.

**Un manifeste est une donnée, pas une instruction.** Un chemin `../../` ou
`/etc/passwd` dans un `.sha256` reçu de l'extérieur est refusé et listé
(`refused`), jamais suivi. Les entrées légitimes du même fichier restent
vérifiées.

Le **HMAC** (SHA-256, SHA-512, SHA-1 pour les services anciens) porte sur un
texte saisi ou sur un fichier lu en flux. La clé n'est ni enregistrée, ni
journalisée, ni ajoutée aux récents ; elle traverse l'IPC une seule fois et est
effacée de l'écran dès qu'on quitte l'outil. Les vecteurs de test RFC 4231 et
RFC 2202 sont vérifiés par la suite de tests.

## Politique des liens symboliques

Une seule politique, appliquée par `walk.rs` et partagée par la comparaison, la
synchronisation, la recherche, la sauvegarde et les manifestes.

| Politique | Comportement |
| --- | --- |
| `report` (défaut) | Le lien est inventorié et signalé, jamais suivi |
| `skip` | Le lien est ignoré, mais reste compté au rapport |
| `follow-inside` | Le lien est suivi **si et seulement si** sa cible reste sous la racine |

Même en mode `follow-inside`, une cible hors de la racine est refusée et
listée : sinon, sauvegarder `~/photos` pourrait aspirer tout le disque par un
simple raccourci. Les boucles sont coupées par un ensemble de chemins
canonicalisés déjà visités.

La synchronisation ne copie ni ne supprime les liens symboliques, et le dit
dans les avertissements du plan.

## Unités et précision

Les tailles sont comptées en **multiples binaires** — c'est ce que fait le
système de fichiers. Les libellés le disent donc : Kio, Mio, Gio. Écrire « Ko »
devant un calcul en 1024 mélangeait deux conventions et rendait tout écart
inexplicable.

Les outils dont le métier est de vérifier — analyse d'espace, plan de
synchronisation, inspection, intégrité — donnent en plus le **nombre exact
d'octets** : un chiffre qu'on ne peut pas recouper ne vaut rien dans ce
contexte. La précision de la forme arrondie suit l'ordre de grandeur (deux
décimales sous dix, une sous cent, aucune au-delà) : « 10 Mio » pour
10 584 064 octets n'est pas une réponse.

Même principe pour les compteurs du plan de synchronisation : « fichiers à
copier » et « opérations au total » comptent deux choses différentes, et
l'écran le dit. Un dossier créé n'est pas un fichier copié.

## Portabilité Windows / Fedora

| Sujet | Traitement |
| --- | --- |
| Séparateurs | Les archives sont normalisées en `/` ; l'affichage détecte `\` ou `/` (`separatorOf`) |
| Aucun chemin en dur | Tout chemin vient d'une boîte de dialogue ou du glisser-déposer ; aucune constante `/home/...` |
| Noms Unicode | Fixture `unicode-é.txt` traversant ZIP, TAR et TAR.GZ, testée |
| Caractères interdits Windows | Vérifiés par `validate_name`, y compris sous Linux — un lot renommé sous Fedora doit rester ouvrable sous Windows |
| Casse | Les collisions de renommage sont détectées **sans tenir compte de la casse** : sur NTFS, `A.txt` et `a.txt` sont le même fichier |
| Liens symboliques | Jamais suivis, ni à l'archivage, ni au parcours, ni à l'extraction |
| Permissions | Une erreur de lecture est remontée telle quelle et listée, jamais avalée |
| Fichiers cachés | Option explicite : préfixe `.` sous Unix, **et** l'attribut `FILE_ATTRIBUTE_HIDDEN` sous Windows (`walk::is_hidden`) |
| Remplacement atomique | `fs::rename` passe `MOVEFILE_REPLACE_EXISTING` sous Windows : la copie de synchronisation remplace sans jamais tronquer |
| Racine contenant `..` | La garde de chemin porte sur l'**entrée** d'archive ou de manifeste, jamais sur la racine fournie par l'utilisateur |
| Racines disque | Aucune énumération de volumes : l'utilisateur désigne toujours son point de départ |

## Tests

- `src-tauri/src/files/*` — tests unitaires : gardes de chemin, parcours et
  politique des liens symboliques, **signatures et sosies du MP3**,
  comparaison rapide/fiable, plan et exécution de synchronisation, recherche et
  détection texte/binaire, fenêtres hexadécimales et recherche de toutes les
  occurrences (y compris à cheval sur deux blocs, y compris chevauchantes),
  sauvegarde/vérification/restauration, manifestes et vecteurs HMAC de
  référence, aller-retour des cinq formats d'archive, GZ et XZ, archives
  abîmées, tronquées et piégées.
- `src-tauri/tests/files_integration.rs` — tests sur les fixtures de la phase 6.
- `src-tauri/tests/phase9.rs` — tests sur les **vraies fixtures** de
  `test-assets/generated/`, produites par du code Node indépendant des moteurs
  éprouvés, plus un **contrat de fixtures** : `scripts/fixture-contract.mjs`
  observe le disque et écrit ce constat dans `CONTRAT.json`, et le test vérifie
  que les moteurs sont d'accord avec lui. Ce contrat existe parce qu'une
  recette manuelle avait dérivé des fixtures — elle annonçait quatre fichiers
  `.txt` là où il y en avait six. Plus aucune valeur attendue ne se recopie :
  elle se dérive, et l'écart se voit en test.
- Côté interface : aperçu (image réellement rendue avec le type détecté, page
  de PDF réellement rendue, navigation entre pages), éditeur hexadécimal
  (recherche globale, surlignage complet, occurrence n sur N, saut de fenêtre,
  éditeur d'octet accessible), recherche (filtre de date inactif par défaut,
  résultats signalés comme périmés), synchronisation (distinction fichiers
  copiés / opérations totales), archives (champ de mot de passe conditionnel,
  verdict nuancé du TAR), manifestes (explication des deux champs, relais vers
  la vérification), et **navigation** : chaque relais de la phase 9 vise un
  outil qui existe et qui est branché.
- Deux mesures de performance `#[ignore]` (`cargo test --test phase9 --
  --ignored --nocapture`) : 5 000 fichiers et un fichier de 512 Mio.

Les tests d'intégration s'ignorent proprement — en le disant — si les fixtures
n'ont pas été générées (`pnpm test:assets`).
