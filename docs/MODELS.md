# Moteurs et modèles de parole

FourTout parle et transcrit **localement**. Rien n'est envoyé sur le réseau
pendant l'usage : le seul accès à Internet est le téléchargement initial des
moteurs et des modèles, déclenché par l'utilisateur, une fois pour toutes.

## Pourquoi ces moteurs

| Besoin | Moteur retenu | Écarté |
| --- | --- | --- |
| Synthèse (TTS) | **Piper** 2023.11.14-2 | Kokoro : qualité supérieure, mais suppose onnxruntime + un phonémiseur externe et un modèle de 90 à 310 Mo, sans binaire autonome Windows/Linux prêt à empaqueter. |
| Reconnaissance (STT) | **whisper.cpp** b4938 | Whisper via ONNX : mêmes modèles, mais chaîne d'exécution à assembler soi-même, sans binaire officiel multiplateforme. |

Piper et whisper.cpp partagent ce qui compte ici : binaires **autonomes** publiés
pour Linux x86-64 **et** Windows x86-64, exécution processeur, licence MIT,
et un mode ligne de commande qui se pilote proprement (progression, arrêt réel).

## Catalogue

Déclaré dans `src-tauri/src/models/mod.rs` : chaque fichier y porte son URL
officielle, son empreinte SHA-256 et sa taille. Rien n'est téléchargé qui ne
soit épinglé.

