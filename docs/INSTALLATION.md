# Installation

FourTout est une application desktop. Il n'y a rien à configurer : téléchargez
le paquet correspondant à votre système, installez-le, lancez-le.

Les paquets sont publiés sur la page **Releases** du dépôt GitHub, accompagnés
d'un fichier `SHA256SUMS.txt` permettant de vérifier ce que vous avez
téléchargé.

---

## Windows 10 et 11

**Fichier recommandé :** `FourTout_<version>_x64-setup.exe` (installeur NSIS).

1. Téléchargez le `.exe`.
2. Double-cliquez.
3. FourTout s'installe pour l'utilisateur courant — **aucun droit
   administrateur n'est nécessaire**.
4. FourTout apparaît dans le menu Démarrer.

Un `.msi` est également publié pour les déploiements par stratégie de groupe.

### L'avertissement SmartScreen

Les installeurs ne sont pas encore signés par un certificat de signature de
code. Windows affichera donc, au premier lancement :

> Windows a protégé votre ordinateur — Application non reconnue

C'est le comportement normal pour un logiciel non signé, pas le signe d'un
problème. Pour continuer : **Informations complémentaires** → **Exécuter
quand même**. Vérifiez d'abord l'empreinte SHA-256 du fichier téléchargé
(voir plus bas).

La signature demande un certificat payant auprès d'une autorité reconnue.
Elle sera mise en place ; en attendant, ce README le dit plutôt que de laisser
l'utilisateur découvrir l'avertissement.

### Prérequis Windows

- **WebView2** : présent d'origine sur Windows 11 et sur Windows 10 à jour.
  L'installeur le télécharge automatiquement si nécessaire.
- **FFmpeg** : nécessaire uniquement pour les outils audio et vidéo. Voir
  [FFmpeg](#ffmpeg-audio-et-vidéo) ci-dessous.

### Désinstallation

Paramètres → Applications → FourTout → Désinstaller. Ou l'entrée
« Désinstaller FourTout » du menu Démarrer.

---

## Fedora, RHEL, CentOS Stream

**Fichier recommandé :** `FourTout-<version>-1.x86_64.rpm`.

Un double-clic sur le `.rpm` ouvre GNOME Logiciels (ou le gestionnaire de
paquets de votre bureau), qui propose l'installation. En ligne de commande :

```bash
sudo dnf install ./FourTout-<version>-1.x86_64.rpm
```

FourTout apparaît ensuite dans le menu Applications, catégorie *Utilitaires*.

Le paquet **recommande** `ffmpeg-free` : `dnf` l'installe automatiquement avec
FourTout, sauf si vous l'en empêchez. Il déclare comme dépendances strictes
`webkit2gtk-4.1` et `gtk3`, présents sur toute installation de bureau Fedora.

### Désinstallation

```bash
sudo dnf remove four-tout
```

> Le nom de paquet RPM est `four-tout` — c'est la forme normalisée de
> « FourTout » produite par l'empaqueteur.

---

## Autres distributions Linux

**Fichier recommandé :** `FourTout_<version>_amd64.AppImage`.

```bash
chmod +x FourTout_<version>_amd64.AppImage
./FourTout_<version>_amd64.AppImage
```

L'AppImage est autonome : elle n'installe rien et ne demande aucun droit
particulier. Elle n'ajoute pas non plus d'entrée au menu Applications ; pour
cela, utilisez un intégrateur d'AppImage, ou préférez le `.rpm` (Fedora) ou le
`.deb` (Debian, Ubuntu), également publiés.

L'AppImage a besoin de `libwebkit2gtk-4.1` sur le système hôte. Sur les
distributions qui ne le fournissent pas, installez-le d'abord :

| Distribution | Paquet |
| --- | --- |
| Debian, Ubuntu | `libwebkit2gtk-4.1-0` |
| Fedora | `webkit2gtk4.1` |
| Arch | `webkit2gtk-4.1` |
| openSUSE | `libwebkit2gtk-4_1-0` |

---

## FFmpeg (audio et vidéo)

Les **34 outils audio et vidéo** de FourTout s'appuient sur FFmpeg. Les 117
autres outils n'en ont pas besoin et fonctionnent sans lui.

FourTout cherche FFmpeg dans cet ordre :

1. dans ses propres ressources (`resources/ffmpeg/`), s'il y a été placé ;
2. dans le `PATH` du système.

| Système | Installation |
| --- | --- |
| Fedora | `sudo dnf install ffmpeg-free` (recommandé automatiquement par le RPM) |
| Debian, Ubuntu | `sudo apt install ffmpeg` |
| Arch | `sudo pacman -S ffmpeg` |
| Windows | [ffmpeg.org/download](https://ffmpeg.org/download.html), puis ajouter le dossier `bin` au `PATH` — ou `winget install Gyan.FFmpeg` |

FourTout détecte l'absence de FFmpeg et le dit clairement sur les pages
concernées, plutôt que d'échouer au moment du traitement. Les codecs proposés
sont ceux que le FFmpeg **installé** sait réellement produire : ils sont
éprouvés par un encodage d'essai au démarrage, pas simplement lus dans la
liste annoncée.

---

## Modèles de parole (facultatif)

La synthèse vocale (Piper) et la transcription (whisper.cpp) ont besoin d'un
modèle. Il n'est **pas** livré avec l'application : ce sont plusieurs dizaines
à plusieurs centaines de mégaoctets, et la plupart des utilisateurs n'en ont
pas l'usage.

Le gestionnaire de modèles de FourTout (Paramètres → Modèles) les télécharge à
votre demande explicite, vérifie leur empreinte, et les installe dans le
dossier de données de l'application. Ensuite, tout fonctionne hors ligne.

Détails : [MODELS.md](MODELS.md).

---

## Vérifier un téléchargement

Chaque publication contient un fichier `SHA256SUMS.txt`.

```bash
# Linux, macOS
sha256sum -c SHA256SUMS.txt --ignore-missing
```

```powershell
# Windows PowerShell
Get-FileHash .\FourTout_0.1.0_x64-setup.exe -Algorithm SHA256
```

Comparez l'empreinte obtenue à celle du fichier. FourTout sait aussi le faire :
l'outil **Vérifier une empreinte** compare un fichier à l'empreinte annoncée
par sa source.

---

## Où sont mes données ?

FourTout ne stocke que vos préférences, favoris et outils récents.

| Système | Emplacement |
| --- | --- |
| Linux | `~/.local/share/app.fourtout.desktop/` |
| Windows | `%APPDATA%\app.fourtout.desktop\` |

Les fichiers que vous traitez sont enregistrés là où vous le demandez, et
nulle part ailleurs. Paramètres → Données locales permet de tout effacer.

---

## Problème d'installation ?

Voir [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
