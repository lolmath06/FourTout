import { useEffect, useMemo, useState } from "react";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { Button } from "@/components/ui/Button";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { useJob } from "@/core/jobs";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { getRasterBackend, type RasterCanvas, type RasterPixels } from "@/core/pdf/raster/types";
import {
  ALIGN_MODES,
  alignForComparison,
  compareImages,
  diffOutputName,
  sameDimensions,
  type AlignMode,
  type CompareResult,
} from "@/core/image/compare";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Comparer deux images.
 *
 * Un seul outil pour les trois façons de regarder la même chose — côte à côte,
 * en superposition, et en différence — parce qu'on passe de l'une à l'autre
 * sans arrêt : la superposition montre *où* ça bouge, la différence *combien*.
 * En faire trois outils obligerait à redéposer les fichiers à chaque question.
 *
 * Rien n'est redimensionné tout seul. Si les deux images n'ont pas les mêmes
 * dimensions, l'outil le dit et attend un choix : un rééchantillonnage crée
 * lui-même des écarts, et un PSNR calculé sur une image redimensionnée en
 * douce ne décrit plus les fichiers qu'on croyait comparer.
 */

type ViewMode = "side-by-side" | "overlay" | "diff";

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "side-by-side", label: "Côte à côte" },
  { value: "overlay", label: "Superposition" },
  { value: "diff", label: "Différence" },
];

