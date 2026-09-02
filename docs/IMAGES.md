# Architecture Image & OCR

## Vue d'ensemble

Le bloc Image de FourTout couvre la conversion, la compression, le
redimensionnement, le recadrage, la rotation/miroir, le noir et blanc, les
ajustements (luminosité/contraste/saturation/gamma), le flou/pixellisation, la
transparence (ajout et suppression), le texte sur image, la lecture et la
suppression des métadonnées, et la **reconnaissance de texte (OCR)**.

Comme le bloc PDF, **tout s'exécute localement** : aucune image, aucun texte
reconnu ne quitte la machine. Aucun service réseau, aucun binaire système requis
(en particulier **pas de dépendance à un Tesseract installé par l'utilisateur**).

## Bibliothèques

| Bibliothèque | Licence | Rôle |
| --- | --- | --- |
| Canvas de la WebView (`RasterBackend`) | — | Décodage, encodage PNG/JPEG et tous les traitements bitmap, via le backend bitmap partagé (déjà utilisé par le bloc PDF). |
| Crate Rust [`image`](https://crates.io/crates/image) 0.25 (pur Rust) | MIT | Encodage **WebP** natif (voir « Encodage WebP » ci-dessous). |
| [`tesseract.js`](https://github.com/naptha/tesseract.js) 6 + `tesseract.js-core` | Apache-2.0 | Moteur OCR WebAssembly, exécuté dans un worker, 100 % hors ligne. |
| `@napi-rs/canvas` (dev) | MIT | Backend bitmap **des tests** (Node) et génération des fixtures images. |

Aucune nouvelle dépendance Rust : le traitement d'image réutilise le
`RasterBackend` de la phase PDF (canvas du navigateur en production, canvas natif
`@napi-rs/canvas` en test).

## Traitement d'image

Le cœur est dans `src/core/image/` :

- **`codec.ts`** — décodage/encodage au-dessus du `RasterBackend`, détection du
  format par signature, garde-fou mémoire (`MAX_DECODE_PIXELS = 100 Mpx`),
  application de l'**orientation EXIF**, aplatissement sur fond pour le JPEG.
- **`operations.ts`** — transformations pures (redimensionnement, recadrage,
  rotation par quart de tour, miroir, niveaux de gris/seuil, ajustements, flou
  boîte et pixellisation avec zone optionnelle, suppression de transparence,
  couleur vers transparence, texte). Chaque fonction renvoie un **nouveau**
  canvas : la source n'est jamais modifiée.
- **`exif.ts`** — lecteur EXIF autonome (JPEG APP1, PNG `eXIf`, WebP `EXIF`) :
  orientation, appareil, date, réglages, GPS.
- **`svg.ts`** — sanitisation SVG (voir Sécurité SVG) et taille intrinsèque.
- **`pipeline.ts`** — chaînage lecture → décodage redressé → transformation →
  encodage → nommage, en unité **et par lot** (progression + annulation).

### Formats réellement supportés

| Format | Lecture | Écriture |
| --- | --- | --- |
| PNG | ✅ | ✅ |
| JPEG | ✅ | ✅ |
| WebP | ✅ | ✅ |
| GIF | ✅ (première frame) | ❌ |
| BMP | ✅ | ❌ |
| TIFF | ✅ | ❌ |
| SVG | ✅ (rastérisé, sécurisé) | ❌ |
| AVIF / HEIC | selon la WebView | ❌ |

### Encodage WebP (correctif Phase 3B)

La WebView WebKitGTK (Fedora) **n'encode pas** le WebP : `canvas.toBlob(…,
"image/webp")` y renvoie silencieusement du **PNG**. Les fichiers `.webp`
produits par le frontend étaient donc des PNG mal étiquetés — les visionneuses
GNOME (glycin/Loupe), qui choisissent le décodeur d'après l'extension, les
rejetaient (« Loader process exited early »), alors que Nautilus (gdk-pixbuf,
qui reconnaît le contenu) affichait quand même une miniature.

Correctif : dans l'application, le WebP est encodé **nativement en Rust**
(commande `encode_webp`, crate `image`, WebAssembly non impliqué) à partir du
PNG — valide — produit par le canvas. L'encodage est **sans perte** (mode fourni
par `image`) : le fichier est un vrai WebP RIFF/VP8L, vérifié par `identify` et
par GdkPixbuf, transparence conservée. Hors application (navigateur, tests
Node), `canvas.encode("webp")` reste utilisé (Chromium et `@napi-rs/canvas`
encodent correctement). PNG et JPEG, eux, étaient déjà valides côté WebKitGTK.

L'écriture se limite à PNG, JPEG et WebP — les trois formats réellement utiles
et universellement lisibles. Une conversion qui ne conserve pas l'animation (GIF)
l'annonce clairement.

### Orientation EXIF

Le décodage force `imageOrientation: "none"` (le navigateur n'applique donc pas
l'orientation), puis FourTout applique lui-même la matrice EXIF. C'est
déterministe et identique quelle que soit la WebView : une photo de smartphone
n'apparaît jamais tournée après conversion. Un test verrouille ce comportement.

### Nommage des sorties

Le fichier source n'est jamais écrasé. Convention (via `imageOutputName`) :

- changement de format : `photo.jpg` → `photo.webp` ;
- traitement conservant le format : `photo.png` → `photo-compressee.png` ;
- variante paramétrée : `photo.jpg` → `photo-50pct.jpg`.

Dans un lot, les homonymes sont suffixés `(2)`, `(3)`… jamais écrasés.

### Performance et mémoire

Une image démesurée est refusée au décodage au-delà de 100 Mpx (≈ 400 Mo en
RVBA), avec un message clair, plutôt que de figer l'application. Les aperçus en
temps réel travaillent sur une réduction (~1200 px) tandis que l'export garde la
pleine résolution. Les traitements par lot passent par le Job Manager
(progression, annulation).

## OCR

### Moteur retenu : tesseract.js (WebAssembly)

tesseract.js exécute Tesseract 5 compilé en WebAssembly dans un **worker**, à
l'intérieur de la WebView. Ce choix plutôt qu'un binaire Tesseract natif :

- **un seul artefact** pour Fedora et Windows (pas de binaire par plateforme à
  signer/empaqueter) ;
- **aucune dépendance système** : ne suppose pas Tesseract installé ;
- **hors ligne** : worker, cœur WebAssembly et modèles sont servis par
  l'application elle-même, jamais par un CDN.

Le cœur métier ne connaît qu'une interface `OcrEngine` (`src/core/ocr/`) : les
tests peuvent injecter un moteur réel (Node) ou simulé, ce qui permet de tester
la reconnaissance **et** l'orchestration multi-image indépendamment de la WebView.

### Langues et poids

Modèles embarqués (`tessdata_fast`, servis depuis `public/tessdata/`) :

| Langue | Fichier | Poids |
| --- | --- | --- |
| Anglais | `eng.traineddata` | ~4,0 Mo |
| Français | `fra.traineddata` | ~1,1 Mo |

Interface : **Français**, **Anglais**, **Français + Anglais** (reconnaissance
simultanée). L'architecture est extensible (allemand, espagnol, italien,
portugais) : il suffit d'ajouter le code langue dans
`scripts/sync-tesseract-assets.mjs` et dans `BUNDLED_LANGUAGES`. Chaque langue
supplémentaire ajoute ~1 à 4 Mo.

Cœur WebAssembly (`public/tesseract/`, variantes LSTM SIMD + repli) : ~7,7 Mo.
**Empreinte OCR totale : ~13 Mo** (cœur + français + anglais).

### Packaging (Fedora / Windows)

Les ressources OCR vivent dans `public/` (comme pdf.js) et sont donc incluses
dans `dist/` par Vite, puis distribuées avec le frontend Tauri — rien à ajouter
côté `resources` Rust. `scripts/sync-tesseract-assets.mjs` copie le worker et le
cœur depuis `node_modules` et télécharge les modèles une seule fois s'ils sont
absents (connexion requise **uniquement à la préparation**, pas à l'exécution).
Il est lancé automatiquement avant `dev`, `build` et `test`.

La **CSP** de `tauri.conf.json` autorise le WebAssembly et les workers :
`script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:`.

### OCR et PDF (à venir)

L'architecture est prête pour un OCR de PDF scanné sans duplication : le rendu
des pages existe déjà (`pdfToImages` / `renderPageForEditor`) et alimenterait le
même `OcrEngine`. Ce chaînage n'est pas encore exposé comme outil.

## Batch

Conversion, compression, redimensionnement, rotation/miroir, noir et blanc,
suppression de métadonnées et OCR acceptent plusieurs images. Le traitement est
en série, avec progression et annulation via le Job Manager, et enregistrement
groupé (dossier ou ZIP) via le panneau de résultat partagé.

## Sécurité SVG

Un SVG importé est **sanitisé** avant tout rendu (`sanitizeSvg`) : suppression
des `<script>`, `<foreignObject>`, gestionnaires `on…`, déclarations `DOCTYPE`/
`ENTITY` (anti-XXE) et références externes (`href`/`url()` réseau ou fichier). Le
rendu passe ensuite par un élément `<img>`, qui n'exécute jamais de script et ne
charge pas de sous-ressource. Défense en profondeur : les deux niveaux se
cumulent.

## Composants d'interface réutilisables

- **`ImageToolShell`** — ossature des outils par lot (dépôt, réglages, exécution,
  résultat), pendant de `PdfToolShell`.
- **`ImagePreview` / `PreviewFrame`** — aperçu à fond en damier (transparence),
  dimensions, poids.
- **`useImagePreview`** — URL objet + dimensions naturelles, nettoyage
  automatique.
- **`useSourceCanvas` / `useProcessedPreview`** — aperçu en temps réel d'un
  traitement : la transformation est appliquée hors écran puis affichée en PNG
  dans un `<img>` (approche anti-artefacts WebKitGTK — aucune surface canvas
  visible persistante).
- **`ColorField`** — nuancier + hexadécimal + pipette.

## Limitations réelles

- Écriture limitée à PNG/JPEG/WebP ; pas d'export GIF/AVIF/TIFF.
- GIF : seule la première frame est extraite (la vraie conversion GIF ↔ vidéo
  relèvera du bloc Vidéo).
- OCR : deux langues embarquées (fr, en) ; pas de détection automatique de
  langue ; qualité dépendante de la netteté de l'image.
- Le décodage AVIF/HEIC dépend de la WebView (WebKitGTK/WebView2).
- Recadrage : la sélection exportée correspond exactement à la zone affichée ;
  les ratios prédéfinis sont ajustés dans l'espace d'affichage.

## Tests

- `src/core/image/image.test.ts` — décodage/formats, géométrie, traitements par
  pixel, EXIF/orientation, SVG, chaîne et nommage, annulation (backend Node).
- `src/core/ocr/ocr.test.ts` — mise en forme, orchestration multi-image (moteur
  simulé) et **reconnaissance réelle** français/anglais/lot via tesseract.js
  hors ligne.
- `src/test/imageAssets.test.ts` — présence et validité des fixtures.
- `scripts/generate-image-assets.mjs` — fixtures images (dont textes OCR
  vérifiables, JPEG avec EXIF, SVG, GIF animé).
