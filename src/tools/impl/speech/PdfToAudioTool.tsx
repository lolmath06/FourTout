import { useEffect, useState } from "react";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ModelRequirements } from "@/components/speech/ModelRequirements";
import { TtsWorkbench } from "@/components/speech/TtsWorkbench";
import { cleanMessage } from "@/components/speech/message";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { extractText } from "@/core/pdf/operations/extractText";
import { recognizePdf } from "@/core/ocr/pdf";
import { cleanPdfText } from "@/core/speech/pdfText";
import { TTS_ENGINE } from "@/core/speech/tts";
import { notify } from "@/features/notifications/store";
import type { PdfSource } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";
import { t, tx } from "@/i18n";

/**
 * Lecture à voix haute d'un PDF.
 *
 * L'extraction de texte et l'OCR existants sont réutilisés tels quels : ce
 * n'est qu'une source de texte de plus pour l'atelier de synthèse. Un PDF sans
 * couche texte le dit clairement et propose l'OCR plutôt que de produire un
 * fichier audio vide.
 */

type Extraction =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "ready"; removedLines: number; pages: number }
  | { state: "empty"; pages: number }
  | { state: "ocr"; label: string };

export function PdfToAudioTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [text, setText] = useState("");
  const [extraction, setExtraction] = useState<Extraction>({ state: "idle" });

  useEffect(() => {
    const file = files[0];
    if (!file?.file) {
      setText("");
      setExtraction({ state: "idle" });
      return;
    }

    let cancelled = false;
    setExtraction({ state: "reading" });
    (async () => {
      try {
        const bytes = new Uint8Array(await file.file!.arrayBuffer());
        const extracted = await extractText({ name: file.name, bytes });
        if (cancelled) return;
        const cleaned = cleanPdfText(extracted.pages);
        if (cleaned.text.trim().length === 0) {
          setText("");
          setExtraction({ state: "empty", pages: extracted.pages.length });
          return;
        }
        setText(cleaned.text);
        setExtraction({
          state: "ready",
          removedLines: cleaned.removedLines,
          pages: extracted.pages.length,
        });
      } catch (error) {
        if (cancelled) return;
        setExtraction({ state: "idle" });
        notify.error(t("Lecture impossible"), cleanMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files]);

  const runOcr = async () => {
    const file = files[0];
    if (!file?.file) return;
    setExtraction({ state: "ocr", label: t("Préparation…") });
    try {
      const bytes = new Uint8Array(await file.file.arrayBuffer());
      const source: PdfSource = { name: file.name, bytes };
      const pages = await recognizePdf(source, { language: "fra" }, {
        report: ({ label }) => setExtraction({ state: "ocr", label: label ?? t("Reconnaissance…") }),
      });
      const cleaned = cleanPdfText(pages.map((page) => ({ page: page.page, text: page.text })));
      if (cleaned.text.trim().length === 0) {
        setExtraction({ state: "empty", pages: pages.length });
        notify.warning(t("Aucun texte reconnu"), t("L'OCR n'a rien trouvé dans ce document."));
        return;
      }
      setText(cleaned.text);
      setExtraction({ state: "ready", removedLines: cleaned.removedLines, pages: pages.length });
      notify.success(t("Texte reconnu"), t("{count} {count, plural, one {page} other {pages}} {count, plural, one {océrisée} other {océrisées}}.", { count: pages.length }));
    } catch (error) {
      setExtraction({ state: "empty", pages: 0 });
      notify.error("OCR impossible", cleanMessage(error));
    }
  };

  const baseName = files[0]?.name.replace(/\.[^.]+$/, "") || "document";

  const header = (
    <div className="space-y-3">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label={t("Déposez le PDF à écouter")}
      />

      {extraction.state === "reading" && (
        <p className="flex items-center gap-2 text-sm text-[var(--ft-text-muted)]">
          <Icon name="Loader" size={15} className="animate-spin" />{" "}{t("Extraction du texte…")}
        </p>
      )}

      {extraction.state === "ocr" && (
        <p className="flex items-center gap-2 text-sm text-[var(--ft-text-muted)]">
          <Icon name="Loader" size={15} className="animate-spin" /> {tx(extraction.label)}
        </p>
      )}

      {extraction.state === "ready" && (
        <p className="text-[11px] text-[var(--ft-text-faint)]">
          {t("{pages} {pages, plural, one {page} other {pages}} {pages, plural, one {lue} other {lues}}{value}.", { pages: extraction.pages, value: extraction.removedLines > 0 &&
            t(" — {removedLines} {removedLines, plural, one {ligne} other {lignes}} d'en-tête ou de numérotation {removedLines, plural, one {écartée} other {écartées}}", { removedLines: extraction.removedLines }) })}
        </p>
      )}

      {extraction.state === "empty" && (
        <div className="space-y-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2.5 text-sm">
          <p className="flex items-center gap-2 text-[var(--ft-text)]">
            <Icon name="Info" size={15} />{" "}{t("Aucun texte extractible détecté dans ce PDF.")}
          </p>
          <p className="text-xs text-[var(--ft-text-muted)]">
            {t("Ce document est probablement un scan. La reconnaissance de caractères peut en tirer le texte, puis la lecture reprendra normalement.")}
          </p>
          <Button size="sm" variant="primary" onClick={() => void runOcr()}>
            <Icon name="ScanText" size={14} />{" "}{t("OCR puis générer l'audio")}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <ModelRequirements required={[TTS_ENGINE, "voice-fr-siwis"]} optional={["voice-en-lessac"]}>
      {(assets) => (
        <TtsWorkbench
          tool={tool}
          assets={assets}
          text={text}
          onTextChange={setText}
          baseName={baseName}
          textLabel={t("Texte du document")}
          readOnlyNote={t("Vous pouvez corriger le texte avant de lancer la lecture.")}
          header={header}
        />
      )}
    </ModelRequirements>
  );
}
