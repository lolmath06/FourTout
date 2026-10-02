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
import { Trans, localized, t, tx } from "@/i18n";

/**
 * Conversion d'encodage.
 *
 * La règle du produit tient en une phrase : **rien ne se perd en silence**. Si
 * l'encodage de destination ne sait pas écrire un caractère, la conversion est
 * refusée, les caractères concernés sont nommés et situés, et le remplacement
 * n'a lieu que si l'utilisateur le demande explicitement.
 */
const NEWLINE_OPTIONS: { value: Eol | "keep"; label: string }[] = localized(() => [
  { value: "keep", label: t("Ne pas modifier") },
  { value: "lf", label: t("LF (Unix, macOS)") },
  { value: "crlf", label: t("CRLF (Windows)") },
  { value: "cr", label: t("CR (anciens Mac)") },
]);

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
        summary: t("{characters} caractère(s) réécrits de {value} vers {value2}.", { characters: result.characters, value: ENCODING_LABELS[result.from], value2: ENCODING_LABELS[result.to] }),
        warning:
          result.replaced.length > 0
            ? t("{count} caractère(s) ont été remplacés par « {replacement} » : {value}", { count: result.replaced.length, replacement, value: result.replaced
                .slice(0, 6)
                .map((item) => item.character)
                .join(" ") })
            : undefined,
      });
      notify.success(t("Fichier converti"), file.name);
    } catch (conversionError) {
      const failure = toTextError(conversionError);
      setError(failure.message);
      if (isTextError(conversionError) && conversionError.code === "encoding-unrepresentable") {
        notify.error(t("Conversion refusée"), t("Des caractères seraient perdus."));
      }
    }
  };

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label={t("Déposez le fichier texte à convertir")}
        hint={t("Le fichier d'origine n'est jamais modifié : un nouveau fichier est produit.")}
      />

      {detection?.binary && (
        <Callout tone="error" title={t("Ce fichier n'est pas du texte")}>
          {t("Il contient une forte proportion d'octets de contrôle. Le convertir n'aurait aucun sens et l'endommagerait.")}
        </Callout>
      )}

      {detection && !detection.binary && (
        <>
          <Callout tone={detection.certain ? "success" : "info"} title={t("Encodage détecté")}>
            {tx(ENCODING_LABELS[detection.encoding])}
            {detection.certain
              ? t(" — le fichier le déclare lui-même.")
              : t(" — hypothèse à {value} % de confiance. {reason}", { value: Math.round(detection.confidence * 100), reason: detection.reason })}
          </Callout>

          <Fieldset columns={3} title={t("Conversion")}>
            <Field label={t("Encodage source")}>
              <Select
                value={from}
                onChange={setFrom}
                options={[
                  {
                    value: "auto" as const,
                    label: t("Automatique ({value})", { value: ENCODING_LABELS[detection.encoding] }),
                  },
                  ...ENCODINGS.map((value) => ({ value, label: ENCODING_LABELS[value] })),
                ]}
              />
            </Field>
            <Field label={t("Encodage de destination")}>
              <Select
                value={to}
                onChange={setTo}
                options={ENCODINGS.map((value) => ({ value, label: ENCODING_LABELS[value] }))}
              />
            </Field>
            <Field label={t("Fins de ligne")} hint={t("Réutilise le moteur de « Convertir les fins de ligne ».")}>
              <Select value={newline} onChange={setNewline} options={NEWLINE_OPTIONS} />
            </Field>
          </Fieldset>

          {blocking.length > 0 && (
            <Callout
              tone={allowReplacement ? "warning" : "error"}
              title={t("{count} caractère(s) ne peuvent pas être écrits en {value}", { count: blocking.length, value: ENCODING_LABELS[to] })}
            >
              <div className="space-y-2">
                <ul className="space-y-0.5">
                  {blocking.slice(0, 8).map((item) => (
                    <li key={item.codePoint} className="ft-num">
                      {t("« {character} » — U+{value}, ligne {line}{value2}", { character: item.character, value: item.codePoint.toString(16).toUpperCase().padStart(4, "0"), line: item.line, value2: item.count > 1 ? ` (${item.count} fois)` : "" })}
                    </li>
                  ))}
                  {blocking.length > 8 && <li>{t("…et {value} autre(s).", { value: blocking.length - 8 })}</li>}
                </ul>
                <p>
                  {allowReplacement
                    ? t("Ces caractères seront remplacés par « {replacement} ». Cette perte est irréversible.", { replacement })
                    : t("La conversion est refusée tant que vous ne l'avez pas explicitement autorisée. Choisissez plutôt UTF-8, qui sait tout écrire.")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={allowReplacement}
                      onChange={(event) => setAllowReplacement(event.target.checked)}
                      className="accent-[var(--ft-accent)]"
                    />
                    {t("Autoriser le remplacement")}
                  </label>
                  {allowReplacement && (
                    <span className="flex items-center gap-2">
                      <Trans source={"<0>Remplacer par</0>"} components={[<span className="ft-label" />]} />
                      <TextInput
                        value={replacement}
                        onChange={(event) => setReplacement(event.target.value.slice(0, 3))}
                        aria-label={t("Caractère de remplacement")}
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
              <Icon name="ArrowRightLeft" size={15} />{" "}{t("Convertir en {value}", { value: ENCODING_LABELS[to] })}
            </Button>
          </div>
        </>
      )}

      {error && (
        <Callout tone="error" title={t("La conversion a échoué")}>
          {tx(error)}
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
