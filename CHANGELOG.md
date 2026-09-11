# Journal des versions

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et le
projet applique le [versionnage sémantique](https://semver.org/lang/fr/).

Ce journal est écrit du point de vue de l'utilisateur : ce qu'il gagne, ce qui
change pour lui. Pour l'historique détaillé du code, `git log`.

---

## [Non publié]

Première version complète de FourTout : **174 outils, tous utilisables**,
répartis en dix catégories.

### PDF — 26 outils

Fusionner, séparer, extraire ou supprimer des pages, réorganiser par
glisser-déposer, faire pivoter, compresser. Images ↔ PDF, document ↔ PDF,
extraction du texte et des images. Ajout de texte, d'image ou de signature,
filigrane, numérotation, métadonnées. Édition du texte directement sur la
page. Reconnaissance de texte (OCR) sur un PDF scanné, comparaison de deux
documents.

**PDF scanné vers PDF recherchable** : le texte d'un document numérisé est
reconnu localement puis ajouté au PDF en couche invisible, à l'endroit exact où
chaque mot a été lu. `Ctrl+F`, la sélection et le copier-coller fonctionnent, et
les pages d'origine ne sont ni rasterisées ni recompressées — l'apparence ne
change pas.

**Extraire les tableaux d'un PDF** vers CSV ou classeur XLSX. Un PDF ne contient
pas de tableaux mais du texte positionné : FourTout en déduit lignes et
colonnes, avec ou sans bordures, montre ce qu'il a reconstruit et laisse
corriger avant l'export. **Scans et photos vers PDF** relie un lot de pages
numérisées, nettoyage et ordre compris.

Côté sécurité : protection et déverrouillage par mot de passe, **caviardage
qui supprime réellement le contenu** plutôt que de le recouvrir, et
récupération locale d'un mot de passe oublié par dictionnaire et règles.

### Images — 23 outils

Conversion, compression, redimensionnement, rognage visuel, rotation et
miroir, niveaux de gris, réglages (luminosité, contraste, saturation, gamma),
flou et pixellisation par zone, transparence. Reconnaissance de texte locale,
texte sur image, filigrane, palette de couleurs, favicon et jeux d'icônes,
traitement par lots. Lecture et **suppression des métadonnées EXIF et GPS**
avant partage.

**Retirer l'arrière-plan** : le sujet d'une photo est reconnu et détouré
automatiquement, le fond devient transparent. Le modèle (U²-Net, Apache 2.0)
s'installe une fois puis tourne sur la machine — l'image n'est jamais envoyée
sur un serveur, contrairement aux services en ligne équivalents.

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

### Texte & Documents — 19 outils

Statistiques, changement de casse, nettoyage, rechercher/remplacer avec
expressions régulières, comparaison, doublons, tri. Markdown ↔ HTML ↔ texte
avec aperçu assaini. Extraction d'URL, d'adresses e-mail et de nombres. Lorem
Ipsum, normalisation Unicode, conversion des fins de ligne. Lecture des
documents Word et conversion vers PDF.

**Comparer deux documents** — PDF, Word, texte, Markdown ou HTML, y compris de
formats différents : le contenu est ramené à du texte puis comparé ligne à ligne
et mot à mot.

**Encodage des fichiers texte** : détection de l'encodage, de la marque d'ordre
des octets et de la convention de fin de ligne, avec la certitude réelle plutôt
qu'un verdict trompeur ; puis conversion entre UTF-8, UTF-8 avec BOM, UTF-16
LE/BE, Windows-1252 et Latin-1. Si la destination ne peut pas écrire un
caractère, la conversion est **refusée** et les caractères concernés sont
nommés : rien ne se perd en silence.

### Fichiers & Archives — 29 outils

Archives **ZIP, 7z, TAR, TAR.GZ et TAR.XZ** — création et extraction
**protégées contre la traversée de dossiers** — et archives chiffrées WinZip
AES-256, lisibles par 7-Zip et l'Explorateur Windows. Aucun `7z`, `xz` ou `tar`
n'a besoin d'être installé : tout est embarqué. Compression d'un fichier seul
en `.gz` ou `.xz`, avec la distinction dite à l'écran (`.gz` ne contient qu'un
fichier, `.tar.gz` une arborescence). **Inspection d'une archive** sans rien
extraire, et **test d'intégrité** qui décompresse réellement tout et vérifie
les sommes de contrôle sans rien écrire.

Empreintes, vérification d'empreinte, **manifestes d'empreintes** au format
`sha256sum` (création et vérification), comparaison de deux fichiers, détection
de doublons par contenu, découpage et réassemblage vérifié, renommage par lot
avec aperçu, nettoyage des noms, organisation d'un dossier avec plan préalable,
arborescence, suppression sécurisée.

**Comparer deux dossiers** dit ce qui est identique, modifié ou présent d'un
seul côté. Deux modes, et la différence entre eux est dite à l'écran : le mode
rapide compare type et taille sans rien lire — deux fichiers de même taille y
sont « probablement identiques » —, le mode fiable confirme par le contenu, et
ne relit que les fichiers de même taille.

**Synchroniser des dossiers** calcule d'abord un plan : tant de fichiers à
copier, à remplacer, à supprimer, tant d'octets à écrire, et la liste. Rien ne
s'écrit avant que ce plan ait été lu et confirmé, et c'est exactement ce plan
qui est exécuté. Un fichier modifié entre-temps est refusé plutôt qu'écrasé à
l'aveugle. Le mode miroir, qui supprime, demande en plus une confirmation
tapée — et seulement s'il y a réellement quelque chose à effacer.

**Rechercher dans des fichiers** croise nom, extension, taille, date et
contenu. Les résultats s'affichent pendant la recherche, pas après. Rien n'est
indexé en fond. Un fichier binaire n'est jamais interprété comme du texte, même
s'il contient le mot cherché.

**Analyser l'espace d'un dossier** remplace l'ancienne « taille d'un dossier » :
plus gros fichiers, plus gros sous-dossiers, répartition par type.

**Inspecter un fichier** croise ce que le nom prétend et ce que les premiers
octets révèlent. Un `.jpg` contenant un PNG est signalé — et rien n'est renommé
automatiquement. **Prévisualiser un fichier** ouvre texte, image, PDF, audio,
vidéo, archive ou octets bruts sans l'application d'origine, en suivant le
contenu réel. **Éditer en hexadécimal** lit par fenêtres (un fichier de 20 Go
se parcourt sans être chargé), cherche une séquence, corrige des octets, et
enregistre par défaut dans un **nouveau** fichier.

**Sauvegarder un dossier** produit une copie doublée d'un manifeste
d'empreintes, dans un format lisible sans FourTout : un dossier `donnees` et un
`manifeste.json`, sans aucun chemin absolu. **Restaurer une sauvegarde**
vérifie l'intégrité avant d'écrire, nomme les fichiers abîmés au lieu de les
remettre en place en silence, et ne supprime jamais rien dans la destination.

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

### Sécurité & Confidentialité — 7 outils

Génération de mots de passe et de phrases de passe, évaluation de robustesse
hors ligne, **chiffrement et déchiffrement de fichiers** (Argon2id puis
XChaCha20-Poly1305, par blocs authentifiés), suppression des métadonnées d'un
fichier quel qu'en soit le type, récupération d'un mot de passe PDF.

**Calculer un HMAC** signe un texte ou un fichier avec une clé secrète
(SHA-256, SHA-512, SHA-1 pour les services anciens). La clé n'est ni
enregistrée, ni journalisée, ni ajoutée aux récents : elle sert au calcul, puis
disparaît.

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
