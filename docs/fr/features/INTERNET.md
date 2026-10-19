# Internet & Web

[English](../../features/INTERNET.md) | [Français](INTERNET.md)

[← Documentation](../README.md)

La catégorie **Internet & Web** regroupe les outils dont la raison d'être est
d'atteindre le réseau. Contrairement au reste du catalogue, ils ne sont **pas
`local`** : chacun dit, dans sa propre interface, ce qu'il contacte et ce qu'il
envoie.

| Outil | ID | Contacte |
| --- | --- | --- |
| Télécharger un fichier par URL | `url-download` | L'adresse saisie |
| Télécharger un média en ligne | `media-download` | Le site de médias indiqué, via yt-dlp |
| Télécharger un extrait de vidéo en ligne | `media-url-excerpt` | Idem |
| Vidéo en ligne vers GIF ou WebP animé | `media-url-gif` | Idem |
| Raccourcir une URL | `url-shorten` | Le service de raccourcissement choisi |
| Page web vers PDF | `web-to-pdf` | La page saisie |
| Page web vers image | `web-to-image` | La page saisie |
| Enregistrer une page web hors ligne (MHTML) | `web-save-offline` | La page saisie |
| Test de débit Internet | `speed-test` | Le service de mesure de Cloudflare (aussi listé dans Réseau) |

Sources : `src-tauri/src/internet/` (HTTP, téléchargements, test de débit,
raccourcisseur), `src-tauri/src/ytdlp/`, `src-tauri/src/webcapture/`, le client
dans `src/core/internet/` et les interfaces sous `src/tools/impl/internet/`.

## Pourquoi le réseau passe par le moteur natif

La politique de sécurité du contenu de l'interface reste
`connect-src 'self' ipc:` : la WebView n'ouvre jamais de connexion sortante.
Chaque requête est faite par le binaire Rust ; toute la surface réseau s'audite
donc dans quelques fichiers, et le même code tourne sur Fedora et Windows.

## Socle commun

`src-tauri/src/internet/http.rs` sert tous les outils ci-dessus.

- `http` et `https` uniquement. Les identifiants incorporés à l'adresse sont
  refusés.
- Les redirections sont suivies **à la main**, en nombre borné. Une redirection
  de HTTPS vers HTTP est refusée. Chaque étape est revalidée.
- Les erreurs sont structurées (`kind`, message, statut HTTP) et traduites par
  l'interface : introuvable, accès refusé, trop de requêtes, délai dépassé,
  pas de connexion, échec TLS, problème de destination, annulé.
- Tout travail long affiche sa progression et peut être annulé. L'annulation
  supprime la sortie partielle.

## Téléchargeur de fichiers

- Sonde par `HEAD`, puis par `GET` partiel quand le serveur refuse `HEAD`.
- Propose un nom d'après `Content-Disposition` (RFC 5987 comprise), puis
  l'adresse, et l'assainit (séparateurs, noms réservés Windows, longueur).
- Écrit dans `<nom>.fourtout-part`, avec un fichier annexe `.fourtout-meta` qui
  garde les validateurs. Un téléchargement interrompu **reprend** avec `Range`
  et `If-Range` uniquement si le serveur a confirmé que le fichier n'a pas
  changé ; sinon il repart de zéro et le dit.
- Somme SHA-256 attendue facultative : une différence supprime le fichier.
- N'écrase jamais en silence : la destination est choisie par vous, et un
  fichier existant est refusé sauf confirmation.
- Le fichier ne prend son nom définitif qu'après un téléchargement complet et
  vérifié.

## Médias en ligne (yt-dlp)

- Formats : MP4, WebM, MP3, M4A, Opus, WAV, FLAC. Les choix de résolution
  n'agrandissent jamais : si la source est plus petite, sa taille est gardée.
  Une taille maximale facultative réutilise le planificateur de budget de
  *Compresser à une taille maximale*.