| Élément | Contenu | Poids | Licence | Source |
| --- | --- | --- | --- | --- |
| `engine-piper` | Binaire Piper + onnxruntime + espeak-ng | 26,5 Mo (Linux) / 22,5 Mo (Windows) | MIT | [rhasspy/piper](https://github.com/rhasspy/piper) |
| `voice-fr-siwis` | `fr_FR-siwis-medium.onnx` + config | 63,2 Mo | CC BY 4.0 (corpus SIWIS) | [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) |
| `voice-en-lessac` | `en_US-lessac-medium.onnx` + config | 63,2 Mo | Blizzard Challenge 2013 | [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) |
| `engine-whisper` | `whisper-cli` + bibliothèques ggml | 9,5 Mo (Linux) / 8,4 Mo (Windows) | MIT | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| `stt-base` — *Rapide* | `ggml-base.bin` | 128,5 Mo | MIT | [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) |
| `stt-small` — *Précis* | `ggml-small.bin` | 487,6 Mo | MIT | idem |

**Installation minimale utilisable** : Piper + une voix + whisper.cpp + `base`
≈ **227 Mo** sur le disque. Avec les deux voix : ≈ 291 Mo. Le modèle *Précis*
est facultatif.

### Le compromis sur le modèle de transcription

Mesuré sur cette machine (Intel Core i9-14900HX, 4 fils, 18,2 s de parole
française) :

| Modèle | Durée | Facteur temps réel | RAM (RSS) | Qualité observée |
| --- | --- | --- | --- | --- |
| `base` (128 Mo) | 1,44 s | **0,08×** | 284 Mo | Phrases justes, quelques accords et chiffres approximatifs. |
| `small` (488 Mo) | 4,39 s | **0,24×** | 750 Mo | Nettement plus fidèle sur le français ; ~3× plus lent. |

`base` est donc le modèle par défaut : il transcrit une heure d'audio en cinq
minutes environ, tient dans un installateur raisonnable et suffit à un
enregistrement net. `small` est proposé à côté, pour qui privilégie la fidélité.

### Débit de la synthèse

Même machine, voix `fr_FR-siwis-medium`. Deux mesures, parce qu'elles ne disent
pas la même chose :

| Mesure | Texte | Calcul | Audio produit | Débit | Facteur temps réel |
| --- | --- | --- | --- | --- | --- |
| Un seul appel | 297 car. | 0,60 s | 18,2 s | 495 car/s | 0,033× |
| **Pipeline réel** (36 segments) | 4 427 car. | 13,1 s | 257 s | **339 car/s** | **0,051×** |

Le pipeline complet est ~30 % plus lent : chaque segment relance Piper, qui
recharge son modèle. C'est le prix d'une annulation immédiate et d'une
progression honnête, et il reste largement payant — la lecture est produite
**20× plus vite qu'elle ne s'écoute**. Un livre de 300 000 caractères se
synthétise en ~15 minutes. RAM par processus : 194 Mo.

## Où vivent les fichiers

Ordre de résolution d'un moteur (`models::resolve_engine`) :

1. **ressources de l'application** — `resources/speech/<moteur>/` si un
   installateur choisit d'embarquer les binaires ;
2. **dossier de modèles** — installé par l'utilisateur ;
3. **PATH** — commodité de développement uniquement.

Le dossier de modèles est le dossier applicatif standard, et l'interface
l'affiche :

| Système | Emplacement |
| --- | --- |
| Fedora / Linux | `~/.local/share/app.fourtout.desktop/models` |
| Windows | `%APPDATA%\app.fourtout.desktop\models` |

`FOURTOUT_MODELS_DIR` le déplace (tests, installation partagée).

Arborescence : `engines/piper/`, `engines/whisper/`, `voices/`, `stt/`, plus un
`.partial/` de travail vidé après chaque installation.

## Installation

Le panneau d'installation apparaît **dans l'outil**, tant qu'un élément requis
manque. Il annonce ce qui va être téléchargé, sa taille et sa licence, et
n'agit qu'après un clic.

Chaque fichier est écrit dans un `.part`, puis **vérifié par SHA-256** avant
d'être mis en place : une coupure réseau, un disque plein ou une annulation ne
laissent jamais un modèle à moitié installé passer pour valide. Les archives
sont extraites en contrôlant chaque chemin (aucune sortie du dossier cible), en
conservant le bit exécutable. Chaque élément peut être supprimé puis
réinstallé.

## Fonctionnement hors ligne

Une fois installés, la synthèse, la transcription, `PDF vers audio` et les
sous-titres n'ouvrent **aucune connexion**. Vérifié en exécutant les deux
moteurs dans un espace réseau isolé (`unshare -rn`, aucune interface adressable)
: synthèse et transcription aboutissent normalement.

## Empaquetage Windows et Fedora

Le catalogue sélectionne l'asset de la plateforme à la compilation
(`#[cfg(target_os = …)]`) : un binaire Windows télécharge le `.zip` Windows, un
binaire Linux le `.tar.gz` Linux. Rien n'est supposé présent dans le PATH de
l'utilisateur final.

- **Fedora** — archive `.tar.gz`, extraite en conservant les permissions ; les
  bibliothèques (`libpiper_phonemize.so`, `libwhisper.so`, `libggml-*.so`) sont
  livrées à côté du binaire et résolues par son `RPATH=$ORIGIN`. Aucun chemin
  `/usr/...` n'est codé en dur.
- **Windows** — archive `.zip`, extraite avec les DLL voisines
  (`onnxruntime.dll`, `espeak-ng.dll`, `ggml-*.dll`), chargées depuis le dossier
  de l'exécutable. Les chemins comportant des espaces sont sûrs : aucun shell
  n'est utilisé, les arguments sont passés séparément.
- **Embarquer les moteurs dans l'installateur** (facultatif) : placer les
  binaires dans `src-tauri/resources/speech/piper/` et
  `src-tauri/resources/speech/whisper/`, et les déclarer dans `bundle.resources`
  d'un `tauri.linux.conf.json` / `tauri.windows.conf.json`. `resolve_engine` les
  préférera, et le panneau d'installation ne portera plus que sur les voix et
  les modèles.

## Limites connues

- Voix disponibles : une française et une anglaise, qualité *medium*. Les autres
  voix de `piper-voices` s'ajoutent en une entrée de catalogue, mais ne sont pas
  livrées.
- La transcription **auto-détecte** la langue ; sur un extrait très court, forcer
  « Français » ou « Anglais » reste plus fiable.
- Les noms propres inventés (« FourTout ») et les acronymes sont transcrits
  phonétiquement par whisper.cpp, quel que soit le modèle.
- Aucune accélération GPU : les binaires retenus sont les versions processeur,
  seules réellement portables. La transcription utilise la moitié des cœurs
  (8 au maximum) pour laisser la machine utilisable.
