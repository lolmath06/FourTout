# Architecture Vidéo

La suite Vidéo est bâtie **au-dessus du socle média** décrit dans
[MEDIA.md](MEDIA.md) : mêmes commandes natives, mêmes fichiers temporaires,
même annulation. Ce document décrit ce que la phase 5 ajoute par-dessus.

## Principe directeur : ne jamais proposer ce que le moteur ne sait pas faire

Le même binaire FFmpeg n'a pas les mêmes encodeurs selon la plateforme. Sur un
build complet, H.264 passe par `libx264` et un MP4 peut porter une piste de
sous-titres (`mov_text`). Sur le FFmpeg de Fedora, `libx264` est absent —
H.264 passe par `libopenh264`, qui **ne comprend pas `-crf`** — et l'encodeur
`mov_text` n'existe pas.

Conséquence : rien n'est supposé. `src/core/media/capabilities.ts` lit une fois
`ffmpeg -encoders` (commande native `media_encoders`), en déduit les familles
disponibles, et l'interface ne propose que des combinaisons réellement
encodables.

| Élément | Rôle |
| --- | --- |
| `capabilitiesFromEncoders()` | Liste d'encodeurs → familles disponibles (fonction pure, testée) |
| `videoCodecsFor(container)` | Codecs acceptés **par le conteneur** et présents dans le build |
| `mostCompatible()` | La combinaison « compatibilité maximale » réellement possible |
| `subtitleContainers` | Conteneurs capables de porter une piste de sous-titres textuelle |

## Qualité : une table par encodeur, pas une valeur universelle

`src/core/media/video/presets.ts` traduit une intention (« qualité élevée »,
« fichier plus léger ») en arguments adaptés à l'encodeur retenu :

