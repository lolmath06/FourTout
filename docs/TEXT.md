# Texte et documents

Cette page décrit le socle Texte de FourTout : ce qu'il fait, comment il est
organisé, et ce qu'il ne promet pas.

## Principe : instantané, local, sans backend

Un outil texte n'a pas de raison d'être asynchrone. Tout est calculé dans la
WebView, à la frappe, par des **fonctions pures** rassemblées dans
`src/core/text/`. Aucune commande native, aucun job, aucune progression : si un
traitement texte devenait assez lourd pour en avoir besoin, c'est qu'il devrait
vivre dans les outils Fichiers, sur des chemins et en flux.

```
src/core/text/
├── clean.ts      # nettoyage à options explicites
├── lines.ts      # découpage, fins de ligne, doublons, tri
├── replace.ts    # rechercher/remplacer, regex comprise
├── diff.ts       # comparaison ligne et mot (LCS)
├── markdown.ts   # Markdown → HTML
├── html.ts       # assainissement, HTML → texte, HTML → Markdown
├── url.ts        # percent-encoding
├── unicode.ts    # NFC / NFD / NFKC / NFKD
├── extract.ts    # URL, e-mails, nombres
├── lorem.ts      # faux texte
└── stats.ts      # comptages, durées, lisibilité
```

Ces modules ne connaissent ni React ni le DOM (à l'exception de `html.ts`, qui
a besoin de `DOMParser` — voir plus bas). Ils sont donc testables directement :
`src/core/text/text.test.ts` couvre les 68 cas de la phase 6.

## Une seule ossature d'interface

`src/components/text/TextToolShell.tsx` factorise ce que les quinze outils
texte font tous : zone de saisie, dépôt d'un fichier `.txt`/`.md`, compteur
caractères/mots/lignes, ouverture d'un fichier, exemple, effacement, copie,
téléchargement, et « reprendre le résultat comme entrée ».

Deux dispositions : empilée (nettoyage, tri) ou côte à côte (conversions,
comparaison). Un outil qui a besoin d'un rendu particulier — aperçu Markdown,
tableau de diff — fournit son propre `outputSlot`.

La zone de saisie refuse au-delà de **8 Mo** : une `textarea` n'est pas un
éditeur de gros fichiers, et le dire vaut mieux que de figer l'interface.

## Sécurité du HTML : jamais exécuté, toujours reconstruit

