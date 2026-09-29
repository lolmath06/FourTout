import { useCallback, useEffect, useRef, useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useImagePreview } from "@/components/image/useImagePreview";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { useProcessedPreview } from "@/components/image/useProcessedPreview";
import { processImage } from "@/core/image/pipeline";
import {
  ASPECT_LABELS,
  correctPerspective,
  isUsableQuad,
  suggestOutputSize,
  type PerspectiveAspect,
  type PerspectiveRendering,
  type Point,
  type Quad,
} from "@/core/image/perspective";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Correction de perspective : l'utilisateur place quatre coins, le moteur
 * redresse.
 *
 * Les poignées sont stockées en **fractions de l'image** (0 à 1), jamais en
 * pixels d'écran. C'est ce qui garantit qu'un changement de taille de la
 * fenêtre, un zoom de l'interface ou une image de définition différente ne
 * décalent pas la sélection : la conversion vers les pixels réels n'a lieu
 * qu'au moment du calcul.
 */
type NormQuad = { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point };

type Corner = keyof NormQuad;

const CORNER_ORDER: Corner[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

const CORNER_LABELS: Record<Corner, string> = {
  topLeft: "Coin haut-gauche",
  topRight: "Coin haut-droite",
  bottomRight: "Coin bas-droite",
  bottomLeft: "Coin bas-gauche",
};

/** Quadrilatère de départ : un rectangle légèrement rentré dans l'image. */
const DEFAULT_QUAD: NormQuad = {
  topLeft: { x: 0.1, y: 0.1 },
  topRight: { x: 0.9, y: 0.1 },
  bottomRight: { x: 0.9, y: 0.9 },
  bottomLeft: { x: 0.1, y: 0.9 },
};

const RENDERINGS: { value: PerspectiveRendering; label: string; hint: string }[] = [
  { value: "color", label: "Couleur", hint: "Conserve les couleurs de la photo" },
  { value: "grayscale", label: "Niveaux de gris", hint: "Neutralise la dominante colorée" },
  { value: "document", label: "Document N&B", hint: "Seuil adaptatif : texte net sur fond blanc" },
];

const ASPECTS: PerspectiveAspect[] = ["auto", "a4-portrait", "a4-landscape", "letter-portrait", "square"];

/** Passe des fractions aux pixels de l'image. */
function toPixels(quad: NormQuad, width: number, height: number): Quad {
  const scale = (point: Point): Point => ({ x: point.x * width, y: point.y * height });
  return {
    topLeft: scale(quad.topLeft),
    topRight: scale(quad.topRight),
    bottomRight: scale(quad.bottomRight),
    bottomLeft: scale(quad.bottomLeft),
  };
}

export function DocumentPerspectiveTool({ tool }: ToolComponentProps) {
  const [quad, setQuad] = useState<NormQuad>(DEFAULT_QUAD);
  const [rendering, setRendering] = useState<PerspectiveRendering>("color");
  const [aspect, setAspect] = useState<PerspectiveAspect>("auto");

  return (
    <ImageToolShell
      tool={tool}
      selection="single"
      actionLabel="Redresser"
      actionDisabled={!isUsableQuad(toPixels(quad, 1000, 1000))}
      hint="Placez les quatre coins de la feuille, puis redressez. Le calcul est une vraie transformation projective, pas un recadrage."
      run={async ({ files, context }) => {
        const output = await processImage(
          files[0],
          (canvas) =>
            correctPerspective(canvas, {
              quad: toPixels(quad, canvas.width, canvas.height),
              rendering,
              aspect,
            }).canvas,
          { format: "same", suffix: "redresse" },
          context,
        );
        return { files: [output], summary: "Document redressé." };
      }}
    >
      {(files) => (
        <div className="space-y-3">
          <Fieldset columns={2}>
            <Field label="Rendu">
              <OptionGroup ariaLabel="Rendu" value={rendering} onChange={setRendering} options={RENDERINGS} />
            </Field>
            <Field
              label="Proportions du résultat"
              hint="Les proportions déduites des coins sont approchées : imposer le format donne un résultat exact."
            >
              <OptionGroup
                ariaLabel="Proportions du résultat"
                value={aspect}
                onChange={setAspect}
                options={ASPECTS.map((value) => ({ value, label: ASPECT_LABELS[value] }))}
              />
            </Field>
          </Fieldset>

          <PerspectiveStage file={files[0]} quad={quad} onChange={setQuad} />

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setQuad(DEFAULT_QUAD)}>
              <Icon name="Undo2" size={14} /> Réinitialiser les coins
            </Button>
            <p className="text-xs text-[var(--ft-text-muted)]">
              Faites glisser chaque poignée sur un coin de la feuille.
            </p>
          </div>

          {!isUsableQuad(toPixels(quad, 1000, 1000)) && (
            <Callout tone="warning" title="Quadrilatère impossible">
              Les quatre coins se croisent. Replacez-les dans l'ordre haut-gauche, haut-droite,
              bas-droite, bas-gauche.
            </Callout>
          )}

          <PerspectivePreview file={files[0]} quad={quad} rendering={rendering} aspect={aspect} />
        </div>
      )}
    </ImageToolShell>
  );
}

