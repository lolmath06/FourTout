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
| `pnpm test:assets` | Régénère `test-assets/generated/` |
| `pnpm verify` | lint + typecheck + tests + build |

Côté natif : `cd src-tauri && cargo check` puis `cargo test --lib`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — structure du projet et décisions
- [Ajouter un outil](docs/ADDING-A-TOOL.md) — la procédure, en trois fichiers
- [test-assets/](test-assets/README.md) — fixtures de développement

## État actuel

Phase 1 : la fondation. Le catalogue complet est en place et navigable ; la
plupart des outils affichent une page « bientôt disponible » en attendant leur
implémentation. Voir `docs/ARCHITECTURE.md` pour ce qui est prêt à recevoir du
code métier.
