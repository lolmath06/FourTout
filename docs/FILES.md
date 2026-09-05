# Fichiers, dossiers et archives

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
├── archive.rs    # ZIP / TAR / TAR.GZ : création, inspection, extraction
├── hash.rs       # MD5, SHA-1, SHA-256, SHA-512 en flux
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
- un rapport de compression supérieur à **200×** pour plus d'**1 Gio**
  décompressé déclenche un avertissement visible (bombe de décompression
  probable).

### À la création

Les noms écrits dans l'archive passent par la **même** validation que ceux
acceptés à l'extraction : FourTout ne fabrique pas d'archive piégée, même par
accident. Les liens symboliques rencontrés lors du parcours ne sont pas suivis.

### Écrasement

Jamais silencieux. Sans l'option explicite « écraser », un fichier déjà présent
fait écrire le nouveau **à côté**, sous un nom libre (`a (2).txt`).

## Formats d'archive

| Format | Création | Extraction | Remarque |
| --- | --- | --- | --- |
| ZIP | oui | oui | `zip` (deflate), niveaux 0 à 9 |
| TAR | oui | oui | sans compression |
| TAR.GZ | oui | oui | `tar` + `flate2` |
| 7z | non | non | voir ci-dessous |
| RAR | non | non | format fermé, décompresseur non redistribuable |

**7z** : aucune bibliothèque Rust 7z n'atteint aujourd'hui la maturité et la
clarté de licence requises pour être embarquée, et passer par un binaire
externe casserait la promesse « tout est embarqué, rien à installer ». L'outil
`archive-create` le dit dans sa note plutôt que de le proposer à moitié.

**Archive chiffrée** (`archive-encrypted`, `planned`) : le chiffrement
historique du ZIP (ZipCrypto) se casse en quelques secondes. Proposer une
« archive protégée » qui ne protège pas serait trompeur. L'AES-256 du ZIP
demande une brique de chiffrement à part, prévue avec les outils de chiffrement
de fichiers.

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
| Fichiers cachés | Option explicite (`.` sous Unix ; l'attribut caché Windows n'est pas lu, c'est une limite connue) |
| Racines disque | Aucune énumération de volumes : l'utilisateur désigne toujours son point de départ |

## Tests

- `src-tauri/src/files/*` — 28 tests unitaires : gardes de chemin, aller-retour
  des trois formats, zip-slip, non-écrasement, empreintes de référence,
  découpage/réassemblage, doublons, arborescence, plan de renommage.
- `src-tauri/tests/files_integration.rs` — 9 tests sur les **vraies fixtures**
  de `test-assets/generated/` : archives générées par le script Node, archive
  piégée `evil-zip-slip.zip`, DOCX réel, dossier de doublons, découpage en
  cinq morceaux avec vérification d'empreinte.

Les tests d'intégration s'ignorent proprement si les fixtures n'ont pas été
générées (`pnpm test:assets`).