- `libx264` / `libx265` : `-crf` + `-preset medium` ;
- `libvpx-vp9` : `-crf` avec `-b:v 0` et `-row-mt 1` ;
- `libsvtav1` / `libaom-av1` : `-crf` avec leurs propres échelles ;
- `libopenh264` et les encodeurs matériels : **débit cible**, calculé à partir
  du débit réel de la source (ou, à défaut, d'une estimation par pixel).

Recopier un CRF de `libx264` vers `libopenh264` produirait un échec à
l'exécution ; un test verrouille ce point.

`-pix_fmt yuv420p` est systématique : c'est ce qui rend le fichier lisible
partout.

## Honnêteté sur la compression

`sizeOutcome()` (`src/tools/impl/video/shared.ts`) compare la taille produite à
la taille d'origine. Si le résultat est plus gros, il n'est **pas** présenté
comme un succès : le panneau affiche

> Ce fichier était déjà suffisamment optimisé : le résultat est plus volumineux
> que l'original.

Un gain de 0 % n'est jamais affiché comme un gain.

## Dimensions

`src/core/media/video/dimensions.ts` tient deux règles sans exception :

1. **dimensions paires** — `yuv420p` sous-échantillonne la chrominance, une
   largeur impaire fait échouer l'encodage ;
2. **aucun agrandissement silencieux** — passer une source 720p en 1080p
   n'ajoute aucun détail ; l'outil l'annonce et exige une confirmation.

Une vidéo verticale reste verticale : « 720p » porte sur le petit côté.

Le rognage convertit la sélection affichée (fractions) en pixels pairs contenus
dans l'image (`cropRectFor`) : **ce que l'utilisateur voit est ce qu'il
obtient**. Le rapport imposé (1:1, 16:9, 9:16…) est contraint en pixels de la
source, pas en fractions — sans quoi « 1:1 » sur une source 16:9 donnerait un
rectangle.

## Fusion : jamais de concaténation naïve

`concatCompatible()` compare codecs, définition, cadence, présence et format de
l'audio.

- **Compatibles** → démultiplexeur `concat` avec `-c copy`. La liste de
  fichiers est préparée par `stageText` (voir plus bas) puis supprimée comme
  tout autre temporaire.
- **Hétérogènes** → `filter_complex` de normalisation : mise à l'échelle sans
  déformation (`force_original_aspect_ratio=decrease` + `pad`), `setsar=1`,
  cadence commune, audio rééchantillonné en 48 kHz stéréo. Une source **muette**
  reçoit un silence de sa durée (`anullsrc`), faute de quoi les pistes audio se
  décaleraient.

## Sous-titres

Trois opérations distinctes, volontairement séparées :

| Outil | Effet | Réencodage |
| --- | --- | --- |
| Ajouter une piste | Le texte devient une piste activable dans le lecteur | Non (`-c copy`) |
| Incruster | Le texte fait partie des pixels, visible partout | Oui (image seulement) |
| Extraire | Les pistes textuelles existantes ressortent en SRT/VTT | Non |

L'ajout de piste dépend du conteneur : `srt` en MKV, `webvtt` en WebM,
`mov_text` en MP4. Quand le build n'a pas `mov_text`, l'outil bascule sur MKV
**et le dit**. L'extraction distingue les pistes textuelles des pistes
graphiques (PGS, DVD, DVB) : ces dernières sont des images, leur conversion en
texte demanderait une reconnaissance de caractères que cet outil ne fait pas —
c'est annoncé, pas promis à tort.

L'incrustation passe par le filtre `subtitles`. Le chemin est échappé
(`escapeFilterPath`) puis entouré de guillemets simples : le lexer de FFmpeg
découpe sur `:` et `,`, et un `C:\Films\a,b.srt` casserait sinon le graphe.

### Sous-titres automatiques

`video-generate-subtitles` **ne crée aucun second moteur** : il réutilise
exactement la chaîne de la phase 4C — `TranscriptWorkbench` + `transcribe()`
(whisper.cpp), avec le modèle déjà installé. L'extraction de la bande son est
faite par FFmpeg, comme pour un fichier audio.

Le seul ajout propre à la vidéo est le panneau d'incrustation, qui tourne dans
un job **distinct** (`<outil>:burn`) pour ne pas chasser la transcription du
gestionnaire de travaux.

## Jobs : survivre à la navigation

Un réencodage se compte en minutes. Il ne peut donc pas appartenir au composant
React qui l'a lancé.

`src/features/jobs/background.ts` porte le contrôleur générique (progression,
annulation réelle, résultat conservé hors du store). `speech.ts` et `media.ts`
n'en sont que le vocabulaire : la parole et la vidéo partagent le même
mécanisme, déjà éprouvé en phase 4C.

- progression réelle via `media://progress` (FFmpeg `-progress pipe:1`) ;
- annulation → `media_cancel` → le processus enfant est **tué** ;
- aucun résultat partiel : `runMedia` ne renvoie qu'après un succès ;
- notification de fin, et reconnexion de l'interface en revenant sur l'outil.

## Fichiers temporaires

Chaque exécution prépare ses entrées (`media_stage`), réserve sa sortie
(`media_temp`), puis nettoie **dans tous les cas** — succès, erreur, annulation
— dans le `finally` de `runMedia`. Trois sortes d'entrées coexistent :

| Source | Mécanisme |
| --- | --- |
| Fichiers de l'utilisateur | `files` |
| Contenu produit par l'application (SRT généré…) | `extraInputs` |
| Fichier dérivé des chemins préparés (liste `concat`) | `operation.stageText` |

Le fichier d'origine de l'utilisateur n'est **jamais** modifié ni supprimé.

## Erreurs

`src/core/media/errors.ts` reformule les échecs FFmpeg fréquents : fichier
illisible, codec absent, conteneur incompatible, piste inexistante, disque
plein, accès refusé, annulation. Un message non reconnu est **conservé tel
quel** — mieux vaut une phrase obscure qu'une explication fausse. Le détail
technique reste accessible derrière « Détail technique ».

## Ossature d'interface

| Brique | Rôle |
| --- | --- |
| `VideoToolShell` | Dépôt, ffprobe (mis en cache par fichier), capacités, job global, erreurs, résultat |
| `VideoPreview` | Lecteur natif + position courante + calque libre |
| `CropOverlay` | Sélection rectangulaire en fractions, rapport contraint en pixels |
| `VideoInfoList` | Carte d'identité des fichiers, réordonnancement par glisser-déposer |
| `shared.ts` | Conteneur par défaut, recopie ou réencodage de l'audio, bilan de taille |

Volontairement **pas** un logiciel de montage : FourTout reste une suite
d'outils simples.

## Tests

- `src/core/media/video.test.ts` — constructeurs purs **et** exécution réelle de
  chaque opération sur une petite mire, résultat relu par ffprobe (dimensions,
  durée, pistes).
- `src/core/media/pipeline.test.ts` — cycle complet avec un pont natif simulé :
  préparation, liste de concaténation, nettoyage après succès, après erreur et
  après annulation.
- `src/core/media/capabilities.test.ts` — les deux builds réels (complet et
  Fedora).
- `src/core/media/video/dimensions.test.ts`, `presets.test.ts`,
  `src/core/media/errors.test.ts` — logique pure.
- `src/features/jobs/mediaJobs.test.ts` — survie à la navigation, annulation,
  cohabitation avec les jobs de parole.
- `src/tools/impl/video/videoCatalog.test.ts` — catalogue ↔ implémentations ↔
  validation des fichiers déposés.
