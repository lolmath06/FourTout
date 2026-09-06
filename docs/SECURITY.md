# Sécurité

Cette page décrit le modèle de sécurité de FourTout : ce qu'il protège, ce
qu'il ne protège pas, les choix cryptographiques réels, et comment signaler
une vulnérabilité.

---

## Signaler une vulnérabilité

**Ne l'ouvrez pas en ticket public.**

Utilisez l'onglet **Security → Report a vulnerability** du dépôt GitHub
(*private vulnerability reporting*), qui crée un échange privé.

Merci d'inclure : la version de FourTout, le système d'exploitation, les
étapes de reproduction, et l'impact que vous constatez. Un fichier de
démonstration minimal aide énormément.

Vous recevrez un accusé de réception. Un correctif sera publié avant toute
divulgation publique, et vous serez crédité si vous le souhaitez.

---

## Modèle de menace

FourTout est une **application locale monoposte**. Il n'y a ni serveur, ni
compte, ni communication entre utilisateurs. Les surfaces d'attaque réelles
sont donc :

1. **Les fichiers que l'utilisateur ouvre.** Une archive piégée, un PDF
   malformé, un XML hostile, un YAML avec des tags exécutables : ce sont des
   entrées non fiables, traitées comme telles.
2. **Ce que FourTout écrit sur le disque.** Un outil qui écrit hors du dossier
   choisi est une vulnérabilité.
3. **Les secrets manipulés.** Mots de passe de chiffrement, mots de passe PDF,
   contenus chiffrés.

Ne sont **pas** dans le modèle : un attaquant qui a déjà le contrôle du compte
utilisateur, la protection contre une analyse forensique matérielle d'un SSD,
et la résistance à un adversaire disposant de moyens étatiques.

---

## Chiffrement de fichiers

Les outils **Chiffrer des fichiers** / **Déchiffrer des fichiers** produisent
des fichiers `.ftenc`. Implémentation : `src-tauri/src/files/crypto.rs`.

### Paramètres réels

| Élément | Choix | Pourquoi |
| --- | --- | --- |
| Dérivation de clé | **Argon2id**, 64 Mio, 3 passes, parallélisme 1, clé de 256 bits | Lauréat de la Password Hashing Competition, recommandation OWASP. Le coût mémoire rend les attaques GPU et ASIC nettement plus chères qu'avec PBKDF2 ou bcrypt. Ces valeurs sont au-dessus des minima OWASP tout en restant supportables sur une machine modeste. |
| Chiffrement | **XChaCha20-Poly1305** (AEAD) | Nonce de 192 bits : il peut être tiré au hasard sans risque de collision, là où les 96 bits d'AES-GCM imposent un compteur rigoureux. Rapide sans accélération matérielle, ce qui compte sur les machines sans AES-NI. |
| Sel | 16 octets, tirés du CSPRNG du système à **chaque** chiffrement | Deux chiffrements du même fichier avec le même mot de passe donnent des octets différents. |
| Nonce | Préfixe aléatoire de 16 octets + compteur de bloc sur 8 octets | Aucune répétition possible entre blocs d'un même fichier, ni entre deux fichiers. |
| Découpage | Blocs de 1 Mio, chacun chiffré et authentifié séparément | Un fichier de 20 Go ne tient pas en mémoire. |
| Données associées | En-tête complet + numéro de bloc + drapeau de dernier bloc | Interdit de réordonner, rejouer ou **tronquer** les blocs : chacune de ces manipulations casse l'authentification. |

### Format `.ftenc`

```
« FTENC\0 » | version | code KDF | mémoire | itérations | parallélisme
            | sel (16) | préfixe de nonce (16) | taille de bloc
puis, pour chaque bloc : longueur (u32 LE) | chiffré + tag Poly1305 (16)
```

Les paramètres Argon2id sont **écrits dans l'en-tête** : un fichier produit
aujourd'hui restera lisible si ces valeurs augmentent demain. À la lecture,
ils sont bornés avant toute allocation — un en-tête falsifié qui demanderait
64 Gio de mémoire est refusé.

### Ce que le format garantit

- **Confidentialité** du contenu.
- **Intégrité** : un seul octet modifié fait échouer le déchiffrement, et
  aucun contenu n'est écrit.
- **Détection de troncature** : le drapeau de dernier bloc est authentifié.
  Un fichier amputé de sa fin est refusé, il n'est pas déchiffré à moitié.
- **Aucune sortie partielle.** Mot de passe faux, fichier altéré, annulation :
  le fichier de sortie est supprimé. Un clair partiel serait pris pour un
  résultat.
