# test-assets/

Fichiers d'exemple utilisés pendant tout le développement de FourTout : essais
manuels des outils, tests automatisés, vérification des cas limites.

## Pourquoi ce dossier

Chaque outil de FourTout manipule des fichiers réels. Disposer d'un jeu de
fixtures stable évite de chercher un PDF ou une image « au hasard » sur le
disque à chaque essai, et permet de reproduire un bug à l'identique.

## Organisation

```
test-assets/
├── README.md
└── generated/      # fixtures produites par script — non versionnées
```

- **`generated/`** est régénérable et exclu de Git (voir `.gitignore`). Aucun
  binaire n'alourdit donc l'historique.
- Un fichier d'exemple **volumineux ou non reproductible** (vraie vidéo, vrai
  scan) peut être ajouté à la racine de `test-assets/`, mais seulement s'il est
  petit et réellement nécessaire.

## Régénérer les fixtures

```bash
pnpm test:assets
```

Le script `scripts/generate-test-assets.mjs` produit tous les octets lui-même :
aucun téléchargement, aucune dépendance supplémentaire.

## Fixtures actuelles

### Documents PDF (phase 2)

Toutes ces pages portent un **grand numéro** et une **couleur distincte** :
après un découpage, une extraction ou une réorganisation, l'ordre se vérifie
d'un coup d'œil.

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `pdf-single-page.pdf` | 1 page, « PAGE 1 » rouge | Fusion, conversions |
| `pdf-three-pages.pdf` | 3 pages : rouge, vert, bleu | Fusion, PDF vers images, extraction de texte |
| `pdf-five-pages.pdf` | 5 pages colorées | Découpage, extraction, suppression, réorganisation |
| `pdf-ten-pages.pdf` | 10 pages colorées | Suppression multiple, numérotation, plages |
| `pdf-with-metadata.pdf` | 2 pages, titre « Rapport de test FourTout », auteur « Equipe FourTout » | Lecture et écriture des métadonnées |
| `pdf-with-image.pdf` | 1 page, texte + image embarquée | Extraction d'images |
| `pdf-large-images.pdf` | 4 pages, images non compressées (~4,5 Mo) | Compression — c'est le fichier qui montre un vrai gain |
| `pdf-protected.pdf` | 2 pages, **chiffré AES-256** | Déverrouillage, détection de document protégé |
| `pdf-invalid.pdf` | En-tête `%PDF-` suivi de texte quelconque | Vérifier le message « document endommagé » |
| `pdf-edit-text.pdf` | 3 pages : texte simple ; tailles/graisses/couleurs ; textes sur fond bleu et vert unis | **Modifier le texte d'un PDF** — édition simple, variantes, et fond coloré non détruit |
| `pdf-edit-text-long.pdf` | 1 page, mot court « 2026 » isolé avec de la place à droite | Tester un remplacement nettement plus long (« année fiscale 2027 ») |

> **Mot de passe de `pdf-protected.pdf` : `fourtout`**

### Récupération de mot de passe (phase 3)

Mots de passe **dérivés du corpus réel** (donc réellement retrouvables), placés
suffisamment loin pour prouver une vraie recherche. Le mot de passe exact de
chaque fichier est écrit dans `recovery-fixture.json` à la génération.

| Fichier | Chiffrement | Où se trouve le mot de passe |
| --- | --- | --- |
| `pdf-recover-quick.pdf` | AES-128 | Graine de rang ~800 : hors des 100 premiers candidats, trouvée au niveau **Rapide** en quelques secondes |
| `pdf-recover-deep.pdf` | AES-256 | Graine profonde + « 2024 » : atteinte au niveau **Complet** après ~360 000 candidats (plusieurs lots) |
| `recovery-fixture.json` | — | Paramètres + mots de passe, pour le test d'intégration Rust |

### Images pour « Images vers PDF »

| Fichier | Contenu |
| --- | --- |
| `page-red.png` | 600 × 400, fond rouge, texte « ROUGE » |
| `page-green.png` | 600 × 400, fond vert, texte « VERT » |
| `page-blue.png` | 600 × 400, fond bleu, texte « BLEU » |

### Intelligence documentaire (phase 8)

Produites par `scripts/generate-document-assets.mjs`. Les phrases et les valeurs
sont **connues des tests** : ce sont elles que l'on cherche après traitement.

