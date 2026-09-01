# Ajouter un outil

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
  status: "planned",                      // "planned" | "beta" | "available"
  capabilities: ["local", "produces-files", "long-running"],
  acceptedInputs: [IN.pdf()],
  outputs: [OUT.pdf()],
  note: "Précision affichée sur la page de l'outil.",        // facultatif
}
```

L'outil apparaît immédiatement dans sa catégorie, dans la recherche, dans
l'accueil et sur sa propre page (`/tools/t/pdf-compress`), avec la vue
« bientôt disponible ».

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

Enfin, passez son `status` à `"available"` dans le catalogue.

> Un test vérifie que la liste des outils `available` correspond exactement à
> la liste des implémentations : impossible d'oublier l'un des deux.

### Ce que la page d'outil fournit déjà

Vous n'avez **pas** à écrire : l'en-tête, l'icône, le badge de statut, le bouton
favori, l'enregistrement dans les récents, le fil d'Ariane vers la catégorie,
le rappel de confidentialité. `ToolPage` s'en charge — votre composant ne
contient que l'outil lui-même.

### Briques disponibles

| Besoin | À utiliser |
| --- | --- |
| Recevoir des fichiers | `FileDropZone` + `constraintsForTool(tool)` |
| Écrire un outil PDF | `PdfToolShell` — voir [PDF.md](PDF.md) |
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

Les fixtures d'essai sont dans [`test-assets/`](../test-assets/README.md)
(`pnpm test:assets` pour les régénérer).
