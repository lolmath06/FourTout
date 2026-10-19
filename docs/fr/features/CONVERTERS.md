# Convertisseur universel

[English](../../features/CONVERTERS.md) | [Français](CONVERTERS.md)

[← Documentation](../README.md)

Le convertisseur universel est un **aiguilleur**. Il ne convertit rien
lui-même.

## Le problème qu'il résout

L'utilisateur a un fichier et une intention (« je veux en faire un PDF »), mais
il ne sait pas dans quelle catégorie chercher. Le convertisseur universel prend
le fichier, identifie son format, et propose ce qui est réellement possible.

## Ce qu'il ne fait surtout pas

Il ne réimplémente ni la conversion d'images, ni FFmpeg, ni PDF, ni la synthèse
vocale. Dupliquer ces moteurs garantirait deux comportements divergents pour la
même conversion : celui de l'outil dédié, et celui du convertisseur. Il n'y a
donc qu'un seul chemin de code par conversion.

## Le graphe est dérivé, pas écrit

`src/core/convert/graph.ts` construit les arêtes à partir du **registre**.
Aucune table de conversion n'est maintenue à la main.

Une arête `from → to` existe si et seulement si un outil :

1. a le statut `available` (donc il est réellement branché — un test le vérifie
   contre `TOOL_IMPLEMENTATIONS`) ;
2. appartient à la catégorie « Convertisseurs », en propre ou via `alsoIn` ;
3. accepte `from` dans l'une de ses `acceptedInputs` ;
4. produit `to` dans l'une de ses `outputs` (`kind` ≠ `none`, extension ≠ `*`) ;
5. et `from` ≠ `to`.

Conséquences directes, et c'est tout l'intérêt :

- rendre un outil disponible suffit à l'exposer dans le convertisseur ;
- une arête n'existe que si l'outil qui la porte est au catalogue, et donc
  implémenté — le graphe ne peut pas proposer une conversion inexécutable ;
- retirer un outil retire ses conversions, sans autre modification.

Quand deux outils produisent le même format cible, le premier du catalogue
gagne — l'ordre y place les outils unitaires avant les traitements par lot.

## Exemples de couverture

| Entrée | Sorties proposées |
| --- | --- |
| PNG | JPEG, WebP, BMP, TIFF… et PDF |
| MP4 | WebM, MKV, MOV, AVI, GIF, MP3/WAV/FLAC…, PNG/JPG (image fixe) |
| PDF | PNG, JPG, TXT, MD, et audio (synthèse vocale) |
| TXT | PDF, HTML, MD, audio |
| DOCX | TXT, MD, HTML |
| MP3 | WAV, FLAC, OGG, Opus, M4A, AAC |

Ces correspondances sont verrouillées par `src/core/convert/graph.test.ts`.

## Le relais vers l'outil spécialisé

Cliquer sur un format n'ouvre pas une interface de conversion dupliquée : cela
**ouvre l'outil spécialisé**, avec le fichier déjà chargé et le format déjà
sélectionné. Les réglages fins (qualité, codec, résolution) restent disponibles
là où ils ont un sens.

Le mécanisme est générique : `src/features/handoff/store.ts`.

```
setHandoff({ toolId, files, preset }) → navigate(toolRoute(toolId))
                                      → useHandoff(toolId) dans l'outil
```

Le relais vit **hors de React** (module singleton) : il survit à la navigation,
et il est consommé **une seule fois**. Revenir sur l'outil plus tard ne
recharge pas un fichier oublié là.

| Point de consommation | Ce qu'il reprend |
| --- | --- |
| `PdfToolShell`, `ImageToolShell`, `MediaToolShell`, `VideoToolShell` | Le fichier déposé |
| `ImageConvertTool` | `format` → PNG / JPEG / WebP |
| `AudioConvertTool` | `format` → l'un des formats audio |
| `VideoConvertTool` | `format` → conteneur, en mode personnalisé |
| `TextCompareTool` | `left` / `right` (depuis « Comparer deux fichiers ») |

Un outil qui ne lit pas le relais s'ouvre simplement vide : le mécanisme est
facultatif, jamais bloquant.

## Détection du format

Dans l'application installée, le convertisseur demande au moteur natif ce que
le fichier **est vraiment** (`files_identify` / `files_identify_path`, adossés à
`src-tauri/src/files/magic.rs`). La détection lit les 36 premiers Kio,
indépendamment du nom du fichier, et reconnaît notamment :

- WebP animé (bit d'animation VP8X) et APNG (`acTL` avant le premier `IDAT`), à
  distinguer du WebP et du PNG fixes ;
- WebM contre Matroska (le `DocType` EBML) ;
- AVIF, HEIC, HEIF et séquences HEIF, MOV et M4A (marques ISOBMFF) ;
- les images ISO 9660 (`CD001` au décalage 32769).

Hors de l'application (dans un navigateur), seule l'extension est disponible, et
le convertisseur le dit : l'identité repose alors sur l'extension, sans règles de
contenu.

## Planifier d'après les faits, pas d'après les extensions

`src/core/convert/actions.ts` construit la liste des actions d'un fichier à
partir de trois sources, dont aucune n'est une table écrite à la main :

1. **le graphe du registre** décrit plus haut, pour les formats ordinaires ;
2. **des règles de contenu**, là où l'extension ne suffit pas. Une image animée
   va vers *Convertir une image animée*, jamais vers un outil d'image fixe qui
   n'en garderait que la première image. Un ISO est orienté vers les outils ISO,
   pas vers une conversion. Une vidéo sans piste son ne se voit pas proposer
   l'extraction du son ; une sans piste vidéo ne se voit proposer que des
   conversions audio ;
3. **les capacités vérifiées** de la machine : FFmpeg présent, encodeur WebP
   animé, AVIF décodable (prouvé en décodant un échantillon embarqué), HEIC
   décodable (décodeur natif). Une conversion que cette machine ne saurait pas
   exécuter n'est pas annoncée.

Quand le nom et le contenu divergent (un `photo.jpg` qui est un PNG), le contenu
l'emporte et une remarque le signale. Des remarques expliquent aussi les
conversions absentes : pas de FFmpeg, pas de piste vidéo, AVIF ou HEIC
indisponible, séquence HEIF.

Les pistes viennent de `media_probe_path` (ffprobe), limité aux fichiers média.
Quand un outil en a besoin, le moteur natif lit le fichier depuis son chemin :
les gros fichiers ne sont pas chargés dans l'interface.

## Nouveaux formats

WebP (fixe et animé), WebM, AVIF, HEIC, HEIF et APNG sont des formats de plein
droit du registre. HEIC est décodé par un décodeur en Rust pur, donc identique
sur Fedora et Windows ; AVIF dépend du FFmpeg de la machine et n'est annoncé que
si un vrai décodage réussit. Voir [Images](IMAGES.md) et [Vidéo](VIDEO.md).

## Limite assumée

Le convertisseur ne chaîne pas les conversions. `DOCX → HTML → PDF` n'est pas
proposé comme une conversion en un clic : les conversions en chaîne accumulent
les pertes sans que l'utilisateur voie l'étape intermédiaire. Les deux étapes
restent disponibles séparément, et le résultat de la première est visible avant
d'engager la seconde.
