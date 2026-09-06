# Confidentialité

FourTout traite vos fichiers sur votre machine. Cette page dit exactement ce
qui sort du poste, et ce qui n'en sort jamais — pas les intentions du projet,
mais ce que fait le code.

Tout ce qui suit est vérifiable : la couche réseau de FourTout tient dans un
seul fichier natif, `src-tauri/src/rates.rs`, plus le gestionnaire de modèles
`src-tauri/src/models/`. La politique de sécurité de contenu de l'application
(`connect-src 'self' ipc:`) **interdit à l'interface d'émettre la moindre
requête sortante** : aucune page, aucun outil, aucune dépendance JavaScript ne
peut ouvrir une connexion, même par erreur.

---

## Ce qui ne quitte jamais votre machine

| Domaine | Traitement |
| --- | --- |
| **PDF** | Fusion, découpe, compression, caviardage, OCR, mots de passe : tout est fait localement, par pdf.js et pdf-lib dans l'application, ou par le moteur natif. |
| **Images** | Conversion, compression, rognage, filigrane, EXIF, OCR : traitement local. |
| **Audio et vidéo** | FFmpeg, exécuté sur votre machine sur des fichiers locaux. |
| **Texte et documents** | Analyse, nettoyage, comparaison, Markdown, DOCX : dans l'application. |
| **Fichiers et archives** | Archives, empreintes, doublons, découpage, renommage, organisation, effacement : moteur natif Rust, sur des chemins locaux. |
| **Chiffrement** | Argon2id et XChaCha20-Poly1305, en local. Le mot de passe n'est ni transmis, ni journalisé, ni écrit dans un fichier temporaire. |
| **Mots de passe** | La génération utilise le générateur cryptographique du système. L'analyse de robustesse (zxcvbn) tourne dans l'application : le mot de passe saisi n'est jamais transmis. |
| **JWT** | Décodé localement. Le token n'est envoyé nulle part — c'est exactement ce que ne garantissent pas les décodeurs JWT en ligne. |
| **Parole** | Une fois les modèles installés, la synthèse et la transcription s'exécutent sur votre machine. |

---

## Ce qui sort, et pourquoi

Deux fonctions, deux seulement.

### 1. Convertisseur de devises

**Ce qui part :** une requête `GET` vers
`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`, le flux de
référence quotidien de la Banque centrale européenne.

**Ce qui ne part pas :** le montant que vous convertissez, les devises que vous
choisissez, votre historique. La requête n'a aucun paramètre, aucun en-tête
d'identité, aucun cookie. La conversion est faite localement à partir du
tableau de taux téléchargé.

**Pourquoi la couche native :** l'appel part du binaire Rust, pas de la
WebView. La politique de sécurité de contenu de l'interface reste donc fermée,
et la promesse « FourTout n'envoie rien » se vérifie dans un seul fichier.

**Hors ligne :** le dernier relevé connu est réutilisé, **avec sa date
affichée**. Si aucun relevé n'a jamais été téléchargé, FourTout le dit et
n'affiche aucun chiffre. Aucun taux n'est jamais inventé.

**Pour éviter tout appel réseau :** n'ouvrez pas cet outil. Il est le seul du
catalogue à porter la capacité « réseau », et l'interface l'annonce sur sa
page.

### 2. Modèles de synthèse et de transcription vocale

**Ce qui part :** un téléchargement depuis GitHub (moteurs Piper et
whisper.cpp) et Hugging Face (voix et modèles), **à votre demande explicite**,
depuis Paramètres → Modèles.

**Ce qui ne part pas :** le texte que vous faites lire, l'audio que vous faites
transcrire. Une fois le modèle installé, la synthèse et la transcription
s'exécutent entièrement sur votre machine, même sans connexion.

Chaque téléchargement est vérifié par empreinte avant installation ; un fichier
dont l'empreinte ne correspond pas est rejeté et rien n'est installé.

Détails : [MODELS.md](MODELS.md).

---

## Ce que FourTout n'a pas

- **Pas de compte.** Aucune inscription, aucune connexion, aucune identité.
- **Pas de télémétrie.** Aucune mesure d'usage, aucun rapport de plantage
  automatique, aucun identifiant de machine.
- **Pas d'analytique.** Aucune page de FourTout ne charge de script tiers ; la
  politique de sécurité de contenu l'interdirait de toute façon.
- **Pas de publicité.**
- **Pas de mise à jour automatique.** FourTout ne contacte aucun serveur pour
  vérifier s'il existe une nouvelle version. C'est à vous d'aller la chercher.
- **Pas de synchronisation.** Rien n'est copié vers un nuage.

---

## Ce que FourTout stocke localement

| Donnée | Contenu | Emplacement |
| --- | --- | --- |
| Préférences | Thème, taille de l'interface, densité, animations | Stockage local de la WebView |
| Favoris | Identifiants d'outils | idem |
| Récemment utilisés | Identifiants d'outils et horodatages | idem |
| Taux de change | Dernier relevé BCE et sa date | idem |
| Modèles de parole | Fichiers téléchargés | Dossier de données de l'application |

| Système | Chemin |
| --- | --- |
| Linux | `~/.local/share/app.fourtout.desktop/` |
| Windows | `%APPDATA%\app.fourtout.desktop\` |

Aucune de ces données ne contient le contenu de vos fichiers : ce sont des
identifiants d'outils et des préférences. **Paramètres → Données locales**
permet de tout effacer.

---

## Fichiers temporaires

Certaines opérations média passent par des fichiers temporaires (concaténation
vidéo, transcodage en plusieurs passes). Ils sont créés dans le dossier
temporaire du système et **supprimés à la fin de l'opération, réussie ou
non** — y compris en cas d'annulation.

Le chiffrement de fichiers n'utilise aucun fichier temporaire : il écrit
directement le fichier de sortie, et le supprime si l'opération échoue.

---

## Ce que FourTout ne peut pas protéger

Être honnête sur les limites fait partie de la promesse :

- **Un fichier partagé reste partagé.** FourTout retire les métadonnées d'une
  photo ; il ne peut rien contre ce qui est *visible dans* l'image.
- **L'effacement sécurisé n'est pas physique.** Sur SSD, carte mémoire,
  système de fichiers à copie sur écriture, ou en présence d'instantanés et de
  sauvegardes, aucun logiciel ne peut garantir la disparition de toutes les
  copies antérieures. FourTout le dit avant l'action, pas après.
- **Un PDF caviardé par FourTout supprime réellement le contenu**, mais un PDF
  peut contenir des données que FourTout ne sait pas voir. Vérifiez le
  résultat.
- **Le système d'exploitation voit tout.** Les fichiers récents, les
  vignettes, l'indexation, la corbeille et les sauvegardes automatiques
  échappent à FourTout.

---

## Vérifier ces affirmations

```bash
# Toute la couche réseau de FourTout :
src-tauri/src/rates.rs        # taux BCE
src-tauri/src/models/         # téléchargement des modèles

# La politique de sécurité de contenu, qui interdit à l'interface d'émettre
# la moindre requête sortante :
src-tauri/tauri.conf.json     # app.security.csp
```

Vous pouvez aussi observer le trafic réseau du processus pendant une session
FourTout : hors convertisseur de devises et téléchargement de modèle, il n'y
en a pas.
