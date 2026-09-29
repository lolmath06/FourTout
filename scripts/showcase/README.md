# Vitrine : captures, bannière, démo et vidéo

Ces scripts régénèrent tous les médias du `README.md` à partir de
l'application **réelle**. Aucune interface n'est dessinée : les captures sont
des rendus de l'interface, et la bannière comme l'aperçu social n'utilisent
que le logo et une vraie capture. Les chiffres (outils, catégories) sont lus
dans le registre.

| Script | Produit |
| --- | --- |
| `fixtures.mjs` | Fichiers fictifs (PDF, image) dans `showcase-output/fixtures/` |
| `capture.mjs` | Écrans de l'interface dans Chromium : accueil, recherche, PDF, images, développeur |
| `native-capture.sh` | Écrans de l'application native Linux (Xvfb) : empreintes, archives, média, diagnostic |
| `branding.mjs` | `docs/assets/branding/fourtout-hero.webp`, `fourtout-social-preview.png`, exports WebP des captures |
| `demo.mjs` | `docs/assets/demo/fourtout-demo.webp`, `showcase-output/FourTout-<version>-demo.mp4` |

Les captures brutes (2560 × 1600) et la vidéo restent dans
`showcase-output/`, qui n'est pas versionné.

## Prérequis

- Node 22, `pnpm install` à la racine (Vite, `@napi-rs/canvas`, `pdf-lib`) ;
- `npm install` dans ce dossier (Playwright, sans navigateur) ;
- un Chromium : celui de Playwright, ou `CHROMIUM_PATH=/chemin/vers/chrome` ;
- FFmpeg avec `libx264` et `libwebp` ;
- la police **Inter** installée (celle de l'interface) ;
- pour `native-capture.sh`, Linux uniquement : `xvfb xdotool xclip
  imagemagick dbus-x11 zip` et les bibliothèques de développement Tauri
  (voir `docs/technical/DEVELOPMENT.md`).

## Tout régénérer

```bash
pnpm dev                                    # terminal 1 : l'interface sur :1420

cd scripts/showcase && npm install && cd -  # terminal 2
node scripts/showcase/fixtures.mjs
node scripts/showcase/capture.mjs
cargo build --release --manifest-path src-tauri/Cargo.toml
scripts/showcase/native-capture.sh          # charge l'interface depuis :1420
node scripts/showcase/branding.mjs
node scripts/showcase/demo.mjs
```

`native-capture.sh` utilise un binaire **sans** l'option `custom-protocol` :
il charge l'interface depuis le serveur Vite, comme `pnpm app:dev`. Il crée
ses fichiers d'exemple dans `/home/demo` (variable `DEMO_HOME`), un chemin
neutre puisqu'il apparaît à l'écran.

## Bon à savoir

- Les coordonnées de `native-capture.sh` sont en pixels logiques pour une
  fenêtre de 1280 × 800 ; si la mise en page d'un outil change, ajustez la
  position de sa zone de dépôt.
- `capture.mjs --only=accueil,pdf --theme=dark` ne refait qu'une partie.
- La démo WebP est l'enregistrement de `demo.mjs` accéléré de 1,3 fois ;
  la vidéo MP4 le montre à vitesse réelle.
- Écrans qu'un environnement automatisé ne peut pas produire honnêtement :
  [`docs/assets/screenshots/SHOTLIST.md`](../../docs/assets/screenshots/SHOTLIST.md).
