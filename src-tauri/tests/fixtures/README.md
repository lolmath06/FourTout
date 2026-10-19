# Fixtures binaires committées

Ces deux fichiers sont les seuls octets binaires versionnés pour les tests
natifs. Ils sont minuscules, figés, et ne peuvent pas être produits par les
scripts Node du dépôt (aucun encodeur HEIC/AVIF n'y est disponible) :

| Fichier | Taille | Contenu |
| --- | --- | --- |
| `still.heic` | 626 o | 64×64, quatre quadrants rouge/vert/bleu/jaune + disque noir ; HEVC, produit par libheif/x265 (pillow-heif 1.8) |
| `still.avif` | 397 o | même image, AV1 ; copie de `src/imaging/probe.avif` |

Ils servent à vérifier le décodage HEIC natif et la détection de capacité AVIF
d'un FFmpeg (`image_native_formats`).