#### Scans et photos

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `scanned-two-page.pdf` | 2 pages **entièrement raster** : facture FR page 1, invoice EN page 2. Aucune couche texte | PDF recherchable — l'extraction de texte doit être vide **avant** traitement |
| `scanned-accents.pdf` | 1 page raster : « Résumé du dossier », « Éditée à Genève, très tôt », « Coût : 128,50 euros où ça », « L'apostrophe et le çà » | Vérifier que `é è à ç ù ô` et l'apostrophe traversent OCR → couche texte → extraction |
| `scanned-multipage-stress.pdf` | 10 pages raster, chacune portant un repère unique (`Repere 01` … `Repere 10`) | Tenue dans la durée de la reconnaissance : dix appels successifs au moteur WebAssembly sur un même worker. Les repères prouvent qu'aucune page n'est perdue, vide, ni recopiée d'une autre |
| `scan-perspective.jpg` | Feuille photographiée en biais sur fond sombre, 1200 × 1350 | Correction de perspective |
| `scan-perspective.json` | **Coordonnées exactes des quatre coins** de la feuille ci-dessus | Évite d'avoir à les deviner, dans les tests comme à la main |
| `scan-skewed.jpg` | Page de texte inclinée de **3,2°** exactement | Détection et correction du travers |
| `scan-low-contrast.jpg` | Texte gris `#8a8a8a` sur papier beige `#d8d6cf` | Contraste et blanchiment du fond |
| `scan-pages/page-01…03.jpg` | Trois pages numérotées et distinctes | Scans vers PDF — l'ordre se vérifie d'un coup d'œil |

#### Tableaux

Mêmes valeurs dans les deux fichiers, deux présentations opposées : c'est ce qui
prouve que la détection s'appuie sur la **position du texte**, et non sur les
bordures.

| Fichier | Contenu |
| --- | --- |
| `table-grid.pdf` | Tableau 5 × 4 **avec bordures**, en-têtes accentués (`Référence`, `Désignation`, `Quantité`, `Prix unitaire`) |
| `table-columns.pdf` | Le même tableau, **sans aucune bordure**, colonnes simplement alignées |

#### Comparaison de documents

Tous portent les mêmes phrases, à une seule près : le montant, `1 200` d'un côté
et `1 450` de l'autre. Une comparaison correcte ne doit signaler que cette ligne.

| Fichier | Format |
| --- | --- |
| `compare-a.pdf` / `compare-b.pdf` | PDF, montants différents |
| `compare.docx` | Word (archive ZIP compressée, comme un vrai `.docx`), même contenu que `compare-b.pdf` |
| `compare-a.txt` / `compare-b.txt` | Texte brut UTF-8 |

#### Encodages

Tous contiennent **le même texte** — `Été à Genève : coût 12,50 €.` puis deux
autres lignes — sauf `encoding-latin1.txt`, où le signe € (absent du Latin-1) est
écrit « euros ». Toute conversion réussie doit redonner exactement ce texte.

| Fichier | Encodage | Particularité |
| --- | --- | --- |
| `encoding-utf8.txt` | UTF-8 | Sans BOM, fins de ligne LF |
| `encoding-utf8-bom.txt` | UTF-8 | BOM `EF BB BF` |
| `encoding-utf16le.txt` | UTF-16 LE | BOM `FF FE` |
| `encoding-utf16be.txt` | UTF-16 BE | BOM `FE FF` |
| `encoding-win1252.txt` | Windows-1252 | Contient `0x80` (€), impossible en Latin-1 : c'est ce qui départage les deux |
| `encoding-latin1.txt` | ISO-8859-1 | Aucun octet 0x80–0x9F : indiscernable du Windows-1252, et l'outil le dit |
| `encoding-win1252-crlf.txt` | Windows-1252 | Fins de ligne **CRLF** |
| `encoding-unrepresentable.txt` | UTF-8 | Contient `→`, `中` et un emoji : la conversion vers Windows-1252 doit être **refusée** |

### Fixtures générales (phase 1)

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `sample.txt` | Texte accentué, lignes dupliquées, e-mail, URL, nombres | Compteur de mots, nettoyage, extraction, tri, doublons |
| `sample.json` | JSON imbriqué avec accents et `null` | Formateur/validateur JSON, conversions |
| `sample.csv` | CSV avec en-tête et champ contenant une virgule | Conversions et analyse de données |
| `sample.png` | PNG 32×32 RVB (dégradé) | Conversion, redimensionnement, compression, métadonnées |
| `sample.jpg` | JPEG 8×8 en niveaux de gris | Conversion image, EXIF absent |
| `sample.pdf` | PDF 1.4 valide, 1 page, texte sélectionnable | Fusion, extraction de texte, métadonnées, pagination |
| `corrupted.pdf` | En-tête PDF suivi de données invalides | Vérifier que les erreurs sont gérées proprement |

