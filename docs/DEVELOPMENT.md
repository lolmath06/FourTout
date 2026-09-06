# Développement

## Prérequis

| Outil | Version testée | Installation |
| --- | --- | --- |
| **Node.js** | 22.22 | [nodejs.org](https://nodejs.org) ou `nvm install 22` |
| **pnpm** | 11.22 | `corepack enable` |
| **Rust** | 1.98 (minimum 1.77.2) | [rustup.rs](https://rustup.rs) |

### Bibliothèques système (Linux)

Tauri 2 s'appuie sur WebKitGTK.

```bash
# Fedora
sudo dnf install webkit2gtk4.1-devel libsoup3-devel gtk3-devel \
                 librsvg2-devel openssl-devel curl wget file

# Debian, Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libgtk-3-dev \
                 librsvg2-dev libssl-dev curl wget file build-essential
```

### Windows

- **Build Tools Visual Studio** avec la charge de travail « Développement
  desktop en C++ ».
- **WebView2**, présent d'origine sur Windows 11 et sur Windows 10 à jour.

### Facultatif mais recommandé

**FFmpeg** dans le `PATH`. Sans lui, les 34 outils audio et vidéo sont
inutilisables et une partie de la suite de tests média se met en pause plutôt
que d'échouer.

```bash
sudo dnf install ffmpeg-free    # Fedora
sudo apt install ffmpeg         # Debian, Ubuntu
```

---

## Démarrer

```bash
git clone <url-du-dépôt> FourTout
cd FourTout
pnpm install
pnpm app:dev
```

`pnpm install` déclenche `predev`/`prebuild`/`pretest`, qui recopient dans
`public/` les ressources de pdf.js et de Tesseract depuis `node_modules`. Ces
dossiers ne sont pas versionnés : ils sont reconstruits à la demande.

Pour travailler sur l'interface seule, sans compiler la partie native :

```bash
pnpm dev     # http://localhost:1420
```

Les outils qui appellent la couche native affichent alors « Application
installée requise » — c'est le comportement attendu dans un navigateur.

---

## Commandes

### Vérification

```bash
pnpm verify        # lint + typecheck + test + build — à lancer avant de committer
```

| Commande | Rôle |
| --- | --- |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript sans émission |
| `pnpm test` | Suite Vitest |
| `pnpm test:watch` | Vitest en mode watch |
| `pnpm build` | Vérification TypeScript puis build Vite |

### Côté natif

```bash
cd src-tauri
cargo check --all-targets
cargo test
cargo clippy --all-targets
```

### Application

| Commande | Rôle |
| --- | --- |
| `pnpm dev` | Interface seule, dans un navigateur |
| `pnpm app:dev` | Application desktop complète, avec rechargement à chaud |
| `pnpm app:build` | Construit les installeurs — voir [BUILD.md](BUILD.md) |

### Ressources

| Commande | Rôle |
| --- | --- |
| `pnpm test:assets` | Régénère `test-assets/generated/` (PDF, images, média, archives, DOCX, parole) |
| `pnpm pdfjs:assets` | Recopie les ressources pdf.js dans `public/` |
| `pnpm ocr:assets` | Recopie le worker et les données Tesseract dans `public/` |
| `pnpm wordlist` | Régénère le corpus de récupération de mot de passe PDF |
| `pnpm speech:assets` | Régénère les fixtures de parole |

Les fixtures ne sont pas versionnées : elles sont **reproductibles**. Lancez
`pnpm test:assets` après un clone si vous voulez exécuter les tests
d'intégration natifs, qui se mettent sinon en pause proprement.

---

## Organisation du dépôt

```
src/
  app/          Routes, tests de bout en bout de l'application
  components/   Composants réutilisables (ui/, tools/, pdf/, media/, files/, calc/…)
  core/         Logique métier, sans React
    tools/      Registre des outils : catalogue, catégories, recherche
    pdf/ media/ files/ text/ code/ calc/ units/ security/ currency/ convert/
    jobs/       Travaux longs, progression, annulation
  features/     État applicatif (favoris, récents, paramètres, jobs, notifications)
  pages/        Pages de navigation
  tools/impl/   Une implémentation par outil du catalogue
  test/         Utilitaires de test (rendu Node, sondes FFmpeg, fixtures)

src-tauri/
  src/
    files/      Archives, empreintes, découpage, chiffrement, effacement, organisation
    media/      Pilotage de FFmpeg, détection réelle des codecs
    models/     Gestionnaire de modèles de parole
    recovery/   Récupération de mot de passe PDF
    rates.rs    Taux BCE — la seule sortie réseau de l'application
  tests/        Tests d'intégration natifs

docs/           Cette documentation
scripts/        Générateurs de fixtures et synchronisation des ressources
```

---

## Le registre : la seule source de vérité

Un outil est décrit **une fois**, dans `src/core/tools/catalog/`. De cette
déclaration dérivent la navigation, les compteurs de catégorie, la recherche,
le convertisseur universel et le routage par glisser-déposer.

**Règle du produit : figurer au catalogue, c'est fonctionner.** Il n'existe
pas d'état « bientôt disponible ». Un outil incomplet n'est simplement pas
enregistré, et un test garde le catalogue et la table des implémentations
exactement alignés.

Un outil futur vit dans [ROADMAP.md](../ROADMAP.md) ou dans un ticket, pas
dans l'interface.

Ajouter un outil : [ADDING-A-TOOL.md](ADDING-A-TOOL.md).

---

## Écrire des tests

La suite compte plus de mille tests, et elle est verte. Quelques principes
qu'elle applique :

**Éprouver le comportement réel, pas la construction des arguments.** Les
tests média exécutent le vrai FFmpeg et relisent le résultat avec `ffprobe`.
Les tests PDF relisent le PDF produit avec pdf.js. Un fichier qui s'écrit
n'est pas un fichier qui se lit.

**Vérifier une promesse là où elle peut mentir.** L'archive AES est relue par
`7z`, pas par le code qui l'a écrite. Le flux BCE est interrogé pour de vrai.

**Se mettre en pause plutôt que d'échouer** quand l'environnement manque : les
tests qui ont besoin de FFmpeg, de `7z` ou des fixtures générées s'ignorent
proprement en expliquant pourquoi.

**Ne jamais ajuster une assertion pour faire vert.** Si un test échoue, c'est
soit le code qui a tort, soit l'assertion qui était imprécise — et dans le
second cas, la corriger doit rendre le test *plus* strict, pas moins.

---

## Conventions

- **Commentaires en français**, comme le reste du produit. Ils expliquent
  *pourquoi*, jamais *quoi*.
- **Pas de `any`** pour faire taire le compilateur.
- **Pas de couleur en dur** : les composants utilisent les jetons CSS
  (`--ft-*`). Une nouvelle couleur se déclare dans `src/styles/app.css`.
- **Pas de `transform: scale()`** pour dimensionner l'interface : cela floute
  le texte et décale les coordonnées de pointeur. Voir `src/core/ui/zoom.ts`.
- **Aucune promesse invérifiable dans l'interface.** Si un outil a une limite,
  elle s'écrit dans sa `note` de catalogue et s'affiche sur sa page.

---

## Pièges connus de l'environnement

Ils sont documentés pour éviter de les redécouvrir.

| Piège | Détail |
| --- | --- |
| **WebKitGTK et `toBlob` en WebP** | La WebView de Linux ne sait pas encoder en WebP côté canvas. L'export passe par le moteur natif. Voir [IMAGES.md](IMAGES.md). |
| **WebKitGTK et `container-type: size`** | Effondre les aperçus. À éviter. Voir [PDF.md](PDF.md). |
| **Workers de type module** | Ne sont pas garantis sur toutes les WebView visées. Les workers de FourTout sont bundlés en script classique (`worker.format: "iife"` dans `vite.config.ts`). |
| **Encodeurs FFmpeg annoncés** | `ffmpeg -encoders` liste ce avec quoi FFmpeg a été compilé, pas ce que la machine sait faire. FourTout éprouve chaque encodeur par un encodage d'essai. Voir [VIDEO.md](VIDEO.md). |
| **Permission microphone** | WebKitGTK demande un arbitrage natif. Voir [AUDIO.md](AUDIO.md). |
