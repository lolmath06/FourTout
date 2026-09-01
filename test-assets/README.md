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

- PDF multipages, PDF protégé par mot de passe, PDF scanné (pour l'OCR) ;
- GIF animé, image avec EXIF/GPS, image très grande ;
- audio court (MP3, WAV) et audio avec silences ;
- vidéo courte (MP4, MKV) avec et sans piste audio ;
- archives ZIP/7z, dont une archive chiffrée ;
- variantes corrompues contrôlées pour chaque famille.

Règle : privilégier la **génération** à l'ajout de binaires. Si un fichier doit
être versionné, il doit rester de l'ordre de quelques kilo-octets.