- **Contenus publics uniquement.** FourTout ne contourne ni DRM, ni paiement, ni
  connexion, ni restriction géographique, et ne lit jamais les cookies ni le
  profil de votre navigateur. Les contenus privés, réservés aux abonnés,
  protégés par DRM, les directs et ceux qui exigent une connexion échouent avec
  un message clair.
- yt-dlp n'est **pas embarqué**. Il est installé à la demande depuis la page de
  publication officielle. L'installateur résout la dernière version, récupère
  le `SHA2-256SUMS` officiel, télécharge le binaire par le téléchargeur vérifié,
  exécute `--version` et exige qu'il égale l'étiquette, puis remplace l'ancienne
  copie de façon atomique. Un yt-dlp du système présent dans le `PATH` sert de
  repli. Emplacement : dossier de données, sous `engines/yt-dlp` (voir
  [Modèles](../technical/MODELS.md)).
- L'appel se fait par vecteur d'arguments, jamais par un shell :
  `--ignore-config`, `--no-playlist`, un séparateur `--` avant l'adresse, un
  modèle de sortie dans un dossier temporaire privé. Le titre du média n'atteint
  jamais un chemin ni un argument.
- Fusionner audio et vidéo, convertir en MP3 et couper demandent FFmpeg ;
  l'outil le dit quand il manque. Certains formats récents de YouTube exigent un
  moteur JavaScript (Deno ou Node.js) sur le système.
- Un **extrait** demande au service uniquement la section. Quand le site ne le
  permet pas, la source entière est téléchargée puis coupée localement, et le
  résultat dit ce qui s'est passé.

## Raccourcisseur d'URL

Services : is.gd, v.gd, TinyURL. L'adresse d'origine est envoyée au service que
vous choisissez, **qui la conserve** ; l'outil le dit à côté du bouton. Les
adresses qui n'ont de sens que sur votre réseau (boucle locale, plages privées)
sont refusées avant tout envoi. FourTout n'ajoute ni suivi ni compte.

## Test de débit

Flux de téléchargement et d'envoi vers les points `__down` et `__up` de
Cloudflare, en parallèle, avec une sonde de latence. Valeurs rapportées :
latence médiane, gigue (écart moyen entre mesures consécutives) et 90e
percentile des transferts assez longs. Les résultats varient avec les VPN, le
Wi-Fi, la distance au serveur et le trafic concurrent, et la page le dit. Seules
des données de test générées sont échangées ; aucun de vos fichiers.

## Capture web

- Exige un **navigateur de la famille Chromium déjà installé** (Chrome,
  Chromium, Edge, Brave). FourTout n'en embarque pas. Détection : `PATH`,
  emplacements d'installation usuels de Windows et variable `FOURTOUT_BROWSER`.
- Le navigateur démarre sans fenêtre avec un **profil temporaire vierge** : ni
  cookies, ni historique, ni extensions, ni sessions ; le port de débogage est
  local (`127.0.0.1`, éphémère). Le profil est supprimé ensuite, et l'annulation
  ou le délai dépassé abat tout l'arbre de processus (groupe de processus sous
  Linux, Job Object sous Windows).
- PDF : format de papier, orientation, marges, impression des fonds. Image :
  PNG, JPEG ou WebP, préréglages de fenêtre, page entière facultative (plafonnée
  à 20 000 px). MHTML : la page et ses ressources dans un seul fichier.
- Une page qui exige une connexion est capturée comme la verrait un visiteur
  anonyme.

## Tests

Aucun test n'atteint Internet. Un serveur HTTP local
(`src-tauri/src/internet/testserver.rs`) couvre redirections, reprises, ETag,
blocages et coupures ; yt-dlp est exercé avec un faux exécutable et un serveur
de publication local ; la capture web utilise un faux serveur DevTools, et un
test d'intégration pilote un vrai Chromium quand `FOURTOUT_BROWSER` en désigne
un. Pour les essais manuels, `pnpm fixtures:serve` sert les mêmes
comportements sur `127.0.0.1:8765` (voir [test-assets](../../../test-assets/README.md)).
