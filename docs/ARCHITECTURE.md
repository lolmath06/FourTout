# Architecture de FourTout

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
│   ├── text/              Socle texte : fonctions pures, sans React ni backend
│   ├── convert/           Graphe de conversion dérivé du registre
│   ├── hash/              Empreintes calculées dans la WebView (texte)
│   ├── jobs/              Traitements longs : progression, erreur, annulation
│   └── platform/          Détection Tauri / navigateur / OS
├── features/              État applicatif
│   ├── favorites/         Favoris persistants
│   ├── recents/           Historique d'ouverture (12 entrées)
│   ├── notifications/     Toasts : succès, erreur, avertissement, en cours
│   ├── handoff/           Passage de relais entre outils (fichier + préréglage)
│   └── settings/          Thème, rappels de confidentialité
├── components/            Composants réutilisables (ui/, tools/, files/)
├── layouts/AppShell.tsx   Barre latérale, en-tête, recherche globale
├── pages/                 Une page par route
├── tools/                 Les outils réellement implémentés
│   ├── implementations.ts Table id → composant (chargement paresseux)
│   ├── impl/              Composants d'outil
│   └── logic/             Logique pure, testable sans DOM
└── app/                   Routes et racine de l'application
src-tauri/                 Application native (Rust)
├── src/media/             Socle FFmpeg : exécution, progression, annulation
├── src/speech/            Synthèse (Piper) et transcription (whisper.cpp)
├── src/recovery/          Récupération de mot de passe PDF
└── src/files/             Archives, empreintes, doublons, découpage, renommage
```

## Le registre : une seule source de vérité

Un outil est décrit **une fois**, dans `src/core/tools/catalog/`. Cette
définition alimente :

- l'affichage dans les catégories et la page Outils ;
- la recherche (nom, alias, mots-clés, catégorie, description) ;
- les favoris et les récents (qui ne stockent que des identifiants) ;
- la route `/tools/t/:id` ;
- la disponibilité (`status`) ;
- les contraintes de fichiers de la zone de dépôt (`acceptedInputs`) ;
- le futur convertisseur universel (`acceptedInputs` / `outputs`) ;
- le futur assistant local (mots-clés, alias, capacités).

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
`report()`, un `AbortSignal` et `throwIfCancelled()`. Rien n'est encore branché
dessus, mais le contrat est fixé pour que compression vidéo, OCR, transcription
et TTS ne réinventent pas chacun leur mécanique.

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

## Confidentialité

- `PrivacyNote` affiche « Traitement local — vos fichiers restent sur votre
  appareil » sur les pages d'outil (désactivable dans les Paramètres).
- La capacité `network` marque explicitement le seul outil qui aura besoin
  d'Internet (taux de change). Un test vérifie que c'est bien le seul.
- La CSP de `tauri.conf.json` interdit toute connexion sortante non prévue.

## Ce qui reste à faire pour les phases suivantes

- Brancher les traitements natifs (ffmpeg, OCR, chiffrement) côté Rust et les
  exposer via `invoke`, en s'appuyant sur `useJob` pour la progression.
- Remplacer `LocalStorageStore` par un store fichier Tauri si l'on veut que
  favoris et récents survivent à un nettoyage de la WebView.
- Implémenter les outils du catalogue, un par un (voir `ADDING-A-TOOL.md`).
- Brancher le convertisseur universel sur `acceptedInputs` / `outputs`.
- Brancher l'assistant local via `registerIntentResolver`.
