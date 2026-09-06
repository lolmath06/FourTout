# Tous les outils de FourTout

[← Documentation](../README.md)

152 outils, répartis en dix catégories. Chaque outil de cette liste est
**utilisable** : FourTout n'enregistre pas d'outil incomplet, et il n'existe
donc pas d'état « bientôt disponible ».

Un outil peut apparaître dans plusieurs catégories : il n'est implémenté
qu'une fois, mais il est découvrable là où on le cherche. Ces rattachements
secondaires sont signalés en fin de ligne.

Les notes en italique sont les limites réelles de l'outil. Elles apparaissent
aussi dans l'application, sur la page de l'outil.

## Sommaire

- [PDF](#pdf-23)
- [Images](#images-21)
- [Audio](#audio-15)
- [Vidéo](#vidéo-19)
- [Texte & Documents](#texte--documents-16)
- [Fichiers & Archives](#fichiers--archives-16)
- [Convertisseurs](#convertisseurs-1)
- [Développeur](#développeur-18)
- [Calculateurs](#calculateurs-17)
- [Sécurité & Confidentialité](#sécurité--confidentialité-6)

---

### PDF (23)

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
- **Document vers PDF** — Convertir un fichier texte, Markdown ou HTML en PDF. · aussi dans *Texte* et *Convertisseurs*
- **Ajouter du texte** — Écrire du texte sur un PDF pour remplir un formulaire ou annoter.
- **Ajouter une image ou signature** — Insérer une image, un tampon ou une signature à l'endroit voulu.
- **Ajouter un filigrane** — Apposer un texte en filigrane sur tout ou partie des pages.
- **Numéroter les pages** — Ajouter une pagination personnalisable en en-tête ou pied de page.
- **Protéger par mot de passe** — Chiffrer un PDF pour qu'il ne s'ouvre qu'avec un mot de passe. · aussi dans *Sécurité*
- **Déverrouiller un PDF** — Retirer la protection d'un PDF dont vous connaissez le mot de passe. · aussi dans *Sécurité*
  <br>_FourTout ne casse pas les protections : le mot de passe doit être connu. Pour un mot de passe oublié, voir « Retrouver un mot de passe PDF »._
- **Métadonnées PDF** — Lire et modifier titre, auteur, sujet et mots-clés d'un PDF. · aussi dans *Sécurité*
- **Extraire les images d'un PDF** — Récupérer toutes les images intégrées dans un PDF. · aussi dans *Images*
- **Extraire le texte d'un PDF** — Récupérer le texte sélectionnable d'un PDF, page par page. · aussi dans *Texte* et *Convertisseurs*
- **Modifier le texte d'un PDF** — Corriger le texte directement sur la page : double-cliquez un mot et remplacez-le. · aussi dans *Texte*
  <br>_Édition visuelle par remplacement : le texte d'origine est recouvert par la couleur de fond échantillonnée puis redessiné. Idéal pour du texte horizontal sur fond uni (documents, factures, rapports). Les zones sur fond non uni ou pivotées sont signalées et non modifiées._
- **OCR d'un PDF scanné** — Reconnaître le texte d'un PDF scanné, page par page, en français ou en anglais. · aussi dans *Texte*
  <br>_Moteur OCR local (tesseract.js) embarqué : aucune donnée n'est envoyée sur le réseau. Pour une image seule, voir « Extraire le texte d'une image »._
- **Comparer deux PDF** — Mettre en évidence les différences entre deux versions d'un document. · aussi dans *Texte*
- **Caviarder un PDF** — Masquer définitivement des zones sensibles, contenu supprimé et non simplement recouvert. · aussi dans *Sécurité*

### Images (21)

_Convertir, compresser, redimensionner et nettoyer des images._

- **Convertir une image** — Passer d'un format à un autre : PNG, JPG, WebP. Lecture aussi de GIF, BMP, TIFF, SVG. · aussi dans *Convertisseurs*
- **Compresser une image** — Réduire le poids d'une image en contrôlant la perte de qualité.
- **Redimensionner une image** — Changer les dimensions en pixels ou en pourcentage, avec ou sans ratio.
- **Rogner une image** — Recadrer visuellement une image, librement ou selon un ratio (1:1, 4:3, 16:9, 3:2).
- **Rotation et miroir** — Pivoter par quarts de tour et retourner en miroir, avec aperçu immédiat.
- **Miroir horizontal ou vertical** — Retourner une image comme dans un miroir.
- **Noir et blanc** — Convertir en niveaux de gris, ou en noir et blanc par seuil réglable.
- **Ajuster une image** — Régler luminosité, contraste, saturation et gamma, avec aperçu en temps réel.
- **Flouter ou pixelliser** — Masquer une information : flou ou mosaïque, sur toute l'image ou une zone dessinée. · aussi dans *Sécurité*
- **Supprimer la transparence** — Aplatir un PNG ou WebP transparent sur un fond uni (blanc, noir ou couleur).
- **Retirer l'arrière-plan** — Détourer automatiquement le sujet d'une photo et rendre le fond transparent. · aussi dans *Sécurité*
  <br>_Le modèle de détourage s'installe une fois depuis Paramètres → Modèles, puis fonctionne hors ligne : l'image n'est jamais envoyée sur un serveur. Il reconnaît un sujet principal net et détaché ; il se trompe sur les scènes sans sujet évident et sur les détails très fins._
- **Rendre une couleur transparente** — Effacer une couleur unie (fond) et la remplacer par de la transparence.
- **Extraire le texte d'une image (OCR)** — Reconnaître le texte d'une image, en français ou en anglais, 100 % en local. · aussi dans *Texte*
- **Texte sur une image** — Écrire du texte sur une image : légende, mème, annotation, avec placement au doigt.
- **Lire les métadonnées d'une image** — Afficher EXIF, GPS, appareil photo, date de prise de vue.
- **Supprimer les métadonnées d'une image** — Effacer EXIF et données GPS avant de partager une photo. · aussi dans *Sécurité*
- **Conversion d'images par lots** — Appliquer la même conversion à un dossier entier d'images. · aussi dans *Convertisseurs* et *Fichiers*
- **Filigrane sur une image** — Ajouter un logo ou un texte en filigrane, à l'unité ou par lots.
- **Générer un favicon** — Produire un favicon multi-tailles et le fichier .ico depuis une image. · aussi dans *Développeur*
- **Générer plusieurs tailles** — Exporter d'un coup toutes les tailles d'icônes ou de miniatures utiles. · aussi dans *Développeur*
- **Palette de couleurs** — Extraire les couleurs dominantes d'une image (HEX, RGB) et les copier. · aussi dans *Développeur*

### Audio (15)

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
- **Transcription audio** — Convertir la parole d'un fichier audio ou vidéo en texte, localement. · aussi dans *Texte* et *Vidéo*
  <br>_Modèle de reconnaissance vocale exécuté sur votre machine, installé à la demande._
- **Générer des sous-titres SRT** — Produire un fichier de sous-titres horodaté depuis un audio ou une vidéo. · aussi dans *Vidéo* et *Texte*
- **Texte vers parole** — Lire un texte à voix haute et l'enregistrer en fichier audio, sans service en ligne. · aussi dans *Texte*
- **PDF vers audio** — Transformer un PDF en livre audio grâce à la synthèse vocale locale. · aussi dans *PDF* et *Convertisseurs*
- **Fichier texte vers audio** — Convertir un fichier TXT ou Markdown en fichier audio narré. · aussi dans *Texte* et *Convertisseurs*

### Vidéo (19)

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
- **Ajouter une piste de sous-titres** — Attacher un fichier SRT ou VTT à la vidéo, activable dans le lecteur. · aussi dans *Texte*
  <br>_Déposez la vidéo et le fichier de sous-titres ensemble._
- **Incruster des sous-titres** — Graver les sous-titres dans l'image : ils s'affichent sur tous les lecteurs. · aussi dans *Texte*
  <br>_Déposez la vidéo et le fichier de sous-titres ensemble._
- **Extraire les sous-titres d'une vidéo** — Exporter en SRT ou VTT les pistes de sous-titres déjà présentes. · aussi dans *Texte*
  <br>_Seules les pistes textuelles sont exportables ; les pistes graphiques (PGS, DVD) sont des images._
- **Générer les sous-titres d'une vidéo** — Transcrire automatiquement la parole d'une vidéo, puis exporter ou incruster. · aussi dans *Audio* et *Texte*
  <br>_Utilise le modèle de transcription local déjà installé (aucun envoi sur le réseau)._
- **Traitement vidéo par lots** — Convertir, compresser, redimensionner, pivoter ou extraire l'audio de plusieurs vidéos. · aussi dans *Fichiers*

### Texte & Documents (16)

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
- **Convertir les fins de ligne** — Passer de CRLF (Windows) à LF (Unix) et inversement, avec détection préalable. · aussi dans *Fichiers* et *Développeur*
- **Word (DOCX) vers texte, Markdown ou HTML** — Extraire le contenu d'un document Word : titres, paragraphes, listes et tableaux. · aussi dans *Convertisseurs*
  <br>_La mise en page complexe (colonnes, images, styles) n'est pas restituée : FourTout extrait le contenu et sa structure._
- **Word (DOCX) vers PDF** — Convertir un document Word en PDF en conservant sa mise en page. · aussi dans *PDF* et *Convertisseurs*
  <br>_Non disponible tant que la fidélité n'est pas au rendez-vous : sans moteur de mise en page Word, les tableaux, images, colonnes, polices et sauts de page seraient perdus. Un PDF qui ne ressemble pas au document d'origine serait pire que pas de conversion du tout. En attendant : « Word vers texte, Markdown ou HTML », puis « Document vers PDF »._

### Fichiers & Archives (16)

_Compresser, extraire, comparer, renommer et organiser des fichiers._

- **Créer une archive** — Compresser des fichiers ou dossiers en ZIP, TAR ou TAR.GZ, arborescence conservée.
  <br>_Le format 7z n'est pas proposé : aucune bibliothèque 7z n'est disponible en Rust avec une maturité et une licence compatibles, et un binaire externe casserait la promesse « tout est embarqué »._
- **Extraire une archive** — Décompresser une archive ZIP, TAR ou TAR.GZ vers le dossier de votre choix.
  <br>_Aucun fichier n'est écrit hors du dossier choisi : les entrées dont le chemin remonte (« ../ »), les chemins absolus et les liens symboliques sont refusés et listés. Les formats 7z et RAR ne sont pas pris en charge._
- **Archive protégée par mot de passe** — Créer ou ouvrir une archive chiffrée par mot de passe. · aussi dans *Sécurité*
  <br>_Non disponible : le chiffrement historique du ZIP (ZipCrypto) est cassable en quelques secondes, et proposer une « archive protégée » qui ne protège pas serait trompeur. L'AES-256 du ZIP demande une brique de chiffrement supplémentaire, prévue avec les outils de chiffrement de fichiers._
- **Calculer une empreinte (hash)** — Obtenir le SHA-256, SHA-512, SHA-1 ou MD5 d'un ou plusieurs fichiers, quelle que soit leur taille. · aussi dans *Sécurité* et *Développeur*
- **Vérifier une empreinte** — Comparer l'empreinte d'un fichier à celle annoncée par sa source. · aussi dans *Sécurité*
- **Trouver les fichiers en double** — Détecter les doublons d'un dossier par contenu et non par nom.
- **Comparer deux fichiers** — Vérifier si deux fichiers sont identiques, octet par octet ou ligne par ligne.
- **Renommage en masse** — Renommer des centaines de fichiers avec un modèle, une numérotation ou une regex.
- **Nettoyer les noms de fichiers** — Retirer accents, espaces et caractères problématiques des noms de fichiers.
- **Organiser un dossier** — Ranger automatiquement les fichiers par extension, par date ou par type.
- **Analyser la taille d'un dossier** — Voir ce qui occupe réellement l'espace disque, dossier par dossier.
- **Suppression sécurisée** — Écraser le contenu d'un fichier avant de le supprimer, pour rendre sa récupération logicielle très improbable. · aussi dans *Sécurité*
  <br>_Effacement logiciel renforcé, pas effacement physique : sur SSD, carte mémoire, Btrfs/ZFS/APFS, ou en présence d'instantanés et de sauvegardes, aucun logiciel ne peut garantir la disparition de toutes les copies antérieures._
- **Diviser un gros fichier** — Découper un fichier volumineux en morceaux numérotés, avec manifeste de vérification.
- **Réassembler un fichier** — Reconstituer un fichier à partir de ses morceaux .part001, avec vérification d'empreinte.
- **Générer l'arborescence d'un dossier** — Produire l'arborescence en texte d'un dossier, prête à coller dans un README. · aussi dans *Développeur*
- **Informations sur un fichier** — Taille, dates, type MIME, type réel détecté et empreinte SHA-256 d'un fichier. · aussi dans *Sécurité*

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
- **URL — encoder et décoder** — Encoder ou décoder une URL et ses paramètres (percent-encoding). · aussi dans *Texte*
- **JWT — décoder** — Lire l'en-tête et la charge utile d'un token JWT, sans l'envoyer nulle part. · aussi dans *Sécurité*
  <br>_Le token est décodé localement : il ne quitte jamais votre machine._
- **Générer des UUID** — Produire des identifiants uniques v4 ou v7, à l'unité ou par lots.
- **Testeur d'expressions régulières** — Tester une regex en direct, voir les correspondances et les groupes.
- **Timestamp Unix** — Convertir un timestamp en date lisible et inversement, avec fuseaux horaires. · aussi dans *Calculateurs*
- **Générer un hash de texte** — Calculer MD5, SHA-1, SHA-256 ou SHA-512 d'une chaîne de caractères. · aussi dans *Sécurité*
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

### Sécurité & Confidentialité (6)

_Mots de passe, chiffrement, empreintes et effacement de données._

- **Retrouver un mot de passe PDF** — Tester des mots de passe probables pour rouvrir un PDF dont vous avez oublié le mot de passe. · aussi dans *PDF*
  <br>_Récupération locale par dictionnaire et règles, sur un document que vous êtes autorisé à ouvrir. Ce n'est pas une recherche exhaustive : un mot de passe absent du corpus ne sera pas trouvé._
- **Générer un mot de passe** — Créer des mots de passe forts ou des phrases de passe mémorisables. · aussi dans *Développeur*
- **Tester la robustesse d'un mot de passe** — Estimer le temps nécessaire pour casser un mot de passe, hors ligne.
  <br>_L'analyse est purement locale : le mot de passe saisi n'est jamais transmis._
- **Chiffrer des fichiers** — Protéger des fichiers par un mot de passe avec un chiffrement moderne.
- **Déchiffrer des fichiers** — Retrouver le contenu d'un fichier chiffré avec FourTout.
- **Supprimer les métadonnées d'un fichier** — Nettoyer auteur, dates, appareil et position avant de partager un document. · aussi dans *Fichiers*

---

## Une note sur le réseau

Un seul outil de cette liste a besoin d'Internet : **Convertisseur de
devises**, pour récupérer les taux de référence de la Banque centrale
européenne. Tous les autres travaillent hors ligne.

Les outils qui s'appuient sur un modèle — **Texte vers parole**,
**Transcription audio**, **Générer des sous-titres**, **PDF vers audio** et
**Retirer l'arrière-plan** — téléchargent le leur une fois, à votre demande,
puis fonctionnent hors ligne. Voir
[MODELS.md](../technical/MODELS.md).