/** Image d'origine surmontée des quatre poignées déplaçables. */
function PerspectiveStage({
  file,
  quad,
  onChange,
}: {
  file: SelectedFile;
  quad: NormQuad;
  onChange: (quad: NormQuad) => void;
}) {
  const preview = useImagePreview(file);
  const imageRef = useRef<HTMLImageElement>(null);
  const draggingRef = useRef<Corner | null>(null);

  const fractionAt = useCallback((event: PointerEvent | React.PointerEvent): Point => {
    const element = imageRef.current;
    if (!element) return { x: 0, y: 0 };
    // Les coordonnées sont ramenées au **rectangle réellement affiché** de
    // l'image : c'est ce qui les rend indépendantes du zoom et de la taille de
    // la fenêtre.
    const box = element.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const corner = draggingRef.current;
      if (!corner) return;
      event.preventDefault();
      onChange({ ...quad, [corner]: fractionAt(event) });
    };
    const onUp = () => {
      draggingRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [quad, onChange, fractionAt]);

  /** Déplacement fin au clavier : un demi-pour-cent par appui. */
  const nudge = (corner: Corner, dx: number, dy: number) => {
    const point = quad[corner];
    onChange({
      ...quad,
      [corner]: {
        x: Math.max(0, Math.min(1, point.x + dx)),
        y: Math.max(0, Math.min(1, point.y + dy)),
      },
    });
  };

  const polygon = CORNER_ORDER.map((corner) => `${quad[corner].x * 100}% ${quad[corner].y * 100}%`).join(", ");

  return (
    <PreviewFrame maxHeight={520}>
      <div className="relative">
        {preview.url && (
          <img
            ref={imageRef}
            src={preview.url}
            alt={file.name}
            className="block max-h-[520px] max-w-full select-none object-contain"
            draggable={false}
          />
        )}
        {/* Le quadrilatère : un simple polygone SVG superposé, sans canvas —
            conformément à l'approche retenue pour WebKitGTK. */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <polygon
            points={CORNER_ORDER.map((corner) => `${quad[corner].x * 100}%,${quad[corner].y * 100}%`).join(" ")}
            fill="color-mix(in oklch, var(--ft-accent) 12%, transparent)"
            stroke="var(--ft-accent)"
            strokeWidth="1.5"
          />
        </svg>
        <span className="sr-only">{polygon}</span>
        {CORNER_ORDER.map((corner) => (
          <button
            key={corner}
            type="button"
            aria-label={CORNER_LABELS[corner]}
            onPointerDown={(event) => {
              event.preventDefault();
              draggingRef.current = corner;
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.02 : 0.005;
              if (event.key === "ArrowLeft") nudge(corner, -step, 0);
              else if (event.key === "ArrowRight") nudge(corner, step, 0);
              else if (event.key === "ArrowUp") nudge(corner, 0, -step);
              else if (event.key === "ArrowDown") nudge(corner, 0, step);
              else return;
              event.preventDefault();
            }}
            className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-[var(--ft-accent)] bg-[var(--ft-bg)] shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ft-accent)] active:cursor-grabbing"
            style={{ left: `${quad[corner].x * 100}%`, top: `${quad[corner].y * 100}%` }}
          />
        ))}
      </div>
    </PreviewFrame>
  );
}

/** Aperçu du résultat, recalculé à chaque déplacement de poignée. */
function PerspectivePreview({
  file,
  quad,
  rendering,
  aspect,
}: {
  file: SelectedFile;
  quad: NormQuad;
  rendering: PerspectiveRendering;
  aspect: PerspectiveAspect;
}) {
  const source = useSourceCanvas(file);
  const url = useProcessedPreview(
    source.preview,
    (canvas) => {
      const pixels = toPixels(quad, canvas.width, canvas.height);
      if (!isUsableQuad(pixels)) return canvas;
      return correctPerspective(canvas, { quad: pixels, rendering, aspect }).canvas;
    },
    [quad.topLeft.x, quad.topLeft.y, quad.topRight.x, quad.topRight.y, quad.bottomRight.x, quad.bottomRight.y, quad.bottomLeft.x, quad.bottomLeft.y, rendering, aspect],
  );

  const size =
    source.width > 0 ? suggestOutputSize(toPixels(quad, source.width, source.height)) : undefined;

  return (
    <div className="space-y-2">
      <p className="ft-section">Aperçu du résultat</p>
      <PreviewFrame maxHeight={420}>
        {url ? (
          <img src={url} alt="Aperçu du document redressé" className="max-h-[420px] max-w-full object-contain" />
        ) : (
          <p className="p-6 text-xs text-[var(--ft-text-muted)]">Préparation de l'aperçu…</p>
        )}
      </PreviewFrame>
      {size && (
        <p className="ft-meta ft-num">
          {aspect === "auto"
            ? `Dimensions déduites : ${size.width} × ${size.height} px`
            : `Format imposé : ${ASPECT_LABELS[aspect]}`}
        </p>
      )}
    </div>
  );
}
