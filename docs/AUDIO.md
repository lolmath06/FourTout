# Bloc Audio + voix

## Outils audio disponibles

Tous reposent sur le socle FFmpeg (voir [MEDIA.md](MEDIA.md)) — 100 % local,
annulables, avec progression.

| Outil | Ce qu'il fait |
| --- | --- |
| Convertir un audio | MP3 / WAV / FLAC / OGG / Opus / AAC-M4A. |
| Compresser un audio | Légère / Équilibrée / Forte, vers MP3/Opus/AAC ; gain affiché. |
| Découper un audio | Extrait une portion (`hh:mm:ss.mmm`), lecteur pour repérer les temps. |
| Fusionner des audios | Plusieurs fichiers, ordre modifiable, transcodage/normalisation par FFmpeg. |
| Régler le volume | Gain en dB, avertissement de saturation. |
| Normaliser un audio | EBU R128 (`loudnorm`) : standard / podcast / musique. |
| Changer la vitesse | 0,5×–2×, **hauteur (pitch) conservée** (`atempo`). |
| Supprimer les silences | Seuil + durée minimale (`silenceremove`). |
| Extraire l'audio d'une vidéo | Vers MP3/WAV/… ou **copie de piste** sans réencodage. |
| Enregistrer au micro | Capture WebView (MediaRecorder), WAV via FFmpeg ou WebM. |

Lecteur audio réutilisable (`AudioPreview`) : lecture, pause, timeline, volume.

### Enregistrement microphone

La capture utilise `getUserMedia` + `MediaRecorder` dans la WebView.

**WebKitGTK (Linux) — permission.** WebKitGTK n'affiche aucun dialogue de
permission et refuse toute capture par défaut ; sans intervention de
l'application hôte, `getUserMedia` échoue immédiatement en `NotAllowedError`.
Deux verrous sont levés côté natif (`src-tauri/src/microphone.rs`) :

- `WebKitSettings:enable-media-stream` est activé au démarrage (aucune demande
  n'est faite à ce moment-là : le réglage autorise seulement la question) ;
- le signal `permission-request` de la WebView est intercepté. Une
  `WebKitUserMediaPermissionRequest` **audio seule** est acceptée uniquement si
  l'utilisateur a donné son accord ; toute demande incluant la caméra est
  refusée, de même que les autres types de permission.

L'accord est demandé par la commande `mic_request_permission`, qui ouvre un
vrai dialogue natif (**Autoriser** / **Refuser**), appelée par l'outil au clic
sur *Démarrer* — jamais au lancement de FourTout. La décision vaut pour la
session : après un refus, le bouton **Autoriser le microphone** relance le
dialogue. Sur macOS et Windows, la WebView s'appuie sur les réglages du système
et FourTout n'ajoute pas de filtre (`mic_permission_state` y renvoie
`granted`).

**Libération.** À l'arrêt, au démontage de l'outil et après chaque échec :
pistes `MediaStream` arrêtées (`readyState === "ended"`), `MediaRecorder`
arrêté, `AudioContext` fermé, boucle de niveau annulée et URL objet révoquée.
Aucun indicateur système ne doit rester actif. Un verrou synchrone empêche
d'ouvrir deux captures sur un double-clic.

**Test manuel (non automatisable).** Le dialogue natif GTK et la capture réelle
ne sont pas reproductibles en test : dans l'application, ouvrir *Enregistrer au
micro*, cliquer **Démarrer**, répondre **Autoriser**, parler (le niveau et la
durée doivent bouger), cliquer **Arrêter**, réécouter, puis vérifier que
l'indicateur micro du système s'est éteint. Rejouer une fois en répondant
**Refuser** : le message « L'accès au microphone a été refusé. » et le bouton
**Autoriser le microphone** doivent apparaître, et le bouton doit rouvrir le
dialogue.

## Synthèse vocale (TTS) — `planned`

Les outils **Texte vers audio**, **Fichier texte vers audio** et **PDF vers
audio** restent `planned` dans cette phase.

Raison précise : une TTS locale de qualité (Piper, Kokoro…) suppose d'embarquer
un binaire natif **et** des modèles de voix (ONNX) — Piper : binaire + runtime
ONNX + `espeak-ng-data` + une voix FR et une voix EN (~20–60 Mo par voix). Leur
téléchargement, leur intégration cross-plateforme (Windows/Fedora) et leur
vérification dépassent ce qui pouvait être livré **de façon vérifiée et stable**
dans cette phase sans risquer le reste. Le socle est prêt à les recevoir :

- l'architecture média (jobs, temp files, résolution de binaire, MP3 via FFmpeg
  pour l'export) est en place ;
- l'extraction de texte PDF (`extractText`) et le nettoyage existent déjà pour
  alimenter `PDF vers audio` ;
- la segmentation en phrases/paragraphes se branchera sur le même Job Manager.

Pipeline cible de `PDF vers audio` : PDF → `extractText` → nettoyage → TTS →
concaténation → MP3/WAV. Si le PDF n'a pas de couche texte : message invitant à
utiliser l'OCR d'abord (moteur OCR déjà présent).

## Transcription (STT) + sous-titres — `planned`

Les outils **Transcription audio** et **Générer des sous-titres SRT** restent
`planned`.

Raison précise : une STT locale (whisper.cpp / faster-whisper) suppose un
binaire natif compilé **et** un modèle (ggml `tiny`/`base` ~75–150 Mo). Même
justification que la TTS : intégration et vérification cross-plateforme non
tenables de façon fiable dans cette phase. Le socle est prêt : extraction audio
FFmpeg (pour transcrire une vidéo), Job Manager, et l'UI de résultat éditable +
export `.txt`/`.srt` suivront le même modèle que l'OCR.

## Fixtures

`audio-tone.wav`, `audio-tone.mp3`, `audio-stereo.wav`, `audio-with-silences.wav`,
`audio-quiet.wav`, `audio-loud.wav`, `audio-two-parts-a.wav`,
`audio-two-parts-b.wav`, `video-with-audio.mp4`, `video-short.mp4`,
`video-for-gif.mp4`, `qr-sample.png`, `watermark-logo.png`, `favicon-source.png`,
`palette-photo.png`, `tts-short-fr.txt`, `tts-short-en.txt`, `tts-long-fr.txt`.

Les fixtures de **parole** (`audio-speech-fr/en.wav`) sont volontairement
absentes tant que la TTS/STT n'est pas intégrée (elles seront produites avec le
moteur retenu).
