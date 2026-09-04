# Architecture PDF

## Bibliothèques retenues

| Bibliothèque | Licence | Rôle |
| --- | --- | --- |
| [`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib) 2.9 | MIT | Structure du document : fusion, découpage, pages, rotation, images vers PDF, filigrane, numérotation, métadonnées, **chiffrement et déchiffrement AES-256**. |
| [`pdfjs-dist`](https://github.com/mozilla/pdf.js) 6.3 | Apache-2.0 | Rendu des pages en image, extraction du texte, ouverture des documents protégés. |

**Aucune dépendance native, aucun sidecar, aucun binaire système.** Tout
s'exécute dans la WebView, à l'identique sous Windows et sous Fedora, et le
packaging n'a rien de particulier à embarquer.

### Pourquoi ces deux-là

- **`@cantoo/pdf-lib` plutôt que `pdf-lib`.** L'original n'a plus de publication
  depuis 2022. Le fork Cantoo est activement maintenu, garde la même API, et
  ajoute surtout le chiffrement AES-256 (ISO 32000-2, révision 6) — c'est ce qui
  permet de livrer « Protéger » et « Déverrouiller » sans dépendance externe.
- **`pdf.js` pour le rendu.** pdf-lib ne sait ni dessiner une page ni lire du
  texte. pdf.js le fait, en pur JavaScript, avec le moteur de rendu qui équipe
  Firefox : c'est l'implémentation libre la plus éprouvée.

### Pourquoi pas Ghostscript, qpdf ou Poppler

- **Ghostscript** est sous licence **AGPL** : l'embarquer dans une application
  distribuée obligerait FourTout à passer sous AGPL, ou à acheter une licence
  commerciale. Éliminé pour une raison de licence, pas de technique.
- **qpdf** (Apache-2.0) aurait convenu pour le chiffrement, mais devient inutile
  dès lors que pdf-lib le fait : il aurait fallu détecter le binaire, gérer son
  absence, et l'empaqueter pour Windows et Linux.
- **Poppler** (`pdftoppm`, `pdfimages`) est présent sur la plupart des Linux mais
  jamais sous Windows : la même fonction aurait eu deux comportements.

Ce choix est réévaluable : si une opération future exige réellement un binaire
natif (compression très agressive, OCR), l'ajout se fera derrière une
abstraction dédiée, sans toucher aux seize outils déjà en place.

## Organisation du code

```
src/core/pdf/
├── types.ts             OutputFile, PdfSource, PdfInfo, PdfMetadata, contexte d'opération
├── errors.ts            PdfError + codes stables + traduction des erreurs des bibliothèques
├── document.ts          loadPdf, inspectPdf, savePdf, stripEncryption, validation, progression
├── pageRange.ts         analyse « 1-3, 7, 10-12 » (module pur, fortement testé)
├── filenames.ts         noms de sortie, nettoyage, anti-écrasement (module pur)
├── pdfjs.ts             chargement paresseux de pdf.js + ressources locales
├── imageObjects.ts      inventaire des images embarquées, zlib, prédicteur PNG
├── raster/
│   ├── types.ts         interface RasterBackend (rendu bitmap)
│   └── browser.ts       implémentation canvas de la WebView
└── operations/
    ├── pages.ts         fusion, découpage, extraction, suppression, réorganisation, rotation
    ├── imagesToPdf.ts   images vers PDF
    ├── toImages.ts      PDF vers images, miniatures
    ├── annotate.ts      filigrane, numérotation
    ├── metadata.ts      lecture et écriture des métadonnées
    ├── protect.ts       protection et déverrouillage
    ├── extractText.ts   extraction du texte
    ├── extractImages.ts extraction des images
    └── compress.ts      compression

src/components/pdf/      ossature partagée de l'interface (voir plus bas)
src/tools/impl/pdf/      les seize outils, un fichier chacun
src/core/output/save.ts  enregistrement (dialogue natif Tauri / téléchargement navigateur)
src/core/archive/zip.ts  écriture ZIP minimale, sans dépendance
```

### Règles communes à toutes les opérations

1. **Le fichier source n'est jamais modifié.** Chaque opération renvoie de
   nouveaux `OutputFile` en mémoire ; rien n'est écrit sur le disque tant que
   l'utilisateur n'a pas choisi la destination.
2. **Une seule porte d'entrée.** Aucune opération n'appelle `PDFDocument.load`
   directement : tout passe par `loadPdf`, qui valide le contenu (et pas
   l'extension) et normalise les erreurs.
3. **Des erreurs typées.** `PdfError` porte un code stable (`not-a-pdf`,
   `wrong-password`, `page-out-of-range`…). L'interface affiche le message, les
   tests assertent sur le code.
4. **Progression et annulation.** Chaque opération longue accepte un
   `OperationContext` (`report`, `signal`) branché sur `useJob()`.

### Le backend bitmap

Rendre une page, recompresser une image ou convertir des pixels bruts demande
un canvas. `RasterBackend` abstrait cette capacité :

- l'application installe `browserRasterBackend` (canvas de la WebView) ;
- les tests installent un backend Node adossé à `@napi-rs/canvas`.

C'est ce qui permet de tester **réellement** le rendu des pages et la
compression d'images en intégration continue, au lieu de les simuler.

## Interface

`PdfToolShell` (`src/components/pdf/`) porte tout ce qui est commun :

dépôt des fichiers → ouverture et description des documents (pages, dimensions,
protection) → demande de mot de passe → réglages propres à l'outil → bouton
d'action avec progression et annulation → erreurs → panneau de résultat avec
enregistrement, ZIP, « ouvrir le fichier » et « ouvrir le dossier ».

Un outil ne code donc que ses propres réglages et son appel d'opération. Les
contrôles (`Field`, `OptionGroup`, `Slider`, `PositionPicker`, `PageRangeInput`,
`PageGrid`) sont mutualisés pour que les seize pages se ressemblent.

## Ajouter une opération PDF

1. Écrire la fonction dans `src/core/pdf/operations/`, avec la signature
   `(source, options, context?) => Promise<OutputFile | OutputFile[]>`.
2. La tester dans `operations.test.ts` sur un vrai PDF construit par
   `src/test/pdfFixtures.ts` — pas sur des octets factices.
3. Créer le composant dans `src/tools/impl/pdf/`, en enveloppant les réglages
   dans `PdfToolShell`.
4. L'enregistrer dans `src/tools/implementations.ts` et passer son `status` à
   `"available"` dans `src/core/tools/catalog/pdf.ts`.

Un test vérifie que la liste des outils `available` correspond exactement à la
liste des implémentations : impossible d'annoncer un outil non branché.

## Limites connues

### Compression

Deux leviers réels, et rien de magique :

- **Légère** — réécriture de la structure (flux d'objets). Sans perte, gain
  généralement faible.
- **Équilibrée / Forte** — les images embarquées sont décodées, réduites et
  réencodées en JPEG. C'est ce qui fait maigrir un document scanné ou illustré.
  Le texte reste vectoriel, donc net et sélectionnable.

Sont laissées telles quelles : les images à transparence (un masque ne survit
pas au JPEG), les encodages JPEG 2000, CCITT et JBIG2, et les espaces
colorimétriques indexés ou ICC. Sur un document uniquement textuel, le gain est
proche de zéro — l'interface le dit, et prévient si le fichier a grossi.

### Protection par mot de passe

Le chiffrement est réel et interopérable : un test vérifie qu'un fichier
protégé par FourTout s'ouvre bien avec pdf.js, implémentation totalement
indépendante.

**Limite** : lors de l'écriture chiffrée, `@cantoo/pdf-lib` ne conserve pas le
titre, l'auteur, le sujet ni les mots-clés du document. L'interface en avertit
sur la page de l'outil. Le contenu des pages, lui, est intact.

FourTout **ne casse aucune protection** : le déverrouillage exige le mot de
passe. Un mot de passe erroné produit un message clair, jamais une tentative
répétée.

### Extraction d'images

Les images JPEG sont recopiées octet pour octet, sans réencodage. Les images
stockées en pixels bruts (zlib, RVB ou niveaux de gris sur 8 bits, prédicteur
PNG géré) sont converties en PNG. Les autres encodages sont **signalés et
ignorés** plutôt que produits corrompus.

### Traitement en mémoire

pdf-lib charge le document entier en mémoire, et une opération en manipule
plusieurs copies. En pratique, un PDF de quelques dizaines de mégaoctets passe
sans difficulté ; au-delà de quelques centaines, la consommation devient
notable. Le rendu des pages est en revanche traité page par page, sans tout
garder en mémoire.

Pour la réorganisation, les miniatures s'arrêtent à 60 pages : au-delà, les
cartes restent numérotées et l'opération fonctionne normalement.

### Complétés en Phase 3B

Grâce à l'infrastructure existante (rendu de pages, moteur OCR de la phase 3,
backend bitmap), six outils sont passés `available` :

| Outil | Cœur | Réutilise |
| --- | --- | --- |
| `document-to-pdf` — TXT / Markdown / HTML → PDF | `operations/documentToPdf.ts` | pdf-lib, mise en page maison (titres, listes, gras/italique, pagination, WinAnsi) |
| `pdf-add-text` — zones de texte placées visuellement | `operations/addContent.ts` | pdf-lib `drawText`, `usePdfPage` |
| `pdf-add-image` — image / signature (PNG transparent) | `operations/addContent.ts` | pdf-lib `embedPng/embedJpg`, transcodage WebP→PNG |
| `ocr-document` — OCR d'un PDF scanné, page par page | `core/ocr/pdf.ts` | `pdfToImages` + moteur OCR tesseract.js (aucune duplication) |
| `pdf-compare` — comparaison visuelle | `operations/compare.ts` | rendu des pages + diff pixel + carte de chaleur |
| `pdf-redact` — caviardage **réel** | `operations/redact.ts` | rendu + rastérisation des pages masquées |

**Caviardage — garantie de sécurité.** Le piège classique (rectangle noir
par-dessus un texte resté extractible) est évité par construction : une page
contenant une zone à masquer est **rendue en image**, les rectangles sont peints
sur ces pixels, et la page est reconstruite depuis cette image — elle n'a donc
plus **aucune couche de texte**. Un test de sécurité vérifie qu'après caviardage
le secret n'est plus extractible **ni** présent dans les octets bruts du fichier.
Les pages sans zone masquée restent vectorielles (texte conservé). L'opération
est irréversible sur le fichier produit.

### Ce qui reste `planned`

`pdf-to-audio` uniquement : il dépend du moteur de synthèse vocale local, qui
sera introduit avec le bloc Audio/TTS.

## Modifier le texte d'un PDF (`pdf-edit-text`)

Outil d'**édition visuelle** : on affiche la page réelle, on double-clique un
texte, on le remplace, et l'export produit une copie qui montre le changement
dans n'importe quel lecteur.

### Affichage (couche de texte interactive)

`renderPageForEditor` (`operations/toImages.ts`) rend la page **une fois** dans
un canvas temporaire, l'encode en PNG puis **libère le canvas** : la page est
ensuite affichée par un simple `<img>`, jamais par une surface canvas
persistante — c'est la règle qui préserve le correctif anti-artefacts
WebKitGTK. Par-dessus, une couche HTML de zones cliquables est construite à
partir de `getTextContent()` : les `transform` de pdf.js sont exprimés en points
utilisateur PDF (origine en bas à gauche), donc directement réutilisables par
pdf-lib au dessin, sans conversion d'axe. Seule la page courante est rendue
(navigation, zoom) ; le rendu précédent et son URL d'objet sont libérés.

### Nature réelle de l'édition — remplacement visuel, assumé

On ne réécrit **pas** les flux de contenu ni les polices *subset* du document :
c'est irréalisable de façon fiable sur des PDF quelconques (encodages de
glyphes, `Tj`/`TJ`, matrices, sous-ensembles). L'édition est un **remplacement
visuel** (`operations/editText.ts`) : recouvrir l'ancien texte par un aplat de
la **couleur de fond échantillonnée** sous la zone, puis redessiner le nouveau
texte (taille, graisse, couleur approchées, police standard proche).

Pour ne pas détruire un fond coloré, une photo ou un graphique, on **détecte
l'uniformité** du fond autour de la zone (`sampleTextStyle` : médiane et
dispersion d'un anneau autour du texte). Si le fond n'est pas uniforme,
l'édition est **refusée** et signalée (« Cette zone ne peut pas être modifiée
proprement ») plutôt que d'abîmer la page. Le texte pivoté ou vertical est
également refusé (v1). Un texte de remplacement trop long est réduit pour tenir,
sans descendre sous 60 % du corps ; au-delà, il est laissé tel quel et le
débordement est signalé.

**Limite honnête** : le texte d'origine reste présent dans le flux de contenu
(recouvert, donc invisible et non imprimé, mais encore *extractible* par un
copier-coller). Le remplacement vise le rendu visuel — impression, partage du
PDF — pas l'effacement du calque texte sous-jacent. Une vraie réécriture du
contenu (ou un caviardage) relève d'outils distincts (`pdf-redact`, à venir).

### Ce qui est bien pris en charge / limité

Bien : texte horizontal, polices standard, petits changements, documents
administratifs, factures simples, rapports, fonds unis (y compris colorés).
Limité (signalé) : texte vectorisé, scans (aucun texte éditable → message
dédié), fonds non uniformes, glyphes exotiques, texte vertical ou pivoté. Pas
d'OCR à ce stade.

## PDF vers audio (`pdf-to-audio`)

L'outil ne réimplémente **rien** : il réutilise `extractText` (pdf.js) et, pour
un document scanné, `recognizePdf` (tesseract.js). Il n'ajoute qu'une étape de
préparation, `core/speech/pdfText.ts`, avant la synthèse vocale.

Ce nettoyage est délibérément **prudent** : lire un numéro de page à voix haute
est agaçant, mais supprimer une phrase est bien pire. Une ligne n'est écartée
que si elle réunit trois conditions :

1. elle fait 80 caractères ou moins ;
2. elle est la **première ou la dernière** ligne de sa page ;
3. elle est soit un numéro de page isolé (`12`, `- 12 -`, `3 / 40`), soit une
   ligne répétée en bordure sur au moins 60 % des pages (minimum trois pages).

Un « 2026 » au milieu d'un paragraphe est donc lu ; une phrase longue répétée
l'est aussi. Le nombre de lignes écartées est affiché sous le texte.

Sans couche texte, l'outil dit « Aucun texte extractible détecté dans ce PDF. »
et propose **OCR puis générer l'audio**, qui passe par le moteur OCR existant.
Le texte reste modifiable avant la lecture, quelle que soit sa provenance.

Pipeline complet et fixture (`pdf-to-audio.pdf`) : voir [AUDIO.md](AUDIO.md).

## Ressources pdf.js

pdf.js a besoin des polices standard (documents qui ne les embarquent pas, cas
très courant) et des tables CJK. `scripts/sync-pdfjs-assets.mjs` les copie de
`node_modules` vers `public/pdfjs/` avant `dev`, `build` et `test`. Ces fichiers
sont servis par l'application : **aucun appel à un CDN**, l'outil fonctionne
hors ligne. Le dossier `public/pdfjs/` est régénérable et ignoré par Git.

## Comportement Windows / Fedora

Le traitement PDF est strictement identique : même JavaScript, mêmes
bibliothèques, aucun binaire système. Seuls diffèrent :

- **l'enregistrement** — boîte de dialogue native, via les greffons Tauri
  `dialog` et `fs` ; le séparateur de chemin est déduit du dossier choisi ;
- **« ouvrir le dossier »** — `revealItemInDir` du greffon `opener`, qui utilise
  l'explorateur du système ;
- **le moteur de rendu** — WebKitGTK sous Linux, WebView2 sous Windows. Les deux
  gèrent le canvas 2D, `createImageBitmap` et `DecompressionStream` utilisés ici.

En développement dans un navigateur (`pnpm dev`), l'enregistrement retombe sur
un téléchargement classique et les boutons « ouvrir » sont masqués.
