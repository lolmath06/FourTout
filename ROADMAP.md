# Feuille de route

FourTout est complet pour l’usage qu’il vise : 196 outils, tous utilisables.
Cette page liste ce qui pourrait venir ensuite. Rien de ce qui y figure n'est
promis, et **aucun de ces éléments n'apparaît dans l'application** : le
catalogue ne contient que des outils qui fonctionnent.

---

## Hors périmètre : PROMĒTHEÚS Rescue

Ces fonctions ne viendront **pas** dans FourTout, quel que soit l'avenir du
projet. Elles appartiennent à une suite de sauvetage dédiée :

- image disque, restauration d'image, clonage ;
- récupération de partitions, reconstruction d'une table GPT ou MBR ;
- récupération de système de fichiers destructive, `fsck` avec écriture ;
- écriture brute sur un périphérique bloc ;
- média amorçable, environnement de secours ;
- sauvegarde et restauration bare-metal.

La raison n'est pas technique. Ces opérations demandent un environnement
différent — souvent hors du système installé —, un modèle de risque différent,
et une confirmation d'un tout autre ordre que celle d'un utilitaire de bureau.
Les mêler à FourTout reviendrait à placer un bouton capable d'effacer un disque
à côté d'un convertisseur d'images.

FourTout diagnostique, récupère ce qui est prouvablement récupérable, et ne
touche jamais à l'original.

---

## Distribution

- **Signature des installeurs.** Windows (certificat de signature de code) et
  paquets Linux (signature GPG). Tant que ce n'est pas fait, SmartScreen
  avertit au premier lancement, et c'est écrit dans la documentation.
- **Identité visuelle.** `src-tauri/icons/` contient encore l'icône par défaut
  de Tauri.
- **Paquet Flatpak**, pour les distributions Linux qui le préfèrent.
- **macOS.** Le code est déjà multiplateforme ; ni construction ni test n'ont
  été faits sur macOS.

## Outils

- **RAR.** Format fermé ; le décompresseur de référence n'est pas
  redistribuable sous une licence compatible. Le 7z, lui, est arrivé en
  phase 9 avec `sevenz-rust2`, bibliothèque Rust pure.
- **Chiffrement des archives 7z.** Le ZIP AES-256 d'« Archive protégée »
  couvre déjà le besoin et s'ouvre partout ; un second format chiffré, à la
  compatibilité plus incertaine, attendra une demande réelle.
- **Synchronisation bidirectionnelle.** La synchronisation actuelle va de la
  source vers la destination, avec un plan lu avant toute écriture. Réconcilier
  deux côtés modifiés demande une détection de conflits et un historique — un
  sujet entier, pas une option à cocher.
- **Sauvegarde versionnée.** La sauvegarde actuelle est une copie complète,
  datée et vérifiable. Les instantanés incrémentaux, la déduplication par blocs
  et l'historique de versions sont un produit à part.
- **Word vers PDF fidèle à la maquette.** Demanderait un moteur de mise en
  page Word. L'outil actuel reprend le contenu et sa structure, et le dit.
- **Plus de langues d'OCR.** L'infrastructure les accepte ; ce sont des
  données à embarquer ou à télécharger.

## Interface

- **Assistant local.** La barre « Que voulez-vous faire ? » est déjà branchée
  sur un résolveur d'intention. Il est aujourd'hui déterministe ; un modèle
  local pourrait le remplacer, avec repli sur le résolveur actuel. Rien ne
  partirait sur le réseau.
- **Traitement par lots généralisé.** Plusieurs outils l'acceptent déjà ; le
  socle permettrait de l'étendre.
- **Anglais.** L'interface est en français.

## Technique

- **Découpage des paquets JavaScript.** Quelques morceaux dépassent 500 Kio
  après minification. Sans effet perceptible dans une application desktop,
  mais améliorable.
- **FFmpeg embarqué en option.** `resolve_binary` le prévoit déjà ; ce qui
  manque est le choix de licence de la compilation redistribuée.

---

Une idée qui n'est pas ici ? Ouvrez un ticket.
