# Images ISO

[English](../../features/ISO.md) | [Français](ISO.md)

[← Documentation](../README.md)

Trois outils — `iso-create`, `iso-inspect` et `iso-extract` — lisent et écrivent
des images ISO 9660 avec un moteur Rust natif dans `src-tauri/src/files/iso/`.
Ils sont `local` : rien n'est envoyé nulle part, et **rien n'est jamais écrit
sur un disque, une partition ou une clé USB**. La sortie de *Créer* est un
fichier `.iso` ordinaire.

## Créer

- ISO 9660 niveau 2 avec **Joliet** (noms Unicode pour Windows) et **Rock
  Ridge** (noms longs et droits POSIX pour Linux et macOS : `SP`, `PX`, `TF`,
  `NM`).
- Le nom du volume est validé (lettres, chiffres, `_`, 32 caractères).
- Un fichier de 4 Gio ou plus est **refusé** : ISO 9660 ne peut pas le stocker
  sans fichiers à extents multiples, et l'outil le dit au lieu de produire une
  image cassée.
- Les liens symboliques et fichiers spéciaux sont ignorés et listés. Les noms
  qui ne peuvent pas être gardés tels quels (trop longs pour Rock Ridge,
  modifiés dans l'arbre Joliet) sont signalés.
- Le dossier est figé : si un fichier change pendant l'écriture, le travail
  échoue. L'image ne peut pas être enregistrée dans le dossier qu'elle empaquette.
- L'image est écrite dans `<nom>.fourtout-part`, puis renommée. Un fichier
  existant n'est jamais remplacé en silence. L'annulation supprime la sortie
  partielle.
- L'image n'est **pas amorçable** : c'est une image de données.

## Inspecter

Ne lit que les descripteurs et les répertoires ; l'image n'est ni extraite ni
modifiée. Rapporte le nom du volume, l'éditeur, les dates de création et de
modification, la taille, les systèmes de fichiers présents (ISO 9660, Joliet,
Rock Ridge, UDF), le catalogue de démarrage El Torito (entrées BIOS ou UEFI,
émulation, secteur de chargement) et la présence d'un MBR ou d'un GPT hybride.
L'arbre est plafonné à l'affichage ; les totaux décrivent l'image entière.

Une image UDF pure (certaines ISO Windows) n'est lue que par sa partie ISO 9660,
qui peut n'être qu'un fichier explicatif ; l'outil le dit.

## Extraire

Copie tout ou seulement les entrées cochées.

- Chaque nom de l'image est tenu pour hostile. Séparateurs, `..`, noms réservés
  Windows et chemins absolus sont neutralisés, et une dernière garde refuse toute
  destination hors du dossier choisi.
- Rien n'est écrasé sans demande. Les liens symboliques Rock Ridge sont
  signalés, pas recréés.
- Les fichiers à extents multiples, les répertoires déplacés de Rock Ridge, les
  boucles et les profondeurs excessives sont gérés ; les images tronquées ou
  incohérentes échouent avec un message.
- En cas d'erreur ou d'annulation, ce qui était déjà extrait est **annulé**.

## Multiplateforme

Le moteur est du Rust pur, orienté octets : Fedora et Windows partagent un seul
chemin de code. Les tests d'intégration recoupent les images avec `isoinfo`,
`bsdtar` et `genisoimage` quand ces outils existent (Linux) ; les fixtures pour
les essais manuels sont produites par `pnpm test:assets` (`sample.iso`,
`sample-boot.iso`).