- **L'original n'est jamais supprimé.**

### Ce que le format ne cache pas

- **La taille du fichier**, à l'arrondi du bloc près.
- **Le nom du fichier d'origine** : `rapport.pdf` devient `rapport.pdf.ftenc`.
- **Le fait qu'il s'agit d'un fichier FourTout chiffré** : la signature est en
  clair, pour donner un message d'erreur utile plutôt qu'un échec silencieux.

### Le mot de passe

Il n'est jamais journalisé, jamais écrit dans un fichier temporaire, jamais
placé dans l'en-tête. La clé dérivée est effacée de la mémoire après
initialisation du chiffreur (`write_volatile` + barrière de compilation).

Il n'existe **aucune récupération** : un mot de passe perdu, c'est un fichier
perdu. C'est le comportement attendu d'un chiffrement correct.

---

## Archives protégées par mot de passe

**WinZip AES-256.** Le « ZipCrypto » historique n'est **jamais** employé : il
est cassable en quelques secondes à partir de quelques octets de clair connu,
et une « archive protégée » qui ne protège pas serait un mensonge.

L'interopérabilité est vérifiée par un test automatisé qui relit l'archive
avec **7-Zip**, pas avec le code qui l'a écrite
(`src-tauri/tests/files_integration.rs`). 7-Zip, WinRAR, PeaZip, Keka et
l'Explorateur Windows ouvrent ces archives.

**Limite du format ZIP :** les **noms de fichiers** restent lisibles sans le
mot de passe. Seul le contenu est chiffré. Pour cacher aussi les noms,
chiffrez l'archive elle-même avec l'outil de chiffrement de fichiers.

---

## Traitement des entrées non fiables

### Traversée de dossiers (« zip-slip »)

À l'extraction d'une archive, chaque chemin d'entrée est résolu et comparé au
dossier de destination. Sont **refusés et listés** : les chemins remontants
(`../`), les chemins absolus, et les liens symboliques. Une fixture d'archive
piégée fait partie de la suite de tests.

L'organisation de dossier applique la même règle : une destination qui sort de
la racine choisie est refusée.

### XXE et entités XML

L'analyseur XML de FourTout **refuse toute déclaration d'entité et toute DTD
externe** avant même de commencer. Il ne résout aucune ressource : ni fichier
local, ni URL. Un test envoie plusieurs charges XXE — dont une pointant vers
un vrai fichier témoin — et vérifie à la fois qu'aucun contenu ne fuit et
qu'**aucune requête réseau ne part**, `fetch` et `XMLHttpRequest` étant
instrumentés pendant le test.

### YAML

Le lecteur YAML n'accepte que le **schéma `core`** : chaînes, nombres,
booléens, `null`, listes, tables. Aucun tag ne peut instancier un objet.
`!!js/function` et `!!python/object` échouent.

### Expressions régulières

Le moteur d'expressions régulières de JavaScript n'est pas interruptible : un
motif à retour sur trace catastrophique (`(a+)+$` sur `aaaa…b`) occupe le
processeur pendant des secondes, et **trente et un caractères suffisent à
bloquer quatre secondes**. Aucun compteur vérifié entre deux correspondances
ne peut arrêter cela.

Le testeur d'expressions régulières exécute donc le motif dans un **worker**,
qu'il **tue** au bout de deux secondes. C'est la seule interruption qui existe
réellement. S'y ajoutent des bornes sur la taille du sujet (200 000
caractères) et le nombre de correspondances (1 000).

### Calculatrice

L'expression saisie est analysée par un analyseur écrit pour cela. Ni `eval`,
ni `new Function`, ni aucune forme d'exécution : `globalThis`,
`[].constructor` et `1;alert(1)` sont des erreurs de syntaxe, pas des
programmes. Un test le vérifie.

### Code utilisateur (formatage et minification)

Le code HTML, CSS et JavaScript soumis aux outils de formatage et de
minification est **analysé, jamais exécuté**. Prettier et Terser lisent la
grammaire ; rien n'est évalué.

### Aperçu HTML et Markdown

L'aperçu du Markdown converti passe par un assainissement : les scripts, les
gestionnaires d'événements en ligne et les URL `javascript:` sont retirés.

---

## Générateurs aléatoires

| Usage | Source |
| --- | --- |
| Sels, nonces (chiffrement de fichiers) | `getrandom`, c'est-à-dire le CSPRNG du système d'exploitation |
| Mots de passe, phrases de passe | `crypto.getRandomValues` |
| UUID v4 et v7 | `crypto.getRandomValues` |