export function ImageCompareTool({ tool }: ToolComponentProps) {
  // Deux emplacements nommés, pas une liste de deux : « A » et « B » ont des
  // rôles différents — la référence et la candidate — et une liste ne permet
  // pas de remplacer la seconde sans d'abord retirer la première.
  const [fileA, setFileA] = useState<SelectedFile[]>([]);
  const [fileB, setFileB] = useState<SelectedFile[]>([]);
  const [view, setView] = useState<ViewMode>("side-by-side");
  const [opacity, setOpacity] = useState(50);
  const [tolerance, setTolerance] = useState(0);
  const [includeAlpha, setIncludeAlpha] = useState(false);
  const [amplify, setAmplify] = useState(1);
  const [align, setAlign] = useState<AlignMode | undefined>(undefined);
  const [result, setResult] = useState<CompareResult | undefined>();
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const job = useJob<CompareResult>();

  const a = useSourceCanvas(fileA[0]);
  const b = useSourceCanvas(fileB[0]);
  // Les canvas viennent d'un effet : ils survivent **un rendu de plus** que le
  // fichier dont ils sont issus. Exiger aussi le fichier ferme la fenêtre
  // pendant laquelle l'écran affichait des données dont la source n'existait
  // plus — c'est elle qui faisait lever `files[1].name` et démontait la racine.
  const ready = Boolean(fileA[0] && fileB[0] && a.full && b.full);
  const matching = a.full && b.full ? sameDimensions(a.full, b.full) : false;
  const needsChoice = ready && !matching && align === undefined;

  // Un changement de fichiers ou de réglage invalide le constat précédent :
  // laisser à l'écran des chiffres calculés sur autre chose serait pire que
  // de n'en montrer aucun.
  useEffect(() => {
    setResult(undefined);
    setOutcome(null);
  }, [fileA, fileB, tolerance, includeAlpha, align]);

  const compare = async () => {
    if (!a.full || !b.full) return;
    const computed = await job.run(async (context) => {
      context.report({ ratio: 0.1, label: "Alignement…" });
      const aligned = alignForComparison(a.full!, b.full!, align ?? "common");
      context.report({ ratio: 0.4, label: "Comparaison des pixels…" });
      // Un rendu intermédiaire laisse la WebView afficher la progression avant
      // le parcours des pixels, qui, lui, ne rend pas la main.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (context.signal.aborted) throw new Error("cancelled");
      return compareImages(aligned.a.getPixels(), aligned.b.getPixels(), {
        tolerance,
        includeAlpha,
        amplify,
      });
    });
    if (computed) {
      setResult(computed);
      setView("diff");
    }
  };

  const saveDiff = async () => {
    if (!result) return;
    const backend = getRasterBackend();
    if (!backend) return;
    const canvas = backend.createCanvas(result.diff.width, result.diff.height);
    canvas.putPixels(result.diff);
    const bytes = await canvas.encode("png");
    canvas.release?.();
    setOutcome({
      files: [
        {
          name: diffOutputName(fileA[0].name, fileB[0].name),
          bytes,
          mimeType: "image/png",
        },
      ],
      summary: `Image de différence ${result.width} × ${result.height}.`,
    });
    notify.success("Image de différence prête", "Enregistrez-la depuis le panneau de résultat.");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FileDropZone
          constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
          files={fileA}
          onChange={setFileA}
          label="Image A — référence"
          hint="Celle à laquelle on compare."
          disabled={job.isRunning}
        />
        <FileDropZone
          constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
          files={fileB}
          onChange={setFileB}
          label="Image B — comparaison"
          hint="Celle dont on cherche les écarts."
          disabled={job.isRunning}
        />
      </div>

      {fileA.length === 1 && fileB.length === 0 && (
        <Callout tone="info" title="Il manque la seconde image">
          Déposez une image dans l'emplacement B pour lancer la comparaison.
        </Callout>
      )}

      {fileB.length === 1 && fileA.length === 0 && (
        <Callout tone="info" title="Il manque l'image de référence">
          Déposez une image dans l'emplacement A pour lancer la comparaison.
        </Callout>
      )}

      {ready && (
        <>
          <Dimensions a={a} b={b} names={[fileA[0].name, fileB[0].name]} matching={matching} />

          {!matching && (
            <Fieldset columns={1}>
              <Field
                label="Dimensions différentes"
                hint={ALIGN_MODES.find((mode) => mode.value === align)?.hint ?? "Choisissez comment comparer : aucune image n'est modifiée tant que vous n'avez pas tranché."}
              >
                <OptionGroup
                  ariaLabel="Alignement"
                  value={align ?? ""}
                  onChange={(value) => setAlign(value as AlignMode)}
                  options={ALIGN_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
                />
              </Field>
            </Fieldset>
          )}

          <Fieldset columns={2}>
            <Field
              label={`Tolérance (${tolerance})`}
              hint="Écart par canal en deçà duquel deux pixels sont tenus pour égaux. Change les chiffres."
            >
              <Slider value={tolerance} onChange={setTolerance} min={0} max={64} />
            </Field>
            <Field
              label={`Amplification (×${amplify})`}
              hint="Rend l'image de différence lisible. Ne change aucun chiffre."
            >
              <Slider value={amplify} onChange={setAmplify} min={1} max={20} />
            </Field>
            <Field label="Transparence" full>
              <OptionGroup
                ariaLabel="Transparence"
                value={includeAlpha ? "yes" : "no"}
                onChange={(value) => setIncludeAlpha(value === "yes")}
                options={[
                  { value: "no", label: "Ignorer l'opacité" },
                  { value: "yes", label: "Comparer l'opacité" },
                ]}
              />
            </Field>
          </Fieldset>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ft-border)] pt-4">
            <p className="text-xs text-[var(--ft-text-muted)]">
              {formatFileSize(fileA[0].size)} · {formatFileSize(fileB[0].size)}
            </p>
            <div className="flex items-center gap-2">
              {job.isRunning && (
                <Button size="sm" variant="ghost" onClick={job.cancel}>
                  Annuler
                </Button>
              )}
              <Button
                size="md"
                variant="primary"
                onClick={compare}
                disabled={needsChoice || job.isRunning}
              >
                {job.isRunning ? (
                  <>
                    <Icon name="Loader" size={15} className="animate-spin" />
                    {job.progress.label ?? "Comparaison…"}
                  </>
                ) : (
                  <>
                    <Icon name="Play" size={15} />
                    Comparer
                  </>
                )}
              </Button>
            </div>
          </div>

          {job.isRunning && <ProgressBar ratio={job.progress.ratio} label={job.progress.label} />}
          {needsChoice && (
            <Callout tone="warning" title="Choisissez d'abord comment comparer">
              Les deux images n'ont pas les mêmes dimensions. FourTout n'en redimensionne aucune
              sans votre accord : un rééchantillonnage fabriquerait des différences absentes des
              fichiers.
            </Callout>
          )}

          {result && <Metrics result={result} amplify={amplify} onSave={saveDiff} />}

          <Fieldset columns={1}>
            <Field label="Affichage">
              <OptionGroup
                ariaLabel="Affichage"
                value={view}
                onChange={(value) => setView(value as ViewMode)}
                options={VIEW_MODES.filter((mode) => mode.value !== "diff" || result)}
              />
            </Field>
            {view === "overlay" && (
              <Field label={`Opacité de B (${opacity} %)`}>
                <Slider value={opacity} onChange={setOpacity} min={0} max={100} />
              </Field>
            )}
          </Fieldset>

          <Views
            view={view}
            a={a.full}
            b={b.full}
            names={[fileA[0].name, fileB[0].name]}
            opacity={opacity}
            diff={result?.diff}
            amplify={amplify}
          />
        </>
      )}

      {(a.error || b.error) && (
        <Callout tone="error" title="Image illisible">
          {a.error ?? b.error}
        </Callout>
      )}

      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}

/* ---------------------------------------------------------------- affichage */

