# Construire les paquets

Construire FourTout produit un exécutable et des installeurs. Cette page
décrit ce qui est produit, sur quelle machine, et ce qui reste à faire à la
main.

---

## Principe

Tauri construit **pour la plateforme sur laquelle il s'exécute**. Il n'existe
pas de compilation croisée simple vers Windows depuis Linux : la WebView, les
bibliothèques système et l'empaqueteur diffèrent.

| Machine de construction | Paquets produits |
| --- | --- |
| Fedora / Linux x86-64 | `.rpm`, `.deb`, `.AppImage` |
| Windows x86-64 | `.exe` (NSIS), `.msi` |

C'est pourquoi le workflow de publication utilise deux exécuteurs — voir
[RELEASE.md](RELEASE.md).

---

## Vérifier avant de construire

```bash
pnpm verify                              # lint + typecheck + test + build
cd src-tauri && cargo test && cd ..
```

---

## Construire

### Tous les paquets de la plateforme courante

```bash
pnpm app:build
```

Les cibles déclarées dans `src-tauri/tauri.conf.json` sont `deb`, `rpm`,
`appimage`, `nsis` et `msi` ; Tauri ignore silencieusement celles qui ne
correspondent pas à la plateforme.

### Une cible précise

```bash
pnpm tauri build --bundles rpm
pnpm tauri build --bundles rpm,appimage
pnpm tauri build --bundles nsis          # sur Windows
```

### L'exécutable seul, sans empaquetage

```bash
pnpm tauri build --no-bundle
```

Utile pour vérifier que la construction en profil `release` passe, sans
attendre l'empaquetage. Environ une minute et quart sur une machine de
développement, contre plusieurs minutes pour l'AppImage.

---

## Où atterrissent les fichiers

```
src-tauri/target/release/
  fourtout                                        exécutable
  bundle/
    rpm/FourTout-0.1.0-1.x86_64.rpm
    deb/FourTout_0.1.0_amd64.deb
    appimage/FourTout_0.1.0_amd64.AppImage
    nsis/FourTout_0.1.0_x64-setup.exe             (Windows)
    msi/FourTout_0.1.0_x64_en-US.msi              (Windows)
```

---

## Vérifier un paquet Linux sans l'installer

Utile en intégration continue, et sur un poste que l'on ne veut pas modifier.

```bash
RPM=src-tauri/target/release/bundle/rpm/FourTout-0.1.0-1.x86_64.rpm

rpm -qip "$RPM"                 # nom, version, description
rpm -qlp "$RPM"                 # contenu
rpm -qRp "$RPM"                 # dépendances strictes
rpm -q --recommends -p "$RPM"   # dépendances recommandées
rpm -K --nosignature "$RPM"     # intégrité de la charge utile

# Extraire et inspecter sans installer
mkdir /tmp/ft && cd /tmp/ft
rpm2cpio "$RPM" | cpio -idm
desktop-file-validate usr/share/applications/FourTout.desktop
file usr/share/icons/hicolor/*/apps/fourtout.png
```

Le paquet doit contenir :

```
/usr/bin/fourtout
/usr/lib/FourTout/resources/wordlists/seeds.txt.gz
/usr/lib/FourTout/resources/wordlists/seeds.meta
/usr/share/applications/FourTout.desktop
/usr/share/icons/hicolor/{32x32,128x128,256x256@2}/apps/fourtout.png
```

L'AppImage se teste directement, sans rien installer :

```bash
chmod +x src-tauri/target/release/bundle/appimage/FourTout_0.1.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/FourTout_0.1.0_amd64.AppImage
```

---

## Dépendances déclarées

| Type | Paquets | Pourquoi |
| --- | --- | --- |
| **Requises** | `libwebkit2gtk-4.1`, `libgtk-3` | Sans elles, l'application ne démarre pas. Présentes sur toute installation de bureau. |
| **Recommandées** | `ffmpeg-free` (RPM), `ffmpeg` (DEB) | Nécessaire aux 34 outils audio et vidéo, inutile aux 117 autres. `dnf` et `apt` l'installent par défaut, sans que l'absence de FFmpeg empêche l'installation. |

FFmpeg **n'est pas embarqué** dans les paquets : il est cherché dans les
ressources de l'application (`resources/ffmpeg/`) puis dans le `PATH`. Ce
choix évite de redistribuer FFmpeg et les obligations de licence qui vont
avec — voir [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Pour produire un paquet **autonome** contenant FFmpeg, placez les binaires
dans `src-tauri/resources/ffmpeg/` et ajoutez-les à `bundle.resources` : la
fonction `resolve_binary` les trouvera avant le `PATH`. C'est alors vous qui
redistribuez FFmpeg, avec les obligations LGPL ou GPL correspondantes.

---

## Windows

### Ce que produit la construction

- **NSIS** (`.exe`) — l'installeur recommandé. Configuré en
  `installMode: currentUser` : **aucun droit administrateur n'est requis**,
  FourTout s'installe dans le dossier de l'utilisateur et apparaît au menu
  Démarrer. Sélecteur de langue désactivé, français et anglais disponibles.
- **MSI** — pour les déploiements par stratégie de groupe.

### Signature

Les installeurs ne sont **pas signés**. Sans certificat de signature de code,
SmartScreen affiche un avertissement au premier lancement. C'est dit dans
[INSTALLATION.md](INSTALLATION.md).

Mettre en place la signature ne demande **aucune modification du code** :
Tauri lit les variables d'environnement `TAURI_SIGNING_PRIVATE_KEY` et
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Le workflow de publication est déjà
écrit pour les recevoir depuis les secrets GitHub. **Aucune clé n'est générée
ni versionnée dans ce dépôt.**

---

## Reproductibilité

`pnpm-lock.yaml` et `src-tauri/Cargo.lock` sont versionnés : une construction
à partir d'un clone propre utilise exactement les mêmes versions.

Rien dans la construction ne dépend d'un chemin absolu, d'un modèle installé
manuellement, ni d'un fichier non versionné. Les seules ressources récupérées
à la construction sont celles de pdf.js et de Tesseract, recopiées depuis
`node_modules` par les scripts `pre*` — donc verrouillées par le lockfile.

Pour le vérifier :

```bash
git archive HEAD | (mkdir -p /tmp/ft-clean && tar -x -C /tmp/ft-clean)
cd /tmp/ft-clean
pnpm install --frozen-lockfile
pnpm verify
```
