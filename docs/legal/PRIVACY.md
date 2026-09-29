# Confidentialité

[← Documentation](../README.md)

## Sommaire

- [Ce qui ne quitte jamais votre machine](#ce-qui-ne-quitte-jamais-votre-machine)
- [Ce qui sort, et pourquoi](#ce-qui-sort-et-pourquoi)
- [Ce que FourTout n'a pas](#ce-que-fourtout-na-pas)
- [Ce que FourTout stocke localement](#ce-que-fourtout-stocke-localement)
- [Fichiers temporaires](#fichiers-temporaires)
- [Ce que FourTout ne peut pas protéger](#ce-que-fourtout-ne-peut-pas-protéger)
- [Vérifier ces affirmations](#vérifier-ces-affirmations)

---

FourTout traite vos fichiers sur votre machine. Cette page dit exactement ce
qui sort du poste, et ce qui n'en sort jamais — pas les intentions du projet,
mais ce que fait le code.

Tout ce qui suit est vérifiable : la couche réseau de FourTout tient dans trois
endroits du code natif — `src-tauri/src/rates.rs` (taux de change),
`src-tauri/src/models/` (modèles) et `src-tauri/src/network/` (les trois sondes
de diagnostic, qui ne sortent jamais de votre réseau local). La politique de
sécurité de contenu de l'application
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
| **JWT** | Décodé **et vérifié** localement. Ni le token ni la clé ne sont envoyés nulle part — c'est exactement ce que ne garantissent pas les décodeurs JWT en ligne. La clé n'est ni journalisée, ni enregistrée, ni ajoutée aux récents. |
| **Bases SQLite** | Ouvertes en lecture seule, sur votre disque. Aucune requête ne peut modifier le fichier, et son contenu n'est envoyé nulle part. |
| **Diagnostic et récupération** | Le fichier abîmé est lu, jamais modifié : un test recalcule son empreinte après chaque opération. Les fichiers produits sont écrits à côté, sous un nouveau nom. Rien n'est téléversé. |
| **Disques et partitions** | Inventaire en lecture seule. Les numéros de série et identifiants de volume sont affichés pendant la session et enregistrés nulle part — ni récents, ni paramètres, ni journaux. Aucune recherche en ligne de fabricant. |
| **Parole** | Une fois les modèles installés, la synthèse et la transcription s'exécutent sur votre machine. |
| **Détourage** | Le modèle de suppression d'arrière-plan tourne dans l'application, sur votre machine. L'image n'est envoyée nulle part — c'est précisément ce que ne font pas les services en ligne équivalents. |

---

## Ce qui sort, et pourquoi

Deux fonctions contactent Internet, deux seulement. Une troisième famille
d'outils ouvre des connexions, mais sur votre réseau local uniquement.

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

**Pour éviter tout appel Internet :** n'ouvrez pas cet outil. Il est le seul du
catalogue à contacter un serveur distant, et l'interface l'annonce sur sa page.

### 2. Modèles (parole et détourage)

**Ce qui part :** un téléchargement depuis GitHub (moteurs Piper et
whisper.cpp, modèles U²-Net) et Hugging Face (voix et modèles de
transcription), **à votre demande explicite**, depuis Paramètres → Modèles.

**Ce qui ne part pas :** le texte que vous faites lire, l'audio que vous faites
transcrire, l'image que vous faites détourer. Une fois le modèle installé, tout
s'exécute entièrement sur votre machine, même sans connexion.

Chaque téléchargement est vérifié par empreinte avant installation ; un fichier
dont l'empreinte ne correspond pas est rejeté et rien n'est installé.

Détails : [MODELS.md](../technical/MODELS.md).

### 3. Outils réseau — votre réseau local, et rien d'autre

**Ping**, **Tester des ports** et **Découvrir les appareils du réseau local**
ouvrent de vraies connexions. Elles vont exactement où vous les envoyez :

**Ce qui part :** des paquets ICMP vers l'hôte que vous saisissez, des
connexions TCP vers les ports que vous listez, et — pour la découverte — un écho
vers chaque adresse du sous-réseau auquel votre machine est **directement
connectée**, au maximum 256 adresses annoncées avant tout envoi.

**Ce qui ne part pas :** rien vers un service distant. Aucun résultat n'est
transmis, agrégé ni téléversé. Il n'existe aucun serveur FourTout.

**Ce qui n'est pas gardé :** ni les adresses observées, ni les noms résolus, ni
les adresses matérielles, ni l'historique des sondes. Les récents peuvent
retenir qu'un outil réseau a été ouvert ; ils ne retiennent pas la topologie de
votre réseau.

**Rien ne part sans un clic.** Aucun de ces écrans ne sonde au chargement. La
découverte affiche son interface, sa plage et son nombre de cibles, puis attend
une confirmation explicite.

**Pour éviter tout trafic :** n'ouvrez pas ces trois outils. Ils portent la
capacité « réseau », et l'interface l'annonce sur leur page — en disant qu'ils
**utilisent le réseau**, et non qu'ils exigent Internet. Seul le convertisseur
de devises porte la capacité « internet », et c'est le seul dont la page
annonce qu'une connexion Internet est nécessaire.

Détails et limites : [NETWORK.md](../features/NETWORK.md).

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
| Modèles (parole, détourage) | Fichiers téléchargés | Dossier de données de l'application |

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
src-tauri/src/rates.rs        # taux BCE — le seul appel vers Internet
src-tauri/src/models/         # téléchargement des modèles, à votre demande
src-tauri/src/network/        # sondes de diagnostic, réseau local uniquement

# Les bornes des sondes, et les tests qui les vérifient :
src-tauri/src/network/cidr.rs # 256 adresses au maximum, /24 au plus large
src-tauri/src/network/ports.rs# 256 ports au maximum par lancement

# La politique de sécurité de contenu, qui interdit à l'interface d'émettre
# la moindre requête sortante :
src-tauri/tauri.conf.json     # app.security.csp
```

Vous pouvez aussi observer le trafic réseau du processus pendant une session
FourTout : hors convertisseur de devises, téléchargement de modèle et sondes de
diagnostic que vous avez lancées vous-même, il n'y en a pas.
