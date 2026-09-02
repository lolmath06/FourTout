# Traitements longs et jobs globaux

Un traitement long (récupération de mot de passe aujourd'hui ; transcodage,
OCR, transcription demain) ne doit **pas** appartenir au cycle de vie du
composant React qui l'a lancé. Quitter la page de l'outil ne doit ni l'arrêter
ni en perdre la trace. Cette phase (2D) met en place l'infrastructure qui le
garantit.

## Deux mécaniques distinctes

| | `core/jobs` (`useJob`) | `features/jobs` (store global) |
| --- | --- | --- |
| Portée | locale au composant | **globale**, hors React |
| Usage | opérations PDF *synchrones* et courtes (fusion, compression…) qui vivent le temps de l'écran | traitements *natifs longs* qui doivent survivre à la navigation |
| Annulation | `AbortController` du composant | drapeau natif via le contrôleur |

`useJob` reste le contrat des opérations courtes exécutées par `PdfToolShell`.
Le **gestionnaire global** est nouveau et cible les traitements natifs.

## Le gestionnaire global — `src/features/jobs/`

- `store.ts` — un store Zustand qui est la **source de vérité** des jobs :
  `id`, `toolId`, `kind`, `title`, `status` (`running` | `cancelling` | `done`
  | `error`), `progress`, `total`, `result`, `error`, `startedAt`/`endedAt`,
  `cancellable`. Il ne garde que l'état **affichable** (rien de lourd ni de non
  sérialisable).
- `recovery.ts` — le **contrôleur** de la récupération : il possède la session
  native (abonnement aux événements Tauri) hors de tout composant, met à jour le
  store à chaque progression et à la fin, et conserve à côté ce qui ne doit pas
  entrer dans le store (octets du document, session). Injectable pour les tests
  (`__setRecoveryStarter`).
- `hooks.ts` — `useToolJob(toolId)` (reconnexion d'un écran à son job) et
  `useActiveJobs()` (indicateur global).

### Navigation interne

La page de l'outil **s'abonne** au job (`useToolJob`) au lieu de le posséder.
Elle ne l'annule plus au démontage. Quitter puis revenir sur l'outil retrouve le
job en cours (compteur, débit, temps, ETA, bouton Arrêter) ou son résultat, sans
rien relancer. Un job trouvé « pendant l'absence » affiche son résultat au
retour.

### Indicateur global

`AppShell` affiche « N opération(s) en cours » (barre latérale, y compris
repliée) tant qu'un job est actif. Un clic renvoie vers l'outil concerné.

### Un seul job de récupération à la fois

Le moteur natif n'exécute qu'une recherche à la fois (un fil dédié). Le
contrôleur le reflète : démarrer une seconde recherche pendant qu'une tourne est
refusé avec un message clair. Un job terminé est remplacé par la relance (un
seul job par outil, pas de doublon fantôme).

## Rechargement / fermeture — stratégie retenue

On distingue **navigation interne** (SPA) et **vrai rechargement / fermeture**
de la fenêtre :

- **Navigation interne** : le job continue et reste visible (voir ci-dessus).
  React Router ne déclenche pas `beforeunload`.
- **Vrai rechargement / fermeture** : `installRecoveryShutdownGuard()`
  (`main.tsx`) écoute `beforeunload` et **arrête** les recherches natives encore
  vivantes. On évite ainsi le cas interdit : un gros calcul Rust invisible dont
  le frontend a totalement perdu la trace.

L'arrêt est fiable et rapide parce que le moteur consulte le drapeau
d'annulation **au sein** de chaque lot (voir plus bas) : le fil natif sort en
quelques millisecondes.

## Correctif de l'annulation (moteur natif)

`src-tauri/src/recovery/engine.rs`. Auparavant, le drapeau d'annulation n'était
consulté qu'**entre** deux lots. Un lot vaut 60 000 candidats ; en AES-256
(~20 000 essais/s, volontairement lent), un lot dure ~3 s : cliquer « Arrêter »
ne réagissait qu'après ce délai — l'utilisateur voyait la recherche « ne pas
s'arrêter ».

Correctif : le drapeau est désormais consulté **à l'intérieur** de la
vérification parallèle du lot (`par_iter().find_any(|c| should_cancel() ||
verify(c))`). Dès l'annulation demandée, `find_any` court-circuite au prochain
candidat de chaque fil ; on re-vérifie le candidat renvoyé pour distinguer une
vraie trouvaille d'un court-circuit d'annulation. L'arrêt devient indépendant de
la taille du lot — de l'ordre de la milliseconde en release. Le compteur cesse
d'augmenter, le CPU retombe, aucun fil ni verrou zombie, et une nouvelle
recherche peut démarrer aussitôt. Aucune notification tardive « mot de passe
trouvé » ne peut suivre une annulation, la recherche ne renvoyant qu'une seule
issue.

Tests : `recovery::engine` couvre l'annulation en cours de lot, l'annulation via
un drapeau partagé depuis un autre fil (avec relance fonctionnelle ensuite) et la
course « démarrage → annulation immédiate ». Côté TS, `features/jobs/*.test.ts`
couvre la création, la progression, la reconnexion, la fin, le résultat,
l'erreur, l'annulation immédiate et la relance.
