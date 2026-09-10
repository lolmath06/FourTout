import { useEffect, useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useImagePreview } from "@/components/image/useImagePreview";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { useProcessedPreview } from "@/components/image/useProcessedPreview";
import { processImages } from "@/core/image/pipeline";
import {
  cleanScan,
  estimateSkew,
  MAX_SKEW_DEGREES,
  type CleanScanOptions,
  type ScanRendering,
} from "@/core/image/scan";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Nettoyage d'un scan.
 *
 * Rien n'est appliqué d'office : tous les réglages partent de zéro, et l'aperçu
 * avant/après montre en permanence ce que chacun fait. C'est la contrepartie de
 * la règle « ne jamais détruire du texte fin » — l'utilisateur voit ce qu'il
 * enlève avant de l'enlever.
 */
const RENDERINGS: { value: ScanRendering; label: string; hint: string }[] = [
  { value: "color", label: "Couleur", hint: "Ne touche pas aux couleurs" },
  { value: "grayscale", label: "Niveaux de gris", hint: "Neutralise une dominante colorée" },
  { value: "bw", label: "Noir et blanc", hint: "Seuil adaptatif, suit un éclairage inégal" },
];

export function ScanCleanTool({ tool }: ToolComponentProps) {
  const [options, setOptions] = useState<CleanScanOptions>({
    deskew: 0,
    contrast: 0,
    brightness: 0,
    whiten: 0,
    rendering: "color",
  });

  const set = <K extends keyof CleanScanOptions>(key: K, value: CleanScanOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  return (
    <ImageToolShell
      tool={tool}
      selection="multiple"
      actionLabel="Nettoyer"
      hint="Les mêmes réglages sont appliqués à toutes les images déposées."
      run={async ({ files, context }) => {
        const outputs = await processImages(
          files,
          (canvas) => cleanScan(canvas, options),
          { format: "same", suffix: "nettoye" },
          context,
        );
        return {
          files: outputs,
          summary: `${outputs.length} image${outputs.length > 1 ? "s" : ""} nettoyée${
            outputs.length > 1 ? "s" : ""
          }.`,
        };
      }}
    >
      {(files) => (
        <div className="space-y-3">
          <Fieldset columns={2} title="Redressement">
            <Field
              label="Inclinaison"
              hint={`Correction fine, de −${MAX_SKEW_DEGREES}° à +${MAX_SKEW_DEGREES}°. À ne pas confondre avec la correction de perspective, qui traite les photos prises en biais.`}
            >
              <Slider
                value={options.deskew ?? 0}
                onChange={(value) => set("deskew", value)}
                min={-MAX_SKEW_DEGREES}
                max={MAX_SKEW_DEGREES}
                step={0.1}
                suffix="°"
              />
            </Field>
            <Field label="Détection automatique">
              <AutoDeskew file={files[0]} onDetect={(angle) => set("deskew", angle)} />
            </Field>
          </Fieldset>

          <Fieldset columns={2} title="Lisibilité">
            <Field label="Contraste" hint="Écarte l'encre du papier sur un scan pâle.">
              <Slider
                value={options.contrast ?? 0}
                onChange={(value) => set("contrast", value)}
                min={-50}
                max={80}
              />
            </Field>
            <Field label="Luminosité">
              <Slider
                value={options.brightness ?? 0}
                onChange={(value) => set("brightness", value)}
                min={-50}
                max={50}
              />
            </Field>
            <Field
              label="Blanchir le fond"
              hint="Efface un fond gris ou un papier jauni. Les pixels sombres ne sont jamais touchés : le texte fin garde sa densité."
            >
              <Slider
                value={options.whiten ?? 0}
                onChange={(value) => set("whiten", value)}
                min={0}
                max={100}
                suffix=" %"
              />
            </Field>
            <Field label="Rendu">
              <OptionGroup
                ariaLabel="Rendu"
                value={options.rendering ?? "color"}
                onChange={(value) => set("rendering", value)}
                options={RENDERINGS}
              />
            </Field>
          </Fieldset>

          <BeforeAfter file={files[0]} options={options} />

          {files.length > 1 && (
            <Callout tone="info">
              L'aperçu porte sur la première image ; les mêmes réglages seront appliqués aux{" "}
              {files.length} images.
            </Callout>
          )}
        </div>
      )}
    </ImageToolShell>
  );
}

/**
 * Détection de l'inclinaison, proposée mais jamais imposée.
 *
 * La confiance est affichée telle quelle : sur une image sans lignes de texte
 * franches, la mesure ne veut rien dire, et il vaut mieux le montrer que
 * d'appliquer un angle au jugé.
 */
function AutoDeskew({ file, onDetect }: { file: SelectedFile; onDetect: (angle: number) => void }) {
  const source = useSourceCanvas(file);
  const [estimate, setEstimate] = useState<{ angle: number; confidence: number } | null>(null);

  useEffect(() => setEstimate(null), [file]);

  const detect = () => {
    if (!source.preview) return;
    setEstimate(estimateSkew(source.preview.getPixels()));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={detect} disabled={!source.preview}>
        <Icon name="Ruler" size={14} /> Détecter l'inclinaison
      </Button>
      {estimate && (
        <>
          <span className="text-xs tabular-nums text-[var(--ft-text-muted)]">
            {estimate.angle > 0 ? "+" : ""}
            {estimate.angle.toFixed(1)}° · confiance {Math.round(estimate.confidence * 100)} %
          </span>
          {estimate.confidence >= 0.15 ? (
            <Button size="sm" variant="primary" onClick={() => onDetect(-estimate.angle)}>
              Appliquer
            </Button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[var(--ft-warn)]">
              <Icon name="TriangleAlert" size={13} />
              Mesure peu fiable : réglez à la main.
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Aperçu avant / après, côte à côte. */
function BeforeAfter({ file, options }: { file: SelectedFile; options: CleanScanOptions }) {
  const preview = useImagePreview(file);
  const source = useSourceCanvas(file);
  const url = useProcessedPreview(
    source.preview,
    (canvas) => cleanScan(canvas, options),
    [options.deskew, options.contrast, options.brightness, options.whiten, options.rendering],
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <p className="ft-section">Avant</p>
        <PreviewFrame maxHeight={360}>
          {preview.url && (
            <img src={preview.url} alt="Image d'origine" className="max-h-[360px] max-w-full object-contain" />
          )}
        </PreviewFrame>
      </div>
      <div className="space-y-1.5">
        <p className="ft-section">Après</p>
        <PreviewFrame maxHeight={360}>
          {url ? (
            <img src={url} alt="Image nettoyée" className="max-h-[360px] max-w-full object-contain" />
          ) : (
            <p className="p-6 text-xs text-[var(--ft-text-muted)]">Préparation de l'aperçu…</p>
          )}
        </PreviewFrame>
      </div>
    </div>
  );
}
