# Disques, partitions et santé

[← Documentation](../README.md)

## Sommaire

- [Lecture seule, sans exception](#lecture-seule-sans-exception)
- [Ce qui est affiché](#ce-qui-est-affiché)
- [Fournisseur Linux — `src-tauri/src/disks/linux.rs`](#fournisseur-linux--src-taurisrcdiskslinuxrs)
- [Fournisseur Windows — `src-tauri/src/disks/windows.rs`](#fournisseur-windows--src-taurisrcdiskswindowsrs)
- [Santé — `src-tauri/src/disks/smart.rs`](#santé--src-taurisrcdiskssmartrs)
- [Confidentialité](#confidentialité)
- [Tests](#tests)
- [Ce qui appartient à PROMĒTHEÚS Rescue](#ce-qui-appartient-à-prométheús-rescue)

---

Un outil : `disk-inspect`. Moteur dans `src-tauri/src/disks/`, client dans
`src/core/disks/native.ts`, interface dans
`src/tools/impl/diagnostics/DiskInspectTool.tsx`.

---

## Lecture seule, sans exception

Ce module **lit**. Il n'écrit nulle part, et il n'existe aucun chemin de code
capable d'ouvrir un périphérique bloc en écriture.

Ce qui n'existe pas dans FourTout, et n'y sera pas ajouté : partitionner,
formater, modifier une partition, réparer un système de fichiers, lancer `fsck`
ou `chkdsk /f`, écrire ou restaurer une image disque, cloner, effacer, effacer
de façon sécurisée, envoyer un TRIM, modifier une table GPT ou MBR, monter ou
démonter, changer un drapeau, écrire sur `/dev/sdX` ou `\\.\PhysicalDriveN`.

Il n'y a pas non plus de bouton **« Réparer le disque »**, **« Optimiser »** ou
**« Corriger les secteurs »**. Ces formulations ne désignent rien de précis, et
un bouton dont on ne peut pas énoncer l'effet exact n'a pas sa place dans un
outil qui touche à des périphériques bloc.

Une garde structurelle verrouille la propriété :
`nothing_in_the_storage_module_can_open_a_device_for_writing`
(`src-tauri/tests/phase12.rs`) lit le texte des cinq fichiers du module et échoue
si `OpenOptions`, `File::create`, `fs::write`, `mkfs`, `fsck`, `chkdsk`,
`sgdisk`, `parted`, `mount(`, `umount` ou `dd if=` y apparaissent.

---

## Ce qui est affiché

Uniquement ce que le système a réellement donné. Un champ absent s'affiche
« non rapporté », jamais un tiret qui laisserait croire à une valeur nulle.

**Disque physique** : nom système, chemin, modèle, fabricant, capacité,
raccordement (SATA, NVMe, USB, carte mémoire, virtuel), amovible, lecture seule,
nature du support (plateaux / mémoire flash), numéro de série lorsqu'il est
exposé sans privilèges, schéma de partitionnement, et s'il porte le système.

**Partitions** : nom, numéro, taille, décalage de début, type (GUID de type GPT
ou identifiant MBR), identifiant unique, marque d'amorçage.

**Volumes** : système de fichiers, étiquette, identifiant, point de montage,
capacité, occupé, disponible, montage en lecture seule.

Les volumes montés qui ne correspondent à aucune partition listée — images
disque, systèmes de fichiers réseau, `tmpfs`, lecteurs mappés — sont présentés
**à part**, plutôt que rattachés arbitrairement à un disque.

---

## Fournisseur Linux — `src-tauri/src/disks/linux.rs`

Tout vient de fichiers que le noyau expose en lecture, sans privilège et
**sans appeler le moindre programme externe** :

| Information | Source |
| --- | --- |
| Disques, capacité, amovible, lecture seule, plateaux | `/sys/block/<nom>/` |
| Modèle, fabricant, série | `/sys/block/<nom>/device/` |
| Raccordement | cible du lien symbolique `/sys/block/<nom>` |
| Partitions, taille, début | `/sys/block/<nom>/<partition>/` |
| Type et GUID de partition | `partition_type_uuid`, `partition_uuid` |
| Montages, système de fichiers, option `ro` | `/proc/self/mountinfo` |
| Identifiant et étiquette de volume | liens de `/dev/disk/by-uuid`, `/dev/disk/by-label` |
| Espace occupé et disponible | `statvfs` |

Ni `lsblk`, ni `blkid`, ni `ip`, ni aucun autre binaire : il n'y a donc aucune
commande à construire, et aucune saisie utilisateur ne peut atteindre un
interpréteur.

Le secteur logique de `/sys` vaut toujours 512 octets, quelle que soit la taille
de secteur physique du disque — c'est une convention du noyau, pas une
approximation. Les points de montage contenant des espaces sont déséchappés
(`\040`), ce qu'un analyseur naïf rate systématiquement sur les clés USB
nommées « CLE USB ».

L'espace « disponible » retenu est `f_bavail` — celui offert à un utilisateur
ordinaire, pas celui réservé à l'administrateur : c'est le chiffre que
l'utilisateur constatera vraiment.

Les périphériques `loop`, `ram` et `zram` sont écartés : les lister comme des
disques ne renseignerait personne.

L'accès au système de fichiers passe par un trait (`SysSource`). Cette
indirection permet de faire tourner l'analyseur sur un relevé figé — un NVMe en
GPT, une clé USB en MBR montée en lecture seule — plutôt que sur le matériel de
la machine qui exécute les tests, dont on ne sait rien.

---

## Fournisseur Windows — `src-tauri/src/disks/windows.rs`

Deux scripts PowerShell **constants** (`Get-Disk`, `Get-Partition`,
`Get-Volume` ; `Get-StorageReliabilityCounter`), passés à `powershell.exe` avec
`-NoProfile -NonInteractive`, dont la seule sortie est du JSON compact.

**Aucune saisie utilisateur n'y est interpolée, jamais.** Un test le vérifie
littéralement : absence de marqueur de formatage, de `Invoke-Expression`, de
`iex`, et de tout verbe d'écriture (`Set-`, `Clear-`, `Format-Volume`,
`Initialize-`, `New-Partition`, `Remove-`).

Passer par une API native demanderait d'ouvrir des poignées sur
`\\.\PhysicalDriveN` et d'émettre des IOCTL, ce qui réclame des privilèges
administrateur pour la plupart des informations intéressantes — exactement ce
que cette phase refuse de demander.

Deux pièges de `ConvertTo-Json` sont traités, parce qu'ils cassent les
analyseurs écrits sans relevé sous les yeux :

- une lettre de lecteur est rendue tantôt comme chaîne (`"E"`), tantôt comme
  point de code (`67` pour `C`) ;
- un résultat à un seul élément est rendu comme **objet**, pas comme tableau.

L'analyseur est compilé et testé **sur toutes les plateformes**, y compris la
Fedora de développement : seules l'exécution de PowerShell et l'entrée publique
portent `cfg(windows)`. Sans cela, ce code ne serait éprouvé nulle part.

---

## Santé — `src-tauri/src/disks/smart.rs`

Opportuniste, jamais inventé. Tous les disques n'exposent pas les mêmes
compteurs, et beaucoup n'en exposent aucun sans privilèges. L'écran affiche ce
qu'il a réellement obtenu et **dit le reste indisponible**.

| Plateforme | Fournisseur |
| --- | --- |
| Linux | `smartctl --json=c -i -H -A <device>`, **si `smartmontools` est déjà installé** |
| Windows | `Get-PhysicalDisk` + `Get-StorageReliabilityCounter` |

### Ce qui n'est pas fait

- **Aucun autotest.** Un « SMART short test » n'est pas une lecture : il occupe
  le disque plusieurs minutes et modifie son journal interne. Un test verrouille
  l'absence de `--test`, `-t short`, `-t long` et `selftest` dans les arguments.
- **`smartmontools` n'est ni embarqué, ni téléchargé.** C'est un logiciel sous
  GPL : le distribuer avec FourTout ferait peser ses obligations sur l'ensemble.
  S'il est là, FourTout s'en sert ; sinon l'écran l'explique et se dégrade
  proprement. Rien n'est jamais installé à votre place.
- **Aucune requête Internet.** Ni base de fabricants, ni table de modèles.
- **Aucune demande d'élévation de privilèges.** FourTout ne propose pas de se
  relancer en administrateur : il reste utile sans.

L'interrogation est bornée à **six secondes**. Un `smartctl` qui interroge un
disque muet peut rester bloqué longtemps ; l'inventaire n'a pas à attendre avec
lui, et le processus est tué au-delà.

Le chemin de périphérique est validé avant tout appel : il doit commencer par
`/dev/`, ne contenir que des caractères de nœud de périphérique, et ne pas
comporter `..`. Les arguments sont passés séparément, jamais concaténés — il n'y
a donc pas d'injection possible, et cette validation est une ceinture en plus
des bretelles.

### L'affichage ne réduit pas un disque à une couleur

« Santé rapportée : Sain · 39 °C · SMART détaillé indisponible » est plus
honnête qu'un point vert. Un disque sans compteur détaillé n'est pas un disque
en bonne santé : c'est un disque muet, et l'écran fait la différence.

---

## Confidentialité

Les **numéros de série** de disque et les **identifiants de système de
fichiers** sont affichés pendant la session et rien de plus : ils ne vont ni
dans les récents, ni dans les paramètres, ni dans aucun journal, ni dans
`CONTRAT.json`. Les erreurs mentionnent au plus un nom de base, jamais la
topologie de stockage de la machine.

---

## Tests

Les tests automatiques ne dépendent **pas** du matériel du développeur :
fournisseur, analyseur et normalisation sont séparés, et les analyseurs tournent
sur des relevés synthétiques (NVMe GPT, USB MBR, SATA avec attributs, NVMe avec
journal de santé, disque muet, disque absent des compteurs).

Un seul test interroge la vraie machine
(`the_real_machine_can_be_inventoried_without_writing_anything`) et n'affirme
rien sur un nom, une taille ou un numéro de série : seulement que l'inventaire
se dresse sans panique, que sa structure tient debout, que l'espace libre ne
dépasse jamais la capacité, et que le volume racine figure quelque part.

---

## Ce qui appartient à PROMĒTHEÚS Rescue

Image disque, restauration, clonage, récupération de partitions, reconstruction
de table GPT ou MBR, média amorçable, environnement de secours, récupération de
système de fichiers destructive, écriture brute, sauvegarde et restauration
bare-metal.

Ces fonctions demandent un environnement différent — souvent hors du système
installé —, un modèle de risque différent, et une confirmation d'un tout autre
ordre que celle d'un utilitaire de bureau. **Elles n'appartiennent pas à
FourTout**, et leur absence ici est un choix, pas un manque.
