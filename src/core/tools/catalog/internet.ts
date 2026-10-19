import { defineTools, OUT } from "./shared";

/**
 * Outils Internet.
 *
 * Contrairement au reste de FourTout, **chacun de ces outils contacte un
 * serveur distant** — et le dit sur sa page, avec le nom de ce serveur. Aucune
 * requête ne part sans un clic ; aucune ne part en arrière-plan.
 *
 * Les connexions partent du moteur natif, pas de la WebView, et ces outils ne
 * portent donc pas la capacité « local » : le rappel « vos fichiers restent
 * sur votre appareil » serait faux pour eux.
 */
const URL_INPUT = { kind: "url" as const, extensions: ["*"] };

export const internetTools = defineTools([
  {
    id: "url-download",
    name: "Télécharger un fichier depuis une URL",
    description: "Enregistrer un fichier HTTP ou HTTPS, avec reprise, progression et vérification d'empreinte.",
    category: "internet",
    icon: "ArrowDownToLine",
    keywords: [
      "télécharger", "télécharger un fichier", "lien de téléchargement", "download", "wget", "curl",
      "reprendre un téléchargement", "url vers fichier", "enregistrer un lien",
    ],
    aliases: ["download file", "download from url", "file downloader", "wget"],
    capabilities: ["network", "internet", "produces-files", "long-running"],
    acceptedInputs: [URL_INPUT],
    outputs: [OUT.data()],
    note: "FourTout contacte l'adresse que vous indiquez, et elle seule. Le fichier n'apparaît sous son nom définitif qu'une fois complet.",
  },
  {
    id: "media-download",
    name: "Télécharger un média depuis Internet",
    description: "Récupérer une vidéo ou un son public en MP4, WebM, MP3, M4A, Opus, WAV ou FLAC, via yt-dlp.",
    category: "internet",
    alsoIn: ["video", "audio"],
    icon: "Download",
    keywords: [
      "youtube", "télécharger une vidéo", "youtube en mp3", "youtube en mp4", "télécharger de la musique",
      "extraire le son d'un lien", "vidéo en ligne", "yt-dlp", "télécharger un clip", "vimeo",
    ],
    aliases: ["download video", "youtube downloader", "youtube to mp3", "youtube to mp4", "yt-dlp"],
    capabilities: ["network", "internet", "produces-files", "long-running", "needs-sidecar"],
    acceptedInputs: [URL_INPUT],
    outputs: [OUT.video(["mp4", "webm"]), OUT.audio(["mp3", "m4a", "opus", "ogg", "wav", "flac"])],
    note: "yt-dlp contacte le service de médias ; il est installé à votre demande, vérifié par empreinte. Seuls les contenus publics sont pris en charge : ni DRM, ni compte, ni cookies.",
  },
  {
    id: "media-url-excerpt",
    name: "Télécharger un extrait d'une vidéo en ligne",
    description: "Ne récupérer que la partie voulue d'une vidéo publique, de tel instant à tel instant.",
    category: "internet",
    alsoIn: ["video", "audio"],
    icon: "Scissors",
    keywords: [
      "extrait youtube", "découper une vidéo en ligne", "partie d'une vidéo", "clip d'une vidéo",
      "télécharger un passage", "couper une vidéo youtube", "début et fin",
    ],
    aliases: ["download video clip", "youtube clip", "cut online video", "video excerpt"],
    capabilities: ["network", "internet", "produces-files", "long-running", "needs-sidecar"],
    acceptedInputs: [URL_INPUT],
    outputs: [OUT.video(["mp4", "webm"]), OUT.audio(["mp3", "m4a", "opus", "ogg", "wav", "flac"])],
    note: "Quand le service le permet, seul l'extrait est téléchargé ; sinon la source entière l'est, puis découpée ici — l'outil vous dit lequel des deux s'est produit.",
  },
  {
    id: "media-url-gif",
    name: "Vidéo en ligne vers GIF ou WebP animé",
    description: "Créer un GIF ou un WebP animé de taille raisonnable à partir de quelques secondes d'un lien public.",
    category: "internet",
    alsoIn: ["video", "images"],
    icon: "Film",
    keywords: [
      "gif youtube", "créer un gif depuis un lien", "webp animé depuis un lien", "meme", "boucle",
      "gif depuis une url", "animation depuis une vidéo",
    ],
    aliases: ["online video to gif", "youtube to gif", "url to gif", "video url to webp"],
    capabilities: ["network", "internet", "produces-files", "long-running", "needs-sidecar"],
    acceptedInputs: [URL_INPUT],
    outputs: [OUT.image(["gif", "webp"])],
    note: "Seul l'extrait demandé est utilisé, en 720 p au plus : une animation n'a pas besoin de plus. Des réglages modestes sont proposés par défaut, car un GIF grossit très vite.",
  },
  {
    id: "url-shorten",
    name: "Raccourcir une URL",
    description: "Obtenir un lien court auprès d'un service public (is.gd, v.gd ou TinyURL), à copier en un clic.",
    category: "internet",
    icon: "Link2",
    keywords: ["raccourcir un lien", "lien court", "short url", "bitly", "tinyurl", "is.gd", "réduire une adresse"],
    aliases: ["url shortener", "shorten link", "short link", "link shortener"],
    capabilities: ["network", "internet"],
    acceptedInputs: [URL_INPUT],
    outputs: [OUT.none()],
    note: "L'adresse d'origine est envoyée au service que vous choisissez, qui la conserve : ne raccourcissez rien de confidentiel. FourTout n'ajoute aucun suivi.",
  },
  {
    id: "web-to-pdf",
    name: "Page web vers PDF",
    description: "Imprimer une page web en PDF avec un navigateur Chromium déjà installé, format et marges au choix.",
    category: "internet",
    alsoIn: ["pdf"],
    icon: "Printer",
    keywords: [
      "page web en pdf", "site en pdf", "imprimer une page", "enregistrer une page en pdf", "article en pdf",
      "html en pdf", "url en pdf",
    ],
    aliases: ["webpage to pdf", "url to pdf", "print page to pdf", "website to pdf"],
    capabilities: ["network", "internet", "produces-files", "long-running"],
    acceptedInputs: [URL_INPUT],
    outputs: [OUT.pdf()],
    note: "La page est chargée par un navigateur isolé (profil temporaire vierge : ni vos cookies, ni votre historique). Chrome, Chromium ou Edge doit être installé.",
  },
  {
    id: "web-to-image",
    name: "Page web vers image",
    description: "Capturer une page web, en entier ou à la taille de la fenêtre, en PNG, JPEG ou WebP.",
    category: "internet",
    alsoIn: ["images"],
    icon: "Camera",
    keywords: [
      "capture d'écran d'un site", "screenshot page web", "page entière en image", "site en png",
      "capture pleine page", "url en image",
    ],
    aliases: ["webpage to image", "website screenshot", "full page screenshot", "url to png"],
    capabilities: ["network", "internet", "produces-files", "long-running"],
    acceptedInputs: [URL_INPUT],
    outputs: [OUT.image(["png", "jpg", "webp"])],
    note: "La page est chargée par un navigateur isolé (profil temporaire vierge). Une capture pleine page est plafonnée à 20 000 pixels de haut.",
  },
  {
    id: "web-save-offline",
    name: "Enregistrer une page web hors ligne",
    description: "Sauvegarder une page et ses ressources dans un seul fichier MHTML, lisible sans connexion.",
    category: "internet",
    icon: "FileDown",
    keywords: [
      "sauvegarder une page", "page hors ligne", "mhtml", "archiver un site", "enregistrer une page web",
      "page en un seul fichier", "lire plus tard",
    ],
    aliases: ["save webpage offline", "mhtml", "web archive", "save page as"],
    capabilities: ["network", "internet", "produces-files", "long-running"],
    acceptedInputs: [URL_INPUT],
    outputs: [OUT.data(["mhtml"])],
    note: "La page est chargée par un navigateur isolé (profil temporaire vierge). Le fichier MHTML s'ouvre dans Chrome, Edge et la plupart des navigateurs Chromium.",
  },
]);
