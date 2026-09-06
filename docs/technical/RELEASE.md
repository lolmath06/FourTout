# Publier une version

[← Documentation](../README.md)

## Sommaire

- [0. Décisions préalables — une fois pour toutes](#0-décisions-préalables--une-fois-pour-toutes)
- [1. Le dépôt est propre](#1-le-dépôt-est-propre)
- [2. Tout est vert](#2-tout-est-vert)
- [3. Les paquets Linux se construisent et s'installent](#3-les-paquets-linux-se-construisent-et-sinstallent)
- [4. Le paquet Windows se construit et s'installe](#4-le-paquet-windows-se-construit-et-sinstalle)
- [5. Choisir la version](#5-choisir-la-version)
- [6. Mettre à jour le journal](#6-mettre-à-jour-le-journal)
- [7. Étiqueter et pousser](#7-étiqueter-et-pousser)
- [8. Laisser le workflow travailler](#8-laisser-le-workflow-travailler)
- [9. Vérifier les artefacts publiés](#9-vérifier-les-artefacts-publiés)
- [10. Publier](#10-publier)
- [Après publication](#après-publication)
- [En cas de problème après publication](#en-cas-de-problème-après-publication)

---

Checklist à suivre dans l'ordre. Rien à décider en chemin : les décisions sont
prises aux étapes 0 et 5.

---

## 0. Décisions préalables — une fois pour toutes

Ces trois points doivent être tranchés **avant la première publication
publique**. Ils ne se reposent pas à chaque version.

- [x] **Licence.** Propriétaire — voir [`LICENSE`](../../LICENSE).
      Copyright © 2026 Matheo Dolmen, tous droits réservés.
- [x] **Icône.** Identité FourTout en place. Le master est
      `docs/assets/branding/fourtout-logo.png` ; le jeu d'icônes se régénère
      par `pnpm tauri icon docs/assets/branding/fourtout-icon-1024.png`.
- [ ] **Signature Windows.** Sans certificat de signature de code, SmartScreen
      avertit au premier lancement. Si un certificat est acquis, déposer
      `WINDOWS_CERTIFICATE` (le `.pfx` en base64) et
      `WINDOWS_CERTIFICATE_PASSWORD` dans les secrets GitHub du dépôt. Le
      workflow les utilise déjà. **Ne jamais versionner de clé.**

---

## 1. Le dépôt est propre

```bash
git status              # rien en attente
git log --oneline -10   # l'historique dit ce qui a changé
```

## 2. Tout est vert

```bash
pnpm install --frozen-lockfile
pnpm test:assets        # fixtures nécessaires aux tests d'intégration natifs
pnpm verify             # lint + typecheck + test + build

cd src-tauri
cargo check --all-targets
cargo test
cd ..
```

Notez les chiffres exacts : ils vont dans le corps de la publication.

## 3. Les paquets Linux se construisent et s'installent

```bash
pnpm tauri build --bundles rpm,appimage
```

```bash
RPM=src-tauri/target/release/bundle/rpm/FourTout-*.x86_64.rpm
rpm -qip $RPM && rpm -qlp $RPM && rpm -K --nosignature $RPM
```

- [ ] Installer réellement le RPM sur une machine de test :
      `sudo dnf install ./FourTout-*.rpm`
- [ ] L'icône affichée est bien celle de FourTout, pas une icône générique
- [ ] FourTout apparaît au menu Applications, avec son icône
- [ ] L'application se lance depuis le menu
- [ ] Deux ou trois outils fonctionnent (un PDF, un calculateur, un
      développeur)
- [ ] Désinstallation propre : `sudo dnf remove four-tout`
- [ ] L'AppImage se lance : `chmod +x …AppImage && ./…AppImage`

## 4. Le paquet Windows se construit et s'installe

Sur une machine Windows, ou en laissant faire le workflow de publication.

```powershell
pnpm install
pnpm tauri build --bundles nsis
```

Puis suivre la liste **« Vérifier une installation Windows »** de
[docs/guides/INSTALLATION.md](../guides/INSTALLATION.md#vérifier-une-installation-windows) :
installation sans droit administrateur, menu Démarrer, icône, trois outils
sans dépendance, un outil vidéo, un outil à modèle, zoom, désinstallation.

## 5. Choisir la version

Trois fichiers doivent porter le **même** numéro :

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`

```bash
grep -m1 '"version"' package.json src-tauri/tauri.conf.json
grep -m1 '^version' src-tauri/Cargo.toml
```

Après modification, régénérez `Cargo.lock` :

```bash
cd src-tauri && cargo check && cd ..
```

## 6. Mettre à jour le journal

Ajoutez la section de version dans [`CHANGELOG.md`](../../CHANGELOG.md) : ce que
l'utilisateur gagne, pas la liste des commits.

```bash
git add -A && git commit -m "Version X.Y.Z"
```

## 7. Étiqueter et pousser

```bash
git tag -a vX.Y.Z -m "FourTout X.Y.Z"
git push origin main
git push origin vX.Y.Z
```

## 8. Laisser le workflow travailler

Le poussée d'une étiquette `v*` déclenche `.github/workflows/release.yml`, qui
construit sur Ubuntu **et** sur Windows, calcule les empreintes SHA-256, et
crée une publication **en brouillon**.

- [ ] Le workflow est vert sur les deux plateformes
- [ ] La publication brouillon contient, nommés par système :
      `FourTout-<version>-Fedora-x86_64.rpm`,
      `FourTout-<version>-Linux-amd64.deb`,
      `FourTout-<version>-Linux-x86_64.AppImage`,
      `FourTout-<version>-Windows-x64-Setup.exe`,
      `FourTout-<version>-Windows-x64.msi`,
      `FourTout-<version>-Windows-x64-Portable.zip`, et `SHA256SUMS.txt`

## 9. Vérifier les artefacts publiés

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

- [ ] Télécharger le RPM depuis la publication et l'installer sur une machine
      propre
- [ ] Télécharger l'installeur Windows et l'installer sur une machine propre
- [ ] Les deux se lancent et ouvrent un outil

## 10. Publier

- [ ] Rédiger le corps de la publication : nouveautés, corrections, limites
      connues
- [ ] Rappeler que les installeurs Windows ne sont pas signés, tant que
      c'est le cas
- [ ] Retirer l'état « brouillon »

---

## Après publication

- [ ] Vérifier que les liens du `README.md` fonctionnent depuis GitHub
- [ ] Ouvrir un ticket pour ce qui a été reporté

---

## En cas de problème après publication

Repassez la publication en brouillon plutôt que de supprimer l'étiquette : les
liens déjà partagés cesseront de pointer vers un binaire défectueux, et
l'historique reste lisible. Corrigez, puis publiez un correctif `X.Y.Z+1`.
