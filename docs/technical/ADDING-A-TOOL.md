# Ajouter un outil

[← Documentation](../README.md)

## Sommaire

- [En résumé](#en-résumé)
- [1. Déclarer l'outil au catalogue](#1-déclarer-loutil-au-catalogue)
- [2. Écrire la logique métier](#2-écrire-la-logique-métier)
- [3. Écrire l'interface et la brancher](#3-écrire-linterface-et-la-brancher)
- [Ajouter une catégorie](#ajouter-une-catégorie)
- [Tests](#tests)

---

## En résumé

Un outil au catalogue = **1 fichier modifié**.
Un outil réellement implémenté = **3 fichiers**.

---

## 1. Déclarer l'outil au catalogue

Ouvrez le fichier de sa catégorie dans `src/core/tools/catalog/` (par exemple
`pdf.ts`) et ajoutez une définition :

```ts
{
  id: "pdf-compress",                     // kebab-case, unique dans tout le catalogue
  name: "Compresser un PDF",
  description: "Réduire le poids d'un PDF en gardant une qualité correcte.",
  category: "pdf",
  alsoIn: ["converters"],                 // facultatif : découvrable ailleurs, sans duplication
  icon: "Minimize2",                      // nom lucide, voir plus bas
  keywords: ["réduire la taille", "trop lourd", "alléger"],  // langage courant
  aliases: ["compress pdf", "reduce pdf size"],              // autres noms, anglais inclus
  capabilities: ["local", "produces-files", "long-running"],
  acceptedInputs: [IN.pdf()],
  outputs: [OUT.pdf()],
  note: "Précision affichée sur la page de l'outil.",        // facultatif
}
```

> **N'ajoutez cette déclaration que lorsque l'outil fonctionne.** La règle du
> produit est que figurer au catalogue, c'est fonctionner : il n'existe pas
> d'état « bientôt disponible », et un test échouera si le catalogue et la
> table des implémentations divergent. Un outil futur vit dans
> [ROADMAP.md](../../ROADMAP.md) ou dans un ticket, pas dans l'interface.

Une fois les trois fichiers en place, l'outil apparaît dans sa catégorie, dans
la recherche, dans l'accueil et sur sa propre page
(`/tools/t/pdf-compress`).

### Bien choisir les `keywords` et `aliases`

C'est ce qui fait la qualité de la recherche, et demain celle de l'assistant.
Écrivez ce qu'un utilisateur taperait vraiment : « mon pdf est trop lourd »,
« png en jpg », « enlever le gps d'une photo ». Un test dédié
(`src/core/tools/search.test.ts`) verrouille les formulations importantes.

### Icônes

`icon` est un nom d'icône [lucide](https://lucide.dev). Les icônes sont
importées nommément dans `src/components/ui/icons.ts` pour que le bundle ne
contienne que celles utilisées : **ajoutez-y le nom** s'il n'y est pas encore
(sinon une icône de repli s'affiche).

---

## 2. Écrire la logique métier

Dans `src/tools/logic/`, un module pur, sans React ni DOM :

```ts
// src/tools/logic/pdfCompress.ts
export async function compressPdf(file: File, options, ctx: JobContext) { … }
```

C'est ce module que les tests unitaires ciblent.

---

## 3. Écrire l'interface et la brancher

Créez le composant dans `src/tools/impl/` :

```tsx
// src/tools/impl/PdfCompressTool.tsx
export function PdfCompressTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const job = useJob<Blob>();

  return (
    <FileDropZone constraints={constraintsForTool(tool)} files={files} onChange={setFiles} />
    // … puis job.run(async (ctx) => compressPdf(files[0].file!, options, ctx))
  );
}
```

Puis déclarez-le dans `src/tools/implementations.ts` :

```ts
"pdf-compress": lazy(() =>
  import("./impl/PdfCompressTool").then((m) => ({ default: m.PdfCompressTool })),
),
```

> Un test vérifie que le catalogue et la table des implémentations
> correspondent **exactement** : impossible d'oublier l'un des deux, ni
> d'enregistrer un outil qui n'existe pas encore.

### Ce que la page d'outil fournit déjà

Vous n'avez **pas** à écrire : l'en-tête, l'icône, le badge de statut, le bouton
favori, l'enregistrement dans les récents, le fil d'Ariane vers la catégorie,
le rappel de confidentialité. `ToolPage` s'en charge — votre composant ne
contient que l'outil lui-même.

### Briques disponibles

| Besoin | À utiliser |
| --- | --- |
| Recevoir des fichiers | `FileDropZone` + `constraintsForTool(tool)` |
| Écrire un outil PDF | `PdfToolShell` — voir [PDF.md](../features/PDF.md) |
| Écrire un outil Image par lot | `ImageToolShell` (`@/components/image`) — voir [IMAGES.md](../features/IMAGES.md) |
| Traiter une image | `processImage` / `processImages` (`@/core/image`) |
| Aperçu d'image (dont temps réel) | `ImagePreview`, `useSourceCanvas`, `useProcessedPreview` |
| Reconnaître du texte (OCR) | `recognizeImages` (`@/core/ocr`) |
| Traiter un audio (FFmpeg) | `runMedia` (`@/core/media`) + `MediaToolShell` — voir [MEDIA.md](../features/MEDIA.md) |
| Écrire un outil vidéo | `VideoToolShell` (`@/components/media`) — voir [VIDEO.md](../features/VIDEO.md) |
| Savoir quels codecs existent vraiment | `mediaCapabilities()` (`@/core/media/capabilities`) |
| Lecteur / sélection visuelle sur une vidéo | `VideoPreview`, `CropOverlay` (`@/components/media`) |
| Traitement long survivant à la navigation | `startBackgroundJob` (`@/features/jobs/background`) |
| Générer/lire un QR code | `generateQrPng`/`decodeQr` (`@/core/image/qr`) |
| Enregistrer le résultat | `saveFile` / `saveFilesToFolder` (`@/core/output/save`) |
| Traitement long | `useJob()` (`@/core/jobs`) |
| Message à l'utilisateur | `notify.success/error/warning/info/loading` |
| Bouton, badge, état vide | `@/components/ui/*` |
| Persister un réglage | `appStore` (`@/core/storage`) |

---

## Ajouter une catégorie

1. Ajoutez son identifiant au type `CategoryId` (`src/core/tools/types.ts`).
2. Ajoutez son entrée dans `CATEGORIES` (`src/core/tools/categories.ts`) :
   `name`, `description`, `icon`, `order`, `accent`, `keywords`.
3. C'est tout : barre latérale, page Outils, filtres et compteurs se mettent à
   jour seuls.

L'`accent` doit être l'une des teintes définies dans `src/styles/app.css`
(`[data-accent="…"]`). Pour en ajouter une, complétez le type `AccentName` et
les deux blocs (clair et sombre) de la feuille de style.

---

## Tests

```bash
pnpm test          # tout
pnpm test:watch    # pendant le développement
pnpm verify        # lint + types + tests + build, avant de conclure
```

Pour un nouvel outil, ajoutez au minimum :

- un test de la logique pure dans `src/tools/logic/` ;
- si la formulation compte, une assertion de recherche dans
  `src/core/tools/search.test.ts`.

Les fixtures d'essai sont dans [`test-assets/`](../../test-assets/README.md)
(`pnpm test:assets` pour les régénérer).
