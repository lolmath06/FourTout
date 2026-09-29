# Outils développeur

[← Documentation](../README.md)

## Sommaire

- [Le principe commun](#le-principe-commun)
- [JSON — `src/core/code/data.ts`](#json--srccorecodedatats)
- [XML — `src/core/code/data.ts`](#xml--srccorecodedatats)
- [YAML — `src/core/code/yaml.ts`](#yaml--srccorecodeyamlts)
- [SQL — `src/core/code/sql.ts`](#sql--srccorecodesqlts)
- [JWT — `src/core/code/tokens.ts`](#jwt--srccorecodetokensts)
- [Vérification de signature JWT — `src/core/code/jwtVerify.ts`](#vérification-de-signature-jwt--srccorecodejwtverifyts)
- [UUID — `src/core/code/tokens.ts`](#uuid--srccorecodetokensts)
- [Timestamp Unix et bases numériques](#timestamp-unix-et-bases-numériques)
- [Expressions régulières — `src/core/code/regex.ts`, `regexRunner.ts`](#expressions-régulières--srccorecoderegexts-regexrunnerts)
- [Formatage et minification web — `src/core/code/web.ts`](#formatage-et-minification-web--srccorecodewebts)
- [Cron — `src/core/code/cron.ts`](#cron--srccorecodecronts)
- [TOML — `src/core/code/toml.ts`](#toml--srccorecodetomlts)
- [Base32 — `src/core/code/base32.ts`](#base32--srccorecodebase32ts)
- [Explorateur SQLite — `src-tauri/src/sqlite/`](#explorateur-sqlite--src-taurisrcsqlite)
- [Diff de code](#diff-de-code)

---

Vingt et un outils. Tous locaux, sauf qu'aucun n'est réseau : l'explorateur
SQLite lit un fichier sur le disque, les autres travaillent sur du texte collé. Ce document décrit les choix qui ne se devinent
pas : le traitement des entrées non fiables, et pourquoi certaines protections
sont là où elles sont.

Code : `src/core/code/`, interfaces dans `src/tools/impl/dev/`.

---

## Le principe commun

Un outil développeur reçoit du texte que quelqu'un lui donne : un JSON copié
d'une réponse d'API, un XML téléchargé, un YAML de configuration, un JWT
trouvé dans un en-tête. **Ce sont des entrées non fiables.** Elles sont
traitées comme telles.

Aucun outil de cette catégorie n'exécute jamais le code ou le contenu de
l'utilisateur. Ni `eval`, ni `new Function`, ni chargement dynamique.

---

## JSON — `src/core/code/data.ts`

`JSON.parse` natif, avec un travail supplémentaire sur l'erreur : quand
l'analyse échoue, l'outil **situe** le problème (ligne, colonne, extrait)
plutôt que de renvoyer « Unexpected token ».

Le tri des clés ne touche jamais à l'ordre des tableaux — un tableau JSON est
ordonné par définition, réordonner ses éléments changerait la donnée.

L'UTF-8 est préservé, émojis compris.

## XML — `src/core/code/data.ts`

Analyseur écrit pour FourTout, avec une règle absolue : **aucune résolution
d'entité, aucune DTD, aucune ressource externe.**

Une déclaration `<!ENTITY … SYSTEM "file:///etc/passwd">` ou une DTD externe
fait échouer l'analyse avant toute lecture. Ce n'est pas une liste noire de
motifs : l'analyseur ne sait tout simplement pas résoudre une entité externe.

Un test envoie plusieurs charges XXE — dont une pointant vers un vrai fichier
témoin — à `validateXml`, `formatXml` et `minifyXml`, et vérifie **à la fois**
qu'aucun contenu ne fuit et qu'aucune requête réseau ne part : `fetch` et
`XMLHttpRequest` sont instrumentés le temps du test.

Les sections `CDATA` sont préservées, et un chevron dans une valeur
d'attribut ne trompe pas l'analyseur.

## YAML — `src/core/code/yaml.ts`

`js-yaml`, restreint au **schéma `core`** : chaînes, nombres, booléens,
`null`, listes, tables. Rien d'autre.

Les tags qui instancient un objet — `!!js/function`, `!!python/object` — font
échouer la lecture. C'est le seul comportement acceptable pour un outil qui
lit le fichier de configuration de quelqu'un d'autre.

## SQL — `src/core/code/sql.ts`

`sql-formatter`. Rien n'est exécuté, rien n'est connecté : c'est une mise en
forme de texte.

---

## JWT — `src/core/code/tokens.ts`

**Décodé n'est pas vérifié.** Sans la clé, personne ne peut dire si la
signature est authentique.

L'outil décode l'en-tête et la charge utile, traduit les dates des *claims*
standards (`exp`, `iat`, `nbf`), signale un token expiré et l'algorithme
`none`. L'avertissement « décodé n'est pas vérifié » est un encart permanent,
pas une note en bas de page.

Le token est décodé sur la machine et n'est envoyé nulle part — ce que ne
garantissent pas les décodeurs JWT en ligne.

La vérification de signature, décrite ci-dessous, est un **second geste** dans
le même écran : elle demande une clé, et rien n'est affirmé tant qu'elle n'a pas
été fournie.

---

## Vérification de signature JWT — `src/core/code/jwtVerify.ts`

Décoder un JWT, c'est lire du base64. Le vérifier, c'est refaire le calcul
cryptographique avec la clé. La confusion entre les deux est la faille classique
des applications qui manipulent des jetons.

### Trois règles, non négociables

1. **L'algorithme vient de l'utilisateur, jamais du token.** Faire confiance au
   champ `alg` de l'en-tête, c'est laisser l'attaquant choisir la manière dont
   on vérifie sa propre signature — d'où les attaques « alg: none » et « RS256
   dégradé en HS256 ». L'en-tête est seulement *comparé* à ce que l'utilisateur
   attend ; toute divergence est un refus, et la cryptographie n'est même pas
   appelée. Le sélecteur se pré-remplit avec ce qu'annonce l'en-tête, par
   commodité, mais c'est bien la valeur affichée qui sert.
2. **`alg: none` est refusé**, quelles que soient les circonstances.
3. **Signature et claims sont deux verdicts distincts.** Un token peut être
   cryptographiquement authentique et pourtant inutilisable parce qu'il a
   expiré. L'écran affiche « SIGNATURE VALIDE » puis, séparément, « EXPIRÉ » ou
   « PAS ENCORE VALIDE ». Une expiration n'est jamais transformée en échec de
   signature.

### Ce qui est réellement vérifié

| Algorithme | Mécanisme | Clé attendue |
| --- | --- | --- |
| HS256, HS384, HS512 | HMAC-SHA (`hmac`, `sha2`) | secret partagé |
| RS256, RS384, RS512 | RSA PKCS#1 v1.5 (`rsa`) | clé **publique** PEM (SPKI ou PKCS#1) |

`ES256` n'est **pas** proposé : l'annoncer sans l'implémenter serait pire que de
ne pas le proposer. Aucun téléchargement JWKS n'est fait : tout reste local et
explicite.

Coller une clé privée est refusé avec un message qui dit pourquoi — vérifier une
signature ne demande jamais la clé privée, et un outil qui la réclamerait
apprendrait un mauvais réflexe.

### Où le calcul se fait, et pourquoi

Le calcul est **natif** (`src-tauri/src/security/jwt.rs`), pas dans la WebView.
`crypto.subtle` n'est disponible que dans un contexte sécurisé, ce qu'une WebView
servie par un protocole personnalisé n'est pas garantie d'être : faire dépendre
une vérification de signature de cette disponibilité serait une fragilité
inutile. La comparaison HMAC passe par `Mac::verify_slice`, en temps constant —
un `==` sur deux tableaux d'octets s'arrêterait au premier octet différent et
laisserait fuir, par le temps de réponse, de quoi reconstruire la signature.

Le secret traverse le pont IPC pour le calcul, puis disparaît avec la pile
d'appel. Il n'est ni journalisé, ni enregistré, ni ajouté aux récents, ni placé
dans le stockage persistant. Le champ est masqué par défaut.

### Séparation des responsabilités, et tests

La **politique** (refus, comparaison d'algorithmes, évaluation des claims) vit
en TypeScript et reçoit la primitive cryptographique par injection ; la
**cryptographie** vit en Rust. Chacune se teste sans l'autre : la politique
contre un vérificateur de test, la cryptographie contre les jetons réels de
`test-assets/generated/jwt-fixtures.json` — HS256/384/512 bonne et mauvaise clé,
RS256/384/512 bonne et mauvaise clé publique, et un jeton expiré dont la
signature reste valide.

## UUID — `src/core/code/tokens.ts`

v4 (aléatoire) et v7 (préfixé par le temps, donc triable
chronologiquement). L'aléa vient de `crypto.getRandomValues`.

Quand ce générateur est indisponible, le module **échoue bruyamment** plutôt
que de se rabattre sur `Math.random()` : un identifiant prévisible est pire
qu'une erreur. Un test le vérifie en retirant `globalThis.crypto`.

Un test tire mille v4 et contrôle le format canonique, le chiffre de version,
les bits de variante RFC 4122 et l'unicité.

## Timestamp Unix et bases numériques

Le timestamp distingue secondes et millisecondes par ordre de grandeur, et
affiche la date en local, en UTC et en ISO 8601.

Les bases numériques utilisent `BigInt` : un très grand entier fait
l'aller-retour sans perdre un chiffre. Un chiffre hors base est refusé plutôt
qu'ignoré silencieusement.

---

## Expressions régulières — `src/core/code/regex.ts`, `regexRunner.ts`

Le point le plus délicat de la catégorie.

**Le moteur d'expressions régulières de JavaScript n'est pas interruptible.**
Un motif à retour sur trace catastrophique — `(a+)+$` sur `aaaa…b` — occupe le
processeur pendant des secondes à l'intérieur d'un seul appel à `exec`. Sur
une machine de développement, **vingt-six caractères suffisent à dépasser une
demi-seconde, et trente et un à bloquer quatre secondes** : le coût double à
chaque caractère ajouté.

Aucun budget de temps mesuré *entre* deux correspondances ne peut arrêter
cela. Borner la taille du sujet n'y change rien non plus, puisque trente
caractères suffisent.

La seule interruption qui existe réellement est de **tuer le fil
d'exécution**. Le motif est donc exécuté dans un worker
(`regex.worker.ts`), que `regexRunner.ts` termine au bout de deux secondes.
Le fil principal reste libre, la fenêtre ne gèle pas, et l'utilisateur reçoit
un message qui nomme la cause.

S'y ajoutent les bornes que `runRegex` peut réellement tenir : 200 000
caractères de sujet, 1 000 correspondances, et un budget de 400 ms sur la
boucle de collecte — utile contre une recherche globale longue, inutile contre
un `exec` unique, et le code le dit.

Le worker est bundlé en **script classique** (`worker.format: "iife"` dans
`vite.config.ts`) : les workers de type module ne sont pas garantis sur toutes
les WebView visées, et un worker qui ne démarre pas ferait retomber l'outil sur
l'exécution synchrone. Ce repli existe — pour les tests, notamment — et
l'interface affiche alors un avertissement disant que la protection est
réduite, plutôt que de promettre une garantie qu'elle n'a pas.

---

## Formatage et minification web — `src/core/code/web.ts`

| Langage | Formatage | Minification |
| --- | --- | --- |
| HTML | Prettier | Minifieur écrit pour FourTout |
| CSS | Prettier | CSSO |
| JavaScript | Prettier | Terser |

Prettier et Terser **analysent** le code ; ils ne l'exécutent jamais. Une
erreur de syntaxe est signalée avec sa position, plutôt que de renvoyer le
code tel quel en faisant croire à un succès.

Le minifieur HTML préserve le contenu de `pre` et `textarea`, les commentaires
conditionnels, et ne colle pas les éléments en ligne — c'est la différence
entre minifier et casser la page. Les blocs `<style>` et `<script>` en ligne
sont minifiés ; un script en ligne inanalysable est **laissé intact** plutôt
que supprimé.

Un test vérifie que le JavaScript minifié reste **syntaxiquement valide**, en
le redonnant à l'analyseur — jamais à un moteur d'exécution.

---

## Cron — `src/core/code/cron.ts`

`cronstrue` explique l'expression en français, `cron-parser` calcule les
prochaines occurrences réelles.

L'outil avertit du piège classique : quand les champs *jour du mois* et *jour
de la semaine* sont tous deux renseignés, cron applique un **OU**, pas un ET.
C'est la source d'erreur la plus fréquente des expressions cron, et elle ne se
voit pas.

Une expression qui n'a pas cinq champs, ou dont une valeur est hors bornes,
est refusée avec une explication.


---

## TOML — `src/core/code/toml.ts`

Bibliothèque : `smol-toml` (BSD-3-Clause), analyseur TOML 1.0.0.

Deux services, et la frontière entre eux est le point du document :

- **Valider** ne touche à rien. En cas d'erreur, la ligne et la colonne sont
  rendues, avec l'extrait que le parseur pointe. Le préfixe technique
  « Invalid TOML document: » est retiré, et aucune trace d'exécution n'atteint
  l'écran.
- **Reformater** réécrit le document à partir de son **modèle de données**.

Ce second point a une conséquence qu'il serait malhonnête de taire : les
commentaires, les lignes vides et l'ordre d'écriture d'origine **disparaissent**,
parce qu'ils n'existent pas dans le modèle de données. L'interface l'affiche
avant le reformatage, et compte les lignes de commentaire du document courant
pour que le chiffre soit concret. Un test vérifie que la limitation est réelle
et qu'elle est bien annoncée — et un autre vérifie qu'un `#` à l'intérieur d'une
chaîne n'est pas compté comme un commentaire.

Ce que le reformatage **conserve** exactement, en revanche : tables, tables
imbriquées, tableaux de tables, dates et heures, nombres, booléens, chaînes
multilignes et littérales. Le test le vérifie en comparant la projection JSON
du document avant et après.

Préserver aussi les commentaires demanderait un modèle qui conserve la mise en
forme d'origine (`toml_edit` côté Rust) — et un reformatage qui, par
construction, ne reformate presque rien. Le choix assumé est : réécriture
canonique, limitation dite.

---

## Base32 — `src/core/code/base32.ts`

RFC 4648, sans dépendance. Deux alphabets : le standard (`A–Z`, `2–7`) et la
variante hexadécimale étendue (`0–9`, `A–V`), qui trie dans le même ordre que
les octets qu'elle encode.

Les dialectes maison — Crockford, z-base-32 — ne sont pas proposés. Ce ne sont
pas des variantes d'options mais d'autres encodages : les ranger sous le même
nom laisserait croire qu'un décodeur RFC 4648 sait les lire.

Le décodeur refuse trois choses qu'un encodeur conforme ne produit jamais :

- une longueur utile de 1, 3 ou 6 caractères, qui ne correspond à aucun nombre
  entier d'octets ;
- un `=` ailleurs qu'en fin de chaîne ;
- des bits de remplissage non nuls.

Les espaces et retours à la ligne sont ignorés au décodage, et les minuscules
acceptées : un Base32 recopié depuis un terminal ou un courriel se lit tel quel.

Les vecteurs de la section 10 de la RFC (`f` → `MY======` … `foobar` →
`MZXW6YTBOI======`) sont vérifiés dans les deux sens, et un aller-retour sur
« FourTout — été » garantit que les octets reviennent identiques.

---

## Explorateur SQLite — `src-tauri/src/sqlite/`

Bibliothèque : `rusqlite` (MIT), en mode `bundled` — la bibliothèque SQLite est
compilée avec l'application, ce qui garantit la même version et le même
comportement sur Fedora et sur Windows, sans dépendre de ce qui est installé.

Un fichier `.sqlite` est souvent la mémoire d'une application : l'historique
d'un navigateur, les notes d'un téléphone, la base d'un logiciel de gestion. On
vient l'ouvrir pour comprendre. Une modification accidentelle y serait d'autant
plus grave qu'elle est silencieuse — SQLite n'a pas de corbeille.

### Trois verrous, pas un filtre

La lecture seule n'est pas assurée par un examen du texte de la requête, qui
laisserait toujours passer une tournure imprévue. Elle repose sur trois
mécanismes indépendants :

1. **La connexion** est ouverte avec `SQLITE_OPEN_READ_ONLY`. Le moteur refuse
   toute écriture au niveau du fichier.
2. **`PRAGMA query_only`** interdit en plus les écritures en mémoire et dans les
   bases temporaires.
3. **Un autorisateur** (`Connection::authorizer`) est consulté par SQLite pour
   chaque action, sur la requête **déjà analysée**. Il n'autorise que `Read`,
   `Select`, `Function`, `Recursive` et une liste blanche de `PRAGMA`. C'est lui
   qui arrête un `INSERT` caché dans un `WITH`, un `ATTACH` vers un autre
   fichier, ou un `PRAGMA` d'écriture.

Le contrôle syntaxique (`guard::classify`) existe malgré tout, mais uniquement
pour **expliquer** un refus avant exécution — « INSERT est refusé ici » plutôt
qu'un « not authorized » opaque. Il n'est jamais la défense.

Les `PRAGMA` autorisés sont séparés en deux listes, et la distinction n'est pas
cosmétique : beaucoup de pragmas SQLite lisent quand on les interroge et
**écrivent** quand on leur donne une valeur (`PRAGMA user_version` lit,
`PRAGMA user_version = 42` écrit). Ceux qui prennent un argument de table
(`table_info(users)`) sont autorisés avec argument ; les autres uniquement sans
valeur.

### Le test qui compte

`src-tauri/tests/phase11.rs` calcule le SHA-256 de la base de référence, lance
vingt-huit requêtes d'écriture — `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`,
`CREATE`, `REPLACE`, `VACUUM`, `REINDEX`, `ANALYZE`, `ATTACH`, `DETACH`, quatre
`PRAGMA` d'écriture, une écriture dans `sqlite_master`, et trois écritures
déguisées derrière une lecture ou un CTE — puis recompare l'empreinte. Elle doit
être strictement identique.

Un second test vérifie l'inverse : les pragmas d'information restent
utilisables. Le verrou ne stérilise pas l'outil, il interdit les écritures.

### Affichage

Un `NULL` n'est pas une chaîne vide, et un **BLOB n'est jamais rendu comme du
texte** : il s'affiche comme `BLOB · n octets`, avec un aperçu hexadécimal des
seize premiers octets en info-bulle.

À l'export CSV, la convention s'inverse pour une raison précise : un `NULL`
devient une cellule **vide**, sans quoi on ne distinguerait plus une absence de
valeur d'un texte valant littéralement « NULL ». Un BLOB prend la notation
`X'…'` de la ligne de commande `sqlite3`. L'écriture passe par
`src/core/text/csv.ts`, le même écrivain que le reste de l'application.

L'affichage s'arrête à 500 lignes par défaut, 5 000 au maximum, avec pagination
par table. Les identifiants sont échappés par redoublement du guillemet double :
une table peut légitimement s'appeler `mes "notes"`.

Un fichier qui n'est pas une base est reconnu avant d'appeler le moteur, à sa
signature `SQLite format 3` — le message parle alors de signature manquante, et
mentionne le cas d'une base chiffrée, plutôt que de rendre « file is not a
database ».

---

## Diff de code

Comparaison ligne à ligne avec coloration. Rien n'est exécuté, rien n'est
envoyé.
