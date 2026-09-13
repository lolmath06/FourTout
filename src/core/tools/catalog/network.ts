import { defineTools, IN, OUT } from "./shared";

/**
 * Outils réseau.
 *
 * Trois outils de **diagnostic local**, et rien de plus. Ils sont bornés par
 * construction : vingt paquets au plus pour un ping, 256 ports par lancement,
 * 256 adresses pour une découverte, et jamais rien au-delà du sous-réseau
 * directement connecté.
 *
 * Ce sont les seuls outils de FourTout, avec le convertisseur de devises, à ne
 * pas porter la capacité « local » : ils ouvrent de vraies connexions. Mais
 * aucun ne parle à Internet de sa propre initiative, et aucun n'envoie quoi que
 * ce soit à un service distant.
 */
export const networkTools = defineTools([
  {
    id: "network-ping",
    name: "Ping",
    description: "Mesurer si un hôte répond, et en combien de temps.",
    category: "network",
    icon: "Activity",
    keywords: [
      "ping",
      "latence",
      "icmp",
      "répond",
      "joignable",
      "perte de paquets",
      "temps de réponse",
      "diagnostic",
    ],
    aliases: ["ping", "icmp echo", "latency test"],
    capabilities: ["network"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
    note: "Envoie de vrais paquets ICMP, quatre par défaut. Si le système refuse les sockets ICMP, l'outil le dit plutôt que de mesurer autre chose.",
  },
  {
    id: "network-ports",
    name: "Tester des ports",
    description: "Voir quels ports TCP d'un hôte acceptent une connexion.",
    category: "network",
    icon: "PlugZap",
    keywords: [
      "port",
      "ports",
      "tcp",
      "tester port",
      "port ouvert",
      "port ferme",
      "connexion",
      "pare-feu",
      "service",
      "ecoute",
    ],
    aliases: ["port check", "port test", "tcp connect", "is port open"],
    capabilities: ["network"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
    note: "Un seul hôte, 256 ports au maximum par lancement, par connexion TCP ordinaire. Ce n'est pas un scanner : ni furtivité, ni détection de service, ni recherche de vulnérabilité.",
  },
  {
    id: "network-lan",
    name: "Découvrir les appareils du réseau local",
    description: "Lister les machines qui se manifestent sur votre sous-réseau.",
    category: "network",
    icon: "Radar",
    keywords: [
      "reseau local",
      "lan",
      "appareils",
      "machines",
      "scanner réseau local",
      "découverte",
      "imprimante",
      "adresse ip",
      "mac",
      "voisinage",
    ],
    aliases: ["lan discovery", "network scan", "find devices", "arp table"],
    capabilities: ["network"],
    acceptedInputs: [IN.none()],
    outputs: [OUT.none()],
    note: "Limité au sous-réseau directement connecté et à 256 adresses. La plage exacte est annoncée avant tout envoi, et rien ne part sans confirmation.",
  },
]);
