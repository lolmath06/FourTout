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
| Texte vers parole | Synthèse locale (Piper), aperçu, WAV ou MP3. |
| Fichier texte vers audio | TXT/Markdown déposé, texte corrigeable, même pipeline. |
| PDF vers audio | Extraction (ou OCR) puis lecture, façon livre audio. |
| Transcription audio | Audio **ou vidéo** vers texte horodaté (whisper.cpp). |
| Générer des sous-titres | SRT et WebVTT depuis un audio ou une vidéo. |

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

## Synthèse vocale (TTS) — `available`

Moteur : **Piper**, voix `fr_FR-siwis-medium` et `en_US-lessac-medium`.
Installation, poids, licences et mesures : voir [MODELS.md](MODELS.md).

### Pipeline

```
texte → normalisation → segmentation → synthèse segment par segment
      → concaténation PCM → WAV (→ MP3 via FFmpeg)
```

La **segmentation** (`core/speech/segment.ts`) suit la langue et non un
compteur : paragraphes, puis phrases, regroupées jusqu'à ~480 caractères. Les
abréviations courantes (`M.`, `p.`, `Mr.`, `cf.`…) et les nombres décimaux ne
ferment pas une phrase ; une phrase trop longue est coupée sur une virgule, à
défaut sur un espace — jamais au milieu d'un mot.

La **concaténation** est native (`speech/wav.rs`) : les segments d'une même voix
partagent le format PCM, on recolle donc les données sous un nouvel en-tête.
C'est exact, instantané, et cela évite un réencodage pour la sortie WAV.

### Aperçu

« Écouter un aperçu » ne synthétise que la **première phrase** (200 caractères
au plus) : juger d'une voix ne doit jamais coûter vingt minutes de calcul.

### Job, progression et annulation

La génération passe par le job **global** (`features/jobs/speech.ts`) : quitter
l'outil ne l'arrête pas et n'en perd pas la trace. La barre indique le segment
courant sur le total. L'annulation tue réellement le processus Piper en cours,
interrompt la boucle et supprime tous les segments temporaires — aucun fichier
partiel n'est jamais présenté comme un résultat.

### Export

WAV toujours ; MP3 via le socle FFmpeg existant. Le résultat annonce durée,
taille, voix et format.

Débit mesuré sur Fedora (i9-14900HX) : **339 caractères/seconde** sur le
pipeline complet, soit environ **20× plus vite que la lecture**. Chiffres
détaillés dans [MODELS.md](MODELS.md).

## Transcription (STT) + sous-titres — `available`

Moteur : **whisper.cpp**, modèles `base` (*Rapide*, par défaut) et `small`
(*Précis*, facultatif). Le compromis est chiffré dans [MODELS.md](MODELS.md).

### Pipeline

```
audio ou vidéo → FFmpeg (WAV 16 kHz mono, -vn) → whisper.cpp → passages horodatés
              → texte, SRT, VTT
```

Une vidéo (MP4, MKV, WebM, MOV) emprunte exactement le même chemin : la bande
son est extraite par FFmpeg, il n'y a pas d'outil séparé.

### Langues

`Détection automatique`, `Français`, `Anglais`. L'auto-détection de whisper.cpp
est fiable au-delà de quelques secondes de parole ; sur un extrait très court,
forcer la langue reste préférable.

### Résultats et correction

Les passages sont affichés avec leur horodatage et **modifiables un par un**.
Les temps ne bougent pas : un SRT exporté après correction porte donc le texte
corrigé aux temps d'origine. Exports : Copier, `.txt`, `.srt`, `.vtt`.

Format SRT produit :

```
1
00:00:00,000 --> 00:00:02,350
Bonjour, ceci est un test.
```

et WebVTT :

```
WEBVTT

00:00:00.000 --> 00:00:02.350
Bonjour, ceci est un test.
```

Les accents sont conservés (UTF-8) et aucune durée n'est nulle ou négative.

### Job et annulation

Même modèle global que la synthèse : progression relayée par whisper.cpp
(`progress = N%`), navigation possible, annulation qui tue le processus. Aucun
processus ne survit à un arrêt.

## PDF vers audio

Voir [PDF.md](PDF.md) : extraction de texte existante, nettoyage prudent des
en-têtes et numéros de page, puis pipeline de synthèse ci-dessus. Un PDF sans
couche texte le dit et propose l'OCR déjà présent.

## Fixtures

`audio-tone.wav`, `audio-tone.mp3`, `audio-stereo.wav`, `audio-with-silences.wav`,
`audio-quiet.wav`, `audio-loud.wav`, `audio-two-parts-a.wav`,
`audio-two-parts-b.wav`, `video-with-audio.mp4`, `video-short.mp4`,
`video-for-gif.mp4`, `qr-sample.png`, `watermark-logo.png`, `favicon-source.png`,
`palette-photo.png`, `tts-short-fr.txt`, `tts-short-en.txt`, `tts-long-fr.txt`,
`pdf-to-audio.pdf`.

Les fixtures de **parole** `audio-speech-fr.wav` et `audio-speech-en.wav` sont
produites par la **vraie** voix Piper installée, à partir de `tts-short-fr.txt`
et `tts-short-en.txt` (`pnpm speech:assets`). Ce sont donc exactement les
fichiers que la transcription doit savoir relire — c'est le test croisé
TTS → STT de `src-tauri/tests/speech_integration.rs`. Le script s'arrête sans
erreur si les moteurs ne sont pas encore installés : il ne télécharge jamais
rien de lui-même.