function Dimensions({
  a,
  b,
  names,
  matching,
}: {
  a: { width: number; height: number };
  b: { width: number; height: number };
  names: [string, string];
  matching: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[
        { label: "A", name: names[0], size: a },
        { label: "B", name: names[1], size: b },
      ].map((entry) => (
        <div
          key={entry.label}
          className="rounded-md border border-[var(--ft-border)] px-3 py-2 text-xs"
        >
          <span className="font-medium">{entry.label}</span>{" "}
          <span className="text-[var(--ft-text-muted)]">{entry.name}</span>
          <div className="font-mono text-[var(--ft-text-muted)]">
            {entry.size.width} × {entry.size.height}
            {!matching && " px"}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Une métrique avec son aide courte : les sigles ne parlent pas d'eux-mêmes. */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-[var(--ft-border)] px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-[var(--ft-text-faint)]">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function Metrics({
  result,
  amplify,
  onSave,
}: {
  result: CompareResult;
  amplify: number;
  onSave: () => void;
}) {
  const percent = result.ratioDifferent * 100;
  return (
    <div className="space-y-3">
      {result.identical && (
        <Callout tone="success" title="Images identiques">
          Aucun pixel ne diffère sur les canaux comparés. Le PSNR est infini : il n'a pas de valeur
          à afficher.
        </Callout>
      )}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Metric label="Pixels comparés" value={result.pixelsCompared.toLocaleString("fr-FR")} />
        <Metric
          label="Pixels différents"
          value={result.pixelsDifferent.toLocaleString("fr-FR")}
          hint="Pixels dont l'écart dépasse la tolérance."
        />
        <Metric
          label="Pourcentage"
          value={percent === 0 ? "0 %" : `${percent < 0.01 ? "< 0,01" : percent.toFixed(2)} %`}
        />
        <Metric
          label="Écart moyen"
          value={result.meanDifference.toFixed(2)}
          hint="Moyenne, sur tous les pixels, du plus grand écart de canal (0 à 255)."
        />
        <Metric label="Écart maximal" value={String(result.maxDifference)} />
        <Metric
          label="PSNR"
          value={result.psnr === undefined ? "∞ (identiques)" : `${result.psnr.toFixed(2)} dB`}
          hint="Rapport signal sur bruit de crête : plus il est élevé, plus les images sont proches. Au-delà de 40 dB, l'écart est généralement imperceptible."
        />
        <Metric
          label="SSIM"
          value={result.ssim.toFixed(4)}
          hint="Similarité structurelle, de 0 à 1. Compare luminance, contraste et structure par blocs de 8 × 8 pixels. Aucun seuil universel ne dit « bonne image »."
        />
        <Metric
          label="EQM"
          value={result.mse.toFixed(3)}
          hint="Erreur quadratique moyenne sur les canaux comparés."
        />
      </div>
      <button onClick={onSave} className="text-xs text-[var(--ft-accent-text)] underline">
        Enregistrer l'image de différence (PNG{amplify > 1 ? `, amplifiée ×${amplify}` : ""})
      </button>
    </div>
  );
}

/** Convertit des pixels en URL affichable, libérée à la disparition. */
function usePixelsUrl(pixels: RasterPixels | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (!pixels) {
      setUrl(undefined);
      return;
    }
    let revoked: string | undefined;
    const backend = getRasterBackend();
    if (!backend) return;
    const canvas = backend.createCanvas(pixels.width, pixels.height);
    canvas.putPixels(pixels);
    canvas
      .encode("png")
      .then((bytes) => {
        revoked = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "image/png" }));
        setUrl(revoked);
      })
      .finally(() => canvas.release?.());
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [pixels]);
  return url;
}

/** Même chose depuis un canvas déjà décodé. */
function useCanvasUrl(canvas: RasterCanvas | undefined): string | undefined {
  const pixels = useMemo(() => canvas?.getPixels(), [canvas]);
  return usePixelsUrl(pixels);
}

function Views({
  view,
  a,
  b,
  names,
  opacity,
  diff,
  amplify,
}: {
  view: ViewMode;
  a?: RasterCanvas;
  b?: RasterCanvas;
  names: [string, string];
  opacity: number;
  diff?: RasterPixels;
  amplify: number;
}) {
  const urlA = useCanvasUrl(a);
  const urlB = useCanvasUrl(b);
  const urlDiff = usePixelsUrl(diff);

  if (view === "side-by-side") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          [urlA, names[0]],
          [urlB, names[1]],
        ].map(([url, name], index) => (
          <PreviewFrame key={index} maxHeight={360}>
            {url && (
              <img src={url} alt={name} className="max-h-[340px] max-w-full object-contain" />
            )}
          </PreviewFrame>
        ))}
      </div>
    );
  }

  if (view === "overlay") {
    return (
      <PreviewFrame maxHeight={420}>
        <div className="relative inline-block">
          {urlA && <img src={urlA} alt={names[0]} className="max-h-[400px] max-w-full object-contain" />}
          {urlB && (
            <img
              src={urlB}
              alt={names[1]}
              style={{ opacity: opacity / 100 }}
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        </div>
      </PreviewFrame>
    );
  }

  return (
    <div className="space-y-2">
      <PreviewFrame maxHeight={420}>
        {urlDiff && (
          <img src={urlDiff} alt="Différence" className="max-h-[400px] max-w-full object-contain" />
        )}
      </PreviewFrame>
      <p className="text-xs text-[var(--ft-text-muted)]">
        Le noir signale l'absence d'écart ; plus un pixel est clair, plus les deux images y
        divergent{amplify > 1 ? ` (amplification ×${amplify} pour la lisibilité)` : ""}.
      </p>
    </div>
  );
}
