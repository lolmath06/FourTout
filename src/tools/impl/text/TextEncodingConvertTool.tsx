import { useEffect, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, Select, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { readSelectedFile } from "@/core/image/codec";
import {
  convertEncoding,
  detectEncoding,
  encodeText,
  decodeText,
  ENCODING_LABELS,
  ENCODINGS,
  type EncodingDetection,
  type TextEncodingId,
  type UnrepresentableCharacter,
} from "@/core/text/encoding";
import { isTextError, toTextError } from "@/core/text/errors";
import type { Eol } from "@/core/text/lines";
import { outputName } from "@/core/pdf/filenames";
import { useHandoff } from "@/features/handoff/store";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Conversion d'encodage.
 *
 * La règle du produit tient en une phrase : **rien ne se perd en silence**. Si
 * l'encodage de destination ne sait pas écrire un caractère, la conversion est
 * refusée, les caractères concernés sont nommés et situés, et le remplacement
 * n'a lieu que si l'utilisateur le demande explicitement.
 */
const NEWLINE_OPTIONS: { value: Eol | "keep"; label: string }[] = [
  { value: "keep", label: "Ne pas modifier" },
  { value: "lf", label: "LF (Unix, macOS)" },
  { value: "crlf", label: "CRLF (Windows)" },
  { value: "cr", label: "CR (anciens Mac)" },
];

export function TextEncodingConvertTool({ tool }: ToolComponentProps) {
  const handoff = useHandoff(tool.id);
  const [files, setFiles] = useState<SelectedFile[]>(() => handoff?.files ?? []);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [detection, setDetection] = useState<EncodingDetection | null>(null);
  const [from, setFrom] = useState<TextEncodingId | "auto">("auto");
  const [to, setTo] = useState<TextEncodingId>("utf-8");
  const [newline, setNewline] = useState<Eol | "keep">("keep");
  const [allowReplacement, setAllowReplacement] = useState(false);
  const [replacement, setReplacement] = useState("?");
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Le fichier est analysé dès qu'il est déposé : l'utilisateur voit d'où il
  // part avant de choisir où il va.
  useEffect(() => {
    let cancelled = false;
    setOutcome(null);
    setError(null);
    if (!files[0]) {
      setBytes(null);
      setDetection(null);
      return;
    }
    void (async () => {
      try {
        const read = await readSelectedFile(files[0]);
        if (cancelled) return;
        setBytes(read);
        setDetection(detectEncoding(read));
      } catch (readError) {
        if (!cancelled) setError(toTextError(readError).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files]);

  /**
   * Caractères impossibles à écrire dans la destination, calculés en continu :
   * l'avertissement précède la tentative de conversion, il ne la sanctionne pas.
   */
  const blocking: UnrepresentableCharacter[] =
    bytes && detection && !detection.binary
      ? encodeText(
          decodeText(bytes, from === "auto" ? detection.encoding : from),
          to,
        ).unrepresentable
      : [];

  const convert = async () => {
    if (!bytes || !files[0]) return;
    setOutcome(null);
    setError(null);
    try {
      const result = convertEncoding(bytes, {
        from,
        to,
        newline,
        replaceUnrepresentable: allowReplacement,
        replacement,
      });
      const file = {
        name: outputName(files[0].name, encodingSuffix(to), extensionOf(files[0].name)),
        bytes: result.bytes,
        mimeType: "text/plain;charset=utf-8",
      };
      setOutcome({
        files: [file],
        summary: `${result.characters} caractère(s) réécrits de ${ENCODING_LABELS[result.from]} vers ${ENCODING_LABELS[result.to]}.`,
        warning:
          result.replaced.length > 0
            ? `${result.replaced.length} caractère(s) ont été remplacés par « ${replacement} » : ${result.replaced
                .slice(0, 6)
                .map((item) => item.character)
                .join(" ")}`
            : undefined,
      });
      notify.success("Fichier converti", file.name);
    } catch (conversionError) {
      const failure = toTextError(conversionError);
      setError(failure.message);
      if (isTextError(conversionError) && conversionError.code === "encoding-unrepresentable") {
        notify.error("Conversion refusée", "Des caractères seraient perdus.");
      }
    }
  };

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label="Déposez le fichier texte à convertir"
        hint="Le fichier d'origine n'est jamais modifié : un nouveau fichier est produit."
      />

      {detection?.binary && (
        <Callout tone="error" title="Ce fichier n'est pas du texte">
          Il contient une forte proportion d'octets de contrôle. Le convertir n'aurait aucun sens et
          l'endommagerait.
        </Callout>
      )}

      {detection && !detection.binary && (
        <>
          <Callout tone={detection.certain ? "success" : "info"} title="Encodage détecté">
            {ENCODING_LABELS[detection.encoding]}
            {detection.certain
              ? " — le fichier le déclare lui-même."
              : ` — hypothèse à ${Math.round(detection.confidence * 100)} % de confiance. ${detection.reason}`}
          </Callout>

          <Fieldset columns={3} title="Conversion">
            <Field label="Encodage source">
              <Select
                value={from}
                onChange={setFrom}
                options={[
                  {
                    value: "auto" as const,
                    label: `Automatique (${ENCODING_LABELS[detection.encoding]})`,
                  },
                  ...ENCODINGS.map((value) => ({ value, label: ENCODING_LABELS[value] })),
                ]}
              />
            </Field>
            <Field label="Encodage de destination">
              <Select
                value={to}
                onChange={setTo}
                options={ENCODINGS.map((value) => ({ value, label: ENCODING_LABELS[value] }))}
              />
            </Field>
            <Field label="Fins de ligne" hint="Réutilise le moteur de « Convertir les fins de ligne ».">
              <Select value={newline} onChange={setNewline} options={NEWLINE_OPTIONS} />
            </Field>
          </Fieldset>

          {blocking.length > 0 && (
            <Callout
              tone={allowReplacement ? "warning" : "error"}
              title={`${blocking.length} caractère(s) ne peuvent pas être écrits en ${ENCODING_LABELS[to]}`}
            >
              <div className="space-y-2">
                <ul className="space-y-0.5">
                  {blocking.slice(0, 8).map((item) => (
                    <li key={item.codePoint} className="ft-num">
                      « {item.character} » — U+
                      {item.codePoint.toString(16).toUpperCase().padStart(4, "0")}, ligne{" "}
                      {item.line}
                      {item.count > 1 ? ` (${item.count} fois)` : ""}
                    </li>
                  ))}
                  {blocking.length > 8 && <li>…et {blocking.length - 8} autre(s).</li>}
                </ul>
                <p>
                  {allowReplacement
                    ? `Ces caractères seront remplacés par « ${replacement} ». Cette perte est irréversible.`
                    : "La conversion est refusée tant que vous ne l'avez pas explicitement autorisée. Choisissez plutôt UTF-8, qui sait tout écrire."}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={allowReplacement}
                      onChange={(event) => setAllowReplacement(event.target.checked)}
                      className="accent-[var(--ft-accent)]"
                    />
                    Autoriser le remplacement
                  </label>
                  {allowReplacement && (
                    <span className="flex items-center gap-2">
                      <span className="ft-label">Remplacer par</span>
                      <TextInput
                        value={replacement}
                        onChange={(event) => setReplacement(event.target.value.slice(0, 3))}
                        aria-label="Caractère de remplacement"
                        className="w-16"
                      />
                    </span>
                  )}
                </div>
              </div>
            </Callout>
          )}

          <div className="flex justify-end border-t border-[var(--ft-border)] pt-4">
            <Button
              size="md"
              variant="primary"
              onClick={convert}
              disabled={blocking.length > 0 && !allowReplacement}
            >
              <Icon name="ArrowRightLeft" size={15} /> Convertir en {ENCODING_LABELS[to]}
            </Button>
          </div>
        </>
      )}

      {error && (
        <Callout tone="error" title="La conversion a échoué">
          {error}
        </Callout>
      )}

      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}

/** `utf-8-bom` → `utf8-bom`, pour un nom de fichier lisible. */
function encodingSuffix(encoding: TextEncodingId): string {
  return encoding.replace(/-(\d)/, "$1");
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "txt";
}
