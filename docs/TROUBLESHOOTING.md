# Dépannage

---

## L'application ne démarre pas

### Linux — « error while loading shared libraries: libwebkit2gtk-4.1.so.0 »

WebKitGTK n'est pas installé.

| Distribution | Paquet |
| --- | --- |
| Fedora | `sudo dnf install webkit2gtk4.1` |
| Debian, Ubuntu | `sudo apt install libwebkit2gtk-4.1-0` |
| Arch | `sudo pacman -S webkit2gtk-4.1` |
| openSUSE | `sudo zypper install libwebkit2gtk-4_1-0` |

Le `.rpm` et le `.deb` déclarent cette dépendance : le gestionnaire de paquets
l'installe pour vous. Seule l'AppImage peut manquer de cette bibliothèque.

### Linux — fenêtre blanche ou rendu cassé

Certains pilotes graphiques posent problème à l'accélération matérielle de
WebKitGTK. Essayez de la désactiver :

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 fourtout
```

Si cela règle le problème, ajoutez la variable au lanceur de votre bureau.

### Windows — « WebView2 introuvable »

Installez le *Evergreen Runtime* depuis
[developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/microsoft-edge/webview2/).
Windows 11 et Windows 10 à jour l'ont d'origine.

### Windows — SmartScreen bloque l'installeur

Attendu : les installeurs ne sont pas encore signés. **Informations
complémentaires** → **Exécuter quand même**. Vérifiez d'abord l'empreinte
SHA-256 du fichier téléchargé contre le `SHA256SUMS.txt` de la publication.

---

## Les outils audio ou vidéo sont indisponibles

FourTout affiche « FFmpeg est introuvable » sur la page concernée.

FFmpeg n'est pas embarqué. Installez-le :

| Système | Commande |
| --- | --- |
| Fedora | `sudo dnf install ffmpeg-free` |
| Debian, Ubuntu | `sudo apt install ffmpeg` |
| Arch | `sudo pacman -S ffmpeg` |
| Windows | `winget install Gyan.FFmpeg`, ou [ffmpeg.org](https://ffmpeg.org/download.html) puis ajouter `bin` au `PATH` |

Vérifiez ensuite :

```bash
ffmpeg -version
ffprobe -version
```

**Sur Windows, redémarrez FourTout après avoir modifié le `PATH`** : un
processus ne relit pas son environnement.

### Un codec attendu n'est pas proposé

C'est voulu. FourTout ne propose que les encodeurs que votre FFmpeg sait
**réellement** utiliser : chacun est éprouvé par un encodage d'essai au
démarrage. Un `h264_nvenc` compilé dans FFmpeg mais inutilisable faute de
carte ou de pilote est annoncé exactement comme un encodeur fonctionnel, puis
échoue plusieurs secondes après le clic. FourTout préfère ne pas le proposer.

`ffmpeg-free`, de Fedora, est compilé sans certains codecs brevetés. Pour un
FFmpeg complet, ajoutez le dépôt RPM Fusion.

---

## La reconnaissance vocale ou la synthèse ne marche pas

Ces outils ont besoin d'un modèle, qui n'est pas livré avec l'application.
**Paramètres → Modèles** permet de l'installer. Il faut une connexion pour ce
téléchargement, une seule fois. Voir [MODELS.md](MODELS.md).

Si un téléchargement échoue avec une erreur d'empreinte, rien n'est installé :
c'est la vérification qui a fait son travail. Relancez le téléchargement.

---

## Le micro ne fonctionne pas (Linux)

WebKitGTK demande un arbitrage natif de la permission microphone. FourTout
l'accorde à la demande de l'enregistreur. Si rien ne se passe :

1. Vérifiez que le micro fonctionne ailleurs (`gnome-sound-recorder`,
   `arecord -l`).
2. Vérifiez que PipeWire ou PulseAudio tourne.
3. Sous Flatpak ou Snap, vérifiez que l'accès au microphone est autorisé.

---

## Une opération est très lente

Certaines opérations sont intrinsèquement coûteuses : compression vidéo, OCR,
recherche de doublons sur un gros dossier, récupération de mot de passe PDF.

- La progression s'affiche dans l'outil et dans la barre de tâches.
- Vous pouvez quitter la page : le travail continue.
- **Annuler** arrête réellement le processus et nettoie les fichiers
  temporaires.

Le chiffrement de fichiers commence par une dérivation Argon2id qui prend
environ une seconde et consomme 64 Mio. C'est **voulu** : c'est ce qui rend
une attaque par force brute coûteuse.

---

## « Mot de passe incorrect » alors qu'il est bon

Le message exact est « Mot de passe incorrect, ou fichier altéré ». Les deux
cas sont indistinguables : c'est une propriété du chiffrement authentifié, pas
un défaut.

Vérifiez :

- que le fichier `.ftenc` n'a pas été tronqué par un transfert incomplet
  (comparez sa taille avec celle d'origine) ;
- qu'il a bien été produit par FourTout — la signature est vérifiée, un autre
  format donne un message différent ;
- la disposition du clavier au moment de la saisie initiale.

Il n'existe **aucune récupération**. C'est le comportement attendu.

---

## Le convertisseur de devises n'affiche rien

C'est le seul outil qui a besoin d'Internet.

- **Hors ligne avec un relevé en cache** : FourTout utilise le dernier relevé
  connu et affiche sa date. Vérifiez cette date avant de vous fier au montant.
- **Hors ligne sans relevé** : FourTout le dit et n'affiche aucun chiffre.
  Aucun taux n'est inventé.
- **En ligne mais en erreur** : la Banque centrale européenne publie une fois
  par jour ouvré. Un pare-feu d'entreprise ou un proxy peut bloquer l'accès à
  `ecb.europa.eu`.

---

## Une archive protégée ne s'ouvre pas ailleurs

FourTout produit du **WinZip AES-256**, lisible par 7-Zip, WinRAR, PeaZip,
Keka et l'Explorateur Windows. Les outils très anciens, ou `unzip` en version
ancienne, ne connaissent pas l'AES du ZIP et échoueront.

Note : les **noms de fichiers** d'une archive ZIP restent lisibles sans le mot
de passe, seul le contenu est chiffré. C'est une limite du format. Pour cacher
aussi les noms, chiffrez l'archive avec l'outil de chiffrement de fichiers.

---

## Une conversion Word vers PDF ne ressemble pas au document

Attendu, et dit sur la page de l'outil. FourTout reprend le contenu et sa
structure — titres, paragraphes, gras, italique, listes, tableaux simples —
mais pas la maquette Word : colonnes, zones flottantes, en-têtes et pieds de
page, polices spécifiques et images peuvent différer ou disparaître.

Reproduire Word demanderait un moteur de mise en page Word. Pour un rendu
fidèle au pixel, exportez en PDF depuis Word ou LibreOffice.

---

## L'interface est trop grande ou trop petite

`Ctrl` `+`, `Ctrl` `-`, `Ctrl` `0`, ou `Ctrl` + molette. Le réglage est aussi
dans **Paramètres → Apparence**, de 80 % à 150 %, et il est conservé.

Si l'interface paraît doublement agrandie, c'est que la WebView applique son
propre zoom par-dessus. `Ctrl` `0` remet tout à plat.

---

## Repartir de zéro

**Paramètres → Données locales → Tout effacer** remet FourTout à son état
initial : préférences, favoris, récents, taux en cache.

Pour retirer aussi les modèles de parole, supprimez le dossier de données de
l'application :

| Système | Chemin |
| --- | --- |
| Linux | `~/.local/share/app.fourtout.desktop/` |
| Windows | `%APPDATA%\app.fourtout.desktop\` |

Aucun de vos fichiers de travail n'y est stocké.

---

## Signaler un problème

Ouvrez un ticket sur GitHub avec la version de FourTout, votre système, les
étapes de reproduction et le message d'erreur exact.

**Une vulnérabilité de sécurité ne s'ouvre pas en ticket public** : voir
[SECURITY.md](SECURITY.md#signaler-une-vulnérabilité).
