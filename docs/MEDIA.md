# Architecture média (FFmpeg)

## Vue d'ensemble

Le socle média alimente les outils **Audio** et les petits ponts **Vidéo**
(vidéo ↔ GIF, extraction d'image, extraction audio). Tout s'exécute
**localement** via FFmpeg ; rien ne quitte la machine.

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

## Codecs

L'ensemble dépend du **build FFmpeg utilisé** :

- Audio : MP3 (libmp3lame), WAV (pcm_s16le), FLAC, OGG/Vorbis (libvorbis),
  Opus (libopus), AAC/M4A (aac).
- Vidéo (ponts) : H.264 (libx264 **ou** libopenh264 selon disponibilité —
  résolu à l'exécution via `media_encoders`), VP9 (libvpx) pour le WebM ; GIF
  avec palette optimisée.

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

## Tests

- `src-tauri/tests/media_integration.rs` — exécution/inspection réelles, chemins
  Unicode, erreur sur entrée invalide (ignorés si FFmpeg absent).
- `src/core/media/media.test.ts` — constructeurs d'arguments (purs) **et**
  exécution réelle FFmpeg de chaque opération, validée par ffprobe.
- `src-tauri/src/media/` — tests unitaires (parsing, garde-fou chemins).
