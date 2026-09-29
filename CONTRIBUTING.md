# Contribuer à FourTout

Merci de l'intérêt. Cette page dit comment démarrer, ce que le projet attend
d'une contribution, et comment ajouter un outil.

---

## Démarrer

```bash
git clone <url-du-dépôt> FourTout
cd FourTout
pnpm install
pnpm app:dev
```

Prérequis complets (Node, Rust, bibliothèques système) :
[docs/DEVELOPMENT.md](docs/technical/DEVELOPMENT.md).

---

## Avant d'ouvrir une pull request

```bash
pnpm verify                              # lint + typecheck + test + build
cd src-tauri && cargo test && cd ..
```

Tout doit être vert. Si un test s'ignore parce que FFmpeg ou les fixtures
manquent, lancez `pnpm test:assets` et installez FFmpeg — mieux vaut le savoir
avant l'intégration continue.

---

## Branches et commits

```bash
git checkout -b sujet-de-la-modification
```

Les messages de commit sont **en français** et décrivent ce que la
modification change **pour l'utilisateur ou pour le code**, pas la liste des
fichiers touchés.

```
Bien : Le testeur de regex ne fige plus la fenêtre sur un motif coûteux
Mal  : fix regex + update tests
```

Si la modification corrige un défaut, dites lequel et pourquoi la correction
fonctionne. Le corps d'un commit est le meilleur endroit pour cela.

---

## Ce que le projet attend

### Aucune promesse invérifiable

C'est la règle qui prime sur les autres. Si un outil a une limite —
l'effacement n'est pas physique, la conversion Word n'est pas fidèle au pixel,
un JWT décodé n'est pas un JWT vérifié — elle s'écrit dans la `note` du
catalogue et s'affiche sur la page de l'outil.

Un outil qui laisse croire qu'il fait plus qu'il ne fait est pire qu'un outil
absent.

### Figurer au catalogue, c'est fonctionner

Il n'y a pas d'état « bientôt disponible ». Un outil incomplet n'est pas
enregistré, et un test garde le catalogue et la table des implémentations
exactement alignés. Un outil futur vit dans [ROADMAP.md](ROADMAP.md) ou dans
un ticket, pas dans l'interface.

### Des tests qui éprouvent le comportement réel

Un test qui vérifie la liste d'arguments passée à FFmpeg ne prouve pas que le
fichier produit est lisible. Les tests de FourTout exécutent le vrai FFmpeg et
relisent le résultat avec `ffprobe` ; ils relisent les PDF produits avec
pdf.js ; ils relisent l'archive AES avec `7z` plutôt qu'avec le code qui l'a
écrite.

Quand l'environnement manque quelque chose, un test s'**ignore proprement en
disant pourquoi** ; il n'échoue pas.

Et jamais l'inverse : on n'ajuste pas une assertion pour faire vert. Si un
test échoue, soit le code a tort, soit l'assertion était imprécise — et la
corriger doit la rendre *plus* stricte.

### Du français, et des commentaires qui expliquent pourquoi

L'interface, la documentation, les commentaires et les messages de commit sont
en français. Un commentaire qui paraphrase le code ne sert à rien ; un
commentaire qui explique **pourquoi ce choix plutôt qu'un autre** évite une
régression dans six mois.

### Pas de `any` pour faire taire le compilateur

Ni de couleur en dur : les composants utilisent les jetons CSS `--ft-*`.

---

## Ajouter un outil

Trois fichiers, dans cet ordre. La procédure détaillée est dans
[docs/ADDING-A-TOOL.md](docs/technical/ADDING-A-TOOL.md).

1. **Le catalogue** — `src/core/tools/catalog/<catégorie>.ts`. Nom,
   description, icône, mots-clés (en langage courant : c'est ce que
   l'utilisateur tape), entrées acceptées, sorties produites, capacités, et la
   `note` si l'outil a une limite.

2. **L'implémentation** — `src/tools/impl/<catégorie>/MonOutil.tsx`. La
   logique métier va dans `src/core/`, pas dans le composant : c'est elle qui
   se teste.

3. **La table** — `src/tools/implementations.ts`, en import paresseux.

4. **Les tests.** Le comportement dans `src/core/`, l'ouverture de l'écran
   dans un test de page, et la découvrabilité dans la matrice de recherche.

N'enregistrez l'outil au catalogue que lorsqu'il fonctionne. Un test échouera
sinon, et c'est voulu.

### Si l'outil a besoin de la couche native

Le code Rust va dans `src-tauri/src/`, la commande est enregistrée dans
`src-tauri/src/lib.rs`, et le client TypeScript dans `src/core/…/native.ts`.
Les opérations longues doivent rapporter leur progression et **être
annulables** — une annulation ne laisse ni fichier partiel, ni temporaire.

---

## Signaler un problème

Les modèles de ticket demandent : version de FourTout, système
d'exploitation, étapes de reproduction, comportement attendu et constaté.

**Une vulnérabilité de sécurité ne s'ouvre pas en ticket public.** Utilisez
l'onglet Security → Report a vulnerability. Voir
[docs/SECURITY.md](docs/legal/SECURITY.md#signaler-une-vulnérabilité).

---

## Licence des contributions

**FourTout est un logiciel propriétaire** — voir [LICENSE](LICENSE). Le code
est publié pour être lu et audité, pas pour être réutilisé.

Cela ne ferme pas la porte aux contributions, mais cela en change le cadre :
**soumettre une contribution ne change pas la licence de FourTout.** En
proposant une modification, vous accordez au titulaire des droits le droit de
l'utiliser, de la modifier et de la distribuer au sein de FourTout, sous cette
licence.

Aucun accord de contribution formel (*CLA*) n'est demandé à ce jour. Si le
projet accepte un jour des contributions extérieures régulières, un tel accord
pourrait devenir nécessaire ; ce sera une décision du propriétaire du projet,
annoncée ici. Rien n'est signé par défaut aujourd'hui.

Avant d'engager un travail important, ouvrez un ticket : c'est vrai de tout
projet, et particulièrement de celui-ci.
