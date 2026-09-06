# Publier une version

Checklist à suivre dans l'ordre. Rien à décider en chemin : les décisions sont
prises aux étapes 0 et 5.

---

## 0. Décisions préalables — une fois pour toutes

Ces trois points doivent être tranchés **avant la première publication
publique**. Ils ne se reposent pas à chaque version.

- [ ] **Licence.** Aucun fichier `LICENSE` n'existe : le dépôt est donc, par
      défaut, sous droit d'auteur réservé. Choisir une licence, créer
      `LICENSE`, et mettre à jour la section correspondante du `README.md`.
- [ ] **Icône.** `src-tauri/icons/` contient encore l'icône par défaut de
      Tauri. Produire l'identité FourTout et régénérer le jeu complet :
      `pnpm tauri icon chemin/vers/logo.png`.
- [ ] **Signature Windows.** Sans certificat de signature de code, SmartScreen
      avertit au premier lancement. Si un certificat est acquis, déposer
      `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` dans
      les secrets GitHub du dépôt. **Ne jamais versionner de clé.**

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

- [ ] L'installeur s'exécute **sans droit administrateur**
- [ ] FourTout apparaît au menu Démarrer, avec son icône
- [ ] L'application se lance et deux ou trois outils fonctionnent
- [ ] Désinstallation propre depuis Paramètres → Applications

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

Ajoutez la section de version dans [`CHANGELOG.md`](../CHANGELOG.md) : ce que
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
- [ ] La publication brouillon contient : `.rpm`, `.deb`, `.AppImage`,
      `-setup.exe`, `.msi`, `SHA256SUMS.txt`

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
