# Convertisseur universel

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

Le convertisseur s'appuie sur l'extension et le type MIME du fichier déposé.
Pour aller plus loin — savoir ce qu'un fichier **est** réellement, par-delà son
nom — l'outil « Informations sur un fichier » lit la signature des premiers
octets et signale les incohérences (`photo.jpg` qui commence par `%PDF-`).

## Limite assumée

Le convertisseur ne chaîne pas les conversions. `DOCX → HTML → PDF` n'est pas
proposé comme une conversion en un clic : les conversions en chaîne accumulent
les pertes sans que l'utilisateur voie l'étape intermédiaire. Les deux étapes
restent disponibles séparément, et le résultat de la première est visible avant
d'engager la seconde.
