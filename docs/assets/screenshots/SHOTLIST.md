# Captures à compléter sur un poste

Les huit captures du README existent déjà (voir [README.md](README.md)). Les
écrans ci-dessous dépendent d'éléments absents d'un environnement de
capture automatisé : un vrai Windows, de vrais disques, un modèle téléchargé,
un réseau local. Ils ne sont **pas** simulés ; voici comment les faire en
quelques minutes.

## Réglages communs

- Fenêtre : **1280 × 800** (redimensionner la fenêtre FourTout ; sous
  Windows, un outil comme PowerToys FancyZones ou `Win + flèches` puis
  ajustement manuel suffit).
- Paramètres → Apparence : **taille 100 %**, **densité compacte**. Thème
  clair puis sombre si vous voulez les deux variantes.
- Fichiers fictifs : `node scripts/showcase/fixtures.mjs`, puis
  `showcase-output/fixtures/`. Rangez-les dans un dossier au nom neutre
  (`Documents/exemples`) : le chemin apparaît à l'écran.
- Export : PNG 2560 × 1600 si l'écran est en 200 %, sinon 1280 × 800 ;
  déposez-le dans `showcase-output/raw/<nom>-<light|dark>.png`, puis
  `node scripts/showcase/branding.mjs` après avoir ajouté `<nom>` à
  `GALLERY` dans ce script.

## 1. Windows — accueil dans la fenêtre native (`windows-accueil`)

- **Pourquoi** : toutes les captures actuelles viennent de Linux
  (WebKitGTK) ou de Chromium ; une capture Windows (WebView2) montre la
  deuxième plateforme.
- **Page** : Accueil.
- **Données** : ouvrir d'abord *Fusionner des PDF*, *Convertir une image*,
  *JSON — formater et valider*, *Compresser un PDF* et cliquer l'étoile de
  chacun ; ouvrir aussi *Comparer deux textes* et *Convertir entre fuseaux
  horaires* pour remplir les récents.
- **Clics** : revenir à l'Accueil, cliquer hors du champ de recherche.
- **Capture** : la fenêtre avec sa barre de titre Windows (`Alt + Impr. écran`).
- **Attendu** : favoris, récents et les douze catégories, barre de titre
  « FourTout ».

## 2. Vidéo — compression en cours (`video-progression`)

- **Page** : Outils → Vidéo → *Compresser une vidéo*.
- **Données** : une vidéo fictive d'au moins 1 minute, par exemple :
  `ffmpeg -f lavfi -i smptehdbars=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440 -t 90 -c:v libx264 -c:a aac exemple-90s.mp4`
- **Clics** : déposer le fichier, garder la qualité par défaut, cliquer
  *Compresser*, capturer quand la barre de progression est vers 40 %.
- **Attendu** : barre de progression globale et progression de l'outil,
  bouton d'annulation visible.

## 3. Images — retirer l'arrière-plan (`detourage`)

- **Prérequis** : Paramètres → Modèles → installer le modèle de détourage
  (téléchargement unique, demandé explicitement).
- **Page** : Outils → Images → *Retirer l'arrière-plan*.
- **Données** : une photo libre de droits d'un objet sur fond uni (pas de
  personne identifiable).
- **Clics** : déposer l'image, attendre le résultat.
- **Attendu** : aperçu avant / après, fond transparent en damier.

## 4. Audio — transcription (`transcription`)

- **Prérequis** : Paramètres → Modèles → installer un modèle de
  transcription (whisper.cpp).
- **Page** : Outils → Audio → *Transcription audio*.
- **Données** : un court enregistrement de votre voix lisant un texte
  neutre (« Ceci est un exemple de transcription locale avec FourTout. »).
- **Clics** : déposer le fichier, lancer la transcription.
- **Attendu** : le texte transcrit et ses horodatages.

## 5. Diagnostic — disques et partitions (`disques`)

- **Pourquoi** : sur une machine virtuelle de capture, l'inventaire montre
  des disques virtuels sans intérêt.
- **Page** : Outils → Diagnostic & récupération → *Inspecter les disques et
  partitions*.
- **Clics** : aucun ; l'écran est en lecture seule. Cliquer *Actualiser*
  si besoin.
- **Avant de capturer** : vérifier qu'aucun **numéro de série** ni nom de
  volume personnel n'est visible ; flouter si nécessaire, ou renoncer.
- **Attendu** : disques, partitions, espace occupé, indicateurs de santé.

## 6. Réseau — tester des ports (`reseau`)

- **Page** : Outils → Réseau → *Tester des ports*.
- **Données** : hôte `127.0.0.1`, ports `22, 80, 443, 8080`.
- **Clics** : lancer le test.
- **Attendu** : un état par port (ouvert / fermé / filtré), aucune adresse
  publique visible.
