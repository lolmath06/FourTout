# FourTout

**Une seule application desktop pour les petits outils du quotidien.**

FourTout rassemble 151 utilitaires — PDF, images, audio, vidéo, texte,
fichiers, développeur, calculateurs, sécurité — dans une application qui
s'installe et fonctionne sur votre machine. Pas de site couvert de publicités,
pas de compte, pas de fichier téléversé sur le serveur de quelqu'un d'autre.

<!-- Captures d'écran : docs/assets/screenshots/ -->

---

## Pourquoi FourTout ?

Compresser un PDF, convertir une image en WebP, extraire le son d'une vidéo,
formater du JSON, convertir des kilomètres en miles : chacune de ces tâches
prend trente secondes. Les trouver prend plus longtemps, et le site gratuit qui
les propose demande souvent de téléverser le fichier.

FourTout part de l'idée inverse : **si l'opération peut se faire sur votre
machine, elle s'y fait.** Un PDF confidentiel, une photo de famille, un
enregistrement vocal — rien ne part sur le réseau.

Trois principes tiennent le produit :

1. **Ce qui est au catalogue fonctionne.** Il n'y a pas d'outil « bientôt
   disponible » : un outil incomplet n'est pas enregistré.
2. **Aucune promesse invérifiable.** Quand un outil a une limite — un
   effacement qui n'est pas physique, une conversion Word qui n'est pas
   fidèle au pixel, un JWT décodé mais pas vérifié — l'interface le dit, à
   l'endroit où l'utilisateur en a besoin.
3. **Rien n'est inventé.** La recherche ne propose que des outils réellement
   présents, et le convertisseur de devises affiche la date du relevé plutôt
   qu'un taux d'origine inconnue.

## Fonctionnalités

| Catégorie | Outils | Exemples |
| --- | --- | --- |
| **PDF** | 23 | Fusionner, séparer, compresser, caviarder, OCR, retrouver un mot de passe oublié |
| **Images** | 20 | Convertir, compresser, rogner, filigrane, OCR, retirer les métadonnées EXIF |
| **Audio** | 15 | Convertir, normaliser, couper les silences, synthèse vocale, transcription |
| **Vidéo** | 19 | Convertir, compresser, rogner, sous-titrer, incruster, vidéo ↔ GIF |
| **Texte & Documents** | 16 | Nettoyer, comparer, Markdown ↔ HTML, lire un DOCX |
| **Fichiers & Archives** | 16 | Archives, empreintes, doublons, renommage par lot, organiser un dossier |
| **Convertisseurs** | 1 | Convertisseur universel : déposez un fichier, FourTout propose les conversions |
| **Développeur** | 18 | JSON, XML, YAML, SQL, JWT, UUID, regex, cron, diff, minification |
| **Calculateurs** | 17 | Unités, pourcentages, dates, durées, âge, calculatrice, devises |
| **Sécurité** | 6 | Mots de passe, chiffrement de fichiers, suppression des métadonnées |

La liste complète, outil par outil : **[docs/FEATURES.md](docs/FEATURES.md)**.

## Local-first, et ce que cela veut dire exactement

Tout le traitement de fichiers est local : PDF, images, audio, vidéo, texte,
archives, empreintes, chiffrement. Aucun fichier n'est téléversé, il n'y a ni
compte, ni analytique, ni télémétrie.

Deux fonctions font exception, et les deux le disent dans l'interface :

- **le convertisseur de devises** interroge le flux de référence quotidien de
  la Banque centrale européenne. C'est une requête `GET` sans paramètre : le
  montant à convertir ne quitte jamais la machine, la conversion se fait
  localement à partir des taux. Hors ligne, le dernier relevé connu est
  réutilisé **et daté** ;
- **les moteurs de parole** (synthèse Piper, transcription whisper.cpp)
  téléchargent leur modèle une seule fois, à votre demande explicite. Ensuite,
  tout s'exécute sur la machine.

Le détail, fonction par fonction : **[docs/PRIVACY.md](docs/PRIVACY.md)**.

## Installation

| Système | Format recommandé |
| --- | --- |
| **Fedora / RHEL** | `FourTout-<version>-1.x86_64.rpm` |
| **Autres Linux** | `FourTout_<version>_amd64.AppImage` |
| **Windows 10/11** | `FourTout_<version>_x64-setup.exe` |

Les instructions détaillées, prérequis compris, sont dans
**[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

> Les installeurs Windows ne sont pas encore signés : SmartScreen affichera un
> avertissement au premier lancement. C'est attendu et documenté dans
> [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Développement

```bash
pnpm install     # dépendances Node
pnpm app:dev     # lance l'application desktop (Tauri + Vite)
pnpm verify      # lint + typecheck + tests + build
```

Prérequis, commandes et conventions : **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.
Construire les installeurs : **[docs/BUILD.md](docs/BUILD.md)**.

## Architecture

| Couche | Technologie |
| --- | --- |
| Interface | React 19, TypeScript, Tailwind CSS 4, Vite 7 |
| Application desktop | Tauri 2 (WebKitGTK sur Linux, WebView2 sur Windows) |
| Traitements natifs | Rust — fichiers, archives, chiffrement, empreintes, sidecars |
| PDF | pdf.js (lecture, rendu), @cantoo/pdf-lib (écriture) |
| Média | FFmpeg (système ou embarqué), codecs éprouvés à l'exécution |
| OCR | tesseract.js, entièrement local |
| Parole | Piper (synthèse), whisper.cpp (transcription) |

Tous les outils dérivent d'un **registre central** : catalogue, navigation,
recherche, convertisseur universel et routage par glisser-déposer lisent la
même source. Détails : **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Sécurité

Le chiffrement de fichiers utilise **Argon2id** pour dériver la clé et
**XChaCha20-Poly1305** pour chiffrer, par blocs authentifiés. Les archives
protégées utilisent **WinZip AES-256**, lisible par 7-Zip, WinRAR et
l'Explorateur Windows.

Le modèle de menace, le format de fichier chiffré, les limites de l'effacement
sécurisé et la procédure de signalement d'une vulnérabilité sont documentés
dans **[docs/SECURITY.md](docs/SECURITY.md)**.

## Documentation

L'index complet : **[docs/README.md](docs/README.md)**.

| Pour | Document |
| --- | --- |
| Installer | [INSTALLATION.md](docs/INSTALLATION.md) |
| Utiliser | [USER_GUIDE.md](docs/USER_GUIDE.md) |
| Voir tous les outils | [FEATURES.md](docs/FEATURES.md) |
| Comprendre la confidentialité | [PRIVACY.md](docs/PRIVACY.md) |
| Comprendre la sécurité | [SECURITY.md](docs/SECURITY.md) |
| Contribuer | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Résoudre un problème | [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |

## Licence

**Licence à décider.** Aucun fichier `LICENSE` n'a encore été choisi : le code
est donc, par défaut, sous droit d'auteur réservé. Ce point doit être tranché
avant toute publication en source ouverte.

Les composants tiers embarqués ou utilisés par FourTout, avec leurs licences,
sont inventoriés dans **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)**.
