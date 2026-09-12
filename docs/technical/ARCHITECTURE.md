# Architecture de FourTout

[← Documentation](../README.md)

## Sommaire

- [Choix techniques](#choix-techniques)
- [Structure](#structure)
- [Le registre : une seule source de vérité](#le-registre--une-seule-source-de-vérité)
- [Recherche et intention](#recherche-et-intention)
- [Traitements longs](#traitements-longs)
- [Erreurs et retours utilisateur](#erreurs-et-retours-utilisateur)
- [Fichiers](#fichiers)
- [Confidentialité](#confidentialité)
- [Échelle de l'interface](#échelle-de-linterface)
- [Ce qui reste ouvert](#ce-qui-reste-ouvert)

---

## Choix techniques

| Choix | Pourquoi |
| --- | --- |
| **Tauri 2** | Application native légère, backend Rust pour les traitements qui l'exigent (ffmpeg, OCR, disque), installeurs Windows et Linux. |
| **React 19 + TypeScript + Vite 7** | Interface typée, démarrage instantané, découpage en chunks par outil. |
| **React Router (HashRouter)** | Le routage par fragment fonctionne sans serveur de réécriture, donc identique en développement et en application empaquetée. |
| **Zustand** | État partagé (favoris, récents, notifications, réglages) sans contexte imbriqué ni boilerplate. |
| **Tailwind CSS 4** | Interface dense et cohérente ; toutes les couleurs passent par des variables CSS (`--ft-*`), une seule définition par rôle. |
| **Vitest + Testing Library** | Mêmes transformations que Vite, tests d'intégration réels sur le routeur. |
| **localStorage derrière une interface** | Persistance simple aujourd'hui, remplaçable par un store fichier Tauri sans toucher aux fonctionnalités. |

## Structure

```
src/
├── core/                  Cœur métier, sans dépendance à React quand c'est possible
│   ├── tools/             LE registre : types, catégories, catalogue, recherche
│   │   ├── types.ts       ToolDefinition, CategoryDefinition, routes canoniques
│   │   ├── categories.ts  Source de vérité des catégories
│   │   ├── catalog/       Le catalogue, un fichier par catégorie
│   │   ├── registry.ts    ToolRegistry : accès, filtres, cohérence
│   │   └── search.ts      Recherche déterministe (mots-clés + langage courant)
│   ├── intent/            resolveToolIntent() et le point d'extension LLM
│   ├── storage/           KeyValueStore (localStorage / mémoire)
│   ├── files/             Fichiers déposés, chemins, client du socle natif
│   ├── pdf/               Lecture, rendu, écriture et opérations PDF
│   ├── image/             Traitement d'images dans la WebView
│   ├── media/             Pilotage FFmpeg côté interface, capacités réelles
│   ├── ocr/               Reconnaissance de texte (tesseract.js)
│   ├── speech/            Synthèse et transcription, gestionnaire de modèles
│   ├── text/              Socle texte : fonctions pures, sans React ni backend
│   ├── code/              Outils développeur : JSON, XML, YAML, SQL, JWT, regex, cron, web
│   ├── calc/              Calculatrice, pourcentages, dates, durées, âge
│   ├── units/             Moteur d'unités partagé par les dix convertisseurs
│   ├── security/          Génération et évaluation de mots de passe
│   ├── currency/          Taux de change : cache, conversion, datation
│   ├── convert/           Graphe de conversion dérivé du registre
│   ├── hash/              Empreintes calculées dans la WebView (texte)
│   ├── jobs/              Traitements longs : progression, erreur, annulation
│   ├── ui/                Échelle de l'interface (zoom)
│   └── platform/          Détection Tauri / navigateur / OS
├── features/              État applicatif
│   ├── favorites/         Favoris persistants
│   ├── recents/           Historique d'ouverture (12 entrées)
│   ├── notifications/     Toasts : succès, erreur, avertissement, en cours
│   ├── handoff/           Passage de relais entre outils (fichier + préréglage)
│   ├── jobs/              Travaux de fond, barre de progression globale
│   └── settings/          Thème, échelle, densité, animations, confidentialité
├── components/            Composants réutilisables (ui/, tools/, files/)
├── layouts/AppShell.tsx   Barre latérale de navigation et zone de contenu
├── pages/                 Une page par route
├── tools/                 Les outils réellement implémentés
│   ├── implementations.ts Table id → composant (chargement paresseux)
│   ├── impl/              Composants d'outil
│   └── logic/             Logique pure, testable sans DOM
└── app/                   Routes et racine de l'application
src-tauri/                 Application native (Rust)
├── src/media/             Socle FFmpeg : exécution, progression, annulation
├── src/speech/            Synthèse (Piper) et transcription (whisper.cpp)
├── src/models/            Téléchargement vérifié et installation des modèles
├── src/recovery/          Récupération de mot de passe PDF
├── src/rates.rs           Taux BCE — la seule sortie réseau de l'application
└── src/files/             Archives, empreintes, doublons, découpage, renommage,
                           chiffrement, effacement, organisation de dossier,
                           comparaison et synchronisation de dossiers, recherche,
                           sauvegarde, manifestes, hexadécimal, signatures
```

## Le registre : une seule source de vérité

Un outil est décrit **une fois**, dans `src/core/tools/catalog/`. Cette
définition alimente :

- l'affichage dans les catégories et la page Outils ;
- la recherche (nom, alias, mots-clés, catégorie, description) ;
- les favoris et les récents (qui ne stockent que des identifiants) ;
- la route `/tools/t/:id` ;
- les contraintes de fichiers de la zone de dépôt (`acceptedInputs`) ;
- le convertisseur universel, qui dérive ses arêtes des `acceptedInputs` et
  `outputs` déclarés ;
- le futur assistant local (mots-clés, alias, capacités).

**Figurer au catalogue, c'est fonctionner.** Le modèle ne porte plus d'état de
disponibilité : il en avait un tant que des cartes existaient sans
implémentation, ce qui n'est plus le cas. Un outil incomplet n'est simplement
pas enregistré, et un test garde le catalogue et la table des implémentations
exactement alignés.

Un outil peut apparaître dans plusieurs catégories via `alsoIn`, **sans être
dupliqué** : une seule définition, plusieurs points d'entrée. Le registre
refuse au démarrage un identifiant en double ou une catégorie inconnue, et des
tests le vérifient.

## Recherche et intention

```
requête utilisateur
      ↓
resolveToolIntent()          ← src/core/intent
      ↓
IntentResolver (chaîne)      ← déterministe aujourd'hui, LLM local demain
      ↓
ToolRegistry                 ← AUTORITÉ : seul lui dit ce qui existe
      ↓
outil → navigation
```

La recherche déterministe (`core/tools/search.ts`) mêle :

- correspondance mot à mot pondérée par champ (nom > alias > mots-clés > … ) ;
- bonus si la requête complète apparaît telle quelle ;
- bonus/malus **directionnel** : « gif en vidéo » ≠ « vidéo en gif » ;
- un seuil de couverture : si trop peu de mots de la requête sont retrouvés,
  aucun résultat n'est renvoyé plutôt qu'un résultat approximatif.

Quand l'assistant local arrivera, il suffira de :

```ts
registerIntentResolver(new LocalLLMIntentResolver(...));
```

Le LLM pourra interpréter une formulation, mais ne pourra désigner que des
outils du registre : les candidats sont revalidés par `ToolRegistry` avant
d'être affichés, et le résolveur déterministe reste le repli.

## Traitements longs

`useJob()` (`core/jobs`) donne à chaque futur outil : `status`, `progress`,
`result`, `error`, `cancel()`. Le traitement reçoit un `JobContext` avec
`report()`, un `AbortSignal` et `throwIfCancelled()`. Compression vidéo, OCR,
transcription, synthèse, empreintes, chiffrement et récupération de mot de
passe passent tous par ce contrat : une seule mécanique de progression et
d'annulation, et une barre de tâches globale qui survit au changement de page.

Une annulation est une vraie annulation : le processus natif est arrêté, les
fichiers temporaires sont supprimés, et **aucun résultat partiel n'est
présenté comme un résultat**. Voir [JOBS.md](JOBS.md).

## Erreurs et retours utilisateur

Aucun `alert()`. Tout passe par `notify.success/error/warning/info/loading`
(`features/notifications`), affiché par `ToastViewport`. Un traitement long
utilise `notify.loading()` puis `notify.update(id, …)`.

## Fichiers

`FileDropZone` (`components/files`) est la zone de dépôt générique :
glisser-déposer, explorateur, validation selon les `acceptedInputs` de l'outil,
affichage nom/taille/type, multi-fichiers quand l'outil est `batch`. Les futurs
outils l'utilisent avec `constraintsForTool(tool)` et n'écrivent aucune
validation eux-mêmes.

Les outils qui travaillent sur des **chemins** — archives, dossiers,
empreintes, sauvegarde — n'utilisent pas `FileDropZone` : ils passent par
`PathPicker` (boîtes de dialogue natives et glisser-déposer Tauri, qui fournit
de vrais chemins) et par l'une des deux ossatures d'exécution :

- `NativeToolShell` pour le cas courant — une sélection, un bouton, un
  résultat ;
- `useNativeAction` + `RunBar` quand l'outil compose lui-même sa mise en page,
  parce qu'il a deux sélections (comparer, synchroniser) ou deux étapes (plan
  puis exécution). Même mécanique — progression réelle, annulation réelle,
  erreur lisible — sans mise en page imposée.

### Où vit un algorithme

La règle qui décide de TypeScript ou de Rust n'est pas une préférence, c'est
une conséquence :

| En TypeScript | En Rust |
| --- | --- |
| Modèles de données, types partagés | Parcours du système de fichiers |
| Mise en forme, libellés, unités | Lecture et écriture de gros fichiers |
| Orchestration d'un outil, état de l'écran | Empreintes et copies en flux |
| Logique pure et testable sans disque | Validation des chemins d'archive |
| | Lecture partielle (fenêtres hexadécimales) |

Corollaire pratique : chaque capacité de la phase 9 est une **fonction**
appelable sans React (`compareFolders`, `buildSyncPlan`, `executeSyncPlan`,
`searchFiles`, `createBackup`, `verifyManifest`, `testArchive`…). Un appelant
automatisé futur n'aura donc jamais à simuler des clics — il appellera
exactement ce que l'interface appelle.

## Confidentialité

- `PrivacyNote` affiche « Traitement local — vos fichiers restent sur votre
  appareil » sur les pages d'outil (désactivable dans les Paramètres).
- La capacité `network` marque explicitement le seul outil qui a besoin
  d'Internet (taux de change). Un test vérifie que c'est bien le seul.
- La CSP de `tauri.conf.json` interdit toute connexion sortante non prévue.

## Échelle de l'interface

`core/ui/zoom.ts` applique l'échelle en demandant à la **WebView elle-même** de
zoomer (`setZoom`) : la page est remise en page, le texte reste net, et les
coordonnées de pointeur restent justes — ce qui compte pour le rognage
d'image, le rognage vidéo, l'éditeur PDF et la réorganisation des pages.

`transform: scale()` est proscrit : il floute le texte, décale les
coordonnées et laisse le viewport à sa taille d'origine. Hors application
(navigateur, tests), le repli est la propriété CSS `zoom`, qui remet aussi en
page.

Densité et animations se règlent par jetons CSS, commutés par un attribut sur
la racine du document — pas par un second système de classes.

## Ce qui reste ouvert

- Remplacer `LocalStorageStore` par un store fichier Tauri, pour que favoris et
  récents survivent à un nettoyage de la WebView.
- Brancher l'assistant local via `registerIntentResolver` : le résolveur
  déterministe reste alors le repli, et le registre reste l'autorité sur ce qui
  existe.

Le reste du chantier ouvert est dans [ROADMAP.md](../../ROADMAP.md).
