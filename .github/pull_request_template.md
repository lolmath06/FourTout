## Ce que change cette pull request

<!-- Ce que l'utilisateur ou le code y gagne. Pas la liste des fichiers. -->

## Pourquoi

<!-- Le problème résolu. Le lien vers le ticket, s'il y en a un. -->

## Comment le vérifier

<!-- Les étapes exactes : quel outil, quel fichier, quel résultat attendu. -->

## Cases à cocher

- [ ] `pnpm verify` est vert (lint, types, tests, build)
- [ ] `cd src-tauri && cargo test` est vert
- [ ] Des tests couvrent le comportement, pas seulement la construction des
      arguments
- [ ] Si un outil est ajouté, il est **fonctionnel** : catalogue et
      implémentation vont ensemble, aucun outil « bientôt disponible »
- [ ] Si un outil a une limite, elle est écrite dans sa `note` de catalogue et
      s'affiche sur sa page
- [ ] Aucune promesse invérifiable n'a été ajoutée à l'interface ou à la
      documentation
