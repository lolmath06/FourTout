# Guide d'utilisation

[← Documentation](../README.md)

## Sommaire

- [Trouver un outil](#trouver-un-outil)
- [Déposer des fichiers](#déposer-des-fichiers)
- [Opérations longues](#opérations-longues)
- [Enregistrer un résultat](#enregistrer-un-résultat)
- [Taille de l'interface](#taille-de-linterface)
- [Paramètres](#paramètres)
- [Confidentialité, en une ligne](#confidentialité-en-une-ligne)
- [Quelques outils qui méritent une explication](#quelques-outils-qui-méritent-une-explication)
- [Un problème ?](#un-problème-)

---

FourTout s'utilise sans lire de mode d'emploi. Cette page est là pour les
détails qui ne se devinent pas.

---

## Trouver un outil

### Décrire ce que vous voulez faire

La page d'accueil pose une seule question : **« Que voulez-vous faire ? »**.
Répondez en français courant.

| Vous tapez | FourTout propose |
| --- | --- |
| `réduire la taille d'un pdf` | Compresser un PDF |
| `gif en vidéo` | GIF vers vidéo — et pas l'inverse |
| `km en miles` | Convertisseur — longueurs |
| `mon âge` | Calculer un âge |
| `retirer métadonnées` | Supprimer les métadonnées d'un fichier |

La recherche comprend le sens de la direction : « gif en vidéo » et « vidéo en
gif » ne donnent pas le même premier résultat.

**FourTout n'invente jamais de résultat.** Si rien ne correspond, il le dit
plutôt que de proposer un outil approximatif.

### Parcourir

**Outils** montre les dix catégories. Un outil qui a du sens dans plusieurs
familles y apparaît sans être dupliqué : il est implémenté une fois, et
découvrable là où on le cherche.

### Favoris et récents

L'étoile de la page d'un outil l'ajoute aux **Favoris**. Les outils que vous
ouvrez alimentent **Récemment utilisés**. Les deux apparaissent sur l'accueil.

---

## Déposer des fichiers

Chaque outil accepte le glisser-déposer, y compris depuis le gestionnaire de
fichiers du système. Un clic sur la zone ouvre le sélecteur habituel.

Certains outils attendent **deux fichiers à la fois** : déposez-les ensemble.
C'est le cas de « Remplacer la piste audio » (la vidéo et l'audio) et des
outils de sous-titres (la vidéo et le `.srt`).

### Le convertisseur universel

Vous ne savez pas quel outil il vous faut ? Déposez le fichier dans le
**Convertisseur universel** : FourTout lit son type et propose les conversions
réellement possibles, puis ouvre l'outil spécialisé **déjà prérempli**.

Il n'implémente aucune conversion lui-même : il dérive la liste des
entrées/sorties déclarées par les outils. Aucune conversion n'est donc
proposée sans outil derrière.

---

## Opérations longues

Compresser une vidéo, faire un OCR, chercher des doublons dans un gros
dossier : ces travaux prennent du temps.

- La progression s'affiche dans l'outil, **et** dans la barre de tâches en bas
  de la fenêtre.
- Vous pouvez **quitter la page** : le travail continue et vous êtes prévenu à
  la fin.
- **Annuler** est réellement une annulation : le processus est arrêté, les
  fichiers temporaires sont supprimés, et aucun résultat partiel n'est
  présenté comme un résultat.

---

## Enregistrer un résultat

Rien n'est écrit sur le disque sans que vous le demandiez. Quand une opération
se termine, vous choisissez :

- **Enregistrer** — ouvre le sélecteur d'emplacement du système ;
- **Ouvrir le dossier** — révèle le fichier produit dans le gestionnaire de
  fichiers.

Les outils qui traitent un lot proposent un dossier de destination. **Aucun
fichier existant n'est jamais écrasé sans le dire** : en cas de collision, un
suffixe numéroté est ajouté.

Les outils destructifs — renommage en masse, organisation de dossier,
suppression sécurisée — demandent une confirmation explicite et, pour les plus
dangereux, la saisie exacte d'une phrase.

---

## Taille de l'interface

FourTout se règle comme un logiciel desktop.

| Geste | Effet |
| --- | --- |
| `Ctrl` `+` | Agrandir de 10 % |
| `Ctrl` `-` | Réduire de 10 % |
| `Ctrl` `0` | Revenir à 100 % |
| `Ctrl` + molette | Ajuster par pas de 5 % |

L'échelle va de **80 % à 150 %**, elle est enregistrée, et elle est
synchronisée avec le curseur de **Paramètres → Apparence**. Sur macOS, la
touche Commande fait la même chose.

Le zoom demande à la fenêtre elle-même de changer d'échelle : la page est
**remise en page**, le texte reste net, et les outils visuels — rognage
d'image, rognage vidéo, éditeur PDF, réorganisation des pages — gardent des
coordonnées justes.

---

## Paramètres

### Apparence

| Réglage | Valeurs |
| --- | --- |
| **Thème** | Système, Clair, Sombre |
| **Taille de l'interface** | 80 % à 150 % |
| **Densité** | Compacte (défaut) ou Confortable — change la hauteur des contrôles et l'espacement des listes |
| **Animations** | Normales ou Réduites |

*Réinitialiser les préférences d'interface* remet ces quatre réglages par
défaut sans toucher aux favoris, aux récents ni aux modèles.

### Rappels de confidentialité

Les pages d'outil affichent un rappel « traitement local ». Vous pouvez le
masquer une fois lu.

### Modèles

La synthèse vocale, la transcription et le détourage d'image ont besoin d'un
modèle, téléchargé à votre demande. Cette page permet de les installer, de voir
leur taille et leur licence, et de les supprimer. Voir [MODELS.md](../technical/MODELS.md).

### Données locales

FourTout ne conserve que vos préférences, vos favoris, vos outils récents et
le dernier relevé de taux de change. Cette page permet de tout effacer.

---

## Confidentialité, en une ligne

Tout se passe sur votre machine, sauf le **convertisseur de devises** (taux de
la Banque centrale européenne) et le **téléchargement initial des modèles de
parole**. Les deux le disent dans l'interface. Le détail :
[PRIVACY.md](../legal/PRIVACY.md).

---

## Quelques outils qui méritent une explication

### Caviarder un PDF

Le contenu masqué est **réellement supprimé** du fichier, pas simplement
recouvert d'un rectangle noir. C'est la différence entre un caviardage et une
illusion de caviardage.

### Retrouver un mot de passe PDF

Teste des mots de passe probables sur un document que vous êtes autorisé à
ouvrir. Ce n'est pas une recherche exhaustive : un mot de passe absent du
corpus ne sera pas trouvé.

### Suppression sécurisée

Écrase le contenu avant de supprimer. Sur SSD, carte mémoire ou système de
fichiers à copie sur écriture, **aucun logiciel ne peut garantir** la
disparition de toutes les copies antérieures. L'outil l'affiche avant l'action.

### JWT — décoder

Décode et affiche les *claims*. **Décodé n'est pas vérifié** : sans la clé,
personne ne peut dire si la signature est authentique. FourTout ne montre
jamais de badge « valide ».

### Word (DOCX) vers PDF

Reprend le contenu et sa structure — titres, paragraphes, gras, italique,
listes, tableaux simples. La maquette Word (colonnes, zones flottantes,
en-têtes, polices spécifiques, images) peut différer. Pour un rendu fidèle au
pixel, exportez depuis Word ou LibreOffice.

### Retirer l'arrière-plan

À ne pas confondre avec « Rendre une couleur transparente », qui efface une
couleur que vous désignez. Celui-ci **reconnaît le sujet** — une personne, un
animal, un objet — et rend transparent tout le reste, sans rien décrire.

Le modèle s'installe une fois (Paramètres → Modèles), puis tout se passe sur
votre machine : la photo n'est envoyée nulle part. Il fonctionne bien quand le
sujet est net et se détache du fond ; il se trompe sur les scènes sans sujet
évident, les fonds de la couleur du sujet, et les détails très fins comme une
mèche de cheveux isolée. Les deux réglages — adoucir le bord, corriger le
seuil — rattrapent les petits écarts.

La sortie est en **PNG** : c'est le seul format courant qui conserve la
transparence.

### Convertisseur de devises

Affiche toujours **la date du relevé** utilisé. Hors ligne, il réutilise le
dernier relevé connu en le datant ; s'il n'en a aucun, il le dit et n'affiche
aucun chiffre.

### Outils audio et vidéo

Ils ont besoin de FFmpeg. Les formats et codecs proposés sont ceux que le
FFmpeg **installé sur votre machine** sait réellement produire : FourTout les
éprouve par un encodage d'essai, il ne se contente pas de lire la liste
annoncée. Voir [INSTALLATION.md](INSTALLATION.md#ffmpeg-audio-et-vidéo).

---

## Un problème ?

[TROUBLESHOOTING.md](TROUBLESHOOTING.md).
