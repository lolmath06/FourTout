# Tous les outils de FourTout

[← Documentation](../README.md)

181 outils, répartis en dix catégories. Chaque outil de cette liste est
**utilisable** : FourTout n'enregistre pas d'outil incomplet, et il n'existe
donc pas d'état « bientôt disponible ».

Un outil peut apparaître dans plusieurs catégories : il n'est implémenté
qu'une fois, mais il est découvrable là où on le cherche. Ces rattachements
secondaires sont signalés en fin de ligne.

Les notes en italique sont les limites réelles de l'outil. Elles apparaissent
aussi dans l'application, sur la page de l'outil.

Cette liste est **dérivée du registre** (`pnpm docs:features`) : elle ne peut
donc pas annoncer un outil qui n'existe pas, ni oublier celui qui vient
d'arriver.

<!-- OUTILS:DÉBUT -->

## Sommaire

- [PDF](#pdf-26)
- [Images](#images-25)
- [Audio](#audio-18)
- [Vidéo](#vidéo-20)
- [Texte & Documents](#texte--documents-20)
- [Fichiers & Archives](#fichiers--archives-29)
- [Convertisseurs](#convertisseurs-1)
- [Développeur](#développeur-18)
- [Calculateurs](#calculateurs-17)
- [Sécurité & Confidentialité](#sécurité--confidentialité-7)

---

### PDF (26)

_Fusionner, découper, compresser, convertir et sécuriser des PDF._

- **Fusionner des PDF** — Assembler plusieurs PDF en un seul document, dans l'ordre de votre choix.
- **Séparer un PDF** — Découper un PDF en plusieurs fichiers selon des intervalles de pages.
- **Extraire des pages** — Créer un nouveau PDF à partir d'une sélection de pages.
- **Supprimer des pages** — Retirer définitivement certaines pages d'un PDF.
- **Réorganiser les pages** — Changer l'ordre des pages par glisser-déposer.
- **Faire pivoter des pages** — Tourner tout ou partie des pages de 90, 180 ou 270 degrés.
- **Compresser un PDF** — Réduire le poids d'un PDF en gardant une qualité de lecture correcte.
- **Images vers PDF** — Transformer une série d'images en un document PDF paginé. · aussi dans *Images* et *Convertisseurs*
- **PDF vers images** — Exporter chaque page d'un PDF en PNG ou JPEG, à la résolution voulue. · aussi dans *Images* et *Convertisseurs*
- **Document vers PDF** — Convertir un fichier texte, Markdown ou HTML en PDF. · aussi dans *Texte & Documents* et *Convertisseurs*
- **Ajouter du texte** — Écrire du texte sur un PDF pour remplir un formulaire ou annoter.
- **Ajouter une image ou signature** — Insérer une image, un tampon ou une signature à l'endroit voulu.
- **Ajouter un filigrane** — Apposer un texte en filigrane sur tout ou partie des pages.
- **Numéroter les pages** — Ajouter une pagination personnalisable en en-tête ou pied de page.
- **Protéger par mot de passe** — Chiffrer un PDF pour qu'il ne s'ouvre qu'avec un mot de passe. · aussi dans *Sécurité & Confidentialité*
- **Déverrouiller un PDF** — Retirer la protection d'un PDF dont vous connaissez le mot de passe. · aussi dans *Sécurité & Confidentialité*
  <br>_FourTout ne casse pas les protections : le mot de passe doit être connu. Pour un mot de passe oublié, voir « Retrouver un mot de passe PDF »._
- **Métadonnées PDF** — Lire et modifier titre, auteur, sujet et mots-clés d'un PDF. · aussi dans *Sécurité & Confidentialité*
- **Extraire les images d'un PDF** — Récupérer toutes les images intégrées dans un PDF. · aussi dans *Images*
- **Extraire le texte d'un PDF** — Récupérer le texte sélectionnable d'un PDF, page par page. · aussi dans *Texte & Documents* et *Convertisseurs*
- **Modifier le texte d'un PDF** — Corriger le texte directement sur la page : double-cliquez un mot et remplacez-le. · aussi dans *Texte & Documents*
  <br>_Édition visuelle par remplacement : le texte d'origine est recouvert par la couleur de fond échantillonnée puis redessiné. Idéal pour du texte horizontal sur fond uni (documents, factures, rapports). Les zones sur fond non uni ou pivotées sont signalées et non modifiées._
- **OCR d'un PDF scanné** — Reconnaître le texte d'un PDF scanné, page par page, en français ou en anglais. · aussi dans *Texte & Documents*
  <br>_Moteur OCR local (tesseract.js) embarqué : aucune donnée n'est envoyée sur le réseau. Pour une image seule, voir « Extraire le texte d'une image »._
- **Comparer deux PDF** — Mettre en évidence les différences entre deux versions d'un document. · aussi dans *Texte & Documents*
- **Caviarder un PDF** — Masquer définitivement des zones sensibles, contenu supprimé et non simplement recouvert. · aussi dans *Sécurité & Confidentialité*
- **PDF scanné vers PDF recherchable** — Reconnaître le texte d'un PDF numérisé et l'ajouter en couche invisible : Ctrl+F, sélection et copie fonctionnent, l'apparence ne bouge pas. · aussi dans *Texte & Documents*
  <br>_La reconnaissance est entièrement locale. Les pages d'origine ne sont ni rasterisées ni recompressées : seule une couche de texte invisible leur est ajoutée. La qualité du résultat dépend de celle du scan._
- **Extraire les tableaux d'un PDF** — Reconstruire lignes et colonnes à partir de la position du texte, puis exporter en CSV ou en classeur XLSX. · aussi dans *Texte & Documents* et *Convertisseurs*
  <br>_Un PDF ne contient pas de tableaux, seulement du texte positionné : FourTout reconstruit les lignes et les colonnes à partir de ces positions. Les tableaux complexes — cellules fusionnées, texte sur plusieurs lignes — peuvent demander une correction avant export._
- **Scans et photos vers PDF** — Assembler des pages numérisées ou photographiées en un seul PDF, avec nettoyage et mise en ordre des pages. · aussi dans *Images*
  <br>_Le nettoyage s'applique à toutes les pages avec les mêmes réglages ; l'assemblage réutilise le moteur « Images vers PDF »._

### Images (25)

_Convertir, compresser, redimensionner et nettoyer des images._

- **Convertir une image** — Passer d'un format à un autre : PNG, JPG, WebP. Lecture aussi de GIF, BMP, TIFF, SVG. · aussi dans *Convertisseurs*
- **Compresser une image** — Réduire le poids d'une image en contrôlant la perte de qualité.
- **Redimensionner une image** — Changer les dimensions en pixels ou en pourcentage, avec ou sans ratio.
- **Rogner une image** — Recadrer visuellement une image, librement ou selon un ratio (1:1, 4:3, 16:9, 3:2).
- **Rotation et miroir** — Pivoter par quarts de tour et retourner en miroir, avec aperçu immédiat.
- **Miroir horizontal ou vertical** — Retourner une image comme dans un miroir.
- **Noir et blanc** — Convertir en niveaux de gris, ou en noir et blanc par seuil réglable.
- **Ajuster une image** — Régler luminosité, contraste, saturation et gamma, avec aperçu en temps réel.
- **Flouter ou pixelliser** — Masquer une information : flou ou mosaïque, sur toute l'image ou une zone dessinée. · aussi dans *Sécurité & Confidentialité*
- **Supprimer la transparence** — Aplatir un PNG ou WebP transparent sur un fond uni (blanc, noir ou couleur).
- **Retirer l'arrière-plan** — Détourer automatiquement le sujet d'une photo et rendre le fond transparent. · aussi dans *Sécurité & Confidentialité*
  <br>_Le modèle de détourage s'installe une fois depuis Paramètres → Modèles, puis fonctionne hors ligne : l'image n'est jamais envoyée sur un serveur. Il reconnaît un sujet principal net et détaché ; il se trompe sur les scènes sans sujet évident et sur les détails très fins._
- **Rendre une couleur transparente** — Effacer une couleur unie (fond) et la remplacer par de la transparence.
- **Extraire le texte d'une image (OCR)** — Reconnaître le texte d'une image, en français ou en anglais, 100 % en local. · aussi dans *Texte & Documents*
- **Texte sur une image** — Écrire du texte sur une image : légende, mème, annotation, avec placement au doigt.
- **Lire les métadonnées d'une image** — Afficher EXIF, GPS, appareil photo, date de prise de vue.
- **Supprimer les métadonnées d'une image** — Effacer EXIF et données GPS avant de partager une photo. · aussi dans *Sécurité & Confidentialité*
- **Conversion d'images par lots** — Appliquer la même conversion à un dossier entier d'images. · aussi dans *Convertisseurs* et *Fichiers & Archives*
- **Filigrane sur une image** — Ajouter un logo ou un texte en filigrane, à l'unité ou par lots.
- **Générer un favicon** — Produire un favicon multi-tailles et le fichier .ico depuis une image. · aussi dans *Développeur*
- **Générer plusieurs tailles** — Exporter d'un coup toutes les tailles d'icônes ou de miniatures utiles. · aussi dans *Développeur*
- **Analyser et convertir une couleur** — Couleurs dominantes d'une image, pipette au pixel près, écritures HEX / RGB / HSL / HSV, et contraste WCAG entre un texte et son fond. · aussi dans *Développeur*
- **Corriger la perspective d'un document** — Redresser la photo d'une feuille prise en biais : placez les quatre coins, FourTout la ramène à un rectangle vu de face. · aussi dans *Texte & Documents*
  <br>_Les quatre coins se placent à la main : c'est toujours exact, là où une détection automatique se trompe. Les proportions déduites des coins sont approchées — imposez le format A4 ou Lettre pour un résultat exact._
- **Nettoyer un scan** — Redresser un document légèrement penché, relever le contraste, blanchir un fond gris ou jauni, passer en niveaux de gris ou en noir et blanc. · aussi dans *Texte & Documents*
  <br>_Chaque réglage est facultatif et visible en aperçu avant/après. Le blanchiment ne touche jamais aux pixels sombres : le texte fin garde sa densité._
- **Comparer deux images** — Voir et mesurer ce qui change entre deux images : côte à côte, en superposition ou en différence, avec pixels différents, PSNR et SSIM.
  <br>_Deux images de dimensions différentes ne sont jamais redimensionnées sans votre accord : le rééchantillonnage fabriquerait des écarts absents des fichiers._
- **Créer une planche-contact** — Disposer plusieurs images en grille sur une seule feuille, avec le nom de chaque fichier.

### Audio (18)

_Convertir, découper, normaliser, transcrire et synthétiser du son._

- **Enregistrer au micro** — Capturer un son depuis le microphone et l'enregistrer localement.
- **Découper un audio** — Garder un extrait précis d'un fichier audio.
- **Fusionner des audios** — Mettre plusieurs pistes bout à bout en un seul fichier.
- **Convertir un audio** — Passer d'un format à un autre : MP3, WAV, FLAC, OGG, M4A, OPUS. · aussi dans *Convertisseurs*
- **Compresser un audio** — Réduire le poids d'un fichier audio en ajustant le débit.
- **Régler le volume** — Augmenter ou diminuer le volume global d'un fichier audio.
- **Normaliser un audio** — Uniformiser le niveau sonore de plusieurs fichiers (loudness).
- **Changer la vitesse** — Accélérer ou ralentir un audio, avec ou sans correction de hauteur.
- **Supprimer les silences** — Détecter et couper automatiquement les blancs d'un enregistrement.
- **Extraire l'audio d'une vidéo** — Récupérer la bande son d'une vidéo au format de votre choix. · aussi dans *Vidéo* et *Convertisseurs*
- **Transcription audio** — Convertir la parole d'un fichier audio ou vidéo en texte, localement. · aussi dans *Texte & Documents* et *Vidéo*
  <br>_Modèle de reconnaissance vocale exécuté sur votre machine, installé à la demande._
- **Générer des sous-titres SRT** — Produire un fichier de sous-titres horodaté depuis un audio ou une vidéo. · aussi dans *Vidéo* et *Texte & Documents*
- **Texte vers parole** — Lire un texte à voix haute et l'enregistrer en fichier audio, sans service en ligne. · aussi dans *Texte & Documents*
- **PDF vers audio** — Transformer un PDF en livre audio grâce à la synthèse vocale locale. · aussi dans *PDF* et *Convertisseurs*
- **Fichier texte vers audio** — Convertir un fichier TXT ou Markdown en fichier audio narré. · aussi dans *Texte & Documents* et *Convertisseurs*
- **Convertir les canaux audio** — Passer un fichier en mono ou en stéréo, ou le laisser tel quel. Un fichier multicanal n'est jamais réduit sans qu'on le demande.
  <br>_Du mono vers le stéréo, le canal est dupliqué : les deux voies portent le même signal. Aucune spatialisation n'est fabriquée._
- **Modifier les étiquettes audio** — Lire et corriger titre, artiste, album, année, genre, piste et commentaire — sans réencoder le son.
  <br>_L'écriture recopie le flux audio tel quel (-c copy) : le son produit est identique au bit près._
- **Inspecter un média** — Tout ce qu'un fichier audio ou vidéo déclare : conteneur, codecs, résolution, cadence, débits, canaux, étiquettes. · aussi dans *Vidéo* et *Fichiers & Archives*

### Vidéo (20)

_Convertir, compresser, découper et sous-titrer des vidéos._

- **Convertir une vidéo** — Passer d'un format à un autre : MP4, MKV, WebM, MOV. · aussi dans *Convertisseurs*
  <br>_Seuls les codecs réellement présents dans le moteur installé sont proposés._
- **Compresser une vidéo** — Réduire fortement le poids d'une vidéo en choisissant la qualité cible.
- **Changer la résolution** — Passer une vidéo en 1080p, 720p, 480p ou une taille personnalisée.
- **Découper une vidéo** — Garder uniquement un extrait, sans réencodage quand c'est possible.
- **Fusionner des vidéos** — Assembler plusieurs vidéos bout à bout en un seul fichier.
- **Rogner une vidéo** — Sélectionner visuellement la zone à conserver, avec proportions imposées. · aussi dans *Images*
- **Vidéo vers GIF** — Transformer un extrait vidéo en GIF animé optimisé. · aussi dans *Images* et *Convertisseurs*
- **GIF vers vidéo** — Convertir un GIF animé en MP4 ou WebM, bien plus léger. · aussi dans *Images* et *Convertisseurs*
- **Extraire une image d'une vidéo** — Capturer une frame précise ou des captures à intervalle régulier. · aussi dans *Images* et *Convertisseurs*
- **Changer la vitesse d'une vidéo** — Créer un accéléré ou un ralenti, audio inclus.
- **Pivoter une vidéo** — Corriger une vidéo filmée dans le mauvais sens, ou la retourner en miroir.
- **Supprimer le son d'une vidéo** — Produire une version muette de la vidéo, sans réencoder l'image.
- **Remplacer la piste audio** — Remplacer la bande son d'une vidéo, ou lui ajouter une piste supplémentaire. · aussi dans *Audio*
  <br>_Déposez la vidéo et le fichier audio ensemble._
- **Régler le volume d'une vidéo** — Monter ou baisser le son d'une vidéo sans toucher à l'image. · aussi dans *Audio*
- **Ajouter une piste de sous-titres** — Attacher un fichier SRT ou VTT à la vidéo, activable dans le lecteur. · aussi dans *Texte & Documents*
  <br>_Déposez la vidéo et le fichier de sous-titres ensemble._
- **Incruster des sous-titres** — Graver les sous-titres dans l'image : ils s'affichent sur tous les lecteurs. · aussi dans *Texte & Documents*
  <br>_Déposez la vidéo et le fichier de sous-titres ensemble._
- **Extraire les sous-titres d'une vidéo** — Exporter en SRT ou VTT les pistes de sous-titres déjà présentes. · aussi dans *Texte & Documents*
  <br>_Seules les pistes textuelles sont exportables ; les pistes graphiques (PGS, DVD) sont des images._
- **Générer les sous-titres d'une vidéo** — Transcrire automatiquement la parole d'une vidéo, puis exporter ou incruster. · aussi dans *Audio* et *Texte & Documents*
  <br>_Utilise le modèle de transcription local déjà installé (aucun envoi sur le réseau)._
- **Traitement vidéo par lots** — Convertir, compresser, redimensionner, pivoter ou extraire l'audio de plusieurs vidéos. · aussi dans *Fichiers & Archives*
- **Changer la fréquence d'images** — Convertir une vidéo vers 24, 25, 30, 60 i/s ou une cadence personnalisée, par duplication et suppression d'images.
  <br>_Aucune image intermédiaire n'est calculée : les images sont dupliquées ou supprimées. La sortie est à cadence constante._

### Texte & Documents (20)

_Analyser, nettoyer, comparer et transformer du texte._

- **Compteur de mots et caractères** — Mots, caractères, phrases, paragraphes et temps de lecture estimé.
- **Changer la casse** — MAJUSCULES, minuscules, Première Lettre, camelCase, snake_case, kebab-case.
- **Nettoyer un texte** — Retirer espaces superflus, lignes vides, tabulations et caractères invisibles.
- **Rechercher et remplacer** — Remplacer du texte en masse, avec ou sans expression régulière.
- **Comparer deux textes** — Voir ligne par ligne ce qui a été ajouté, supprimé ou modifié. · aussi dans *Développeur*
- **Supprimer les doublons** — Ne garder qu'une occurrence de chaque ligne, en option sans tenir compte de la casse.
- **Trier des lignes** — Classer des lignes par ordre alphabétique, numérique ou aléatoire.
- **Markdown ↔ HTML / texte** — Convertir du Markdown en HTML ou en texte brut, et l'inverse. · aussi dans *Convertisseurs* et *Développeur*
- **Extraire les URL** — Récupérer toutes les adresses web contenues dans un texte.
- **Extraire les adresses e-mail** — Isoler toutes les adresses e-mail présentes dans un texte.
- **Extraire les nombres** — Sortir tous les nombres d'un texte et en calculer la somme.
- **Lorem Ipsum** — Générer du faux texte : mots, phrases ou paragraphes. · aussi dans *Développeur*
- **Normaliser Unicode** — Uniformiser l'écriture des accents (NFC, NFD, NFKC, NFKD) entre systèmes. · aussi dans *Développeur*
- **Convertir les fins de ligne** — Passer de CRLF (Windows) à LF (Unix) et inversement, avec détection préalable. · aussi dans *Fichiers & Archives* et *Développeur*
- **Word (DOCX) vers texte, Markdown ou HTML** — Extraire le contenu d'un document Word : titres, paragraphes, listes et tableaux. · aussi dans *Convertisseurs*
  <br>_La mise en page complexe (colonnes, images, styles) n'est pas restituée : FourTout extrait le contenu et sa structure._
- **Word (DOCX) vers PDF** — Convertir un document Word en PDF : titres, paragraphes, listes et tableaux simples. · aussi dans *PDF* et *Convertisseurs*
  <br>_FourTout reprend le contenu et sa structure — titres, paragraphes, gras, italique, listes, tableaux simples — mais pas la maquette Word : colonnes, zones flottantes, en-têtes et pieds de page, polices spécifiques et images peuvent différer ou disparaître. Pour un rendu fidèle au pixel, exportez en PDF depuis Word ou LibreOffice._
- **Comparer deux documents** — Comparer le contenu de deux documents — PDF, Word, texte, Markdown ou HTML — même de formats différents, ligne par ligne et mot par mot. · aussi dans *PDF* et *Fichiers & Archives*
  <br>_La comparaison porte sur le texte, pas sur la mise en page : elle dit ce qui a changé dans le contenu, y compris entre deux formats différents. Un PDF scanné doit d'abord passer par « PDF scanné vers PDF recherchable »._
- **Détecter l'encodage d'un fichier texte** — Identifier l'encodage, la marque d'ordre des octets et la convention de fin de ligne d'un fichier, avec le degré de certitude réel. · aussi dans *Développeur* et *Fichiers & Archives*
  <br>_Hors marque d'ordre des octets, aucun fichier ne déclare son encodage : la détection reste une hypothèse, et FourTout affiche sa certitude réelle plutôt qu'un verdict trompeur._
- **Convertir l'encodage d'un fichier texte** — Passer d'un encodage à un autre — UTF-8, UTF-8 avec BOM, UTF-16 LE/BE, Windows-1252, Latin-1 — sans perdre un caractère à votre insu. · aussi dans *Développeur* et *Fichiers & Archives*
  <br>_Si l'encodage de destination ne peut pas écrire certains caractères, la conversion est refusée et les caractères concernés sont listés. Le remplacement n'a lieu que si vous le demandez explicitement._
- **Modifier des sous-titres** — Convertir entre SRT et WebVTT, décaler les horodatages, fusionner deux fichiers, vérifier et réparer. · aussi dans *Vidéo* et *Convertisseurs*
  <br>_Ce qui est mécaniquement sûr est corrigé (ordre, numérotation, fins de ligne) ; les chevauchements sont signalés mais jamais raccourcis d'office._

### Fichiers & Archives (29)

_Compresser, extraire, comparer, renommer et organiser des fichiers._

- **Créer une archive** — Compresser des fichiers ou dossiers en ZIP, 7z, TAR, TAR.GZ ou TAR.XZ, arborescence conservée.
  <br>_Le 7z produit ici n'est pas chiffré : pour une archive protégée par mot de passe, utilisez « Archive protégée », dont le ZIP AES-256 s'ouvre avec 7-Zip, WinRAR, Keka et l'Explorateur Windows._
- **Extraire une archive** — Décompresser une archive ZIP, 7z, TAR, TAR.GZ ou TAR.XZ vers le dossier de votre choix.
  <br>_Aucun fichier n'est écrit hors du dossier choisi : les entrées dont le chemin remonte (« ../ »), les chemins absolus et les liens symboliques sont refusés et listés. Le format RAR n'est pas pris en charge._
- **Archive protégée par mot de passe** — Créer ou ouvrir une archive chiffrée par mot de passe. · aussi dans *Sécurité & Confidentialité*
  <br>_Chiffrement WinZip AES-256 : l'archive s'ouvre avec 7-Zip, WinRAR, PeaZip, Keka et l'Explorateur Windows. Le « ZipCrypto » historique, cassable en quelques secondes, n'est jamais employé. Les noms de fichiers, eux, restent lisibles sans le mot de passe — c'est une limite du format ZIP._
- **Calculer une empreinte (hash)** — Obtenir le SHA-256, SHA-512, SHA-1 ou MD5 d'un ou plusieurs fichiers, quelle que soit leur taille. · aussi dans *Sécurité & Confidentialité* et *Développeur*
- **Vérifier une empreinte** — Comparer l'empreinte d'un fichier à celle annoncée par sa source. · aussi dans *Sécurité & Confidentialité*
- **Trouver les fichiers en double** — Détecter les doublons d'un dossier par contenu et non par nom.
- **Comparer deux fichiers** — Vérifier si deux fichiers sont identiques, octet par octet ou ligne par ligne.
- **Renommage en masse** — Renommer des centaines de fichiers avec un modèle, une numérotation ou une regex.
- **Nettoyer les noms de fichiers** — Retirer accents, espaces et caractères problématiques des noms de fichiers.
- **Organiser un dossier** — Ranger automatiquement les fichiers par extension, par date ou par type.
- **Analyser l'espace d'un dossier** — Voir ce qui occupe réellement l'espace : plus gros fichiers, plus gros sous-dossiers, répartition par type.
  <br>_Seules les métadonnées du système de fichiers sont lues : le contenu des fichiers n'est jamais ouvert. Les dossiers illisibles sont signalés plutôt que comptés à zéro, et les liens symboliques ne sont pas suivis (leur cible serait comptée deux fois)._
- **Suppression sécurisée** — Écraser le contenu d'un fichier avant de le supprimer, pour rendre sa récupération logicielle très improbable. · aussi dans *Sécurité & Confidentialité*
  <br>_Effacement logiciel renforcé, pas effacement physique : sur SSD, carte mémoire, Btrfs/ZFS/APFS, ou en présence d'instantanés et de sauvegardes, aucun logiciel ne peut garantir la disparition de toutes les copies antérieures._
- **Diviser un gros fichier** — Découper un fichier volumineux en morceaux numérotés, avec manifeste de vérification.
- **Réassembler un fichier** — Reconstituer un fichier à partir de ses morceaux .part001, avec vérification d'empreinte.
- **Générer l'arborescence d'un dossier** — Produire l'arborescence en texte d'un dossier, prête à coller dans un README. · aussi dans *Développeur*
- **Inspecter un fichier** — Type réel détecté par signature, cohérence de l'extension, encodage, dates, empreintes et premiers octets. · aussi dans *Sécurité & Confidentialité*
  <br>_Le type affiché est celui des premiers octets, pas celui de l'extension : un « .jpg » contenant un PNG est signalé comme tel. Rien n'est renommé automatiquement — la correction reste une action que vous demandez._
- **Comparer deux dossiers** — Voir ce qui est identique, modifié, ou présent d'un seul côté entre deux arborescences.
  <br>_Le mode rapide compare type et taille sans rien lire : deux fichiers de même taille y sont dits « probablement identiques ». Seul le mode fiable confirme l'égalité par le contenu — et il ne lit que les fichiers de même taille, une taille différente suffisant à conclure._
- **Synchroniser des dossiers** — Mettre une destination à jour depuis une source, avec plan détaillé avant toute écriture.
  <br>_Synchronisation à sens unique : la source fait foi, la destination la suit. Rien n'est écrit avant que vous ayez lu le plan. Le mode miroir supprime de la destination ce qui n'existe plus dans la source, et demande une confirmation distincte._
- **Rechercher dans des fichiers** — Trouver des fichiers par nom, type, taille, date — ou par le texte qu'ils contiennent. · aussi dans *Texte & Documents*
  <br>_Recherche à la demande : FourTout n'indexe rien en fond et ne conserve rien entre deux recherches. La recherche de contenu n'ouvre que ce qui ressemble vraiment à du texte — un binaire n'est jamais interprété comme tel._
- **Prévisualiser un fichier** — Ouvrir n'importe quel fichier sans son application : texte, image, PDF, audio, vidéo, archive ou octets bruts.
  <br>_L'aperçu est choisi d'après le contenu réel, pas d'après l'extension. Les fichiers texte volumineux ne sont chargés que partiellement, et l'aperçu le dit._
- **Éditer en hexadécimal** — Lire et corriger les octets d'un fichier, fenêtre par fenêtre, sans jamais le charger en entier. · aussi dans *Développeur*
  <br>_Éditeur volontairement borné : pas de modèles binaires, pas de script, pas d'insertion ni de suppression d'octets — seulement des corrections en place, qui ne changent jamais la taille du fichier. Par défaut, le résultat est enregistré dans un nouveau fichier._
- **Sauvegarder un dossier** — Copier un dossier avec un manifeste d'empreintes, pour pouvoir vérifier et restaurer plus tard. · aussi dans *Sécurité & Confidentialité*
  <br>_Format transparent : un dossier « donnees » qui reproduit votre arborescence, et un « manifeste.json » lisible. Aucun conteneur propriétaire — même sans FourTout, vos fichiers restent accessibles. Ce n'est pas une sauvegarde versionnée : chaque sauvegarde est une copie complète et datée._
- **Restaurer une sauvegarde** — Vérifier une sauvegarde FourTout, puis la remettre en place sans écraser ce que vous n'avez pas choisi. · aussi dans *Sécurité & Confidentialité*
  <br>_L'intégrité est vérifiée avant toute écriture : un fichier abîmé dans la sauvegarde est nommé, pas restauré en silence. Restaurer ne supprime jamais rien dans la destination._
- **Créer un manifeste d'empreintes** — Produire un fichier .sha256 listant l'empreinte de chaque fichier d'un dossier. · aussi dans *Sécurité & Confidentialité* et *Développeur*
  <br>_Le format texte produit est celui de sha256sum : il se relit avec les outils du système, sur n'importe quelle machine. MD5 et SHA-1 restent proposés pour vérifier des empreintes anciennes, mais sont signalés comme inadaptés à un usage de sécurité._
- **Vérifier un manifeste d'empreintes** — Comparer un dossier à un fichier de checksums : intact, modifié, manquant ou illisible, fichier par fichier. · aussi dans *Sécurité & Confidentialité*
  <br>_Un manifeste est une donnée, pas une instruction : une entrée qui remonterait hors du dossier vérifié (« ../ », chemin absolu) est refusée et listée, jamais suivie._
- **Compresser un fichier (GZ, XZ)** — Réduire un fichier seul en .gz ou .xz — sans en faire une archive. · aussi dans *Convertisseurs*
  <br>_« .gz » et « .xz » ne contiennent qu'un seul fichier, sans nom de dossier ni arborescence. Pour compresser plusieurs fichiers en conservant leur organisation, utilisez « Créer une archive » et son format TAR.GZ ou TAR.XZ._
- **Décompresser un fichier (GZ, XZ)** — Retrouver le fichier d'origine d'un .gz ou d'un .xz. · aussi dans *Convertisseurs*
  <br>_Un « .tar.gz » contient une arborescence : passez plutôt par « Extraire une archive », qui la rétablira. Ici, un .tar.gz redonnerait simplement le .tar._
- **Inspecter une archive** — Lister le contenu d'une archive sans l'extraire : chemins, tailles, taux de compression, entrées suspectes.
  <br>_Rien n'est décompressé : seule la table des matières de l'archive est lue. Les entrées dont le chemin sortirait du dossier d'extraction sont signalées avant même que vous n'envisagiez d'extraire._
- **Tester une archive** — Vérifier qu'une archive est intacte en la décompressant entièrement, sans rien écrire sur le disque. · aussi dans *Sécurité & Confidentialité*
  <br>_Le contenu est réellement décompressé et ses sommes de contrôle vérifiées — lister une archive ne prouverait rien, seul son en-tête serait lu. Rien n'est écrit : les octets sont comptés puis jetés._

### Convertisseurs (1)

_Passer d'un format à un autre, quel que soit le type de fichier._

- **Convertisseur universel** — Déposez un fichier : FourTout propose les conversions possibles vers les formats compatibles.
  <br>_Les conversions proposées sont dérivées des entrées/sorties déclarées par les outils du registre : aucune table séparée à maintenir, et jamais de conversion annoncée sans outil derrière._

### Développeur (18)

_Formater, encoder, générer et inspecter les formats techniques._

- **JSON — formater et valider** — Indenter, minifier et vérifier la validité d'un JSON, avec message d'erreur précis.
- **XML — formater** — Indenter et valider un document XML.
- **YAML — formater et convertir** — Formater du YAML et le convertir depuis ou vers JSON. · aussi dans *Convertisseurs*
- **SQL — formater** — Rendre lisible une requête SQL compacte ou générée.
- **Base64 — encoder et décoder** — Convertir du texte en Base64 et inversement, y compris en base64url.
- **URL — encoder et décoder** — Encoder ou décoder une URL et ses paramètres (percent-encoding). · aussi dans *Texte & Documents*
- **JWT — décoder** — Lire l'en-tête et la charge utile d'un token JWT, sans l'envoyer nulle part. · aussi dans *Sécurité & Confidentialité*
  <br>_Le token est décodé localement : il ne quitte jamais votre machine._
- **Générer des UUID** — Produire des identifiants uniques v4 ou v7, à l'unité ou par lots.
- **Testeur d'expressions régulières** — Tester une regex en direct, voir les correspondances et les groupes.
- **Timestamp Unix** — Convertir un timestamp en date lisible et inversement, avec fuseaux horaires. · aussi dans *Calculateurs*
- **Générer un hash de texte** — Calculer MD5, SHA-1, SHA-256 ou SHA-512 d'une chaîne de caractères. · aussi dans *Sécurité & Confidentialité*
- **Générer un QR Code** — Créer un QR code pour une URL, un texte, un contact ou un réseau Wi-Fi. · aussi dans *Images*
- **Lire un QR Code** — Décoder un QR code depuis une image ou une capture d'écran. · aussi dans *Images*
- **Convertir HEX, décimal, binaire** — Passer d'une base à l'autre : binaire, octal, décimal, hexadécimal. · aussi dans *Calculateurs* et *Convertisseurs*
- **Diff de code** — Comparer deux blocs de code avec coloration des ajouts et suppressions.
- **Minifier HTML, CSS, JS** — Réduire la taille du code en supprimant espaces et commentaires.
- **Formater HTML, CSS, JS** — Réindenter du code minifié ou mal formaté pour le rendre lisible.
- **Assistant cron** — Construire et expliquer une expression cron en langage clair.

### Calculateurs (17)

_Unités, pourcentages, dates, durées et calculs du quotidien._

- **Convertisseur — longueurs** — Mètres, kilomètres, miles, pieds, pouces, milles marins. · aussi dans *Convertisseurs*
- **Convertisseur — poids et masses** — Grammes, kilos, tonnes, livres, onces. · aussi dans *Convertisseurs*
- **Convertisseur — températures** — Celsius, Fahrenheit, Kelvin. · aussi dans *Convertisseurs*
- **Convertisseur — volumes** — Litres, millilitres, gallons, pintes, tasses, cuillères. · aussi dans *Convertisseurs*
- **Convertisseur — surfaces** — Mètres carrés, hectares, acres, pieds carrés. · aussi dans *Convertisseurs*
- **Convertisseur — vitesses** — km/h, m/s, mph, nœuds. · aussi dans *Convertisseurs*
- **Convertisseur — pressions** — Pascal, bar, PSI, atmosphères, mmHg. · aussi dans *Convertisseurs*
- **Convertisseur — énergie** — Joules, calories, kWh, BTU. · aussi dans *Convertisseurs*
- **Convertisseur — puissance** — Watts, kilowatts, chevaux. · aussi dans *Convertisseurs*
- **Convertisseur — données informatiques** — Octets, Ko, Mo, Go, To, et leurs équivalents binaires (Kio, Mio). · aussi dans *Convertisseurs*
- **Calculs de pourcentages** — Pourcentage d'un nombre, évolution, remise, TVA, part du total.
- **Règle de trois** — Résoudre une proportion : si A vaut B, combien vaut C ?
- **Calculs de dates** — Nombre de jours entre deux dates, ajouter ou retirer une durée.
- **Calculs de durées** — Additionner et soustraire des heures, minutes et secondes.
- **Calculer un âge** — Âge exact en années, mois et jours à partir d'une date de naissance.
- **Calculatrice scientifique** — Opérations avancées : puissances, racines, trigonométrie, logarithmes.
- **Convertisseur de devises** — Convertir des montants entre devises avec des taux récents. · aussi dans *Convertisseurs*
  <br>_Seul outil de FourTout à nécessiter Internet, uniquement pour récupérer les taux du jour. Les derniers taux connus sont réutilisés hors ligne._

### Sécurité & Confidentialité (7)

_Mots de passe, chiffrement, empreintes et effacement de données._

- **Retrouver un mot de passe PDF** — Tester des mots de passe probables pour rouvrir un PDF dont vous avez oublié le mot de passe. · aussi dans *PDF*
  <br>_Récupération locale par dictionnaire et règles, sur un document que vous êtes autorisé à ouvrir. Ce n'est pas une recherche exhaustive : un mot de passe absent du corpus ne sera pas trouvé._
- **Calculer un HMAC** — Signer un texte ou un fichier avec une clé secrète, en HMAC-SHA-256 ou SHA-512. · aussi dans *Développeur* et *Fichiers & Archives*
  <br>_La clé n'est ni enregistrée, ni journalisée, ni ajoutée aux récents : elle sert au calcul et disparaît. Elle est effacée de l'écran dès que vous quittez l'outil._
- **Générer un mot de passe** — Créer des mots de passe forts ou des phrases de passe mémorisables. · aussi dans *Développeur*
- **Tester la robustesse d'un mot de passe** — Estimer le temps nécessaire pour casser un mot de passe, hors ligne.
  <br>_L'analyse est purement locale : le mot de passe saisi n'est jamais transmis._
- **Chiffrer des fichiers** — Protéger des fichiers par un mot de passe avec un chiffrement moderne.
- **Déchiffrer des fichiers** — Retrouver le contenu d'un fichier chiffré avec FourTout.
- **Supprimer les métadonnées d'un fichier** — Nettoyer auteur, dates, appareil et position avant de partager un document. · aussi dans *Fichiers & Archives*

<!-- OUTILS:FIN -->

## Une note sur le réseau

Un seul outil de cette liste a besoin d'Internet : **Convertisseur de
devises**, pour récupérer les taux de référence de la Banque centrale
européenne. Tous les autres travaillent hors ligne.

Les outils qui s'appuient sur un modèle — **Texte vers parole**,
**Transcription audio**, **Générer des sous-titres**, **PDF vers audio** et
**Retirer l'arrière-plan** — téléchargent le leur une fois, à votre demande,
puis fonctionnent hors ligne. Voir
[MODELS.md](../technical/MODELS.md).
