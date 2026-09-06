# Outils développeur

Dix-huit outils, tous locaux. Ce document décrit les choix qui ne se devinent
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
`none`. Il affiche la signature en base64url et, en face, « Vérifiée par
FourTout : non — la clé n'est pas connue ».

**Aucun badge vert n'existe dans cet écran.** L'avertissement est un encart
permanent, pas une note en bas de page.

Le token est décodé sur la machine et n'est envoyé nulle part — ce que ne
garantissent pas les décodeurs JWT en ligne.

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

## Diff de code

Comparaison ligne à ligne avec coloration. Rien n'est exécuté, rien n'est
envoyé.
