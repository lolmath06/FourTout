# Diagnostic et récupération

[← Documentation](../README.md)

## Sommaire

- [Trois règles](#trois-règles)
- [Trois mots qui ne sont pas synonymes](#trois-mots-qui-ne-sont-pas-synonymes)
- [Diagnostic universel — `src-tauri/src/diagnostics/generic.rs`](#diagnostic-universel--src-taurisrcdiagnosticsgenericrs)
- [ZIP — `src-tauri/src/diagnostics/zip.rs`](#zip--src-taurisrcdiagnosticsziprs)
- [PDF — `src-tauri/src/diagnostics/pdf.rs`](#pdf--src-taurisrcdiagnosticspdfrs)
- [Images — `src-tauri/src/diagnostics/image.rs`](#images--src-taurisrcdiagnosticsimagers)
- [Ce que l'interface impose](#ce-que-linterface-impose)
- [Fixtures et preuves](#fixtures-et-preuves)
- [Ce qui n'est pas fait, et ne le sera pas ici](#ce-qui-nest-pas-fait-et-ne-le-sera-pas-ici)

---

Quatre outils : `file-diagnose`, `archive-repair`, `pdf-repair`, `image-repair`.
Moteurs dans `src-tauri/src/diagnostics/`, client dans
`src/core/diagnostics/native.ts`, interfaces dans `src/tools/impl/diagnostics/`.

---

## Trois règles

**1. La source n'est jamais modifiée.** Une réparation lit un fichier et en
écrit un autre. Il n'existe pas une seule écriture en place dans ce module, et
le chemin de sortie est calculé pour ne jamais écraser un fichier existant —
`photo-recuperee.png`, puis `photo-recuperee-2.png` si le premier est déjà là.

Ce n'est pas une intention : `sources_are_never_modified`, dans
`src-tauri/tests/phase12.rs`, hache vingt-et-une fixtures, lance **toutes** les
opérations disponibles sur chacune, et rehache. Une seule empreinte qui bougerait
ferait échouer la suite.

**2. Rien n'est inventé.** On ne fabrique pas les octets manquants, on ne
recalcule pas une somme de contrôle pour faire passer des données abîmées pour
intactes, et on ne déclare pas un fichier sain au seul motif qu'un lecteur
tolérant accepte de l'ouvrir.

**3. Chaque réparation est justifiable octet par octet.** Si FourTout ne peut
pas énoncer précisément ce qu'il change et pourquoi, il ne propose pas de bouton.
Un écran qui se contente d'expliquer pourquoi un fichier est irrécupérable vaut
mieux qu'une réparation qui produit silencieusement quelque chose de douteux.

---

## Trois mots qui ne sont pas synonymes

C'est le vocabulaire de toute la phase, et l'interface ne les emploie jamais
l'un pour l'autre (`Repairability`, dans `diagnostics/mod.rs`) :

| Terme | Ce que cela veut dire |
| --- | --- |
| `safeRepair` — **réparation sans perte** | Le contenu est intégralement conservé ; seule une anomalie de structure est corrigée. |
| `recoverPartial` — **récupération partielle** | Une part du contenu est extraite ; le reste est perdu, et compté. |
| `recoverVisual` — **récupération visuelle** | Les pixels décodés sont réencodés. L'image est sauvée, le fichier ne l'est pas. |
| `none` | Aucune correction automatique défendable. |

« 18 fichiers sur 21 ont pu être récupérés » n'est jamais écrit « réparation
réussie ».

La gravité suit la même discipline : une extension trompeuse est un
**avertissement**, pas une erreur — le fichier n'est pas abîmé, son nom ment.
Une archive tronquée est une **erreur**. Tout n'est pas rouge.

---

## Diagnostic universel — `src-tauri/src/diagnostics/generic.rs`

Trois questions, valables pour n'importe quel fichier :

1. **Qu'est-ce que c'est ?** La signature décide, jamais l'extension. La table
   de signatures est celle de la phase 9 (`files/magic.rs`), réutilisée telle
   quelle.
2. **Le nom dit-il la vérité ?** Un PNG nommé `.jpg` s'ouvre partout, jusqu'au
   jour où un programme fait confiance au nom. La correction proposée est une
   **copie** renommée, jamais un renommage de l'original.
3. **Le fichier est-il entier ?** PNG, JPEG, PDF et GIF portent une marque de
   fin. Son absence, ou des octets après elle, se constatent sans analyser quoi
   que ce soit.

Au-delà, le diagnostic passe la main aux modules spécialisés. FourTout connaît
**quatre formats en profondeur** — ZIP, PDF, PNG, JPEG — et le dit franchement
pour les autres plutôt que d'afficher un vernis d'analyse.

---

## ZIP — `src-tauri/src/diagnostics/zip.rs`

Une archive ZIP se lit **par la fin** : le répertoire central, placé en queue,
dit où trouver chaque entrée. C'est le point faible du format. Si ces quelques
kilo-octets sont abîmés, tous les lecteurs déclarent l'archive illisible — alors
que la totalité des données peut être intacte quelques octets plus haut.

Le diagnostic lit donc les **deux** structures séparément et dit laquelle est en
cause :

| Constat | Ce que cela signifie |
| --- | --- |
| `zip.no-eocd` | Aucune fin d'archive. C'est ce qui fait dire « ce n'est pas une archive ». |
| `zip.central-directory-corrupt` | Le répertoire annonce N entrées, il en livre moins. |
| `zip.central-directory-out-of-range` | Le répertoire est annoncé hors du fichier. |
| `zip.truncated` | La dernière entrée déborde de la fin du fichier. |
| `zip.trailing-garbage` | Des octets suivent la fin déclarée. Correction sans perte. |
| `zip.entry-count-mismatch` | Les deux structures ne décrivent pas la même archive. |
| `zip.encrypted` | Au moins une entrée est chiffrée. Sans le mot de passe, rien à en tirer — et FourTout ne le devine pas. |

La **récupération** ignore complètement le répertoire central et balaie le
fichier à la recherche des en-têtes locaux (`PK\x03\x04`), qui précèdent chaque
entrée et portent son nom, sa méthode et ses tailles. Chaque entrée est
décompressée puis vérifiée par sa somme de contrôle CRC-32 avant d'être écrite.

Le décompresseur employé est l'interface bas niveau de `flate2`, pour sa
comptabilité : `total_in` dit exactement combien d'octets compressés ont été
consommés, ce qui permet de traiter les entrées dont l'en-tête ne déclare pas
les tailles (descripteur différé).

Deux sorties possibles : un **dossier** d'extraction, ou une **archive ZIP
neuve** ne contenant que ce qui a été lu et vérifié. Jamais l'archive d'origine.

**Les gardes de la phase 9 s'appliquent telles quelles.** `safe_relative_path`
et `resolve_inside` refusent les remontées `..`, les chemins absolus, les
racines Windows. Une archive cassée n'autorise aucun relâchement — c'est même
exactement le genre de fichier dans lequel on glisse un chemin hostile, et un
test le vérifie sur la fixture piégée de la phase 9.

Ce que la récupération ne fait pas : reconstituer un flux compressé
physiquement tronqué. Quand les octets manquent, l'entrée est déclarée perdue,
avec son motif, et rien n'est écrit pour elle.

---

## PDF — `src-tauri/src/diagnostics/pdf.rs`

Un PDF se lit lui aussi par la fin : `startxref` donne la position d'une table
de références, qui donne la position de chaque objet. Trois choses cassent donc
un PDF bien plus souvent que son contenu, et les trois se corrigent sans y
toucher :

| Constat | Réparation | Ce qui change exactement |
| --- | --- | --- |
| `pdf.trailing-garbage` | `pdf-strip-trailing` | Le document est recopié jusqu'au dernier `%%EOF`. Pas un octet de plus. |
| `pdf.bad-startxref` | `pdf-fix-startxref` | Seuls les **chiffres** suivant `startxref` changent. |
| `pdf.no-startxref`, `pdf.no-eof` | `pdf-rebuild-xref` | Le document est recopié à l'identique, suivi d'une table bâtie sur les objets réellement trouvés. |

La reconstruction de table balaie les en-têtes `N G obj` — ce que fait tout
lecteur PDF quand il répare un document. La dernière définition d'un numéro
d'objet fait foi, comme dans un PDF mis à jour par ajouts successifs, et les
numéros jamais définis sont déclarés libres : c'est ce que prévoit le format,
pas une invention.

**Elle est refusée quand le document range ses objets dans des flux
compressés** (`/ObjStm`). Ces objets ne sont pas visibles au balayage : une
table reconstruite serait incomplète, et FourTout ne peut pas prouver le
contraire. L'écran le dit et ne propose pas le bouton.

### La preuve structurelle, et pourquoi elle est venue après

La première version de ce module se contentait de rouvrir la sortie avec
pdf.js. C'était insuffisant, et un test manuel l'a montré : un document coupé au
milieu de son troisième objet recevait une table de références, et le fichier
produit — 295 octets, en-tête, table, trailer, `%%EOF` — s'ouvrait. pdf.js
émettait bien `invalid /Pages tree /Count: 2`, mais il ouvrait, et annonçait
deux pages dont aucune n'existait.

Les lecteurs PDF sont tolérants par conception : ils ont été écrits pour
afficher quelque chose plutôt que pour refuser un document. Leur acceptation ne
prouve donc rien.

`structural_check` a été ajouté **en plus** de la validation pdf.js, et vérifie
ce que ce module sait démontrer :

| Invariant | Ce qu'il empêche |
| --- | --- |
| Chaque `N G obj` a son `endobj`, avant l'en-tête suivant | Qu'un objet tronqué passe pour complet |
| Le catalogue existe et est complet | Qu'un document sans racine soit reconstruit |
| Le nœud `/Pages` désigné existe et est complet | Qu'un arbre de pages absent soit ignoré |
| Chaque référence de `/Kids` désigne un objet complet | Qu'une page promise n'existe pas |
| `/Count` est **confronté** aux pages réellement complètes | Que le nombre de pages soit cru sur parole |
| Chaque entrée `xref` tombe sur le premier octet d'un objet | Qu'une table pointe à côté |

La vérification a lieu **deux fois** : sur la source, avant d'offrir l'action —
un document non prouvable n'a pas de bouton du tout —, et sur le candidat en
mémoire, **avant qu'il n'atteigne le disque**. Écrire puis effacer laisserait,
entre les deux, un fichier qu'un autre programme pourrait ouvrir ; et un échec
d'effacement laisserait une fausse réparation derrière lui.

Ce n'est pas un validateur PDF général, et cela ne le deviendra pas : c'est la
vérification étroite du sous-ensemble que ce module sait reconstruire. Les
documents plus complexes restent non réparables automatiquement, ce qui est la
bonne réponse.

### La vérification, et pourquoi elle est indispensable

Rust n'a pas d'analyseur PDF ici : il lit une structure, il ne rend pas une
page. Chaque fichier produit est donc **rouvert par pdf.js** —, le moteur qui
affiche réellement les PDF dans FourTout — et ses pages sont comptées
(`verifyPdf`, dans `src/core/diagnostics/native.ts`).

- Si pdf.js l'ouvre : le nombre de pages est affiché, et comparé au nombre
  d'objets page trouvés dans la source. Une différence est signalée comme une
  perte réelle.
- Si pdf.js le refuse : l'écran affiche **« Réparation manquée »**, explique le
  refus, et **supprime le fichier produit**. Vous laisser un fichier en le
  présentant comme réparé serait le théâtre de la réparation.

### Signatures numériques

Un `/ByteRange` ou un `/Adobe.PPKLite` fait apparaître un avertissement
permanent : toute réécriture structurelle déplace des octets et **invalide la
signature**. FourTout ne vérifie pas les signatures et ne prétend pas les
préserver. Le coût figure dans la liste de chaque action sur un document signé.

---

## Images — `src-tauri/src/diagnostics/image.rs`

PNG et JPEG se lisent par le début, ce qui change tout : une image dont la fin
manque garde ses premières lignes.

**PNG** : parcours des blocs, avec vérification du CRC de chacun. La distinction
qui compte est celle entre blocs **essentiels** (majuscule initiale : `IHDR`,
`IDAT`, `IEND`) et **auxiliaires** (minuscule : `tEXt`, `iCCP`, `pHYs`). Un bloc
auxiliaire abîmé ne coûte aucun pixel : l'écarter produit une image saine, et
c'est une réparation **sans perte**. Un bloc essentiel abîmé, lui, signale que
les octets de l'image ont changé.

**JPEG** : parcours des segments, dimensions lues dans le `SOFn`, marqueur de
fin `EOI`. Les données entropiques après `SOS` sont sautées, pas interprétées.

Deux gestes sont explicitement refusés :

- **recalculer un CRC abîmé.** Corriger le CRC d'un `IDAT` ne répare rien : cela
  masque la corruption. Un test le verrouille ;
- **inventer les lignes manquantes** d'une image tronquée. La récupération
  échoue franchement et **n'écrit aucun fichier**.

Et une règle qui découle de la seconde : lorsqu'aucun pixel n'est décodable,
**aucune action n'est proposée**. Le moteur ne le déduit pas des constats — il
tente réellement le nettoyage structurel puis un décodage, et inscrit la réponse
dans `recoverable`. Une première version affichait « Le décodeur ne rend aucun
pixel », puis juste en dessous un bouton « Récupérer les pixels décodables » qui
ne pouvait que finir en erreur. La décision appartient au moteur, pas à
l'affichage : toute interface qui lira ce rapport obtiendra le bon comportement.

La récupération suit deux chemins, et ils ne portent pas le même nom :

| Chemin | Quand | Résultat |
| --- | --- | --- |
| **Sans perte** | PNG dont le nettoyage structurel suffit | Les octets des pixels sont recopiés tels quels. |
| **Visuelle** | JPEG, ou PNG que seul le décodeur peut sauver | Les pixels décodés sont réencodés **en PNG**. |

La sortie est toujours du PNG : réencoder en JPEG ajouterait une seconde
compression destructrice à une image déjà abîmée.

---

## Ce que l'interface impose

L'ossature commune (`src/components/diagnostics/DiagnosticShell.tsx`) impose
l'ordre dans lequel l'utilisateur découvre les choses, et cet ordre est le fond
du sujet :

1. **Ce qui est cassé** — les constats, du plus grave au plus anodin.
2. **Ce qui est intact** — la structure lue, en clair.
3. **Ce que FourTout peut faire** — une action par constat réparable, jamais un
   bouton générique.
4. **Ce que cela coûtera** — la liste des pertes, avant le bouton.
5. **Le bouton.**

Puis, après l'opération : ce qui a été conservé, ce qui a été perdu, où le
fichier a été écrit, et **l'empreinte de la source recalculée**. La promesse
« votre fichier n'a pas été touché » est une vérification affichée, pas une
phrase rassurante.

Quand aucune action n'est défendable, l'écran le dit — et c'est un résultat, pas
un échec.

---

## Fixtures et preuves

Toutes les fixtures descendent d'un fichier **sain**, écrit par un outil
indépendant de FourTout (le ZIP est assemblé octet par octet avec `zlib`, les
PDF à la main, les images par `@napi-rs/canvas`), puis abîmé par une
transformation décrite dans `scripts/generate-phase12-assets.mjs`. Aucun binaire
corrompu opaque n'a été déposé à la main.

`test-assets/generated/CONTRAT.json`, section `phase12`, enregistre pour chacune
le diagnostic attendu, ce qui est récupérable, ce qui ne l'est pas, et les
empreintes des contenus que la récupération doit rendre — calculées à partir du
texte attendu, jamais relevées sur une sortie de FourTout, ce qui ne prouverait
que la constance d'un bogue.

---

## Ce qui n'est pas fait, et ne le sera pas ici

Récupération de partitions, reconstruction de table GPT ou MBR, image disque,
clonage, restauration bare-metal, récupération de système de fichiers
destructive, écriture brute sur un périphérique, média de secours amorçable.

Ces fonctions appartiennent à **PROMĒTHEÚS Rescue**, une suite dédiée. Elles
demandent un environnement différent — souvent hors du système installé —, un
modèle de risque différent, et une confirmation d'un tout autre ordre que celle
d'un utilitaire de bureau. Les mêler à FourTout reviendrait à placer un bouton
capable d'effacer un disque à côté d'un convertisseur d'images.
