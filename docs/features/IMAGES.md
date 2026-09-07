# Architecture Image & OCR

[← Documentation](../README.md)

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Bibliothèques](#bibliothèques)
- [Traitement d'image](#traitement-dimage)
- [OCR](#ocr)
- [Batch](#batch)
- [Sécurité SVG](#sécurité-svg)
- [Composants d'interface réutilisables](#composants-dinterface-réutilisables)
- [Outils de finition (Phase 4)](#outils-de-finition-phase-4)
- [Limitations réelles](#limitations-réelles)
- [Tests](#tests)
- [Retirer l'arrière-plan (`image-remove-background`)](#retirer-larrière-plan-image-remove-background)

---

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

## Outils de finition (Phase 4)

Ajoutés en fin de bloc Images, qui complètent la catégorie :

- **Conversion par lot** — UX explicitement batch (résumé réussites/échecs).
- **Filigrane** — texte et/ou logo PNG transparent, position, opacité, rotation ; à l'unité ou par lot.
- **Générer un favicon** — vrai `favicon.ico` multi-résolutions (16/32/48) + PNG utiles (`core/image/favicon.ts`, `buildIco`).
- **Générer plusieurs tailles** — export multi-tailles (carré recadré ou proportionnel).
- **Palette de couleurs** — couleurs dominantes par découpage médian (`core/image/palette.ts`).
- **QR code** — génération (PNG/SVG) et lecture (`core/image/qr.ts`, via `qrcode` + `jsQR`) ; un QR lu n'est jamais ouvert automatiquement.

Les ponts **Vidéo → GIF**, **GIF → vidéo** et **Extraire une image d'une vidéo**
relèvent du socle média (voir [MEDIA.md](MEDIA.md)).

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

---

## Retirer l'arrière-plan (`image-remove-background`)

Le seul outil Image qui s'appuie sur un modèle appris. Il ne faut pas le
confondre avec `image-color-transparent`, qui efface une couleur qu'on lui
désigne et ne sait rien du contenu de l'image.

### Le modèle

**U²-Net**, exécuté par ONNX Runtime Web (WebAssembly) dans la WebView, avec un
seul fil : le multi-fil exige `SharedArrayBuffer`, donc des en-têtes
d'isolation d'origine que FourTout ne sert pas. Le runtime est servi depuis
`public/ort/`, copié depuis node_modules par `scripts/sync-onnx-assets.mjs` —
jamais depuis un CDN, que la politique de sécurité de contenu interdirait de
toute façon.

#### Deux fichiers, et le point d'entrée qui va avec

Le runtime tient en **deux** fichiers, pas un. ONNX Runtime importe d'abord une
glu JavaScript, `ort-wasm-simd-threaded.mjs`, qui instancie ensuite le
`.wasm`. Cet import est marqué `@vite-ignore` dans la bibliothèque : Vite ne le
suit donc pas, et le fichier **doit** être servi à l'exécution. S'il manque, la
requête tombe sur le repli SPA, qui répond `index.html` en `text/html` ; ONNX
affiche alors « 'text/html' is not a valid JavaScript MIME type » puis « no
available backend found », sans jamais nommer le fichier absent.

L'import passe par le sous-chemin **`onnxruntime-web/wasm`**, et non par le
paquet. Le point d'entrée par défaut vise la variante *JSEP* du runtime —
27,8 Mo de WebAssembly destinés à WebGPU et WebNN, que FourTout n'utilise pas,
et dont le nom de fichier diffère de celui qui est copié. Le sous-chemin vise
le runtime simple : 13,9 Mo, et les noms attendus.

Les deux chemins sont donnés explicitement à `env.wasm.wasmPaths`, en URL
absolues construites depuis `window.location` — l'origine change selon le
contexte (`localhost:1420` en développement, `tauri://localhost` dans
l'application). Un simple préfixe fonctionnerait, mais laisserait le moteur
deviner les noms ; les nommer rend la panne lisible.

Trois garde-fous protègent cette mécanique :

- `assertRuntimeServed` teste le type de contenu des deux fichiers avant de
  démarrer le moteur, et transforme le message énigmatique en phrase utile. Il
  n'échoue que sur ce cas précis : toute autre difficulté laisse ONNX tenter sa
  chance, un diagnostic ne devant pas bloquer un outil qui aurait marché ;
- `onnxAssets.test.ts` vérifie que les fichiers sont copiés dans `public/` et
  dans `dist/`, à l'identique, et qu'ils sont bien un module JavaScript et un
  binaire WebAssembly ;
- `onnxServing.test.ts` monte un serveur sur le build de production **avec le
  même repli SPA** que l'application, et vérifie les types de contenu reçus.
  Un test qui lirait le disque ne verrait pas ce repli, et laisserait passer
  exactement le défaut qu'il doit attraper.

Le choix d'U²-Net tient d'abord à sa **licence** : code et poids sous Apache
2.0. RMBG (BRIA) et MODNet sont souvent meilleurs, mais réservent leurs poids à
un usage non commercial — incompatible avec la distribution de FourTout.

### Le traitement

`src/core/image/background.ts` ne connaît rien d'ONNX : il reçoit une session
et une fabrique de tenseurs. C'est ce qui permet de l'éprouver en Node avec le
vrai modèle, sans embarquer la mécanique Tauri dans les tests.

1. **Entrée** — l'image est réduite à 320×320 (taille imposée par le réseau),
   normalisée avec les statistiques ImageNet, et réorganisée en trois plans
   R, V, B séparés.
2. **Inférence** — le réseau rend sept cartes de saillance ; seule la première
   est utilisée, les six autres servent à l'entraînement.
3. **Masque** — les scores n'ont pas d'échelle garantie : ils sont ramenés sur
   [0, 1] par min-max **avant** toute décision, sans quoi un seuil ne voudrait
   rien dire d'une image à l'autre. Une carte uniforme — le réseau n'a rien
   distingué — donne un masque entièrement opaque : effacer l'image entière
   serait le pire des comportements.
4. **Adoucissement** *(optionnel)* — moyenne glissante séparable, à la
   résolution du masque : `2n` au lieu de `n²`, et un rendu identique quelle que
   soit la taille de l'image.
5. **Rééchantillonnage** — bilinéaire vers la taille d'origine. **La résolution
   de l'image n'est jamais réduite** : seule l'analyse travaille en 320×320.
6. **Application** — le masque devient l'alpha, combiné à l'alpha existant. Les
   couleurs ne sont jamais touchées.

### Ce que les tests garantissent

`src/core/image/background.test.ts` exécute le **vrai modèle** sur trois
fixtures (silhouette, objet en JPEG, bords durs avec un trou) et regarde les
pixels : résolution conservée, alpha réellement présent, sujet opaque au
centre, coins transparents, PNG relu depuis ses octets qui porte encore sa
transparence, seuil sévère qui garde moins que le seuil permissif,
adoucissement qui crée de vrais pixels intermédiaires, annulation qui ne rend
rien, et sortie de taille inattendue refusée plutôt que transformée en masque
inventé.

Les tests d'inférence s'ignorent proprement quand le modèle n'est pas installé,
en disant comment l'obtenir.

### Limites, dites dans l'interface

Le modèle cherche un **sujet principal**. Il se trompe sur les scènes sans
sujet évident, les fonds de la couleur du sujet, et les détails très fins. La
note du catalogue et un encart sur la page le disent, plutôt que de laisser
l'utilisateur le découvrir.