`Math.random()` n'est utilisé nulle part pour produire un secret ou un
identifiant. Quand le générateur cryptographique est indisponible, les modules
concernés **échouent bruyamment** plutôt que de se rabattre sur un hasard
prévisible ; un test le vérifie en retirant `globalThis.crypto`.

Les mots de passe sont tirés par rejet, pas par modulo : aucun biais ne
favorise le début de l'alphabet. Un test statistique le contrôle.

---

## Effacement sécurisé : ce qu'il vaut

L'outil **Suppression sécurisée** écrase le contenu du fichier à son
emplacement actuel (une passe aléatoire, ou trois passes), force l'écriture
sur le support (`flush` puis `fsync`), renomme l'entrée de répertoire pour en
retirer le nom d'origine, puis supprime.

**C'est un effacement logiciel renforcé, pas un effacement physique.** Sur un
SSD, une carte mémoire, un système de fichiers à copie sur écriture (Btrfs,
ZFS, APFS), en présence d'instantanés, d'un journal, d'une corbeille ou d'une
sauvegarde, **aucun logiciel ne peut garantir la disparition de toutes les
copies antérieures** : le contrôleur ou le système de fichiers décide seul où
les données ont été écrites.

FourTout affiche cet avertissement **avant** l'action, sans possibilité de le
masquer, et exige la saisie exacte d'une phrase de confirmation. Le terme
« irrécupérable » n'est employé nulle part sans cette réserve.

Pour un secret critique sur un SSD, la seule réponse fiable est le chiffrement
intégral du disque.

---

## Récupération de mot de passe PDF

L'outil **Retrouver un mot de passe PDF** teste des candidats issus d'un
corpus de mots de passe courants et de règles de transformation, localement.

Ce n'est **pas** une recherche exhaustive : un mot de passe absent du corpus
ne sera pas trouvé, et l'interface le dit. L'outil est destiné à un document
que vous êtes autorisé à ouvrir.

---

## Décodage JWT

**Décodé n'est pas vérifié.** Sans la clé, personne ne peut dire si la
signature d'un token est authentique. L'outil affiche un avertissement
permanent, indique explicitement « Vérifiée par FourTout : non — la clé n'est
pas connue », et **n'affiche jamais de badge vert** de validité. L'algorithme
`none` est signalé comme tel.

Le token est décodé sur la machine et n'est envoyé nulle part — c'est ce que
ne garantissent pas les décodeurs JWT en ligne.

---

## Intégrité de la chaîne de construction

- `pnpm-lock.yaml` et `src-tauri/Cargo.lock` sont versionnés : les
  constructions sont reproductibles.
- Les téléchargements du gestionnaire de modèles sont **vérifiés par
  empreinte** ; un fichier qui ne correspond pas est rejeté et rien n'est
  installé.
- La politique de sécurité de contenu de l'application interdit toute requête
  sortante depuis l'interface.

### Signature des paquets

Les installeurs **ne sont pas encore signés**. Sur Windows, SmartScreen
affichera un avertissement au premier lancement. C'est écrit dans
[INSTALLATION.md](INSTALLATION.md) plutôt que laissé à découvrir.

En attendant la signature, chaque publication est accompagnée d'un fichier
`SHA256SUMS.txt`. Vérifiez-le.

---

## Périmètre couvert par les tests

Les points ci-dessus ne sont pas des intentions : chacun est couvert par un
test automatisé.

| Sujet | Test |
| --- | --- |
| Aller-retour chiffrement, non-déterminisme, mauvais mot de passe, octet modifié, troncature, annulation, non-réutilisation de nonce | `src-tauri/src/files/crypto.rs` |
| Interopérabilité 7-Zip de l'archive AES, archive abîmée | `src-tauri/tests/files_integration.rs` |
| Traversée de dossiers à l'extraction, sortie de racine à l'organisation | `src-tauri/src/files/archive.rs`, `secure.rs` |
| Confirmation exacte et écrasement réel avant suppression | `src-tauri/src/files/secure.rs` |
| XXE sans résolution externe, tags YAML non sûrs | `src/core/code/code.test.ts` |
| Absence d'`eval` dans la calculatrice | `src/core/calc/calc.test.ts` |
| CSPRNG obligatoire, absence de biais | `src/core/security/security.test.ts`, `src/core/code/code.test.ts` |
| Retour sur trace catastrophique non interruptible par un compteur | `src/core/code/code.test.ts` |
