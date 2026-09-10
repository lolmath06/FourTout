# Feuille de route

FourTout est complet pour l'usage qu'il vise : 160 outils, tous utilisables.
Cette page liste ce qui pourrait venir ensuite. Rien de ce qui y figure n'est
promis, et **aucun de ces éléments n'apparaît dans l'application** : le
catalogue ne contient que des outils qui fonctionnent.

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

- **Archives 7z et RAR.** Aucune bibliothèque Rust mûre et à licence
  compatible ne les couvre aujourd'hui, et appeler un binaire externe casserait
  la promesse « tout est embarqué ».
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
