import { useEffect, useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { ModelRequirements } from "@/components/speech/ModelRequirements";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { processImage } from "@/core/image/pipeline";
import { removeBackground } from "@/core/image/background";
import { loadSegmentation, SEGMENTATION_MODELS, type SegmentationModelId } from "@/core/image/segmentation";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Retirer l'arrière-plan d'une image.
 *
 * À ne pas confondre avec « Rendre une couleur transparente », qui efface une
 * couleur qu'on lui désigne : cet outil-ci **reconnaît le sujet** et supprime
 * tout le reste, sans qu'on ait rien à décrire.
 *
 * Le modèle tourne sur la machine. C'est la raison d'être de l'outil : les
 * services en ligne qui font la même chose demandent tous de leur téléverser
 * la photo, ce qui est exactement ce que FourTout refuse de faire.
 */

/** Réglages exposés : deux, pas dix. L'outil n'est pas un logiciel de retouche. */
const PRECISION_OPTIONS = SEGMENTATION_MODELS.map((model) => ({
  value: model.id,
  label: model.label,
  hint: model.detail,
}));

export function ImageRemoveBackgroundTool({ tool }: ToolComponentProps) {
  const [model, setModel] = useState<SegmentationModelId>("seg-u2netp");
  const [feather, setFeather] = useState(2);
  const [threshold, setThreshold] = useState(0);

  return (
    <ModelRequirements
      required={[model]}
      optional={SEGMENTATION_MODELS.map((entry) => entry.id)}
      what="Le détourage automatique"
      manageLabel="Gérer les modèles de détourage"
    >
      {() => (
        <ImageToolShell
          tool={tool}
          selection="single"
          actionLabel="Retirer l'arrière-plan"
          hint="La sortie est en PNG : c'est le seul format courant qui conserve la transparence."
          run={async ({ files, context }) => {
            const { session, tensor } = await loadSegmentation(model);
            let kept = 0;
            const output = await processImage(
              files[0],
              async (canvas) => {
                const result = await removeBackground(
                  canvas,
                  session,
                  tensor,
                  { featherPx: feather, threshold },
                  context,
                );
                kept = result.keptRatio;
                return result.canvas;
              },
              { format: "png", suffix: "detoure" },
              context,
            );
            return {
              files: [output],
              summary: `Sujet conservé sur ${Math.round(kept * 100)} % de l'image ; le reste est transparent.`,
            };
          }}
        >
          {(files) => (
            <BackgroundStage
              key={files[0].id}
              file={files[0]}
              model={model}
              setModel={setModel}
              feather={feather}
              setFeather={setFeather}
              threshold={threshold}
              setThreshold={setThreshold}
            />
          )}
        </ImageToolShell>
      )}
    </ModelRequirements>
  );
}

function BackgroundStage({
  file,
  model,
  setModel,
  feather,
  setFeather,
  threshold,
  setThreshold,
}: {
  file: SelectedFile;
  model: SegmentationModelId;
  setModel: (id: SegmentationModelId) => void;
  feather: number;
  setFeather: (value: number) => void;
  threshold: number;
  setThreshold: (value: number) => void;
}) {
  const source = useSourceCanvas(file);
  const [preview, setPreview] = useState<string | undefined>(undefined);

  // Aperçu de l'image d'origine. Le détourage n'est **pas** recalculé à chaque
  // déplacement de curseur : une inférence coûte plusieurs secondes, et un
  // aperçu qui rame en continu serait pire qu'un aperçu après action.
  const canvas = source.preview;
  useEffect(() => {
    if (!canvas) return;
    let url: string | undefined;
    let abandoned = false;
    void canvas.encode("png").then((bytes) => {
      if (abandoned) return;
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
      setPreview(url);
    });
    return () => {
      abandoned = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [canvas]);

  return (
    <div className="space-y-3">
      <Fieldset columns={1} title="Réglages">
        <Field label="Précision" hint="Le modèle précis demande son propre téléchargement.">
          <OptionGroup
            value={model}
            onChange={setModel}
            options={PRECISION_OPTIONS}
            ariaLabel="Précision du détourage"
          />
        </Field>
        <Field
          label={`Adoucir le bord (${feather} px)`}
          hint="Atténue le liseré de la couleur du fond le long du contour."
        >
          <Slider value={feather} onChange={setFeather} min={0} max={12} />
        </Field>
        <Field
          label={`Correction (${threshold > 0 ? "+" : ""}${threshold.toFixed(2)})`}
          hint="Vers la droite : garde moins, si du fond est resté. Vers la gauche : garde plus, si un bout du sujet a disparu."
        >
          <Slider
            value={threshold}
            onChange={setThreshold}
            min={-0.3}
            max={0.3}
            step={0.05}
          />
        </Field>
      </Fieldset>

      <PreviewFrame maxHeight={420}>
        {preview && (
          <img
            src={preview}
            alt="Image d'origine"
            className="max-h-[400px] max-w-full object-contain"
            draggable={false}
          />
        )}
      </PreviewFrame>
      <p className="ft-meta text-center">
        Image d'origine{source.width > 0 ? ` · ${source.width} × ${source.height} px` : ""}. Le
        résultat s'affiche après traitement, sur un damier de transparence.
      </p>

      <Callout tone="info" title="Ce que l'outil sait faire, et ce qu'il ne sait pas">
        Le modèle cherche le <em>sujet principal</em> : une personne, un animal, un objet posé
        devant un fond. Il fonctionne bien quand le sujet est net et se détache ; il se trompe sur
        les scènes sans sujet évident, les fonds de la même couleur que le sujet, et les détails
        très fins comme une mèche de cheveux isolée. La correction ci-dessus rattrape les petits
        écarts ; au-delà, mieux vaut un détourage à la main.
        <br />
        <br />
        Tout se passe sur votre machine : l'image n'est envoyée nulle part.
      </Callout>
    </div>
  );
}
