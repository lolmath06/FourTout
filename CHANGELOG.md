# Journal des versions

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et le
projet applique le [versionnage sémantique](https://semver.org/lang/fr/).

Ce journal est écrit du point de vue de l'utilisateur : ce qu'il gagne, ce qui
change pour lui. Pour l'historique détaillé du code, `git log`.

---

## [Non publié]

Première version complète de FourTout : **151 outils, tous utilisables**,
répartis en dix catégories.

### PDF — 23 outils

Fusionner, séparer, extraire ou supprimer des pages, réorganiser par
glisser-déposer, faire pivoter, compresser. Images ↔ PDF, document ↔ PDF,
extraction du texte et des images. Ajout de texte, d'image ou de signature,
filigrane, numérotation, métadonnées. Édition du texte directement sur la
page. Reconnaissance de texte (OCR) sur un PDF scanné, comparaison de deux
documents.

Côté sécurité : protection et déverrouillage par mot de passe, **caviardage
qui supprime réellement le contenu** plutôt que de le recouvrir, et
récupération locale d'un mot de passe oublié par dictionnaire et règles.

### Images — 20 outils

Conversion, compression, redimensionnement, rognage visuel, rotation et
miroir, niveaux de gris, réglages (luminosité, contraste, saturation, gamma),
flou et pixellisation par zone, transparence. Reconnaissance de texte locale,
texte sur image, filigrane, palette de couleurs, favicon et jeux d'icônes,
traitement par lots. Lecture et **suppression des métadonnées EXIF et GPS**
avant partage.

### Audio — 15 outils

Enregistrement au micro, conversion, compression, découpage, fusion, volume,
normalisation, changement de vitesse, suppression automatique des silences,
extraction de la bande son d'une vidéo.

Et la parole, **entièrement locale** : synthèse vocale (Piper), transcription
(whisper.cpp), génération de sous-titres SRT, PDF vers livre audio.

### Vidéo — 19 outils

Conversion, compression, changement de résolution, découpage, fusion, rognage
visuel, rotation et miroir, vitesse. Gestion des pistes audio : suppression,
remplacement, ajout, volume. Sous-titres : ajout de piste, incrustation,
extraction, génération automatique. Vidéo ↔ GIF, extraction d'image,
traitement par lots.

Les codecs proposés sont ceux que le FFmpeg installé sait **réellement**
produire : chacun est éprouvé par un encodage d'essai, pas simplement lu dans
la liste annoncée.

### Texte & Documents — 16 outils

Statistiques, changement de casse, nettoyage, rechercher/remplacer avec
expressions régulières, comparaison, doublons, tri. Markdown ↔ HTML ↔ texte
avec aperçu assaini. Extraction d'URL, d'adresses e-mail et de nombres. Lorem
Ipsum, normalisation Unicode, conversion des fins de ligne. Lecture des
documents Word et conversion vers PDF.

### Fichiers & Archives — 16 outils

Archives ZIP, TAR et TAR.GZ — création et extraction **protégées contre la
traversée de dossiers** — et archives chiffrées WinZip AES-256, lisibles par
7-Zip et l'Explorateur Windows. Empreintes, vérification d'empreinte,
comparaison, détection de doublons par contenu, découpage et réassemblage
vérifié, renommage par lot avec aperçu, nettoyage des noms, organisation d'un
dossier avec plan préalable, analyse de la taille d'un dossier, arborescence,
fiche d'identité d'un fichier, suppression sécurisée.

### Convertisseur universel

Déposez un fichier : FourTout propose les conversions réellement possibles et
ouvre l'outil spécialisé déjà prérempli. Il n'implémente rien lui-même — il
dérive la liste des entrées et sorties déclarées par les outils, ce qui
interdit d'annoncer une conversion sans outil derrière.

### Développeur — 18 outils

JSON, XML, YAML et SQL : formatage, validation, conversion. Base64, URL,
empreintes de texte, JWT, UUID v4 et v7, testeur d'expressions régulières,
timestamp Unix, bases numériques, diff de code, minification et formatage
HTML/CSS/JS, assistant cron, QR codes.

Les entrées sont traitées comme non fiables : l'analyseur XML refuse toute
entité et toute DTD externe, le lecteur YAML s'en tient au schéma `core`, et
le testeur d'expressions régulières exécute le motif dans un fil séparé qu'il
peut tuer.

### Calculateurs — 17 outils

Dix convertisseurs d'unités (longueurs, masses, températures, volumes,
surfaces, vitesses, pressions, énergie, puissance, données) avec les
définitions exactes : livre avoirdupois, mille marin, horsepower mécanique
contre cheval-vapeur métrique, préfixes décimaux contre binaires.

Pourcentages, règle de trois, calculs de dates, de durées, d'âge. Calculatrice
scientifique dotée de son propre analyseur — ni `eval`, ni `new Function`.
Convertisseur de devises adossé aux taux de la Banque centrale européenne.

### Sécurité & Confidentialité — 6 outils

Génération de mots de passe et de phrases de passe, évaluation de robustesse
hors ligne, **chiffrement et déchiffrement de fichiers** (Argon2id puis
XChaCha20-Poly1305, par blocs authentifiés), suppression des métadonnées d'un
fichier quel qu'en soit le type, récupération d'un mot de passe PDF.

### Interface

Recherche en langage courant qui ne propose que des outils réellement
présents. Favoris, récemment utilisés, glisser-déposer partout, opérations
longues annulables avec progression globale.

Taille de l'interface réglable de 80 % à 150 % — `Ctrl` `+`, `Ctrl` `-`,
`Ctrl` `0`, `Ctrl` + molette — densité compacte ou confortable, animations
normales ou réduites, thème clair, sombre ou système.

### Confidentialité

Tout le traitement de fichiers est local. Aucun compte, aucune télémétrie,
aucune analytique, aucune mise à jour automatique. La politique de sécurité de
contenu interdit à l'interface d'émettre la moindre requête sortante.

Deux exceptions, dites dans l'interface : le **convertisseur de devises**
récupère les taux de la Banque centrale européenne, et les **modèles de
parole** sont téléchargés une fois, à la demande explicite de l'utilisateur.
