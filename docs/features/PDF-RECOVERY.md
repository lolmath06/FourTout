# Récupération de mot de passe PDF

[← Documentation](../README.md)

## Sommaire

- [Où le calcul a lieu, et pourquoi](#où-le-calcul-a-lieu-et-pourquoi)
- [Le vérificateur](#le-vérificateur)
- [Le corpus et les règles](#le-corpus-et-les-règles)
- [Les niveaux](#les-niveaux)
- [Déroulement](#déroulement)
- [Fixtures de test](#fixtures-de-test)
- [Tests](#tests)
- [Limites](#limites)

---

Outil `pdf-recover-password` : retrouver le mot de passe **oublié** d'un PDF que
l'on est autorisé à ouvrir, par dictionnaire et règles, **entièrement en local**.

Ce n'est pas une recherche exhaustive de tout l'espace des mots de passe : c'est
une recherche par **candidats probables**. Un mot de passe absent du corpus et
non atteint par les règles ne sera pas trouvé — l'interface le dit clairement.

## Où le calcul a lieu, et pourquoi

La vérification d'un mot de passe PDF est du calcul cryptographique répété
plusieurs millions de fois. Elle s'exécute donc dans le **moteur natif Rust**
(`src-tauri/src/recovery/`), multi-thread, et non en JavaScript :

- le frontend (qui dispose déjà de pdf-lib) extrait **une seule fois** les
  paramètres de chiffrement du document (`/O`, `/U`, `/P`, `/ID`, révision…) et
  les transmet au backend ;
- le backend teste les candidats sur tous les cœurs et renvoie l'avancement par
  événements ;
- rien ne quitte la machine : ni le document, ni les candidats, ni le résultat.

En mode navigateur (`pnpm dev`), le moteur natif n'existe pas : l'outil affiche
un message et se désactive. Il fonctionne dans l'application (`pnpm app:dev` ou
build installé).

### Pourquoi Rust et pas JavaScript

Mesuré sur la machine de développement (Fedora, 32 fils) :

| Chiffrement | pdf-lib (chemin naïf JS) | Vérificateur Rust, 1 fil | Rust, 32 fils |
| --- | --- | --- | --- |
| AES-256 (R6) | 463 /s | 1 160 /s | **19 661 /s** |
| AES-128 / RC4 (R4/R3) | 4 117 /s | 56 639 /s | **1 168 924 /s** |

Le facteur décisif est le **profilage réel** : l'AES-256 (révision 6) utilise une
fonction de dérivation *volontairement lente* (au moins 64 tours mêlant SHA-2 et
AES-128, algorithme 2.B d'ISO 32000). Aucune implémentation ne peut la
contourner sans casser la validation. Le moteur natif la parallélise, ce qui
rend une recherche de plusieurs millions de candidats réaliste :

- **AES-256** : ~20 000 essais/s → ~14 millions de candidats (mode Complet) en
  **~12 minutes** ;
- **AES-128 / RC4** : ~1,2 million essais/s → mode Complet en **quelques secondes**.

## Le vérificateur

`src-tauri/src/recovery/verifier.rs` implémente le « standard security handler »
pour les révisions 2 à 6 :

- **R2–R4** (RC4, AES-128) : dérivation de clé MD5 (algorithme 2), validation
  RC4 (algorithmes 5/6) ;
- **R5–R6** (AES-256) : dérivation durcie SHA-2 + AES-128 (algorithme 2.B),
  validation par comparaison au sel de `/U` (algorithme 11).

Aucun raccourci : un mot de passe n'est déclaré valide que s'il l'est réellement.
La correction est vérifiée **contre de vrais PDF** chiffrés par `@cantoo/pdf-lib`
pour les trois handlers, et le test d'intégration confirme qu'un fichier chiffré
est bien rouvert.

Bibliothèques : `md-5`, `sha2`, `aes` (RustCrypto, MIT/Apache-2.0) ; RC4 est
écrit à la main (longueur de clé PDF variable à l'exécution). Multi-threading :
`rayon` (MIT/Apache-2.0). Aucune dépendance native externe, packaging inchangé
Windows/Fedora.

## Le corpus et les règles

### Corpus statique — `src-tauri/resources/wordlists/seeds.txt.gz`

Constitué **uniquement de sources légalement redistribuables** :

- mots de passe très courants (savoir public, rédigés dans le générateur) ;
- prénoms et motifs clavier/numériques courants (savoir public) ;
- dictionnaire anglais de Fedora `/usr/share/dict/linux.words`, licence **Public
  Domain** (vérifiée : `LicenseRef-Fedora-Public-Domain`), filtré aux mots
  alphabétiques de 4 à 12 lettres.

Aucune liste issue de fuites n'est téléchargée ni intégrée. Les graines sont
**dédupliquées** (exact, casse comprise, première occurrence conservée) et
**triées par probabilité** (mots de passe courants, puis prénoms, motifs, puis
dictionnaire par longueur croissante).

Chiffres de la génération actuelle :

| | Valeur |
| --- | --- |
| Graines (après déduplication) | **354 489** |
| Texte brut | 3,35 Mo |
| **Poids installé (gzip)** | **1,20 Mo** |

Régénérable par `pnpm wordlist` (nécessite le paquet Fedora `words` ; sinon le
corpus se limite aux graines rédigées). Le fichier est versionné une seule fois.

### Génération de candidats — `src-tauri/src/recovery/rules.rs`

Les millions de candidats ne sont **pas stockés** : ils sont produits à
l'exécution en déclinant chaque graine selon une séquence ordonnée de règles
(casse, suffixes chiffrés, années, symboles, substitutions « leet »). La
séquence est **priorisée** (formes les plus probables d'abord, catégories
entrelacées, à la manière des jeux de règles éprouvés type « best64 ») et
**bornée** par un budget de variantes par niveau — pas d'explosion combinatoire,
et un total prévisionnel calculable.

Déduplication : exacte à l'intérieur des variantes d'une même graine. Les
collisions entre graines distinctes (rares) ne sont pas éliminées, ce qui peut
gonfler très légèrement le total annoncé ; l'avancement affiché reste donc une
borne haute (« ~ »).

## Les niveaux

| Niveau | Graines | Budget/graine | Candidats prévus |
| --- | --- | --- | --- |
| **Rapide** | 30 000 premières | 2 | **~60 000** |
| **Étendu** | toutes (354 489) | 4 | **~1 417 956** |
| **Complet** | toutes (354 489) | 40 | **~14 179 560** |

L'utilisateur tente d'abord les probabilités fortes (Rapide) avant une recherche
plus longue.

## Déroulement

1. Dépôt du PDF → extraction des paramètres de chiffrement, affichage du type
   (AES-256 / AES-128 / RC4). Un PDF non protégé est signalé.
2. Choix du niveau → `recover_password` (commande Tauri) démarre la recherche
   sur un fil dédié et renvoie le total prévisionnel.
3. Événements `recovery://progress` : testés / total, débit, temps écoulé
   (l'interface en déduit le temps restant). Publiés à chaque lot (60 000
   candidats).
4. `recovery://done` : `found` (mot de passe + proposition d'enregistrer une
   copie déverrouillée), `exhausted`, `cancelled` ou `error`.
5. `recover_cancel` interrompt la recherche : le drapeau d'annulation est
   consulté **au sein même** de chaque lot (dans la vérification parallèle), donc
   l'arrêt est quasi immédiat (de l'ordre de la milliseconde en release), sans
   attendre la fin du lot en cours. Voir `docs/JOBS.md`.

## Fixtures de test

Générées par `pnpm test:assets` dans `test-assets/generated/`, mots de passe
**dérivés du corpus réel** pour être atteignables et placés loin :

- `pdf-recover-quick.pdf` — AES-128, mot de passe = graine de rang ~800
  (hors des 100 premiers candidats), trouvé en quelques secondes au niveau
  Rapide ;
- `pdf-recover-deep.pdf` — AES-256, mot de passe = graine profonde (rang ~8000)
  + règle « 2024 », atteignable au niveau Complet après ~360 000 candidats
  (plusieurs lots) : prouve la progression, le multi-lots et l'annulation ;
- `recovery-fixture.json` — paramètres + mots de passe, pour le test
  d'intégration Rust.

Le mot de passe exact figure dans `recovery-fixture.json` après génération.

## Tests

- `cargo test` : vérificateur (contre de vrais PDF, 3 handlers), règles, moteur
  (recherche, épuisement, annulation, progression), lecteur de corpus, commande.
- `cargo test --test recovery_integration` : rejoue une recherche sur le **corpus
  réel** et retrouve le mot de passe de la fixture rapide (se saute proprement si
  les fixtures ne sont pas générées).
- `FT_HEAVY=1 cargo test --release --test recovery_integration` : idem sur la
  fixture profonde AES-256 (~18 s, plusieurs lots).
- `cargo test --release recovery::bench -- --ignored --nocapture` : mesure de
  débit.
- Côté TS : extraction des paramètres (`encryptionInfo.test.ts`), garde du
  client hors application, avertissement d'usage de l'interface.

## Limites

- **Recherche par candidats**, pas exhaustive : un mot de passe hors corpus et
  non produit par les règles n'est pas trouvé. L'interface ne prétend jamais le
  contraire.
- **AES-256 est lent** par conception : le mode Complet peut prendre plusieurs
  minutes. Commencer par Rapide.
- Seul le **mot de passe utilisateur** (ouverture) est visé, pas le mot de passe
  propriétaire.
- Encodage des mots de passe : ASCII/UTF-8 courant. La normalisation SASLprep
  complète des mots de passe Unicode exotiques (R6) n'est pas appliquée ; sans
  effet sur l'immense majorité des mots de passe réels.