### Parole : synthèse et transcription (phase 4C)

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `tts-short-fr.txt` | « Bonjour, ceci est un test de FourTout. Le numero est 2026. » | Synthèse française, aller-retour TTS → STT |
| `tts-short-en.txt` | « Hello, this is a FourTout test. The number is 2026. » | Synthèse anglaise, aller-retour TTS → STT |
| `tts-long-fr.txt` | 18 sections, ~4 400 caractères (≈ 4 min d'audio, 36 segments) | Segmentation, progression, navigation pendant un job, **annulation** |
| `pdf-to-audio.pdf` | 3 pages, paragraphes connus, en-tête répété et numéros de page | `PDF vers audio` : lecture correcte **et** nettoyage des ornements |
| `audio-speech-fr.wav` | Parole française produite par la vraie voix Piper | Transcription française, sous-titres |
| `audio-speech-en.wav` | Parole anglaise produite par la vraie voix Piper | Transcription anglaise |

Les deux fichiers `audio-speech-*.wav` sont générés par `pnpm speech:assets` à
partir des textes ci-dessus : ce sont exactement les fichiers que la
transcription doit savoir relire. Le script ne télécharge rien ; il s'arrête
sans erreur si les moteurs de parole ne sont pas encore installés (voir
[docs/MODELS.md](../docs/technical/MODELS.md)).

### Vidéo (phase 5)

Les mires vidéo portent **quatre quadrants de couleurs différentes** et une
barre en mouvement. Ce n'est pas décoratif : une rotation, un miroir ou un
rognage se vérifient d'un coup d'œil (le rouge part en haut à gauche), et le
mouvement donne de la matière réelle à compresser. Aucune police n'est
nécessaire, donc les fixtures sont identiques sur toutes les machines.

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `video-short.mp4` | 640 × 360, 5 s, 25 img/s, quadrants rouge/vert/bleu/jaune, **sans audio** | Rotation, rognage, redimensionnement, découpage, fusion |
| `video-short-2.mp4` | 640 × 360, 4 s, quadrants cyan/magenta/orange/violet, barre verticale | Fusion (mêmes réglages que la précédente → assemblage sans réencodage) |
| `video-with-audio.mp4` | 640 × 360, 5 s, quadrants + **tonalité 440 Hz audible** | Volume, suppression du son, remplacement de bande son, vitesse |
| `video-landscape.mp4` | 1280 × 720 (16:9), 3 s | Redimensionnement, agrandissement refusé, rognage 9:16 |
| `video-portrait.mp4` | 720 × 1280 (9:16), 3 s | Orientation verticale, fusion hétérogène avec `video-short.mp4` |
| `video-large.mp4` | 1280 × 720, 4 s, ~4 Mo à 8 000 kb/s | **Compression** — le seul fichier qui montre un gain réel |
| `video-subtitles.mkv` | `video-with-audio` + piste SubRip `fra` intitulée « Test FourTout » | Extraction des sous-titres existants |
| `video-speech-fr.mp4` | 640 × 360 + **vraie parole française** (voix Piper) | Sous-titres automatiques, transcription vidéo |
| `video-for-gif.mp4` | 240 × 160, 2 s, mire animée | Vidéo vers GIF |
| `sample.srt` | 3 répliques horodatées, avec accents | Incrustation, ajout de piste de sous-titres |
| `sample.vtt` | Les mêmes répliques au format WebVTT | Incrustation depuis un VTT |
| `audio-for-video.wav` | Tonalité 330 Hz de **8 s** (plus longue que les vidéos) | Remplacement de bande son : couper / caler / boucler |

`video-subtitles` est un **MKV** et non un MP4 : écrire une piste de sous-titres
dans un MP4 demande l'encodeur `mov_text`, absent de nombreux builds FFmpeg
(dont celui de Fedora). Le MKV utilise `srt`, présent partout.

`video-speech-fr.mp4` est produit par `pnpm speech:assets` à partir de
`audio-speech-fr.wav` : une fixture nommée « avec parole » en contient donc
réellement, ce qui est la seule façon d'éprouver honnêtement les sous-titres
automatiques.

### Texte, documents, fichiers et archives (phase 6)

Toutes ces fixtures sont **déterministes** : deux générations produisent les
mêmes octets, donc les mêmes empreintes. C'est ce qui permet aux tests de
vérifier un SHA-256 attendu plutôt qu'un « ça a l'air correct ».

#### Texte

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `text-dirty.txt` | Espaces multiples, espaces de bord, lignes vides en série, espace insécable, caractère de largeur nulle, guillemets et tirets typographiques, CRLF mêlé au LF | **Nettoyer un texte** — chaque option a de quoi agir |
| `text-duplicates.txt` | 10 lignes dont 3 doublons, avec variantes de casse et d'espaces | Suppression des doublons, options casse/espaces |
| `text-sort.txt` | Lettres, accents, nombres en début de ligne, ligne vide | Tri A→Z, numérique, longueur |
| `text-a.txt` / `text-b.txt` | Même document à deux versions : une ligne modifiée, une supprimée, une ajoutée | **Comparer deux textes** — les trois cas d'un diff |
| `sample.md` | Titres, listes imbriquées, tableau, citation, bloc de code, lien, accents | Markdown → HTML, aperçu, Markdown → PDF |
| `sample.html` | HTML légitime **plus** un `<script>`, un `<style>`, une `<iframe>` et un lien `javascript:` | Assainissement : rien de tout cela ne doit survivre |
| `line-endings-lf.txt` | 3 lignes en LF | Détection et conversion des fins de ligne |
| `line-endings-crlf.txt` | Les mêmes en CRLF | Conversion CRLF → LF |
| `line-endings-mixed.txt` | LF, CRLF et CR dans le même fichier | Détection d'un fichier mélangé |

#### Documents

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `sample.docx` | Vrai `.docx` : titre 1, titre 2, paragraphe avec gras et italique, liste à puces, tableau 2×2, accents et esperluette échappée. Propriétés : titre « Rapport de test FourTout », auteur « Equipe FourTout » | **Word vers texte / Markdown / HTML** et lecture des propriétés |

#### Archives

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `archive-source/` | `a.txt`, `nested/b.txt`, `unicode-é.txt` | Source à archiver ; l'arborescence relative doit être conservée |
| `sample.zip` | Les trois fichiers ci-dessus, compressés | Extraction ZIP, nom de fichier accentué |
| `sample.tar` | Les mêmes, format TAR | Extraction TAR |
| `sample.tar.gz` | Les mêmes, TAR compressé | Extraction TAR.GZ |
| `evil-zip-slip.zip` | 1 entrée saine + `../../evil.txt` + `/tmp/evil-absolu.txt` | **Sécurité** : les deux entrées piégées doivent être refusées et listées, et rien écrit hors du dossier choisi |

> `evil-zip-slip.zip` est une archive **volontairement piégée**. L'extraire avec
> un autre outil qu'FourTout peut écrire des fichiers hors du dossier de
> destination : c'est précisément ce que cette fixture sert à vérifier.

#### Fichiers et dossiers

| Fichier | Contenu | Utilité |
| --- | --- | --- |
| `duplicate-folder/` | `original.bin`, `copy.bin` et `nested/copy2.bin` identiques (64 Ko) ; `different.bin` et `same-size-different.bin` de **même taille** mais de contenu différent ; `notes.txt` | **Trouver les doublons** : un seul groupe attendu, et la même taille ne suffit pas à faire un doublon |
| `large-split.bin` | 2 500 000 octets reproductibles | **Diviser / réassembler** : 5 morceaux de 500 Ko, empreinte vérifiable |
| `rename-batch/` | `IMG_0001.JPG` à `IMG_0005.JPG` + `Photo de vacances (été) n°6.JPEG` | **Renommage par lot** : numérotation, casse d'extension, nettoyage des accents et des espaces |
| `folder-tree/` | `package.json`, `README.md`, `.hidden-config`, `src/` sur 4 niveaux, `node_modules/`, `.git/` | **Arborescence** et **taille d'un dossier** : profondeur, dossiers ignorés, fichiers cachés |

## À compléter par les prochaines phases

Au fur et à mesure que les outils arrivent :

- archive 7z et archive chiffrée, quand ces formats seront pris en charge ;
- vidéo portant une piste de sous-titres **graphique** (PGS), pour vérifier le
  message qui explique qu'elle n'est pas convertible en texte ;
- variantes corrompues contrôlées pour chaque famille.

Règle : privilégier la **génération** à l'ajout de binaires. Si un fichier doit
être versionné, il doit rester de l'ordre de quelques kilo-octets.
