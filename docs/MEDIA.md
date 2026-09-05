# Architecture média (FFmpeg)

## Vue d'ensemble

Le socle média alimente les outils **Audio** et toute la suite **Vidéo**
(conversion, compression, découpage, fusion, rognage, sous-titres…). Tout
s'exécute **localement** via FFmpeg ; rien ne quitte la machine.

La couche propre à la vidéo — détection des codecs réellement disponibles,
préréglages de qualité par encodeur, calculs de dimensions, honnêteté sur la
compression — est décrite dans [VIDEO.md](VIDEO.md).

Principes :

- **Aucune exécution shell.** FFmpeg est lancé avec `std::process::Command` et
  des arguments strictement séparés (`src-tauri/src/media/`). Aucun chemin
  utilisateur n'est concaténé dans une ligne interprétée.
- **Binaire résolu proprement.** Un binaire embarqué (application empaquetée)
  est préféré, avec repli sur le FFmpeg du système en développement.
- **Annulable, sans zombie.** Chaque travail suit son processus enfant et le
  **tue réellement** à l'annulation ; les fichiers temporaires sont nettoyés
  dans tous les cas (succès, erreur, annulation).
- **Garde-fou chemins.** `media_exec` refuse tout argument qui serait un chemin
  absolu hors du dossier temporaire de FourTout.

## Commandes natives (`src-tauri/src/media/command.rs`)

| Commande | Rôle |
| --- | --- |
| `media_available` | FFmpeg est-il exécutable ? |
| `media_encoders` | Liste des encodeurs disponibles (choix libx264 vs libopenh264…). |
| `media_temp` | Chemin temporaire pour une sortie. |
| `media_stage` | Écrit des octets d'entrée dans un temporaire, renvoie son chemin. |
| `media_probe` | ffprobe → JSON (durée, codecs, flux). |
| `media_exec` | Exécute FFmpeg (progression `media://progress`, annulation). |
| `media_read` | Relit une sortie temporaire. |
| `media_cleanup` | Supprime des temporaires. |
| `media_cancel` | Tue le processus FFmpeg d'un travail. |

Flux d'un outil (frontend `src/core/media/client.ts`) : `stage` des entrées →
`temp` pour la sortie → `exec` (progression + annulation via le Job Manager) →
`read` → `cleanup`. Les **constructeurs d'arguments** (`operations/audio.ts`,
`operations/video.ts`) sont des fonctions pures, testées et exécutées contre le
vrai FFmpeg.

Trois sortes d'entrées coexistent : les fichiers de l'utilisateur (`files`), un
contenu produit par l'application (`extraInputs` — un SRT généré, par exemple),
et un fichier dérivé des chemins déjà préparés (`operation.stageText`, utilisé
par la liste du démultiplexeur `concat`). Tous sont nettoyés de la même façon.

## Codecs

L'ensemble dépend du **build FFmpeg utilisé** :

- Audio : MP3 (libmp3lame), WAV (pcm_s16le), FLAC, OGG/Vorbis (libvorbis),
  Opus (libopus), AAC/M4A (aac).
- Vidéo : H.264 (libx264 **ou** libopenh264), H.265, VP9, AV1 (libsvtav1 ou
  libaom-av1) — toujours **résolus à l'exécution** via `media_encoders`, jamais
  supposés ; GIF avec palette optimisée.
- Sous-titres : `srt` (MKV), `webvtt` (WebM), `mov_text` (MP4) — ce dernier est
  absent de plusieurs builds courants, dont celui de Fedora.

`src/core/media/capabilities.ts` transforme cette liste en familles utilisables
par conteneur : l'interface ne propose donc **que** ce qui fonctionne. Voir
[VIDEO.md](VIDEO.md).

Sur le FFmpeg de Fedora par défaut, `libx264`/`libvpx`/`libvorbis` peuvent
manquer ; le binaire **embarqué** (build complet) les fournit — d'où l'intérêt
du sidecar. `gif → vidéo` choisit automatiquement l'encodeur H.264 présent.

## Packaging Windows / Fedora

Le binaire est résolu dans cet ordre (`resolve_binary`) :

1. Ressources de l'application empaquetée : `resources/ffmpeg/ffmpeg`
   (`ffmpeg.exe` sous Windows), puis `ffmpeg/ffmpeg`, puis à la racine.
2. Repli : `ffmpeg` dans le PATH (développement).

**À embarquer lors du packaging** (non inclus dans le dépôt, à récupérer une
fois) :

- **Fedora x86_64** : un FFmpeg statique complet (ex. builds *johnvansickle*),
  placé dans `src-tauri/resources/ffmpeg/{ffmpeg,ffprobe}` et déclaré dans
  `tauri.conf.json > bundle.resources`.
- **Windows x86_64** : `ffmpeg.exe` / `ffprobe.exe` (build *gyan.dev* ou
  *BtbN*), même emplacement.

Aucune dépendance à un FFmpeg installé par l'utilisateur. Les licences des
builds retenus (GPL/LGPL) doivent être conservées à côté des binaires.

## Fichiers temporaires

`std::env::temp_dir()/fourtout-media/`, noms aléatoires (pid + horodatage).
Chemins avec **espaces, accents et Unicode** pris en charge (test dédié). Aucun
fichier zombie : nettoyage systématique.

## Jobs longs

Réutilisation du Job Manager global : progression (`media://progress` →
`report`), annulation (le signal du job appelle `media_cancel`, qui tue FFmpeg),
survie à la navigation.

## Socle parole (Piper, whisper.cpp)

La synthèse et la transcription suivent **exactement les mêmes principes** que
FFmpeg : aucun shell, arguments strictement séparés, processus enfant suivi et
réellement tué à l'annulation, fichiers de travail confinés à
`fourtout-media/`. Elles réutilisent d'ailleurs ses briques —
`media_stage`/`media_temp`/`media_read`/`media_cleanup` pour les fichiers, et
FFmpeg lui-même pour normaliser un média en WAV 16 kHz mono avant
transcription, ou pour l'export MP3 après synthèse.

Ce qui diffère : les binaires ne sont pas supposés installés. Ils sont déclarés,
téléchargés et vérifiés par le gestionnaire de modèles — voir
[MODELS.md](MODELS.md). Commandes : `tts_speak`, `tts_concat`, `stt_transcribe`,
`speech_cancel`, et `models_list` / `models_install` / `models_cancel` /
`models_remove` / `models_dir`.

## Tests

- `src-tauri/tests/speech_integration.rs` — synthèse **et** transcription
  réelles : aller-retour texte → voix → texte en français et en anglais,
  concaténation multi-segments relue par le moteur (ignorés si les moteurs ne
  sont pas installés).
- `src-tauri/tests/media_integration.rs` — exécution/inspection réelles, chemins
  Unicode, erreur sur entrée invalide (ignorés si FFmpeg absent).
- `src/core/media/media.test.ts` — constructeurs audio (purs) **et** exécution
  réelle FFmpeg de chaque opération, validée par ffprobe.
- `src/core/media/video.test.ts` — mêmes principes pour la suite vidéo :
  redimensionnement, rognage, rotation, vitesse, découpage, fusion (recopie et
  normalisation), pistes audio, sous-titres.
- `src/core/media/pipeline.test.ts` — cycle complet avec un pont natif simulé :
  nettoyage après succès, après erreur et après annulation.
- `src-tauri/src/media/` — tests unitaires (parsing, garde-fou chemins).
