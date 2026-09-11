# Composants tiers

**FourTout est un logiciel propriétaire. Les composants listés ici ne le sont
pas** : chacun reste sous sa propre licence, que la licence de FourTout ne
remplace pas et ne peut pas remplacer. Ce document existe pour que ces
licences soient respectées et visibles.

Cette page inventorie les composants qui comptent : ce qui est **embarqué** dans les paquets distribués, ce qui est
**appelé** sur la machine de l'utilisateur, ce qui est **téléchargé à la
demande**, et les briques significatives utilisées à la construction.

Les versions sont celles verrouillées par `pnpm-lock.yaml` et
`src-tauri/Cargo.lock`. La liste exhaustive des dépendances transitives se lit
dans ces deux fichiers ; ne sont détaillés ici que les composants dont la
présence change quelque chose pour l'utilisateur ou pour un juriste.

---

## Socle applicatif

| Composant | Version | Licence | Rôle |
| --- | --- | --- | --- |
| [Tauri](https://tauri.app) | 2.11 | MIT / Apache-2.0 | Coquille desktop, fenêtre, IPC, empaquetage |
| [React](https://react.dev) | 19.2 | MIT | Interface |
| [React Router](https://reactrouter.com) | 7.18 | MIT | Navigation |
| [Zustand](https://github.com/pmndrs/zustand) | 5.0 | MIT | État applicatif |
| [Tailwind CSS](https://tailwindcss.com) | 4.3 | MIT | Feuilles de style |
| [lucide-react](https://lucide.dev) | 0.544 | ISC | Icônes |
| [clsx](https://github.com/lukeed/clsx) | 2.1 | MIT | Composition de classes CSS |

## Documents et images

| Composant | Version | Licence | Rôle |
| --- | --- | --- | --- |
| [pdf.js](https://mozilla.github.io/pdf.js/) | 6.3 | Apache-2.0 | Lecture, rendu et extraction de texte PDF |
| [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) | 2.9 | MIT | Écriture PDF (fork maintenu de `pdf-lib`) |
| [tesseract.js](https://tesseract.projectnaptha.com) | 6.0 | Apache-2.0 | Reconnaissance de texte (OCR), exécutée localement |
| [ONNX Runtime Web](https://onnxruntime.ai) | 1.29 | MIT | Exécution locale du modèle de détourage (WebAssembly) |
| Données `tessdata` (fra, eng) | — | Apache-2.0 | Modèles OCR embarqués |
| [image](https://crates.io/crates/image) (Rust) | 0.25 | MIT / Apache-2.0 | Décodage et encodage d'images côté natif |
| [qrcode](https://github.com/soldair/node-qrcode) | 1.5 | MIT | Génération de QR codes |
| [jsQR](https://github.com/cozmo/jsQR) | 1.4 | Apache-2.0 | Lecture de QR codes |

## Outils développeur

| Composant | Version | Licence | Rôle |
| --- | --- | --- | --- |
| [Prettier](https://prettier.io) | 3.9 | MIT | Formatage HTML, CSS, JavaScript |
| [Terser](https://terser.org) | 5.51 | BSD-2-Clause | Minification JavaScript |
| [CSSO](https://github.com/css/csso) | 5.0 | MIT | Minification CSS |
| [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) | 15.8 | MIT | Mise en forme SQL |
| [js-yaml](https://github.com/nodeca/js-yaml) | 5.4 | MIT | Lecture et écriture YAML (schéma `core` uniquement) |
| [cron-parser](https://github.com/harrisiirak/cron-parser) | 5.10 | MIT | Prochaines occurrences d'une expression cron |
| [cronstrue](https://github.com/bradyholt/cRonstrue) | 3.24 | MIT | Explication d'une expression cron en français |

## Sécurité et chiffrement

| Composant | Version | Licence | Rôle |
| --- | --- | --- | --- |
| [argon2](https://crates.io/crates/argon2) | 0.5 | MIT / Apache-2.0 | Dérivation de clé Argon2id |
| [chacha20poly1305](https://crates.io/crates/chacha20poly1305) | 0.10 | MIT / Apache-2.0 | Chiffrement authentifié XChaCha20-Poly1305 |
| [aes](https://crates.io/crates/aes) | 0.8 | MIT / Apache-2.0 | AES, pour les PDF chiffrés et les archives ZIP AES |
| [sha2](https://crates.io/crates/sha2), [sha1](https://crates.io/crates/sha1), [md-5](https://crates.io/crates/md-5) | 0.10 | MIT / Apache-2.0 | Empreintes |
| [getrandom](https://crates.io/crates/getrandom) | 0.2 | MIT / Apache-2.0 | Aléa cryptographique du système |
| [@zxcvbn-ts](https://zxcvbn-ts.github.io/zxcvbn/) | 4.2 | MIT | Estimation de la robustesse d'un mot de passe |

## Fichiers et archives

| Composant | Version | Licence | Rôle |
| --- | --- | --- | --- |
| [zip](https://crates.io/crates/zip) | 2.4 | MIT | Archives ZIP, y compris WinZip AES-256 |
| [tar](https://crates.io/crates/tar) | 0.4 | MIT / Apache-2.0 | Archives TAR |
| [flate2](https://crates.io/crates/flate2) | 1.1 | MIT / Apache-2.0 | Compression DEFLATE et gzip |
| [sevenz-rust2](https://crates.io/crates/sevenz-rust2) | 0.21 | Apache-2.0 | Archives 7z : création, listage, extraction, test |
| [lzma-rust2](https://crates.io/crates/lzma-rust2) | 0.19 | Apache-2.0 | Flux XZ et LZMA2, en Rust pur (portage de « XZ for Java ») |
| [hmac](https://crates.io/crates/hmac) | 0.12 | MIT / Apache-2.0 | HMAC-SHA-1, SHA-256 et SHA-512 |
| [rayon](https://crates.io/crates/rayon) | 1.12 | MIT / Apache-2.0 | Parallélisme (empreintes, récupération de mot de passe) |
| [ureq](https://crates.io/crates/ureq) | 2.12 | MIT / Apache-2.0 | Client HTTP : taux BCE et téléchargement des modèles |

Les trois derniers sont arrivés avec la phase 9. Deux points ont pesé dans leur
choix, avant même leurs fonctions : ce sont des bibliothèques **Rust pures** —
aucun `liblzma` ou `p7zip` à trouver sur la machine de l'utilisateur, et rien
à compiler en C sous Windows — et leurs licences (Apache-2.0, MIT) n'imposent
aucune obligation incompatible avec la distribution de FourTout. La question
était de toute façon tranchée d'avance : dépendre d'un `7z` ou d'un `xz`
installé casserait la promesse « tout est embarqué, rien à installer ».

---

## Appelé sur la machine de l'utilisateur

### FFmpeg

**Licence :** LGPL-2.1-or-later, ou GPL selon la compilation.
**Site :** <https://ffmpeg.org>

FFmpeg n'est **pas embarqué** dans les paquets FourTout publiés : le programme
est appelé depuis le `PATH` du système, ou depuis `resources/ffmpeg/` s'il y a
été placé par un empaqueteur. FourTout ne le redistribue donc pas, et n'hérite
pas de ses obligations de distribution.

Si vous produisez un paquet FourTout **contenant** un binaire FFmpeg, c'est
vous qui le redistribuez : la licence de la compilation choisie s'applique
alors, et les obligations LGPL ou GPL correspondantes vous incombent.

---

## Téléchargé à la demande de l'utilisateur

Rien de ce qui suit n'est livré avec FourTout. Le gestionnaire de modèles
télécharge chaque élément à la demande explicite de l'utilisateur, vérifie son
empreinte, et l'installe dans le dossier de données de l'application.

### Moteurs

| Moteur | Licence | Source |
| --- | --- | --- |
| [Piper](https://github.com/rhasspy/piper) (synthèse vocale) | MIT | Publication GitHub `2023.11.14-2` |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (transcription) | MIT | Publication GitHub `b4938` |

### Voix Piper

Publiées sur [huggingface.co/rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).
La licence de la **voix** est celle du corpus qui l'a entraînée, et diffère de
celle du moteur :

| Voix | Licence du corpus |
| --- | --- |
| `fr_FR-siwis-medium` | CC BY 4.0 (corpus SIWIS) |
| `en_US-lessac-medium` | Blizzard Challenge 2013 — usage libre, **non commercial** pour le corpus |

FourTout affiche ces licences dans le gestionnaire de modèles, avant le
téléchargement. La voix anglaise ne convient pas à un usage commercial : c'est
écrit là où l'utilisateur choisit.

### Modèles Whisper

`ggml-base` et `ggml-small`, publiés sous licence **MIT** sur
[huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp).

### Modèles de détourage

**U²-Net**, licence **Apache 2.0** — code *et* poids.
Projet : [github.com/xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net).
Les conversions ONNX utilisées sont celles publiées par
[rembg](https://github.com/danielgatis/rembg) (MIT).

| Modèle | Taille | Licence |
| --- | --- | --- |
| `u2netp.onnx` (Détourage — Rapide) | 4,6 Mo | Apache 2.0 |
| `u2net.onnx` (Détourage — Précis) | 176 Mo | Apache 2.0 |

**Le choix du modèle est un choix de licence autant qu'un choix de qualité.**
Les modèles de segmentation plus récents et souvent meilleurs — RMBG 1.4 et 2.0
de BRIA, MODNet — réservent leurs poids à un usage **non commercial**. Ils sont
donc incompatibles avec la distribution de FourTout, et n'ont pas été retenus,
même à qualité supérieure.

---

## Données embarquées

| Ressource | Origine | Licence |
| --- | --- | --- |
| `src-tauri/resources/wordlists/seeds.txt.gz` | Corpus de mots de passe courants, assemblé pour FourTout par `scripts/generate-wordlist.mjs` | Domaine public (listes de mots de passe usuels) |
| `public/tessdata/` | Modèles de langue Tesseract (fra, eng) | Apache-2.0 |

---

## Services réseau

| Service | Usage | Données envoyées |
| --- | --- | --- |
| [Banque centrale européenne](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) | Taux de change de référence | Aucune : requête `GET` sans paramètre. Le montant à convertir ne quitte jamais la machine. |
| GitHub, Hugging Face | Téléchargement des moteurs et modèles de parole | Aucune, hors la requête elle-même |

Aucun autre appel réseau n'existe dans FourTout. Voir [docs/PRIVACY.md](docs/legal/PRIVACY.md).
