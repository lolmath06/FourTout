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

## À compléter par les prochaines phases

Au fur et à mesure que les outils arrivent :

- GIF animé, image avec EXIF/GPS, image très grande ;
- PDF scanné (image de texte, sans texte sélectionnable) pour l'OCR ;
- audio court (MP3, WAV) et audio avec silences ;
- vidéo courte (MP4, MKV) avec et sans piste audio ;
- archives ZIP/7z, dont une archive chiffrée ;
- variantes corrompues contrôlées pour chaque famille.

Règle : privilégier la **génération** à l'ajout de binaires. Si un fichier doit
être versionné, il doit rester de l'ordre de quelques kilo-octets.
