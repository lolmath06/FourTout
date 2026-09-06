# Calculateurs

[← Documentation](../README.md)

## Sommaire

- [Le moteur d'unités — `src/core/units/index.ts`](#le-moteur-dunités--srccoreunitsindexts)
- [La calculatrice scientifique — `src/core/calc/expression.ts`](#la-calculatrice-scientifique--srccorecalcexpressionts)
- [Dates, durées et âge — `src/core/calc/datetime.ts`](#dates-durées-et-âge--srccorecalcdatetimets)
- [Pourcentages et règle de trois — `src/core/calc/arithmetic.ts`](#pourcentages-et-règle-de-trois--srccorecalcarithmeticts)
- [Convertisseur de devises — `src/core/currency/`, `src-tauri/src/rates.rs`](#convertisseur-de-devises--srccorecurrency-src-taurisrcratesrs)

---

Dix-sept outils : dix convertisseurs d'unités, cinq calculateurs, une
calculatrice scientifique, un convertisseur de devises.

Code : `src/core/units/`, `src/core/calc/`, `src/core/currency/`.
Interfaces : `src/tools/impl/calculators/`.

---

## Le moteur d'unités — `src/core/units/index.ts`

Dix convertisseurs, **un seul moteur**. Chaque dimension déclare ses unités
avec leur facteur vers une unité de référence ; le catalogue génère les dix
cartes depuis un descripteur commun, plutôt que de recopier dix définitions
quasi identiques.

### Des définitions exactes, pas des approximations

C'est le point qui distingue un convertisseur utilisable d'un convertisseur
approximatif. Les facteurs sont les définitions officielles, écrites en toutes
décimales :

| Unité | Valeur exacte |
| --- | --- |
| pouce | 25,4 mm |
| pied | 0,3048 m |
| mile | 1,609344 km |
| mille marin | 1852 m |
| livre (avoirdupois) | 0,453 592 37 kg |
| once | 28,349 523 125 g |
| gallon US | 3,785 411 784 L |
| gallon impérial | 4,546 09 L |
| acre | 4046,856 422 4 m² |
| bar | 100 000 Pa |
| atmosphère | 101 325 Pa |
| kWh | 3,6 MJ |

### Les pièges que le moteur traite explicitement

**Les températures ne sont pas un facteur.** Celsius vers Fahrenheit a une
origine décalée. Une dimension peut donc déclarer un décalage en plus d'un
facteur.

**Le gallon US n'est pas le gallon impérial**, et l'écart est de 20 %. Les
deux sont proposés, nommés distinctement.

**Le horsepower mécanique n'est pas le cheval-vapeur métrique** : 745,7 W
contre 735,5 W. La carte grise française parle du second.

**Ko n'est pas Kio.** Les préfixes décimaux (Ko, Mo, Go — puissances de 1000)
et binaires (Kio, Mio, Gio — puissances de 1024) sont deux familles
distinctes. 1 Gio vaut 1,073 741 824 Go, et un disque de 1 To affiche 0,909 Tio.
Confondre les deux est l'erreur la plus fréquente des convertisseurs de
données ; ici les deux familles coexistent, nommées.

### Ce que les tests garantissent

- Toute conversion aller-retour revient **exactement** au point de départ.
- Une conversion vers la même unité laisse la valeur strictement inchangée.
- Une unité inconnue lève une erreur, elle ne renvoie pas un chiffre faux.
- Aucun artefact flottant n'apparaît à l'affichage.

### Saisie et affichage

La virgule et les espaces des saisies réelles sont acceptés (`1 234,56`). Les
milliers sont groupés à la française. La notation scientifique n'apparaît que
lorsque le nombre devient illisible autrement.

Chaque outil affiche, sous le résultat, **la table complète des unités de sa
dimension** : la valeur saisie convertie dans toutes les unités à la fois.

---

## La calculatrice scientifique — `src/core/calc/expression.ts`

### Ni `eval`, ni `new Function`

C'est la garantie centrale. Une calculatrice qui évaluerait la saisie avec le
moteur JavaScript serait une porte d'entrée vers tout ce que l'application
peut faire, commandes natives comprises.

L'expression est analysée par un analyseur écrit pour cela : découpage en
lexèmes, puis analyse descendante respectant la priorité des opérateurs.
`globalThis`, `[].constructor` et `1;alert(1)` sont des **erreurs de
syntaxe**, pas des programmes. Un test le vérifie, et vérifie aussi que le
module ne contient ni `eval(` ni `new Function(`.

### Ce qu'elle calcule

Priorité des opérateurs (`2 + 3 * 4` = 14, `(2 + 3) * 4` = 20), puissance
associative à droite (`2^3^2` = 512, et non 64), signe unaire correct
(`-2^2` = −4).

Trigonométrie en **degrés ou en radians**, au choix : `sin(90°)` = 1 et
`sin(π/2 rad)` = 1. Logarithmes, racines, valeur absolue, factorielle bornée.

Les symboles réellement tapés ou collés sont acceptés : `×`, `÷`, `−`, `√`,
`π`.

### Les erreurs sont expliquées

Une expression invalide donne un message et, quand c'est possible, **la
position** du problème — jamais `NaN`.

---

## Dates, durées et âge — `src/core/calc/datetime.ts`

### Le calendrier, pas des multiplications

**Un mois n'est pas trente jours.** C'est l'erreur qui rend un calculateur de
dates inutilisable.

| Opération | Résultat |
| --- | --- |
| 31 janvier + 1 mois | 28 février (ou 29 en année bissextile) |
| 29 février 2024 + 1 an | 28 février 2025 |
| 31 mars − 1 mois | 28 février |

L'ajout d'une durée calendaire passe par le calendrier réel et **serre** la
date sur le dernier jour du mois cible quand le quantième n'existe pas.

### Dates locales, pas UTC

Une date saisie est lue en heure locale. Lue en UTC, un `2026-03-14` deviendrait
le 13 mars au soir pour un utilisateur à l'ouest de Greenwich.

Le calcul de différence n'est pas faussé par un changement d'heure : passer un
week-end de changement d'heure ne fait ni gagner ni perdre un jour.

### Âge

Années, mois et jours exacts, plus le total en jours. L'âge ne s'incrémente
pas la veille de l'anniversaire.

**Le 29 février est traité comme l'état civil le fait** : pour quelqu'un né un
29 février, l'anniversaire tombe le 1er mars les années non bissextiles, et le
29 février les années bissextiles.

### Durées

Les écritures réellement utilisées sont acceptées : `1h30`, `90min`,
`01:30:00`, `1:30`. Les heures ne sont **pas** bornées à 24 à l'affichage —
un total de travail de 47 h 30 s'écrit `47:30`, pas `23:30`.

---

## Pourcentages et règle de trois — `src/core/calc/arithmetic.ts`

Pourcentage d'un nombre, évolution entre deux valeurs, remise, TVA, part du
total. La **formule utilisée est affichée** avec le résultat : un calcul
vérifiable vaut mieux qu'un calcul juste.

Une variation depuis une valeur négative ne change pas de signe en route, et
les cas sans réponse (division par zéro) sont refusés plutôt que de renvoyer
l'infini.

---

## Convertisseur de devises — `src/core/currency/`, `src-tauri/src/rates.rs`

### Le seul outil de FourTout qui a besoin d'Internet

Il ne porte pas la capacité « local » dans le catalogue, et affiche un
avertissement réseau.

### Pourquoi la requête part de la couche native

Elle est émise par le binaire Rust, pas par la WebView. La politique de
sécurité de contenu de l'interface reste donc fermée (`connect-src 'self'`) :
aucune page, aucune dépendance JavaScript ne peut ouvrir une connexion. Toute
la surface réseau de l'application tient dans un fichier, et la promesse
« FourTout n'envoie rien » se vérifie d'un coup d'œil.

### Ce qui est envoyé

Rien. Une requête `GET` sans paramètre vers le flux de référence quotidien de
la Banque centrale européenne. Le montant à convertir, les devises choisies et
l'historique ne quittent jamais la machine : la conversion est faite localement
à partir du tableau de taux.

### Aucun taux n'est inventé

| Situation | Comportement |
| --- | --- |
| En ligne | Taux du jour, **avec la date de publication affichée** |
| Hors ligne, relevé en cache | Dernier relevé connu, **avec sa date** |
| Hors ligne, aucun relevé | Message explicite, **aucun chiffre affiché** |
| Devise absente du relevé | Erreur, pas d'estimation |

L'analyse du flux est volontairement minimale et ne touche jamais au
`<!DOCTYPE>` : aucune entité, aucune DTD, aucune ressource externe n'est
résolue. Un taux malformé est ignoré plutôt qu'interprété au hasard.

Le cache est considéré frais six heures — la BCE publie une fois par jour
ouvré, vers 16 h CET.

Un test d'intégration interroge le **vrai** flux et vérifie la structure de la
réponse ; il s'ignore proprement quand la machine est hors ligne, l'absence de
réseau n'étant pas une régression de FourTout.
