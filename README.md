# FourTout

Boîte à outils desktop, gratuite et **locale**.

FourTout rassemble dans une seule application les petits outils que l'on va
habituellement chercher sur des sites remplis de publicités ou payants : PDF,
images, audio, vidéo, texte, fichiers, outils développeur, calculateurs,
sécurité.

**Local-first** : lorsqu'une opération peut être faite sur votre machine, vos
fichiers n'en sortent pas. Aucune télémétrie, aucun compte, aucun serveur.

---

## Démarrage rapide

```bash
pnpm install          # dépendances Node
pnpm app:dev          # lance l'application desktop (Tauri + Vite)
```

Pour travailler uniquement sur l'interface, sans compiler la partie native :

```bash
pnpm dev              # http://localhost:1420 dans un navigateur
```

### Prérequis

| Outil | Version testée |
| --- | --- |
| Node.js | 22.x |
| pnpm | 11.x (`corepack enable`) |
| Rust | 1.98 (`rustup`) |

Sur **Fedora**, les bibliothèques système de Tauri v2 :

```bash
sudo dnf install webkit2gtk4.1-devel libsoup3-devel gtk3-devel \
                 librsvg2-devel openssl-devel curl wget file
```

Sur **Windows**, il faut WebView2 (présent depuis Windows 11) et les
Build Tools Visual Studio (C++).

## Commandes

| Commande | Rôle |
| --- | --- |
| `pnpm dev` | Interface seule, dans le navigateur |
| `pnpm app:dev` | Application desktop complète |
| `pnpm build` | Vérification TypeScript + build du frontend |
| `pnpm app:build` | Construit les installeurs (deb, rpm, AppImage, nsis, msi) |
| `pnpm test` | Tests automatisés (Vitest) |
| `pnpm test:watch` | Tests en mode watch |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript sans émission |
| `pnpm test:assets` | Régénère `test-assets/generated/` (fixtures PDF incluses) |
| `pnpm pdfjs:assets` | Recopie les ressources pdf.js dans `public/` |
| `pnpm wordlist` | Régénère le corpus de récupération (`src-tauri/resources/wordlists/`) |
| `pnpm verify` | lint + typecheck + tests + build |

Côté natif : `cd src-tauri && cargo check` puis `cargo test --lib`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — structure du projet et décisions
- [Architecture PDF](docs/PDF.md) — bibliothèques, opérations, limites
- [Architecture média](docs/MEDIA.md) — socle FFmpeg, jobs, temporaires
- [Architecture vidéo](docs/VIDEO.md) — codecs réels, préréglages, sous-titres
- [Récupération de mot de passe PDF](docs/PDF-RECOVERY.md) — moteur natif, corpus, règles
- [Ajouter un outil](docs/ADDING-A-TOOL.md) — la procédure, en trois fichiers
- [test-assets/](test-assets/README.md) — fixtures de développement

## État actuel

**Phase 1** — la fondation : catalogue central de 131 outils, navigation,
recherche en langage courant, favoris, récents, notifications.

**Phase 2** — les outils PDF : seize opérations réellement utilisables,
entièrement locales (fusion, découpage, extraction, suppression,
réorganisation, rotation, images ↔ PDF, filigrane, numérotation, métadonnées,
extraction de texte et d'images, protection et déverrouillage par mot de passe,
compression, et récupération locale d'un mot de passe oublié). Voir
[docs/PDF.md](docs/PDF.md) et [docs/PDF-RECOVERY.md](docs/PDF-RECOVERY.md).

**Phase 3** — les outils **Images** : conversion, compression, redimensionnement,
rognage, rotation, filigrane, métadonnées, palette, favicon, et reconnaissance
de texte (OCR) locale. Voir [docs/IMAGES.md](docs/IMAGES.md).

**Phase 4** — le socle **média** (FFmpeg local, jobs annulables, fichiers
temporaires) et les outils **Audio** : conversion, compression, découpage,
fusion, volume, normalisation, vitesse, suppression des silences,
enregistrement au micro. Puis la **parole locale** : synthèse (Piper),
transcription (whisper.cpp), sous-titres, PDF vers audio. Voir
[docs/MEDIA.md](docs/MEDIA.md), [docs/AUDIO.md](docs/AUDIO.md) et
[docs/MODELS.md](docs/MODELS.md).

**Phase 5** — la suite **Vidéo** complète : conversion, compression,
redimensionnement, découpage, fusion, rognage visuel, rotation et miroir,
vitesse, gestion des pistes audio (suppression, remplacement, ajout, volume),
sous-titres (ajout de piste, incrustation, extraction, génération automatique),
vidéo ↔ GIF, extraction d'image et traitement par lots. Les codecs proposés sont
ceux que le moteur installé sait réellement produire. Voir
[docs/VIDEO.md](docs/VIDEO.md).

Les catégories Texte, Fichiers, Développeur, Calculateurs et Sécurité
comportent encore des outils « bientôt disponible ».
