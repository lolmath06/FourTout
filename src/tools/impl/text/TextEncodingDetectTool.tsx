import { useState } from "react";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { readSelectedFile } from "@/core/image/codec";
import {
  detectEncoding,
  ENCODING_LABELS,
  type BomKind,
  type EncodingDetection,
} from "@/core/text/encoding";
import type { Eol } from "@/core/text/lines";
import { setHandoff } from "@/features/handoff/store";
import { toolRoute } from "@/core/tools/types";
import { useNavigate } from "react-router-dom";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Détection d'encodage.
 *
 * Tout l'intérêt de cet outil tient dans ce qu'il ose ne pas affirmer. Sauf
 * marque d'ordre des octets, un fichier ne déclare pas son encodage : la
 * détection affiche donc une certitude, ses hypothèses concurrentes, et la
 * raison de son choix — plutôt qu'un verdict qui aurait l'air sûr.
 */
const EOL_LABELS: Record<Eol, string> = {
  lf: "LF (Unix, macOS)",
  crlf: "CRLF (Windows)",
  cr: "CR (anciens Mac)",
};

const BOM_LABELS: Record<BomKind, string> = {
  none: "Aucune",
  "utf-8": "UTF-8 (EF BB BF)",
  "utf-16le": "UTF-16 petit-boutien (FF FE)",
  "utf-16be": "UTF-16 grand-boutien (FE FF)",
};

export function TextEncodingDetectTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [detection, setDetection] = useState<EncodingDetection | null>(null);
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const analyse = async (selection: SelectedFile[]) => {
    setFiles(selection);
    setDetection(null);
    if (!selection[0]) return;
    try {
      const bytes = await readSelectedFile(selection[0]);
      setDetection(detectEncoding(bytes));
      setName(selection[0].name);
    } catch (error) {
      notify.error("Lecture impossible", error instanceof Error ? error.message : undefined);
    }
  };

  /** Passe la main à l'outil de conversion, fichier déjà chargé. */
  const convert = () => {
    setHandoff({ toolId: "text-encoding-convert", files });
    navigate(toolRoute("text-encoding-convert"));
  };

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={analyse}
        label="Déposez le fichier texte à analyser"
        hint="Le contenu n'est lu que localement, et n'est jamais modifié."
      />

      {detection && (
        <>
          {detection.binary && (
            <Callout tone="warning" title="Ce fichier ne ressemble pas à du texte">
              Il contient une forte proportion d'octets qu'aucun encodage de texte ne rend lisibles.
              S'il s'agit d'une image, d'une archive ou d'un exécutable, la notion d'encodage n'a
              pas de sens pour lui.
            </Callout>
          )}

          <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)]">
            <div className="flex items-baseline justify-between gap-3 border-b border-[var(--ft-rule)] px-3 py-2">
              <p className="text-[13px] font-medium">{ENCODING_LABELS[detection.encoding]}</p>
              <Certainty detection={detection} />
            </div>
            <dl className="divide-y divide-[var(--ft-rule)] text-sm">
              <Row label="Fichier">
                {name} · {formatFileSize(detection.byteLength)}
              </Row>
              <Row label="Marque d'ordre des octets (BOM)">{BOM_LABELS[detection.bom]}</Row>
              <Row label="Fins de ligne">
                {detection.newline.lines === 0
                  ? "Aucune"
                  : `${EOL_LABELS[detection.newline.dominant]}${
                      detection.newline.mixed ? " — le fichier en mélange plusieurs" : ""
                    }`}
              </Row>
              <Row label="Lignes">{detection.newline.lines}</Row>
              <Row label="Pourquoi ce choix">{detection.reason}</Row>
              {detection.alternatives.length > 0 && (
                <Row label="Autres hypothèses">
                  {detection.alternatives
                    .map((item) => ENCODING_LABELS[item.encoding])
                    .join(", ")}
                </Row>
              )}
            </dl>
          </div>

          {!detection.binary && (
            <>
              <div className="space-y-1.5">
                <p className="ft-section">Début du fichier, tel que décodé</p>
                <pre className="max-h-60 overflow-auto rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-bg)] p-3 font-mono text-xs">
                  {visibleSample(detection.text)}
                </pre>
              </div>

              <div className="flex justify-end">
                <Button size="sm" variant="primary" onClick={convert}>
                  <Icon name="ArrowRightLeft" size={14} /> Convertir l'encodage de ce fichier
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Affiche la certitude sans jamais la surjouer. */
function Certainty({ detection }: { detection: EncodingDetection }) {
  if (detection.certain) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--ft-ok)]">
        <Icon name="CircleCheck" size={14} /> Certain — le fichier le déclare
      </span>
    );
  }
  const percent = Math.round(detection.confidence * 100);
  const tone = percent >= 80 ? "var(--ft-text-muted)" : "var(--ft-warn)";
  return (
    <span className="flex items-center gap-1.5 text-xs tabular-nums" style={{ color: tone }}>
      <Icon name="Info" size={14} /> Hypothèse — {percent} % de confiance
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ft-row-py grid gap-1 px-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-3">
      <dt className="ft-label">{label}</dt>
      <dd className="min-w-0 break-words text-[13px]">{children}</dd>
    </div>
  );
}

/**
 * Rend visibles les fins de ligne : elles font partie du diagnostic, et un
 * CRLF est indiscernable d'un LF tant qu'on ne le montre pas.
 */
function visibleSample(text: string): string {
  return text
    .slice(0, 2000)
    .replace(/\r\n/g, "\u240d\u240a\n")
    .replace(/(?<!\u240d)\n(?!$)/g, "\u240a\n")
    .replace(/\r(?!\u240a)/g, "\u240d\n");
}
