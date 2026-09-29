# Captures d'écran

Captures utilisées par le `README.md`. Chaque écran existe en thème clair et
en thème sombre : le README choisit la variante selon le réglage du lecteur
(`<picture>` et `prefers-color-scheme`).

## Ce qu'il y a

| Fichier (`-light` / `-dark`) | Écran | Source |
| --- | --- | --- |
| `accueil` | Accueil — favoris, récents, les douze catégories | Interface (Chromium) |
| `recherche` | Recherche en langage courant : « réduire la taille d'une vidéo » | Interface (Chromium) |
| `pdf` | Fusionner des PDF, trois documents fictifs | Interface (Chromium) |
| `images` | Ajuster une image, aperçu en temps réel | Interface (Chromium) |
| `developpeur` | JSON — formater et valider, exemple intégré | Interface (Chromium) |
| `fichiers` | Calculer une empreinte, SHA-256 et SHA-512 | Application native Linux |
| `media` | Inspecter un média, lu par FFmpeg | Application native Linux |
| `diagnostic` | Diagnostiquer un fichier, archive ZIP tronquée | Application native Linux |

Les écrans manquants, à faire sur un poste : **[SHOTLIST.md](SHOTLIST.md)**.

## Règles

- **Aucune donnée personnelle visible.** Les fichiers montrés sont fictifs,
  générés par `scripts/showcase/fixtures.mjs`, et rangés dans `/home/demo`.
  Ni nom réel, ni chemin contenant un nom d'utilisateur, ni contenu de
  document privé.
- **Aucune maquette.** Une capture est un rendu de l'application telle
  qu'elle est. Un écran qui ne fonctionne pas dans l'aperçu navigateur est
  capturé dans l'application installée, ou pas du tout.
- **Fenêtre à 1280 × 800**, rendue en 2× puis exportée en **WebP
  1440 × 900** : les captures restent comparables entre elles.
- Taille d'interface à 100 %, densité compacte : la configuration par défaut.

## Régénérer

Tout est scripté : **[scripts/showcase/README.md](../../../scripts/showcase/README.md)**.
Gardez les noms de fichiers stables : le `README.md` les référence.
