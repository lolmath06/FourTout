import { useEffect, useMemo, useRef, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, OptionGroup, Slider, TextInput } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { extractPalette, type PaletteColor } from "@/core/image/palette";
import {
  describeColor,
  formatHsl,
  formatRatio,
  formatRgb,
  imageCoordinates,
  parseColor,
  pixelAt,
  wcagVerdict,
  WCAG_THRESHOLDS,
  type ColorReadout,
} from "@/core/image/color";
import { rgbToHex, type Rgb } from "@/core/image/types";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Analyser et convertir une couleur.
 *
 * Trois questions qu'on se pose ensemble, réunies dans un seul outil : quelles
 * couleurs domine cette image, quelle est exactement celle de ce pixel-là, et
 * est-ce que ce texte sur ce fond reste lisible. Les séparer obligerait à
 * recopier un code hexadécimal d'un écran à l'autre.
 */

type Tab = "palette" | "picker" | "contrast";

const TABS: { value: Tab; label: string }[] = [
  { value: "palette", label: "Couleurs dominantes" },
  { value: "picker", label: "Pipette" },
  { value: "contrast", label: "Contraste" },
];

export function ColorInspectTool({ tool }: ToolComponentProps) {
  const [tab, setTab] = useState<Tab>("palette");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [textColor, setTextColor] = useState<Rgb>({ r: 17, g: 17, b: 17 });
  const [backgroundColor, setBackgroundColor] = useState<Rgb>({ r: 255, g: 255, b: 255 });

  const source = useSourceCanvas(files[0]);

  /** Envoie une couleur vers l'onglet Contraste, sans quitter l'outil. */
  const sendToContrast = (rgb: Rgb, slot: "text" | "background") => {
    if (slot === "text") setTextColor(rgb);
    else setBackgroundColor(rgb);
    setTab("contrast");
  };

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Que voulez-vous faire ?">
          <OptionGroup
            ariaLabel="Mode"
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={TABS}
          />
        </Field>
      </Fieldset>

      {tab !== "contrast" && (
        <FileDropZone
          constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
          files={files}
          onChange={setFiles}
          label="Déposez une image"
        />
      )}

      {source.error && (
        <Callout tone="error" title="Image illisible">
          {source.error}
        </Callout>
      )}

      {tab === "palette" && files[0] && <PaletteTab source={source} onSend={sendToContrast} />}
      {tab === "picker" && files[0] && <PickerTab source={source} onSend={sendToContrast} />}
      {tab === "contrast" && (
        <ContrastTab
          text={textColor}
          background={backgroundColor}
          setText={setTextColor}
          setBackground={setBackgroundColor}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- partagé */

function copy(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => notify.success("Copié", text))
    .catch(() => {});
}

/** Toutes les écritures d'une couleur, chacune copiable d'un clic. */
function Readout({ color }: { color: ColorReadout }) {
  const rows: [string, string][] = [
    ["HEX", color.hex],
    ["RGB", formatRgb(color.rgb)],
    ["HSL", formatHsl(color.hsl)],
    ["HSV", `hsv(${color.hsv.h}, ${color.hsv.s}%, ${color.hsv.v}%)`],
  ];
  return (
    <div className="space-y-1">
      {rows.map(([label, value]) => (
        <button
          key={label}
          onClick={() => copy(value)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--ft-border)] px-2 py-1.5 text-left text-xs hover:border-[var(--ft-accent)]"
        >
          <span className="text-[var(--ft-text-faint)]">{label}</span>
          <span className="font-mono">{value}</span>
          <Icon name="Copy" size={12} className="text-[var(--ft-text-faint)]" />
        </button>
      ))}
      {color.alpha < 1 && (
        <p className="text-xs text-[var(--ft-text-muted)]">
          Opacité : {Math.round(color.alpha * 100)} % — les conversions et le contraste portent sur
          la couleur opaque.
        </p>
      )}
    </div>
  );
}

function SendButtons({ rgb, onSend }: { rgb: Rgb; onSend: (rgb: Rgb, slot: "text" | "background") => void }) {
  return (
    <div className="flex gap-2 text-xs">
      <button onClick={() => onSend(rgb, "text")} className="text-[var(--ft-accent-text)] underline">
        Utiliser comme texte
      </button>
      <button
        onClick={() => onSend(rgb, "background")}
        className="text-[var(--ft-accent-text)] underline"
      >
        Utiliser comme fond
      </button>
    </div>
  );
}

/* ---------------------------------------------------- couleurs dominantes */

function PaletteTab({
  source,
  onSend,
}: {
  source: ReturnType<typeof useSourceCanvas>;
  onSend: (rgb: Rgb, slot: "text" | "background") => void;
}) {
  const [count, setCount] = useState(8);
  const [selected, setSelected] = useState<PaletteColor | undefined>();

  const colors = useMemo(
    () => (source.preview ? extractPalette(source.preview.getPixels(), count) : []),
    [source.preview, count],
  );

  return (
    <div className="space-y-3">
      <Fieldset columns={1}>
        <Field label="Nombre de couleurs">
          <OptionGroup
            ariaLabel="Nombre"
            value={String(count)}
            onChange={(value) => setCount(Number(value))}
            options={[
              { value: "5", label: "5" },
              { value: "8", label: "8" },
              { value: "12", label: "12" },
            ]}
          />
        </Field>
      </Fieldset>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {colors.map((color, index) => (
          <button
            key={index}
            onClick={() => setSelected(color)}
            className="flex flex-col overflow-hidden rounded-md border border-[var(--ft-border)] text-left hover:border-[var(--ft-accent)]"
          >
            <span className="h-16" style={{ background: color.hex }} />
            <span className="px-2 py-1.5 font-mono text-xs">{color.hex}</span>
            <span className="px-2 pb-1.5 font-mono text-[10px] text-[var(--ft-text-muted)]">
              {Math.round(color.weight * 100)} % de l'image
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={() => copy(colors.map((color) => color.hex).join(", "))}
        className="text-xs text-[var(--ft-accent-text)] underline"
      >
        Copier toute la palette
      </button>

      {selected && (
        <div className="space-y-2 rounded-md border border-[var(--ft-border)] p-3">
          <Readout color={describeColor(selected.rgb)} />
          <SendButtons rgb={selected.rgb} onSend={onSend} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pipette */

function PickerTab({
  source,
  onSend,
}: {
  source: ReturnType<typeof useSourceCanvas>;
  onSend: (rgb: Rgb, slot: "text" | "background") => void;
}) {
  const [zoom, setZoom] = useState(100);
  const [picked, setPicked] = useState<{ x: number; y: number; color: ColorReadout } | undefined>();
  const [history, setHistory] = useState<ColorReadout[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState<string | undefined>();

  // La pipette lit les pixels de l'image **pleine résolution**, jamais ceux de
  // l'aperçu réduit : le rééchantillonnage mélange les couleurs voisines, et la
  // valeur relevée ne serait alors celle d'aucun pixel du fichier.
  const pixels = useMemo(() => source.full?.getPixels(), [source.full]);

  useEffect(() => {
    if (!source.full) {
      setUrl(undefined);
      return;
    }
    let objectUrl: string | undefined;
    source.full.encode("png").then((bytes) => {
      objectUrl = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "image/png" }));
      setUrl(objectUrl);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source.full]);

  const pick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!pixels) return;
    const box = event.currentTarget.getBoundingClientRect();
    // Les coordonnées viennent de la taille **affichée**, mesurée sur
    // l'élément : le zoom est un agrandissement CSS, il ne change pas l'image.
    const point = imageCoordinates(
      event.clientX - box.left,
      event.clientY - box.top,
      { width: box.width, height: box.height },
      { width: pixels.width, height: pixels.height },
    );
    if (!point) return;
    const color = pixelAt(pixels, point.x, point.y);
    if (!color) return;
    setPicked({ ...point, color });
    setHistory((current) => [color, ...current.filter((c) => c.hex !== color.hex)].slice(0, 8));
  };

  return (
    <div className="space-y-3">
      <Fieldset columns={1}>
        <Field label={`Zoom (${zoom} %)`} hint="Agrandit l'aperçu ; les coordonnées restent celles des pixels réels.">
          <Slider value={zoom} onChange={setZoom} min={25} max={800} step={25} />
        </Field>
      </Fieldset>

      <div className="max-h-[420px] overflow-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
        {url && (
          <img
            ref={imageRef}
            src={url}
            alt="Image à échantillonner"
            onClick={pick}
            draggable={false}
            className="cursor-crosshair"
            style={{
              width: source.width * (zoom / 100),
              height: source.height * (zoom / 100),
              imageRendering: zoom > 200 ? "pixelated" : "auto",
              maxWidth: "none",
            }}
          />
        )}
      </div>

      {picked ? (
        <div className="space-y-2 rounded-md border border-[var(--ft-border)] p-3">
          <div className="flex items-center gap-3">
            <span
              className="h-10 w-10 rounded-md border border-[var(--ft-border)]"
              style={{ background: picked.color.hex }}
            />
            <span className="font-mono text-xs text-[var(--ft-text-muted)]">
              x = {picked.x}, y = {picked.y} sur {source.width} × {source.height}
            </span>
          </div>
          <Readout color={picked.color} />
          <SendButtons rgb={picked.color.rgb} onSend={onSend} />
        </div>
      ) : (
        <p className="text-xs text-[var(--ft-text-muted)]">
          Cliquez dans l'image pour relever la couleur exacte d'un pixel.
        </p>
      )}

      {history.length > 1 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-[var(--ft-text-faint)]">
            Dernières couleurs relevées
          </p>
          <div className="flex flex-wrap gap-1">
            {history.map((color) => (
              <button
                key={color.hex}
                onClick={() => copy(color.hex)}
                title={color.hex}
                className="h-7 w-7 rounded border border-[var(--ft-border)]"
                style={{ background: color.hex }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- contraste */

function ContrastTab({
  text,
  background,
  setText,
  setBackground,
}: {
  text: Rgb;
  background: Rgb;
  setText: (rgb: Rgb) => void;
  setBackground: (rgb: Rgb) => void;
}) {
  const verdict = wcagVerdict(text, background);
  const levels: { label: string; pass: boolean; threshold: number }[] = [
    { label: "AA — texte normal", pass: verdict.aaNormal, threshold: WCAG_THRESHOLDS.aaNormal },
    { label: "AA — grand texte", pass: verdict.aaLarge, threshold: WCAG_THRESHOLDS.aaLarge },
    { label: "AAA — texte normal", pass: verdict.aaaNormal, threshold: WCAG_THRESHOLDS.aaaNormal },
    { label: "AAA — grand texte", pass: verdict.aaaLarge, threshold: WCAG_THRESHOLDS.aaaLarge },
  ];

  return (
    <div className="space-y-3">
      <Fieldset columns={2}>
        <Field label="Couleur du texte">
          <HexInput value={text} onChange={setText} />
        </Field>
        <Field label="Couleur du fond">
          <HexInput value={background} onChange={setBackground} />
        </Field>
      </Fieldset>

      {/* Le vrai juge reste l'œil : on montre le texte sur son fond, en deux
          tailles, plutôt que de s'en tenir à un chiffre. */}
      <div
        className="space-y-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] p-6"
        style={{ background: rgbToHex(background), color: rgbToHex(text) }}
      >
        <p className="text-sm">Texte normal — 14 px. Portez ce vieux whisky au juge blond qui fume.</p>
        <p className="text-2xl font-bold">Grand texte — 24 px gras.</p>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="font-mono text-2xl">{formatRatio(verdict.ratio)}</span>
        <span className="text-xs text-[var(--ft-text-muted)]">
          rapport de contraste (de 1:1 à 21:1)
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {levels.map((level) => (
          <div
            key={level.label}
            className="flex items-center justify-between gap-2 rounded-md border border-[var(--ft-border)] px-3 py-2 text-xs"
          >
            <span>{level.label}</span>
            <span
              className="inline-flex items-center gap-1 font-mono"
              style={{ color: level.pass ? "var(--ft-ok)" : "var(--ft-danger)" }}
            >
              <Icon name={level.pass ? "Check" : "X"} size={13} /> {level.threshold}:1
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-[var(--ft-text-muted)]">
        « Grand texte » signifie au moins 18 pt (24 px), ou 14 pt (18,66 px) en gras — c'est la
        définition de la norme WCAG 2.1, pas un arrondi.
      </p>
    </div>
  );
}

/** Saisie d'une couleur : nuancier natif et champ hexadécimal, tenus d'accord. */
function HexInput({ value, onChange }: { value: Rgb; onChange: (rgb: Rgb) => void }) {
  const [draft, setDraft] = useState(rgbToHex(value));

  useEffect(() => {
    setDraft(rgbToHex(value));
  }, [value]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Choisir une couleur"
        value={rgbToHex(value)}
        onChange={(event) => {
          const parsed = parseColor(event.target.value);
          if (parsed) onChange(parsed.rgb);
        }}
        className="h-8 w-10 cursor-pointer rounded border border-[var(--ft-border)] bg-transparent"
      />
      <TextInput
        value={draft}
        spellCheck={false}
        aria-label="Code de la couleur"
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = parseColor(event.target.value);
          if (parsed) onChange(parsed.rgb);
        }}
      />
    </div>
  );
}
