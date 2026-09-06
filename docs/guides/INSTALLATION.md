# Installation

[← Documentation](../README.md)

## Sommaire

- [Windows 10 et 11](#windows-10-et-11)
- [Fedora, RHEL, CentOS Stream](#fedora-rhel-centos-stream)
- [Autres distributions Linux](#autres-distributions-linux)
- [FFmpeg (audio et vidéo)](#ffmpeg-audio-et-vidéo)
- [Modèles de parole (facultatif)](#modèles-de-parole-facultatif)
- [Vérifier un téléchargement](#vérifier-un-téléchargement)
- [Où sont mes données ?](#où-sont-mes-données-)
- [Problème d'installation ?](#problème-dinstallation-)

---

FourTout est une application desktop. Il n'y a rien à configurer : téléchargez
le paquet correspondant à votre système, installez-le, lancez-le.

Les paquets sont publiés sur la page **Releases** du dépôt GitHub, accompagnés
d'un fichier `SHA256SUMS.txt` permettant de vérifier ce que vous avez
téléchargé.

---

## Windows 10 et 11

**Fichier recommandé :** `FourTout-<version>-Windows-x64-Setup.exe`
(installeur NSIS), sur la page **Releases** du dépôt.

> **N'utilisez pas « Code → Download ZIP ».** Cette archive contient le code
> source, pas l'application.

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

### Vérifier une installation Windows

Liste à cocher, à faire une fois sur une machine Windows après une
publication. Elle ne demande ni Node, ni Rust, ni ligne de commande.

1. **Télécharger** `FourTout-<version>-Windows-x64-Setup.exe` depuis la page
   Releases. Vérifier son empreinte SHA-256 :
   ```powershell
   Get-FileHash .\FourTout-<version>-Windows-x64-Setup.exe -Algorithm SHA256
   ```
   et la comparer à la ligne correspondante de `SHA256SUMS.txt`.
2. **Installer** par double-clic. Passer l'avertissement SmartScreen
   (*Informations complémentaires* → *Exécuter quand même*) tant que
   l'installeur n'est pas signé.
   → **Aucune fenêtre de contrôle de compte d'utilisateur ne doit apparaître :**
   l'installation se fait pour l'utilisateur courant.
3. **Menu Démarrer** — FourTout apparaît, avec son icône (carré bleu marine,
   F blanc). Pas d'icône générique, pas de logo Tauri.
4. **Lancer** — la fenêtre s'ouvre, son icône de barre des tâches est la bonne,
   et le titre est « FourTout ».
5. **Trois outils sans dépendance externe** : *Calculs de pourcentages*,
   *JSON — formater et valider*, *Fusionner des PDF*. Ils doivent fonctionner
   immédiatement, sans rien installer d'autre.
6. **Un outil vidéo** — sans FFmpeg dans le `PATH`, l'écran doit **le dire
   clairement**, pas échouer en silence. Installer FFmpeg
   (`winget install Gyan.FFmpeg`), **redémarrer FourTout**, et vérifier que
   l'outil devient utilisable.
7. **Un outil à modèle** — ouvrir *Retirer l'arrière-plan* : l'écran doit
   proposer le téléchargement, avec taille, source et licence. Installer,
   détourer une photo, vérifier le PNG produit.
8. **Zoom** — `Ctrl` `+`, `Ctrl` `-`, `Ctrl` `0`. Fermer, rouvrir : l'échelle
   est conservée.
9. **Désinstaller** depuis Paramètres → Applications. L'entrée du menu Démarrer
   disparaît.

Le dossier de données (`%APPDATA%\app.fourtout.desktop\`) survit à la
désinstallation : c'est voulu, il contient vos préférences et vos modèles.
Supprimez-le à la main pour repartir de zéro.

---

## Fedora, RHEL, CentOS Stream

**Fichier recommandé :** `FourTout-<version>-Fedora-x86_64.rpm`, sur la page
**Releases** du dépôt.

Un double-clic sur le `.rpm` ouvre GNOME Logiciels (ou le gestionnaire de
paquets de votre bureau), qui propose l'installation. En ligne de commande :

```bash
sudo dnf install ./FourTout-<version>-Fedora-x86_64.rpm
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

**Fichier recommandé :** `FourTout-<version>-Linux-x86_64.AppImage`.

```bash
chmod +x FourTout-<version>-Linux-x86_64.AppImage
./FourTout-<version>-Linux-x86_64.AppImage
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

Détails : [MODELS.md](../technical/MODELS.md).

---

## Vérifier un téléchargement

Chaque publication contient un fichier `SHA256SUMS.txt`.

```bash
# Linux, macOS
sha256sum -c SHA256SUMS.txt --ignore-missing
```

```powershell
# Windows PowerShell
Get-FileHash .\FourTout-0.1.0-Windows-x64-Setup.exe -Algorithm SHA256
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