C'est la règle non négociable de cette phase. Le HTML fourni par l'utilisateur
(fichier déposé, collé, ou issu d'un DOCX) n'est **jamais** injecté tel quel.

1. Il est analysé par `DOMParser` (`text/html`), qui ne charge aucune ressource
   et n'exécute aucun script.
2. Il est **reconstruit** à partir d'une liste blanche de balises
   (`ALLOWED_TAGS`) et d'attributs (`ALLOWED_ATTRIBUTES`).
3. `script`, `style`, `iframe`, `object`, `embed`, `form`, les champs de
   saisie, `svg` et `math` sont supprimés **avec leur contenu**.
4. Les attributs `on*` ne figurent dans aucune liste blanche : ils disparaissent.
5. Une balise inconnue est remplacée par son contenu textuel.
6. `href` n'accepte que `http:`, `https:`, `mailto:`, une ancre ou un chemin
   relatif ; `src` d'image n'accepte que `http(s):` ou un `data:image/…`.

Le rendu Markdown suit la même logique en amont : `markdownToHtml` **échappe**
tout HTML brut présent dans le Markdown avant de composer sa propre sortie. Un
`.md` reçu de l'extérieur ne peut donc rien injecter, même avant assainissement
— et l'aperçu passe malgré tout par `sanitizeHtml`, par défense en profondeur.

## Nettoyage : aucune transformation implicite

`cleanText` n'applique que des options cochées. C'est délibéré : un outil qui
« range » de lui-même abîme des données sans qu'on le voie. L'écran affiche
systématiquement le décompte avant/après (caractères, lignes, mots).

Ordre d'application, dans cet ordre exact : normalisation Unicode → caractères
invisibles → typographie → opérations ligne à ligne → fins de ligne.

Deux détails qui comptent :

- les caractères de **largeur nulle** sont supprimés, tandis que les espaces
  insécables et fines sont ramenés à une espace ordinaire (les premiers ne
  séparent rien, les seconds si) ;
- convertir `« mot »` en `"mot"` retire l'espace d'encadrement français, sinon
  le résultat serait `" mot "`.

## Comparaison de deux textes

Plus longue sous-séquence commune (LCS) sur les lignes, après regroupement des
suppressions et des ajouts consécutifs : une paire supprimé/ajouté devient une
**modification**, affinée par un second passage LCS au niveau des mots.

Garde-fou : au-delà de 4 millions de cellules (environ 2 000 × 2 000 lignes),
la comparaison bascule sur un alignement position par position et le signale.
Mieux vaut un diff moins fin qu'un onglet figé.

Sorties : vue côte à côte, vue unifiée, et export `.diff` au format unifié.

## Statistiques : ce sont des estimations, et c'est écrit

- Lecture silencieuse : 200 mots/minute. Lecture à voix haute : 130.
- Syllabes comptées par groupes de voyelles — approximation assumée.
- Lisibilité française : formule de Kandel & Moles (adaptation française de
  Flesch). Lisibilité anglaise : Flesch Reading Ease.

L'interface affiche ces hypothèses sous le tableau. Un indice de lisibilité
donne un ordre de grandeur ; il ne remplace pas une relecture.

## Documents

### TXT, Markdown, HTML

Lus directement par l'interface. Le Markdown et le HTML disposent d'un aperçu
assaini, et de conversions croisées (`markdown-convert`).

### DOCX

Un `.docx` est une archive ZIP de XML. FourTout la lit **côté natif**
(`src-tauri/src/files/docx.rs`) : le ZIP y est déjà disponible, et un fichier
volumineux ne transite pas par la WebView.

Ce qui est extrait : titres (styles `Heading1`…`Titre1`), paragraphes, listes
(`w:numPr`), gras et italique, contenu des tableaux, et les propriétés du
document (`docProps/core.xml`, `docProps/app.xml`).

Ce qui ne l'est pas, et que l'outil annonce à chaque conversion : images,
colonnes, styles de mise en page, en-têtes/pieds de page, pagination.

L'analyseur XML est volontairement maison : les documents Word sont réguliers,
et embarquer une bibliothèque XML complète pour une dizaine de balises ne se
justifie pas. Les paragraphes situés dans un tableau ne sont comptés qu'une
fois, à leur place dans le document.

### DOCX → PDF : `planned`, et voici pourquoi

L'outil `docx-to-pdf` existe au catalogue avec le statut `planned`. La
conversion serait techniquement faisable (DOCX → HTML → `documentToPdf`), mais
elle perdrait les images, les tableaux mis en forme, les colonnes, les polices
du document, les en-têtes/pieds de page et la pagination d'origine.

Autrement dit : le PDF produit ne ressemblerait pas au document ouvert dans
Word, sans que l'utilisateur puisse le prévoir. Reproduire fidèlement une mise
en page Word demande un moteur de rendu complet (LibreOffice), c'est-à-dire une
dépendance externe lourde qui casserait la promesse « tout est embarqué ».

Un outil absent est préférable à un faux convertisseur Word. En attendant :
« Word vers texte, Markdown ou HTML », puis « Document vers PDF » — deux étapes
explicites, dont l'utilisateur voit le résultat intermédiaire.

## Fins de ligne

`text-line-endings` détecte LF, CRLF, CR et les mélanges, affiche le décompte
de chacun, puis convertit. La détection précède toujours la conversion : c'est
elle qui explique les `^M` d'un fichier venu de Windows.

## Ce que la phase 6 ne fait pas

| Sujet | État | Raison |
| --- | --- | --- |
| `docx-to-pdf` | `planned` | Fidélité impossible sans moteur de rendu Word |
| JSON / YAML / XML / SQL | `planned` | Outils développeur, phase suivante |
| Éditeur de texte riche | hors périmètre | FourTout transforme, il n'édite pas |
