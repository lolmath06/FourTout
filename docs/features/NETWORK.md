# Outils réseau

[← Documentation](../README.md)

## Sommaire

- [Le périmètre, et pourquoi il est étroit](#le-périmètre-et-pourquoi-il-est-étroit)
- [Ping — `src-tauri/src/network/ping.rs`](#ping--src-taurisrcnetworkpingrs)
- [Test de ports — `src-tauri/src/network/ports.rs`](#test-de-ports--src-taurisrcnetworkportsrs)
- [Découverte du réseau local — `src-tauri/src/network/lan.rs`](#découverte-du-réseau-local--src-taurisrcnetworklanrs)
- [Bornage des plages — `src-tauri/src/network/cidr.rs`](#bornage-des-plages--src-taurisrcnetworkcidrrs)
- [Réactivité de l'interface](#réactivité-de-linterface)
- [Ce qui n'est pas conservé](#ce-qui-nest-pas-conservé)
- [Portabilité](#portabilité)
- [Ce que ces outils ne font pas](#ce-que-ces-outils-ne-font-pas)

---

Trois outils : `network-ping`, `network-ports`, `network-lan`. Code natif dans
`src-tauri/src/network/`, client dans `src/core/network/native.ts`, interfaces
dans `src/tools/impl/network/`.

Ce sont, avec le convertisseur de devises, les seuls outils de FourTout à ne
pas porter la capacité `local` : ils ouvrent de vraies connexions. Aucun ne
parle à Internet de sa propre initiative, et aucun n'envoie quoi que ce soit à
un service distant.

---

## Le périmètre, et pourquoi il est étroit

Un utilitaire de bureau qui embarque des sondes réseau se trouve à un pas d'un
outil de reconnaissance offensive. La ligne est tenue par des limites inscrites
dans le code, pas par une intention :

| Limite | Valeur | Où |
| --- | --- | --- |
| Paquets par ping | 20 | `ping::MAX_PACKETS` |
| Ports par lancement | 256 | `ports::MAX_PORTS` |
| Adresses par découverte | 256 | `cidr::MAX_TARGETS` |
| Préfixe exploré automatiquement | `/24` au plus large | `cidr::NARROWEST_AUTOMATIC_PREFIX` |
| Connexions simultanées | 16 | `ports::MAX_CONCURRENCY`, `lan::MAX_CONCURRENCY` |
| Délai d'attente | 100 ms à 10 s | `ports`, `ping` |

Chacune est vérifiée par un test. Une demande de `1-65535` ports est refusée
avec un message qui explique comment la réduire ; une interface en `/16` est
ramenée au `/24` qui entoure l'adresse locale plutôt qu'étendue à 65 534 hôtes.

Rien ne part sans une action explicite. La découverte affiche sa plage, son
interface et son nombre d'adresses, et attend un clic. Aucun écran ne sonde au
chargement.

---

## Ping — `src-tauri/src/network/ping.rs`

**Le paquet est fabriqué, pas le texte analysé.** Appeler `/bin/ping` ou
`ping.exe` et lire leur sortie serait le chemin court, et le mauvais : cette
sortie est traduite. « 4 paquets transmis, 4 reçus » sur une Fedora française,
« 4 packets transmitted » en anglais, un tableau entièrement différent sous
Windows, et les colonnes bougent d'une version à l'autre. FourTout construit
donc ses propres requêtes d'écho ICMP et lit les réponses.

| Plateforme | Mécanisme | Privilèges |
| --- | --- | --- |
| Linux, macOS | socket `SOCK_DGRAM` de protocole ICMP (`socket2`) | aucun, si `net.ipv4.ping_group_range` l'autorise — le réglage par défaut de Fedora |
| Windows | `IcmpSendEcho` / `Icmp6SendEcho2` (IP Helper) | aucun |

Le socket ICMP non privilégié évite `CAP_NET_RAW` et le bit setuid. Sur ce type
de socket, le noyau réécrit l'identifiant du paquet : l'appariement des réponses
se fait donc sur le **numéro de séquence**, jamais sur l'identifiant.

**Si l'ICMP n'est pas disponible, l'outil le dit et s'arrête.** Il ne remplace
pas la mesure par une connexion TCP. « L'hôte répond au ping » et « le port 80
est ouvert » sont deux affirmations différentes, et les confondre serait mentir
sur ce qui a été mesuré. Le message renvoie alors vers « Tester des ports », qui
est l'outil correct pour cette autre question.

L'absence de réponse ne prouve rien non plus : beaucoup d'hôtes et de pare-feux
sont configurés pour ignorer les échos. L'écran le rappelle quand la perte
atteint 100 %.

---

## Test de ports — `src-tauri/src/network/ports.rs`

Une connexion TCP ordinaire (`connect`), celle que ferait n'importe quel
client, refermée immédiatement. Aucune donnée n'est envoyée, aucune bannière
n'est lue.

Trois états, et leur sens exact :

| État | Ce qui s'est produit |
| --- | --- |
| `OUVERT` | La connexion a abouti : quelque chose écoute. |
| `FERMÉ` | La machine a refusé la connexion : rien n'écoute. |
| `AUCUNE RÉPONSE` | Rien avant le délai : port filtré, ou hôte injoignable. |

La colonne « service » vient d'une table de numéros d'une trentaine d'entrées.
Elle est intitulée **« service habituellement associé »**, jamais « service
détecté » : n'importe quel logiciel peut écouter sur n'importe quel port, et
affirmer le contraire à partir d'un numéro serait une invention.

L'annulation arrête réellement les sondes : les fils de travail vérifient le
drapeau avant d'ouvrir chaque connexion, et non après coup.

---

## Découverte du réseau local — `src-tauri/src/network/lan.rs`

Trois sources de renseignement, de la moins intrusive à la plus bavarde :

1. **La table de voisinage du système** — `/proc/net/arp` sous Linux,
   `GetIpNetTable` sous Windows. Elle est déjà remplie ; la lire n'envoie pas un
   seul paquet. Les entrées incomplètes (drapeau `0x0` sous Linux, type
   « invalide » sous Windows) sont écartées : elles décrivent des adresses
   interrogées **sans réponse**, et les retenir ferait apparaître des appareils
   qui n'existent pas.
2. **Un écho ICMP par adresse**, un seul, avec un délai court.
3. **Une résolution inverse du nom**, quand le système sait la faire.

Le résultat s'annonce comme **« appareils observés »**. Un équipement qui ignore
les pings et n'a parlé à personne récemment reste invisible : prétendre lister
« tous les appareils du réseau » serait faux, et l'écran le dit.

Aucun fabricant n'est affiché. Le déduire d'une adresse matérielle demanderait
d'interroger une base de préfixes OUI en ligne — ce que FourTout ne fait pas, et
aucune base locale n'est embarquée pour cela.

La sonde est un **trait** (`LanProbe`), pas un appel direct. C'est ce qui permet
de tester le bornage, la fusion des sources, la progression et l'annulation avec
des données déterministes, sans qu'un seul paquet ne parte sur le réseau du
développeur pendant la suite de tests.

---

## Bornage des plages — `src-tauri/src/network/cidr.rs`

`bounded_range(adresse, préfixe)` est le seul endroit qui décide de l'étendue
d'une découverte. Il ne renvoie jamais plus de 256 adresses.

| Interface | Plage parcourue | Cibles |
| --- | --- | --- |
| `192.168.1.42/24` | `192.168.1.1` → `192.168.1.254` | 254 |
| `10.2.3.4/16` | ramené à `10.2.3.0/24` | 254 |
| `10.2.3.4/8` | ramené à `10.2.3.0/24` | 254 |
| `10.0.0.4/30` | `10.0.0.5` → `10.0.0.6` | 2 |
| `10.0.0.4/31` | `10.0.0.4` → `10.0.0.5` | 2 |
| `10.0.0.4/32` | `10.0.0.4` | 1 |

Un `/31` (RFC 3021) et un `/32` n'ont ni adresse de réseau ni adresse de
diffusion : leurs adresses sont toutes utilisables. Un test parcourt les 33
préfixes possibles et vérifie que le plafond tient pour chacun.

La commande native **recalcule** la plage à partir du nom, de l'adresse et du
masque de l'interface : ce qui vient de la WebView ne décide jamais de l'étendue
d'une sonde.

---

## Réactivité de l'interface

Une commande Tauri déclarée `pub fn` s'exécute **en ligne, sur le fil qui traite
le message IPC** — donc, sous Linux, sur la boucle d'événements GTK. Une
découverte de 254 adresses met plusieurs secondes : déclarée ainsi, elle gelait
la fenêtre du début à la fin, jusqu'à ce que GNOME propose de forcer la
fermeture. Le résultat finissait par arriver, correct ; l'application, elle,
avait cessé de répondre.

Les trois sondes longues sont donc déclarées `pub async fn`, et leur travail
part dans `tauri::async_runtime::spawn_blocking` :

| Commande | Exécution |
| --- | --- |
| `network_lan_discover`, `network_ping`, `network_check_ports` | `async` + `spawn_blocking` |
| `network_cancel`, `network_parse_ports`, `network_interfaces`, `network_lan_plan` | synchrones — immédiates, et l'annulation doit être traitée sans attendre |

Deux conséquences voulues : le fil d'interface reste libre, donc les événements
`network://progress` atteignent réellement React pendant la sonde et le bouton
« Arrêter » est traité tout de suite ; et le travail bloquant occupe le vivier
de fils prévu pour cela plutôt qu'un fil d'exécution asynchrone, qu'il
affamerait.

Un test lit le texte de `network/command.rs` et vérifie ces déclarations.
C'est le seul endroit où la propriété est observable : aucune assertion
d'exécution en environnement headless ne verrait une fenêtre gelée.

### La résolution inverse, bornée

`getnameinfo` n'accepte aucun délai. Face à une adresse sans enregistrement PTR,
il attend ce que le résolveur du système veut bien y mettre — souvent cinq
secondes par serveur de noms. Une seule adresse muette immobiliserait un fil de
travail dix secondes, et la découverte avec lui.

La résolution part donc dans un fil dédié, attendu **1,5 s au plus**. Passé ce
délai, l'appareil s'affiche sans nom : c'est ce que l'on sait. Le nom n'est pas
supprimé pour masquer le problème — il est demandé, puis abandonné s'il tarde.

La résolution se fait par ailleurs **avant** de prendre le verrou de la liste
des appareils. L'écrire à l'intérieur de l'expression de construction la plaçait
dans le `lock()`, ce qui sérialisait les résolutions des seize fils de travail
derrière un seul mutex.

---

## Ce qui n'est pas conservé

Ni les adresses observées, ni les noms résolus, ni les adresses matérielles, ni
l'historique des sondes. Les récents peuvent mémoriser qu'un outil réseau a été
ouvert ; ils ne mémorisent pas la topologie du réseau de l'utilisateur.

Aucune commande système n'est construite à partir d'une saisie : tout passe par
des sockets, jamais par un interpréteur de commandes. Il n'y a donc pas de
chaîne à échapper, et pas d'injection possible.

---

## Portabilité

| Sujet | Linux | Windows |
| --- | --- | --- |
| Interfaces IPv4 | `if-addrs` (`getifaddrs`) | `if-addrs` (`GetAdaptersAddresses`) |
| Écho ICMP | socket `SOCK_DGRAM` ICMP | `IcmpSendEcho` |
| Table de voisinage | `/proc/net/arp` | `GetIpNetTable` |
| Connexion TCP | `std::net::TcpStream` | identique |
| Résolution de nom | `getaddrinfo` / `getnameinfo` (`dns-lookup`) | identique |

Aucun nom d'interface n'est codé en dur — ni `eth0`, ni `wlan0` — et aucune
plage n'est présumée. Les commandes `ip addr` et `ip neigh` ne sont pas
appelées.

**IPv6** : le ping accepte une adresse IPv6 explicite (`::1`, ou une adresse
littérale). La *découverte* automatique reste IPv4 : un réseau IPv6 n'a pas de
table ARP, se parcourt par sollicitation de voisins multicast et ne se balaie
pas par énumération — c'est un autre mécanisme, hors du périmètre de cette
phase.

---

## Ce que ces outils ne font pas

Et ne feront pas ici : scan furtif ou SYN, fragmentation, évasion de détection,
identification de service par bannière, empreinte de système d'exploitation,
recherche de vulnérabilités, force brute, scan d'Internet, interrogation WHOIS,
énumération DNS, usurpation ARP, capture de paquets.

Ce sont des techniques de reconnaissance offensive. Elles n'ont pas leur place
dans un utilitaire de bureau, et leur absence est un choix, pas un manque.
